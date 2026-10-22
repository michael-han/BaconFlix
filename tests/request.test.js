import { test } from "node:test";
import assert from "node:assert/strict";
import pino from "pino";
import { MessageFlags } from "discord.js";
import { createRequestHandlers, CUSTOM_IDS } from "../src/commands/request.js";
import { RadarrError } from "../src/radarr.js";
import { createRateLimiter } from "../src/utils/rateLimit.js";

const DUNE = { tmdbId: 438631, title: "Dune", year: 2021, overview: "Spice." };
const DUNE_1984 = { tmdbId: 841, title: "Dune", year: 1984, overview: "Older spice." };

function fakeRadarr(overrides = {}) {
    const added = [];
    return {
        added,
        lookup: async () => [DUNE],
        findByTmdbId: async (id) => [DUNE, DUNE_1984].find((m) => String(m.tmdbId) === id) ?? null,
        isInLibrary: async () => false,
        getFreeSpace: async () => 5 * 1024 ** 4,
        addMovie: async (movie) => added.push(movie),
        ...overrides,
    };
}

function setup({ radarr = fakeRadarr(), access, rateLimit, minFreeBytes = 1024 ** 4 } = {}) {
    const handlers = createRequestHandlers({
        radarr,
        rateLimiter: createRateLimiter(rateLimit ?? { max: 3, windowMs: 60_000 }),
        access: access ?? { allowedGuildIds: [], allowedRoleIds: [] },
        minFreeBytes,
        logger: pino({ level: "silent" }),
    });
    return { handlers, radarr };
}

function fakeInteraction({ query = "Dune", values, customId, roles = [] } = {}) {
    const interaction = {
        user: { id: "u1", username: "tester" },
        guildId: "g1",
        member: { roles },
        options: { getString: () => query },
        values,
        customId,
        deferred: false,
        replied: false,
        calls: [],
        async reply(payload) {
            this.calls.push(["reply", payload]);
            this.replied = true;
        },
        async deferReply(payload) {
            this.calls.push(["deferReply", payload]);
            this.deferred = true;
        },
        async deferUpdate() {
            this.calls.push(["deferUpdate"]);
            this.deferred = true;
        },
        async editReply(payload) {
            this.calls.push(["editReply", payload]);
        },
        async followUp(payload) {
            this.calls.push(["followUp", payload]);
        },
    };
    return interaction;
}

const last = (interaction, type) => interaction.calls.findLast(([t]) => t === type)?.[1];
const embedOf = (payload) => payload.embeds[0].data;

test("denies users without an allowed role, privately and before calling Radarr", async () => {
    let searched = false;
    const { handlers } = setup({
        radarr: fakeRadarr({ lookup: async () => ((searched = true), []) }),
        access: { allowedGuildIds: [], allowedRoleIds: ["r1"] },
    });
    const interaction = fakeInteraction({ roles: ["r2"] });
    await handlers.execute(interaction);

    const reply = last(interaction, "reply");
    assert.equal(embedOf(reply).title, "Not allowed");
    assert.equal(reply.flags, MessageFlags.Ephemeral);
    assert.equal(searched, false);
});

test("rate limits after the configured number of searches", async () => {
    const { handlers } = setup({ rateLimit: { max: 1, windowMs: 60_000 } });
    await handlers.execute(fakeInteraction());
    const second = fakeInteraction();
    await handlers.execute(second);

    assert.equal(embedOf(last(second, "reply")).title, "Slow down");
    assert.equal(last(second, "deferReply"), undefined);
});

test("runs the search privately", async () => {
    const { handlers } = setup();
    const interaction = fakeInteraction();
    await handlers.execute(interaction);
    assert.deepEqual(last(interaction, "deferReply"), { flags: MessageFlags.Ephemeral });
});

test("stops when disk space is below the minimum", async () => {
    let searched = false;
    const { handlers } = setup({
        radarr: fakeRadarr({
            getFreeSpace: async () => 100 * 1024 ** 3,
            lookup: async () => ((searched = true), []),
        }),
    });
    const interaction = fakeInteraction();
    await handlers.execute(interaction);

    const embed = embedOf(last(interaction, "editReply"));
    assert.equal(embed.title, "Low disk space");
    assert.match(embed.description, /100 GB free \(minimum is 1\.0 TB\)/);
    assert.equal(searched, false);
});

test("skips the disk check when the minimum is 0", async () => {
    const { handlers } = setup({
        minFreeBytes: 0,
        radarr: fakeRadarr({
            getFreeSpace: async () => {
                throw new Error("should not be called");
            },
        }),
    });
    const interaction = fakeInteraction();
    await handlers.execute(interaction);
    assert.equal(embedOf(last(interaction, "editReply")).title, "Dune (2021)");
});

