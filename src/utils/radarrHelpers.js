import { getExistingMovies, addMovie, searchMovie } from "../radarr.js";

export async function isAlreadyAdded(tmdbId) {
    const existing = await getExistingMovies();
    return existing.find((m) => m.tmdbId === tmdbId);
}

export async function addMovieToRadarr(movie) {
    return addMovie(movie);
}

export async function searchRadarr(query) {
    return searchMovie(query);
}
