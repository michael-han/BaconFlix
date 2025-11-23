import { Client, GatewayIntentBits } from "discord.js";
import dotenv from "dotenv";
import commands, { getHandlerForInteraction } from "./commands/index.js";
dotenv.config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("clientReady", () => {
    console.log(`Logged in as ${client.user?.tag}`);
});

client.on("interactionCreate", async (interaction) => {
    const handler = getHandlerForInteraction(interaction);
    if (!handler) return;
    try {
        await handler(interaction);
    } catch (error) {
        console.error(error);
        // Only reply if not already responded
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: "There was an error executing that command.",
                ephemeral: true,
            });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