test("reports when nothing matches", async () => {
    const { handlers } = setup({ radarr: fakeRadarr({ lookup: async () => [] }) });
    const interaction = fakeInteraction({ query: "zzzz" });
    await handlers.execute(interaction);
    assert.equal(embedOf(last(interaction, "editReply")).title, "No results");
});

test("offers a confirm button for a single new result", async () => {
    const { handlers } = setup();
    const interaction = fakeInteraction();
    await handlers.execute(interaction);

    const reply = last(interaction, "editReply");
    assert.equal(embedOf(reply).title, "Dune (2021)");
    assert.equal(reply.components[0].components[0].data.custom_id, "request:confirm:438631");
});

test("says so when the single result is already in the library", async () => {
    const { handlers } = setup({ radarr: fakeRadarr({ isInLibrary: async () => true }) });
    const interaction = fakeInteraction();
    await handlers.execute(interaction);

    const reply = last(interaction, "editReply");
    assert.match(embedOf(reply).description, /already on the server/);
    assert.deepEqual(reply.components, []);
});

test("shows a de-duplicated select menu for multiple results", async () => {
    const { handlers } = setup({
        radarr: fakeRadarr({ lookup: async () => [DUNE, DUNE_1984, DUNE] }),
    });
    const interaction = fakeInteraction();
    await handlers.execute(interaction);

    const menu = last(interaction, "editReply").components[0].components[0];
    assert.equal(menu.data.custom_id, CUSTOM_IDS.select);
    assert.deepEqual(
        menu.options.map((o) => o.data.value),
        ["438631", "841"],
    );
});

test("truncates long titles to fit Discord's select menu limits", async () => {
    const long = { tmdbId: 1, title: "x".repeat(300), year: 2000, overview: "y".repeat(300) };
    const { handlers } = setup({ radarr: fakeRadarr({ lookup: async () => [long, DUNE] }) });
    const interaction = fakeInteraction();
    await handlers.execute(interaction);

    const option = last(interaction, "editReply").components[0].components[0].options[0].data;
    assert.equal(option.label.length, 100);
    assert.equal(option.description.length, 100);
});

test("selecting a movie shows its confirm button", async () => {
    const { handlers } = setup();
    const interaction = fakeInteraction({ values: ["841"] });
    await handlers.handleSelect(interaction);

    const reply = last(interaction, "editReply");
    assert.equal(embedOf(reply).title, "Dune (1984)");
    assert.equal(reply.components[0].components[0].data.custom_id, "request:confirm:841");
});

test("confirming adds the movie and announces it publicly", async () => {
    const { handlers, radarr } = setup();
    const interaction = fakeInteraction({ customId: "request:confirm:438631" });
    await handlers.handleConfirm(interaction);

    assert.deepEqual(radarr.added, [DUNE]);
    assert.match(embedOf(last(interaction, "editReply")).description, /added to Radarr/);
    const announcement = last(interaction, "followUp");
    assert.equal(announcement.flags, undefined);
    assert.match(embedOf(announcement).description, /<@u1>/);
});

test("confirming a movie someone else just added shows it as existing", async () => {
    const { handlers } = setup({
        radarr: fakeRadarr({
            addMovie: async () => {
                throw new RadarrError("exists", { code: "MOVIE_EXISTS" });
            },
        }),
    });
    const interaction = fakeInteraction({ customId: "request:confirm:438631" });
    await handlers.handleConfirm(interaction);

    assert.match(embedOf(last(interaction, "editReply")).description, /already on the server/);
    assert.equal(last(interaction, "followUp"), undefined);
});

test("shows Radarr's friendly error message", async () => {
    const { handlers } = setup({
        radarr: fakeRadarr({
            lookup: async () => {
                throw new RadarrError("Radarr is unreachable right now.");
            },
        }),
    });
    const interaction = fakeInteraction();
    await handlers.execute(interaction);

    const embed = embedOf(last(interaction, "editReply"));
    assert.equal(embed.title, "Request failed");
    assert.equal(embed.description, "Radarr is unreachable right now.");
});

test("hides unexpected error details from users", async () => {
    const { handlers } = setup({
        radarr: fakeRadarr({
            lookup: async () => {
                throw new TypeError("cannot read properties of undefined");
            },
        }),
    });
    const interaction = fakeInteraction();
    await handlers.execute(interaction);
    assert.match(embedOf(last(interaction, "editReply")).description, /has been logged/);
});
