import * as request from "./request.js";

const commands = {
    request,
};

export default commands;

export function getHandlerForInteraction(interaction) {
    if (
        interaction.isStringSelectMenu() &&
        interaction.customId === "movie_select"
    ) {
        return request.handleSelect;
    }
    if (interaction.isButton() && interaction.customId.startsWith("confirm_")) {
        return request.handleConfirm;
    }
    if (interaction.isChatInputCommand() && commands[interaction.commandName]) {
        return commands[interaction.commandName].execute;
    }
    return null;
}
