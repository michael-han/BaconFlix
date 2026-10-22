// Empty allowlists mean "allow everyone".
export function checkPermission(interaction, { allowedGuildIds, allowedRoleIds }) {
    if (allowedGuildIds.length > 0 && !allowedGuildIds.includes(interaction.guildId)) {
        return { ok: false, reason: "Requests aren't enabled on this server." };
    }
    if (allowedRoleIds.length === 0) return { ok: true };

    // A cached member exposes a role manager; an uncached one is a raw API
    // object whose `roles` is an array of IDs.
    const roles = interaction.member?.roles;
    const roleIds = Array.isArray(roles) ? roles : [...(roles?.cache?.keys() ?? [])];
    if (roleIds.some((id) => allowedRoleIds.includes(id))) return { ok: true };

    return { ok: false, reason: "You don't have a role that's allowed to make requests." };
}
