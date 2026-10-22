// In-memory sliding window per user. A max of 0 disables rate limiting.
export function createRateLimiter({ max, windowMs, now = Date.now }) {
    const hits = new Map();

    return {
        hit(userId) {
            if (max === 0) return { limited: false };
            const time = now();
            const recent = (hits.get(userId) ?? []).filter((ts) => time - ts < windowMs);
            if (recent.length >= max) {
                hits.set(userId, recent);
                return { limited: true, retryAfterMs: windowMs - (time - recent[0]) };
            }
            recent.push(time);
            hits.set(userId, recent);
            return { limited: false };
        },
    };
}
