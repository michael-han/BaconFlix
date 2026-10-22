const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"];
const GIB = 1024 ** 3;

export class ConfigError extends Error {
    constructor(problems) {
        super(
            `Invalid configuration:\n  - ${problems.join("\n  - ")}\n` +
                "See .env.example for every supported variable.",
        );
        this.name = "ConfigError";
        this.problems = problems;
    }
}

// Loads ./.env into process.env when present. Variables already set in the
// environment (e.g. by Docker) take precedence over the file.
export function loadEnvFile(path = ".env") {
    try {
        process.loadEnvFile(path);
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }
}

export function loadConfig(env, { requireRadarr = true } = {}) {
    const problems = [];
    const read = (name) => env[name]?.trim() || undefined;

    const required = (name) => {
        const value = read(name);
        if (!value) problems.push(`${name} is required`);
        return value;
    };

    const integer = (name, fallback) => {
        const raw = read(name);
        if (raw === undefined) return fallback;
        const value = Number(raw);
        if (!Number.isInteger(value) || value < 0) {
            problems.push(`${name} must be a whole number (got "${raw}")`);
            return fallback;
        }
        return value;
    };

    const boolean = (name, fallback) => {
        const raw = read(name);
        if (raw === undefined) return fallback;
        if (/^(true|1|yes)$/i.test(raw)) return true;
        if (/^(false|0|no)$/i.test(raw)) return false;
        problems.push(`${name} must be true or false (got "${raw}")`);
        return fallback;
    };

    const idList = (name) => {
        const ids = (read(name) ?? "")
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean);
        const invalid = ids.filter((id) => !/^\d+$/.test(id));
        if (invalid.length > 0) {
            problems.push(
                `${name} must be a comma-separated list of Discord IDs (invalid: ${invalid.join(", ")})`,
            );
        }
        return ids;
    };

    const httpUrl = (name) => {
        const raw = required(name);
        if (!raw) return undefined;
        try {
            const url = new URL(raw);
            if (url.protocol !== "http:" && url.protocol !== "https:") {
                throw new Error("unsupported protocol");
            }
        } catch {
            problems.push(
                `${name} must be an http(s) URL like http://localhost:7878 (got "${raw}")`,
            );
        }
        return raw.replace(/\/+$/, "");
    };

    const logLevelSetting = () => {
        const level = read("LOG_LEVEL") ?? "info";
        if (!LOG_LEVELS.includes(level)) {
            problems.push(`LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")} (got "${level}")`);
        }
        return level;
    };

    const config = {
        discord: {
            token: required("DISCORD_TOKEN"),
            clientId: required("DISCORD_CLIENT_ID"),
            guildId: read("DISCORD_GUILD_ID"),
        },
        access: {
            allowedGuildIds: idList("ALLOWED_GUILD_IDS"),
            allowedRoleIds: idList("ALLOWED_ROLE_IDS"),
        },
        radarr: requireRadarr
            ? {
                  url: httpUrl("RADARR_URL"),
                  apiKey: required("RADARR_API_KEY"),
                  qualityProfileId: integer("RADARR_QUALITY_PROFILE_ID", 1),
                  rootFolderPath: read("RADARR_ROOT_FOLDER") ?? "/movies",
              }
            : null,
        rateLimit: {
            max: integer("RATE_LIMIT_MAX", 3),
            windowMs: integer("RATE_LIMIT_WINDOW_MINUTES", 10) * 60 * 1000,
        },
        diskSpaceMinBytes: integer("DISK_SPACE_MIN_GB", 1024) * GIB,
        http: {
            timeoutMs: integer("HTTP_TIMEOUT_MS", 15000),
            insecureTls: boolean("INSECURE_TLS", false),
        },
        logLevel: logLevelSetting(),
    };

    if (problems.length > 0) throw new ConfigError(problems);
    return deepFreeze(config);
}

function deepFreeze(value) {
    if (value && typeof value === "object") {
        Object.values(value).forEach(deepFreeze);
        Object.freeze(value);
    }
    return value;
}
