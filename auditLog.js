"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.appendAutomaticAdminAuditLog = appendAutomaticAdminAuditLog;
exports.appendAdminAuditLog = appendAdminAuditLog;
exports.getAdminAuditLogs = getAdminAuditLogs;
exports.auditEmitter = void 0;
const database_1 = require("./database");
const events_1 = require("events");

exports.auditEmitter = new events_1.EventEmitter();
const MANUAL_AUDIT_COMMANDS = new Set([
    'addtoteam',
    'addusertoteam',
    'clearroster',
    'clearset',
    'freewin',
    'removefromteam',
    'removematch',
    'resetmatchsystem',
    'resetseason',
    'setowner',
    'setpurse',
    'setpurseall',
    'setupsupportserver',
    'unroster',
    'unsell'
]);
const SKIP_AUTOMATIC_AUDIT_COMMANDS = new Set([
    'alog',
    'auditlogtoggle',
    'auditlog',
    'botstatus',
    'botservers',
    'bs',
    'cmdstats',
    'commandstats',
    'cusage',
    'diag',
    'findhcemoji',
    'hcfindemoji',
    'fhe',
    'hcemojimap',
    'hcemojis',
    'hcmap',
    'healthcheck',
    'hchistory',
    'la',
    'listadmins',
    'listpingers',
    'listpublicpings',
    'listscheduled',
    'lp',
    'lpp',
    'lsdm',
    'regteams',
    'reservequeue',
    'reservesleft',
    'rleft',
    'rq',
    'playerlogtoggle',
    'savedhc',
    'setauditlogchannel',
    'setplayerlogchannel',
    'setteamlogchannel',
    'listhc'
]);

function normalizeAuditText(value, maxLength = 400) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text)
        return '';
    return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}
function normalizeCommandName(commandName) {
    return String(commandName || '').trim().toLowerCase();
}
async function appendAdminAuditLog({ guildId, actorId, commandName, summary, targetSummary = null, channelId = null }) {
    const normalizedSummary = normalizeAuditText(summary, 1000);
    if (!guildId || !actorId || !commandName || !normalizedSummary) {
        return;
    }
    const db = (0, database_1.getDB)();
    await db.run(`INSERT INTO admin_audit_logs (guild_id, actor_id, command_name, summary, target_summary, channel_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, guildId, actorId, String(commandName).toLowerCase(), normalizedSummary, normalizeAuditText(targetSummary, 300) || null, channelId || null, Math.floor(Date.now() / 1000));
    
    exports.auditEmitter.emit('log', { guildId, actorId, commandName, summary: normalizedSummary, targetSummary });
}
async function appendAutomaticAdminAuditLog({ guildId, actorId, commandName, args = [], targetSummary = null, channelId = null, summary = null, force = false }) {
    const normalizedCommand = normalizeCommandName(commandName);
    if (!guildId || !actorId || !normalizedCommand) {
        return false;
    }
    if (!force) {
        if (MANUAL_AUDIT_COMMANDS.has(normalizedCommand) || SKIP_AUTOMATIC_AUDIT_COMMANDS.has(normalizedCommand)) {
            return false;
        }
    }
    const argsText = Array.isArray(args)
        ? normalizeAuditText(args.join(' '), 300)
        : normalizeAuditText(args, 300);
    await appendAdminAuditLog({
        guildId,
        actorId,
        commandName: normalizedCommand,
        summary: summary || (argsText
            ? `Invoked admin command \`${normalizedCommand}\` with arguments.`
            : `Invoked admin command \`${normalizedCommand}\`.`),
        targetSummary: targetSummary || argsText || null,
        channelId
    });
    return true;
}
async function getAdminAuditLogs(guildId, limit = 20) {
    const db = (0, database_1.getDB)();
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    return db.all(`SELECT id, guild_id, actor_id, command_name, summary, target_summary, channel_id, created_at
        FROM admin_audit_logs
        WHERE guild_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?`, guildId, safeLimit);
}
