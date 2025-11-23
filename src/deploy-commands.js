import { REST, Routes } from "discord.js";
import dotenv from "dotenv";
import { data as requestData } from "./commands/request.js";
dotenv.config();

const commands = [requestData.toJSON()];
const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

const clientId = process.env.DISCORD_CLIENT_ID;

(async () => {
    try {
        console.log("Started refreshing application (/) commands globally.");
        await rest.put(Routes.applicationCommands(clientId), {
            body: commands,
        });
        console.log("Successfully reloaded global application (/) commands.");
    } catch (error) {
        console.error(error);
    }
})();
