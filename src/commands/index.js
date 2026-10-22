import * as request from "./request.js";

export const commandData = [request.data.toJSON()];

export function createInteractionRouter(deps) {
    const requestHandlers = request.createRequestHandlers(deps);

    return function getHandlerForInteraction(interaction) {
        if (interaction.isChatInputCommand() && interaction.commandName === request.data.name) {
            return requestHandlers.execute;
        }
        if (
            interaction.isStringSelectMenu() &&
            interaction.customId === request.CUSTOM_IDS.select
        ) {
            return requestHandlers.handleSelect;
        }
        if (
            interaction.isButton() &&
            interaction.customId.startsWith(request.CUSTOM_IDS.confirmPrefix)
        ) {
            return requestHandlers.handleConfirm;
        }
        return null;
    };
}
