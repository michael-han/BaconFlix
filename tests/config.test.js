import { test } from "node:test";
import assert from "node:assert/strict";
import { ConfigError, loadConfig } from "../src/config.js";

const minimal = {
    DISCORD_TOKEN: "token",
    DISCORD_CLIENT_ID: "123",
    RADARR_URL: "http://radarr:7878/",
    RADARR_API_KEY: "key",
};

test("applies defaults for optional settings", () => {
    const config = loadConfig(minimal);
    assert.equal(config.radarr.url, "http://radarr:7878");
    assert.equal(config.radarr.qualityProfileId, 1);
    assert.equal(config.radarr.rootFolderPath, "/movies");
    assert.deepEqual(config.rateLimit, { max: 3, windowMs: 10 * 60 * 1000 });
    assert.equal(config.diskSpaceMinBytes, 1024 ** 4);
    assert.deepEqual(config.http, { timeoutMs: 15000, insecureTls: false });
    assert.deepEqual(config.access, { allowedGuildIds: [], allowedRoleIds: [] });
    assert.equal(config.logLevel, "info");
});

test("reports every missing required variable at once", () => {
    assert.throws(
        () => loadConfig({}),
        (error) => {
            assert.ok(error instanceof ConfigError);
            assert.deepEqual(error.problems, [
                "DISCORD_TOKEN is required",
                "DISCORD_CLIENT_ID is required",
                "RADARR_URL is required",
                "RADARR_API_KEY is required",
            ]);
            return true;
        },
    );
});

test("treats blank values as missing", () => {
    assert.throws(() => loadConfig({ ...minimal, RADARR_API_KEY: "  " }), /RADARR_API_KEY/);
});

test("skips Radarr settings when not required", () => {
    const config = loadConfig(
        { DISCORD_TOKEN: "token", DISCORD_CLIENT_ID: "123" },
        { requireRadarr: false },
    );
    assert.equal(config.radarr, null);
});

test("parses custom values", () => {
    const config = loadConfig({
        ...minimal,
        RADARR_QUALITY_PROFILE_ID: "8",
        RADARR_ROOT_FOLDER: "/data/media/movies",
        ALLOWED_GUILD_IDS: "111, 222",
        ALLOWED_ROLE_IDS: "333",
        RATE_LIMIT_MAX: "0",
        RATE_LIMIT_WINDOW_MINUTES: "5",
        DISK_SPACE_MIN_GB: "0",
        INSECURE_TLS: "true",
        LOG_LEVEL: "debug",
    });
    assert.equal(config.radarr.qualityProfileId, 8);
    assert.equal(config.radarr.rootFolderPath, "/data/media/movies");
    assert.deepEqual(config.access.allowedGuildIds, ["111", "222"]);
    assert.deepEqual(config.access.allowedRoleIds, ["333"]);
    assert.deepEqual(config.rateLimit, { max: 0, windowMs: 5 * 60 * 1000 });
    assert.equal(config.diskSpaceMinBytes, 0);
    assert.equal(config.http.insecureTls, true);
    assert.equal(config.logLevel, "debug");
});

test("rejects malformed values", () => {
    assert.throws(
        () =>
            loadConfig({
                ...minimal,
                RADARR_URL: "radarr:7878",
                RADARR_QUALITY_PROFILE_ID: "HD",
                ALLOWED_ROLE_IDS: "123,@mods",
                INSECURE_TLS: "maybe",
                LOG_LEVEL: "loud",
            }),
        (error) => {
            assert.equal(error.problems.length, 5);
            return true;
        },
    );
});

test("returns a frozen config", () => {
    const config = loadConfig(minimal);
    assert.ok(Object.isFrozen(config.radarr));
    assert.ok(Object.isFrozen(config.access.allowedRoleIds));
});
