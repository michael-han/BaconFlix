import { test } from "node:test";
import assert from "node:assert/strict";
import { createRadarrClient, RadarrError, toRadarrError } from "../src/radarr.js";

function httpError({ status, data, code } = {}) {
    const error = new Error("request failed");
    if (status) error.response = { status, data };
    if (code) error.code = code;
    return error;
}

// Minimal stand-in for an axios instance: routes are "METHOD /path".
function fakeHttp(routes) {
    const calls = [];
    const respond = (method) => async (path, arg) => {
        calls.push({ method, path, arg });
        const handler = routes[`${method} ${path}`];
        if (!handler) throw httpError({ status: 404 });
        return { data: await handler(arg) };
    };
    return { get: respond("GET"), post: respond("POST"), calls };
}

function client(routes) {
    const http = fakeHttp(routes);
    const radarr = createRadarrClient({
        url: "http://radarr:7878",
        apiKey: "key",
        qualityProfileId: 4,
        rootFolderPath: "/data/movies",
        http,
    });
    return { radarr, http };
}

test("maps HTTP failures to user-safe messages", () => {
    const cases = [
        [httpError({ status: 401 }), /API key/],
        [httpError({ status: 500 }), /HTTP 500/],
        [httpError({ code: "ECONNABORTED" }), /too long/],
        [httpError({ code: "ECONNREFUSED" }), /unreachable/],
        [httpError({ code: "SELF_SIGNED_CERT_IN_CHAIN" }), /INSECURE_TLS/],
        [httpError(), /Something went wrong/],
        [
            httpError({ status: 400, data: [{ errorMessage: "Root folder does not exist" }] }),
            /Root folder does not exist/,
        ],
    ];
    for (const [error, message] of cases) {
        const mapped = toRadarrError(error);
        assert.ok(mapped instanceof RadarrError);
        assert.match(mapped.message, message);
        assert.equal(mapped.cause, error);
    }
});

test("recognizes Radarr's 'already added' validation error", () => {
    const mapped = toRadarrError(
        httpError({
            status: 400,
            data: [
                {
                    errorCode: "MovieExistsValidator",
                    errorMessage: "This movie has already been added",
                },
            ],
        }),
    );
    assert.equal(mapped.code, "MOVIE_EXISTS");
});

test("addMovie sends the configured profile and root folder", async () => {
    const { radarr, http } = client({ "POST /movie": (body) => body });
    await radarr.addMovie({ tmdbId: 438631, title: "Dune", year: 2021, overview: "ignored" });
    assert.deepEqual(http.calls[0].arg, {
        tmdbId: 438631,
        title: "Dune",
        year: 2021,
        qualityProfileId: 4,
        rootFolderPath: "/data/movies",
        monitored: true,
        addOptions: { searchForMovie: true },
    });
});

test("isInLibrary queries by TMDB ID", async () => {
    const { radarr, http } = client({
        "GET /movie": ({ params }) => (params.tmdbId === 1 ? [{ tmdbId: 1 }] : []),
    });
    assert.equal(await radarr.isInLibrary(1), true);
    assert.equal(await radarr.isInLibrary(2), false);
    assert.deepEqual(http.calls[0].arg, { params: { tmdbId: 1 } });
});

test("findByTmdbId returns the matching lookup result", async () => {
    const { radarr } = client({
        "GET /movie/lookup": () => [{ tmdbId: 7, title: "Other" }, { tmdbId: 438631 }],
    });
    assert.deepEqual(await radarr.findByTmdbId("438631"), { tmdbId: 438631 });
    assert.equal(await radarr.findByTmdbId("999"), null);
});

test("getFreeSpace reads the configured root folder, ignoring trailing slashes", async () => {
    const { radarr } = client({
        "GET /rootfolder": () => [
            { path: "/other/", freeSpace: 1 },
            { path: "/data/movies/", freeSpace: 42 },
        ],
    });
    assert.equal(await radarr.getFreeSpace(), 42);
});

test("getFreeSpace explains a missing root folder", async () => {
    const { radarr } = client({ "GET /rootfolder": () => [{ path: "/movies", freeSpace: 1 }] });
    await assert.rejects(radarr.getFreeSpace(), /RADARR_ROOT_FOLDER/);
});

test("errors from the HTTP client surface as RadarrError", async () => {
    const { radarr } = client({
        "GET /movie/lookup": () => {
            throw httpError({ code: "ECONNREFUSED" });
        },
    });
    await assert.rejects(radarr.lookup("Dune"), RadarrError);
});

test("verify lists the available options when config doesn't match", async () => {
    const { radarr } = client({
        "GET /system/status": () => ({ version: "5.0.0" }),
        "GET /qualityprofile": () => [{ id: 1, name: "Any" }],
        "GET /rootfolder": () => [{ path: "/movies" }],
    });
    const { version, problems } = await radarr.verify();
    assert.equal(version, "5.0.0");
    assert.equal(problems.length, 2);
    assert.match(problems[0], /Available: 1 \(Any\)/);
    assert.match(problems[1], /Available: \/movies/);
});
