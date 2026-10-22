import axios from "axios";
import https from "node:https";

const UNREACHABLE_CODES = ["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ECONNRESET", "EAI_AGAIN"];
const TIMEOUT_CODES = ["ECONNABORTED", "ETIMEDOUT"];
const TLS_CODES = [
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    "CERT_HAS_EXPIRED",
    "ERR_TLS_CERT_ALTNAME_INVALID",
];

// An error whose message is safe to show to Discord users. The underlying
// HTTP error is kept as `cause` for the logs.
export class RadarrError extends Error {
    constructor(message, { code, status, cause } = {}) {
        super(message, { cause });
        this.name = "RadarrError";
        this.code = code;
        this.status = status;
    }
}

export function toRadarrError(error) {
    if (error instanceof RadarrError) return error;

    const status = error.response?.status;
    if (status === 401 || status === 403) {
        return new RadarrError("Radarr rejected the API key. Check RADARR_API_KEY.", {
            status,
            cause: error,
        });
    }
    if (status === 400) {
        const failures = Array.isArray(error.response.data) ? error.response.data : [];
        const exists = failures.some(
            (f) =>
                f.errorCode === "MovieExistsValidator" ||
                /already been added/i.test(f.errorMessage ?? ""),
        );
        if (exists) {
            return new RadarrError("This movie is already in Radarr.", {
                code: "MOVIE_EXISTS",
                status,
                cause: error,
            });
        }
        const details = failures
            .map((f) => f.errorMessage)
            .filter(Boolean)
            .join(" ");
        return new RadarrError(
            details ? `Radarr rejected the request: ${details}` : "Radarr rejected the request.",
            { status, cause: error },
        );
    }
    if (status) {
        return new RadarrError(`Radarr returned an error (HTTP ${status}).`, {
            status,
            cause: error,
        });
    }
    if (TIMEOUT_CODES.includes(error.code)) {
        return new RadarrError("Radarr took too long to respond.", { cause: error });
    }
    if (UNREACHABLE_CODES.includes(error.code)) {
        return new RadarrError("Radarr is unreachable right now.", { cause: error });
    }
    if (TLS_CODES.includes(error.code)) {
        return new RadarrError(
            "Radarr's TLS certificate couldn't be verified. Set INSECURE_TLS=true if it's self-signed.",
            { cause: error },
        );
    }
    return new RadarrError("Something went wrong talking to Radarr.", { cause: error });
}

// Radarr may report folder paths with or without a trailing slash.
function samePath(a, b) {
    const normalize = (p) => (p.length > 1 ? p.replace(/\/+$/, "") : p);
    return normalize(a) === normalize(b);
}

export function createRadarrClient({
    url,
    apiKey,
    qualityProfileId,
    rootFolderPath,
    timeoutMs = 15000,
    insecureTls = false,
    http,
}) {
    const client =
        http ??
        axios.create({
            baseURL: `${url}/api/v3`,
            timeout: timeoutMs,
            headers: { "X-Api-Key": apiKey },
            httpsAgent: url.startsWith("https")
                ? new https.Agent({ rejectUnauthorized: !insecureTls })
                : undefined,
        });

    async function call(method, path, args) {
        try {
            const response = await client[method](path, ...args);
            return response.data;
        } catch (error) {
            throw toRadarrError(error);
        }
    }
    const get = (path, params) => call("get", path, [{ params }]);
    const post = (path, body) => call("post", path, [body]);

    // `term` can be a title, "tmdb:<id>", or "imdb:<id>".
    async function lookup(term) {
        return (await get("/movie/lookup", { term })) ?? [];
    }

    async function findByTmdbId(tmdbId) {
        const results = await lookup(`tmdb:${tmdbId}`);
        return results.find((m) => String(m.tmdbId) === String(tmdbId)) ?? null;
    }

    async function isInLibrary(tmdbId) {
        const movies = await get("/movie", { tmdbId });
        return movies.some((m) => String(m.tmdbId) === String(tmdbId));
    }

    async function addMovie(movie) {
        return post("/movie", {
            tmdbId: movie.tmdbId,
            title: movie.title,
            year: movie.year,
            qualityProfileId,
            rootFolderPath,
            monitored: true,
            addOptions: { searchForMovie: true },
        });
    }

    // Free bytes on the configured root folder, or null if Radarr can't tell.
    async function getFreeSpace() {
        const folders = await get("/rootfolder");
        const folder = folders.find((f) => samePath(f.path, rootFolderPath));
        if (!folder) {
            throw new RadarrError(
                `The root folder "${rootFolderPath}" isn't set up in Radarr. Check RADARR_ROOT_FOLDER.`,
            );
        }
        return typeof folder.freeSpace === "number" ? folder.freeSpace : null;
    }

    // Checks connectivity and that the configured profile and root folder
    // exist, so misconfiguration shows up in the logs at startup.
    async function verify() {
        const [status, profiles, folders] = await Promise.all([
            get("/system/status"),
            get("/qualityprofile"),
            get("/rootfolder"),
        ]);
        const problems = [];
        if (!profiles.some((p) => p.id === qualityProfileId)) {
            const available = profiles.map((p) => `${p.id} (${p.name})`).join(", ");
            problems.push(
                `RADARR_QUALITY_PROFILE_ID=${qualityProfileId} doesn't exist. Available: ${available}`,
            );
        }
        if (!folders.some((f) => samePath(f.path, rootFolderPath))) {
            const available = folders.map((f) => f.path).join(", ");
            problems.push(
                `RADARR_ROOT_FOLDER="${rootFolderPath}" isn't a Radarr root folder. Available: ${available}`,
            );
        }
        return { version: status.version, problems };
    }

    return { lookup, findByTmdbId, isInLibrary, addMovie, getFreeSpace, verify };
}
