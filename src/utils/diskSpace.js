import { getDiskSpace as radarrDiskSpace } from "../radarr.js";

export async function checkDiskSpace(
    minFreeBytes = 1 * 1024 * 1024 * 1024 * 1024,
) {
    const diskSpace = await radarrDiskSpace();
    if (diskSpace && diskSpace.freeSpace < minFreeBytes) {
        return false;
    }
    return true;
}
