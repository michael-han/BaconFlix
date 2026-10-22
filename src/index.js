import { Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";
import { ConfigError, loadConfig, loadEnvFile } from "./config.js";
import { createLogger } from "./logger.js";
import { createRadarrClient } from "./radarr.js";
import { createRateLimiter } from "./utils/rateLimit.js";
import { createInteractionRouter } from "./commands/index.js";

let config;
try {
    loadEnvFile();
    config = loadConfig(process.env);
} catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(error.message);
    process.exit(1);
}

const logger = createLogger(config.logLevel);
const radarr = createRadarrClient({ ...config.radarr, ...config.http });
if (config.http.insecureTls) {
    logger.warn("INSECURE_TLS is enabled: Radarr's TLS certificate will not be verified");
}

const getHandlerForInteraction = createInteractionRouter({
    radarr,
    rateLimiter: createRateLimiter(config.rateLimit),
    access: config.access,
    minFreeBytes: config.diskSpaceMinBytes,
    logger,
});

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (readyClient) => {
    logger.info({ guilds: readyClient.guilds.cache.size }, `Logged in as ${readyClient.user.tag}`);
    try {
        const { version, problems } = await radarr.verify();
        logger.info(`Connected to Radarr ${version}`);
        for (const problem of problems) logger.warn(problem);
    } catch (error) {
        logger.warn({ err: error }, `Radarr check failed: ${error.message}`);
    }
});

client.on(Events.InteractionCreate, async (interaction) => {
    const handler = getHandlerForInteraction(interaction);
    if (!handler) {
        // Buttons and menus from older versions of the bot, or from a
        // previous session's messages.
        if (interaction.isMessageComponent()) {
            await interaction
                .reply({
                    content: "This request has expired. Run `/request` again.",
                    flags: MessageFlags.Ephemeral,
                })
                .catch(() => {});
        }
        return;
    }
    try {
        await handler(interaction);
    } catch (error) {
        logger.error({ err: error }, "Unhandled error while handling an interaction");
        const response = {
            content: "There was an error handling that. It's been logged.",
            embeds: [],
            components: [],
        };
        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(response);
            } else {
                await interaction.reply({ ...response, flags: MessageFlags.Ephemeral });
            }
        } catch {
            // The interaction may have expired; nothing more to do.
        }
    }
});

client.on(Events.Error, (error) => logger.error({ err: error }, "Discord client error"));

process.on("unhandledRejection", (error) => {
    logger.error({ err: error }, "Unhandled promise rejection");
});

async function shutdown(signal) {
    logger.info(`Received ${signal}, shutting down`);
    await client.destroy();
    process.exit(0);
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

client.login(config.discord.token).catch((error) => {
    const message =
        error.code === "TokenInvalid"
            ? "Discord rejected the bot token. Check DISCORD_TOKEN."
            : "Couldn't connect to Discord.";
    logger.fatal({ err: error }, message);
    process.exit(1);
});
