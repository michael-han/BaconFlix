import {
    SlashCommandBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
} from "discord.js";
import { searchRadarr, addMovieToRadarr, isAlreadyAdded } from "../utils/radarrHelpers.js";
import { isRateLimited } from "../utils/rateLimit.js";
import { checkDiskSpace } from "../utils/diskSpace.js";

const DEFAULT_QUALITY_PROFILE_ID = 8;
const DEFAULT_ROOT_FOLDER_PATH = "/data/media/movies";

function buildMovieEmbed(movie, status) {
    const embed = new EmbedBuilder()
        .setTitle(`${movie.title} (${movie.year})`)
        .setThumbnail(movie.remotePoster)
        .setColor(status === "added" ? "Blue" : status === "exists" ? "Green" : "Red");
    if (status === "added") {
        embed.setDescription("Requested and added to Radarr!");
    } else if (status === "exists") {
        embed.setDescription("This movie is already available on your NAS.");
    } else if (status === "select") {
        embed.setDescription(movie.overview || "No description.");
    } else if (status === "error") {
        embed.setDescription(movie.error || "Error occurred.");
    }
    return embed;
}

export const data = new SlashCommandBuilder()
    .setName("request")
    .setDescription(
        'Request a movie or TV show to be added to the NAS.'
    )
    .addStringOption((option) =>
        option
            .setName("query")
            .setDescription(
                "Name, TMDB ID (tmdb:xxxx), or IMDB ID (imdb:xxxx)"
            )
            .setRequired(true)
    );

export async function execute(interaction) {
    const userId = interaction.user.id;
    if (isRateLimited(userId)) {
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content:
                    "You are making requests too quickly. Please wait before trying again.",
                flags: 64, // Ephemeral
            });
        }
        return;
    }
    const query = interaction.options.getString("query", true);
    await interaction.deferReply();
    try {
        // Check disk space
        const hasSpace = await checkDiskSpace();
        if (!hasSpace) {
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle("Low Disk Space")
                        .setDescription("Warning: Less than 1TB free on NAS.")
                        .setColor("Red"),
                ],
            });
            return;
        }
        const results = await searchRadarr(query);
        if (!results || results.length === 0) {
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle("No Results")
                        .setDescription("No results found for your query.")
                        .setColor("Red"),
                ],
            });
            return;
        }
        // If only one result, show confirmation button
        if (results.length === 1) {
            const movie = results[0];
            // Check if already exists
            const alreadyAdded = await isAlreadyAdded(movie.tmdbId);
            if (alreadyAdded) {
                await interaction.editReply({
                    embeds: [buildMovieEmbed(movie, "exists")],
                });
                return;
            }
            const confirmButton = new ButtonBuilder()
                .setCustomId(`confirm_${movie.tmdbId}`)
                .setLabel("Confirm Add")
                .setStyle(ButtonStyle.Primary);
            const row = new ActionRowBuilder().addComponents(confirmButton);
            await interaction.editReply({
                embeds: [buildMovieEmbed(movie, "select")],
                components: [row],
            });
            return;
        }
        // More than one result: show select menu
        const options = results.slice(0, 10).map((movie) =>
            new StringSelectMenuOptionBuilder()
                .setLabel(`${movie.title} (${movie.year})`)
                .setDescription(
                    movie.overview
                        ? movie.overview.substring(0, 100)
                        : "No description",
                )
                .setValue(String(movie.tmdbId))
        );
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId("movie_select")
            .setPlaceholder("Select the correct movie")
            .addOptions(options);
        const row = new ActionRowBuilder().addComponents(selectMenu);
        await interaction.editReply({
            content: "Multiple results found. Please select:",
            components: [row],
        });
    } catch (error) {
        console.log(error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle("Error")
                        .setDescription(error.message)
                        .setColor("Red"),
                ],
                flags: 64, // Ephemeral
            });
        } else {
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle("Error")
                        .setDescription(error.message)
                        .setColor("Red"),
                ],
            });
        }
    }
}

export async function handleSelect(interaction) {
    await interaction.deferUpdate();
    const selectedTmdbId = interaction.values[0];
    try {
        const results = await searchRadarr(`tmdb:${selectedTmdbId}`);
        const movie = results.find((m) => String(m.tmdbId) === selectedTmdbId);
        let embed;
        if (!movie) {
            embed = new EmbedBuilder()
                .setTitle("Movie not found")
                .setColor("Red");
            await interaction.editReply({ embeds: [embed], components: [] });
            return;
        }
        // Check if already exists
        const alreadyAdded = await isAlreadyAdded(movie.tmdbId);
        if (alreadyAdded) {
            await interaction.editReply({ embeds: [buildMovieEmbed(movie, "exists")], components: [] });
            return;
        }
        const confirmButton = new ButtonBuilder()
            .setCustomId(`confirm_${movie.tmdbId}`)
            .setLabel("Confirm Add")
            .setStyle(ButtonStyle.Primary);
        const row = new ActionRowBuilder().addComponents(confirmButton);
        await interaction.editReply({
            embeds: [buildMovieEmbed(movie, "select")],
            components: [row],
        });
    } catch (error) {
        console.log(error);
        await interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setTitle("Error")
                    .setDescription(error.message)
                    .setColor("Red"),
            ],
            components: [],
        });
    }
}

export async function handleConfirm(interaction) {
    await interaction.deferUpdate();
    const tmdbId = interaction.customId.replace("confirm_", "");
    let embed;
    try {
        const results = await searchRadarr(`tmdb:${tmdbId}`);
        const movie = results.find((m) => String(m.tmdbId) === tmdbId);
        if (!movie) {
            embed = new EmbedBuilder()
                .setTitle("Movie not found")
                .setColor("Red");
        } else {
            // No need to check alreadyAdded here, only add
            const payload = {
                tmdbId: movie.tmdbId,
                title: movie.title,
                year: movie.year,
                qualityProfileId: DEFAULT_QUALITY_PROFILE_ID,
                rootFolderPath: DEFAULT_ROOT_FOLDER_PATH,
                monitored: true,
                addOptions: { searchForMovie: true },
            };
            await addMovieToRadarr(payload);
            embed = buildMovieEmbed(movie, "added");
        }
    } catch (error) {
        console.log(error);
        embed = new EmbedBuilder()
            .setTitle("Error")
            .setDescription(error.message)
            .setColor("Red");
    }
    await interaction.editReply({
        embeds: [embed],
        components: [],
    });
}
