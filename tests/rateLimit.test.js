import { test } from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter } from "../src/utils/rateLimit.js";

function limiterAt(start, options) {
    let time = start;
    const limiter = createRateLimiter({ ...options, now: () => time });
    return { limiter, advance: (ms) => (time += ms) };
}

test("allows up to max hits per window, then blocks", () => {
    const { limiter } = limiterAt(0, { max: 2, windowMs: 1000 });
    assert.equal(limiter.hit("a").limited, false);
    assert.equal(limiter.hit("a").limited, false);
    assert.equal(limiter.hit("a").limited, true);
});

test("tracks users independently", () => {
    const { limiter } = limiterAt(0, { max: 1, windowMs: 1000 });
    assert.equal(limiter.hit("a").limited, false);
    assert.equal(limiter.hit("b").limited, false);
});

test("frees up once the oldest hit leaves the window", () => {
    const { limiter, advance } = limiterAt(0, { max: 1, windowMs: 1000 });
    limiter.hit("a");
    advance(400);
    assert.deepEqual(limiter.hit("a"), { limited: true, retryAfterMs: 600 });
    advance(600);
    assert.equal(limiter.hit("a").limited, false);
});

test("max of 0 disables limiting", () => {
    const { limiter } = limiterAt(0, { max: 0, windowMs: 1000 });
    for (let i = 0; i < 10; i++) assert.equal(limiter.hit("a").limited, false);
});
