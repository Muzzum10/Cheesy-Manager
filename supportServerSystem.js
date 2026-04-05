"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleInteraction = exports.handleCommand = exports.handleGlobalCommand = void 0;
const discord_js_1 = require("discord.js");
const database_1 = require("./database");
const auditLog_1 = require("./auditLog");
const utils_1 = require("./utils");
const REASON = 'Cheesy Manager support server management';
const CONFIG_DEFAULTS = {
    roleIds: {},
    channelIds: {},
    panelMessageIds: {},
    logChannelIds: {},
    misc: {},
    ticketCounter: 0,
    suggestionCounter: 0,
    bugCounter: 0,
    createdAt: 0,
    updatedAt: 0
};
const ROLE_SPECS = [
    { key: 'owner', name: 'Owner', color: 0xE11D48, hoist: true, mentionable: false, permissions: [discord_js_1.PermissionFlagsBits.Administrator] },
    { key: 'global_admin', name: 'Global Admin', color: 0xDC2626, hoist: true, mentionable: false, permissions: [discord_js_1.PermissionFlagsBits.Administrator] },
    { key: 'admin', name: 'Admin', color: 0xF97316, hoist: true, mentionable: false, permissions: [discord_js_1.PermissionFlagsBits.ViewAuditLog, discord_js_1.PermissionFlagsBits.ManageRoles, discord_js_1.PermissionFlagsBits.ManageChannels, discord_js_1.PermissionFlagsBits.ManageMessages, discord_js_1.PermissionFlagsBits.ManageThreads, discord_js_1.PermissionFlagsBits.KickMembers, discord_js_1.PermissionFlagsBits.BanMembers, discord_js_1.PermissionFlagsBits.ModerateMembers, discord_js_1.PermissionFlagsBits.ManageNicknames, discord_js_1.PermissionFlagsBits.ManageWebhooks, discord_js_1.PermissionFlagsBits.MentionEveryone, discord_js_1.PermissionFlagsBits.MoveMembers, discord_js_1.PermissionFlagsBits.MuteMembers, discord_js_1.PermissionFlagsBits.DeafenMembers, discord_js_1.PermissionFlagsBits.UseApplicationCommands, discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.SendMessages, discord_js_1.PermissionFlagsBits.ReadMessageHistory, discord_js_1.PermissionFlagsBits.EmbedLinks, discord_js_1.PermissionFlagsBits.AttachFiles] },
    { key: 'developer', name: 'Developer', color: 0x8B5CF6, hoist: true, mentionable: false, permissions: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.SendMessages, discord_js_1.PermissionFlagsBits.AttachFiles, discord_js_1.PermissionFlagsBits.EmbedLinks, discord_js_1.PermissionFlagsBits.ReadMessageHistory, discord_js_1.PermissionFlagsBits.ManageThreads] },
    { key: 'moderator', name: 'Moderator', color: 0x0EA5E9, hoist: true, mentionable: false, permissions: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.SendMessages, discord_js_1.PermissionFlagsBits.ReadMessageHistory, discord_js_1.PermissionFlagsBits.AttachFiles, discord_js_1.PermissionFlagsBits.EmbedLinks, discord_js_1.PermissionFlagsBits.ManageMessages, discord_js_1.PermissionFlagsBits.ManageThreads, discord_js_1.PermissionFlagsBits.ModerateMembers, discord_js_1.PermissionFlagsBits.KickMembers, discord_js_1.PermissionFlagsBits.MoveMembers, discord_js_1.PermissionFlagsBits.MuteMembers, discord_js_1.PermissionFlagsBits.DeafenMembers] },
    { key: 'support_team', name: 'Support Team', color: 0x2563EB, hoist: true, mentionable: false, permissions: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.SendMessages, discord_js_1.PermissionFlagsBits.AttachFiles, discord_js_1.PermissionFlagsBits.EmbedLinks, discord_js_1.PermissionFlagsBits.ReadMessageHistory, discord_js_1.PermissionFlagsBits.ManageThreads] },
    { key: 'beta_tester', name: 'Beta Tester', color: 0x10B981, hoist: false, mentionable: true, permissions: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.SendMessages, discord_js_1.PermissionFlagsBits.ReadMessageHistory] },
    { key: 'verified_user', name: 'Verified User', color: 0x22C55E, hoist: false, mentionable: false, permissions: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.SendMessages, discord_js_1.PermissionFlagsBits.ReadMessageHistory, discord_js_1.PermissionFlagsBits.Connect] },
    { key: 'muted', name: 'Muted', color: 0x6B7280, hoist: false, mentionable: false, permissions: [] }
];
const ROLE_ORDER = ROLE_SPECS.map(role => role.key);
const CATEGORY_SPECS = [
    {
        key: 'info',
        name: 'INFO',
        access: 'public_readonly',
        channels: [
            { key: 'welcome', name: 'welcome', type: discord_js_1.ChannelType.GuildText, topic: 'Welcome and what this support server is for.' },
            { key: 'rules', name: 'rules', type: discord_js_1.ChannelType.GuildText, topic: 'Community rules and support etiquette.' },
            { key: 'how_to_get_help', name: 'how-to-get-help', type: discord_js_1.ChannelType.GuildText, topic: 'How to use quick help vs tickets.' },
            { key: 'bot_permissions_guide', name: 'bot-permissions-guide', type: discord_js_1.ChannelType.GuildText, topic: 'Permission expectations when adding the bot to a server.' },
            { key: 'announcements', name: 'announcements', type: discord_js_1.ChannelType.GuildText, topic: 'Official updates and maintenance notices.' },
            { key: 'known_issues', name: 'known-issues', type: discord_js_1.ChannelType.GuildText, topic: 'Current incidents, workarounds, and active issues.' },
            { key: 'changelog', name: 'changelog', type: discord_js_1.ChannelType.GuildText, topic: 'Recent fixes, additions, and behavior changes.' }
        ]
    },
    {
        key: 'community',
        name: 'COMMUNITY',
        access: 'public_chat',
        channels: [
            { key: 'general', name: 'general', type: discord_js_1.ChannelType.GuildText, topic: 'General discussion around the bot and league management.' },
            { key: 'media_and_clips', name: 'media-and-clips', type: discord_js_1.ChannelType.GuildText, topic: 'Screenshots, clips, and visual posts related to your servers.' },
            { key: 'bot_showcase', name: 'bot-showcase', type: discord_js_1.ChannelType.GuildText, topic: 'Show off how you run the bot in your community.' },
            { key: 'memes', name: 'memes', type: discord_js_1.ChannelType.GuildText, topic: 'Keep it light, but keep it respectful.' },
            { key: 'faq', name: 'faq', type: discord_js_1.ChannelType.GuildText, topic: 'Curated answers to common questions.' },
            { key: 'bot_commands', name: 'bot-commands', type: discord_js_1.ChannelType.GuildText, topic: 'Safe public utility commands and quick checks.' },
            { key: 'general_voice', name: 'general-voice', type: discord_js_1.ChannelType.GuildVoice },
            { key: 'support_voice', name: 'support-voice', type: discord_js_1.ChannelType.GuildVoice }
        ]
    },
    {
        key: 'requests',
        name: 'REQUESTS',
        access: 'public_chat',
        channels: [
            { key: 'add_bot_request', name: 'add-bot-request', type: discord_js_1.ChannelType.GuildText, topic: 'High-level guidance for bot addition requests.' },
            { key: 'permission_help', name: 'permission-help', type: discord_js_1.ChannelType.GuildText, topic: 'Ask about missing permissions, channel visibility, or failed commands.' },
            { key: 'setup_help', name: 'setup-help', type: discord_js_1.ChannelType.GuildText, topic: 'Help with initial setup and server configuration.' },
            { key: 'server_config_help', name: 'server-config-help', type: discord_js_1.ChannelType.GuildText, topic: 'Longer-form help for server-specific config issues.' }
        ]
    },
    {
        key: 'support',
        name: 'SUPPORT',
        access: 'public_chat',
        channels: [
            { key: 'open_a_ticket', name: 'open-a-ticket', type: discord_js_1.ChannelType.GuildText, topic: 'Use the managed panel here to open a private support ticket.', access: 'public_readonly' },
            { key: 'ticket_guide', name: 'ticket-guide', type: discord_js_1.ChannelType.GuildText, topic: 'What information to include in each ticket type.', access: 'public_readonly' },
            { key: 'quick_help', name: 'quick-help', type: discord_js_1.ChannelType.GuildText, topic: 'Fast questions that do not need a full private ticket.' }
        ]
    },
    {
        key: 'bugs_feedback',
        name: 'BUGS & FEEDBACK',
        access: 'public_chat',
        channels: [
            { key: 'bug_reports', name: 'bug-reports', type: discord_js_1.ChannelType.GuildText, topic: 'Use `?bug` to file tracked bug reports.' },
            { key: 'error_help', name: 'error-help', type: discord_js_1.ChannelType.GuildText, topic: 'Share command failures, trace text, and screenshots.' },
            { key: 'feature_suggestions', name: 'feature-suggestions', type: discord_js_1.ChannelType.GuildText, topic: 'Use `?suggest` to file tracked feature ideas.' },
            { key: 'votes_and_polls', name: 'votes-and-polls', type: discord_js_1.ChannelType.GuildText, topic: 'Community voting and interest checks.' },
            { key: 'roadmap', name: 'roadmap', type: discord_js_1.ChannelType.GuildText, topic: 'Planned, in-progress, and shipped work.', access: 'public_readonly' }
        ]
    },
    {
        key: 'staff_hq',
        name: 'STAFF HQ',
        access: 'staff_private',
        channels: [
            { key: 'staff_chat', name: 'staff-chat', type: discord_js_1.ChannelType.GuildText, topic: 'Internal operations and handoffs.' },
            { key: 'staff_announcements', name: 'staff-announcements', type: discord_js_1.ChannelType.GuildText, topic: 'Private staff-only update channel.', access: 'staff_readonly' },
            { key: 'ticket_queue', name: 'ticket-queue', type: discord_js_1.ChannelType.GuildText, topic: 'Triage and assignment queue for incoming tickets.' },
            { key: 'staff_notes', name: 'staff-notes', type: discord_js_1.ChannelType.GuildText, topic: 'Internal notes, edge cases, and workflow reminders.' },
            { key: 'escalations', name: 'escalations', type: discord_js_1.ChannelType.GuildText, topic: 'Hard cases requiring admin or developer intervention.' },
            { key: 'staff_faq', name: 'staff-faq', type: discord_js_1.ChannelType.GuildText, topic: 'Internal canned answers and process notes.' },
            { key: 'staff_voice', name: 'staff-voice', type: discord_js_1.ChannelType.GuildVoice }
        ]
    },
    {
        key: 'dev_lab',
        name: 'DEV LAB',
        access: 'dev_private',
        channels: [
            { key: 'bug_triage', name: 'bug-triage', type: discord_js_1.ChannelType.GuildText, topic: 'Deep bug triage and prioritization.' },
            { key: 'reproduction_steps', name: 'reproduction-steps', type: discord_js_1.ChannelType.GuildText, topic: 'Reproduction cases, environments, and failed scenarios.' },
            { key: 'dev_notes', name: 'dev-notes', type: discord_js_1.ChannelType.GuildText, topic: 'Implementation notes and technical follow-up.' },
            { key: 'testing_lab', name: 'testing-lab', type: discord_js_1.ChannelType.GuildText, topic: 'Pre-release verification and test captures.' },
            { key: 'release_checklist', name: 'release-checklist', type: discord_js_1.ChannelType.GuildText, topic: 'Launch gates and rollout status.', access: 'dev_readonly' }
        ]
    },
    {
        key: 'logs',
        name: 'LOGS',
        access: 'logs_private',
        channels: [
            { key: 'audit_logs', name: 'audit-logs', type: discord_js_1.ChannelType.GuildText, topic: 'Dangerous actions, config changes, and setup events.' },
            { key: 'ticket_logs', name: 'ticket-logs', type: discord_js_1.ChannelType.GuildText, topic: 'Ticket lifecycle events and transcripts.' },
            { key: 'mod_logs', name: 'mod-logs', type: discord_js_1.ChannelType.GuildText, topic: 'Moderation events and automod summaries.' },
            { key: 'bot_logs', name: 'bot-logs', type: discord_js_1.ChannelType.GuildText, topic: 'Runtime failures and internal bot notices.' },
            { key: 'join_leave_logs', name: 'join-leave-logs', type: discord_js_1.ChannelType.GuildText, topic: 'Member joins and leaves.' },
            { key: 'message_logs', name: 'message-logs', type: discord_js_1.ChannelType.GuildText, topic: 'Optional manual message log target.' }
        ]
    },
    { key: 'tickets', name: 'TICKETS', access: 'tickets_private', channels: [] },
    {
        key: 'archive',
        name: 'ARCHIVE',
        access: 'archive_private',
        channels: [
            { key: 'closed_tickets', name: 'closed-tickets', type: discord_js_1.ChannelType.GuildText, topic: 'Closed ticket references and summaries.' },
            { key: 'old_transcripts', name: 'old-transcripts', type: discord_js_1.ChannelType.GuildText, topic: 'Saved ticket transcripts.' }
        ]
    }
];
const TICKET_TYPES = {
    add_bot_request: { label: 'Add Bot Request', prefix: 'addbot', buttonLabel: 'Add Bot Request', style: discord_js_1.ButtonStyle.Success, detailPrompt: 'Server name, server ID, approximate member count, why you want the bot, features you need, whether you need permission help, and your main contact.' },
    permission_help: { label: 'Permission Help', prefix: 'permhelp', buttonLabel: 'Permission Help', style: discord_js_1.ButtonStyle.Primary, detailPrompt: 'Server name or ID, which permission problem you have, whether commands are failing, and screenshots or error text if any.' },
    setup_help: { label: 'Setup Help', prefix: 'setup', buttonLabel: 'Setup Help', style: discord_js_1.ButtonStyle.Primary, detailPrompt: 'What you are trying to configure, what is not working, and the steps or screenshots you already tried.' },
    bug_report: { label: 'Bug Report', prefix: 'bug', buttonLabel: 'Bug Report', style: discord_js_1.ButtonStyle.Danger, detailPrompt: 'Bug title, what happened, what should happen, steps to reproduce, command used, screenshots, logs, and any error text.' },
    error_support: { label: 'Error Support', prefix: 'error', buttonLabel: 'Error Support', style: discord_js_1.ButtonStyle.Secondary, detailPrompt: 'What action caused the error, the full error text if possible, a screenshot, server ID, and when it happened.' },
    feature_suggestion: { label: 'Feature Suggestion', prefix: 'feature', buttonLabel: 'Feature Suggestion', style: discord_js_1.ButtonStyle.Success, detailPrompt: 'Feature name, the problem it solves, how it should work, who needs it, and an example use case.' },
    other: { label: 'Other', prefix: 'help', buttonLabel: 'Other', style: discord_js_1.ButtonStyle.Secondary, detailPrompt: 'Give a short description of what you need help with and any context that matters.' }
};
const STAFF_ROLE_KEYS = ['owner', 'global_admin', 'admin', 'developer', 'moderator', 'support_team'];
const DEV_ROLE_KEYS = ['owner', 'global_admin', 'admin', 'developer'];
const LOG_ROLE_KEYS = ['owner', 'global_admin', 'admin'];
const SUGGESTION_STATUSES = new Set(['pending', 'planned', 'in progress', 'added', 'denied']);
const BUG_STATUSES = new Set(['open', 'investigating', 'in progress', 'fixed', 'cannot reproduce', 'closed']);
const BUG_SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);
function nowTs() {
    return Math.floor(Date.now() / 1000);
}
async function safeReply(message, payload) {
    if (!message || typeof message.reply !== 'function') {
        return null;
    }
    try {
        return await message.reply(payload);
    }
    catch (_a) {
        return null;
    }
}
async function deferEphemeralInteraction(interaction) {
    if (!interaction || interaction.deferred || interaction.replied) {
        return;
    }
    await interaction.deferReply({ flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => null);
}
async function respondToInteraction(interaction, payload) {
    if (!interaction) {
        return null;
    }
    if (interaction.deferred) {
        return await interaction.editReply(payload).catch(() => null);
    }
    if (interaction.replied) {
        return await interaction.followUp({ flags: discord_js_1.MessageFlags.Ephemeral, ...payload }).catch(() => null);
    }
    return await interaction.reply({ flags: discord_js_1.MessageFlags.Ephemeral, ...payload }).catch(() => null);
}
async function replyInteractionError(interaction, contextLabel, error) {
    console.error(`${contextLabel} failed:`, error);
    const message = error?.message ? String(error.message) : 'An unexpected support-system error occurred.';
    await respondToInteraction(interaction, { content: message.slice(0, 1900) });
}
function sanitizeTextInputPlaceholder(text, fallback = '') {
    const normalized = String(text || fallback || '').replace(/\s+/g, ' ').trim();
    if (!normalized) {
        return '';
    }
    return normalized.length <= 100 ? normalized : `${normalized.slice(0, 97).trimEnd()}...`;
}
function parseObject(raw) {
    if (!raw)
        return {};
    if (typeof raw === 'object')
        return raw;
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    }
    catch (_a) {
        return {};
    }
}
async function getSupportConfig(guildId) {
    const db = (0, database_1.getDB)();
    const row = await db.get('SELECT * FROM support_server_configs WHERE guild_id = ?', guildId);
    if (!row) {
        return { guildId, ...CONFIG_DEFAULTS };
    }
    return {
        guildId,
        roleIds: parseObject(row.role_ids_json),
        channelIds: parseObject(row.channel_ids_json),
        panelMessageIds: parseObject(row.panel_message_ids_json),
        logChannelIds: parseObject(row.log_channel_ids_json),
        misc: parseObject(row.misc_json),
        ticketCounter: row.ticket_counter || 0,
        suggestionCounter: row.suggestion_counter || 0,
        bugCounter: row.bug_counter || 0,
        createdAt: row.created_at || 0,
        updatedAt: row.updated_at || 0
    };
}
async function saveSupportConfig(config) {
    const db = (0, database_1.getDB)();
    const timestamp = nowTs();
    const createdAt = config.createdAt || timestamp;
    await db.run(`INSERT INTO support_server_configs
        (guild_id, role_ids_json, channel_ids_json, panel_message_ids_json, log_channel_ids_json, misc_json, ticket_counter, suggestion_counter, bug_counter, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET
            role_ids_json = excluded.role_ids_json,
            channel_ids_json = excluded.channel_ids_json,
            panel_message_ids_json = excluded.panel_message_ids_json,
            log_channel_ids_json = excluded.log_channel_ids_json,
            misc_json = excluded.misc_json,
            ticket_counter = excluded.ticket_counter,
            suggestion_counter = excluded.suggestion_counter,
            bug_counter = excluded.bug_counter,
            updated_at = excluded.updated_at`, config.guildId, JSON.stringify(config.roleIds || {}), JSON.stringify(config.channelIds || {}), JSON.stringify(config.panelMessageIds || {}), JSON.stringify(config.logChannelIds || {}), JSON.stringify(config.misc || {}), config.ticketCounter || 0, config.suggestionCounter || 0, config.bugCounter || 0, createdAt, timestamp);
    config.createdAt = createdAt;
    config.updatedAt = timestamp;
    return config;
}
async function incrementCounter(guildId, column) {
    if (!['ticket_counter', 'suggestion_counter', 'bug_counter'].includes(column)) {
        throw new Error(`Unsupported counter: ${column}`);
    }
    const db = (0, database_1.getDB)();
    const timestamp = nowTs();
    let tx = false;
    try {
        await db.run('BEGIN IMMEDIATE TRANSACTION');
        tx = true;
        await db.run(`INSERT OR IGNORE INTO support_server_configs
            (guild_id, role_ids_json, channel_ids_json, panel_message_ids_json, log_channel_ids_json, misc_json, ticket_counter, suggestion_counter, bug_counter, created_at, updated_at)
            VALUES (?, '{}', '{}', '{}', '{}', '{}', 0, 0, 0, ?, ?)`, guildId, timestamp, timestamp);
        const row = await db.get(`SELECT ${column} AS value FROM support_server_configs WHERE guild_id = ?`, guildId);
        const nextValue = (row?.value || 0) + 1;
        await db.run(`UPDATE support_server_configs SET ${column} = ?, updated_at = ? WHERE guild_id = ?`, nextValue, timestamp, guildId);
        await db.run('COMMIT');
        tx = false;
        return nextValue;
    }
    catch (error) {
        if (tx) {
            await db.run('ROLLBACK').catch(() => null);
        }
        throw error;
    }
}
function getRoleSpec(key) {
    return ROLE_SPECS.find(role => role.key === key) || null;
}
function getCategorySpecByKey(key) {
    return CATEGORY_SPECS.find(category => category.key === key) || null;
}
function getChannelSpecByKey(key) {
    for (const category of CATEGORY_SPECS) {
        const channel = category.channels.find(row => row.key === key);
        if (channel) {
            return { ...channel, categoryKey: category.key };
        }
    }
    return null;
}
function resolveTrackedRole(guild, config, key) {
    const trackedId = config.roleIds[key];
    if (trackedId && guild.roles.cache.has(trackedId)) {
        return guild.roles.cache.get(trackedId) || null;
    }
    const spec = getRoleSpec(key);
    if (!spec) {
        return null;
    }
    return guild.roles.cache.find(role => role.name.toLowerCase() === spec.name.toLowerCase()) || null;
}
function resolveTrackedChannel(guild, config, key) {
    const trackedId = config.channelIds[key];
    if (trackedId && guild.channels.cache.has(trackedId)) {
        const tracked = guild.channels.cache.get(trackedId) || null;
        const categorySpec = getCategorySpecByKey(key);
        if (categorySpec) {
            if (tracked?.type === discord_js_1.ChannelType.GuildCategory) {
                return tracked;
            }
        }
        else {
            const channelSpec = getChannelSpecByKey(key);
            if (channelSpec && tracked?.type === channelSpec.type) {
                return tracked;
            }
        }
    }
    const categorySpec = getCategorySpecByKey(key);
    if (categorySpec) {
        return guild.channels.cache.find(channel => channel.type === discord_js_1.ChannelType.GuildCategory && channel.name.toLowerCase() === categorySpec.name.toLowerCase()) || null;
    }
    const channelSpec = getChannelSpecByKey(key);
    if (!channelSpec) {
        return null;
    }
    return guild.channels.cache.find(channel => channel.type === channelSpec.type && channel.name.toLowerCase() === channelSpec.name.toLowerCase()) || null;
}
async function resolveTrackedChannelAsync(guild, config, key) {
    const resolved = resolveTrackedChannel(guild, config, key);
    if (resolved) {
        return resolved;
    }
    const trackedId = config.channelIds?.[key] || config.logChannelIds?.[key];
    if (!trackedId || typeof guild.channels?.fetch !== 'function') {
        return null;
    }
    const fetched = await guild.channels.fetch(trackedId).catch(() => null);
    if (!fetched) {
        return null;
    }
    const categorySpec = getCategorySpecByKey(key);
    if (categorySpec) {
        return fetched.type === discord_js_1.ChannelType.GuildCategory ? fetched : null;
    }
    const channelSpec = getChannelSpecByKey(key);
    if (!channelSpec) {
        return null;
    }
    return fetched.type === channelSpec.type ? fetched : null;
}
function isSendableTextChannel(channel) {
    return Boolean(channel?.isTextBased?.() && typeof channel.send === 'function');
}
function getPermissionName(permissionBit) {
    return Object.entries(discord_js_1.PermissionFlagsBits).find(([, value]) => value === permissionBit)?.[0] || permissionBit.toString();
}
function uniqEntries(entries) {
    const map = new Map();
    for (const entry of entries) {
        if (!entry || !entry.id) {
            continue;
        }
        map.set(String(entry.id), entry);
    }
    return [...map.values()];
}
function buildOverwrites(accessKey, roleIds, everyoneId) {
    const mutedId = roleIds.muted;
    const allowBasics = [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.ReadMessageHistory];
    const allowChat = [...allowBasics, discord_js_1.PermissionFlagsBits.SendMessages, discord_js_1.PermissionFlagsBits.AddReactions, discord_js_1.PermissionFlagsBits.EmbedLinks, discord_js_1.PermissionFlagsBits.AttachFiles];
    const mutedDeny = mutedId ? [{ id: mutedId, deny: [discord_js_1.PermissionFlagsBits.SendMessages, discord_js_1.PermissionFlagsBits.AddReactions, discord_js_1.PermissionFlagsBits.CreatePublicThreads, discord_js_1.PermissionFlagsBits.CreatePrivateThreads, discord_js_1.PermissionFlagsBits.Speak] }] : [];
    const addRoleAllows = (keys, permissions) => keys.map(key => roleIds[key]).filter(Boolean).map(id => ({ id, allow: permissions }));
    if (accessKey === 'public_readonly') {
        return uniqEntries([
            { id: everyoneId, allow: allowBasics, deny: [discord_js_1.PermissionFlagsBits.SendMessages, discord_js_1.PermissionFlagsBits.AddReactions, discord_js_1.PermissionFlagsBits.CreatePublicThreads, discord_js_1.PermissionFlagsBits.CreatePrivateThreads] },
            ...addRoleAllows(STAFF_ROLE_KEYS, [...allowChat, discord_js_1.PermissionFlagsBits.ManageMessages, discord_js_1.PermissionFlagsBits.ManageThreads]),
            ...mutedDeny
        ]);
    }
    if (accessKey === 'staff_readonly') {
        return uniqEntries([
            { id: everyoneId, deny: [discord_js_1.PermissionFlagsBits.ViewChannel] },
            ...addRoleAllows(STAFF_ROLE_KEYS, allowBasics),
            ...addRoleAllows(['owner', 'global_admin', 'admin'], [...allowChat, discord_js_1.PermissionFlagsBits.ManageMessages, discord_js_1.PermissionFlagsBits.ManageThreads]),
            ...mutedDeny
        ]);
    }
    if (accessKey === 'dev_readonly') {
        return uniqEntries([
            { id: everyoneId, deny: [discord_js_1.PermissionFlagsBits.ViewChannel] },
            ...addRoleAllows(DEV_ROLE_KEYS, allowBasics),
            ...addRoleAllows(['owner', 'global_admin', 'admin', 'developer'], [...allowChat, discord_js_1.PermissionFlagsBits.ManageMessages, discord_js_1.PermissionFlagsBits.ManageThreads])
        ]);
    }
    if (accessKey === 'public_chat') {
        return uniqEntries([
            { id: everyoneId, allow: allowChat },
            ...addRoleAllows(STAFF_ROLE_KEYS, [...allowChat, discord_js_1.PermissionFlagsBits.ManageMessages, discord_js_1.PermissionFlagsBits.ManageThreads]),
            ...mutedDeny
        ]);
    }
    if (accessKey === 'staff_private') {
        return uniqEntries([
            { id: everyoneId, deny: [discord_js_1.PermissionFlagsBits.ViewChannel] },
            ...addRoleAllows(STAFF_ROLE_KEYS, [...allowChat, discord_js_1.PermissionFlagsBits.ManageMessages, discord_js_1.PermissionFlagsBits.ManageThreads, discord_js_1.PermissionFlagsBits.Connect, discord_js_1.PermissionFlagsBits.Speak, discord_js_1.PermissionFlagsBits.UseVAD])
        ]);
    }
    if (accessKey === 'dev_private') {
        return uniqEntries([
            { id: everyoneId, deny: [discord_js_1.PermissionFlagsBits.ViewChannel] },
            ...addRoleAllows(DEV_ROLE_KEYS, [...allowChat, discord_js_1.PermissionFlagsBits.ManageMessages, discord_js_1.PermissionFlagsBits.ManageThreads, discord_js_1.PermissionFlagsBits.Connect, discord_js_1.PermissionFlagsBits.Speak, discord_js_1.PermissionFlagsBits.UseVAD])
        ]);
    }
    if (accessKey === 'logs_private') {
        return uniqEntries([
            { id: everyoneId, deny: [discord_js_1.PermissionFlagsBits.ViewChannel] },
            ...addRoleAllows(LOG_ROLE_KEYS, [...allowChat, discord_js_1.PermissionFlagsBits.ManageMessages, discord_js_1.PermissionFlagsBits.ManageThreads])
        ]);
    }
    if (accessKey === 'ticket_logs_channel') {
        return uniqEntries([
            { id: everyoneId, deny: [discord_js_1.PermissionFlagsBits.ViewChannel] },
            ...addRoleAllows(LOG_ROLE_KEYS, [...allowChat, discord_js_1.PermissionFlagsBits.ManageMessages, discord_js_1.PermissionFlagsBits.ManageThreads]),
            ...addRoleAllows(['support_team'], allowBasics)
        ]);
    }
    if (accessKey === 'tickets_private' || accessKey === 'archive_private') {
        return uniqEntries([
            { id: everyoneId, deny: [discord_js_1.PermissionFlagsBits.ViewChannel] },
            ...addRoleAllows(STAFF_ROLE_KEYS, [...allowChat, discord_js_1.PermissionFlagsBits.ManageMessages, discord_js_1.PermissionFlagsBits.ManageThreads])
        ]);
    }
    return uniqEntries([{ id: everyoneId, allow: allowChat }, ...mutedDeny]);
}
async function ensureRole(guild, config, spec) {
    let role = resolveTrackedRole(guild, config, spec.key);
    const desiredPermissions = new discord_js_1.PermissionsBitField(spec.permissions || []);
    let created = false;
    let updated = false;
    if (!role) {
        role = await guild.roles.create({
            name: spec.name,
            colors: { primaryColor: spec.color },
            permissions: desiredPermissions,
            hoist: !!spec.hoist,
            mentionable: !!spec.mentionable,
            reason: REASON
        });
        created = true;
    }
    else {
        const editPayload = {};
        if (role.name !== spec.name)
            editPayload.name = spec.name;
        if (role.color !== spec.color)
            editPayload.colors = { primaryColor: spec.color };
        if (role.hoist !== !!spec.hoist)
            editPayload.hoist = !!spec.hoist;
        if (role.mentionable !== !!spec.mentionable)
            editPayload.mentionable = !!spec.mentionable;
        if (!role.permissions.equals(desiredPermissions))
            editPayload.permissions = desiredPermissions;
        if (Object.keys(editPayload).length) {
            role = await role.edit({ ...editPayload, reason: REASON });
            updated = true;
        }
    }
    config.roleIds[spec.key] = role.id;
    return { role, created, updated };
}
async function ensureCategory(guild, config, spec, roleIds, everyoneId) {
    let category = resolveTrackedChannel(guild, config, spec.key);
    const overwrites = buildOverwrites(spec.access, roleIds, everyoneId);
    let created = false;
    let updated = false;
    if (!category) {
        category = await guild.channels.create({
            name: spec.name,
            type: discord_js_1.ChannelType.GuildCategory,
            permissionOverwrites: overwrites,
            reason: REASON
        });
        created = true;
    }
    else {
        const editPayload = {};
        if (category.name !== spec.name)
            editPayload.name = spec.name;
        if (Object.keys(editPayload).length) {
            category = await category.edit({ ...editPayload, reason: REASON });
            updated = true;
        }
        await category.permissionOverwrites.set(overwrites, REASON);
        updated = true;
    }
    config.channelIds[spec.key] = category.id;
    return { category, created, updated };
}
async function ensureChannel(guild, config, category, categorySpec, channelSpec, roleIds, everyoneId) {
    let channel = resolveTrackedChannel(guild, config, channelSpec.key);
    const accessKey = channelSpec.access || (channelSpec.key === 'ticket_logs' ? 'ticket_logs_channel' : categorySpec.access);
    const overwrites = buildOverwrites(accessKey, roleIds, everyoneId);
    let created = false;
    let updated = false;
    if (!channel) {
        const payload = {
            name: channelSpec.name,
            type: channelSpec.type,
            parent: category.id,
            permissionOverwrites: overwrites,
            reason: REASON
        };
        if (channelSpec.topic && channelSpec.type === discord_js_1.ChannelType.GuildText) {
            payload.topic = channelSpec.topic;
        }
        channel = await guild.channels.create(payload);
        created = true;
    }
    else {
        const editPayload = {};
        if (channel.name !== channelSpec.name)
            editPayload.name = channelSpec.name;
        if (channel.parentId !== category.id)
            editPayload.parent = category.id;
        if (channelSpec.type === discord_js_1.ChannelType.GuildText && channel.topic !== channelSpec.topic)
            editPayload.topic = channelSpec.topic;
        if (Object.keys(editPayload).length) {
            channel = await channel.edit({ ...editPayload, reason: REASON });
            updated = true;
        }
        await channel.permissionOverwrites.set(overwrites, REASON);
        updated = true;
    }
    config.channelIds[channelSpec.key] = channel.id;
    if (['audit_logs', 'ticket_logs', 'mod_logs', 'bot_logs', 'join_leave_logs', 'message_logs'].includes(channelSpec.key)) {
        config.logChannelIds[channelSpec.key] = channel.id;
    }
    return { channel, created, updated };
}
async function reorderRoles(guild, config) {
    const botTop = guild.members.me?.roles?.highest?.position || 1;
    let position = Math.max(1, botTop - 1);
    const updates = [];
    for (const key of ROLE_ORDER) {
        const roleId = config.roleIds[key];
        if (!roleId)
            continue;
        updates.push({ role: roleId, position });
        position = Math.max(1, position - 1);
    }
    if (updates.length) {
        await guild.roles.setPositions(updates).catch(() => null);
    }
}
async function reorderCategoriesAndChannels(guild, config) {
    for (let i = 0; i < CATEGORY_SPECS.length; i++) {
        const category = guild.channels.cache.get(config.channelIds[CATEGORY_SPECS[i].key]);
        if (category?.type === discord_js_1.ChannelType.GuildCategory) {
            await category.setPosition(i).catch(() => null);
        }
        for (let j = 0; j < CATEGORY_SPECS[i].channels.length; j++) {
            const channel = guild.channels.cache.get(config.channelIds[CATEGORY_SPECS[i].channels[j].key]);
            if (channel) {
                await channel.setPosition(j).catch(() => null);
            }
        }
    }
}
async function assignManagedRoles(guild, config) {
    const ownerRole = resolveTrackedRole(guild, config, 'owner');
    const globalAdminRole = resolveTrackedRole(guild, config, 'global_admin');
    let ownerAssigned = false;
    let globalAdminAssigned = 0;
    const owner = await guild.fetchOwner().catch(() => null);
    if (ownerRole && owner?.id && ownerRole.editable && !owner.roles.cache.has(ownerRole.id)) {
        ownerAssigned = await owner.roles.add(ownerRole, REASON).then(() => true).catch(() => false);
    }
    if (globalAdminRole && globalAdminRole.editable) {
        for (const userId of utils_1.ADMIN_USER_IDS) {
            const member = await guild.members.fetch(userId).catch(() => null);
            if (member && !member.roles.cache.has(globalAdminRole.id)) {
                const added = await member.roles.add(globalAdminRole, REASON).then(() => true).catch(() => false);
                if (added)
                    globalAdminAssigned++;
            }
        }
    }
    return { ownerAssigned, globalAdminAssigned };
}
async function sendOrUpdateManagedMessage(channel, existingMessageId, payload) {
    if (!isSendableTextChannel(channel) || !channel.messages?.fetch) {
        return null;
    }
    if (existingMessageId) {
        const existing = await channel.messages.fetch(existingMessageId).catch(() => null);
        if (existing) {
            return existing.edit(payload).catch(() => null);
        }
    }
    return channel.send(payload).catch(() => null);
}
function buildTicketPanelComponents() {
    const ticketEntries = Object.entries(TICKET_TYPES);
    return [
        new discord_js_1.ActionRowBuilder().addComponents(ticketEntries.slice(0, 4).map(([key, row]) => new discord_js_1.ButtonBuilder()
            .setCustomId(`support_open:${key}`)
            .setLabel(row.buttonLabel)
            .setStyle(row.style))),
        new discord_js_1.ActionRowBuilder().addComponents(ticketEntries.slice(4).map(([key, row]) => new discord_js_1.ButtonBuilder()
            .setCustomId(`support_open:${key}`)
            .setLabel(row.buttonLabel)
            .setStyle(row.style)))
    ];
}
function buildStarterPayloads(guild, config) {
    const roleMention = key => config.roleIds[key] ? `<@&${config.roleIds[key]}>` : `\`${getRoleSpec(key)?.name || key}\``;
    return {
        welcome: { embeds: [new discord_js_1.EmbedBuilder().setColor(0x0F766E).setTitle(`Welcome to ${guild.name}`).setDescription('This server exists for bot access requests, setup help, bug reporting, and product feedback. Use the support structure instead of scattering issues across unrelated channels.').addFields({ name: 'What This Server Handles', value: 'Bot invites, permissions, setup help, bug reports, feature suggestions, and tracked support tickets.' }, { name: 'Who To Contact', value: `${roleMention('support_team')} handles most requests. Escalations go to ${roleMention('admin')} or ${roleMention('developer')}.` })] },
        rules: { embeds: [new discord_js_1.EmbedBuilder().setColor(0xB45309).setTitle('Rules').setDescription('Keep reports reproducible, keep requests specific, and keep chat readable.').addFields({ name: 'Support Quality', value: 'Include exact commands, screenshots, error text, timestamps, and server IDs when relevant.' }, { name: 'Behavior', value: 'No spam, harassment, or vague “bot broke” reports without usable context.' }, { name: 'Escalation', value: 'If a case needs staff-only handling, open the correct ticket type instead of arguing in public channels.' })] },
        how_to_get_help: { embeds: [new discord_js_1.EmbedBuilder().setColor(0x2563EB).setTitle('How To Get Help').setDescription('Use the smallest lane that fits the problem.').addFields({ name: 'Quick Help', value: 'Use [quick-help] for short questions and easy clarifications.' }, { name: 'Private Support', value: 'Use [open-a-ticket] for permissions, setup failures, bugs, or anything that needs server-specific context.' }, { name: 'Tracked Reports', value: 'Use `?bug` and `?suggest` when you want a formal tracked issue or feature request.' })] },
        bot_permissions_guide: { embeds: [new discord_js_1.EmbedBuilder().setColor(0x7C3AED).setTitle('Bot Permissions Guide').setDescription('Do not give Administrator unless you actually need it.').addFields({ name: 'Usually Required', value: 'View channels, send messages, embed links, attach files, manage messages, manage threads, and any feature-specific permissions your server uses.' }, { name: 'If Setup Fails', value: 'Run the correct config commands, check channel overwrites, and use a ticket if the bot still cannot see or post where expected.' })] },
        announcements: { embeds: [new discord_js_1.EmbedBuilder().setColor(0xBE123C).setTitle('Announcements').setDescription('Staff-only posting channel for release notes, major updates, and incidents.')] },
        known_issues: { embeds: [new discord_js_1.EmbedBuilder().setColor(0xDC2626).setTitle('Known Issues').setDescription('Use this channel to pin active issues, outages, and temporary workarounds.')] },
        changelog: { embeds: [new discord_js_1.EmbedBuilder().setColor(0x059669).setTitle('Changelog').setDescription('Post meaningful changes here: fixes, behavior changes, new features, and deprecations.')] },
        faq: { embeds: [new discord_js_1.EmbedBuilder().setColor(0x0369A1).setTitle('FAQ').setDescription('Use this space for short, repeatable answers that reduce ticket load.')] },
        open_a_ticket: { embeds: [new discord_js_1.EmbedBuilder().setColor(0x2563EB).setTitle('Open A Ticket').setDescription('Choose the ticket type that matches the problem. You will get a modal, then a private ticket channel under the managed `TICKETS` category.').addFields(...Object.values(TICKET_TYPES).map(row => ({ name: row.label, value: row.detailPrompt })))], components: buildTicketPanelComponents() },
        ticket_guide: { embeds: [new discord_js_1.EmbedBuilder().setColor(0x1D4ED8).setTitle('Ticket Guide').setDescription('The more complete your first message is, the faster staff can solve it.').addFields({ name: 'Add Bot Request', value: 'Server name, server ID, member count, what you need, and whether you need permission help.' }, { name: 'Bug / Error', value: 'Exact command, screenshots, steps, expected result, actual result, and server ID if relevant.' }, { name: 'Feature Suggestion', value: 'Problem, proposed behavior, target audience, and a concrete example.' })] },
        quick_help: { embeds: [new discord_js_1.EmbedBuilder().setColor(0x0891B2).setTitle('Quick Help').setDescription('Use this channel for short questions that do not need a private ticket or staff-only context.')] },
        add_bot_request: { embeds: [new discord_js_1.EmbedBuilder().setColor(0x16A34A).setTitle('Add Bot Requests').setDescription('Use the Add Bot Request ticket button in [open-a-ticket] so the request is tracked and staff can approve, deny, or ask for more info cleanly.')] },
        permission_help: { embeds: [new discord_js_1.EmbedBuilder().setColor(0x0284C7).setTitle('Permission Help').setDescription('Describe the exact permission gap and what command is failing. If it needs privacy, open a Permission Help ticket instead.')] },
        setup_help: { embeds: [new discord_js_1.EmbedBuilder().setColor(0x2563EB).setTitle('Setup Help').setDescription('For long troubleshooting threads or server-specific config, use the Setup Help ticket button in [open-a-ticket].')] },
        server_config_help: { embeds: [new discord_js_1.EmbedBuilder().setColor(0x4F46E5).setTitle('Server Config Help').setDescription('Bring screenshots, channel names, permissions, and the exact behavior that is failing.')] },
        bug_reports: { embeds: [new discord_js_1.EmbedBuilder().setColor(0xDC2626).setTitle('Tracked Bug Reports').setDescription('Use `?bug <title> | <what happened>` to create a tracked bug entry. Staff can then update status and severity.')] },
        error_help: { embeds: [new discord_js_1.EmbedBuilder().setColor(0xB91C1C).setTitle('Error Help').setDescription('Post full error text and screenshots. If server-specific details matter, use the Error Support ticket button instead.')] },
        feature_suggestions: { embeds: [new discord_js_1.EmbedBuilder().setColor(0x7C3AED).setTitle('Feature Suggestions').setDescription('Use `?suggest <idea>` to create a tracked suggestion. The bot will add voting reactions automatically.')] },
        roadmap: { embeds: [new discord_js_1.EmbedBuilder().setColor(0x15803D).setTitle('Roadmap').setDescription('Use `?roadmap` to generate a live summary of suggestions that are planned, in progress, or already shipped.')] }
    };
}
async function ensureStarterMessages(guild, config) {
    const payloads = buildStarterPayloads(guild, config);
    let created = 0;
    let updated = 0;
    for (const [channelKey, payload] of Object.entries(payloads)) {
        const channelId = config.channelIds[channelKey];
        const channel = channelId ? guild.channels.cache.get(channelId) : null;
        if (!channel?.isTextBased?.())
            continue;
        const existingId = config.panelMessageIds[channelKey];
        const message = await sendOrUpdateManagedMessage(channel, existingId, payload);
        if (!message)
            continue;
        if (existingId && existingId === message.id)
            updated++;
        else
            created++;
        config.panelMessageIds[channelKey] = message.id;
    }
    return { created, updated };
}
function buildSetupPreviewEmbed(guild) {
    const roleNames = ROLE_SPECS.map(role => `• ${role.name}`).join('\n');
    const categoryLines = CATEGORY_SPECS.map(category => `• ${category.name} (${category.channels.length} channels)`).join('\n');
    const panelLines = ['welcome', 'rules', 'how-to-get-help', 'bot-permissions-guide', 'open-a-ticket panel', 'ticket-guide', 'bug-reports hint', 'feature-suggestions hint', 'roadmap hint'].map(row => `• ${row}`).join('\n');
    const logLines = ['audit-logs', 'ticket-logs', 'mod-logs', 'bot-logs', 'join-leave-logs', 'message-logs'].map(row => `• ${row}`).join('\n');
    return new discord_js_1.EmbedBuilder()
        .setColor(0xDC2626)
        .setTitle(`Server Setup Preview: ${guild.name}`)
        .setDescription('This is a server-wide managed action. The bot will create or repair the tracked support-server structure and starter panels.')
        .addFields({ name: 'Roles', value: roleNames, inline: true }, { name: 'Categories', value: categoryLines, inline: true }, { name: 'Panels & Starter Messages', value: panelLines, inline: false }, { name: 'Logs', value: logLines, inline: false })
        .setFooter({ text: 'Only hardcoded Global Admin users can confirm this action.' });
}
async function getAuditLogChannel(guild, config) {
    const trackedId = config?.logChannelIds?.audit_logs || config?.channelIds?.audit_logs;
    if (trackedId && guild.channels.cache.has(trackedId)) {
        const tracked = guild.channels.cache.get(trackedId);
        if (isSendableTextChannel(tracked))
            return tracked;
    }
    return guild.channels.cache.find(channel => channel.type === discord_js_1.ChannelType.GuildText && channel.name === 'audit-logs') || null;
}
async function getTicketLogChannel(guild, config) {
    const trackedId = config?.logChannelIds?.ticket_logs || config?.channelIds?.ticket_logs;
    if (trackedId && guild.channels.cache.has(trackedId)) {
        const tracked = guild.channels.cache.get(trackedId);
        if (isSendableTextChannel(tracked))
            return tracked;
    }
    return guild.channels.cache.find(channel => channel.type === discord_js_1.ChannelType.GuildText && channel.name === 'ticket-logs') || null;
}
async function postAuditMessage(guild, config, title, description, color = 0x2563EB) {
    if (!guild)
        return;
    const auditChannel = await getAuditLogChannel(guild, config);
    if (!auditChannel)
        return;
    const embed = new discord_js_1.EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setTimestamp();
    await auditChannel.send({ embeds: [embed] }).catch(() => null);
}
async function appendManagedAudit(message, commandName, summary, targetSummary) {
    await (0, auditLog_1.appendAdminAuditLog)({
        guildId: message.guild.id,
        actorId: message.author.id,
        commandName,
        summary,
        targetSummary: targetSummary || message.guild.name,
        channelId: message.channel.id
    }).catch(() => null);
}
function getMissingPermissions(member) {
    const required = [discord_js_1.PermissionFlagsBits.ManageChannels, discord_js_1.PermissionFlagsBits.ManageRoles, discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.SendMessages];
    return required.filter(permission => !member.permissions.has(permission));
}
async function waitForExactReply(message, expectedText, promptText, config, auditContext) {
    await message.reply(promptText);
    try {
        const replies = await message.channel.awaitMessages({
            filter: reply => reply.author.id === message.author.id,
            max: 1,
            time: 60000,
            errors: ['time']
        });
        const reply = replies.first();
        if (!reply || reply.content.trim() !== expectedText) {
            await message.reply(`Setup cancelled. Expected exactly \`${expectedText}\`.`);
            await postAuditMessage(message.guild, config, 'Setup Cancelled', `${auditContext} | Expected \`${expectedText}\` but received ${reply ? `\`${reply.content.trim().slice(0, 80)}\`` : 'nothing'}.`, 0xDC2626);
            return false;
        }
        return true;
    }
    catch (_a) {
        await message.reply(`Setup cancelled. Timed out waiting for \`${expectedText}\`.`);
        await postAuditMessage(message.guild, config, 'Setup Timed Out', `${auditContext} | Timed out waiting for \`${expectedText}\`.`, 0xDC2626);
        return false;
    }
}
async function runDoubleTypedConfirmation(message, config, actionLabel) {
    const first = await waitForExactReply(message, 'CONFIRM SETUP', 'Reply exactly with `CONFIRM SETUP` within 60 seconds to continue.', config, actionLabel);
    if (!first)
        return false;
    return await waitForExactReply(message, 'FINAL CONFIRM', 'Reply exactly with `FINAL CONFIRM` within 60 seconds to finish authorization.', config, actionLabel);
}
function summarizeSetupResults(results) {
    return `Roles C:${results.rolesCreated}/U:${results.rolesUpdated} | Categories C:${results.categoriesCreated}/U:${results.categoriesUpdated} | Channels C:${results.channelsCreated}/U:${results.channelsUpdated} | Panels C:${results.panelsCreated}/U:${results.panelsUpdated}`;
}
async function buildOrRepairSupportServer(guild, config, mode) {
    const results = { rolesCreated: 0, rolesUpdated: 0, categoriesCreated: 0, categoriesUpdated: 0, channelsCreated: 0, channelsUpdated: 0, panelsCreated: 0, panelsUpdated: 0, ownerAssigned: false, globalAdminAssigned: 0 };
    const roleIds = {};
    for (const spec of ROLE_SPECS) {
        const ensured = await ensureRole(guild, config, spec);
        roleIds[spec.key] = ensured.role.id;
        if (ensured.created)
            results.rolesCreated++;
        if (ensured.updated)
            results.rolesUpdated++;
    }
    const everyoneId = guild.roles.everyone.id;
    for (const categorySpec of CATEGORY_SPECS) {
        const categoryResult = await ensureCategory(guild, config, categorySpec, roleIds, everyoneId);
        if (categoryResult.created)
            results.categoriesCreated++;
        if (categoryResult.updated)
            results.categoriesUpdated++;
        for (const channelSpec of categorySpec.channels) {
            const channelResult = await ensureChannel(guild, config, categoryResult.category, categorySpec, channelSpec, roleIds, everyoneId);
            if (channelResult.created)
                results.channelsCreated++;
            if (channelResult.updated)
                results.channelsUpdated++;
        }
    }
    await reorderRoles(guild, config);
    await reorderCategoriesAndChannels(guild, config);
    const assigned = await assignManagedRoles(guild, config);
    results.ownerAssigned = assigned.ownerAssigned;
    results.globalAdminAssigned = assigned.globalAdminAssigned;
    const panelResults = await ensureStarterMessages(guild, config);
    results.panelsCreated = panelResults.created;
    results.panelsUpdated = panelResults.updated;
    config.misc.version = 1;
    config.misc.lastSetupMode = mode;
    config.misc.lastSetupAt = nowTs();
    await saveSupportConfig(config);
    return results;
}
async function deleteManagedStructure(guild, config) {
    const uniqueChannelIds = [...new Set(Object.values(config.channelIds || {}).filter(Boolean))];
    const channelObjects = uniqueChannelIds.map(id => guild.channels.cache.get(id)).filter(Boolean);
    for (const channel of channelObjects.filter(channel => channel.type !== discord_js_1.ChannelType.GuildCategory)) {
        await channel.delete(REASON).catch(() => null);
    }
    for (const category of channelObjects.filter(channel => channel.type === discord_js_1.ChannelType.GuildCategory)) {
        await category.delete(REASON).catch(() => null);
    }
    const uniqueRoleIds = [...new Set(Object.values(config.roleIds || {}).filter(Boolean))];
    for (const roleId of uniqueRoleIds) {
        const role = guild.roles.cache.get(roleId);
        if (role && role.editable) {
            await role.delete(REASON).catch(() => null);
        }
    }
    config.roleIds = {};
    config.channelIds = {};
    config.panelMessageIds = {};
    config.logChannelIds = {};
    config.misc.lastRebuildAt = nowTs();
    await saveSupportConfig(config);
}
async function handleSetupServerCommand(message) {
    const guild = message.guild;
    const botMember = guild?.members?.me;
    if (!guild || !botMember) {
        await message.reply('This command can only run inside a guild.');
        return true;
    }
    const missingPermissions = getMissingPermissions(botMember);
    if (missingPermissions.length) {
        await message.reply(`I am missing required setup permissions: ${missingPermissions.map(permission => `\`${getPermissionName(permission)}\``).join(', ')}`);
        return true;
    }
    const config = await getSupportConfig(guild.id);
    await message.reply({ embeds: [buildSetupPreviewEmbed(guild)] });
    const confirmed = await runDoubleTypedConfirmation(message, config, `Setup attempt by <@${message.author.id}> in **${guild.name}**`);
    if (!confirmed) {
        return true;
    }
    try {
        const results = await buildOrRepairSupportServer(guild, config, 'setup');
        const embed = new discord_js_1.EmbedBuilder()
            .setColor(0x16A34A)
            .setTitle(`Support Server Setup Complete: ${guild.name}`)
            .setDescription('The managed support-server structure is now in place.')
            .addFields({ name: 'Managed Structure', value: summarizeSetupResults(results), inline: false }, { name: 'Role Assignment', value: `Owner role assigned: **${results.ownerAssigned ? 'yes' : 'no'}**\nGlobal Admin role additions: **${results.globalAdminAssigned}**`, inline: false }, { name: 'Key Channels', value: ['welcome', 'open_a_ticket', 'ticket_logs', 'audit_logs', 'feature_suggestions', 'bug_reports'].map(key => message.guild.channels.cache.get(config.channelIds[key])?.toString()).filter(Boolean).join(' | ') || 'Tracked', inline: false });
        await message.reply({ embeds: [embed] });
        await appendManagedAudit(message, 'setupserver', `Support server setup complete | ${summarizeSetupResults(results)}`, guild.name);
        await postAuditMessage(guild, config, 'Support Server Setup Complete', `Triggered by <@${message.author.id}>.\n${summarizeSetupResults(results)}`, 0x16A34A);
    }
    catch (error) {
        console.error('Support server setup failed:', error);
        await message.reply(`Support server setup failed: ${error.message}`);
        await appendManagedAudit(message, 'setupserver', `Support server setup failed: ${error.message}`, guild.name);
        await postAuditMessage(guild, config, 'Support Server Setup Failed', `Triggered by <@${message.author.id}>.\nError: ${error.message}`, 0xDC2626);
    }
    return true;
}
async function handleRepairServerCommand(message) {
    const guild = message.guild;
    if (!guild?.members?.me) {
        await message.reply('This command can only run inside a guild.');
        return true;
    }
    const missingPermissions = getMissingPermissions(guild.members.me);
    if (missingPermissions.length) {
        await message.reply(`I am missing required repair permissions: ${missingPermissions.map(permission => `\`${getPermissionName(permission)}\``).join(', ')}`);
        return true;
    }
    const config = await getSupportConfig(guild.id);
    try {
        const results = await buildOrRepairSupportServer(guild, config, 'repair');
        await message.reply({ embeds: [new discord_js_1.EmbedBuilder().setColor(0x2563EB).setTitle(`Support Server Repair Complete: ${guild.name}`).setDescription('Missing managed items were recreated and tracked overwrites were reapplied.').addFields({ name: 'Summary', value: summarizeSetupResults(results), inline: false })] });
        await appendManagedAudit(message, 'repairserver', `Support server repair complete | ${summarizeSetupResults(results)}`, guild.name);
        await postAuditMessage(guild, config, 'Support Server Repair Complete', `Triggered by <@${message.author.id}>.\n${summarizeSetupResults(results)}`, 0x2563EB);
    }
    catch (error) {
        console.error('Support server repair failed:', error);
        await message.reply(`Support server repair failed: ${error.message}`);
        await appendManagedAudit(message, 'repairserver', `Support server repair failed: ${error.message}`, guild.name);
        await postAuditMessage(guild, config, 'Support Server Repair Failed', `Triggered by <@${message.author.id}>.\nError: ${error.message}`, 0xDC2626);
    }
    return true;
}
async function handleRebuildServerCommand(message) {
    const guild = message.guild;
    if (!guild?.members?.me) {
        await message.reply('This command can only run inside a guild.');
        return true;
    }
    const missingPermissions = getMissingPermissions(guild.members.me);
    if (missingPermissions.length) {
        await message.reply(`I am missing required rebuild permissions: ${missingPermissions.map(permission => `\`${getPermissionName(permission)}\``).join(', ')}`);
        return true;
    }
    const config = await getSupportConfig(guild.id);
    await message.reply({ embeds: [buildSetupPreviewEmbed(guild).setTitle(`Rebuild Preview: ${guild.name}`).setDescription('This will delete only tracked bot-managed support-server items, then recreate a clean managed structure.')] });
    const confirmed = await runDoubleTypedConfirmation(message, config, `Rebuild attempt by <@${message.author.id}> in **${guild.name}**`);
    if (!confirmed) {
        return true;
    }
    try {
        await deleteManagedStructure(guild, config);
        const freshConfig = await getSupportConfig(guild.id);
        const results = await buildOrRepairSupportServer(guild, freshConfig, 'rebuild');
        await message.reply({ embeds: [new discord_js_1.EmbedBuilder().setColor(0x16A34A).setTitle(`Support Server Rebuild Complete: ${guild.name}`).setDescription('Tracked support-server items were rebuilt from scratch.').addFields({ name: 'Summary', value: summarizeSetupResults(results), inline: false })] });
        await appendManagedAudit(message, 'rebuildserver', `Support server rebuild complete | ${summarizeSetupResults(results)}`, guild.name);
        await postAuditMessage(guild, freshConfig, 'Support Server Rebuild Complete', `Triggered by <@${message.author.id}>.\n${summarizeSetupResults(results)}`, 0x16A34A);
    }
    catch (error) {
        console.error('Support server rebuild failed:', error);
        await message.reply(`Support server rebuild failed: ${error.message}`);
        await appendManagedAudit(message, 'rebuildserver', `Support server rebuild failed: ${error.message}`, guild.name);
        await postAuditMessage(guild, config, 'Support Server Rebuild Failed', `Triggered by <@${message.author.id}>.\nError: ${error.message}`, 0xDC2626);
    }
    return true;
}
async function handleSetupStatusCommand(message) {
    const guild = message.guild;
    const config = await getSupportConfig(guild.id);
    const missingRoles = ROLE_SPECS.filter(spec => !resolveTrackedRole(guild, config, spec.key)).map(spec => spec.name);
    const missingCategories = CATEGORY_SPECS.filter(spec => !resolveTrackedChannel(guild, config, spec.key)).map(spec => spec.name);
    const missingChannels = CATEGORY_SPECS.flatMap(category => category.channels.filter(channel => !resolveTrackedChannel(guild, config, channel.key)).map(channel => `#${channel.name}`));
    const panelChecks = ['welcome', 'rules', 'how_to_get_help', 'bot_permissions_guide', 'open_a_ticket', 'ticket_guide', 'bug_reports', 'feature_suggestions', 'roadmap'];
    const missingPanels = [];
    for (const key of panelChecks) {
        const channel = resolveTrackedChannel(guild, config, key);
        const messageId = config.panelMessageIds[key];
        if (!channel?.isTextBased?.() || !messageId) {
            missingPanels.push(key);
            continue;
        }
        const found = await channel.messages.fetch(messageId).catch(() => null);
        if (!found) {
            missingPanels.push(key);
        }
    }
    const embed = new discord_js_1.EmbedBuilder()
        .setColor((missingRoles.length || missingCategories.length || missingChannels.length || missingPanels.length) ? 0xF59E0B : 0x10B981)
        .setTitle(`Support Server Status: ${guild.name}`)
        .setDescription((missingRoles.length || missingCategories.length || missingChannels.length || missingPanels.length) ? 'Some managed items are missing or broken.' : 'Managed support-server structure looks healthy.')
        .addFields({ name: 'Roles', value: missingRoles.length ? missingRoles.map(row => `• ${row}`).join('\n') : 'All tracked roles exist.', inline: false }, { name: 'Categories', value: missingCategories.length ? missingCategories.map(row => `• ${row}`).join('\n') : 'All tracked categories exist.', inline: false }, { name: 'Channels', value: missingChannels.length ? missingChannels.slice(0, 20).map(row => `• ${row}`).join('\n') : 'All tracked channels exist.', inline: false }, { name: 'Panels', value: missingPanels.length ? missingPanels.map(row => `• ${row}`).join('\n') : 'All tracked starter messages exist.', inline: false });
    await message.reply({ embeds: [embed] });
    return true;
}
async function handleSendPanelsCommand(message) {
    const guild = message.guild;
    const config = await getSupportConfig(guild.id);
    const panelResults = await ensureStarterMessages(guild, config);
    await saveSupportConfig(config);
    await message.reply({ embeds: [new discord_js_1.EmbedBuilder().setColor(0x2563EB).setTitle(`Panels Sent: ${guild.name}`).setDescription(`Starter messages updated.\nCreated: **${panelResults.created}** | Updated: **${panelResults.updated}**`)] });
    await appendManagedAudit(message, 'sendpanels', `Starter panels updated | Created ${panelResults.created} | Updated ${panelResults.updated}`, guild.name);
    await postAuditMessage(guild, config, 'Support Panels Sent', `Triggered by <@${message.author.id}>.\nCreated: **${panelResults.created}** | Updated: **${panelResults.updated}**`, 0x2563EB);
    return true;
}
async function handleSendModPanelCommand(message) {
    const guild = message.guild;
    const config = await getSupportConfig(guild.id);
    const targetChannel = message.mentions.channels.first()?.isTextBased?.() ? message.mentions.channels.first() : message.channel;
    const existingChannelId = config.misc?.modPanelChannelId;
    const existingMessageId = config.panelMessageIds?.mod_panel;
    const existingChannel = existingChannelId ? guild.channels.cache.get(existingChannelId) || await guild.channels.fetch(existingChannelId).catch(() => null) : null;
    const targetExistingId = existingChannel?.id === targetChannel.id ? existingMessageId : null;
    const modPanelMessage = await sendOrUpdateManagedMessage(targetChannel, targetExistingId, buildModPanelPayload());
    if (!modPanelMessage) {
        await message.reply('Failed to post the moderation panel.');
        return true;
    }
    config.panelMessageIds.mod_panel = modPanelMessage.id;
    config.misc.modPanelChannelId = modPanelMessage.channel.id;
    await saveSupportConfig(config);
    await message.reply(`Moderation panel is ready in ${targetChannel}. Only hardcoded Global Admin users can use it.`);
    await appendManagedAudit(message, 'sendmodpanel', `Global moderation panel updated in #${targetChannel.name}.`, guild.name);
    await postAuditMessage(guild, config, 'Moderation Panel Sent', `Triggered by <@${message.author.id}> in ${targetChannel}.`, 0xDC2626);
    return true;
}
async function handleModCommandServersCommand(message) {
    const guilds = [...message.client.guilds.cache.values()].sort((a, b) => a.name.localeCompare(b.name));
    if (!guilds.length) {
        await message.reply('The bot is not in any servers.');
        return true;
    }
    const configs = await Promise.all(guilds.map(guild => getSupportConfig(guild.id)));
    const statusMap = new Map(configs.map(config => [config.guildId, areGlobalModCommandsEnabled(config)]));
    let page = 0;
    let selectedGuildId = guilds[0].id;
    const buildPayload = () => ({
        embeds: [buildModGuildAccessEmbed(guilds, statusMap, page, selectedGuildId)],
        components: buildModGuildAccessComponents(guilds, statusMap, page, selectedGuildId)
    });
    const response = await message.reply(buildPayload());
    const collector = response.createMessageComponentCollector({
        filter: interaction => interaction.user.id === message.author.id && ['support_modguild_select', 'support_modguild_prev', 'support_modguild_next', 'support_modguild_enable', 'support_modguild_disable'].includes(interaction.customId),
        time: 300000
    });
    collector.on('collect', async interaction => {
        if (interaction.customId === 'support_modguild_select') {
            selectedGuildId = interaction.values?.[0] || selectedGuildId;
            page = Math.floor(Math.max(guilds.findIndex(guild => guild.id === selectedGuildId), 0) / 25);
            await interaction.update(buildPayload()).catch(() => null);
            return;
        }
        if (interaction.customId === 'support_modguild_prev' && page > 0) {
            page--;
            await interaction.update(buildPayload()).catch(() => null);
            return;
        }
        if (interaction.customId === 'support_modguild_next' && page < Math.max(Math.ceil(guilds.length / 25), 1) - 1) {
            page++;
            await interaction.update(buildPayload()).catch(() => null);
            return;
        }
        if (interaction.customId === 'support_modguild_enable' || interaction.customId === 'support_modguild_disable') {
            const targetGuild = guilds.find(guild => guild.id === selectedGuildId) || null;
            if (!targetGuild) {
                await interaction.reply({ content: 'Selected server no longer exists.', flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => null);
                return;
            }
            const enabled = interaction.customId === 'support_modguild_enable';
            const config = await getSupportConfig(targetGuild.id);
            config.misc = config.misc || {};
            config.misc.globalModCommandsEnabled = enabled;
            await saveSupportConfig(config);
            statusMap.set(targetGuild.id, enabled);
            await postAuditMessage(targetGuild, config, enabled ? 'Global Mod Commands Enabled' : 'Global Mod Commands Disabled', `Changed by <@${message.author.id}>. The commands \`?warn\`, \`?timeout\`, \`?mute\`, \`?unmute\`, \`?kick\`, \`?ban\`, and \`?purge\` are now **${enabled ? 'enabled' : 'disabled'}** in this guild.`, enabled ? 0x16A34A : 0xDC2626);
            await interaction.update(buildPayload()).catch(() => null);
            return;
        }
    });
    collector.on('end', () => {
        response.edit({ components: [] }).catch(() => null);
    });
    return true;
}
async function handleSuperAdminModCommand(message) {
    const guilds = [...message.client.guilds.cache.values()].sort((a, b) => a.name.localeCompare(b.name));
    if (!guilds.length) {
        await message.reply('The bot is not in any servers.');
        return true;
    }
    const configs = await Promise.all(guilds.map(guild => getSupportConfig(guild.id)));
    const statusMap = new Map(configs.map(config => [config.guildId, config.misc?.superAdminModEnabled === true]));
    let page = 0;
    let selectedGuildId = guilds[0].id;
    const buildPayload = () => ({
        embeds: [buildSuperAdminModEmbed(guilds, statusMap, page, selectedGuildId)],
        components: buildSuperAdminModComponents(guilds, statusMap, page, selectedGuildId)
    });
    const response = await message.reply(buildPayload());
    const collector = response.createMessageComponentCollector({
        filter: interaction => interaction.user.id === message.author.id && ['support_samod_select', 'support_samod_prev', 'support_samod_next', 'support_samod_enable', 'support_samod_disable'].includes(interaction.customId),
        time: 300000
    });
    collector.on('collect', async (interaction) => {
        if (interaction.customId === 'support_samod_select') {
            selectedGuildId = interaction.values?.[0] || selectedGuildId;
            page = Math.floor(Math.max(guilds.findIndex(guild => guild.id === selectedGuildId), 0) / 25);
            await interaction.update(buildPayload()).catch(() => null);
            return;
        }
        if (interaction.customId === 'support_samod_prev' && page > 0) {
            page--;
            await interaction.update(buildPayload()).catch(() => null);
            return;
        }
        if (interaction.customId === 'support_samod_next' && page < Math.max(Math.ceil(guilds.length / 25), 1) - 1) {
            page++;
            await interaction.update(buildPayload()).catch(() => null);
            return;
        }
        if (interaction.customId === 'support_samod_enable' || interaction.customId === 'support_samod_disable') {
            const targetGuild = guilds.find(guild => guild.id === selectedGuildId) || null;
            if (!targetGuild) {
                await interaction.reply({ content: 'Selected server no longer exists.', flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => null);
                return;
            }
            const enabled = interaction.customId === 'support_samod_enable';
            const config = await getSupportConfig(targetGuild.id);
            config.misc = config.misc || {};
            config.misc.superAdminModEnabled = enabled;
            await saveSupportConfig(config);
            statusMap.set(targetGuild.id, enabled);
            await postAuditMessage(targetGuild, config, enabled ? 'Super Admin Moderation Enabled' : 'Super Admin Moderation Disabled', `Changed by Global Admin <@${message.author.id}>. Super Admins in this guild can now **${enabled ? 'use' : 'no longer use'}** global moderation commands (\`?warn\`, \`?timeout\`, etc).`, enabled ? 0x16A34A : 0xDC2626);
            await interaction.update(buildPayload()).catch(() => null);
            return;
        }
    });
    collector.on('end', () => {
        response.edit({ components: [] }).catch(() => null);
    });
    return true;
}
function buildSuperAdminModEmbed(guilds, statusMap, page, selectedGuildId) {
    const totalPages = Math.max(Math.ceil(guilds.length / 25), 1);
    const selectedGuild = guilds.find(guild => guild.id === selectedGuildId) || guilds[0] || null;
    const selectedEnabled = selectedGuild ? (statusMap.get(selectedGuild.id) === true) : false;
    const pageGuilds = guilds.slice(page * 25, (page + 1) * 25);
    return new discord_js_1.EmbedBuilder()
        .setColor(selectedEnabled ? 0x16A34A : 0xDC2626)
        .setTitle('Super Admin Moderation Access')
        .setDescription('Select a server from the dropdown to enable or disable Super Admin access to moderation commands.\n\nAffected commands: `?warn`, `?timeout`, `?mute`, `?unmute`, `?kick`, `?ban`, `?purge`.')
        .addFields({ name: 'Selected Server', value: selectedGuild ? `**${selectedGuild.name}**\n\`${selectedGuild.id}\`` : 'No server selected', inline: true }, { name: 'Super Admin Access', value: selectedGuild ? (selectedEnabled ? '**Enabled**' : '**Disabled**') : 'N/A', inline: true }, { name: 'Page', value: `${page + 1}/${totalPages}`, inline: true }, { name: 'Visible Servers', value: pageGuilds.length ? pageGuilds.map(guild => `• ${guild.id === selectedGuildId ? '**' : ''}${guild.name}${guild.id === selectedGuildId ? '**' : ''} | ${statusMap.get(guild.id) === true ? 'Enabled' : 'Disabled'}`).join('\n').slice(0, 1024) : 'No servers found.', inline: false })
        .setFooter({ text: 'Only Global Admins can use this panel. It expires in 5 minutes.' });
}
function buildSuperAdminModComponents(guilds, statusMap, page, selectedGuildId) {
    const totalPages = Math.max(Math.ceil(guilds.length / 25), 1);
    const selectedGuild = guilds.find(guild => guild.id === selectedGuildId) || guilds[0] || null;
    const selectedEnabled = selectedGuild ? (statusMap.get(selectedGuild.id) === true) : false;
    const options = guilds.slice(page * 25, (page + 1) * 25).map(guild => ({
        label: guild.name.slice(0, 100),
        value: guild.id,
        description: `${statusMap.get(guild.id) === true ? 'Enabled' : 'Disabled'} | ${guild.id}`.slice(0, 100),
        default: guild.id === selectedGuildId
    }));
    const selectRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
        .setCustomId('support_samod_select')
        .setPlaceholder('Select server')
        .addOptions(options));
    const buttonRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId('support_samod_prev').setLabel('Previous').setStyle(discord_js_1.ButtonStyle.Secondary).setDisabled(page === 0), new discord_js_1.ButtonBuilder().setCustomId('support_samod_next').setLabel('Next').setStyle(discord_js_1.ButtonStyle.Secondary).setDisabled(page >= totalPages - 1), new discord_js_1.ButtonBuilder().setCustomId('support_samod_enable').setLabel('Enable').setStyle(discord_js_1.ButtonStyle.Success).setDisabled(!selectedGuild || selectedEnabled), new discord_js_1.ButtonBuilder().setCustomId('support_samod_disable').setLabel('Disable').setStyle(discord_js_1.ButtonStyle.Danger).setDisabled(!selectedGuild || !selectedEnabled));
    return [selectRow, buttonRow];
}
function isSupportStaffMember(member, config) {
    if (!member) {
        return false;
    }
    if ((0, utils_1.isGlobalAdmin)(member.id)) {
        return true;
    }
    return STAFF_ROLE_KEYS.some(key => config.roleIds[key] && member.roles.cache.has(config.roleIds[key]));
}
function isModerationStaffMember(member, config) {
    if (!member) {
        return false;
    }
    if ((0, utils_1.isGlobalAdmin)(member.id)) {
        return true;
    }
    return ['owner', 'global_admin', 'admin', 'moderator'].some(key => config.roleIds[key] && member.roles.cache.has(config.roleIds[key]));
}
function isGlobalModerationMember(member, config) {
    if (!member) return false;
    if ((0, utils_1.isGlobalAdmin)(member.id)) return true;
    if (config?.misc?.superAdminModEnabled === true && (0, utils_1.isSuperAdmin)(member)) return true;
    return false;
}
function areGlobalModCommandsEnabled(config) {
    return config?.misc?.globalModCommandsEnabled !== false;
}
async function getBotMember(guild) {
    return guild.members.me || await guild.members.fetchMe().catch(() => null);
}
async function getModLogChannel(guild, config) {
    const trackedId = config?.logChannelIds?.mod_logs || config?.channelIds?.mod_logs;
    if (trackedId && guild.channels.cache.has(trackedId)) {
        const tracked = guild.channels.cache.get(trackedId);
        if (isSendableTextChannel(tracked)) {
            return tracked;
        }
    }
    return guild.channels.cache.find(channel => channel.type === discord_js_1.ChannelType.GuildText && channel.name === 'mod-logs') || null;
}
async function logModEvent(guild, config, title, fields) {
    const channel = await getModLogChannel(guild, config);
    if (!channel) {
        return;
    }
    const embed = new discord_js_1.EmbedBuilder().setColor(0xF97316).setTitle(title).setTimestamp();
    if (fields?.length) {
        embed.addFields(fields);
    }
    await channel.send({ embeds: [embed] }).catch(() => null);
}
function parseDurationInput(raw) {
    const input = (raw || '').trim().toLowerCase();
    const match = input.match(/^(\d+)(s|m|h|d)$/);
    if (!match) {
        return null;
    }
    const amount = parseInt(match[1], 10);
    const unit = match[2];
    const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    return amount * multipliers[unit];
}
function getMentionedMember(message, rawIdentifier) {
    return message.mentions.members.first() || (rawIdentifier ? message.guild.members.cache.get(rawIdentifier.replace(/[<@!>]/g, '')) || null : null);
}
async function resolveMemberIdentifier(guild, rawIdentifier) {
    const token = String(rawIdentifier || '').trim().replace(/[<@!>]/g, '');
    if (!token)
        return null;
    return guild.members.cache.get(token) || await guild.members.fetch(token).catch(() => null);
}
async function resolveChannelIdentifier(guild, rawIdentifier) {
    const token = String(rawIdentifier || '').trim().replace(/[<#>]/g, '');
    if (!token)
        return null;
    return guild.channels.cache.get(token) || await guild.channels.fetch(token).catch(() => null);
}
function buildModPanelPayload() {
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0xDC2626)
        .setTitle('Global Admin Moderation Panel')
        .setDescription('Select a moderation action from the dropdown. The bot will open a modal for the required inputs.\n\nOnly hardcoded Global Admin users can use this panel.')
        .addFields({ name: 'Actions', value: '`warn`, `timeout`, `mute`, `unmute`, `kick`, `ban`, `purge`', inline: false }, { name: 'Notes', value: 'Purge removes messages from the target channel you enter, or from this panel channel if you leave the channel field empty.', inline: false })
        .setFooter({ text: 'Managed by the bot. Re-run ?sendmodpanel to refresh it.' });
    const row = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
        .setCustomId('support_modpanel_action')
        .setPlaceholder('Select moderation action')
        .addOptions({ label: 'Warn User', value: 'warn', description: 'Issue a tracked warning to a member.' }, { label: 'Timeout User', value: 'timeout', description: 'Timeout a member for a duration.' }, { label: 'Mute User', value: 'mute', description: 'Add the managed muted role.' }, { label: 'Unmute User', value: 'unmute', description: 'Remove the managed muted role.' }, { label: 'Kick User', value: 'kick', description: 'Remove a member from the server.' }, { label: 'Ban User', value: 'ban', description: 'Ban a member from the server.' }, { label: 'Purge Messages', value: 'purge', description: 'Bulk-delete recent messages in a text channel.' }));
    return { embeds: [embed], components: [row] };
}
function buildModGuildAccessEmbed(guilds, statusMap, page, selectedGuildId) {
    const totalPages = Math.max(Math.ceil(guilds.length / 25), 1);
    const selectedGuild = guilds.find(guild => guild.id === selectedGuildId) || guilds[0] || null;
    const selectedEnabled = selectedGuild ? (statusMap.get(selectedGuild.id) !== false) : true;
    const pageGuilds = guilds.slice(page * 25, (page + 1) * 25);
    return new discord_js_1.EmbedBuilder()
        .setColor(selectedEnabled ? 0x16A34A : 0xDC2626)
        .setTitle('Global Moderation Command Access')
        .setDescription('Select a server from the dropdown, then enable or disable the global moderation command set for that guild only.\n\nAffected commands: `?warn`, `?timeout`, `?mute`, `?unmute`, `?kick`, `?ban`, `?purge`.\nThis applies even to hardcoded Global Admin users.')
        .addFields({ name: 'Selected Server', value: selectedGuild ? `**${selectedGuild.name}**\n\`${selectedGuild.id}\`` : 'No server selected', inline: true }, { name: 'Current Status', value: selectedGuild ? (selectedEnabled ? '**Enabled**' : '**Disabled**') : 'N/A', inline: true }, { name: 'Page', value: `${page + 1}/${totalPages}`, inline: true }, { name: 'Visible Servers', value: pageGuilds.length ? pageGuilds.map(guild => `• ${guild.id === selectedGuildId ? '**' : ''}${guild.name}${guild.id === selectedGuildId ? '**' : ''} | ${statusMap.get(guild.id) !== false ? 'Enabled' : 'Disabled'}`).join('\n').slice(0, 1024) : 'No servers found.', inline: false })
        .setFooter({ text: 'Only the command invoker can use this panel. It expires in 5 minutes.' });
}
function buildModGuildAccessComponents(guilds, statusMap, page, selectedGuildId) {
    const totalPages = Math.max(Math.ceil(guilds.length / 25), 1);
    const selectedGuild = guilds.find(guild => guild.id === selectedGuildId) || guilds[0] || null;
    const selectedEnabled = selectedGuild ? (statusMap.get(selectedGuild.id) !== false) : true;
    const options = guilds.slice(page * 25, (page + 1) * 25).map(guild => ({
        label: guild.name.slice(0, 100),
        value: guild.id,
        description: `${statusMap.get(guild.id) !== false ? 'Enabled' : 'Disabled'} | ${guild.id}`.slice(0, 100),
        default: guild.id === selectedGuildId
    }));
    const selectRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
        .setCustomId('support_modguild_select')
        .setPlaceholder('Select server')
        .addOptions(options));
    const buttonRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId('support_modguild_prev').setLabel('Previous').setStyle(discord_js_1.ButtonStyle.Secondary).setDisabled(page === 0), new discord_js_1.ButtonBuilder().setCustomId('support_modguild_next').setLabel('Next').setStyle(discord_js_1.ButtonStyle.Secondary).setDisabled(page >= totalPages - 1), new discord_js_1.ButtonBuilder().setCustomId('support_modguild_enable').setLabel('Enable').setStyle(discord_js_1.ButtonStyle.Success).setDisabled(!selectedGuild || selectedEnabled), new discord_js_1.ButtonBuilder().setCustomId('support_modguild_disable').setLabel('Disable').setStyle(discord_js_1.ButtonStyle.Danger).setDisabled(!selectedGuild || !selectedEnabled));
    return [selectRow, buttonRow];
}
async function executeWarnAction(guild, config, actorId, target, reason) {
    const db = (0, database_1.getDB)();
    await db.run('INSERT INTO support_warnings (guild_id, user_id, moderator_id, reason_text, created_at) VALUES (?, ?, ?, ?, ?)', guild.id, target.id, actorId, reason, nowTs());
    const countRow = await db.get('SELECT COUNT(*) AS count FROM support_warnings WHERE guild_id = ? AND user_id = ?', guild.id, target.id);
    await logModEvent(guild, config, 'Warn Issued', [{ name: 'User', value: `<@${target.id}>`, inline: true }, { name: 'Moderator', value: `<@${actorId}>`, inline: true }, { name: 'Total Warnings', value: `${countRow?.count || 1}`, inline: true }, { name: 'Reason', value: reason.slice(0, 1024), inline: false }]);
    return `${target} warned. Total warnings: **${countRow?.count || 1}**.`;
}
async function executeTimeoutAction(guild, config, actorId, target, durationRaw, reason) {
    const botMember = await getBotMember(guild);
    const durationMs = parseDurationInput(durationRaw);
    if (!durationMs) {
        throw new Error('Duration must use `s`, `m`, `h`, or `d`, for example `10m`, `1h`, or `1d`.');
    }
    if (!botMember?.permissions.has(discord_js_1.PermissionFlagsBits.ModerateMembers) || !target.moderatable) {
        throw new Error('I cannot timeout that member with my current permissions/hierarchy.');
    }
    await target.timeout(durationMs, reason).catch(error => { throw error; });
    await logModEvent(guild, config, 'Timeout Applied', [{ name: 'User', value: `<@${target.id}>`, inline: true }, { name: 'Moderator', value: `<@${actorId}>`, inline: true }, { name: 'Duration', value: durationRaw, inline: true }, { name: 'Reason', value: reason.slice(0, 1024), inline: false }]);
    return `${target} has been timed out for \`${durationRaw}\`.`;
}
async function executeMuteAction(guild, config, actorId, target, reason, remove) {
    const botMember = await getBotMember(guild);
    const mutedRole = resolveTrackedRole(guild, config, 'muted');
    if (!mutedRole) {
        throw new Error('The managed muted role is missing. Run `?repairserver` first.');
    }
    if (!botMember?.permissions.has(discord_js_1.PermissionFlagsBits.ManageRoles) || !mutedRole.editable) {
        throw new Error('I cannot manage the muted role with my current permissions/hierarchy.');
    }
    if (remove) {
        await target.roles.remove(mutedRole, reason).catch(error => { throw error; });
        await logModEvent(guild, config, 'User Unmuted', [{ name: 'User', value: `<@${target.id}>`, inline: true }, { name: 'Moderator', value: `<@${actorId}>`, inline: true }, { name: 'Reason', value: reason.slice(0, 1024), inline: false }]);
        return `${target} has been unmuted.`;
    }
    await target.roles.add(mutedRole, reason).catch(error => { throw error; });
    await logModEvent(guild, config, 'User Muted', [{ name: 'User', value: `<@${target.id}>`, inline: true }, { name: 'Moderator', value: `<@${actorId}>`, inline: true }, { name: 'Reason', value: reason.slice(0, 1024), inline: false }]);
    return `${target} has been muted.`;
}
async function executeKickAction(guild, config, actorId, target, reason) {
    const botMember = await getBotMember(guild);
    if (!botMember?.permissions.has(discord_js_1.PermissionFlagsBits.KickMembers) || !target.kickable) {
        throw new Error('I cannot kick that member with my current permissions/hierarchy.');
    }
    await target.kick(reason).catch(error => { throw error; });
    await logModEvent(guild, config, 'User Kicked', [{ name: 'User', value: `${target.user.tag} (${target.id})`, inline: true }, { name: 'Moderator', value: `<@${actorId}>`, inline: true }, { name: 'Reason', value: reason.slice(0, 1024), inline: false }]);
    return `${target.user.tag} has been kicked.`;
}
async function executeBanAction(guild, config, actorId, target, reason) {
    const botMember = await getBotMember(guild);
    if (!botMember?.permissions.has(discord_js_1.PermissionFlagsBits.BanMembers) || !target.bannable) {
        throw new Error('I cannot ban that member with my current permissions/hierarchy.');
    }
    await target.ban({ reason }).catch(error => { throw error; });
    await logModEvent(guild, config, 'User Banned', [{ name: 'User', value: `${target.user.tag} (${target.id})`, inline: true }, { name: 'Moderator', value: `<@${actorId}>`, inline: true }, { name: 'Reason', value: reason.slice(0, 1024), inline: false }]);
    return `${target.user.tag} has been banned.`;
}
async function executePurgeAction(guild, config, actorId, channel, amount) {
    const botMember = await getBotMember(guild);
    if (!channel?.isTextBased?.() || !('bulkDelete' in channel)) {
        throw new Error('That target channel does not support bulk delete.');
    }
    if (!botMember?.permissions.has(discord_js_1.PermissionFlagsBits.ManageMessages)) {
        throw new Error('I am missing `ManageMessages`.');
    }
    const deleted = await channel.bulkDelete(amount, true).catch(() => null);
    if (!deleted) {
        throw new Error('Failed to purge messages. Messages older than 14 days cannot be bulk deleted.');
    }
    await logModEvent(guild, config, 'Messages Purged', [{ name: 'Channel', value: `${channel}`, inline: true }, { name: 'Moderator', value: `<@${actorId}>`, inline: true }, { name: 'Deleted', value: `${deleted.size}`, inline: true }]);
    return { text: `Purged **${deleted.size}** message(s) in ${channel}.`, deletedCount: deleted.size };
}
async function getTicketByChannelId(channelId) {
    const db = (0, database_1.getDB)();
    return db.get('SELECT * FROM support_tickets WHERE channel_id = ? ORDER BY id DESC LIMIT 1', channelId);
}
function buildTicketPermissions(config, openerId, ticketType) {
    const developerNeeded = ticketType === 'bug_report' || ticketType === 'error_support';
    const entries = [
        { id: '0', deny: [discord_js_1.PermissionFlagsBits.ViewChannel] },
        { id: openerId, allow: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.SendMessages, discord_js_1.PermissionFlagsBits.ReadMessageHistory, discord_js_1.PermissionFlagsBits.AttachFiles, discord_js_1.PermissionFlagsBits.EmbedLinks, discord_js_1.PermissionFlagsBits.AddReactions] }
    ];
    for (const key of ['owner', 'global_admin', 'admin', 'moderator', 'support_team']) {
        const roleId = config.roleIds[key];
        if (roleId) {
            entries.push({ id: roleId, allow: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.SendMessages, discord_js_1.PermissionFlagsBits.ReadMessageHistory, discord_js_1.PermissionFlagsBits.AttachFiles, discord_js_1.PermissionFlagsBits.EmbedLinks, discord_js_1.PermissionFlagsBits.AddReactions, discord_js_1.PermissionFlagsBits.ManageMessages, discord_js_1.PermissionFlagsBits.ManageThreads] });
        }
    }
    if (developerNeeded && config.roleIds.developer) {
        entries.push({ id: config.roleIds.developer, allow: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.SendMessages, discord_js_1.PermissionFlagsBits.ReadMessageHistory, discord_js_1.PermissionFlagsBits.AttachFiles, discord_js_1.PermissionFlagsBits.EmbedLinks, discord_js_1.PermissionFlagsBits.AddReactions, discord_js_1.PermissionFlagsBits.ManageMessages] });
    }
    return uniqEntries(entries);
}
async function logTicketEvent(guild, config, title, fields) {
    const channel = await getTicketLogChannel(guild, config);
    if (!channel) {
        return;
    }
    const embed = new discord_js_1.EmbedBuilder().setColor(0x2563EB).setTitle(title).setTimestamp();
    if (fields?.length) {
        embed.addFields(fields);
    }
    await channel.send({ embeds: [embed] }).catch(() => null);
}
function ticketChannelName(ticketType, ticketNumber) {
    const type = TICKET_TYPES[ticketType] || TICKET_TYPES.other;
    return `${type.prefix}-${String(ticketNumber).padStart(3, '0')}`;
}
async function createTicketFromModal(interaction, ticketTypeKey, subject, details) {
    const type = TICKET_TYPES[ticketTypeKey];
    if (!type) {
        await respondToInteraction(interaction, { content: 'Unknown ticket type.' });
        return true;
    }
    const guild = interaction.guild;
    if (!guild) {
        await respondToInteraction(interaction, { content: 'This ticket action must be used inside a server.' });
        return true;
    }
    await deferEphemeralInteraction(interaction);
    try {
        const config = await getSupportConfig(guild.id);
        const ticketsCategory = await resolveTrackedChannelAsync(guild, config, 'tickets');
        if (!ticketsCategory || ticketsCategory.type !== discord_js_1.ChannelType.GuildCategory) {
            await respondToInteraction(interaction, { content: 'The support ticket category is not configured. Ask a Global Admin to run `?setupserver`, `?serversetup`, or `?repairserver`.' });
            return true;
        }
        const ticketNumber = await incrementCounter(guild.id, 'ticket_counter');
        config.ticketCounter = Math.max(config.ticketCounter || 0, ticketNumber);
        const channel = await guild.channels.create({
            name: ticketChannelName(ticketTypeKey, ticketNumber),
            type: discord_js_1.ChannelType.GuildText,
            parent: ticketsCategory.id,
            permissionOverwrites: buildTicketPermissions(config, interaction.user.id, ticketTypeKey).map(entry => entry.id === '0' ? { ...entry, id: guild.roles.everyone.id } : entry),
            topic: `${type.label} | Opened by ${interaction.user.tag} | Ticket #${ticketNumber}`,
            reason: REASON
        });
        const db = (0, database_1.getDB)();
        const timestamp = nowTs();
        const insert = await db.run(`INSERT INTO support_tickets
        (guild_id, ticket_number, channel_id, opener_id, ticket_type, status, priority, subject, details_text, claimed_by, request_status, internal_notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'OPEN', 'medium', ?, ?, NULL, ?, '', ?, ?)`, guild.id, ticketNumber, channel.id, interaction.user.id, ticketTypeKey, subject, details, ticketTypeKey === 'add_bot_request' ? 'pending' : null, timestamp, timestamp);
        await db.run('INSERT INTO support_ticket_members (ticket_id, user_id, added_by, added_at) VALUES (?, ?, ?, ?)', insert.lastID, interaction.user.id, interaction.user.id, timestamp).catch(() => null);
        const intro = new discord_js_1.EmbedBuilder()
            .setColor(ticketTypeKey === 'bug_report' || ticketTypeKey === 'error_support' ? 0xDC2626 : 0x2563EB)
            .setTitle(`${type.label} | Ticket #${ticketNumber}`)
            .setDescription('Staff commands: `?ticket claim`, `?ticket close [reason]`, `?ticket transcript`, `?ticket priority <low|medium|high|urgent>`, `?ticket move <type>`')
            .addFields({ name: 'Opened By', value: `<@${interaction.user.id}>`, inline: true }, { name: 'Status', value: 'OPEN', inline: true }, { name: 'Priority', value: 'medium', inline: true }, { name: 'Subject', value: subject.slice(0, 1024), inline: false }, { name: 'Details', value: details.slice(0, 1024), inline: false });
        if (ticketTypeKey === 'add_bot_request') {
            intro.addFields({ name: 'Request Status', value: 'pending', inline: true });
        }
        await channel.send({ content: `${interaction.user} ${config.roleIds.support_team ? `<@&${config.roleIds.support_team}>` : ''}`.trim(), embeds: [intro] });
        await logTicketEvent(guild, config, 'Ticket Created', [
            { name: 'Ticket', value: `${channel} (#${ticketNumber})`, inline: true },
            { name: 'Type', value: type.label, inline: true },
            { name: 'Opened By', value: `<@${interaction.user.id}>`, inline: true }
        ]);
        await respondToInteraction(interaction, { content: `Ticket created: ${channel}` });
    }
    catch (error) {
        await respondToInteraction(interaction, { content: (error?.message || 'Failed to create the ticket.').slice(0, 1900) });
    }
    return true;
}
async function handleTicketOpenButton(interaction, ticketTypeKey) {
    const type = TICKET_TYPES[ticketTypeKey];
    if (!type) {
        await interaction.reply({ content: 'Unknown ticket type.', flags: discord_js_1.MessageFlags.Ephemeral });
        return true;
    }
    try {
        const modal = new discord_js_1.ModalBuilder()
            .setCustomId(`support_modal:${ticketTypeKey}`)
            .setTitle(`Open ${type.label}`);
        const subjectInput = new discord_js_1.TextInputBuilder().setCustomId('ticket_subject').setLabel('Short subject').setStyle(discord_js_1.TextInputStyle.Short).setMinLength(3).setMaxLength(100).setRequired(true).setPlaceholder(sanitizeTextInputPlaceholder(type.label, 'Ticket subject'));
        const detailInput = new discord_js_1.TextInputBuilder().setCustomId('ticket_details').setLabel('Required details').setStyle(discord_js_1.TextInputStyle.Paragraph).setMinLength(10).setMaxLength(1500).setRequired(true).setPlaceholder(sanitizeTextInputPlaceholder(type.detailPrompt, 'Add the details here.'));
        modal.addComponents(new discord_js_1.ActionRowBuilder().addComponents(subjectInput), new discord_js_1.ActionRowBuilder().addComponents(detailInput));
        await interaction.showModal(modal);
    }
    catch (_a) {
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'Failed to open the ticket form. Try again.', flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => null);
        }
    }
    return true;
}
async function fetchTicketContext(message) {
    const config = await getSupportConfig(message.guild.id);
    const ticket = await getTicketByChannelId(message.channel.id);
    return { config, ticket: ticket || null };
}
async function generateTranscript(channel) {
    let lastId = null;
    const all = [];
    for (let i = 0; i < 5; i++) {
        const batch = await channel.messages.fetch({ limit: 100, before: lastId || undefined }).catch(() => null);
        if (!batch || !batch.size)
            break;
        all.push(...[...batch.values()]);
        lastId = batch.last().id;
        if (batch.size < 100)
            break;
    }
    const ordered = all.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    const lines = ordered.map(msg => {
        const timestamp = new Date(msg.createdTimestamp).toISOString();
        const content = (msg.content || '').replace(/\r?\n/g, ' ').trim();
        const attachments = msg.attachments.size ? ` [attachments: ${[...msg.attachments.values()].map(file => file.url).join(', ')}]` : '';
        return `[${timestamp}] ${msg.author.tag}: ${content || '[embed/button/no text]'}${attachments}`;
    });
    return Buffer.from(lines.join('\n') || 'No messages found.', 'utf8');
}
async function handleTicketCommand(message, args) {
    const action = (args.shift() || '').toLowerCase();
    if (!action) {
        await message.reply('Usage: `?ticket claim|unclaim|close|reopen|transcript|rename|add|remove|priority|move`');
        return true;
    }
    const { config, ticket } = await fetchTicketContext(message);
    if (!ticket) {
        await message.reply('This command must be used inside a tracked support ticket channel.');
        return true;
    }
    if (!isSupportStaffMember(message.member, config)) {
        await message.reply('Only support staff can manage tickets.');
        return true;
    }
    const db = (0, database_1.getDB)();
    const channel = message.channel;
    if (action === 'claim') {
        await db.run('UPDATE support_tickets SET claimed_by = ?, updated_at = ? WHERE id = ?', message.author.id, nowTs(), ticket.id);
        await message.reply(`Ticket claimed by ${message.author}.`);
        await logTicketEvent(message.guild, config, 'Ticket Claimed', [{ name: 'Ticket', value: `${channel}`, inline: true }, { name: 'Claimed By', value: `<@${message.author.id}>`, inline: true }]);
        return true;
    }
    if (action === 'unclaim') {
        await db.run('UPDATE support_tickets SET claimed_by = NULL, updated_at = ? WHERE id = ?', nowTs(), ticket.id);
        await message.reply('Ticket claim cleared.');
        await logTicketEvent(message.guild, config, 'Ticket Unclaimed', [{ name: 'Ticket', value: `${channel}`, inline: true }, { name: 'By', value: `<@${message.author.id}>`, inline: true }]);
        return true;
    }
    if (action === 'close') {
        const reason = args.join(' ').trim() || 'No reason provided.';
        const archiveCategory = resolveTrackedChannel(message.guild, config, 'archive');
        await channel.permissionOverwrites.edit(ticket.opener_id, { ViewChannel: true, SendMessages: false, AddReactions: false }, { reason: REASON }).catch(() => null);
        if (archiveCategory?.type === discord_js_1.ChannelType.GuildCategory) {
            await channel.setParent(archiveCategory.id, { lockPermissions: false }).catch(() => null);
        }
        await channel.setName(`closed-${channel.name}`.slice(0, 100)).catch(() => null);
        await db.run('UPDATE support_tickets SET status = ?, closed_at = ?, closed_by = ?, updated_at = ? WHERE id = ?', 'CLOSED', nowTs(), message.author.id, nowTs(), ticket.id);
        await message.reply(`Ticket closed. Reason: ${reason}`);
        await logTicketEvent(message.guild, config, 'Ticket Closed', [{ name: 'Ticket', value: `${channel}`, inline: true }, { name: 'Closed By', value: `<@${message.author.id}>`, inline: true }, { name: 'Reason', value: reason.slice(0, 1024), inline: false }]);
        return true;
    }
    if (action === 'reopen') {
        const ticketsCategory = resolveTrackedChannel(message.guild, config, 'tickets');
        await channel.permissionOverwrites.edit(ticket.opener_id, { ViewChannel: true, SendMessages: true, AddReactions: true }, { reason: REASON }).catch(() => null);
        if (ticketsCategory?.type === discord_js_1.ChannelType.GuildCategory) {
            await channel.setParent(ticketsCategory.id, { lockPermissions: false }).catch(() => null);
        }
        const desiredName = ticketChannelName(ticket.ticket_type, ticket.ticket_number);
        if (channel.name !== desiredName) {
            await channel.setName(desiredName).catch(() => null);
        }
        await db.run('UPDATE support_tickets SET status = ?, closed_at = NULL, closed_by = NULL, updated_at = ? WHERE id = ?', 'OPEN', nowTs(), ticket.id);
        await message.reply('Ticket reopened.');
        await logTicketEvent(message.guild, config, 'Ticket Reopened', [{ name: 'Ticket', value: `${channel}`, inline: true }, { name: 'By', value: `<@${message.author.id}>`, inline: true }]);
        return true;
    }
    if (action === 'transcript') {
        const transcript = await generateTranscript(channel);
        const attachment = new discord_js_1.AttachmentBuilder(transcript, { name: `${channel.name}-transcript.txt` });
        const archiveChannel = resolveTrackedChannel(message.guild, config, 'old_transcripts');
        let sent = null;
        if (archiveChannel?.isTextBased?.()) {
            sent = await archiveChannel.send({ content: `Transcript for ${channel}`, files: [attachment] }).catch(() => null);
        }
        if (!sent) {
            sent = await message.reply({ files: [attachment] }).catch(() => null);
        }
        await db.run('UPDATE support_tickets SET transcript_message_id = ?, updated_at = ? WHERE id = ?', sent?.id || null, nowTs(), ticket.id);
        await logTicketEvent(message.guild, config, 'Ticket Transcript Exported', [{ name: 'Ticket', value: `${channel}`, inline: true }, { name: 'By', value: `<@${message.author.id}>`, inline: true }, { name: 'Saved', value: sent ? 'yes' : 'no', inline: true }]);
        return true;
    }
    if (action === 'rename') {
        const newName = args.join('-').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 90);
        if (!newName) {
            await message.reply('Usage: `?ticket rename <new-name>`');
            return true;
        }
        await channel.setName(newName).catch(() => null);
        await message.reply(`Ticket renamed to \`${newName}\`.`);
        await logTicketEvent(message.guild, config, 'Ticket Renamed', [{ name: 'Ticket', value: `${channel}`, inline: true }, { name: 'New Name', value: newName, inline: true }, { name: 'By', value: `<@${message.author.id}>`, inline: true }]);
        return true;
    }
    if (action === 'add' || action === 'remove') {
        const user = message.mentions.users.first();
        if (!user) {
            await message.reply(`Usage: \`?ticket ${action} @user\``);
            return true;
        }
        if (action === 'add') {
            await channel.permissionOverwrites.edit(user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true, EmbedLinks: true }, { reason: REASON }).catch(() => null);
            await db.run('INSERT OR IGNORE INTO support_ticket_members (ticket_id, user_id, added_by, added_at) VALUES (?, ?, ?, ?)', ticket.id, user.id, message.author.id, nowTs());
            await message.reply(`Added ${user} to the ticket.`);
            await logTicketEvent(message.guild, config, 'Ticket Member Added', [{ name: 'Ticket', value: `${channel}`, inline: true }, { name: 'User', value: `<@${user.id}>`, inline: true }, { name: 'By', value: `<@${message.author.id}>`, inline: true }]);
            return true;
        }
        await channel.permissionOverwrites.delete(user.id, REASON).catch(() => null);
        await db.run('DELETE FROM support_ticket_members WHERE ticket_id = ? AND user_id = ?', ticket.id, user.id);
        await message.reply(`Removed ${user} from the ticket.`);
        await logTicketEvent(message.guild, config, 'Ticket Member Removed', [{ name: 'Ticket', value: `${channel}`, inline: true }, { name: 'User', value: `<@${user.id}>`, inline: true }, { name: 'By', value: `<@${message.author.id}>`, inline: true }]);
        return true;
    }
    if (action === 'priority') {
        const priority = (args[0] || '').toLowerCase();
        if (!['low', 'medium', 'high', 'urgent'].includes(priority)) {
            await message.reply('Usage: `?ticket priority <low|medium|high|urgent>`');
            return true;
        }
        await db.run('UPDATE support_tickets SET priority = ?, updated_at = ? WHERE id = ?', priority, nowTs(), ticket.id);
        await message.reply(`Ticket priority set to **${priority}**.`);
        await logTicketEvent(message.guild, config, 'Ticket Priority Updated', [{ name: 'Ticket', value: `${channel}`, inline: true }, { name: 'Priority', value: priority, inline: true }, { name: 'By', value: `<@${message.author.id}>`, inline: true }]);
        return true;
    }
    if (action === 'move') {
        const typeArg = (args[0] || '').toLowerCase().replace(/-/g, '_');
        if (!TICKET_TYPES[typeArg]) {
            await message.reply(`Usage: \`?ticket move <${Object.keys(TICKET_TYPES).join('|')}>\``);
            return true;
        }
        const newName = ticketChannelName(typeArg, ticket.ticket_number);
        await db.run('UPDATE support_tickets SET ticket_type = ?, updated_at = ? WHERE id = ?', typeArg, nowTs(), ticket.id);
        await channel.setName(newName).catch(() => null);
        await channel.permissionOverwrites.set(buildTicketPermissions(config, ticket.opener_id, typeArg).map(entry => entry.id === '0' ? { ...entry, id: message.guild.roles.everyone.id } : entry), REASON).catch(() => null);
        await message.reply(`Ticket type moved to **${TICKET_TYPES[typeArg].label}**.`);
        await logTicketEvent(message.guild, config, 'Ticket Type Updated', [{ name: 'Ticket', value: `${channel}`, inline: true }, { name: 'Type', value: TICKET_TYPES[typeArg].label, inline: true }, { name: 'By', value: `<@${message.author.id}>`, inline: true }]);
        return true;
    }
    await message.reply('Unknown ticket action.');
    return true;
}
async function handleRequestCommand(message, args) {
    const action = (args.shift() || '').toLowerCase();
    const { config, ticket } = await fetchTicketContext(message);
    if (!ticket || ticket.ticket_type !== 'add_bot_request') {
        await message.reply('This command only works inside an Add Bot Request ticket.');
        return true;
    }
    if (!isSupportStaffMember(message.member, config)) {
        await message.reply('Only support staff can manage add-bot request tickets.');
        return true;
    }
    const db = (0, database_1.getDB)();
    if (action === 'status') {
        await message.reply(`Current request status: **${ticket.request_status || 'pending'}**`);
        return true;
    }
    if (action === 'approve' || action === 'deny' || action === 'moreinfo') {
        const nextStatus = action === 'approve' ? 'approved' : (action === 'deny' ? 'denied' : 'more-info-needed');
        const note = args.join(' ').trim();
        await db.run('UPDATE support_tickets SET request_status = ?, updated_at = ? WHERE id = ?', nextStatus, nowTs(), ticket.id);
        await message.reply(`Request status updated to **${nextStatus}**.${note ? ` ${note}` : ''}`);
        await logTicketEvent(message.guild, config, 'Request Status Updated', [{ name: 'Ticket', value: `${message.channel}`, inline: true }, { name: 'Status', value: nextStatus, inline: true }, { name: 'By', value: `<@${message.author.id}>`, inline: true }, { name: 'Note', value: note || 'None', inline: false }]);
        return true;
    }
    if (action === 'note') {
        const noteText = args.join(' ').trim();
        if (!noteText) {
            await message.reply('Usage: `?request note <text>`');
            return true;
        }
        const combined = `${ticket.internal_notes || ''}${ticket.internal_notes ? '\n' : ''}[${new Date().toISOString()}] ${message.author.tag}: ${noteText}`;
        await db.run('UPDATE support_tickets SET internal_notes = ?, updated_at = ? WHERE id = ?', combined, nowTs(), ticket.id);
        await message.reply('Internal request note saved.');
        await logTicketEvent(message.guild, config, 'Request Note Added', [{ name: 'Ticket', value: `${message.channel}`, inline: true }, { name: 'By', value: `<@${message.author.id}>`, inline: true }, { name: 'Note', value: noteText.slice(0, 1024), inline: false }]);
        return true;
    }
    await message.reply('Usage: `?request approve|deny <reason>|moreinfo <message>|note <text>|status`');
    return true;
}
async function handleSuggestCommand(message, args) {
    const text = args.join(' ').trim();
    if (!text) {
        await message.reply('Usage: `?suggest <idea>`');
        return true;
    }
    const config = await getSupportConfig(message.guild.id);
    const suggestionChannel = await resolveTrackedChannelAsync(message.guild, config, 'feature_suggestions');
    if (!isSendableTextChannel(suggestionChannel)) {
        await message.reply('The feature suggestions channel is not configured. Ask a Global Admin to run `?repairserver`.');
        return true;
    }
    const number = await incrementCounter(message.guild.id, 'suggestion_counter');
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0x7C3AED)
        .setTitle(`Suggestion #${number}`)
        .setDescription(text.slice(0, 4096))
        .addFields({ name: 'Author', value: `<@${message.author.id}>`, inline: true }, { name: 'Status', value: 'pending', inline: true });
    const sent = await suggestionChannel.send({ embeds: [embed] });
    await sent.react('👍').catch(() => null);
    await sent.react('👎').catch(() => null);
    const db = (0, database_1.getDB)();
    await db.run('INSERT INTO support_suggestions (guild_id, suggestion_number, author_id, channel_id, message_id, content, status, note_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', message.guild.id, number, message.author.id, suggestionChannel.id, sent.id, text, 'pending', '', nowTs(), nowTs());
    await message.reply(`Suggestion #${number} posted in ${suggestionChannel}.`);
    return true;
}
async function updateSuggestionMessage(guild, row) {
    if (!row.channel_id || !row.message_id) {
        return;
    }
    const channel = guild.channels.cache.get(row.channel_id) || await guild.channels.fetch(row.channel_id).catch(() => null);
    if (!channel?.isTextBased?.() || !channel.messages?.fetch) {
        return;
    }
    const message = await channel.messages.fetch(row.message_id).catch(() => null);
    if (!message) {
        return;
    }
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(row.status === 'added' ? 0x16A34A : row.status === 'denied' ? 0xDC2626 : row.status === 'in progress' ? 0x2563EB : row.status === 'planned' ? 0xF59E0B : 0x7C3AED)
        .setTitle(`Suggestion #${row.suggestion_number}`)
        .setDescription(row.content.slice(0, 4096))
        .addFields({ name: 'Author', value: `<@${row.author_id}>`, inline: true }, { name: 'Status', value: row.status, inline: true });
    if (row.note_text) {
        embed.addFields({ name: 'Staff Note', value: row.note_text.slice(0, 1024), inline: false });
    }
    await message.edit({ embeds: [embed] }).catch(() => null);
}
async function handleSuggestionCommand(message, args) {
    const statusKeyword = (args.shift() || '').toLowerCase();
    const number = parseInt(args.shift() || '', 10);
    if (!['pending', 'planned', 'progress', 'added', 'deny'].includes(statusKeyword) || !Number.isFinite(number)) {
        await message.reply('Usage: `?suggestion pending|planned|progress|added|deny <id> [reason]`');
        return true;
    }
    const config = await getSupportConfig(message.guild.id);
    if (!isSupportStaffMember(message.member, config)) {
        await message.reply('Only support staff can update suggestion statuses.');
        return true;
    }
    const normalizedStatus = statusKeyword === 'progress' ? 'in progress' : (statusKeyword === 'deny' ? 'denied' : statusKeyword);
    if (!SUGGESTION_STATUSES.has(normalizedStatus)) {
        await message.reply('Invalid suggestion status.');
        return true;
    }
    const note = args.join(' ').trim();
    const db = (0, database_1.getDB)();
    const row = await db.get('SELECT * FROM support_suggestions WHERE guild_id = ? AND suggestion_number = ?', message.guild.id, number);
    if (!row) {
        await message.reply(`Suggestion #${number} was not found.`);
        return true;
    }
    await db.run('UPDATE support_suggestions SET status = ?, note_text = ?, updated_at = ? WHERE id = ?', normalizedStatus, note, nowTs(), row.id);
    const updated = await db.get('SELECT * FROM support_suggestions WHERE id = ?', row.id);
    await updateSuggestionMessage(message.guild, updated);
    await message.reply(`Suggestion #${number} updated to **${normalizedStatus}**.`);
    return true;
}
async function handleRoadmapCommand(message) {
    const db = (0, database_1.getDB)();
    const rows = await db.all(`SELECT suggestion_number, content, status
        FROM support_suggestions
        WHERE guild_id = ? AND status IN ('planned', 'in progress', 'added')
        ORDER BY CASE status WHEN 'planned' THEN 1 WHEN 'in progress' THEN 2 ELSE 3 END, suggestion_number DESC`, message.guild.id);
    const grouped = { planned: [], 'in progress': [], added: [] };
    for (const row of rows) {
        grouped[row.status]?.push(`• #${row.suggestion_number} ${row.content.slice(0, 90)}`);
    }
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0x15803D)
        .setTitle(`Roadmap: ${message.guild.name}`)
        .addFields({ name: 'Planned', value: grouped.planned.join('\n') || 'Nothing marked planned.', inline: false }, { name: 'In Progress', value: grouped['in progress'].join('\n') || 'Nothing in progress.', inline: false }, { name: 'Added', value: grouped.added.join('\n') || 'Nothing marked added yet.', inline: false });
    await message.reply({ embeds: [embed] });
    return true;
}
async function handleBugCommand(message, args) {
    const raw = args.join(' ').trim();
    if (!raw) {
        await message.reply('Usage: `?bug <title> | <what happened>`');
        return true;
    }
    const split = raw.split('|');
    const title = (split.shift() || raw).trim().slice(0, 120);
    const description = (split.join('|').trim() || raw).slice(0, 4000);
    const config = await getSupportConfig(message.guild.id);
    const bugChannel = await resolveTrackedChannelAsync(message.guild, config, 'bug_reports');
    if (!isSendableTextChannel(bugChannel)) {
        await message.reply('The bug reports channel is not configured. Ask a Global Admin to run `?repairserver`.');
        return true;
    }
    const number = await incrementCounter(message.guild.id, 'bug_counter');
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0xDC2626)
        .setTitle(`Bug #${number}: ${title}`)
        .setDescription(description)
        .addFields({ name: 'Author', value: `<@${message.author.id}>`, inline: true }, { name: 'Status', value: 'open', inline: true }, { name: 'Severity', value: 'medium', inline: true });
    const sent = await bugChannel.send({ embeds: [embed] });
    const db = (0, database_1.getDB)();
    await db.run('INSERT INTO support_bug_reports (guild_id, bug_number, author_id, channel_id, message_id, title, description_text, status, severity, note_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', message.guild.id, number, message.author.id, bugChannel.id, sent.id, title, description, 'open', 'medium', '', nowTs(), nowTs());
    await message.reply(`Bug #${number} posted in ${bugChannel}.`);
    return true;
}
async function updateBugMessage(guild, row) {
    if (!row.channel_id || !row.message_id) {
        return;
    }
    const channel = guild.channels.cache.get(row.channel_id) || await guild.channels.fetch(row.channel_id).catch(() => null);
    if (!channel?.isTextBased?.() || !channel.messages?.fetch) {
        return;
    }
    const message = await channel.messages.fetch(row.message_id).catch(() => null);
    if (!message) {
        return;
    }
    const color = row.status === 'fixed' ? 0x16A34A : row.status === 'closed' ? 0x6B7280 : row.status === 'in progress' ? 0x2563EB : row.status === 'investigating' ? 0xF59E0B : 0xDC2626;
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(color)
        .setTitle(`Bug #${row.bug_number}: ${row.title}`)
        .setDescription(row.description_text.slice(0, 4096))
        .addFields({ name: 'Author', value: `<@${row.author_id}>`, inline: true }, { name: 'Status', value: row.status, inline: true }, { name: 'Severity', value: row.severity, inline: true });
    if (row.note_text) {
        embed.addFields({ name: 'Staff Note', value: row.note_text.slice(0, 1024), inline: false });
    }
    await message.edit({ embeds: [embed] }).catch(() => null);
}
async function handleBugStatusCommand(message, args) {
    const number = parseInt(args.shift() || '', 10);
    const status = args.join(' ').trim().toLowerCase();
    if (!Number.isFinite(number) || !BUG_STATUSES.has(status)) {
        await message.reply('Usage: `?bugstatus <id> <open|investigating|in progress|fixed|cannot reproduce|closed>`');
        return true;
    }
    const config = await getSupportConfig(message.guild.id);
    if (!isSupportStaffMember(message.member, config)) {
        await message.reply('Only support staff can update bug status.');
        return true;
    }
    const db = (0, database_1.getDB)();
    const row = await db.get('SELECT * FROM support_bug_reports WHERE guild_id = ? AND bug_number = ?', message.guild.id, number);
    if (!row) {
        await message.reply(`Bug #${number} was not found.`);
        return true;
    }
    await db.run('UPDATE support_bug_reports SET status = ?, updated_at = ? WHERE id = ?', status, nowTs(), row.id);
    const updated = await db.get('SELECT * FROM support_bug_reports WHERE id = ?', row.id);
    await updateBugMessage(message.guild, updated);
    await message.reply(`Bug #${number} status set to **${status}**.`);
    return true;
}
async function handleBugSeverityCommand(message, args) {
    const number = parseInt(args.shift() || '', 10);
    const severity = (args.shift() || '').toLowerCase();
    if (!Number.isFinite(number) || !BUG_SEVERITIES.has(severity)) {
        await message.reply('Usage: `?bugseverity <id> <low|medium|high|critical>`');
        return true;
    }
    const config = await getSupportConfig(message.guild.id);
    if (!isSupportStaffMember(message.member, config)) {
        await message.reply('Only support staff can update bug severity.');
        return true;
    }
    const db = (0, database_1.getDB)();
    const row = await db.get('SELECT * FROM support_bug_reports WHERE guild_id = ? AND bug_number = ?', message.guild.id, number);
    if (!row) {
        await message.reply(`Bug #${number} was not found.`);
        return true;
    }
    await db.run('UPDATE support_bug_reports SET severity = ?, updated_at = ? WHERE id = ?', severity, nowTs(), row.id);
    const updated = await db.get('SELECT * FROM support_bug_reports WHERE id = ?', row.id);
    await updateBugMessage(message.guild, updated);
    await message.reply(`Bug #${number} severity set to **${severity}**.`);
    return true;
}
async function handleBugListCommand(message) {
    const db = (0, database_1.getDB)();
    const rows = await db.all('SELECT bug_number, title, status, severity FROM support_bug_reports WHERE guild_id = ? ORDER BY CASE status WHEN "open" THEN 1 WHEN "investigating" THEN 2 WHEN "in progress" THEN 3 ELSE 4 END, bug_number DESC LIMIT 25', message.guild.id);
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0xDC2626)
        .setTitle(`Bug List: ${message.guild.name}`)
        .setDescription(rows.length ? rows.map(row => `• #${row.bug_number} [${row.severity}] [${row.status}] ${row.title}`).join('\n') : 'No bugs tracked yet.');
    await message.reply({ embeds: [embed] });
    return true;
}
async function handleBugNoteCommand(message, args) {
    const number = parseInt(args.shift() || '', 10);
    const note = args.join(' ').trim();
    if (!Number.isFinite(number) || !note) {
        await message.reply('Usage: `?bugnote <id> <note>`');
        return true;
    }
    const config = await getSupportConfig(message.guild.id);
    if (!isSupportStaffMember(message.member, config)) {
        await message.reply('Only support staff can update bug notes.');
        return true;
    }
    const db = (0, database_1.getDB)();
    const row = await db.get('SELECT * FROM support_bug_reports WHERE guild_id = ? AND bug_number = ?', message.guild.id, number);
    if (!row) {
        await message.reply(`Bug #${number} was not found.`);
        return true;
    }
    await db.run('UPDATE support_bug_reports SET note_text = ?, updated_at = ? WHERE id = ?', note, nowTs(), row.id);
    const updated = await db.get('SELECT * FROM support_bug_reports WHERE id = ?', row.id);
    await updateBugMessage(message.guild, updated);
    await message.reply(`Bug #${number} note updated.`);
    return true;
}
async function handleWarnCommand(message, args) {
    const config = await getSupportConfig(message.guild.id);
    if (!areGlobalModCommandsEnabled(config)) {
        return false;
    }
    if (!isGlobalModerationMember(message.member, config)) {
        return false;
    }
    const target = getMentionedMember(message, args[0]);
    const reason = args.slice(target ? 1 : 0).join(' ').trim();
    if (!target || !reason) {
        await message.reply('Usage: `?warn @user <reason>`');
        return true;
    }
    await message.reply(await executeWarnAction(message.guild, config, message.author.id, target, reason));
    return true;
}
async function handleTimeoutCommand(message, args) {
    const config = await getSupportConfig(message.guild.id);
    if (!areGlobalModCommandsEnabled(config)) {
        return false;
    }
    if (!isGlobalModerationMember(message.member, config)) {
        return false;
    }
    const target = getMentionedMember(message, args[0]);
    const reason = args.slice(2).join(' ').trim() || 'No reason provided.';
    if (!target || !args[1]) {
        await message.reply('Usage: `?timeout @user <10m|1h|1d> <reason>`');
        return true;
    }
    await message.reply(await executeTimeoutAction(message.guild, config, message.author.id, target, args[1], reason));
    return true;
}
async function handleMuteCommand(message, args, remove) {
    const config = await getSupportConfig(message.guild.id);
    if (!areGlobalModCommandsEnabled(config)) {
        return false;
    }
    if (!isGlobalModerationMember(message.member, config)) {
        return false;
    }
    const target = getMentionedMember(message, args[0]);
    const reason = args.slice(target ? 1 : 0).join(' ').trim() || 'No reason provided.';
    if (!target) {
        await message.reply(`Usage: \`${remove ? '?unmute' : '?mute'} @user [reason]\``);
        return true;
    }
    await message.reply(await executeMuteAction(message.guild, config, message.author.id, target, reason, remove));
    return true;
}
async function handleKickCommand(message, args) {
    const config = await getSupportConfig(message.guild.id);
    if (!areGlobalModCommandsEnabled(config)) {
        return false;
    }
    if (!isGlobalModerationMember(message.member, config)) {
        return false;
    }
    const target = getMentionedMember(message, args[0]);
    const reason = args.slice(target ? 1 : 0).join(' ').trim() || 'No reason provided.';
    if (!target) {
        await message.reply('Usage: `?kick @user <reason>`');
        return true;
    }
    await message.reply(await executeKickAction(message.guild, config, message.author.id, target, reason));
    return true;
}
async function handleBanCommand(message, args) {
    const config = await getSupportConfig(message.guild.id);
    if (!areGlobalModCommandsEnabled(config)) {
        return false;
    }
    if (!isGlobalModerationMember(message.member, config)) {
        return false;
    }
    const target = getMentionedMember(message, args[0]);
    const reason = args.slice(target ? 1 : 0).join(' ').trim() || 'No reason provided.';
    if (!target) {
        await message.reply('Usage: `?ban @user <reason>`');
        return true;
    }
    await message.reply(await executeBanAction(message.guild, config, message.author.id, target, reason));
    return true;
}
async function handlePurgeCommand(message, args) {
    const config = await getSupportConfig(message.guild.id);
    if (!areGlobalModCommandsEnabled(config)) {
        return false;
    }
    if (!isGlobalModerationMember(message.member, config)) {
        return false;
    }
    const amount = parseInt(args[0] || '', 10);
    if (!Number.isFinite(amount) || amount < 1 || amount > 100) {
        await message.reply('Usage: `?purge <1-100>`');
        return true;
    }
    const result = await executePurgeAction(message.guild, config, message.author.id, message.channel, amount).catch(async (error) => {
        await message.channel.send(error.message).catch(() => null);
        return null;
    });
    if (!result) {
        return true;
    }
    const confirmation = await message.channel.send(result.text).catch(() => null);
    if (confirmation) {
        setTimeout(() => confirmation.delete().catch(() => null), 5000);
    }
    return true;
}
const GLOBAL_ALIASES = new Set(['setupserver', 'serversetup', 'repairserver', 'rebuildserver', 'setupstatus', 'sendpanels', 'sendmodpanel', 'modpanel', 'modcmdservers', 'mcservers', 'samod', 'superadminmod', 'setupsupportserver', 'setupmanagerserver', 'cmsetup']);
async function handleGlobalCommand(message, command, args) {
    try {
        if (!(0, utils_1.isGlobalAdmin)(message.author.id) || !GLOBAL_ALIASES.has(command)) {
            return false;
        }
        if (['setupserver', 'serversetup', 'setupsupportserver', 'setupmanagerserver', 'cmsetup'].includes(command)) {
            return handleSetupServerCommand(message);
        }
        if (command === 'repairserver') {
            return handleRepairServerCommand(message);
        }
        if (command === 'rebuildserver') {
            return handleRebuildServerCommand(message);
        }
        if (command === 'setupstatus') {
            return handleSetupStatusCommand(message);
        }
        if (command === 'sendpanels') {
            return handleSendPanelsCommand(message);
        }
        if (command === 'sendmodpanel' || command === 'modpanel') {
            return handleSendModPanelCommand(message);
        }
        if (command === 'modcmdservers' || command === 'mcservers') {
            return handleModCommandServersCommand(message);
        }
        if (command === 'samod' || command === 'superadminmod') {
            return handleSuperAdminModCommand(message);
        }
        return false;
    }
    catch (error) {
        console.error('Support global command failed:', error);
        await safeReply(message, `Support command failed: ${(error?.message || 'Unknown error.').slice(0, 1800)}`);
        return true;
    }
}
exports.handleGlobalCommand = handleGlobalCommand;
async function handleCommand(message, command, args) {
    try {
        if (!message.guild) {
            return false;
        }
        if (command === 'warn') {
            return handleWarnCommand(message, args);
        }
        if (command === 'timeout') {
            return handleTimeoutCommand(message, args);
        }
        if (command === 'mute') {
            return handleMuteCommand(message, args, false);
        }
        if (command === 'unmute') {
            return handleMuteCommand(message, args, true);
        }
        if (command === 'kick') {
            return handleKickCommand(message, args);
        }
        if (command === 'ban') {
            return handleBanCommand(message, args);
        }
        if (command === 'purge') {
            return handlePurgeCommand(message, args);
        }
        if (command === 'ticket') {
            return handleTicketCommand(message, args);
        }
        if (command === 'request') {
            return handleRequestCommand(message, args);
        }
        if (command === 'suggest') {
            return handleSuggestCommand(message, args);
        }
        if (command === 'suggestion') {
            return handleSuggestionCommand(message, args);
        }
        if (command === 'roadmap') {
            return handleRoadmapCommand(message);
        }
        if (command === 'bug') {
            return handleBugCommand(message, args);
        }
        if (command === 'bugstatus') {
            return handleBugStatusCommand(message, args);
        }
        if (command === 'bugseverity') {
            return handleBugSeverityCommand(message, args);
        }
        if (command === 'buglist') {
            return handleBugListCommand(message);
        }
        if (command === 'bugnote') {
            return handleBugNoteCommand(message, args);
        }
        return false;
    }
    catch (error) {
        console.error(`Support command "${command}" failed:`, error);
        await safeReply(message, `Support command failed: ${(error?.message || 'Unknown error.').slice(0, 1800)}`);
        return true;
    }
}
exports.handleCommand = handleCommand;
async function handleModPanelSelect(interaction) {
    const config = await getSupportConfig(interaction.guild.id);
    if (!isGlobalModerationMember(interaction.member, config)) {
        await interaction.reply({ content: 'Only authorized users can use this moderation panel.', flags: discord_js_1.MessageFlags.Ephemeral });
        return true;
    }
    const action = interaction.values?.[0];
    if (!['warn', 'timeout', 'mute', 'unmute', 'kick', 'ban', 'purge'].includes(action || '')) {
        await interaction.reply({ content: 'Unknown moderation action.', flags: discord_js_1.MessageFlags.Ephemeral });
        return true;
    }
    const modal = new discord_js_1.ModalBuilder().setCustomId(`support_mod_modal:${action}`).setTitle(`Moderation: ${action}`);
    const rows = [];
    if (action === 'purge') {
        rows.push(new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.TextInputBuilder()
            .setCustomId('purge_amount')
            .setLabel('Messages to purge (1-100)')
            .setStyle(discord_js_1.TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('25')));
        rows.push(new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.TextInputBuilder()
            .setCustomId('target_channel')
            .setLabel('Target channel ID or mention')
            .setStyle(discord_js_1.TextInputStyle.Short)
            .setRequired(false)
            .setPlaceholder(`#${interaction.channel?.name || 'current-channel'}`)));
    }
    else {
        rows.push(new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.TextInputBuilder()
            .setCustomId('target_user')
            .setLabel('Target user ID or mention')
            .setStyle(discord_js_1.TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('@user or 1234567890')));
        if (action === 'timeout') {
            rows.push(new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.TextInputBuilder()
                .setCustomId('duration')
                .setLabel('Duration')
                .setStyle(discord_js_1.TextInputStyle.Short)
                .setRequired(true)
                .setPlaceholder('10m, 1h, 1d')));
        }
        rows.push(new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.TextInputBuilder()
            .setCustomId('reason')
            .setLabel(action === 'warn' ? 'Reason' : 'Reason (optional)')
            .setStyle(discord_js_1.TextInputStyle.Paragraph)
            .setRequired(action === 'warn')
            .setMaxLength(1000)
            .setPlaceholder(action === 'warn' ? 'Explain the warning.' : 'Optional reason')));
    }
    modal.addComponents(...rows);
    await interaction.showModal(modal);
    return true;
}
async function handleModPanelModal(interaction) {
    if (!interaction.guild) {
        await respondToInteraction(interaction, { content: 'This moderation panel only works inside a server.' });
        return true;
    }
    const config = await getSupportConfig(interaction.guild.id);
    if (!isGlobalModerationMember(interaction.member, config)) {
        await respondToInteraction(interaction, { content: 'Only authorized users can use this moderation panel.' });
        return true;
    }
    const action = interaction.customId.split(':')[1];
    if (!areGlobalModCommandsEnabled(config)) {
        await respondToInteraction(interaction, { content: 'Global moderation commands are disabled in this server. Use `?modcmdservers` to enable them again.' });
        return true;
    }
    await deferEphemeralInteraction(interaction);
    try {
        let responseText = '';
        if (action === 'purge') {
            const amount = parseInt(interaction.fields.getTextInputValue('purge_amount').trim(), 10);
            if (!Number.isFinite(amount) || amount < 1 || amount > 100) {
                await respondToInteraction(interaction, { content: 'Purge amount must be between 1 and 100.' });
                return true;
            }
            const channelRaw = interaction.fields.getTextInputValue('target_channel').trim();
            const targetChannel = channelRaw ? await resolveChannelIdentifier(interaction.guild, channelRaw) : interaction.channel;
            const result = await executePurgeAction(interaction.guild, config, interaction.user.id, targetChannel, amount);
            responseText = result.text;
        }
        else {
            const targetRaw = interaction.fields.getTextInputValue('target_user').trim();
            const target = await resolveMemberIdentifier(interaction.guild, targetRaw);
            if (!target) {
                await respondToInteraction(interaction, { content: 'Target member not found in this server.' });
                return true;
            }
            const reasonField = interaction.fields.fields.has('reason') ? interaction.fields.getTextInputValue('reason').trim() : '';
            const reason = reasonField || 'No reason provided.';
            if (action === 'warn') {
                responseText = await executeWarnAction(interaction.guild, config, interaction.user.id, target, reasonField);
            }
            else if (action === 'timeout') {
                const duration = interaction.fields.getTextInputValue('duration').trim();
                responseText = await executeTimeoutAction(interaction.guild, config, interaction.user.id, target, duration, reason);
            }
            else if (action === 'mute') {
                responseText = await executeMuteAction(interaction.guild, config, interaction.user.id, target, reason, false);
            }
            else if (action === 'unmute') {
                responseText = await executeMuteAction(interaction.guild, config, interaction.user.id, target, reason, true);
            }
            else if (action === 'kick') {
                responseText = await executeKickAction(interaction.guild, config, interaction.user.id, target, reason);
            }
            else if (action === 'ban') {
                responseText = await executeBanAction(interaction.guild, config, interaction.user.id, target, reason);
            }
            else {
                await respondToInteraction(interaction, { content: 'Unknown moderation action.' });
                return true;
            }
        }
        await respondToInteraction(interaction, { content: responseText });
    }
    catch (error) {
        await respondToInteraction(interaction, { content: (error?.message || 'Moderation action failed.').slice(0, 1900) });
    }
    return true;
}
async function handleInteraction(interaction) {
    const customId = typeof interaction?.customId === 'string' ? interaction.customId : '';
    const handled = customId.startsWith('support_open:')
        || customId === 'support_modpanel_action'
        || customId.startsWith('support_modal:')
        || customId.startsWith('support_mod_modal:');
    if (!handled) {
        return false;
    }
    try {
        if (interaction.isButton()) {
            if (customId.startsWith('support_open:')) {
                const type = customId.split(':')[1];
                return await handleTicketOpenButton(interaction, type);
            }
            return false;
        }
        if (interaction.isStringSelectMenu()) {
            if (customId === 'support_modpanel_action') {
                return await handleModPanelSelect(interaction);
            }
            return false;
        }
        if (interaction.isModalSubmit()) {
            if (customId.startsWith('support_modal:')) {
                const type = customId.split(':')[1];
                const subject = interaction.fields.getTextInputValue('ticket_subject').trim();
                const details = interaction.fields.getTextInputValue('ticket_details').trim();
                return await createTicketFromModal(interaction, type, subject, details);
            }
            if (customId.startsWith('support_mod_modal:')) {
                return await handleModPanelModal(interaction);
            }
            return false;
        }
        return false;
    }
    catch (error) {
        await replyInteractionError(interaction, 'Support interaction', error);
        return true;
    }
}
exports.handleInteraction = handleInteraction;
