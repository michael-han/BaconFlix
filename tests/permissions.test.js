import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPermission } from "../src/utils/permissions.js";

const open = { allowedGuildIds: [], allowedRoleIds: [] };

function interaction({ guildId = "g1", roles = [] } = {}) {
    return { guildId, member: { roles: { cache: new Map(roles.map((id) => [id, {}])) } } };
}

test("allows everyone when no allowlists are set", () => {
    assert.deepEqual(checkPermission(interaction(), open), { ok: true });
});

test("enforces the guild allowlist", () => {
    const access = { ...open, allowedGuildIds: ["g2"] };
    assert.equal(checkPermission(interaction({ guildId: "g1" }), access).ok, false);
    assert.equal(checkPermission(interaction({ guildId: "g2" }), access).ok, true);
});

test("enforces the role allowlist", () => {
    const access = { ...open, allowedRoleIds: ["r1", "r2"] };
    assert.equal(checkPermission(interaction({ roles: ["r3"] }), access).ok, false);
    assert.equal(checkPermission(interaction({ roles: ["r3", "r2"] }), access).ok, true);
});

test("handles uncached members whose roles are a plain ID array", () => {
    const access = { ...open, allowedRoleIds: ["r1"] };
    assert.equal(checkPermission({ guildId: "g1", member: { roles: ["r1"] } }, access).ok, true);
    assert.equal(checkPermission({ guildId: "g1", member: null }, access).ok, false);
});
