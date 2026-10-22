import { REST, Routes } from "discord.js";
import { ConfigError, loadConfig, loadEnvFile } from "./config.js";
import { commandData } from "./commands/index.js";

let config;
try {
    loadEnvFile();
    config = loadConfig(process.env, { requireRadarr: false });
} catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(error.message);
    process.exit(1);
}

const { token, clientId, guildId } = config.discord;
const rest = new REST({ version: "10" }).setToken(token);

// Guild commands update instantly; global ones can take a while to appear.
const route = guildId
    ? Routes.applicationGuildCommands(clientId, guildId)
    : Routes.applicationCommands(clientId);
const scope = guildId ? `guild ${guildId}` : "globally";

try {
    console.log(`Registering ${commandData.length} command(s) ${scope}...`);
    await rest.put(route, { body: commandData });
    console.log(`Registered ${commandData.map((c) => `/${c.name}`).join(", ")} ${scope}.`);
} catch (error) {
    console.error("Failed to register commands:", error.message ?? error);
    process.exit(1);
}
