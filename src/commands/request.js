import {
    SlashCommandBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    InteractionContextType,
    MessageFlags,
} from "discord.js";
import { RadarrError } from "../radarr.js";
import { checkPermission } from "../utils/permissions.js";

const MAX_QUERY_LENGTH = 200;
const MAX_SELECT_OPTIONS = 10;

export const CUSTOM_IDS = {
    select: "request:select",
    confirmPrefix: "request:confirm:",
};

export const data = new SlashCommandBuilder()
    .setName("request")
    .setDescription("Request a movie to be added to the server.")
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
        option
            .setName("query")
            .setDescription("Movie name, TMDB ID (tmdb:1234), or IMDb ID (imdb:tt1234567)")
            .setRequired(true)
            .setMaxLength(MAX_QUERY_LENGTH),
    );

function truncate(text, max) {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function formatTitle(movie) {
    return movie.year ? `${movie.title} (${movie.year})` : movie.title;
}

function formatBytes(bytes) {
    const tib = bytes / 1024 ** 4;
    return tib >= 1 ? `${tib.toFixed(1)} TB` : `${Math.round(bytes / 1024 ** 3)} GB`;
}

function posterUrl(movie) {
    return (
        movie.remotePoster ?? movie.images?.find((i) => i.coverType === "poster")?.remoteUrl ?? null
    );
}

function messageEmbed(title, description, color = "Red") {
    return new EmbedBuilder().setTitle(title).setDescription(description).setColor(color);
}

function buildMovieEmbed(movie, status, requester) {
    const embed = new EmbedBuilder()
        .setTitle(truncate(formatTitle(movie), 256))
        .setURL(`https://www.themoviedb.org/movie/${movie.tmdbId}`);
    const poster = posterUrl(movie);
    if (poster) embed.setThumbnail(poster);

    if (status === "select") {
        embed
            .setDescription(truncate(movie.overview || "No description.", 1000))
            .setColor("Blurple");
    } else if (status === "exists") {
        embed.setDescription("This movie is already on the server.").setColor("Green");
    } else if (status === "added") {
        embed.setDescription("Requested and added to Radarr!").setColor("Blue");
    } else if (status === "announce") {
        embed
            .setDescription(`Requested by <@${requester.id}>. It'll show up once it's downloaded.`)
            .setColor("Blue");
    }
    return embed;
}

function confirmRow(movie) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${CUSTOM_IDS.confirmPrefix}${movie.tmdbId}`)
            .setLabel("Confirm Request")
            .setStyle(ButtonStyle.Primary),
    );
}

function selectRow(results) {
    // Select menu values must be unique.
    const unique = new Map(results.filter((m) => m.tmdbId).map((m) => [m.tmdbId, m]));
    const options = [...unique.values()].slice(0, MAX_SELECT_OPTIONS).map((movie) =>
        new StringSelectMenuOptionBuilder()
            .setLabel(truncate(formatTitle(movie), 100))
            .setDescription(truncate(movie.overview || "No description.", 100))
            .setValue(String(movie.tmdbId)),
    );
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(CUSTOM_IDS.select)
            .setPlaceholder("Select the correct movie")
            .addOptions(options),
    );
}

export function createRequestHandlers({ radarr, rateLimiter, access, minFreeBytes, logger }) {
    function requestLogger(interaction) {
        return logger.child({
            userId: interaction.user.id,
            username: interaction.user.username,
            guildId: interaction.guildId,
        });
    }

    async function showError(interaction, error, log) {
        log.error({ event: "request.failed", err: error }, "Request failed");
        const message =
            error instanceof RadarrError
                ? error.message
                : "Something went wrong. The error has been logged.";
        await interaction.editReply({
            content: "",
            embeds: [messageEmbed("Request failed", message)],
            components: [],
        });
    }

    // Shows the movie with a confirm button, or says it's already there.
    async function confirmationReply(movie, log) {
        if (await radarr.isInLibrary(movie.tmdbId)) {
            log.info({ event: "request.exists", tmdbId: movie.tmdbId, title: movie.title });
            return { content: "", embeds: [buildMovieEmbed(movie, "exists")], components: [] };
        }
        return {
            content: "",
            embeds: [buildMovieEmbed(movie, "select")],
            components: [confirmRow(movie)],
        };
    }

    async function execute(interaction) {
        const log = requestLogger(interaction);

        const permission = checkPermission(interaction, access);
        if (!permission.ok) {
            log.info({ event: "request.denied", reason: permission.reason });
            await interaction.reply({
                embeds: [messageEmbed("Not allowed", permission.reason)],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const query = interaction.options.getString("query", true).trim();
        if (!query) {
            await interaction.reply({
                embeds: [messageEmbed("Empty search", "Enter a movie name or ID to search for.")],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const limit = rateLimiter.hit(interaction.user.id);
        if (limit.limited) {
            const minutes = Math.max(1, Math.ceil(limit.retryAfterMs / 60000));
            log.info({ event: "request.rate_limited" });
            await interaction.reply({
                embeds: [
                    messageEmbed(
                        "Slow down",
                        `You're making requests too quickly. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
                    ),
                ],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        // Everything from here is only visible to the requester; the channel
        // gets a public announcement once a movie is actually added.
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            if (minFreeBytes > 0) {
                const freeSpace = await radarr.getFreeSpace();
                if (freeSpace !== null && freeSpace < minFreeBytes) {
                    log.warn({ event: "request.low_disk", freeSpace, minFreeBytes });
                    await interaction.editReply({
                        embeds: [
                            messageEmbed(
                                "Low disk space",
                                `Only ${formatBytes(freeSpace)} free (minimum is ${formatBytes(minFreeBytes)}). ` +
                                    "Requests are paused until space is freed up.",
                            ),
                        ],
                    });
                    return;
                }
            }

            const results = await radarr.lookup(query);
            log.info({ event: "request.searched", query, results: results.length });

            if (results.length === 0) {
                await interaction.editReply({
                    embeds: [messageEmbed("No results", `Nothing found for "${query}".`)],
                });
                return;
            }
            if (results.length === 1) {
                await interaction.editReply(await confirmationReply(results[0], log));
                return;
            }
            await interaction.editReply({
                content: "Multiple results found. Pick the right one:",
                components: [selectRow(results)],
            });
        } catch (error) {
            await showError(interaction, error, log);
        }
    }

    async function handleSelect(interaction) {
        const log = requestLogger(interaction);
        await interaction.deferUpdate();
        try {
            const movie = await radarr.findByTmdbId(interaction.values[0]);
            if (!movie) {
                await interaction.editReply({
                    content: "",
                    embeds: [messageEmbed("Movie not found", "Radarr couldn't find that movie.")],
                    components: [],
                });
                return;
            }
            await interaction.editReply(await confirmationReply(movie, log));
        } catch (error) {
            await showError(interaction, error, log);
        }
    }

    async function handleConfirm(interaction) {
        const log = requestLogger(interaction);
        await interaction.deferUpdate();
        const tmdbId = interaction.customId.slice(CUSTOM_IDS.confirmPrefix.length);
        let movie;
        try {
            movie = await radarr.findByTmdbId(tmdbId);
            if (!movie) {
                await interaction.editReply({
                    embeds: [messageEmbed("Movie not found", "Radarr couldn't find that movie.")],
                    components: [],
                });
                return;
            }
            await radarr.addMovie(movie);
        } catch (error) {
            // Someone else added it between the check and the confirm.
            if (error instanceof RadarrError && error.code === "MOVIE_EXISTS") {
                log.info({ event: "request.exists", tmdbId, title: movie?.title });
                await interaction.editReply({
                    embeds: [buildMovieEmbed(movie, "exists")],
                    components: [],
                });
                return;
            }
            await showError(interaction, error, log);
            return;
        }

        log.info({
            event: "request.added",
            tmdbId: movie.tmdbId,
            title: movie.title,
            year: movie.year,
        });
        await interaction.editReply({ embeds: [buildMovieEmbed(movie, "added")], components: [] });
        try {
            await interaction.followUp({
                embeds: [buildMovieEmbed(movie, "announce", interaction.user)],
                allowedMentions: { parse: [] },
            });
        } catch (error) {
            log.warn({ err: error }, "Couldn't post the public request announcement");
        }
    }

    return { execute, handleSelect, handleConfirm };
}
