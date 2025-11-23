const RATE_LIMIT = {};
const RATE_LIMIT_WINDOW = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT_MAX = 3;

export function isRateLimited(userId) {
    const now = Date.now();
    if (!RATE_LIMIT[userId]) RATE_LIMIT[userId] = [];
    RATE_LIMIT[userId] = RATE_LIMIT[userId].filter(
        (ts) => now - ts < RATE_LIMIT_WINDOW,
    );
    if (RATE_LIMIT[userId].length >= RATE_LIMIT_MAX) return true;
    RATE_LIMIT[userId].push(now);
    return false;
}
