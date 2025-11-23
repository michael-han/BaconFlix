import axios from "axios";
import dotenv from "dotenv";
import https from "https";
dotenv.config();

const RADARR_URL = process.env.RADARR_URL;
const RADARR_API_KEY = process.env.RADARR_API_KEY;

const agent =
    RADARR_URL && RADARR_URL.startsWith("https")
        ? new https.Agent({ rejectUnauthorized: false })
        : undefined;

export async function searchMovie(query) {
    const response = await axios.get(
        `${RADARR_URL}/api/v3/movie/lookup?term=${encodeURIComponent(query)}`,
        {
            headers: { "X-Api-Key": RADARR_API_KEY },
            httpsAgent: agent,
        },
    );
    return response.data;
}

export async function addMovie(movie) {
    const response = await axios.post(`${RADARR_URL}/api/v3/movie`, movie, {
        headers: { "X-Api-Key": RADARR_API_KEY },
        httpsAgent: agent,
    });
    return response.data;
}

export async function getExistingMovies() {
    const response = await axios.get(`${RADARR_URL}/api/v3/movie`, {
        headers: { "X-Api-Key": RADARR_API_KEY },
        httpsAgent: agent,
    });
    return response.data;
}

export async function getDiskSpace() {
    const response = await axios.get(`${RADARR_URL}/api/v3/diskspace`, {
        headers: { "X-Api-Key": RADARR_API_KEY },
        httpsAgent: agent,
    });
    // Return the first disk (or sum if you want to aggregate)
    if (response.data && response.data.length > 0) {
        return response.data[0];
    }
    return null;
}
