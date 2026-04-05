"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const discord_js_1 = require("discord.js");
const dotenv_1 = __importDefault(require("dotenv"));
const crypto_1 = require("crypto");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const database_1 = require("./database");
const auditLog_1 = require("./auditLog");
const commands_1 = require("./commands");
const auctionManager_1 = require("./auctionManager");
const utils_1 = require("./utils");
const pointTable_1 = require("./pointTable");
const matchSystem_1 = require("./matchSystem");
const tradeSystem_1 = require("./tradeSystem");
const iplPredictionSystem_1 = require("./iplPredictionSystem");
const supportServerSystem_1 = require("./supportServerSystem");
dotenv_1.default.config();
const client = new discord_js_1.Client({
    intents: [
        discord_js_1.GatewayIntentBits.Guilds,
        discord_js_1.GatewayIntentBits.GuildMessages,
        discord_js_1.GatewayIntentBits.GuildMessageReactions,
        discord_js_1.GatewayIntentBits.MessageContent,
        discord_js_1.GatewayIntentBits.GuildMembers
    ],
    partials: [discord_js_1.Partials.Channel, discord_js_1.Partials.Message, discord_js_1.Partials.Reaction, discord_js_1.Partials.User]
});
let presenceRefreshTimer = null;
let presenceRefreshInFlight = false;
function wrapAsyncEventHandler(label, handler) {
    return async (...args) => {
        try {
            await handler(...args);
        }
        catch (error) {
            console.error(`${label} handler failed:`, error);
        }
    };
}
async function refreshDynamicBotPresence() {
    if (!client.user || presenceRefreshInFlight) {
        return;
    }
    presenceRefreshInFlight = true;
    try {
        const serverCount = client.guilds.cache.size;
        const memberCount = client.guilds.cache.reduce((total, guild) => total + (Number(guild.memberCount) || 0), 0);
        await client.user.setPresence({
            activities: [{
                    type: discord_js_1.ActivityType.Watching,
                    name: `Powering ${memberCount} users across ${serverCount} servers`
                }],
            status: 'online'
        });
    }
    catch (error) {
        console.error('Failed to refresh bot presence:', error);
    }
    finally {
        presenceRefreshInFlight = false;
    }
}
function scheduleDynamicBotPresenceRefresh(delayMs = 5000) {
    if (presenceRefreshTimer) {
        clearTimeout(presenceRefreshTimer);
    }
    presenceRefreshTimer = setTimeout(() => {
        presenceRefreshTimer = null;
        refreshDynamicBotPresence().catch((error) => console.error('Deferred presence refresh failed:', error));
    }, delayMs);
}
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
});
client.on('error', (error) => {
    console.error('Discord client error:', error);
});
client.on('shardError', (error) => {
    console.error('Discord shard error:', error);
});
client.on('warn', (warning) => {
    console.warn('Discord client warning:', warning);
});
client.on('guildCreate', () => {
    scheduleDynamicBotPresenceRefresh(3000);
});
client.on('guildDelete', () => {
    scheduleDynamicBotPresenceRefresh(3000);
});
client.on('guildMemberAdd', () => {
    scheduleDynamicBotPresenceRefresh(15000);
});
client.on('guildMemberRemove', () => {
    scheduleDynamicBotPresenceRefresh(15000);
});
const DB_FILE_PATH = path_1.default.resolve(__dirname, 'auction_v2.sqlite');
const BACKUP_ROOT_DIR = path_1.default.join(__dirname, 'backups');
const DAILY_BACKUP_DIR = path_1.default.join(BACKUP_ROOT_DIR, 'daily');
const MANUAL_BACKUP_DIR = path_1.default.join(BACKUP_ROOT_DIR, 'manual');
const EXPORT_BACKUP_DIR = path_1.default.join(BACKUP_ROOT_DIR, 'exports');
const DISCORD_ATTACHMENT_LIMIT_BYTES = 25 * 1024 * 1024;
const DAILY_BACKUP_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const DAILY_BACKUP_RETENTION_COUNT = 14;
const MANUAL_BACKUP_RETENTION_COUNT = 20;
const EXPORT_BACKUP_RETENTION_COUNT = 10;
const SUPPORT_SERVER_SETUP_REASON = 'Cheesy Manager support server bootstrap';
const HC_CRICKET_BOT_ID = '753191385296928808';
exports.HC_CRICKET_BOT_ID = HC_CRICKET_BOT_ID;
const HC_CRICKET_SAVED_EMBED_LIMIT = 30;
const HC_CRICKET_SCAN_BATCH_SIZE = 100;
const HC_CRICKET_SCAN_MAX_MESSAGES = 5000;
const HC_AUTO_RAW_RETENTION_DAYS = 14;
const HC_TIMELINE_EMOJI_MAP = Object.freeze({
    emoji_29: 0,
    emoji_28: 1,
    emoji_30: 2,
    emoji_31: 3,
    emoji_32: 4,
    emoji_33: 5,
    emoji_34: 6,
    emoji_35: 'wicket'
});
exports.HC_TIMELINE_EMOJI_MAP = HC_TIMELINE_EMOJI_MAP;
const HC_POWERPLAY_TIMELINE_MAP = Object.freeze({
    'PP*_emoji_30': 1,
    'PP*_emoji_31': 2,
    'PP*_emoji_32': 3,
    'PP*_emoji_33': 4
});
let backupOperationInProgress = false;
function normalizeGuildTimeZone(timeZone) {
    return !timeZone || timeZone === 'IST' ? 'Asia/Kolkata' : timeZone;
}
function ensureDirectory(dirPath) {
    if (!fs_1.default.existsSync(dirPath)) {
        fs_1.default.mkdirSync(dirPath, { recursive: true });
    }
}
function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 1024) {
        return `${bytes || 0} B`;
    }
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex++;
    }
    return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}
function getUtcDateStamp(date = new Date()) {
    return date.toISOString().slice(0, 10);
}
function getTimestampStamp(date = new Date()) {
    return date.toISOString().replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z');
}
function toRelativeBackupPath(filePath) {
    return path_1.default.relative(__dirname, filePath).replace(/\\/g, '/');
}
function toSqlitePathLiteral(filePath) {
    return path_1.default.resolve(filePath).replace(/\\/g, '/').replace(/'/g, "''");
}
async function withBackupLock(task) {
    if (backupOperationInProgress) {
        throw new Error('A backup or export is already running. Try again in a moment.');
    }
    backupOperationInProgress = true;
    try {
        return await task();
    }
    finally {
        backupOperationInProgress = false;
    }
}
function pruneBackupDirectory(dirPath, retainCount) {
    try {
        if (!fs_1.default.existsSync(dirPath))
            return;
        const files = fs_1.default.readdirSync(dirPath)
            .filter(name => name.endsWith('.sqlite'))
            .map(name => {
            const fullPath = path_1.default.join(dirPath, name);
            const stat = fs_1.default.statSync(fullPath);
            return { fullPath, mtimeMs: stat.mtimeMs };
        })
            .sort((a, b) => b.mtimeMs - a.mtimeMs);
        for (const file of files.slice(retainCount)) {
            fs_1.default.unlinkSync(file.fullPath);
        }
    }
    catch (error) {
        console.error('Failed to prune backup directory:', error);
    }
}
async function createDatabaseSnapshotAt(filePath) {
    return withBackupLock(async () => {
        if ((0, database_1.getDBKind)() === 'postgres') {
            throw new Error('Disk snapshot backups are disabled for Supabase/PostgreSQL. Use Supabase project backups or SQL exports instead.');
        }
        ensureDirectory(path_1.default.dirname(filePath));
        if (fs_1.default.existsSync(filePath)) {
            fs_1.default.unlinkSync(filePath);
        }
        const db = (0, database_1.getDB)();
        try {
            await db.exec('PRAGMA wal_checkpoint(FULL)');
        }
        catch (_a) {
        }
        let usedFallback = false;
        try {
            await db.exec(`VACUUM INTO '${toSqlitePathLiteral(filePath)}'`);
        }
        catch (vacuumError) {
            usedFallback = true;
            try {
                if (fs_1.default.existsSync(filePath)) {
                    fs_1.default.unlinkSync(filePath);
                }
                fs_1.default.copyFileSync(DB_FILE_PATH, filePath);
            }
            catch (_b) {
                throw vacuumError;
            }
        }
        const stat = fs_1.default.statSync(filePath);
        return {
            path: filePath,
            fileName: path_1.default.basename(filePath),
            relativePath: toRelativeBackupPath(filePath),
            sizeBytes: stat.size,
            createdAt: Math.floor(Date.now() / 1000),
            usedFallback
        };
    });
}
async function createTimestampedSnapshot(dirPath, prefix) {
    ensureDirectory(dirPath);
    return createDatabaseSnapshotAt(path_1.default.join(dirPath, `${prefix}-${getTimestampStamp()}.sqlite`));
}
async function ensureDailyBackup() {
    ensureDirectory(DAILY_BACKUP_DIR);
    const dailyPath = path_1.default.join(DAILY_BACKUP_DIR, `auction_v2-daily-${getUtcDateStamp()}.sqlite`);
    if (fs_1.default.existsSync(dailyPath)) {
        const stat = fs_1.default.statSync(dailyPath);
        return {
            created: false,
            path: dailyPath,
            fileName: path_1.default.basename(dailyPath),
            relativePath: toRelativeBackupPath(dailyPath),
            sizeBytes: stat.size,
            createdAt: Math.floor(stat.mtimeMs / 1000),
            usedFallback: false
        };
    }
    const snapshot = await createDatabaseSnapshotAt(dailyPath);
    pruneBackupDirectory(DAILY_BACKUP_DIR, DAILY_BACKUP_RETENTION_COUNT);
    return { created: true, ...snapshot };
}
function buildBackupEmbed(title, snapshot, description) {
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0x10B981)
        .setTitle(title)
        .setDescription(description)
        .addFields({ name: 'File', value: `\`${snapshot.fileName}\``, inline: true }, { name: 'Size', value: formatBytes(snapshot.sizeBytes), inline: true }, { name: 'Saved At', value: `<t:${snapshot.createdAt}:F>`, inline: true }, { name: 'Location', value: `\`${snapshot.relativePath}\``, inline: false });
    if (snapshot.usedFallback) {
        embed.addFields({ name: 'Snapshot Mode', value: 'Fallback file copy used because SQLite `VACUUM INTO` was unavailable.', inline: false });
    }
    return embed;
}
async function getGuildTimeZone(guildId) {
    const db = (0, database_1.getDB)();
    const settings = await db.get('SELECT timezone FROM guild_settings WHERE guild_id = ?', guildId);
    return normalizeGuildTimeZone(settings?.timezone);
}
function getTimeZoneOffsetMinutes(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        timeZoneName: 'shortOffset'
    }).formatToParts(date);
    const offsetName = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT+00:00';
    const match = offsetName.match(/([+-])(\d+):(\d+)/);
    if (!match)
        return 0;
    const sign = match[1] === '-' ? -1 : 1;
    return sign * ((parseInt(match[2], 10) * 60) + parseInt(match[3], 10));
}
function zonedDateTimeToUtcMs(year, month, day, hours, minutes, timeZone) {
    const utcGuess = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0));
    return utcGuess.getTime() - (getTimeZoneOffsetMinutes(utcGuess, timeZone) * 60000);
}
function getTimeZoneDateParts(date, timeZone) {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric'
    });
    const parts = formatter.formatToParts(date);
    const read = (type) => parseInt(parts.find(part => part.type === type)?.value || '0', 10);
    return {
        year: read('year'),
        month: read('month'),
        day: read('day')
    };
}
function parseTeamRenameDeadlineInput(rawInput, timeZone) {
    const normalized = (rawInput || '').trim().replace(/,/g, ' ').replace(/\s+/g, ' ').toLowerCase();
    const match = normalized.match(/^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (!match)
        return null;
    const months = {
        jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
        may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
        oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
    };
    const day = parseInt(match[1], 10);
    const month = months[match[2]];
    if (!month || day < 1 || day > 31)
        return null;
    let hours = parseInt(match[4], 10);
    const minutes = parseInt(match[5] || '0', 10);
    const meridiem = match[6] ? match[6].toLowerCase() : null;
    if (minutes < 0 || minutes > 59)
        return null;
    if (meridiem && hours >= 1 && hours <= 12) {
        if (meridiem === 'pm' && hours < 12)
            hours += 12;
        if (meridiem === 'am' && hours === 12)
            hours = 0;
    }
    else if (hours > 23) {
        return null;
    }
    const now = new Date();
    const todayParts = getTimeZoneDateParts(now, timeZone);
    let year = match[3] ? parseInt(match[3], 10) : todayParts.year;
    let utcMs = zonedDateTimeToUtcMs(year, month, day, hours, minutes, timeZone);
    if (!match[3] && utcMs <= now.getTime()) {
        year += 1;
        utcMs = zonedDateTimeToUtcMs(year, month, day, hours, minutes, timeZone);
    }
    const resolvedParts = getTimeZoneDateParts(new Date(utcMs), timeZone);
    if (resolvedParts.year !== year || resolvedParts.month !== month || resolvedParts.day !== day)
        return null;
    if (!Number.isFinite(utcMs) || utcMs <= now.getTime())
        return null;
    return utcMs;
}
async function formatGuildDateTime(guildId, timestamp) {
    const timeZone = await getGuildTimeZone(guildId);
    return `${new Intl.DateTimeFormat('en-US', {
        timeZone,
        dateStyle: 'medium',
        timeStyle: 'short'
    }).format(new Date(timestamp))} (${timeZone})`;
}
async function notifyCaptainsAboutRenameWindow(guild, content) {
    const db = (0, database_1.getDB)();
    const rows = await db.all('SELECT DISTINCT captain_discord_id FROM team_captains WHERE guild_id = ? AND captain_discord_id IS NOT NULL', guild.id);
    let sent = 0;
    let failed = 0;
    for (const row of rows) {
        try {
            const user = await guild.client.users.fetch(row.captain_discord_id);
            await user.send(`Server update for **${guild.name}**:\n${content}`);
            sent++;
        }
        catch (_a) {
            failed++;
        }
    }
    return { sent, failed };
}
function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts = [];
    if (days)
        parts.push(`${days}d`);
    if (hours || parts.length)
        parts.push(`${hours}h`);
    if (minutes || parts.length)
        parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);
    return parts.join(' ');
}
function getHealthIcon(level) {
    switch (level) {
        case 'ok':
            return '✅';
        case 'warning':
            return '⚠️';
        case 'issue':
            return '❌';
        default:
            return 'ℹ️';
    }
}
function pushHealthLine(lines, counters, level, label, detail) {
    if (level === 'warning')
        counters.warnings++;
    if (level === 'issue')
        counters.issues++;
    lines.push(`${getHealthIcon(level)} **${label}:** ${detail}`);
}
function resolveChannelCheck(guild, channelId, unconfiguredLevel = 'info') {
    if (!channelId) {
        return { level: unconfiguredLevel, detail: 'Not configured' };
    }
    const channel = guild.channels.cache.get(channelId);
    if (channel) {
        return { level: 'ok', detail: `${channel}` };
    }
    return { level: 'issue', detail: `Configured channel is missing (\`${channelId}\`)` };
}
function resolveRoleCheck(guild, roleId, unconfiguredLevel = 'info') {
    if (!roleId) {
        return { level: unconfiguredLevel, detail: 'Not configured' };
    }
    const role = guild.roles.cache.get(roleId);
    if (role) {
        return { level: 'ok', detail: `${role}` };
    }
    return { level: 'issue', detail: `Configured role is missing (\`${roleId}\`)` };
}
async function recordCommandUsage(guildId, command) {
    if (!guildId || !command)
        return;
    const db = (0, database_1.getDB)();
    const now = Math.floor(Date.now() / 1000);
    await db.run(`INSERT INTO command_usage_stats (guild_id, command_name, usage_count, first_used_at, last_used_at)
        VALUES (?, ?, 1, ?, ?)
        ON CONFLICT(guild_id, command_name) DO UPDATE SET
            usage_count = command_usage_stats.usage_count + 1,
            last_used_at = excluded.last_used_at`, guildId, command, now, now);
}
function parseSaveHcEmbedsCount(args) {
    const rawCount = args.find(arg => /^\d+$/.test(arg));
    const parsedCount = rawCount ? parseInt(rawCount, 10) : 1;
    if (!Number.isInteger(parsedCount))
        return 1;
    return Math.min(HC_CRICKET_SAVED_EMBED_LIMIT, Math.max(1, parsedCount));
}
function parseSaveHcEmbedsInlineNote(args) {
    const noteText = args
        .filter(arg => !/^\d+$/.test(arg) && !/^<#\d+>$/.test(arg))
        .join(' ')
        .trim();
    return noteText ? noteText.slice(0, 500) : null;
}
async function resolveSaveHcEmbedsChannel(message) {
    const mentionedChannel = message.mentions.channels.first();
    if (mentionedChannel?.isTextBased?.() && 'messages' in mentionedChannel) {
        return mentionedChannel;
    }
    return message.channel?.isTextBased?.() && 'messages' in message.channel ? message.channel : null;
}
async function pruneSavedHcEmbeds(guildId) {
    const db = (0, database_1.getDB)();
    const rows = await db.all(`SELECT id
        FROM hc_cricket_saved_embeds
        WHERE guild_id = ?
        ORDER BY saved_at DESC, id DESC`, guildId);
    const extras = rows.slice(HC_CRICKET_SAVED_EMBED_LIMIT);
    for (const row of extras) {
        await db.run('DELETE FROM hc_cricket_saved_embeds WHERE id = ?', row.id);
    }
}
async function collectSavedHcCandidates(channel, requestedCount) {
    const candidates = [];
    let scannedMessageCount = 0;
    let beforeMessageId = null;
    while (scannedMessageCount < HC_CRICKET_SCAN_MAX_MESSAGES && candidates.length < requestedCount) {
        const remaining = HC_CRICKET_SCAN_MAX_MESSAGES - scannedMessageCount;
        const fetchLimit = Math.min(HC_CRICKET_SCAN_BATCH_SIZE, remaining);
        const fetchedMessages = await channel.messages.fetch(beforeMessageId ? { limit: fetchLimit, before: beforeMessageId } : { limit: fetchLimit }).catch(() => null);
        if (!fetchedMessages || fetchedMessages.size === 0) {
            break;
        }
        const batchMessages = [...fetchedMessages.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
        scannedMessageCount += batchMessages.length;
        beforeMessageId = batchMessages[batchMessages.length - 1]?.id || null;
        for (const sourceMessage of batchMessages) {
            if (sourceMessage.author?.id !== HC_CRICKET_BOT_ID) {
                continue;
            }
            const messageContent = sourceMessage.content?.trim();
            const messageEmbeds = Array.isArray(sourceMessage.embeds) ? sourceMessage.embeds : [];
            if (!messageContent && messageEmbeds.length === 0) {
                continue;
            }
            if (candidates.length < requestedCount) {
                const primaryEmbed = messageEmbeds[0] || null;
                candidates.push({
                    sourceMessage,
                    embedIndex: 0,
                    title: primaryEmbed?.title || (messageContent ? 'Text Message' : 'HC Message'),
                    description: primaryEmbed?.description || (messageContent ? messageContent.slice(0, 200) : null),
                    payloadJson: JSON.stringify({
                        kind: 'message',
                        content: messageContent || '',
                        embeds: messageEmbeds.map(embed => embed.toJSON())
                    })
                });
            }
            if (candidates.length >= requestedCount) {
                break;
            }
        }
    }
    return { candidates, scannedMessageCount };
}
async function collectSingleSavedHcCandidateFromReply(message) {
    if (!message.reference?.messageId) {
        return null;
    }
    const referencedMessage = await message.fetchReference().catch(() => null);
    if (!referencedMessage || referencedMessage.author?.id !== HC_CRICKET_BOT_ID) {
        return null;
    }
    const messageContent = referencedMessage.content?.trim();
    const messageEmbeds = Array.isArray(referencedMessage.embeds) ? referencedMessage.embeds : [];
    if (!messageContent && messageEmbeds.length === 0) {
        return null;
    }
    const primaryEmbed = messageEmbeds[0] || null;
    return {
        candidates: [{
                sourceMessage: referencedMessage,
                embedIndex: 0,
                title: primaryEmbed?.title || (messageContent ? 'Text Message' : 'HC Message'),
                description: primaryEmbed?.description || (messageContent ? messageContent.slice(0, 200) : null),
                payloadJson: JSON.stringify({
                    kind: 'message',
                    content: messageContent || '',
                    embeds: messageEmbeds.map(embed => embed.toJSON())
                })
            }],
        scannedMessageCount: 1,
        usedReplyTarget: true
    };
}
async function getActiveHcAnalysisSession(guildId, channelId) {
    const db = (0, database_1.getDB)();
    return await db.get(`SELECT *
        FROM hc_analysis_sessions
        WHERE guild_id = ? AND channel_id = ? AND status = 'ACTIVE'
        ORDER BY started_at DESC, id DESC
        LIMIT 1`, guildId, channelId);
}
async function handleAnalyseHcBotCommand(message, args) {
    if (!message.guild || !message.channel?.isTextBased?.()) {
        return true;
    }
    const activeSession = await getActiveHcAnalysisSession(message.guild.id, message.channel.id);
    if (activeSession) {
        await message.reply(`HC analysis is already active in ${message.channel}. End it with \`?endanalyse\` first.`);
        return true;
    }
    const db = (0, database_1.getDB)();
    const now = Math.floor(Date.now() / 1000);
    const noteText = args.join(' ').trim().slice(0, 500) || null;
    const result = await db.run(`INSERT INTO hc_analysis_sessions (
            guild_id, channel_id, started_by, note_text, status, started_at
        ) VALUES (?, ?, ?, ?, 'ACTIVE', ?)`, message.guild.id, message.channel.id, message.author.id, noteText, now);
    await message.reply(`HC analysis started in ${message.channel}.\nTrusted bot: <@${HC_CRICKET_BOT_ID}>\nSession ID: \`${result.lastID}\`\n${noteText ? `Note: ${noteText}\n` : ''}Run \`?endanalyse\` here when the match is done.`);
    return true;
}
async function handleEndAnalyseHcBotCommand(message) {
    if (!message.guild || !message.channel?.isTextBased?.()) {
        return true;
    }
    const activeSession = await getActiveHcAnalysisSession(message.guild.id, message.channel.id);
    if (!activeSession) {
        await message.reply('No active HC analysis session is running in this channel.');
        return true;
    }
    const db = (0, database_1.getDB)();
    const now = Math.floor(Date.now() / 1000);
    const endedStatus = `ENDED_${activeSession.id}`;
    await db.run(`UPDATE hc_analysis_sessions
        SET status = ?, ended_at = ?
        WHERE id = ?`, endedStatus, now, activeSession.id);
    const totals = await db.get(`SELECT COUNT(*) as total,
            COALESCE(SUM(embed_count), 0) as embeds
        FROM hc_analysis_messages
        WHERE session_id = ?`, activeSession.id);
    const firstLast = await db.get(`SELECT
            MIN(source_created_at) as first_at,
            MAX(source_created_at) as last_at
        FROM hc_analysis_messages
        WHERE session_id = ?`, activeSession.id);
    const summaryEmbed = new discord_js_1.EmbedBuilder()
        .setColor(0xF59E0B)
        .setTitle('HC Analysis Ended')
        .setDescription(`Stopped capturing trusted HC bot traffic in ${message.channel}.`)
        .addFields({ name: 'Session ID', value: `\`${activeSession.id}\``, inline: true }, { name: 'Captured Messages', value: `**${totals?.total || 0}**`, inline: true }, { name: 'Captured Embeds', value: `**${totals?.embeds || 0}**`, inline: true }, { name: 'First Source Message', value: firstLast?.first_at ? `<t:${firstLast.first_at}:f>` : 'None', inline: true }, { name: 'Last Source Message', value: firstLast?.last_at ? `<t:${firstLast.last_at}:f>` : 'None', inline: true }, { name: 'Session Note', value: activeSession.note_text || 'None', inline: false })
        .setFooter({ text: 'You can ask me to analyze this captured session in depth now.' });
    await message.reply({ embeds: [summaryEmbed] });
    return true;
}
async function handleRecoverHcMatchCommand(message) {
    if (!message.guild || !message.channel?.isTextBased?.()) {
        return true;
    }
    if (!(0, utils_1.isSuperAdmin)(message.member)) {
        await message.reply('Only Super Admins and Global Admins can use this command.');
        return true;
    }
    if (!message.reference?.messageId) {
        await message.reply('Reply to the HC bot match-start message and run `?hcrecover`.');
        return true;
    }
    const referencedMessage = await message.fetchReference().catch(() => null);
    if (!referencedMessage || referencedMessage.author?.id !== HC_CRICKET_BOT_ID) {
        await message.reply('The replied message must be an HC Cricket bot message in this channel.');
        return true;
    }
    if (referencedMessage.channelId !== message.channel.id) {
        await message.reply('Run the recovery command in the same channel as the replied HC message.');
        return true;
    }
    const startPayload = buildHcMessagePayload(referencedMessage);
    if (!isHcAutoRelevantPayload(startPayload) || !isHcAutoMatchStartPayload(startPayload)) {
        await message.reply('The replied HC message is not a valid match-start message for recovery.');
        return true;
    }
    const startedAt = Math.floor((referencedMessage.createdTimestamp || Date.now()) / 1000);
    const db = (0, database_1.getDB)();
    const existingSavedMatch = await db.get(`SELECT id, status, finalized_at,
            (SELECT COUNT(*)
             FROM hc_matchup_match_log
             WHERE match_id = hc_auto_matches.id) AS matchup_rows
        FROM hc_auto_matches
        WHERE guild_id = ? AND channel_id = ? AND ABS(started_at - ?) <= 300
        ORDER BY ABS(started_at - ?) ASC
        LIMIT 1`, message.guild.id, message.channel.id, startedAt, startedAt);
    if (existingSavedMatch && (existingSavedMatch.finalized_at || Number(existingSavedMatch.matchup_rows || 0) > 0)) {
        await message.reply(`That HC match is already saved as Match ID \`${existingSavedMatch.id}\` with **${existingSavedMatch.matchup_rows || 0}** saved matchup row(s). If it was deleted with \`?hcdelete\`, you can run recovery again after that delete.`);
        return true;
    }
    const activeMatch = await getActiveHcAutoMatch(message.guild.id, message.channel.id);
    if (activeMatch && Math.abs(Number(activeMatch.started_at || 0) - startedAt) > 300) {
        await message.reply(`Another HC auto-match is still active in this channel (Match ID \`${activeMatch.id}\`). Resolve that first before running recovery.`);
        return true;
    }
    const progressMessage = await message.reply('Recovering HC match history from the replied start message. Scanning forward in this channel...');
    const recovery = await collectHcRecoveryMessages(referencedMessage);
    let processedMessages = 0;
    for (const sourceMessage of recovery.messages) {
        await captureHcAutoMessageVersion(sourceMessage, 'recovery');
        processedMessages += 1;
    }
    const recoveredMatch = await db.get(`SELECT id, status, finalized_at, ended_at
        FROM hc_auto_matches
        WHERE guild_id = ? AND channel_id = ? AND ABS(started_at - ?) <= 300
        ORDER BY ABS(started_at - ?) ASC
        LIMIT 1`, message.guild.id, message.channel.id, startedAt, startedAt);
    if (recoveredMatch?.finalized_at) {
        await progressMessage.edit(`Recovered **${processedMessages}** HC bot message(s) after scanning **${recovery.totalScanned}** channel message(s).\nSaved as Match ID \`${recoveredMatch.id}\`.`).catch(() => null);
        return true;
    }
    if (!recovery.reachedMatchEnd) {
        await progressMessage.edit(`Scanned **${recovery.totalScanned}** channel message(s) and processed **${processedMessages}** HC bot message(s), but no match-end message was found yet. The match was not finalized.`).catch(() => null);
        return true;
    }
    await progressMessage.edit(`Processed **${processedMessages}** HC bot message(s). Recovery finished, but no finalized match row was found. Check logs if the summary message did not appear.`).catch(() => null);
    return true;
}
async function captureHcAnalysisMessage(message) {
    if (!message.guild?.id || !message.channel?.id || message.author.id !== HC_CRICKET_BOT_ID) {
        return;
    }
    const activeSession = await getActiveHcAnalysisSession(message.guild.id, message.channel.id);
    if (!activeSession) {
        return;
    }
    const payloadJson = JSON.stringify({
        content: message.content || '',
        embeds: Array.isArray(message.embeds) ? message.embeds.map(embed => embed.toJSON()) : []
    });
    const db = (0, database_1.getDB)();
    const sourceCreatedAt = Math.floor((message.createdTimestamp || Date.now()) / 1000);
    const capturedAt = Math.floor(Date.now() / 1000);
    await db.run(`INSERT INTO hc_analysis_messages (
            session_id, guild_id, channel_id, source_message_id, source_author_id,
            content_text, embed_count, payload_json, source_created_at, captured_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id, source_message_id) DO NOTHING`, activeSession.id, message.guild.id, message.channel.id, message.id, message.author.id, message.content || null, Array.isArray(message.embeds) ? message.embeds.length : 0, payloadJson, sourceCreatedAt, capturedAt);
}
function buildHcMessagePayload(message) {
    return {
        content: message.content || '',
        embeds: Array.isArray(message.embeds) ? message.embeds.map(embed => embed.toJSON()) : []
    };
}
async function collectHcRecoveryMessages(startMessage, maxMessages = 5000) {
    const collectedMessages = [startMessage];
    let totalScanned = 0;
    let cursorId = startMessage.id;
    let reachedMatchEnd = isHcAutoMatchEndPayload(buildHcMessagePayload(startMessage));
    while (!reachedMatchEnd && totalScanned < maxMessages) {
        const batch = await startMessage.channel.messages.fetch({ limit: 100, after: cursorId }).catch(() => null);
        if (!batch || !batch.size) {
            break;
        }
        const orderedBatch = [...batch.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
        totalScanned += orderedBatch.length;
        for (const sourceMessage of orderedBatch) {
            cursorId = sourceMessage.id;
            if (sourceMessage.author?.id !== HC_CRICKET_BOT_ID) {
                continue;
            }
            collectedMessages.push(sourceMessage);
            if (isHcAutoMatchEndPayload(buildHcMessagePayload(sourceMessage))) {
                reachedMatchEnd = true;
                break;
            }
        }
        if (orderedBatch.length < 100) {
            break;
        }
    }
    return {
        messages: collectedMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp),
        totalScanned,
        reachedMatchEnd
    };
}
function buildHcPayloadHash(payloadJson) {
    return (0, crypto_1.createHash)('sha1').update(payloadJson).digest('hex');
}
function isHcAutoRelevantPayload(payload) {
    const relevantTitles = new Set([
        'Innings 1 has started!',
        'Innings 2 has started!',
        'Match Status',
        'After this over',
        'Batter out!',
        'Batter retired!',
        'Bowler retired!',
        'Team ALL OUT!',
        'Innings over!',
        'Result Scorecard',
        'Batting Summary',
        'Bowling Summary',
        'CRITICAL ERROR!'
    ]);
    const content = String(payload?.content || '');
    
    // Ignore system warnings, setup prompts (challenge/toss), and delete confirmations
    if (/you created a match you don't give a f\*\*k about/i.test(content) || 
        /are you sure you want to delete the match/i.test(content) ||
        /would like to challenge you/i.test(content) ||
        /has accepted the challenge/i.test(content) ||
        /choose heads or tails/i.test(content) ||
        /solo practice/i.test(content)) {
        return false;
    }
    
    const embeds = Array.isArray(payload?.embeds) ? payload.embeds : [];
    
    // Ignore matches explicitly marked as practice or solo
    if (embeds.some(embed => 
        /practice/i.test(embed.title || '') || /practice/i.test(embed.description || '') ||
        /solo/i.test(embed.title || '') || /solo/i.test(embed.description || '')
    )) {
        return false;
    }

    if (embeds.some(embed => relevantTitles.has(embed.title || ''))) {
        return true;
    }
    return /won the game/i.test(content) || /match has been abandoned/i.test(content);
}
function isHcAutoMatchStartPayload(payload) {
    const content = String(payload?.content || '');
    const embeds = Array.isArray(payload?.embeds) ? payload.embeds : [];
    const hasStartMessage = /Starting Elite Match! 🏟️/i.test(content) || /Starting Match! 🏟️/i.test(content);
    const hasInnings1Start = embeds.some(embed => (embed.title || '') === 'Innings 1 has started!');
    return hasStartMessage || hasInnings1Start;
}
function isHcAutoMatchEndPayload(payload) {
    const embeds = Array.isArray(payload?.embeds) ? payload.embeds : [];
    if (embeds.some(embed => (embed.title || '') === 'Result Scorecard')) {
        return true;
    }
    if (embeds.some(embed => (embed.title || '') === 'Innings over!'
        && Array.isArray(embed.fields)
        && embed.fields.some(field => cleanHcDisplayName(field.name) === 'The match is over!'))) {
        return true;
    }
    const content = String(payload?.content || '');
    return /won the game/i.test(content);
}
function isHcAutoMatchAbandonPayload(payload) {
    const embeds = Array.isArray(payload?.embeds) ? payload.embeds : [];
    if (embeds.some(embed => (embed.title || '') === 'CRITICAL ERROR!')) {
        return true;
    }
    const content = String(payload?.content || '');
    return /match has been abandoned/i.test(content);
}
function isHcAutoMatchPracticePayload(payload) {
    const content = String(payload?.content || '');
    const embeds = Array.isArray(payload?.embeds) ? payload.embeds : [];
    return /solo practice/i.test(content) || 
           embeds.some(embed => 
               /practice/i.test(embed.title || '') || 
               /practice/i.test(embed.description || '') ||
               /solo/i.test(embed.title || '')
           );
}
async function getActiveHcAutoMatch(guildId, channelId) {
    const db = (0, database_1.getDB)();
    return await db.get(`SELECT *
        FROM hc_auto_matches
        WHERE guild_id = ? AND channel_id = ? AND status = 'ACTIVE'
        ORDER BY id DESC
        LIMIT 1`, guildId, channelId);
}
async function getOrCreateHcAutoMatch(guildId, channelId, startedAt, payload) {
    const existing = await getActiveHcAutoMatch(guildId, channelId);
    if (existing) {
        return existing;
    }
    
    // Only start a NEW match if it matches the start triggers
    if (!isHcAutoMatchStartPayload(payload)) {
        return null;
    }

    const content = String(payload?.content || '');
    const embeds = Array.isArray(payload?.embeds) ? payload.embeds : [];
    const isAbandoned = /match has been abandoned/i.test(content) || 
                       embeds.some(embed => (embed.title || '') === 'CRITICAL ERROR!');
    const isPractice = isHcAutoMatchPracticePayload(payload);
    
    if (isAbandoned || isPractice) {
        return null;
    }

    const db = (0, database_1.getDB)();
    const createdAt = Math.max(1, startedAt || Math.floor(Date.now() / 1000));
    const result = await db.run(`INSERT INTO hc_auto_matches (
            guild_id, channel_id, status, started_at, updated_at
        ) VALUES (?, ?, 'ACTIVE', ?, ?)`, guildId, channelId, createdAt, createdAt);
    return await db.get('SELECT * FROM hc_auto_matches WHERE id = ?', result.lastID);
}
function buildTrackedHcSnapshots(matchId, rows) {
    const rawSnapshots = extractHcRelevantSnapshots(matchId, rows);
    const batterStateByInnings = new Map();
    const closedBattersByInnings = new Map();
    return rawSnapshots.map(snapshot => {
        const inningsKey = snapshot.innings || 0;
        if (!batterStateByInnings.has(inningsKey)) {
            batterStateByInnings.set(inningsKey, new Map());
        }
        if (!closedBattersByInnings.has(inningsKey)) {
            closedBattersByInnings.set(inningsKey, new Set());
        }
        const inningState = batterStateByInnings.get(inningsKey);
        const closedBatters = closedBattersByInnings.get(inningsKey);
        for (const batter of snapshot.batters || []) {
            if (!batter?.norm || closedBatters.has(batter.norm)) {
                continue;
            }
            const existingStats = inningState.get(batter.norm) || null;
            if (!existingStats) {
                inningState.set(batter.norm, cloneHcBatterStats(batter));
                continue;
            }
            inningState.set(batter.norm, {
                name: batter.name || existingStats.name,
                norm: batter.norm || existingStats.norm,
                runs: Math.max(existingStats.runs || 0, batter.runs || 0),
                balls: Math.max(existingStats.balls || 0, batter.balls || 0)
            });
        }
        const trackedBatterStatsByNorm = new Map();
        for (const [norm, stats] of inningState.entries()) {
            trackedBatterStatsByNorm.set(norm, cloneHcBatterStats(stats));
        }
        const trackedSnapshot = {
            ...snapshot,
            trackedBatterStatsByNorm
        };
        if (snapshot.exitedBatterNorm) {
            closedBatters.add(snapshot.exitedBatterNorm);
            inningState.delete(snapshot.exitedBatterNorm);
        }
        return trackedSnapshot;
    });
}
function buildHcInningsParticipantKey(matchId, inningsNumber, participantNorm) {
    return `${matchId}:${inningsNumber || 0}:${participantNorm || ''}`;
}
function buildHcDismissalKey(matchId, inningsNumber, batterNorm, bowlerNorm, batterStats) {
    return [
        matchId,
        inningsNumber || 0,
        batterNorm || '',
        bowlerNorm || '',
        batterStats?.runs || 0,
        batterStats?.balls || 0
    ].join(':');
}
function buildHcMatchSummaryLines(contributions) {
    return contributions
        .filter(contribution => (contribution.balls || 0) > 0 || (contribution.dismissals || 0) > 0 || (contribution.runs || 0) > 0)
        .sort((a, b) => {
        const runDiff = (b.runs || 0) - (a.runs || 0);
        if (runDiff !== 0) {
            return runDiff;
        }
        const ballDiff = (b.balls || 0) - (a.balls || 0);
        if (ballDiff !== 0) {
            return ballDiff;
        }
        const wicketDiff = (b.dismissals || 0) - (a.dismissals || 0);
        if (wicketDiff !== 0) {
            return wicketDiff;
        }
        return String(a.batterDisplayName || '').localeCompare(String(b.batterDisplayName || ''));
    })
        .map(contribution => {
        const wicketText = contribution.dismissals ? ` | Wkts: ${contribution.dismissals}` : '';
        return `• ${contribution.batterDisplayName} vs ${contribution.bowlerDisplayName}: ${contribution.runs}(${contribution.balls})${wicketText}`;
    });
}
function buildGroupedHcMatchSummaryLines(contributions) {
    const activeContributions = contributions.filter(contribution => (contribution.balls || 0) > 0 || (contribution.dismissals || 0) > 0 || (contribution.runs || 0) > 0);
    const groupedByBowler = new Map();
    for (const contribution of activeContributions) {
        const bowlerKey = String(contribution.bowlerNorm || contribution.bowlerDisplayName || 'unknown-bowler');
        if (!groupedByBowler.has(bowlerKey)) {
            groupedByBowler.set(bowlerKey, {
                bowlerDisplayName: contribution.bowlerDisplayName || contribution.bowlerNorm || 'Unknown Bowler',
                runs: 0,
                balls: 0,
                dismissals: 0,
                items: []
            });
        }
        const group = groupedByBowler.get(bowlerKey);
        group.runs += Number(contribution.runs || 0);
        group.balls += Number(contribution.balls || 0);
        group.dismissals += Number(contribution.dismissals || 0);
        group.items.push(contribution);
    }
    return [...groupedByBowler.values()]
        .sort((a, b) => {
        const wicketDiff = b.dismissals - a.dismissals;
        if (wicketDiff !== 0) {
            return wicketDiff;
        }
        const ballDiff = b.balls - a.balls;
        if (ballDiff !== 0) {
            return ballDiff;
        }
        const runDiff = a.runs - b.runs;
        if (runDiff !== 0) {
            return runDiff;
        }
        return String(a.bowlerDisplayName || '').localeCompare(String(b.bowlerDisplayName || ''));
    })
        .flatMap(group => {
        const header = `Bowler: ${group.bowlerDisplayName} | Wkts: ${group.dismissals} | Runs: ${group.runs} | Balls: ${group.balls}`;
        const itemLines = group.items
            .sort((a, b) => {
            const wicketDiff = Number(b.dismissals || 0) - Number(a.dismissals || 0);
            if (wicketDiff !== 0) {
                return wicketDiff;
            }
            const ballDiff = Number(b.balls || 0) - Number(a.balls || 0);
            if (ballDiff !== 0) {
                return ballDiff;
            }
            const runDiff = Number(b.runs || 0) - Number(a.runs || 0);
            if (runDiff !== 0) {
                return runDiff;
            }
            return String(a.batterDisplayName || '').localeCompare(String(b.batterDisplayName || ''));
        })
            .map(contribution => {
            const wicketText = contribution.dismissals ? ` | W:${contribution.dismissals}` : '';
            return `- vs ${contribution.batterDisplayName}: ${contribution.runs}(${contribution.balls})${wicketText}`;
        });
        return [header, ...itemLines, ''];
    });
}
function buildHcAutoMatchSummaryEmbed(matchRow, finalizedAt, contributions) {
    const activeContributions = contributions.filter(contribution => (contribution.balls || 0) > 0 || (contribution.dismissals || 0) > 0 || (contribution.runs || 0) > 0);
    const totalRuns = activeContributions.reduce((sum, contribution) => sum + Number(contribution.runs || 0), 0);
    const totalBalls = activeContributions.reduce((sum, contribution) => sum + Number(contribution.balls || 0), 0);
    const totalWickets = activeContributions.reduce((sum, contribution) => sum + Number(contribution.dismissals || 0), 0);
    const summaryLines = buildGroupedHcMatchSummaryLines(contributions);
    let description = summaryLines.join('\n');
    if (!description) {
        description = 'No batter-vs-bowler contribution rows were captured for this match.';
    }
    if (description.length > 3500) {
        description = `${description.slice(0, 3490).trimEnd()}\n…`;
    }
    return new discord_js_1.EmbedBuilder()
        .setColor(0x10B981)
        .setTitle(`HC Match Saved | Match ID ${matchRow.id}`)
        .setDescription(description)
        .addFields({ name: 'Started', value: matchRow.started_at ? `<t:${matchRow.started_at}:f>` : 'Unknown', inline: true }, { name: 'Ended', value: matchRow.ended_at ? `<t:${matchRow.ended_at}:f>` : `<t:${finalizedAt}:f>`, inline: true }, { name: 'Saved', value: `<t:${finalizedAt}:f>`, inline: true }, { name: 'Runs', value: `**${totalRuns}**`, inline: true }, { name: 'Balls', value: `**${totalBalls}**`, inline: true }, { name: 'Wickets', value: `**${totalWickets}**`, inline: true }, { name: 'Tracked Matchups', value: `**${activeContributions.length}**`, inline: true }, { name: 'Admin Action', value: `If anything is wrong, ping an admin with Match ID \`${matchRow.id}\`.\nAdmins can edit it with \`?hcedit ${matchRow.id}\` or remove it with \`?hcdelete ${matchRow.id}\`.`, inline: false })
        .setFooter({ text: 'Raw HC message snapshots were deleted after finalization to save storage.' });
}
function computeHcAllMatchupContributions(matchRow, rows) {
    const snapshots = buildTrackedHcSnapshots(matchRow.id, rows);
    const seenBatters = new Map();
    const seenBowlers = new Map();
    const contributionMap = new Map();
    const closedBatters = new Set();
    const countedDismissals = new Set();
    const ensureContribution = (batterNorm, bowlerNorm, batterDisplayName, bowlerDisplayName) => {
        const pairKey = `${batterNorm}__${bowlerNorm}`;
        if (!contributionMap.has(pairKey)) {
            contributionMap.set(pairKey, {
                matchId: matchRow.id,
                guildId: matchRow.guild_id,
                channelId: matchRow.channel_id,
                batterNorm,
                bowlerNorm,
                batterDisplayName,
                bowlerDisplayName,
                runs: 0,
                balls: 0,
                dismissals: 0,
                inningsSet: new Set()
            });
        }
        const contribution = contributionMap.get(pairKey);
        if (batterDisplayName) {
            contribution.batterDisplayName = batterDisplayName;
        }
        if (bowlerDisplayName) {
            contribution.bowlerDisplayName = bowlerDisplayName;
        }
        return contribution;
    };
    for (const snapshot of snapshots) {
        for (const [batterNorm, stats] of snapshot.trackedBatterStatsByNorm.entries()) {
            if (stats?.name) {
                seenBatters.set(batterNorm, stats.name);
            }
        }
        if (snapshot.dismissedBatterNorm && snapshot.batters?.[0]?.name) {
            seenBatters.set(snapshot.dismissedBatterNorm, snapshot.batters[0].name);
        }
        if (snapshot.bowlerNorm && snapshot.bowlerName) {
            seenBowlers.set(snapshot.bowlerNorm, snapshot.bowlerName);
        }
        if (snapshot.nextBowlerNorm && snapshot.nextBowlerName) {
            seenBowlers.set(snapshot.nextBowlerNorm, snapshot.nextBowlerName);
        }
    }
    for (let i = 0; i < snapshots.length - 1; i++) {
        const prevSnapshot = snapshots[i];
        const nextSnapshot = snapshots[i + 1];
        if (!prevSnapshot.innings || prevSnapshot.innings !== nextSnapshot.innings) {
            continue;
        }
        const intervalBowlerNorm = chooseHcIntervalBowler(prevSnapshot, nextSnapshot);
        if (!intervalBowlerNorm) {
            continue;
        }
        const intervalBowlerName = seenBowlers.get(intervalBowlerNorm)
            || (prevSnapshot.bowlerNorm === intervalBowlerNorm ? prevSnapshot.bowlerName : null)
            || (nextSnapshot.bowlerNorm === intervalBowlerNorm ? nextSnapshot.bowlerName : null)
            || (prevSnapshot.nextBowlerNorm === intervalBowlerNorm ? prevSnapshot.nextBowlerName : null)
            || (nextSnapshot.nextBowlerNorm === intervalBowlerNorm ? nextSnapshot.nextBowlerName : null)
            || intervalBowlerNorm;
        const batterNorms = new Set([
            ...prevSnapshot.trackedBatterStatsByNorm.keys(),
            ...nextSnapshot.trackedBatterStatsByNorm.keys()
        ]);
        for (const batterNorm of batterNorms) {
            if (!batterNorm || batterNorm === intervalBowlerNorm) {
                continue;
            }
            const batterInningsKey = buildHcInningsParticipantKey(matchRow.id, prevSnapshot.innings, batterNorm);
            if (closedBatters.has(batterInningsKey)) {
                continue;
            }
            const prevBatterStats = prevSnapshot.trackedBatterStatsByNorm.get(batterNorm) || null;
            const nextBatterStats = nextSnapshot.trackedBatterStatsByNorm.get(batterNorm) || null;
            const deltaRuns = nextBatterStats
                ? Math.max(0, nextBatterStats.runs - (prevBatterStats?.runs || 0))
                : 0;
            const deltaBalls = nextBatterStats
                ? Math.max(0, nextBatterStats.balls - (prevBatterStats?.balls || 0))
                : 0;
            const dismissalStats = nextBatterStats || prevBatterStats || null;
            const dismissalKey = buildHcDismissalKey(matchRow.id, prevSnapshot.innings, batterNorm, intervalBowlerNorm, dismissalStats);
            const wicketTaken = nextSnapshot.sourceType === 'wicket'
                && nextSnapshot.dismissedBatterNorm === batterNorm
                && intervalBowlerNorm === chooseHcIntervalBowler(prevSnapshot, nextSnapshot)
                && !countedDismissals.has(dismissalKey);
            if (deltaBalls > 0 || wicketTaken) {
                const batterDisplayName = nextBatterStats?.name || prevBatterStats?.name || seenBatters.get(batterNorm) || batterNorm;
                const contribution = ensureContribution(batterNorm, intervalBowlerNorm, batterDisplayName, intervalBowlerName);
                contribution.runs += deltaRuns;
                contribution.balls += deltaBalls;
                if (wicketTaken) {
                    contribution.dismissals += 1;
                    countedDismissals.add(dismissalKey);
                }
                contribution.inningsSet.add(prevSnapshot.innings);
            }
            if (nextSnapshot.exitedBatterNorm === batterNorm) {
                closedBatters.add(batterInningsKey);
            }
        }
    }
    for (const [batterNorm, batterDisplayName] of seenBatters.entries()) {
        for (const [bowlerNorm, bowlerDisplayName] of seenBowlers.entries()) {
            if (!batterNorm || !bowlerNorm || batterNorm === bowlerNorm) {
                continue;
            }
            ensureContribution(batterNorm, bowlerNorm, batterDisplayName, bowlerDisplayName);
        }
    }
    return [...contributionMap.values()].map(contribution => ({
        matchId: contribution.matchId,
        guildId: contribution.guildId,
        channelId: contribution.channelId,
        batterNorm: contribution.batterNorm,
        bowlerNorm: contribution.bowlerNorm,
        batterDisplayName: contribution.batterDisplayName,
        bowlerDisplayName: contribution.bowlerDisplayName,
        runs: contribution.runs,
        balls: contribution.balls,
        dismissals: contribution.dismissals,
        matches: 1,
        facedMatches: contribution.inningsSet.size > 0 ? 1 : 0,
        inningsFaced: contribution.inningsSet.size
    }));
}
async function finalizeHcAutoMatch(matchId) {
    const db = (0, database_1.getDB)();
    await db.run('BEGIN IMMEDIATE TRANSACTION');
    try {
        const matchRow = await db.get('SELECT * FROM hc_auto_matches WHERE id = ?', matchId);
        if (!matchRow) {
            await db.run('ROLLBACK');
            return null;
        }
        if (matchRow.finalized_at) {
            await db.run('COMMIT');
            return {
                matchRow,
                finalizedAt: matchRow.finalized_at,
                contributions: []
            };
        }
        const rows = await db.all(`SELECT id, match_id as session_id, source_message_id, source_created_at, observed_at, event_type, payload_json
            FROM hc_auto_message_versions
            WHERE match_id = ?
            ORDER BY observed_at ASC, id ASC`, matchId);
        const contributions = computeHcAllMatchupContributions(matchRow, rows);
        const finalizedAt = Math.floor(Date.now() / 1000);
        for (const contribution of contributions) {
            await db.run(`INSERT INTO hc_matchup_match_log (
                    match_id, guild_id, channel_id, batter_norm, bowler_norm,
                    batter_display_name, bowler_display_name, runs, balls,
                    dismissals, matches, faced_matches, innings_faced, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, contribution.matchId, contribution.guildId, contribution.channelId, contribution.batterNorm, contribution.bowlerNorm, contribution.batterDisplayName, contribution.bowlerDisplayName, contribution.runs, contribution.balls, contribution.dismissals, contribution.matches, contribution.facedMatches, contribution.inningsFaced, finalizedAt);
            await db.run(`INSERT INTO hc_global_matchups (
                    batter_norm, bowler_norm, batter_display_name, bowler_display_name,
                    runs, balls, dismissals, matches, faced_matches, innings_faced, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(batter_norm, bowler_norm) DO UPDATE SET
                    batter_display_name = excluded.batter_display_name,
                    bowler_display_name = excluded.bowler_display_name,
                    runs = hc_global_matchups.runs + excluded.runs,
                    balls = hc_global_matchups.balls + excluded.balls,
                    dismissals = hc_global_matchups.dismissals + excluded.dismissals,
                    matches = hc_global_matchups.matches + excluded.matches,
                    faced_matches = hc_global_matchups.faced_matches + excluded.faced_matches,
                    innings_faced = hc_global_matchups.innings_faced + excluded.innings_faced,
                    updated_at = excluded.updated_at`, contribution.batterNorm, contribution.bowlerNorm, contribution.batterDisplayName, contribution.bowlerDisplayName, contribution.runs, contribution.balls, contribution.dismissals, contribution.matches, contribution.facedMatches, contribution.inningsFaced, finalizedAt);
        }
        await db.run(`UPDATE hc_auto_matches
            SET finalized_at = ?, status = CASE WHEN status = 'ACTIVE' THEN 'ENDED' ELSE status END, ended_at = COALESCE(ended_at, ?), updated_at = ?
            WHERE id = ?`, finalizedAt, finalizedAt, finalizedAt, matchId);
        await db.run('DELETE FROM hc_auto_message_versions WHERE match_id = ?', matchId);
        await db.run('COMMIT');
        return {
            matchRow: {
                ...matchRow,
                status: matchRow.status === 'ACTIVE' ? 'ENDED' : matchRow.status,
                ended_at: matchRow.ended_at || finalizedAt,
                finalized_at: finalizedAt,
                updated_at: finalizedAt
            },
            finalizedAt,
            contributions
        };
    }
    catch (error) {
        await db.run('ROLLBACK');
        throw error;
    }
}
async function rebuildHcGlobalMatchupsFromLog(db) {
    await db.run('DELETE FROM hc_global_matchups');
    const rows = await db.all(`SELECT batter_norm, bowler_norm, batter_display_name, bowler_display_name,
            runs, balls, dismissals, matches, faced_matches, innings_faced, created_at
        FROM hc_matchup_match_log
        ORDER BY created_at ASC, id ASC`);
    const aggregateByPair = new Map();
    for (const row of rows) {
        const pairKey = `${row.batter_norm}__${row.bowler_norm}`;
        if (!aggregateByPair.has(pairKey)) {
            aggregateByPair.set(pairKey, {
                batterNorm: row.batter_norm,
                bowlerNorm: row.bowler_norm,
                batterDisplayName: row.batter_display_name || row.batter_norm,
                bowlerDisplayName: row.bowler_display_name || row.bowler_norm,
                runs: 0,
                balls: 0,
                dismissals: 0,
                matches: 0,
                facedMatches: 0,
                inningsFaced: 0,
                updatedAt: row.created_at || Math.floor(Date.now() / 1000)
            });
        }
        const aggregate = aggregateByPair.get(pairKey);
        if (row.batter_display_name) {
            aggregate.batterDisplayName = row.batter_display_name;
        }
        if (row.bowler_display_name) {
            aggregate.bowlerDisplayName = row.bowler_display_name;
        }
        aggregate.runs += row.runs || 0;
        aggregate.balls += row.balls || 0;
        aggregate.dismissals += row.dismissals || 0;
        aggregate.matches += row.matches || 0;
        aggregate.facedMatches += row.faced_matches || 0;
        aggregate.inningsFaced += row.innings_faced || 0;
        aggregate.updatedAt = Math.max(aggregate.updatedAt, row.created_at || 0);
    }
    for (const aggregate of aggregateByPair.values()) {
        await db.run(`INSERT INTO hc_global_matchups (
                batter_norm, bowler_norm, batter_display_name, bowler_display_name,
                runs, balls, dismissals, matches, faced_matches, innings_faced, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, aggregate.batterNorm, aggregate.bowlerNorm, aggregate.batterDisplayName, aggregate.bowlerDisplayName, aggregate.runs, aggregate.balls, aggregate.dismissals, aggregate.matches, aggregate.facedMatches, aggregate.inningsFaced, aggregate.updatedAt);
    }
    return aggregateByPair.size;
}
async function rebuildHcFinalizedMatchupData(matchIds = null) {
    const db = (0, database_1.getDB)();
    await db.run('BEGIN IMMEDIATE TRANSACTION');
    try {
        const requestedIds = Array.isArray(matchIds)
            ? [...new Set(matchIds.map(id => parseInt(String(id), 10)).filter(id => Number.isInteger(id) && id > 0))]
            : [];
        const targetMatches = requestedIds.length
            ? await db.all(`SELECT *
                FROM hc_auto_matches
                WHERE finalized_at IS NOT NULL
                  AND id IN (${requestedIds.map(() => '?').join(', ')})
                  AND EXISTS (SELECT 1 FROM hc_auto_message_versions WHERE match_id = hc_auto_matches.id)
                ORDER BY id ASC`, ...requestedIds)
            : await db.all(`SELECT *
                FROM hc_auto_matches
                WHERE finalized_at IS NOT NULL
                  AND EXISTS (SELECT 1 FROM hc_auto_message_versions WHERE match_id = hc_auto_matches.id)
                ORDER BY id ASC`);
        let rebuiltMatches = 0;
        let rebuiltPairs = 0;
        for (const matchRow of targetMatches) {
            const rows = await db.all(`SELECT id, match_id as session_id, source_message_id, source_created_at, observed_at, event_type, payload_json
                FROM hc_auto_message_versions
                WHERE match_id = ?
                ORDER BY observed_at ASC, id ASC`, matchRow.id);
            await db.run('DELETE FROM hc_matchup_match_log WHERE match_id = ?', matchRow.id);
            const contributions = computeHcAllMatchupContributions(matchRow, rows);
            const finalizedAt = matchRow.finalized_at || Math.floor(Date.now() / 1000);
            for (const contribution of contributions) {
                await db.run(`INSERT INTO hc_matchup_match_log (
                        match_id, guild_id, channel_id, batter_norm, bowler_norm,
                        batter_display_name, bowler_display_name, runs, balls,
                        dismissals, matches, faced_matches, innings_faced, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, contribution.matchId, contribution.guildId, contribution.channelId, contribution.batterNorm, contribution.bowlerNorm, contribution.batterDisplayName, contribution.bowlerDisplayName, contribution.runs, contribution.balls, contribution.dismissals, contribution.matches, contribution.facedMatches, contribution.inningsFaced, finalizedAt);
            }
            rebuiltMatches += 1;
            rebuiltPairs += contributions.length;
        }
        const globalPairs = await rebuildHcGlobalMatchupsFromLog(db);
        await db.run('COMMIT');
        return {
            rebuiltMatches,
            rebuiltPairs,
            globalPairs
        };
    }
    catch (error) {
        await db.run('ROLLBACK');
        throw error;
    }
}
async function finalizeCompletedHcAutoMatches() {
    const db = (0, database_1.getDB)();
    const matches = await db.all(`SELECT id
        FROM hc_auto_matches
        WHERE status = 'ENDED' AND finalized_at IS NULL
        ORDER BY id ASC`);
    for (const match of matches) {
        try {
            await finalizeHcAutoMatch(match.id);
        }
        catch (error) {
            console.error(`Failed to finalize HC auto match ${match.id}:`, error);
        }
    }
}
async function pruneOldHcAutoHistory() {
    const db = (0, database_1.getDB)();
    await db.run(`DELETE FROM hc_auto_message_versions
        WHERE match_id IN (
            SELECT id
            FROM hc_auto_matches
            WHERE finalized_at IS NOT NULL
        )`);
}
async function startHcAutoMatchVerification(autoMatchId, channel) {
    const db = (0, database_1.getDB)();
    const match = await db.get('SELECT status, finalized_at FROM hc_auto_matches WHERE id = ?', autoMatchId);
    if (!match || match.finalized_at || match.status === 'ENDED')
        return;
    const observedAt = Math.floor(Date.now() / 1000);
    await db.run(`UPDATE hc_auto_matches
        SET status = 'ENDED', updated_at = ?, ended_at = COALESCE(ended_at, ?)
        WHERE id = ?`, observedAt, observedAt, autoMatchId);
    const finalized = await finalizeHcAutoMatch(autoMatchId);
    if (finalized?.matchRow) {
        await channel.send({
            content: `**Match Saved!** Match ID: \`${finalized.matchRow.id}\``,
            embeds: [buildHcAutoMatchSummaryEmbed(finalized.matchRow, finalized.finalizedAt, finalized.contributions)]
        }).catch(() => null);
    }
    return;
    
}
async function captureHcAutoMessageVersion(message, eventType = 'create') {
    if (!message.guild?.id || !message.channel?.id || message.author?.id !== HC_CRICKET_BOT_ID) {
        return;
    }
    const payload = buildHcMessagePayload(message);
    if (!isHcAutoRelevantPayload(payload)) {
        return;
    }
    const sourceCreatedAt = Math.floor((message.createdTimestamp || Date.now()) / 1000);
    const observedAt = Math.floor(Date.now() / 1000);
    const autoMatch = await getOrCreateHcAutoMatch(message.guild.id, message.channel.id, sourceCreatedAt, payload);
    if (!autoMatch?.id) {
        return;
    }
    const payloadJson = JSON.stringify(payload);
    const payloadHash = buildHcPayloadHash(payloadJson);
    const db = (0, database_1.getDB)();
    const latestVersion = await db.get(`SELECT payload_hash
        FROM hc_auto_message_versions
        WHERE match_id = ? AND source_message_id = ?
        ORDER BY id DESC
        LIMIT 1`, autoMatch.id, message.id);
    if (latestVersion?.payload_hash === payloadHash) {
        await db.run('UPDATE hc_auto_matches SET updated_at = ? WHERE id = ?', observedAt, autoMatch.id);
        return;
    }
    await db.run(`INSERT INTO hc_auto_message_versions (
            match_id, guild_id, channel_id, source_message_id, source_author_id,
            content_text, embed_count, payload_json, payload_hash,
            source_created_at, observed_at, event_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(match_id, source_message_id, payload_hash) DO NOTHING`, autoMatch.id, message.guild.id, message.channel.id, message.id, message.author.id, message.content || null, Array.isArray(message.embeds) ? message.embeds.length : 0, payloadJson, payloadHash, sourceCreatedAt, observedAt, eventType);
    
    if (isHcAutoMatchAbandonPayload(payload)) {
        await db.run('DELETE FROM hc_auto_message_versions WHERE match_id = ?', autoMatch.id);
        await db.run('DELETE FROM hc_auto_matches WHERE id = ?', autoMatch.id);
        return;
    }
    if (isHcAutoMatchEndPayload(payload)) {
        await startHcAutoMatchVerification(autoMatch.id, message.channel);
        return;
    }
    await db.run('UPDATE hc_auto_matches SET updated_at = ? WHERE id = ?', observedAt, autoMatch.id);
}
async function promptForSavedHcEmbedNotes(message, savedRows) {
    if (!savedRows.length) {
        return 0;
    }
    const previewLines = savedRows.map((_, index) => `${index + 1}. Embed ${index + 1}`);
    await message.reply(`Reply within 2 minutes with notes for the saved HC entries.\nFormat: \`1: opener profile\`\nUse one line per note.\nType \`skip\` to leave them empty.\n\n${previewLines.join('\n')}`);
    const noteReplyCollection = await message.channel.awaitMessages({
        filter: reply => reply.author.id === message.author.id,
        max: 1,
        time: 120000
    }).catch(() => null);
    const noteReply = noteReplyCollection?.first();
    if (!noteReply) {
        return 0;
    }
    const rawContent = noteReply.content.trim();
    if (!rawContent || /^skip$/i.test(rawContent)) {
        return 0;
    }
    const db = (0, database_1.getDB)();
    let updatedCount = 0;
    for (const line of rawContent.split(/\r?\n/)) {
        const match = line.match(/^(\d{1,2})\s*[:\-]\s*(.+)$/);
        if (!match) {
            continue;
        }
        const targetIndex = parseInt(match[1], 10) - 1;
        const noteText = match[2].trim().slice(0, 500);
        const targetRow = savedRows[targetIndex];
        if (!targetRow || !noteText) {
            continue;
        }
        await db.run('UPDATE hc_cricket_saved_embeds SET note_text = ? WHERE id = ?', noteText, targetRow.id);
        updatedCount++;
    }
    return updatedCount;
}
async function handleSaveHcEmbedsCommand(message, args) {
    const targetChannel = await resolveSaveHcEmbedsChannel(message);
    if (!targetChannel) {
        await message.reply('Use this command in a text channel, or mention a text channel to scan.');
        return true;
    }
    const requestedCount = parseSaveHcEmbedsCount(args);
    const inlineNote = parseSaveHcEmbedsInlineNote(args);
    const replyTargetResult = await collectSingleSavedHcCandidateFromReply(message);
    const { candidates, scannedMessageCount, usedReplyTarget } = replyTargetResult || await collectSavedHcCandidates(targetChannel, requestedCount);
    if (!candidates.length) {
        await message.reply(`No trusted HC entries from <@${HC_CRICKET_BOT_ID}> were found in ${targetChannel}, even after scanning **${scannedMessageCount}** messages.`);
        return true;
    }
    const db = (0, database_1.getDB)();
    const savedAt = Math.floor(Date.now() / 1000);
    let storedCount = 0;
    const savedRows = [];
    for (const item of candidates) {
        await db.run(`INSERT INTO hc_cricket_saved_embeds (
                guild_id, source_channel_id, source_message_id, source_author_id, embed_index,
                embed_title, embed_description, embed_json, note_text, source_created_at, saved_by, saved_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(guild_id, source_message_id, embed_index) DO UPDATE SET
                source_channel_id = excluded.source_channel_id,
                source_author_id = excluded.source_author_id,
                embed_title = excluded.embed_title,
                embed_description = excluded.embed_description,
                embed_json = excluded.embed_json,
                note_text = COALESCE(excluded.note_text, hc_cricket_saved_embeds.note_text),
                source_created_at = excluded.source_created_at,
                saved_by = excluded.saved_by,
                saved_at = excluded.saved_at`, message.guild.id, item.sourceMessage.channel.id, item.sourceMessage.id, item.sourceMessage.author.id, item.embedIndex, item.title, item.description, item.payloadJson, inlineNote, Math.floor(item.sourceMessage.createdTimestamp / 1000), message.author.id, savedAt);
        const savedRow = await db.get(`SELECT id
            FROM hc_cricket_saved_embeds
            WHERE guild_id = ? AND source_message_id = ? AND embed_index = ?`, message.guild.id, item.sourceMessage.id, item.embedIndex);
        if (savedRow) {
            savedRows.push(savedRow);
        }
        storedCount++;
    }
    await pruneSavedHcEmbeds(message.guild.id);
    const totalSavedRow = await db.get('SELECT COUNT(*) as total FROM hc_cricket_saved_embeds WHERE guild_id = ?', message.guild.id);
    const savedPreview = savedRows.map((_, index) => `${index + 1}. Embed ${index + 1}`).join('\n');
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0x3B82F6)
        .setTitle('HC Cricket Entries Saved')
        .setDescription(`Saved **${storedCount}** trusted HC entr${storedCount === 1 ? 'y' : 'ies'} from ${targetChannel}.`)
        .addFields({ name: 'Source Bot', value: `<@${HC_CRICKET_BOT_ID}>`, inline: true }, { name: usedReplyTarget ? 'Reply Target' : 'Messages Scanned', value: usedReplyTarget ? '**Used replied HC message**' : `**${scannedMessageCount}**`, inline: true }, { name: 'Stored For This Server', value: `**${totalSavedRow?.total || 0} / ${HC_CRICKET_SAVED_EMBED_LIMIT}**`, inline: true }, { name: 'Saved Entries', value: savedPreview || 'No preview available.', inline: false }, { name: 'Inline Note', value: inlineNote || 'None', inline: false })
        .setFooter({ text: `Text messages and embeds are both supported. Older saved entries are pruned after ${HC_CRICKET_SAVED_EMBED_LIMIT}.` });
    await message.reply({ embeds: [embed] });
    const shouldPromptForPerEmbedNotes = !inlineNote;
    const updatedNotes = shouldPromptForPerEmbedNotes ? await promptForSavedHcEmbedNotes(message, savedRows) : 0;
    if (updatedNotes > 0) {
        await message.reply(`Saved notes for **${updatedNotes}** HC embed${updatedNotes === 1 ? '' : 's'}.`);
    }
    return true;
}
async function handleListSavedHcEmbedsCommand(message) {
    const db = (0, database_1.getDB)();
    const savedRows = await db.all(`SELECT id, source_channel_id, source_message_id, note_text, saved_by, saved_at
        FROM hc_cricket_saved_embeds
        WHERE guild_id = ?
        ORDER BY saved_at DESC, id DESC`, message.guild.id);
    if (!savedRows.length) {
        await message.reply('No HC entries are saved for this server yet.');
        return true;
    }
    const yourSavedCount = savedRows.filter(row => row.saved_by === message.author.id).length;
    const lines = savedRows.map((row, index) => {
        const noteText = row.note_text?.trim() ? row.note_text.trim() : 'No note';
        const sourceLink = `https://discord.com/channels/${message.guild.id}/${row.source_channel_id}/${row.source_message_id}`;
        const savedAtText = row.saved_at ? `<t:${row.saved_at}:f>` : 'Unknown time';
        return `**${index + 1}.** ${noteText}\nSaved by: <@${row.saved_by}> | Channel: <#${row.source_channel_id}> | [Source](${sourceLink})\nSaved at: ${savedAtText}`;
    });
    const pages = [];
    for (let i = 0; i < lines.length; i += 5) {
        pages.push(lines.slice(i, i + 5).join('\n\n'));
    }
    const buildEmbed = (pageIndex) => new discord_js_1.EmbedBuilder()
        .setColor(0x3B82F6)
        .setTitle('Saved HC Entries')
        .setDescription(pages[pageIndex])
        .addFields({ name: 'Total Saved', value: `**${savedRows.length} / ${HC_CRICKET_SAVED_EMBED_LIMIT}**`, inline: true }, { name: 'Saved By You', value: `**${yourSavedCount}**`, inline: true }, { name: 'Page', value: `**${pageIndex + 1}/${pages.length}**`, inline: true })
        .setFooter({ text: 'Only saved HC entries for this server are shown here.' });
    if (pages.length === 1) {
        await message.reply({ embeds: [buildEmbed(0)] });
        return true;
    }
    let page = 0;
    const response = await message.reply({ embeds: [buildEmbed(page)], components: [(0, utils_1.buildPagedButtonRow)('savedhc', page, pages.length)] });
    const collector = response.createMessageComponentCollector({
        filter: interaction => interaction.user.id === message.author.id && ['savedhc_prev', 'savedhc_next'].includes(interaction.customId),
        time: 300000
    });
    collector.on('collect', async (interaction) => {
        if (interaction.customId === 'savedhc_prev' && page > 0)
            page--;
        if (interaction.customId === 'savedhc_next' && page < pages.length - 1)
            page++;
        await interaction.update({ embeds: [buildEmbed(page)], components: [(0, utils_1.buildPagedButtonRow)('savedhc', page, pages.length)] }).catch(() => null);
    });
    collector.on('end', () => {
        response.edit({ components: [] }).catch(() => null);
    });
    return true;
}
async function handleHcEmojiMapCommand(message) {
    const emojiIdMap = {
        emoji_29: '964873483333042256',
        emoji_28: '964873425539719260',
        emoji_30: '964873524906971236',
        emoji_31: '964873576874381353',
        emoji_32: '964873629349343262',
        emoji_33: '964873674844946452',
        emoji_34: '964873753144221716'
    };
    const scoringLines = Object.entries(HC_TIMELINE_EMOJI_MAP)
        .filter(([token]) => token !== 'emoji_35')
        .map(([token, value]) => `<:${token}:${emojiIdMap[token]}> = ${value}`);
    const specialLines = [
        `<:emoji_35:964873804864159744> = ${HC_TIMELINE_EMOJI_MAP.emoji_35}`,
        ...Object.entries(HC_POWERPLAY_TIMELINE_MAP).map(([token, value]) => `${token} = ${value}`)
    ];
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0xF59E0B)
        .setTitle('HC Timeline Emoji Map')
        .setDescription('Current HC scoring/timeline mapping based on captured sessions and your confirmations.')
        .addFields({ name: 'Scoring Emojis', value: scoringLines.join('\n'), inline: false }, { name: 'Special / Powerplay', value: specialLines.join('\n'), inline: false }, { name: 'Sample Order', value: `<:emoji_29:964873483333042256> <:emoji_28:964873425539719260> <:emoji_30:964873524906971236> <:emoji_31:964873576874381353> <:emoji_32:964873629349343262> <:emoji_33:964873674844946452> <:emoji_34:964873753144221716>`, inline: false })
        .setFooter({ text: 'Use this preview to visually verify the emoji rendering in Discord.' });
    await message.reply({ embeds: [embed] });
    return true;
}
async function handleFindHcEmojiCommand(message, args) {
    const query = String(args[0] || '').trim();
    if (!query) {
        await message.reply('Usage: `?findhcemoji <emoji_token>`\nExample: `?findhcemoji PP2_emoji_31`');
        return true;
    }
    const db = (0, database_1.getDB)();
    const rows = await db.all(`SELECT session_id, channel_id, source_message_id, source_created_at, payload_json
        FROM hc_analysis_messages
        ORDER BY session_id ASC, source_created_at ASC, id ASC`);
    const matches = [];
    for (const row of rows) {
        let parsed = null;
        try {
            parsed = JSON.parse(row.payload_json);
        }
        catch {
            continue;
        }
        const embeds = Array.isArray(parsed?.embeds) ? parsed.embeds : [];
        embeds.forEach((embed, embedIndex) => {
            const haystack = JSON.stringify(embed);
            if (!haystack.includes(query)) {
                return;
            }
            const timelineField = Array.isArray(embed.fields) ? embed.fields.find(field => field.name === 'Timeline') : null;
            matches.push({
                sessionId: row.session_id,
                channelId: row.channel_id,
                sourceMessageId: row.source_message_id,
                sourceCreatedAt: row.source_created_at,
                embedIndex,
                title: embed.title || '(no title)',
                timelineValue: timelineField?.value || null
            });
        });
    }
    if (!matches.length) {
        await message.reply(`No HC analysis embeds contain \`${query}\`.`);
        return true;
    }
    const pageLines = matches.map((match, index) => {
        const sourceLink = `https://discord.com/channels/${message.guild?.id || '@me'}/${match.channelId}/${match.sourceMessageId}`;
        const timelineLine = match.timelineValue ? `\nTimeline: ${match.timelineValue}` : '';
        return `**${index + 1}. Session ${match.sessionId} | ${match.title}**\nTime: <t:${match.sourceCreatedAt}:f> | [Source](${sourceLink})${timelineLine}`;
    });
    const pages = [];
    for (let i = 0; i < pageLines.length; i += 4) {
        pages.push(pageLines.slice(i, i + 4));
    }
    const buildEmbed = (pageIndex) => new discord_js_1.EmbedBuilder()
        .setColor(0xF59E0B)
        .setTitle(`HC Emoji Search: ${query}${pages.length > 1 ? ` (${pageIndex + 1}/${pages.length})` : ''}`)
        .setDescription(pages[pageIndex].join('\n\n'))
        .setFooter({ text: `Matches found: ${matches.length}` });
    if (pages.length === 1) {
        await message.reply({ embeds: [buildEmbed(0)] });
        return true;
    }
    let page = 0;
    const response = await message.reply({ embeds: [buildEmbed(page)], components: [(0, utils_1.buildPagedButtonRow)('findhcemoji', page, pages.length)] });
    const collector = response.createMessageComponentCollector({
        filter: interaction => interaction.user.id === message.author.id && ['findhcemoji_prev', 'findhcemoji_next'].includes(interaction.customId),
        time: 300000
    });
    collector.on('collect', async (interaction) => {
        if (interaction.customId === 'findhcemoji_prev' && page > 0)
            page--;
        if (interaction.customId === 'findhcemoji_next' && page < pages.length - 1)
            page++;
        await interaction.update({ embeds: [buildEmbed(page)], components: [(0, utils_1.buildPagedButtonRow)('findhcemoji', page, pages.length)] }).catch(() => null);
    });
    collector.on('end', () => {
        response.edit({ components: [] }).catch(() => null);
    });
    return true;
}
exports.cleanHcDisplayName = cleanHcDisplayName;
function cleanHcDisplayName(rawName) {
    return String(rawName || '')
        .replace(/<@!?(\d+)>/g, '$1')
        .replace(/[*`]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}
function normalizeHcName(rawName) {
    const cleaned = cleanHcDisplayName(rawName);
    if (/^\d{17,20}$/.test(cleaned)) {
        for (const user of client.users.cache.values()) {
            if (user.id === cleaned) {
                return (user.username || user.id).toLowerCase();
            }
        }
        for (const guild of client.guilds.cache.values()) {
            const member = guild.members.cache.get(cleaned);
            if (member) {
                return (member.user?.username || member.id).toLowerCase();
            }
        }
    }
    return cleaned.toLowerCase();
}
function parseHcTransitionPlayerValue(rawText) {
    const cleaned = cleanHcDisplayName(rawText);
    if (!cleaned || /^\d{5,}$/.test(cleaned)) {
        return null;
    }
    return cleaned;
}
function parseHcRunsBalls(rawText) {
    const match = String(rawText || '').match(/(\d+)\s*\((\d+)\)/);
    if (!match) {
        return null;
    }
    return {
        runs: parseInt(match[1], 10),
        balls: parseInt(match[2], 10)
    };
}
function parseHcBowlerFigures(rawText) {
    const match = String(rawText || '').match(/(\d+)\s*-\s*(\d+)\s*\((\d+(?:\.\d+)?)\s*(?:overs)?\)/i);
    if (!match) {
        return null;
    }
    return {
        runsConceded: parseInt(match[1], 10),
        wickets: parseInt(match[2], 10),
        oversText: match[3]
    };
}
function parseHcMatchStatusBatters(rawText) {
    const lines = String(rawText || '').split(/\n/).map(line => cleanHcDisplayName(line)).filter(Boolean);
    const batters = [];
    for (const line of lines) {
        if (/^no batsman/i.test(line)) {
            continue;
        }
        const match = line.match(/^(.+?):\s*(\d+)\s*\((\d+)\)\s*runs$/i);
        if (!match) {
            continue;
        }
        const name = cleanHcDisplayName(match[1]);
        batters.push({
            name,
            norm: normalizeHcName(name),
            runs: parseInt(match[2], 10),
            balls: parseInt(match[3], 10)
        });
    }
    return batters;
}
function parseHcAfterOverSnapshot(embed, sessionId, timestamp, inningsNumber) {
    const batters = [];
    let bowlerName = null;
    let nextBowlerName = null;
    for (const field of embed.fields || []) {
        const fieldName = cleanHcDisplayName(field.name);
        const fieldValue = String(field.value || '');
        if (/^next bowler to bowl is$/i.test(fieldName)) {
            nextBowlerName = parseHcTransitionPlayerValue(fieldValue);
            continue;
        }
        if (/^partnership$/i.test(fieldName) || /^team .+ score$/i.test(fieldName) || /^final score$/i.test(fieldName)) {
            continue;
        }
        if (/score$/i.test(fieldName)) {
            const runsBalls = parseHcRunsBalls(fieldValue);
            if (!runsBalls) {
                continue;
            }
            const name = cleanHcDisplayName(fieldName.replace(/'s score$/i, '').replace(/ score$/i, ''));
            batters.push({
                name,
                norm: normalizeHcName(name),
                runs: runsBalls.runs,
                balls: runsBalls.balls
            });
            continue;
        }
        const bowlerFigures = parseHcBowlerFigures(fieldValue);
        if (bowlerFigures) {
            bowlerName = fieldName;
        }
    }
    if (!bowlerName || !batters.length || !inningsNumber) {
        return null;
    }
    return {
        sessionId,
        time: timestamp,
        innings: inningsNumber,
        sourceType: 'after_over',
        batters,
        bowlerName,
        bowlerNorm: normalizeHcName(bowlerName),
        nextBowlerName: nextBowlerName || null,
        nextBowlerNorm: nextBowlerName ? normalizeHcName(nextBowlerName) : null
    };
}
function parseHcMatchStatusSnapshot(embed, sessionId, timestamp, fallbackInnings) {
    const inningsField = (embed.fields || []).find(field => field.name === 'Innings');
    const inningsText = cleanHcDisplayName(inningsField?.value || '');
    const inningsNumber = /TWO/i.test(inningsText) ? 2 : /ONE/i.test(inningsText) ? 1 : fallbackInnings;
    const batterField = (embed.fields || []).find(field => field.name === 'Batters' || field.name === 'Batter');
    const bowlerField = (embed.fields || []).find(field => field.name === 'Bowler');
    const batters = parseHcMatchStatusBatters(batterField?.value || '');
    const bowlerMatch = cleanHcDisplayName(bowlerField?.value || '').match(/^(.+?):\s*\d+\s*-\s*\d+\s*\(\d+(?:\.\d+)?/i);
    const bowlerName = bowlerMatch ? cleanHcDisplayName(bowlerMatch[1]) : null;
    if (!bowlerName || !batters.length || !inningsNumber) {
        return null;
    }
    return {
        sessionId,
        time: timestamp,
        innings: inningsNumber,
        sourceType: 'match_status',
        batters,
        bowlerName,
        bowlerNorm: normalizeHcName(bowlerName)
    };
}
function parseHcSingleBatterSnapshot(embed, sessionId, timestamp, inningsNumber, sourceType) {
    const firstField = (embed.fields || [])[0];
    const secondField = (embed.fields || [])[1];
    if (!firstField || !secondField || !inningsNumber) {
        return null;
    }
    const batterStats = parseHcRunsBalls(firstField.value || '');
    const bowlerStats = parseHcBowlerFigures(secondField.value || '');
    if (!batterStats || !bowlerStats) {
        return null;
    }
    const batterName = cleanHcDisplayName(String(firstField.name || '').replace(/'s score$/i, '').replace(/ score$/i, ''));
    const bowlerName = cleanHcDisplayName(secondField.name);
    const nextBowlerField = (embed.fields || []).find(field => /^next bowler to bowl is$/i.test(cleanHcDisplayName(field.name)));
    const nextBowlerName = nextBowlerField ? parseHcTransitionPlayerValue(nextBowlerField.value || '') : null;
    const exitedBatterNorm = (sourceType === 'wicket' || sourceType === 'retired') ? normalizeHcName(batterName) : null;
    return {
        sessionId,
        time: timestamp,
        innings: inningsNumber,
        sourceType,
        batters: [{
                name: batterName,
                norm: normalizeHcName(batterName),
                runs: batterStats.runs,
                balls: batterStats.balls
            }],
        bowlerName,
        bowlerNorm: normalizeHcName(bowlerName),
        nextBowlerName,
        nextBowlerNorm: nextBowlerName ? normalizeHcName(nextBowlerName) : null,
        dismissedBatterNorm: sourceType === 'wicket' ? exitedBatterNorm : null,
        exitedBatterNorm
    };
}
function buildHcSnapshotSemanticSignature(snapshot) {
    const semanticBatters = [...(snapshot?.batters || [])]
        .filter(batter => batter?.norm)
        .map(batter => ({
        norm: batter.norm,
        runs: batter.runs || 0,
        balls: batter.balls || 0
    }))
        .sort((a, b) => a.norm.localeCompare(b.norm, undefined, { sensitivity: 'base' }));
    return JSON.stringify({
        innings: snapshot?.innings || 0,
        sourceType: snapshot?.sourceType || '',
        bowlerNorm: snapshot?.bowlerNorm || '',
        nextBowlerNorm: snapshot?.nextBowlerNorm || '',
        dismissedBatterNorm: snapshot?.dismissedBatterNorm || '',
        exitedBatterNorm: snapshot?.exitedBatterNorm || '',
        batters: semanticBatters
    });
}
function attachHcSnapshotMetadata(snapshot, row) {
    if (!snapshot) {
        return null;
    }
    const observedAt = row?.observed_at || row?.captured_at || row?.source_created_at || snapshot.time || 0;
    return {
        ...snapshot,
        rowId: row?.id || null,
        sourceMessageId: row?.source_message_id || null,
        observedAt,
        semanticSignature: buildHcSnapshotSemanticSignature(snapshot)
    };
}
function dedupeHcSemanticSnapshots(rawSnapshots) {
    const dedupedSnapshots = [];
    const seenSourceSignatures = new Set();
    for (const snapshot of rawSnapshots) {
        if (!snapshot?.semanticSignature) {
            continue;
        }
        const sourceSignatureKey = snapshot.sourceMessageId
            ? `${snapshot.sourceMessageId}::${snapshot.semanticSignature}`
            : null;
        if (sourceSignatureKey && seenSourceSignatures.has(sourceSignatureKey)) {
            continue;
        }
        const lastKeptSnapshot = dedupedSnapshots[dedupedSnapshots.length - 1] || null;
        if (lastKeptSnapshot?.semanticSignature === snapshot.semanticSignature) {
            if (sourceSignatureKey) {
                seenSourceSignatures.add(sourceSignatureKey);
            }
            continue;
        }
        if (sourceSignatureKey) {
            seenSourceSignatures.add(sourceSignatureKey);
        }
        dedupedSnapshots.push(snapshot);
    }
    return dedupedSnapshots;
}
function extractHcRelevantSnapshots(sessionId, rows) {
    const snapshots = [];
    let currentInnings = null;
    for (const row of rows) {
        const rowTimestamp = row.observed_at || row.captured_at || row.source_created_at;
        let parsed = null;
        try {
            parsed = JSON.parse(row.payload_json);
        }
        catch {
            continue;
        }
        const embeds = Array.isArray(parsed?.embeds) ? parsed.embeds : [];
        for (const embed of embeds) {
            const title = embed.title || '';
            if (title === 'Innings 1 has started!') {
                currentInnings = 1;
            }
            if (title === 'Innings 2 has started!') {
                currentInnings = 2;
            }
            let snapshot = null;
            if (title === 'Match Status') {
                snapshot = parseHcMatchStatusSnapshot(embed, sessionId, rowTimestamp, currentInnings);
                if (snapshot?.innings) {
                    currentInnings = snapshot.innings;
                }
            }
            else if (title === 'After this over') {
                snapshot = parseHcAfterOverSnapshot(embed, sessionId, rowTimestamp, currentInnings);
            }
            else if (title === 'Batter out!') {
                snapshot = parseHcSingleBatterSnapshot(embed, sessionId, rowTimestamp, currentInnings, 'wicket');
            }
            else if (title === 'Batter retired!') {
                snapshot = parseHcSingleBatterSnapshot(embed, sessionId, rowTimestamp, currentInnings, 'retired');
            }
            else if (title === 'Bowler retired!') {
                snapshot = parseHcSingleBatterSnapshot(embed, sessionId, rowTimestamp, currentInnings, 'bowler_retired');
            }
            if (snapshot) {
                const normalizedSnapshot = attachHcSnapshotMetadata(snapshot, row);
                if (normalizedSnapshot) {
                    snapshots.push(normalizedSnapshot);
                }
            }
        }
    }
    return dedupeHcSemanticSnapshots(snapshots);
}
function cloneHcBatterStats(stats) {
    return stats
        ? {
            name: stats.name,
            norm: stats.norm,
            runs: stats.runs,
            balls: stats.balls
        }
        : null;
}
function chooseHcIntervalBowler(prevSnapshot, nextSnapshot) {
    if (prevSnapshot.sourceType === 'after_over' || prevSnapshot.sourceType === 'bowler_retired') {
        return nextSnapshot?.bowlerNorm || prevSnapshot.nextBowlerNorm || prevSnapshot.bowlerNorm || null;
    }
    return prevSnapshot.bowlerNorm || nextSnapshot?.bowlerNorm || null;
}
function resolveHcMentionLabel(rawToken, message) {
    const token = String(rawToken || '').trim();
    const mentionMatch = token.match(/^<@!?(\d+)>$/);
    const rawIdMatch = token.match(/^(\d{17,20})$/);
    const mentionId = mentionMatch ? mentionMatch[1] : (rawIdMatch ? rawIdMatch[1] : null);
    if (!mentionId) {
        return null;
    }
    const user = message?.mentions?.users?.get(mentionId) || client?.users?.cache?.get(mentionId);
    if (user) {
        // Always prefer the unique username for HC matchup compatibility
        return cleanHcDisplayName(user.username || user.globalName || user.id);
    }
    const member = message?.mentions?.members?.get(mentionId) || message?.guild?.members?.cache?.get(mentionId);
    if (member) {
        return cleanHcDisplayName(member.user?.username || member.displayName || member.id);
    }
    return null;
}
function parseHcParticipantNames(rawInput) {
    const cleanedInput = cleanHcDisplayName(rawInput);
    if (!cleanedInput) {
        return null;
    }
    const normalizedSeparators = cleanedInput.replace(/\s+(?:vs\.?|v\.?|against)\s+/gi, ' | ');
    const separatorParts = normalizedSeparators.split('|').map(part => cleanHcDisplayName(part)).filter(Boolean);
    if (separatorParts.length >= 2) {
        return [separatorParts[0], separatorParts[1]];
    }
    const quotedMatches = [...cleanedInput.matchAll(/"([^"]+)"|'([^']+)'/g)];
    if (quotedMatches.length >= 2) {
        return quotedMatches
            .slice(0, 2)
            .map(match => cleanHcDisplayName(match[1] || match[2]))
            .filter(Boolean);
    }
    if (quotedMatches.length === 1) {
        const quotedMatch = quotedMatches[0];
        const quotedName = cleanHcDisplayName(quotedMatch[1] || quotedMatch[2]);
        const beforeText = cleanHcDisplayName(cleanedInput.slice(0, quotedMatch.index || 0));
        const afterText = cleanHcDisplayName(cleanedInput.slice((quotedMatch.index || 0) + quotedMatch[0].length));
        if (quotedName && !beforeText && afterText) {
            return [quotedName, afterText];
        }
        if (quotedName && beforeText && !afterText) {
            return [beforeText, quotedName];
        }
    }
    const tokens = [...cleanedInput.matchAll(/"([^"]+)"|'([^']+)'|(\S+)/g)]
        .map(match => cleanHcDisplayName(match[1] || match[2] || match[3]))
        .filter(Boolean);
    if (tokens.length < 2) {
        return null;
    }
    return [tokens[0], tokens.slice(1).join(' ')];
}
function parseHcBowlerVsBatterInput(args, message) {
    const rawArgs = Array.isArray(args) ? [...args] : [];
    if (!rawArgs.length) {
        return null;
    }
    let sessionId = null;
    const lastArg = rawArgs[rawArgs.length - 1];
    if (/^\d+$/.test(String(lastArg || '').trim())) {
        sessionId = parseInt(String(lastArg).trim(), 10);
        rawArgs.pop();
    }
    const rawInput = rawArgs
        .map(arg => {
        const mentionLabel = resolveHcMentionLabel(arg, message);
        return mentionLabel ? `"${mentionLabel.replace(/"/g, '')}"` : arg;
    })
        .join(' ')
        .trim();
    const participants = parseHcParticipantNames(rawInput);
    if (!participants) {
        return null;
    }
    return {
        bowlerName: participants[0],
        batterName: participants[1],
        sessionId
    };
}
function computeHcBowlerVsBatterStats(matchIds, rowsByMatch, targetBatterNorm, targetBowlerNorm) {
    let totalRuns = 0;
    let totalBalls = 0;
    let totalWickets = 0;
    const matchedMatches = new Set();
    const matchedInnings = new Set();
    const sharedMatches = new Set();
    const countedDismissals = new Set();
    for (const matchId of matchIds) {
        const snapshots = buildTrackedHcSnapshots(matchId, rowsByMatch.get(matchId) || []);
        const batterSeenInMatch = snapshots.some(snapshot => snapshot.trackedBatterStatsByNorm.has(targetBatterNorm) || snapshot.dismissedBatterNorm === targetBatterNorm || snapshot.exitedBatterNorm === targetBatterNorm);
        const bowlerSeenInMatch = snapshots.some(snapshot => snapshot.bowlerNorm === targetBowlerNorm);
        if (batterSeenInMatch && bowlerSeenInMatch) {
            sharedMatches.add(matchId);
        }
        if (snapshots.length < 2) {
            continue;
        }
        let currentSpellBowler = null;
        const closedBatters = new Set();
        for (let i = 0; i < snapshots.length - 1; i++) {
            const prevSnapshot = snapshots[i];
            const nextSnapshot = snapshots[i + 1];
            if (!prevSnapshot.innings || prevSnapshot.innings !== nextSnapshot.innings) {
                currentSpellBowler = null;
                continue;
            }
            const intervalBowlerNorm = chooseHcIntervalBowler(prevSnapshot, nextSnapshot);
            if (!intervalBowlerNorm) {
                continue;
            }
            if (intervalBowlerNorm !== currentSpellBowler) {
                currentSpellBowler = intervalBowlerNorm;
            }
            const batterInningsKey = buildHcInningsParticipantKey(matchId, prevSnapshot.innings, targetBatterNorm);
            if (closedBatters.has(batterInningsKey)) {
                continue;
            }
            const prevBatterStats = prevSnapshot.trackedBatterStatsByNorm.get(targetBatterNorm) || null;
            const nextBatterStats = nextSnapshot.trackedBatterStatsByNorm.get(targetBatterNorm) || null;
            const deltaRuns = nextBatterStats
                ? Math.max(0, nextBatterStats.runs - (prevBatterStats?.runs || 0))
                : 0;
            const deltaBalls = nextBatterStats
                ? Math.max(0, nextBatterStats.balls - (prevBatterStats?.balls || 0))
                : 0;
            const dismissalStats = nextBatterStats || prevBatterStats || null;
            const dismissalKey = buildHcDismissalKey(matchId, prevSnapshot.innings, targetBatterNorm, targetBowlerNorm, dismissalStats);
            const wicketTaken = nextSnapshot.sourceType === 'wicket'
                && nextSnapshot.dismissedBatterNorm === targetBatterNorm
                && intervalBowlerNorm === targetBowlerNorm
                && !countedDismissals.has(dismissalKey);
            if (intervalBowlerNorm === targetBowlerNorm && (deltaBalls > 0 || wicketTaken)) {
                totalRuns += deltaRuns;
                totalBalls += deltaBalls;
                if (wicketTaken) {
                    totalWickets += 1;
                    countedDismissals.add(dismissalKey);
                }
                matchedMatches.add(matchId);
                matchedInnings.add(`${matchId}:${prevSnapshot.innings}`);
            }
            if (nextSnapshot.exitedBatterNorm === targetBatterNorm) {
                closedBatters.add(batterInningsKey);
            }
        }
    }
    return {
        totalRuns,
        totalBalls,
        totalWickets,
        matchedMatches,
        matchedInnings,
        sharedMatches,
        facedMatchCount: matchedMatches.size,
        matchedInningsCount: matchedInnings.size,
        sharedMatchCount: sharedMatches.size
    };
}
function buildHcMatchupBreakdown(matchIds, rowsByMatch, targetBatterNorm, targetBowlerNorm, labelPrefix) {
    const breakdown = [];
    for (const matchId of matchIds) {
        const singleMatchStats = computeHcBowlerVsBatterStats([matchId], rowsByMatch, targetBatterNorm, targetBowlerNorm);
        const breakdownEntry = buildHcMatchupBreakdownEntry(`${labelPrefix} ${matchId}`, singleMatchStats);
        if (breakdownEntry) {
            breakdown.push(breakdownEntry);
        }
    }
    return breakdown;
}
function buildHcMatchupBreakdownEntry(label, stats) {
    if (!stats || (stats.totalBalls === 0 && stats.totalWickets === 0 && stats.matchedInningsCount === 0 && stats.sharedMatchCount === 0)) {
        return null;
    }
    return {
        label,
        runs: stats.totalRuns || 0,
        balls: stats.totalBalls || 0,
        dismissals: stats.totalWickets || 0,
        inningsFaced: stats.matchedInningsCount || 0,
        sharedMatchCount: stats.sharedMatchCount || 0
    };
}
function buildHcMatchupEmbed(parsedInput, stats) {
    const strikeRate = stats.totalBalls > 0 ? ((stats.totalRuns / stats.totalBalls) * 100).toFixed(2) : '0.00';
    const battingAverage = stats.totalWickets > 0 ? (stats.totalRuns / stats.totalWickets).toFixed(2) : 'Not Out';
    const metButDidNotFaceCount = Math.max(0, stats.sharedMatchCount - stats.facedMatchCount);
    const aggregateScopeNote = stats.sharedMatchCount > 1 || stats.facedMatchCount > 1 || stats.matchedInningsCount > 1
        ? `These are cumulative totals across ${stats.sharedMatchCount} captured match${stats.sharedMatchCount === 1 ? '' : 'es'} and ${stats.matchedInningsCount} innings, not a single innings.`
        : 'These totals come from one captured innings face-off.';
    const summaryLine = stats.matchedInningsCount === 0
        ? `${parsedInput.batterName} and ${parsedInput.bowlerName} appeared in the same captured match, but no direct innings face-off was found.`
        : `${parsedInput.batterName} scored ${stats.totalRuns} runs from ${stats.totalBalls} balls against ${parsedInput.bowlerName}${stats.totalWickets ? ` and was dismissed ${stats.totalWickets} time${stats.totalWickets === 1 ? '' : 's'}` : ' without being dismissed'}. They met in ${stats.sharedMatchCount} match${stats.sharedMatchCount === 1 ? '' : 'es'}, faced in ${stats.matchedInningsCount} innings across ${stats.facedMatchCount} match${stats.facedMatchCount === 1 ? '' : 'es'}, and met without facing in ${metButDidNotFaceCount} match${metButDidNotFaceCount === 1 ? '' : 'es'}.`;
    const breakdownLines = Array.isArray(stats.breakdown)
        ? stats.breakdown
            .slice(0, 6)
            .map(entry => `${entry.label}: ${entry.runs}r, ${entry.balls}b, ${entry.dismissals}w`)
        : [];
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0x16A34A)
        .setTitle(stats.sharedMatchCount > 1 || stats.facedMatchCount > 1 ? 'HC Matchup Aggregate' : 'HC Matchup')
        .setDescription(`**Batter:** ${parsedInput.batterName}\n**Bowler:** ${parsedInput.bowlerName}\n\n${summaryLine}\n\n${aggregateScopeNote}`)
        .addFields({ name: 'Runs', value: `**${stats.totalRuns}**`, inline: true }, { name: 'Balls', value: `**${stats.totalBalls}**`, inline: true }, { name: 'Dismissals', value: `**${stats.totalWickets}**`, inline: true }, { name: 'Strike Rate', value: `**${strikeRate}**`, inline: true }, { name: 'Average', value: `**${battingAverage}**`, inline: true }, { name: 'Matches', value: `**${stats.sharedMatchCount}**`, inline: true }, { name: 'Faced Matches', value: `**${stats.facedMatchCount}**`, inline: true }, { name: 'Innings Faced', value: `**${stats.matchedInningsCount}**`, inline: true }, { name: 'Met But Did Not Face', value: `**${metButDidNotFaceCount}**`, inline: true })
        .setTimestamp();
    if (breakdownLines.length) {
        embed.addFields({
            name: 'Match Breakdown',
            value: breakdownLines.join('\n')
        });
    }
    const avatarUrl = resolveCachedHcPlayerAvatarUrl(parsedInput.batterName);
    if (avatarUrl) {
        embed.setThumbnail(avatarUrl);
    }
    return embed;
}
function combineHcMatchupStats(globalRow, pendingStats, breakdown = []) {
    const aggregate = {
        totalRuns: (globalRow?.runs || 0) + (pendingStats?.totalRuns || 0),
        totalBalls: (globalRow?.balls || 0) + (pendingStats?.totalBalls || 0),
        totalWickets: (globalRow?.dismissals || 0) + (pendingStats?.totalWickets || 0),
        facedMatchCount: (globalRow?.faced_matches || 0) + (pendingStats?.facedMatchCount || 0),
        matchedInningsCount: (globalRow?.innings_faced || 0) + (pendingStats?.matchedInningsCount || 0),
        sharedMatchCount: (globalRow?.matches || 0) + (pendingStats?.sharedMatchCount || 0),
        breakdown
    };
    return aggregate;
}
function resolveCachedHcPlayerAvatarUrl(playerName) {
    const targetNorm = normalizeHcName(playerName);
    if (!targetNorm) {
        return null;
    }
    for (const user of client.users.cache.values()) {
        const usernameNorm = normalizeHcName(user.username || '');
        const globalNameNorm = normalizeHcName(user.globalName || '');
        if (targetNorm === usernameNorm || (globalNameNorm && targetNorm === globalNameNorm)) {
            return user.displayAvatarURL({ extension: 'png', size: 256 });
        }
    }
    for (const guild of client.guilds.cache.values()) {
        const matchedMember = guild.members.cache.find(member => {
            const displayNorm = normalizeHcName(member.displayName || '');
            const usernameNorm = normalizeHcName(member.user?.username || '');
            const globalNameNorm = normalizeHcName(member.user?.globalName || '');
            return targetNorm === displayNorm || targetNorm === usernameNorm || (globalNameNorm && targetNorm === globalNameNorm);
        });
        if (matchedMember) {
            return matchedMember.displayAvatarURL({ extension: 'png', size: 256 });
        }
    }
    return null;
}
async function getAutoTrackedHcBowlerVsBatterStats(parsedInput, targetBatterNorm, targetBowlerNorm) {
    const db = (0, database_1.getDB)();
    const globalRow = await db.get(`SELECT runs, balls, dismissals, matches, faced_matches, innings_faced
        FROM hc_global_matchups
        WHERE batter_norm = ? AND bowler_norm = ?`, targetBatterNorm, targetBowlerNorm);
    const finalizedBreakdownRows = await db.all(`SELECT match_id, runs, balls, dismissals, innings_faced
        FROM hc_matchup_match_log
        WHERE batter_norm = ? AND bowler_norm = ?
          AND (faced_matches > 0 OR runs > 0 OR balls > 0 OR dismissals > 0)
        ORDER BY match_id ASC`, targetBatterNorm, targetBowlerNorm);
    const matches = await db.all(`SELECT id
        FROM hc_auto_matches
        WHERE finalized_at IS NULL
        ORDER BY id ASC`);
    let pendingStats = null;
    const breakdown = finalizedBreakdownRows.map(row => ({
        label: `Match ${row.match_id} (Finalized)`,
        runs: row.runs || 0,
        balls: row.balls || 0,
        dismissals: row.dismissals || 0,
        inningsFaced: row.innings_faced || 0,
        sharedMatchCount: 1
    }));
    if (matches.length) {
        const matchIds = matches.map(match => match.id);
        const placeholders = matchIds.map(() => '?').join(', ');
        const rows = await db.all(`SELECT id, match_id as session_id, source_message_id, source_created_at, observed_at, event_type, payload_json
            FROM hc_auto_message_versions
            WHERE match_id IN (${placeholders})
            ORDER BY match_id ASC, observed_at ASC, id ASC`, ...matchIds);
        if (rows.length) {
            const rowsByMatch = new Map();
            for (const row of rows) {
                if (!rowsByMatch.has(row.session_id)) {
                    rowsByMatch.set(row.session_id, []);
                }
                rowsByMatch.get(row.session_id).push(row);
            }
            pendingStats = computeHcBowlerVsBatterStats(matchIds, rowsByMatch, targetBatterNorm, targetBowlerNorm);
            breakdown.push(...buildHcMatchupBreakdown(matchIds, rowsByMatch, targetBatterNorm, targetBowlerNorm, 'Match'));
            breakdown.forEach(entry => {
                if (/^Match \d+$/.test(entry.label)) {
                    entry.label = `${entry.label} (Active)`;
                }
            });
        }
    }
    if (!globalRow && !pendingStats) {
        return null;
    }
    return combineHcMatchupStats(globalRow, pendingStats, breakdown);
}
async function handleBowlerVsBatterCommand(message, args) {
    const parsedInput = parseHcBowlerVsBatterInput(args, message);
    if (!parsedInput) {
        await message.reply('Usage: `?bvb @bowler @batter [sessionId]`, `?bvb bowler vs batter`, or `?bvb "bowler name" "batter name"`\nExamples: `?bvb @reachingthesummit @copyninjam10`, `?bvb reachingthesummit vs copyninjam10`, `?bvb "multi word bowler" "multi word batter"`');
        return true;
    }
    const targetBowlerNorm = normalizeHcName(parsedInput.bowlerName);
    const targetBatterNorm = normalizeHcName(parsedInput.batterName);
    if (!targetBowlerNorm || !targetBatterNorm) {
        await message.reply('Both bowler and batter names are required.');
        return true;
    }
    if (!parsedInput.sessionId) {
        const autoTrackedStats = await getAutoTrackedHcBowlerVsBatterStats(parsedInput, targetBatterNorm, targetBowlerNorm);
        if (autoTrackedStats && (autoTrackedStats.sharedMatchCount || autoTrackedStats.totalBalls > 0 || autoTrackedStats.totalWickets > 0)) {
            await message.reply({
                embeds: [buildHcMatchupEmbed(parsedInput, autoTrackedStats)]
            });
            return true;
        }
    }
    const db = (0, database_1.getDB)();
    const sessions = parsedInput.sessionId
        ? await db.all(`SELECT id
            FROM hc_analysis_sessions
            WHERE id = ? AND status LIKE 'ENDED_%'
            ORDER BY id ASC`, parsedInput.sessionId)
        : await db.all(`SELECT id
            FROM hc_analysis_sessions
            WHERE status LIKE 'ENDED_%'
            ORDER BY id ASC`);
    if (!sessions.length) {
        const activeSession = message.guild?.id && message.channel?.id
            ? await getActiveHcAnalysisSession(message.guild.id, message.channel.id)
            : null;
        await message.reply(parsedInput.sessionId
            ? `No completed HC analysis session found for \`${parsedInput.sessionId}\`. Capture the match with \`?analysehcbot\`, then finish it with \`?endanalyse\` before running \`?bvb\`.`
            : activeSession
                ? `HC capture is still active in this channel with session \`${activeSession.id}\`. End it with \`?endanalyse\`, then run \`?bvb @bowler @batter ${activeSession.id}\` or \`?bvb "bowler name" "batter name" ${activeSession.id}\`.`
                : 'No auto-tracked or manually captured HC matchup data is available yet. Once HC bot messages appear in server channels, new matches will be tracked automatically.');
        return true;
    }
    const placeholders = sessions.map(() => '?').join(', ');
    const sessionIds = sessions.map(session => session.id);
    const rows = await db.all(`SELECT id, session_id, source_message_id, source_created_at, captured_at as observed_at, payload_json
        FROM hc_analysis_messages
        WHERE session_id IN (${placeholders})
        ORDER BY session_id ASC, source_created_at ASC, id ASC`, ...sessionIds);
    const rowsBySession = new Map();
    for (const row of rows) {
        if (!rowsBySession.has(row.session_id)) {
            rowsBySession.set(row.session_id, []);
        }
        rowsBySession.get(row.session_id).push(row);
    }
    const legacyStats = computeHcBowlerVsBatterStats(sessionIds, rowsBySession, targetBatterNorm, targetBowlerNorm);
    legacyStats.breakdown = buildHcMatchupBreakdown(sessionIds, rowsBySession, targetBatterNorm, targetBowlerNorm, 'Session');
    if (legacyStats.totalBalls === 0 && legacyStats.totalWickets === 0) {
        if (!legacyStats.sharedMatchCount) {
            await message.reply(`No captured HC matchup data found for **${parsedInput.batterName}** against **${parsedInput.bowlerName}**${parsedInput.sessionId ? ` in session \`${parsedInput.sessionId}\`` : ''}.\nCheck the exact HC display names and make sure the match was captured with \`?analysehcbot\` ... \`?endanalyse\`.`);
                return true;
        }
    }
    await message.reply({ embeds: [buildHcMatchupEmbed(parsedInput, legacyStats)] });
    return true;
}
async function handleBotStatusCommand(message) {
    const guilds = [...client.guilds.cache.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    const totalGuilds = guilds.length;
    const availableGuilds = guilds.filter(guild => guild.available !== false).length;
    const totalMembers = guilds.reduce((sum, guild) => sum + (guild.memberCount || 0), 0);
    const pageLines = guilds.map((guild, index) => {
        const status = guild.available === false ? 'Unavailable' : 'Available';
        const memberCount = Number.isFinite(guild.memberCount) ? guild.memberCount : '?';
        return `**${index + 1}. ${guild.name}**\nID: \`${guild.id}\` | Members: **${memberCount}** | Status: **${status}**`;
    });
    const pages = [];
    for (let i = 0; i < pageLines.length; i += 10) {
        pages.push(pageLines.slice(i, i + 10));
    }
    if (pages.length === 0)
        pages.push(['No guilds found.']);
    const buildEmbed = (pageIndex) => new discord_js_1.EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`Bot Status${pages.length > 1 ? ` (${pageIndex + 1}/${pages.length})` : ''}`)
        .setDescription(`**Bot:** ${client.user?.tag || 'Unknown'}\n**Ping:** ${Math.round(client.ws.ping)} ms\n**Uptime:** ${formatDuration(client.uptime || 0)}\n**Servers:** ${totalGuilds}\n**Available Servers:** ${availableGuilds}/${totalGuilds}\n**Approx Members:** ${totalMembers.toLocaleString()}\n\n${pages[pageIndex].join('\n\n')}`);
    if (pages.length === 1) {
        await message.reply({ embeds: [buildEmbed(0)] });
        return true;
    }
    let page = 0;
    const response = await message.reply({ embeds: [buildEmbed(page)], components: [(0, utils_1.buildPagedButtonRow)('botstatus', page, pages.length)] });
    const collector = response.createMessageComponentCollector({
        filter: interaction => interaction.user.id === message.author.id && ['botstatus_prev', 'botstatus_next'].includes(interaction.customId),
        time: 300000
    });
    collector.on('collect', async (interaction) => {
        if (interaction.customId === 'botstatus_prev' && page > 0)
            page--;
        if (interaction.customId === 'botstatus_next' && page < pages.length - 1)
            page++;
        await interaction.update({ embeds: [buildEmbed(page)], components: [(0, utils_1.buildPagedButtonRow)('botstatus', page, pages.length)] }).catch(() => null);
    });
    collector.on('end', () => {
        response.edit({ components: [] }).catch(() => null);
    });
    return true;
}
async function handleCommandStatsCommand(message, args) {
    const db = (0, database_1.getDB)();
    const requestedCommand = String(args[0] || '').trim().toLowerCase().replace(/^\?/, '');
    if (requestedCommand) {
        const rows = await db.all(`SELECT guild_id, usage_count, last_used_at
            FROM command_usage_stats
            WHERE command_name = ?
            ORDER BY usage_count DESC, last_used_at DESC, guild_id ASC`, requestedCommand);
        if (!rows.length) {
            await message.reply(`No usage data found for command \`${requestedCommand}\`.`);
            return true;
        }
        const totalUses = rows.reduce((sum, row) => sum + Number(row.usage_count || 0), 0);
        const pageLines = rows.map((row, index) => {
            const guild = client.guilds.cache.get(row.guild_id);
            const guildName = guild?.name || `Unknown Guild (${row.guild_id})`;
            const lastUsed = row.last_used_at ? `<t:${row.last_used_at}:R>` : 'Unknown';
            return `**${index + 1}. ${guildName}**\nUses: **${row.usage_count}** | Last Used: ${lastUsed}`;
        });
        const pages = [];
        for (let i = 0; i < pageLines.length; i += 10) {
            pages.push(pageLines.slice(i, i + 10));
        }
        const buildEmbed = (pageIndex) => new discord_js_1.EmbedBuilder()
            .setColor(0xF59E0B)
            .setTitle(`Command Usage: ${requestedCommand}${pages.length > 1 ? ` (${pageIndex + 1}/${pages.length})` : ''}`)
            .setDescription(`**Total Uses:** ${totalUses}\n**Guilds Using Command:** ${rows.length}\n\n${pages[pageIndex].join('\n\n')}`);
        if (pages.length === 1) {
            await message.reply({ embeds: [buildEmbed(0)] });
            return true;
        }
        let page = 0;
        const response = await message.reply({ embeds: [buildEmbed(page)], components: [(0, utils_1.buildPagedButtonRow)('cmdstatsdetail', page, pages.length)] });
        const collector = response.createMessageComponentCollector({
            filter: interaction => interaction.user.id === message.author.id && ['cmdstatsdetail_prev', 'cmdstatsdetail_next'].includes(interaction.customId),
            time: 300000
        });
        collector.on('collect', async (interaction) => {
            if (interaction.customId === 'cmdstatsdetail_prev' && page > 0)
                page--;
            if (interaction.customId === 'cmdstatsdetail_next' && page < pages.length - 1)
                page++;
            await interaction.update({ embeds: [buildEmbed(page)], components: [(0, utils_1.buildPagedButtonRow)('cmdstatsdetail', page, pages.length)] }).catch(() => null);
        });
        collector.on('end', () => {
            response.edit({ components: [] }).catch(() => null);
        });
        return true;
    }
    const totals = await db.all(`SELECT command_name, SUM(usage_count) as total_uses
        FROM command_usage_stats
        GROUP BY command_name`);
    if (!totals.length) {
        await message.reply("No command usage data has been recorded yet.");
        return true;
    }
    const totalInvocations = totals.reduce((sum, row) => sum + Number(row.total_uses || 0), 0);
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0x10B981)
        .setTitle('Command Usage Stats')
        .setDescription(`**Total Command Uses:** ${totalInvocations}`)
        .setFooter({ text: 'Use ?cmdstats <command> to inspect one command by guild.' });
    await message.reply({ embeds: [embed] });
    return true;
}
async function handleDatabaseStorageCommand(message, args) {
    const db = (0, database_1.getDB)();
    const filterArg = String(args[0] || '').trim().toLowerCase();
    let typeFilter = null;
    if (filterArg === 'tables' || filterArg === 'table') {
        typeFilter = 'table';
    }
    else if (filterArg === 'indexes' || filterArg === 'index') {
        typeFilter = 'index';
    }
    if ((0, database_1.getDBKind)() === 'postgres') {
        const sizeRow = await db.get('SELECT pg_database_size(current_database()) AS total_bytes');
        const rows = await db.all(`SELECT
                c.relname AS object_name,
                CASE WHEN c.relkind = 'i' THEN 'index' ELSE 'table' END AS object_type,
                pg_total_relation_size(c.oid) AS bytes,
                COALESCE(s.n_live_tup, 0) AS estimated_rows
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
            WHERE n.nspname = 'public'
              AND c.relkind IN ('r', 'i')
            ORDER BY bytes DESC, c.relname ASC`);
        const filteredRows = rows.filter((row) => {
            if (!typeFilter) {
                return true;
            }
            return String(row.object_type || '').toLowerCase() === typeFilter;
        });
        if (!filteredRows.length) {
            await message.reply(`No database objects matched \`${filterArg || 'all'}\`.`);
            return true;
        }
        const totalBytes = Number(sizeRow?.total_bytes || 0);
        const totalShownBytes = filteredRows.reduce((sum, row) => sum + Number(row.bytes || 0), 0);
        const lines = filteredRows.map((row, index) => {
            const bytes = Number(row.bytes || 0);
            const estimatedRows = Number(row.estimated_rows || 0);
            const pct = totalBytes > 0 ? ((bytes / totalBytes) * 100).toFixed(bytes >= totalBytes * 0.1 ? 1 : 2) : '0.00';
            return `**${index + 1}.** [${String(row.object_type || 'unknown').toUpperCase()}] \`${row.object_name}\`\n${formatBytes(bytes)} | ${pct}% of DB | ~${estimatedRows.toLocaleString()} rows`;
        });
        const pages = [];
        for (let i = 0; i < lines.length; i += 10) {
            pages.push(lines.slice(i, i + 10));
        }
        const scopeLabel = typeFilter ? `${typeFilter}s` : 'all objects';
        const buildEmbed = (pageIndex) => new discord_js_1.EmbedBuilder()
            .setColor(0x0EA5E9)
            .setTitle(`Database Storage: ${scopeLabel}${pages.length > 1 ? ` (${pageIndex + 1}/${pages.length})` : ''}`)
            .setDescription(pages[pageIndex].join('\n\n'))
            .addFields({ name: 'Total DB Size', value: formatBytes(totalBytes), inline: true }, { name: 'Shown Size', value: formatBytes(totalShownBytes), inline: true }, { name: 'Shown Objects', value: `${filteredRows.length}`, inline: true }, { name: 'Database Engine', value: 'PostgreSQL', inline: true }, { name: 'Schema', value: 'public', inline: true }, { name: 'Metric', value: 'Estimated rows', inline: true })
            .setFooter({ text: 'Use ?dbstorage, ?dbsize, ?dbstorage tables, or ?dbstorage indexes.' });
        if (pages.length === 1) {
            await message.reply({ embeds: [buildEmbed(0)] });
            return true;
        }
        let page = 0;
        const response = await message.reply({ embeds: [buildEmbed(page)], components: [(0, utils_1.buildPagedButtonRow)('dbstorage', page, pages.length)] });
        const collector = response.createMessageComponentCollector({
            filter: interaction => interaction.user.id === message.author.id && ['dbstorage_prev', 'dbstorage_next'].includes(interaction.customId),
            time: 300000
        });
        collector.on('collect', async (interaction) => {
            if (interaction.customId === 'dbstorage_prev' && page > 0) {
                page--;
            }
            if (interaction.customId === 'dbstorage_next' && page < pages.length - 1) {
                page++;
            }
            await interaction.update({ embeds: [buildEmbed(page)], components: [(0, utils_1.buildPagedButtonRow)('dbstorage', page, pages.length)] }).catch(() => null);
        });
        collector.on('end', () => {
            response.edit({ components: [] }).catch(() => null);
        });
        return true;
    }
    const pageSizeRow = await db.get('PRAGMA page_size');
    const pageCountRow = await db.get('PRAGMA page_count');
    const freelistRow = await db.get('PRAGMA freelist_count');
    const pageSize = Number(pageSizeRow?.page_size || 0);
    const pageCount = Number(pageCountRow?.page_count || 0);
    const freelistCount = Number(freelistRow?.freelist_count || 0);
    const totalBytes = pageSize * pageCount;
    const freeBytes = pageSize * freelistCount;
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    const rows = await db.all(`SELECT
            d.name AS object_name,
            COALESCE(s.type, CASE WHEN d.name = 'sqlite_schema' THEN 'schema' ELSE 'internal' END) AS object_type,
            SUM(d.pgsize) AS bytes,
            COUNT(*) AS pages
        FROM dbstat d
        LEFT JOIN sqlite_schema s ON s.name = d.name
        GROUP BY d.name, object_type
        ORDER BY bytes DESC, d.name ASC`);
    const filteredRows = rows.filter((row) => {
        if (!typeFilter) {
            return true;
        }
        return String(row.object_type || '').toLowerCase() === typeFilter;
    });
    if (!filteredRows.length) {
        await message.reply(`No database objects matched \`${filterArg || 'all'}\`.`);
        return true;
    }
    const totalShownBytes = filteredRows.reduce((sum, row) => sum + Number(row.bytes || 0), 0);
    const lines = filteredRows.map((row, index) => {
        const bytes = Number(row.bytes || 0);
        const pages = Number(row.pages || 0);
        const pct = totalBytes > 0 ? ((bytes / totalBytes) * 100).toFixed(bytes >= totalBytes * 0.1 ? 1 : 2) : '0.00';
        return `**${index + 1}.** [${String(row.object_type || 'unknown').toUpperCase()}] \`${row.object_name}\`\n${formatBytes(bytes)} | ${pct}% of DB | ${pages.toLocaleString()} pages`;
    });
    const pages = [];
    for (let i = 0; i < lines.length; i += 10) {
        pages.push(lines.slice(i, i + 10));
    }
    const scopeLabel = typeFilter ? `${typeFilter}s` : 'all objects';
    const buildEmbed = (pageIndex) => new discord_js_1.EmbedBuilder()
        .setColor(0x0EA5E9)
        .setTitle(`Database Storage: ${scopeLabel}${pages.length > 1 ? ` (${pageIndex + 1}/${pages.length})` : ''}`)
        .setDescription(pages[pageIndex].join('\n\n'))
        .addFields({ name: 'Total DB Size', value: formatBytes(totalBytes), inline: true }, { name: 'Used Size', value: formatBytes(usedBytes), inline: true }, { name: 'Free Size', value: formatBytes(freeBytes), inline: true }, { name: 'Shown Objects', value: `${filteredRows.length}`, inline: true }, { name: 'Shown Size', value: formatBytes(totalShownBytes), inline: true }, { name: 'Page Size', value: formatBytes(pageSize), inline: true })
        .setFooter({ text: 'Use ?dbstorage, ?dbsize, ?dbstorage tables, or ?dbstorage indexes.' });
    if (pages.length === 1) {
        await message.reply({ embeds: [buildEmbed(0)] });
        return true;
    }
    let page = 0;
    const response = await message.reply({ embeds: [buildEmbed(page)], components: [(0, utils_1.buildPagedButtonRow)('dbstorage', page, pages.length)] });
    const collector = response.createMessageComponentCollector({
        filter: interaction => interaction.user.id === message.author.id && ['dbstorage_prev', 'dbstorage_next'].includes(interaction.customId),
        time: 300000
    });
    collector.on('collect', async (interaction) => {
        if (interaction.customId === 'dbstorage_prev' && page > 0) {
            page--;
        }
        if (interaction.customId === 'dbstorage_next' && page < pages.length - 1) {
            page++;
        }
        await interaction.update({ embeds: [buildEmbed(page)], components: [(0, utils_1.buildPagedButtonRow)('dbstorage', page, pages.length)] }).catch(() => null);
    });
    collector.on('end', () => {
        response.edit({ components: [] }).catch(() => null);
    });
    return true;
}
async function handleBackupNowCommand(message) {
    try {
        const snapshot = await createTimestampedSnapshot(MANUAL_BACKUP_DIR, 'auction_v2-manual');
        pruneBackupDirectory(MANUAL_BACKUP_DIR, MANUAL_BACKUP_RETENTION_COUNT);
        await message.reply({ embeds: [buildBackupEmbed('Manual Backup Complete', snapshot, 'Created a fresh SQLite snapshot on disk.')] });
    }
    catch (error) {
        console.error('Manual backup failed:', error);
        await message.reply(`Backup failed: ${error.message}`);
    }
    return true;
}
async function handleExportDataCommand(message) {
    try {
        const snapshot = await createTimestampedSnapshot(EXPORT_BACKUP_DIR, 'auction_v2-export');
        pruneBackupDirectory(EXPORT_BACKUP_DIR, EXPORT_BACKUP_RETENTION_COUNT);
        const embed = buildBackupEmbed('Data Export Ready', snapshot, 'Created a fresh SQLite snapshot for export.');
        if (snapshot.sizeBytes <= DISCORD_ATTACHMENT_LIMIT_BYTES) {
            const attachment = new discord_js_1.AttachmentBuilder(snapshot.path, { name: snapshot.fileName });
            await message.reply({ embeds: [embed], files: [attachment] });
        }
        else {
            embed.setColor(0xF59E0B).addFields({ name: 'Attachment Status', value: `File exceeds Discord upload limit (${formatBytes(snapshot.sizeBytes)} > ${formatBytes(DISCORD_ATTACHMENT_LIMIT_BYTES)}).`, inline: false });
            await message.reply({ embeds: [embed] });
        }
    }
    catch (error) {
        console.error('Data export failed:', error);
        await message.reply(`Export failed: ${error.message}`);
    }
    return true;
}
const DISCORD_MESSAGE_LINK_REGEX = /https?:\/\/(?:canary\.|ptb\.)?discord\.com\/channels\/(\d+|@me)\/(\d+)\/(\d+)/i;
async function resolveTargetMessageForEmbedText(message, args) {
    if (message.reference?.messageId) {
        return await message.fetchReference().catch(() => null);
    }
    const rawInput = args.join(' ').trim();
    if (!rawInput) {
        return null;
    }
    const linkMatch = rawInput.match(DISCORD_MESSAGE_LINK_REGEX);
    if (linkMatch) {
        const targetGuildId = linkMatch[1];
        const channelId = linkMatch[2];
        const messageId = linkMatch[3];
        if (targetGuildId !== '@me' && message.guild && targetGuildId !== message.guild.id) {
            return null;
        }
        const targetChannel = await client.channels.fetch(channelId).catch(() => null);
        if (!targetChannel?.isTextBased?.()) {
            return null;
        }
        return await targetChannel.messages.fetch(messageId).catch(() => null);
    }
    if (/^\d{16,20}$/.test(rawInput) && message.channel?.isTextBased?.()) {
        return await message.channel.messages.fetch(rawInput).catch(() => null);
    }
    return null;
}
function formatEmbedFieldValue(value) {
    if (typeof value === 'string') {
        return value;
    }
    if (value === null || value === undefined) {
        return '';
    }
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value, null, 2);
        }
        catch {
            return String(value);
        }
    }
    return String(value);
}
function buildEmbedTextDump(targetMessage) {
    const messageUrl = `https://discord.com/channels/${targetMessage.guild?.id || '@me'}/${targetMessage.channelId}/${targetMessage.id}`;
    const lines = [
        `Message ID: ${targetMessage.id}`,
        `Channel ID: ${targetMessage.channelId}`,
        `Guild ID: ${targetMessage.guild?.id || '@me'}`,
        `Author ID: ${targetMessage.author?.id || 'Unknown'}`,
        `Author: ${targetMessage.author?.tag || targetMessage.author?.username || 'Unknown'}`,
        `Created At: ${new Date(targetMessage.createdTimestamp || Date.now()).toISOString()}`,
        `Source: ${messageUrl}`,
        ''
    ];
    if (targetMessage.content) {
        lines.push('[Message Content]');
        lines.push(targetMessage.content);
        lines.push('');
    }
    const embeds = Array.isArray(targetMessage.embeds) ? targetMessage.embeds : [];
    if (!embeds.length) {
        lines.push('[Embeds]');
        lines.push('No embeds found on target message.');
        return lines.join('\n');
    }
    lines.push('[Embeds]');
    embeds.forEach((embed, index) => {
        const embedData = typeof embed.toJSON === 'function' ? embed.toJSON() : embed;
        lines.push('');
        lines.push(`=== Embed ${index + 1} ===`);
        if (embedData.title)
            lines.push(`Title: ${formatEmbedFieldValue(embedData.title)}`);
        if (embedData.description)
            lines.push(`Description:\n${formatEmbedFieldValue(embedData.description)}`);
        if (embedData.url)
            lines.push(`URL: ${formatEmbedFieldValue(embedData.url)}`);
        if (embedData.color !== undefined)
            lines.push(`Color: ${formatEmbedFieldValue(embedData.color)}`);
        if (embedData.timestamp)
            lines.push(`Timestamp: ${formatEmbedFieldValue(embedData.timestamp)}`);
        if (embedData.author?.name)
            lines.push(`Author: ${formatEmbedFieldValue(embedData.author.name)}`);
        if (embedData.author?.url)
            lines.push(`Author URL: ${formatEmbedFieldValue(embedData.author.url)}`);
        if (embedData.footer?.text)
            lines.push(`Footer: ${formatEmbedFieldValue(embedData.footer.text)}`);
        if (embedData.thumbnail?.url)
            lines.push(`Thumbnail: ${formatEmbedFieldValue(embedData.thumbnail.url)}`);
        if (embedData.image?.url)
            lines.push(`Image: ${formatEmbedFieldValue(embedData.image.url)}`);
        if (Array.isArray(embedData.fields) && embedData.fields.length) {
            lines.push('Fields:');
            embedData.fields.forEach((field, fieldIndex) => {
                lines.push(`${fieldIndex + 1}. ${formatEmbedFieldValue(field.name)}`);
                lines.push(formatEmbedFieldValue(field.value));
            });
        }
    });
    return lines.join('\n');
}
async function handleEmbedToTextCommand(message, args) {
    const targetMessage = await resolveTargetMessageForEmbedText(message, args);
    if (!targetMessage) {
        await message.reply('Usage: reply to a message with `?embedtotext`, or run `?embedtotext <message-link>` or `?embedtotext <message-id-in-this-channel>`.');
        return true;
    }
    const textDump = buildEmbedTextDump(targetMessage);
    const fileName = `embed-text-${targetMessage.id}.txt`;
    const attachment = new discord_js_1.AttachmentBuilder(Buffer.from(textDump, 'utf8'), { name: fileName });
    const sourceUrl = `https://discord.com/channels/${targetMessage.guild?.id || '@me'}/${targetMessage.channelId}/${targetMessage.id}`;
    if (textDump.length <= 1600) {
        await message.reply({
            content: `Embed text extracted from ${sourceUrl}\n\`\`\`txt\n${textDump}\n\`\`\``,
            files: [attachment]
        });
        return true;
    }
    await message.reply({
        content: `Embed text extracted from ${sourceUrl}. Attached as \`${fileName}\` for easier searching.`,
        files: [attachment]
    });
    return true;
}
async function handleAuditLogCommand(message, args) {
    const requestedLimit = parseInt(String(args[0] || ''), 10);
    const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(50, requestedLimit)) : 15;
    const rows = await (0, auditLog_1.getAdminAuditLogs)(message.guild.id, limit);
    if (!rows.length) {
        await message.reply("No admin audit entries have been recorded yet.");
        return true;
    }
    const pageLines = rows.map((row, index) => {
        const actorText = row.actor_id ? `<@${row.actor_id}>` : 'Unknown admin';
        const targetText = row.target_summary ? `\nTarget: ${row.target_summary}` : '';
        const channelText = row.channel_id ? ` | Channel: <#${row.channel_id}>` : '';
        return `**${index + 1}. \`${row.command_name}\`** by ${actorText}\n${row.summary}${targetText}\n<t:${row.created_at}:F> (${`<t:${row.created_at}:R>`})${channelText}`;
    });
    const pages = [];
    for (let i = 0; i < pageLines.length; i += 5) {
        pages.push(pageLines.slice(i, i + 5));
    }
    const buildEmbed = (pageIndex) => new discord_js_1.EmbedBuilder()
        .setColor(0x0EA5E9)
        .setTitle(`Admin Audit Log${pages.length > 1 ? ` (${pageIndex + 1}/${pages.length})` : ''}`)
        .setDescription(pages[pageIndex].join('\n\n'))
        .setFooter({ text: `Showing ${rows.length} most recent entries for this server.` });
    if (pages.length === 1) {
        await message.reply({ embeds: [buildEmbed(0)] });
        return true;
    }
    let page = 0;
    const response = await message.reply({ embeds: [buildEmbed(page)], components: [(0, utils_1.buildPagedButtonRow)('auditlog', page, pages.length)] });
    const collector = response.createMessageComponentCollector({
        filter: interaction => interaction.user.id === message.author.id && ['auditlog_prev', 'auditlog_next'].includes(interaction.customId),
        time: 300000
    });
    collector.on('collect', async (interaction) => {
        if (interaction.customId === 'auditlog_prev' && page > 0)
            page--;
        if (interaction.customId === 'auditlog_next' && page < pages.length - 1)
            page++;
        await interaction.update({ embeds: [buildEmbed(page)], components: [(0, utils_1.buildPagedButtonRow)('auditlog', page, pages.length)] }).catch(() => null);
    });
    collector.on('end', () => {
        response.edit({ components: [] }).catch(() => null);
    });
    return true;
}
async function appendAutomaticCommandAudit(message, commandName, args, options = {}) {
    if (!message.guild) {
        return false;
    }
    try {
        return await (0, auditLog_1.appendAutomaticAdminAuditLog)({
            guildId: message.guild.id,
            actorId: message.author.id,
            commandName,
            args,
            channelId: message.channel?.id || null,
            ...options
        });
    }
    catch (error) {
        console.error(`Failed to append automatic admin audit for ${commandName}:`, error);
        return false;
    }
}
async function handleHealthCheckCommand(message) {
    const guild = message.guild;
    if (!guild) {
        return true;
    }
    const db = (0, database_1.getDB)();
    const counters = { issues: 0, warnings: 0 };
    const coreLines = [];
    const channelLines = [];
    const integrityLines = [];
    try {
        const [settings, potdSettings, iplSettings, ptSettings, statsSeason, fixtureSettings, tradeSettings, teams, captains, stadiums, publicPings, pendingScheduled, openReservations, openPotdPolls, unsettledIplMatches, fixtureSetupState] = await Promise.all([
            db.get('SELECT * FROM guild_settings WHERE guild_id = ?', guild.id),
            db.get('SELECT * FROM potd_settings WHERE guild_id = ?', guild.id),
            db.get('SELECT * FROM ipl_prediction_settings WHERE guild_id = ?', guild.id),
            db.get('SELECT * FROM pt_settings WHERE guild_id = ?', guild.id),
            db.get('SELECT season_name FROM stats_seasons WHERE guild_id = ? AND is_active = 1', guild.id),
            db.get('SELECT * FROM fixture_settings WHERE guild_id = ?', guild.id),
            db.get('SELECT * FROM trade_settings WHERE guild_id = ?', guild.id),
            db.all('SELECT team_id, role_id FROM teams WHERE guild_id = ?', guild.id),
            db.all('SELECT team_id FROM team_captains WHERE guild_id = ?', guild.id),
            db.all('SELECT team_id, channel_id FROM team_stadiums WHERE guild_id = ?', guild.id),
            db.all('SELECT role_id, restricted_channel_id FROM public_pings WHERE guild_id = ?', guild.id),
            db.get("SELECT COUNT(*) AS count FROM scheduled_messages WHERE guild_id = ? AND status = 'PENDING'", guild.id),
            db.get("SELECT COUNT(*) AS count FROM match_reservations WHERE guild_id = ? AND status IN ('PENDING', 'OPEN', 'RESERVED')", guild.id),
            db.get("SELECT COUNT(*) AS count FROM potd_polls WHERE guild_id = ? AND status = 'OPEN'", guild.id),
            db.get("SELECT COUNT(*) AS count FROM ipl_prediction_matches WHERE guild_id = ? AND status != 'SETTLED'", guild.id),
            db.get('SELECT step, timestamp FROM fixture_setup_state WHERE guild_id = ?', guild.id)
        ]);
        pushHealthLine(coreLines, counters, 'ok', 'Database', 'Connected');
        pushHealthLine(coreLines, counters, settings?.timezone ? 'ok' : 'warning', 'Timezone', settings?.timezone ? `${normalizeGuildTimeZone(settings.timezone)}` : `Not set, using fallback ${normalizeGuildTimeZone(null)}`);
        pushHealthLine(coreLines, counters, statsSeason?.season_name ? 'ok' : 'warning', 'Active Stats Season', statsSeason?.season_name || 'Not configured');
        pushHealthLine(coreLines, counters, ptSettings ? 'ok' : 'warning', 'Point Table Season', ptSettings ? `Season ${ptSettings.current_season} | ${ptSettings.format_type || 'LEAGUE'}` : 'Not configured');
        pushHealthLine(coreLines, counters, settings?.schedule_season ? 'ok' : 'warning', 'Scheduling Season', settings?.schedule_season || 'Not configured');
        const bidTimer = Number.isFinite(settings?.auction_bid_timer_seconds) ? settings.auction_bid_timer_seconds : 15;
        const callTimer = Number.isFinite(settings?.auction_call_timer_seconds) ? settings.auction_call_timer_seconds : 2;
        pushHealthLine(coreLines, counters, settings ? 'ok' : 'warning', 'Auction Timers', `Bid ${bidTimer}s | Going Once/Twice ${callTimer}s`);
        const auctionAdminRole = guild.roles.cache.find(role => role.name === utils_1.ADMIN_ROLE_NAME);
        const superAdminRole = guild.roles.cache.find(role => role.name === 'Auction Super Admin');
        pushHealthLine(channelLines, counters, auctionAdminRole ? 'ok' : 'warning', 'Auction Admin Role', auctionAdminRole ? `${auctionAdminRole}` : 'Role not found');
        pushHealthLine(channelLines, counters, superAdminRole ? 'ok' : 'warning', 'Auction Super Admin Role', superAdminRole ? `${superAdminRole}` : 'Role not found');
        const fixtureAlertStatus = resolveChannelCheck(guild, settings?.fixture_announcement_channel_id, settings?.schedule_season ? 'warning' : 'info');
        pushHealthLine(channelLines, counters, fixtureAlertStatus.level, 'Fixture Announcement Channel', fixtureAlertStatus.detail);
        const salesLogStatus = resolveChannelCheck(guild, settings?.sales_log_channel_id, 'info');
        pushHealthLine(channelLines, counters, salesLogStatus.level, 'Sales Log Channel', salesLogStatus.detail);
        const adminAuditStatus = resolveChannelCheck(guild, settings?.admin_audit_log_channel_id, 'info');
        pushHealthLine(channelLines, counters, adminAuditStatus.level, 'Admin Audit Log Channel', adminAuditStatus.detail + ((settings && settings.admin_audit_logs_enabled === 0) ? ' | Disabled' : ' | Enabled'));
        const playerLogStatus = resolveChannelCheck(guild, settings?.community_player_log_channel_id || settings?.community_roster_log_channel_id, 'info');
        pushHealthLine(channelLines, counters, playerLogStatus.level, 'Player Activity Log Channel', playerLogStatus.detail + ((settings && settings.community_player_logs_enabled === 0) ? ' | Disabled' : ' | Enabled'));
        const regTeamChannelStatus = resolveChannelCheck(guild, settings?.regteam_command_channel_id, settings?.schedule_season ? 'warning' : 'info');
        pushHealthLine(channelLines, counters, regTeamChannelStatus.level, 'Reg-Team Command Channel', regTeamChannelStatus.detail);
        const restrictedPingStatus = resolveChannelCheck(guild, settings?.ping_restricted_channel_id, 'info');
        pushHealthLine(channelLines, counters, restrictedPingStatus.level, 'Admin Ping Channel', restrictedPingStatus.detail);
        const iplChannelStatus = resolveChannelCheck(guild, iplSettings?.channel_id, 'info');
        pushHealthLine(channelLines, counters, iplChannelStatus.level, 'IPL Prediction Channel', iplChannelStatus.detail);
        const potdVoteStatus = resolveChannelCheck(guild, potdSettings?.channel_id, 'info');
        const potdResultsStatus = resolveChannelCheck(guild, potdSettings?.results_channel_id, 'info');
        const potdPingRoleStatus = resolveRoleCheck(guild, potdSettings?.ping_role_id, 'info');
        pushHealthLine(channelLines, counters, potdVoteStatus.level, 'POTD Vote Channel', potdVoteStatus.detail);
        pushHealthLine(channelLines, counters, potdResultsStatus.level, 'POTD Results Channel', potdResultsStatus.detail);
        pushHealthLine(channelLines, counters, potdPingRoleStatus.level, 'POTD Ping Role', potdPingRoleStatus.detail);
        const tradeLogStatus = resolveChannelCheck(guild, tradeSettings?.log_channel_id, 'info');
        pushHealthLine(channelLines, counters, tradeLogStatus.level, 'Trade Log Channel', tradeLogStatus.detail + (tradeSettings?.is_open ? ' | Window open' : tradeSettings ? ' | Window closed' : ''));
        const captainTeamIds = new Set(captains.map(row => row.team_id));
        const stadiumMap = new Map(stadiums.map(row => [row.team_id, row.channel_id]));
        const teamsWithoutCaptains = teams.filter(team => !captainTeamIds.has(team.team_id)).length;
        const teamsWithoutRoles = teams.filter(team => !team.role_id).length;
        const teamsWithBrokenRoles = teams.filter(team => team.role_id && !guild.roles.cache.has(team.role_id)).length;
        const teamsWithoutStadiums = teams.filter(team => !stadiumMap.has(team.team_id)).length;
        const teamsWithBrokenStadiums = teams.filter(team => {
            const channelId = stadiumMap.get(team.team_id);
            return channelId && !guild.channels.cache.has(channelId);
        }).length;
        const brokenPublicPingRoles = publicPings.filter(row => !guild.roles.cache.has(row.role_id)).length;
        const brokenPublicPingChannels = publicPings.filter(row => row.restricted_channel_id && !guild.channels.cache.has(row.restricted_channel_id)).length;
        pushHealthLine(integrityLines, counters, teams.length ? 'ok' : 'warning', 'Teams', teams.length ? `${teams.length} configured` : 'No teams configured');
        pushHealthLine(integrityLines, counters, teamsWithoutCaptains ? 'issue' : 'ok', 'Teams Without Captains', `${teamsWithoutCaptains}`);
        pushHealthLine(integrityLines, counters, teamsWithBrokenRoles ? 'issue' : (teamsWithoutRoles ? 'warning' : 'ok'), 'Team Role Links', `Missing links: ${teamsWithoutRoles} | Broken linked roles: ${teamsWithBrokenRoles}`);
        const stadiumSeverity = teamsWithBrokenStadiums ? 'issue' : ((settings?.schedule_season && teamsWithoutStadiums) ? 'warning' : 'ok');
        pushHealthLine(integrityLines, counters, stadiumSeverity, 'Team Stadiums', `Missing links: ${teamsWithoutStadiums} | Broken linked channels: ${teamsWithBrokenStadiums}`);
        const publicPingSeverity = (brokenPublicPingRoles || brokenPublicPingChannels) ? 'issue' : 'ok';
        pushHealthLine(integrityLines, counters, publicPingSeverity, 'Public Ping References', `Broken roles: ${brokenPublicPingRoles} | Broken channels: ${brokenPublicPingChannels}`);
        const pendingJobs = [`Scheduled DMs: ${pendingScheduled?.count || 0}`, `Open Reservations: ${openReservations?.count || 0}`, `Open POTD Polls: ${openPotdPolls?.count || 0}`, `Unsettled IPL Matches: ${unsettledIplMatches?.count || 0}`];
        pushHealthLine(integrityLines, counters, 'info', 'Pending Jobs', pendingJobs.join(' | '));
        if (fixtureSetupState) {
            const rawTs = Number(fixtureSetupState.timestamp || 0);
            const tsSeconds = rawTs > 1000000000000 ? Math.floor(rawTs / 1000) : rawTs;
            pushHealthLine(integrityLines, counters, 'warning', 'Fixture Setup Wizard', `Saved unfinished state at step \`${fixtureSetupState.step}\`${tsSeconds ? ` | Updated <t:${tsSeconds}:R>` : ''}`);
        }
        else {
            pushHealthLine(integrityLines, counters, 'ok', 'Fixture Setup Wizard', 'No unfinished setup state');
        }
        if (fixtureSettings) {
            pushHealthLine(integrityLines, counters, 'info', 'Fixture Rules', `${fixtureSettings.min_players || '6v6'} to ${fixtureSettings.max_players || '9v9'} | Reserve limit ${fixtureSettings.max_reserve ?? 2}`);
        }
        const embedColor = counters.issues ? 0xDC2626 : (counters.warnings ? 0xF59E0B : 0x10B981);
        const summary = counters.issues ? `Found **${counters.issues}** issue(s) and **${counters.warnings}** warning(s).` : (counters.warnings ? `No broken references found. There are **${counters.warnings}** setup warning(s).` : 'Core setup looks healthy.');
        const embed = new discord_js_1.EmbedBuilder()
            .setColor(embedColor)
            .setTitle(`Health Check: ${guild.name}`)
            .setDescription(summary)
            .addFields({ name: 'Core Setup', value: coreLines.join('\n') || 'No data', inline: false }, { name: 'Channels & Roles', value: channelLines.join('\n') || 'No data', inline: false }, { name: 'Integrity & Jobs', value: integrityLines.join('\n') || 'No data', inline: false })
            .setFooter({ text: 'Legend: issue = broken reference or missing required link, warning = setup gap, info = optional subsystem status' });
        await message.reply({ embeds: [embed] });
    }
    catch (error) {
        console.error('Health check failed:', error);
        await message.reply(`Health check failed: ${error.message}`);
    }
    return true;
}
function findRoleByName(guild, roleName) {
    return guild.roles.cache.find(role => role.name.toLowerCase() === roleName.toLowerCase()) || null;
}
async function ensureGuildRole(guild, spec) {
    const desiredPermissions = new discord_js_1.PermissionsBitField(spec.permissions || []);
    let role = findRoleByName(guild, spec.name);
    if (!role) {
        role = await guild.roles.create({
            name: spec.name,
            color: spec.color,
            permissions: desiredPermissions,
            hoist: !!spec.hoist,
            mentionable: !!spec.mentionable,
            reason: SUPPORT_SERVER_SETUP_REASON
        });
        return { role, created: true, updated: false };
    }
    const editPayload = {};
    if (role.color !== spec.color)
        editPayload.color = spec.color;
    if (role.hoist !== !!spec.hoist)
        editPayload.hoist = !!spec.hoist;
    if (role.mentionable !== !!spec.mentionable)
        editPayload.mentionable = !!spec.mentionable;
    if (!role.permissions.equals(desiredPermissions))
        editPayload.permissions = desiredPermissions;
    if (Object.keys(editPayload).length) {
        role = await role.edit({ ...editPayload, reason: SUPPORT_SERVER_SETUP_REASON });
        return { role, created: false, updated: true };
    }
    return { role, created: false, updated: false };
}
function findChannelByName(guild, channelName, acceptedTypes) {
    return guild.channels.cache.find(channel => acceptedTypes.includes(channel.type) && channel.name.toLowerCase() === channelName.toLowerCase()) || null;
}
function getPermissionName(permissionBit) {
    return Object.entries(discord_js_1.PermissionFlagsBits).find(([, value]) => value === permissionBit)?.[0] || permissionBit.toString();
}
async function ensureGuildCategory(guild, categoryName, permissionOverwrites) {
    let category = findChannelByName(guild, categoryName, [discord_js_1.ChannelType.GuildCategory]);
    if (!category) {
        category = await guild.channels.create({
            name: categoryName,
            type: discord_js_1.ChannelType.GuildCategory,
            permissionOverwrites,
            reason: SUPPORT_SERVER_SETUP_REASON
        });
        return { channel: category, created: true, updated: false };
    }
    await category.permissionOverwrites.set(permissionOverwrites, SUPPORT_SERVER_SETUP_REASON);
    return { channel: category, created: false, updated: true };
}
async function ensureManagedChannel(guild, spec, parentId, permissionOverwrites) {
    const acceptedTypes = spec.acceptedTypes && spec.acceptedTypes.length ? spec.acceptedTypes : [spec.type];
    let channel = findChannelByName(guild, spec.name, acceptedTypes);
    if (!channel) {
        const createPayload = {
            name: spec.name,
            type: spec.type,
            parent: parentId,
            permissionOverwrites,
            reason: SUPPORT_SERVER_SETUP_REASON
        };
        if (spec.topic && spec.type !== discord_js_1.ChannelType.GuildVoice) {
            createPayload.topic = spec.topic;
        }
        channel = await guild.channels.create(createPayload);
        return { channel, created: true, updated: false };
    }
    const editPayload = {};
    if (channel.parentId !== parentId)
        editPayload.parent = parentId;
    if (spec.topic && channel.type !== discord_js_1.ChannelType.GuildVoice && channel.topic !== spec.topic) {
        editPayload.topic = spec.topic;
    }
    if (Object.keys(editPayload).length) {
        channel = await channel.edit({ ...editPayload, reason: SUPPORT_SERVER_SETUP_REASON });
    }
    await channel.permissionOverwrites.set(permissionOverwrites, SUPPORT_SERVER_SETUP_REASON);
    return { channel, created: false, updated: true };
}
async function handleSetupSupportServerCommand(message) {
    const guild = message.guild;
    const botMember = guild?.members?.me;
    if (!guild || !botMember) {
        await message.reply('This command can only run in a server where the bot is present.');
        return true;
    }
    const requiredPermissions = [
        discord_js_1.PermissionFlagsBits.ManageChannels,
        discord_js_1.PermissionFlagsBits.ManageRoles,
        discord_js_1.PermissionFlagsBits.ViewChannel,
        discord_js_1.PermissionFlagsBits.SendMessages
    ];
    const missingPermissions = requiredPermissions.filter(permission => !botMember.permissions.has(permission));
    if (missingPermissions.length) {
        await message.reply(`I am missing the permissions required for setup: ${missingPermissions.map(permission => `\`${getPermissionName(permission)}\``).join(', ')}`);
        return true;
    }
    const confirmed = await (0, utils_1.askConfirmation)(message, `This will create or update the full **Cheesy Manager** support-server layout in **${guild.name}**.\nIt will set up staff roles, intake forums, onboarding channels, and a private staff area. Matching roles/channels are reused on reruns when possible.`);
    if (!confirmed) {
        return true;
    }
    try {
        const roleSpecs = [
            {
                name: 'CM Leadership',
                color: 0xDC2626,
                hoist: true,
                mentionable: false,
                permissions: [
                    discord_js_1.PermissionFlagsBits.ViewChannel,
                    discord_js_1.PermissionFlagsBits.SendMessages,
                    discord_js_1.PermissionFlagsBits.ReadMessageHistory,
                    discord_js_1.PermissionFlagsBits.EmbedLinks,
                    discord_js_1.PermissionFlagsBits.AttachFiles,
                    discord_js_1.PermissionFlagsBits.AddReactions,
                    discord_js_1.PermissionFlagsBits.ManageMessages,
                    discord_js_1.PermissionFlagsBits.ManageThreads,
                    discord_js_1.PermissionFlagsBits.CreatePublicThreads,
                    discord_js_1.PermissionFlagsBits.CreatePrivateThreads,
                    discord_js_1.PermissionFlagsBits.ModerateMembers,
                    discord_js_1.PermissionFlagsBits.ManageChannels,
                    discord_js_1.PermissionFlagsBits.ManageRoles,
                    discord_js_1.PermissionFlagsBits.ManageWebhooks,
                    discord_js_1.PermissionFlagsBits.MentionEveryone,
                    discord_js_1.PermissionFlagsBits.ViewAuditLog,
                    discord_js_1.PermissionFlagsBits.Connect,
                    discord_js_1.PermissionFlagsBits.Speak,
                    discord_js_1.PermissionFlagsBits.UseVAD
                ]
            },
            {
                name: 'Support Team',
                color: 0x2563EB,
                hoist: true,
                mentionable: false,
                permissions: [
                    discord_js_1.PermissionFlagsBits.ViewChannel,
                    discord_js_1.PermissionFlagsBits.SendMessages,
                    discord_js_1.PermissionFlagsBits.ReadMessageHistory,
                    discord_js_1.PermissionFlagsBits.EmbedLinks,
                    discord_js_1.PermissionFlagsBits.AttachFiles,
                    discord_js_1.PermissionFlagsBits.AddReactions,
                    discord_js_1.PermissionFlagsBits.ManageMessages,
                    discord_js_1.PermissionFlagsBits.ManageThreads,
                    discord_js_1.PermissionFlagsBits.CreatePublicThreads,
                    discord_js_1.PermissionFlagsBits.CreatePrivateThreads,
                    discord_js_1.PermissionFlagsBits.ModerateMembers,
                    discord_js_1.PermissionFlagsBits.Connect,
                    discord_js_1.PermissionFlagsBits.Speak,
                    discord_js_1.PermissionFlagsBits.UseVAD
                ]
            },
            {
                name: 'Verified Server Owner',
                color: 0x059669,
                hoist: true,
                mentionable: false,
                permissions: [
                    discord_js_1.PermissionFlagsBits.ViewChannel,
                    discord_js_1.PermissionFlagsBits.SendMessages,
                    discord_js_1.PermissionFlagsBits.ReadMessageHistory
                ]
            },
            {
                name: 'Bug Hunter',
                color: 0xD97706,
                hoist: false,
                mentionable: false,
                permissions: [
                    discord_js_1.PermissionFlagsBits.ViewChannel,
                    discord_js_1.PermissionFlagsBits.SendMessages,
                    discord_js_1.PermissionFlagsBits.ReadMessageHistory
                ]
            },
            {
                name: 'Announcements',
                color: 0x6B7280,
                hoist: false,
                mentionable: true,
                permissions: []
            }
        ];
        const roleMap = new Map();
        const roleStats = { created: 0, updated: 0 };
        for (const spec of roleSpecs) {
            const result = await ensureGuildRole(guild, spec);
            roleMap.set(spec.name, result.role);
            if (result.created)
                roleStats.created++;
            else if (result.updated)
                roleStats.updated++;
        }
        const leadershipRole = roleMap.get('CM Leadership');
        const supportRole = roleMap.get('Support Team');
        const everyoneId = guild.roles.everyone.id;
        const publicReadOnlyOverwrites = [
            {
                id: everyoneId,
                allow: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.ReadMessageHistory],
                deny: [discord_js_1.PermissionFlagsBits.SendMessages, discord_js_1.PermissionFlagsBits.AddReactions, discord_js_1.PermissionFlagsBits.CreatePublicThreads, discord_js_1.PermissionFlagsBits.CreatePrivateThreads]
            },
            {
                id: leadershipRole.id,
                allow: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.ReadMessageHistory, discord_js_1.PermissionFlagsBits.SendMessages, discord_js_1.PermissionFlagsBits.EmbedLinks, discord_js_1.PermissionFlagsBits.AttachFiles, discord_js_1.PermissionFlagsBits.ManageMessages]
            },
            {
                id: supportRole.id,
                allow: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.ReadMessageHistory, discord_js_1.PermissionFlagsBits.SendMessages, discord_js_1.PermissionFlagsBits.EmbedLinks, discord_js_1.PermissionFlagsBits.AttachFiles, discord_js_1.PermissionFlagsBits.ManageMessages]
            }
        ];
        const publicInteractiveOverwrites = [
            {
                id: everyoneId,
                allow: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.ReadMessageHistory, discord_js_1.PermissionFlagsBits.SendMessages, discord_js_1.PermissionFlagsBits.AddReactions, discord_js_1.PermissionFlagsBits.EmbedLinks, discord_js_1.PermissionFlagsBits.AttachFiles]
            },
            {
                id: leadershipRole.id,
                allow: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.ReadMessageHistory, discord_js_1.PermissionFlagsBits.SendMessages, discord_js_1.PermissionFlagsBits.AddReactions, discord_js_1.PermissionFlagsBits.EmbedLinks, discord_js_1.PermissionFlagsBits.AttachFiles, discord_js_1.PermissionFlagsBits.ManageMessages, discord_js_1.PermissionFlagsBits.ManageThreads, discord_js_1.PermissionFlagsBits.CreatePublicThreads, discord_js_1.PermissionFlagsBits.CreatePrivateThreads]
            },
            {
                id: supportRole.id,
                allow: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.ReadMessageHistory, discord_js_1.PermissionFlagsBits.SendMessages, discord_js_1.PermissionFlagsBits.AddReactions, discord_js_1.PermissionFlagsBits.EmbedLinks, discord_js_1.PermissionFlagsBits.AttachFiles, discord_js_1.PermissionFlagsBits.ManageMessages, discord_js_1.PermissionFlagsBits.ManageThreads, discord_js_1.PermissionFlagsBits.CreatePublicThreads, discord_js_1.PermissionFlagsBits.CreatePrivateThreads]
            }
        ];
        const staffPrivateOverwrites = [
            {
                id: everyoneId,
                deny: [discord_js_1.PermissionFlagsBits.ViewChannel]
            },
            {
                id: leadershipRole.id,
                allow: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.ReadMessageHistory, discord_js_1.PermissionFlagsBits.SendMessages, discord_js_1.PermissionFlagsBits.AddReactions, discord_js_1.PermissionFlagsBits.EmbedLinks, discord_js_1.PermissionFlagsBits.AttachFiles, discord_js_1.PermissionFlagsBits.ManageMessages, discord_js_1.PermissionFlagsBits.ManageThreads, discord_js_1.PermissionFlagsBits.CreatePublicThreads, discord_js_1.PermissionFlagsBits.CreatePrivateThreads, discord_js_1.PermissionFlagsBits.Connect, discord_js_1.PermissionFlagsBits.Speak, discord_js_1.PermissionFlagsBits.UseVAD]
            },
            {
                id: supportRole.id,
                allow: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.ReadMessageHistory, discord_js_1.PermissionFlagsBits.SendMessages, discord_js_1.PermissionFlagsBits.AddReactions, discord_js_1.PermissionFlagsBits.EmbedLinks, discord_js_1.PermissionFlagsBits.AttachFiles, discord_js_1.PermissionFlagsBits.ManageMessages, discord_js_1.PermissionFlagsBits.ManageThreads, discord_js_1.PermissionFlagsBits.CreatePublicThreads, discord_js_1.PermissionFlagsBits.CreatePrivateThreads, discord_js_1.PermissionFlagsBits.Connect, discord_js_1.PermissionFlagsBits.Speak, discord_js_1.PermissionFlagsBits.UseVAD]
            }
        ];
        const forumChannelType = typeof discord_js_1.ChannelType.GuildForum === 'number' ? discord_js_1.ChannelType.GuildForum : discord_js_1.ChannelType.GuildText;
        const supportLayout = [
            {
                name: 'START HERE',
                overwrites: publicReadOnlyOverwrites,
                channels: [
                    { name: 'welcome-and-rules', type: discord_js_1.ChannelType.GuildText, topic: 'Read this first. Rules, support scope, and behavior expectations for Cheesy Manager.' },
                    { name: 'add-the-bot', type: discord_js_1.ChannelType.GuildText, topic: 'Explains how server owners should request a bot invite and what details to provide.' },
                    { name: 'announcements', type: discord_js_1.ChannelType.GuildText, topic: 'Official Cheesy Manager updates, release notes, and maintenance notices.' },
                    { name: 'server-status', type: discord_js_1.ChannelType.GuildText, topic: 'Live service notices, known incidents, and recovery updates.' }
                ]
            },
            {
                name: 'SUPPORT DESK',
                overwrites: publicInteractiveOverwrites,
                channels: [
                    { name: 'open-a-ticket', type: discord_js_1.ChannelType.GuildText, topic: 'Use the forum channels below: bot access requests, bug reports, feature suggestions, or setup help.', overwrites: publicReadOnlyOverwrites },
                    { name: 'bot-access-requests', type: forumChannelType, acceptedTypes: forumChannelType === discord_js_1.ChannelType.GuildForum ? [discord_js_1.ChannelType.GuildForum, discord_js_1.ChannelType.GuildText] : [discord_js_1.ChannelType.GuildText], topic: 'One thread per server. Include server name, purpose, member count, and the features you need.' },
                    { name: 'bug-reports', type: forumChannelType, acceptedTypes: forumChannelType === discord_js_1.ChannelType.GuildForum ? [discord_js_1.ChannelType.GuildForum, discord_js_1.ChannelType.GuildText] : [discord_js_1.ChannelType.GuildText], topic: 'One bug per thread. Include steps to reproduce, screenshots, exact command, and expected vs actual behavior.' },
                    { name: 'feature-suggestions', type: forumChannelType, acceptedTypes: forumChannelType === discord_js_1.ChannelType.GuildForum ? [discord_js_1.ChannelType.GuildForum, discord_js_1.ChannelType.GuildText] : [discord_js_1.ChannelType.GuildText], topic: 'One idea per thread. Explain the real workflow problem, not just the requested surface feature.' },
                    { name: 'setup-help', type: forumChannelType, acceptedTypes: forumChannelType === discord_js_1.ChannelType.GuildForum ? [discord_js_1.ChannelType.GuildForum, discord_js_1.ChannelType.GuildText] : [discord_js_1.ChannelType.GuildText], topic: 'Use this for permission issues, setup confusion, migration help, or unclear command behavior.' }
                ]
            },
            {
                name: 'COMMUNITY',
                overwrites: publicInteractiveOverwrites,
                channels: [
                    { name: 'general-chat', type: discord_js_1.ChannelType.GuildText, topic: 'General community discussion around leagues, automation, and bot usage.' },
                    { name: 'showcase-your-server', type: discord_js_1.ChannelType.GuildText, topic: 'Share your server branding, formats, setup screenshots, and success stories.' },
                    { name: 'command-feedback', type: discord_js_1.ChannelType.GuildText, topic: 'Quick feedback on command naming, UX, confusing outputs, or rough edges.' }
                ]
            },
            {
                name: 'STAFF HQ',
                overwrites: staffPrivateOverwrites,
                channels: [
                    { name: 'staff-chat', type: discord_js_1.ChannelType.GuildText, topic: 'Internal staff coordination, handoffs, and daily operational chatter.' },
                    { name: 'request-triage', type: discord_js_1.ChannelType.GuildText, topic: 'Track open requests, assign ownership, and note follow-up actions.' },
                    { name: 'incident-notes', type: discord_js_1.ChannelType.GuildText, topic: 'Document outages, regressions, hotfixes, and lessons learned.' },
                    { name: 'transcripts-and-logs', type: discord_js_1.ChannelType.GuildText, topic: 'Private archive for ticket outcomes, copied logs, and staff-only notes.' },
                    { name: 'staff-voice', type: discord_js_1.ChannelType.GuildVoice }
                ]
            }
        ];
        const categoryStats = { created: 0, updated: 0 };
        const channelStats = { created: 0, updated: 0 };
        const keyChannels = [];
        for (const categorySpec of supportLayout) {
            const categoryResult = await ensureGuildCategory(guild, categorySpec.name, categorySpec.overwrites);
            if (categoryResult.created)
                categoryStats.created++;
            else if (categoryResult.updated)
                categoryStats.updated++;
            for (const channelSpec of categorySpec.channels) {
                const channelResult = await ensureManagedChannel(guild, channelSpec, categoryResult.channel.id, channelSpec.overwrites || categorySpec.overwrites);
                if (channelResult.created)
                    channelStats.created++;
                else if (channelResult.updated)
                    channelStats.updated++;
                if (['welcome-and-rules', 'bot-access-requests', 'bug-reports', 'feature-suggestions', 'staff-chat'].includes(channelSpec.name)) {
                    keyChannels.push(channelResult.channel.toString());
                }
            }
        }
        let leadershipAssigned = false;
        if (message.member && leadershipRole?.editable && !message.member.roles.cache.has(leadershipRole.id)) {
            leadershipAssigned = await message.member.roles.add(leadershipRole, SUPPORT_SERVER_SETUP_REASON)
                .then(() => true)
                .catch(() => false);
        }
        await (0, auditLog_1.appendAdminAuditLog)({
            guildId: guild.id,
            actorId: message.author.id,
            commandName: 'setupsupportserver',
            summary: `Bootstrapped support server layout | Roles C:${roleStats.created}/U:${roleStats.updated} | Categories C:${categoryStats.created}/U:${categoryStats.updated} | Channels C:${channelStats.created}/U:${channelStats.updated}`,
            targetSummary: guild.name,
            channelId: message.channel.id
        }).catch(() => null);
        const embed = new discord_js_1.EmbedBuilder()
            .setColor(0x10B981)
            .setTitle(`Support Server Setup: ${guild.name}`)
            .setDescription('Support-server bootstrap finished. The command is rerun-safe and will reuse matching roles/channels where possible.')
            .addFields({ name: 'Roles', value: `Created: **${roleStats.created}**\nUpdated: **${roleStats.updated}**`, inline: true }, { name: 'Categories', value: `Created: **${categoryStats.created}**\nUpdated: **${categoryStats.updated}**`, inline: true }, { name: 'Channels', value: `Created: **${channelStats.created}**\nUpdated: **${channelStats.updated}**`, inline: true }, { name: 'Staff Access', value: leadershipAssigned ? `Assigned ${leadershipRole} to ${message.author}.` : `${leadershipRole} already present or could not be auto-assigned.`, inline: false }, { name: 'Core Areas', value: keyChannels.join(' | ') || 'Layout created', inline: false }, { name: 'Forum Mode', value: forumChannelType === discord_js_1.ChannelType.GuildForum ? 'Request intake channels were created as forum channels.' : 'Forum channels are unavailable in this runtime, so intake areas were created as text channels.', inline: false })
            .setFooter({ text: 'Roles created: CM Leadership, Support Team, Verified Server Owner, Bug Hunter, Announcements' });
        await message.reply({ embeds: [embed] });
    }
    catch (error) {
        console.error('Support server setup failed:', error);
        await message.reply(`Support server setup failed: ${error.message}`);
    }
    return true;
}
async function handleGlobalAdminCommand(message, command, args) {
    if (!(0, utils_1.isGlobalAdmin)(message.author.id)) {
        return false;
    }
    const db = (0, database_1.getDB)();
    if (command === 'setglobalmanager' || command === 'sgm') {
        const target = message.mentions.users.first() || (args[0] ? await message.client.users.fetch(args[0]).catch(()=>null) : null);
        if (!target) return await message.reply("Usage: `?setglobalmanager @user`"), true;
        await db.run('INSERT OR IGNORE INTO global_managers (user_id) VALUES (?)', target.id);
        (0, utils_1.addGlobalManagerToCache)(target.id);
        await appendAutomaticCommandAudit(message, 'setglobalmanager', args, {
            summary: `Granted Global Manager access to ${target.username}.`,
            targetSummary: `${target.username} (${target.id})`
        });
        return await message.reply(`✅ **${target.username}** is now a Global Manager.`), true;
    }
    if (command === 'removeglobalmanager' || command === 'rgm') {
        const target = message.mentions.users.first() || (args[0] ? await message.client.users.fetch(args[0]).catch(()=>null) : null);
        if (!target) return await message.reply("Usage: `?removeglobalmanager @user`"), true;
        await db.run('DELETE FROM global_managers WHERE user_id = ?', target.id);
        (0, utils_1.removeGlobalManagerFromCache)(target.id);
        await appendAutomaticCommandAudit(message, 'removeglobalmanager', args, {
            summary: `Revoked Global Manager access from ${target.username}.`,
            targetSummary: `${target.username} (${target.id})`
        });
        return await message.reply(`✅ **${target.username}** is no longer a Global Manager.`), true;
    }
    if (command === 'globalmanagerservers' || command === 'gms') {
        const guilds = [...client.guilds.cache.values()].sort((a, b) => a.name.localeCompare(b.name));
        if (guilds.length === 0) return await message.reply("Bot is not in any servers."), true;

        const disabledServers = new Set((await db.all('SELECT guild_id FROM disabled_global_manager_servers')).map(r => r.guild_id));
        
        let page = 0;
        const totalPages = Math.ceil(guilds.length / 10);
        let selectedGuildId = guilds[0].id;
        
        const buildEmbed = () => {
            const start = page * 10;
            const end = start + 10;
            const guildList = guilds.slice(start, end).map((g, i) => {
                const index = start + i + 1;
                const statusIcon = disabledServers.has(g.id) ? "❌" : "✅";
                const isSelected = g.id === selectedGuildId ? "👉 " : "";
                return `${isSelected}${index}. ${statusIcon} **${g.name}** (\`${g.id}\`)`;
            }).join('\n');

            const selectedGuild = client.guilds.cache.get(selectedGuildId);
            const status = disabledServers.has(selectedGuildId) ? "❌ **DISABLED**" : "✅ **ENABLED**";
            
            const embed = new discord_js_1.EmbedBuilder()
                .setTitle("Global Manager Server Access")
                .setDescription(`Manage which servers Global Managers can exercise their powers in.\n\n${guildList}\n\n**Selected Server:** ${selectedGuild?.name || 'Unknown'} (${selectedGuildId})\n**Status:** ${status}`)
                .setColor(disabledServers.has(selectedGuildId) ? 0xFF0000 : 0x00FF00)
                .setFooter({ text: `Page ${page + 1} of ${totalPages} | Total Servers: ${guilds.length}` })
                .setTimestamp();
            return embed;
        };

        const buildComponents = () => {
            // Show up to 25 guilds in the select menu starting from the current page's first item
            const start = page * 10;
            const guildOptions = guilds.slice(start, start + 25).map(g => ({ 
                label: g.name.slice(0, 100), 
                value: g.id, 
                default: g.id === selectedGuildId,
                description: (disabledServers.has(g.id) ? "❌ Disabled" : "✅ Enabled") + ` | ID: ${g.id}`
            }));

            const selectRow = new discord_js_1.ActionRowBuilder().addComponents(
                new discord_js_1.StringSelectMenuBuilder()
                    .setCustomId('gms_select')
                    .setPlaceholder('Select a server to manage')
                    .addOptions(guildOptions)
            );

            const buttonRow = new discord_js_1.ActionRowBuilder().addComponents(
                new discord_js_1.ButtonBuilder()
                    .setCustomId('gms_prev')
                    .setLabel('Prev Page')
                    .setStyle(discord_js_1.ButtonStyle.Secondary)
                    .setDisabled(page === 0),
                new discord_js_1.ButtonBuilder()
                    .setCustomId('gms_next')
                    .setLabel('Next Page')
                    .setStyle(discord_js_1.ButtonStyle.Secondary)
                    .setDisabled(page >= totalPages - 1),
                new discord_js_1.ButtonBuilder()
                    .setCustomId('gms_enable')
                    .setLabel('Enable Managers')
                    .setStyle(discord_js_1.ButtonStyle.Success)
                    .setDisabled(!disabledServers.has(selectedGuildId)),
                new discord_js_1.ButtonBuilder()
                    .setCustomId('gms_disable')
                    .setLabel('Disable Managers')
                    .setStyle(discord_js_1.ButtonStyle.Danger)
                    .setDisabled(disabledServers.has(selectedGuildId))
            );
            return [selectRow, buttonRow];
        };

        const response = await message.reply({ embeds: [buildEmbed()], components: buildComponents() });
        const collector = response.createMessageComponentCollector({ filter: i => i.user.id === message.author.id, time: 300000 });

        collector.on('collect', async i => {
            if (i.customId === 'gms_select') {
                selectedGuildId = i.values[0];
            } else if (i.customId === 'gms_prev') {
                page = Math.max(0, page - 1);
            } else if (i.customId === 'gms_next') {
                page = Math.min(totalPages - 1, page + 1);
            } else if (i.customId === 'gms_enable') {
                await db.run('DELETE FROM disabled_global_manager_servers WHERE guild_id = ?', selectedGuildId);
                (0, utils_1.enableGlobalManagerForServer)(selectedGuildId);
                disabledServers.delete(selectedGuildId);
                const targetGuild = client.guilds.cache.get(selectedGuildId);
                await appendAutomaticCommandAudit(message, 'globalmanagerservers', [selectedGuildId, 'enable'], {
                    summary: `Enabled Global Manager powers for ${targetGuild?.name || selectedGuildId}.`,
                    targetSummary: `${targetGuild?.name || 'Unknown'} (${selectedGuildId})`
                });
            } else if (i.customId === 'gms_disable') {
                await db.run('INSERT OR IGNORE INTO disabled_global_manager_servers (guild_id) VALUES (?)', selectedGuildId);
                (0, utils_1.disableGlobalManagerForServer)(selectedGuildId);
                disabledServers.add(selectedGuildId);
                const targetGuild = client.guilds.cache.get(selectedGuildId);
                await appendAutomaticCommandAudit(message, 'globalmanagerservers', [selectedGuildId, 'disable'], {
                    summary: `Disabled Global Manager powers for ${targetGuild?.name || selectedGuildId}.`,
                    targetSummary: `${targetGuild?.name || 'Unknown'} (${selectedGuildId})`
                });
            }
            await i.update({ embeds: [buildEmbed()], components: buildComponents() }).catch(() => null);
        });

        collector.on('end', () => { response.edit({ components: [] }).catch(() => null); });
        return true;
    }
    // Legacy global audit-log picker kept disabled; per-server audit log setup now runs through commands.js.
    if (false && (command === 'setdestructivelogchannel' || command === 'sdlc' || command === 'setauditlogchannel' || command === 'salc')) {
        const categories = message.guild.channels.cache
            .filter(c => c.type === discord_js_1.ChannelType.GuildCategory)
            .sort((a, b) => a.position - b.position)
            .map(c => ({ label: c.name, value: c.id }));

        if (categories.length === 0) {
            // Fallback to direct channel selection if no categories
            const row = new discord_js_1.ActionRowBuilder().addComponents(
                new discord_js_1.ChannelSelectMenuBuilder()
                    .setCustomId('log_channel_select')
                    .setPlaceholder('Select a channel for GLOBAL admin audit logs')
                    .setChannelTypes([discord_js_1.ChannelType.GuildText])
            );
            const resp = await message.reply({ content: "No categories found. Select a channel directly:", components: [row] });
            try {
                const inter = await resp.awaitMessageComponent({ filter: i => i.user.id === message.author.id, time: 30000 });
                const cid = inter.values[0];
                await db.run('INSERT INTO global_log_settings (id, channel_id) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET channel_id = excluded.channel_id', cid);
                await appendAutomaticCommandAudit(message, 'setauditlogchannel', [cid], {
                    summary: `Updated the global admin audit log channel to <#${cid}>.`,
                    targetSummary: cid,
                    force: true
                });
                await inter.update({ content: `✅ Global admin audit logs will now be sent to <#${cid}>.`, components: [] });
            } catch (e) { await resp.edit({ content: "❌ Interaction timed out.", components: [] }).catch(() => null); }
            return true;
        }

        const catRow = new discord_js_1.ActionRowBuilder().addComponents(
            new discord_js_1.StringSelectMenuBuilder()
                .setCustomId('sdlc_cat_select')
                .setPlaceholder('Select a Category')
                .addOptions(categories.slice(0, 25))
        );

        const response = await message.reply({ content: "Step 1: Select a **Category**:", components: [catRow] });
        try {
            const catInter = await response.awaitMessageComponent({ filter: i => i.user.id === message.author.id, time: 30000 });
            const catId = catInter.values[0];
            const channels = message.guild.channels.cache
                .filter(c => c.parentId === catId && c.type === discord_js_1.ChannelType.GuildText)
                .sort((a, b) => a.position - b.position)
                .map(c => ({ label: c.name, value: c.id }));

            if (channels.length === 0) {
                return await catInter.update({ content: "❌ No text channels found in that category.", components: [] }), true;
            }

            const chanRow = new discord_js_1.ActionRowBuilder().addComponents(
                new discord_js_1.StringSelectMenuBuilder()
                    .setCustomId('sdlc_chan_select')
                    .setPlaceholder('Select a Text Channel')
                    .addOptions(channels.slice(0, 25))
            );

            await catInter.update({ content: `Step 2: Select a **Channel** from **${message.guild.channels.cache.get(catId)?.name}**:`, components: [chanRow] });
            const chanInter = await response.awaitMessageComponent({ filter: i => i.user.id === message.author.id, time: 30000 });
            const targetChannelId = chanInter.values[0];
            
            await db.run('INSERT INTO global_log_settings (id, channel_id) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET channel_id = excluded.channel_id', targetChannelId);
            await appendAutomaticCommandAudit(message, 'setauditlogchannel', [targetChannelId], {
                summary: `Updated the global admin audit log channel to <#${targetChannelId}>.`,
                targetSummary: targetChannelId,
                force: true
            });
            await chanInter.update({ content: `✅ Global admin audit logs will now be sent to <#${targetChannelId}>.`, components: [] });
        } catch (e) {
            await response.edit({ content: "❌ Interaction timed out or failed.", components: [] }).catch(() => null);
        }
        return true;
    }

    if (await (0, supportServerSystem_1.handleGlobalCommand)(message, command, args)) {
        return true;
    }
    if (command === 'backupnow') {
        const handled = await handleBackupNowCommand(message);
        await appendAutomaticCommandAudit(message, 'backupnow', args);
        return handled;
    }
    if (command === 'exportdata') {
        const handled = await handleExportDataCommand(message);
        await appendAutomaticCommandAudit(message, 'exportdata', args);
        return handled;
    }
    if (command === 'botstatus' || command === 'botservers' || command === 'bs') {
        return await handleBotStatusCommand(message);
    }
    if (command === 'cmdstats' || command === 'commandstats' || command === 'cusage') {
        return await handleCommandStatsCommand(message, args);
    }
    if (command === 'dbstorage' || command === 'dbsize' || command === 'dbsizes') {
        return await handleDatabaseStorageCommand(message, args);
    }
    if (command === 'savehcembeds' || command === 'savehc') {
        const handled = await handleSaveHcEmbedsCommand(message, args);
        await appendAutomaticCommandAudit(message, 'savehc', args);
        return handled;
    }
    if (command === 'savedhc' || command === 'listhc') {
        return await handleListSavedHcEmbedsCommand(message);
    }
    if (command === 'hcemojimap' || command === 'hcemojis' || command === 'hcmap') {
        return await handleHcEmojiMapCommand(message);
    }
    if (command === 'findhcemoji' || command === 'hcfindemoji' || command === 'fhe') {
        return await handleFindHcEmojiCommand(message, args);
    }
    if (command === 'analysehcbot' || command === 'analyzehcbot') {
        const handled = await handleAnalyseHcBotCommand(message, args);
        await appendAutomaticCommandAudit(message, 'analysehcbot', args);
        return handled;
    }
    if (command === 'endanalyse' || command === 'endanalyze') {
        const handled = await handleEndAnalyseHcBotCommand(message);
        await appendAutomaticCommandAudit(message, 'endanalyse', args);
        return handled;
    }
    return false;
}
client.once('clientReady', wrapAsyncEventHandler('clientReady', async () => {
    console.log(`Logged in as ${client.user?.tag}!`);
    await refreshDynamicBotPresence();
    
    const { auditEmitter } = require('./auditLog');
    auditEmitter.on('log', async (logData) => {
        try {
            const db = (0, database_1.getDB)();
            const logSetting = await db.get(`SELECT admin_audit_log_channel_id,
                COALESCE(admin_audit_logs_enabled, 1) AS admin_audit_logs_enabled
                FROM guild_settings
                WHERE guild_id = ?`, logData.guildId);
            if (logSetting?.admin_audit_log_channel_id && logSetting.admin_audit_logs_enabled !== 0) {
                const logChannel = await client.channels.fetch(logSetting.admin_audit_log_channel_id).catch(()=>null);
                if (logChannel && logChannel.isTextBased?.()) {
                    const sourceGuild = client.guilds.cache.get(logData.guildId);
                    const embed = new discord_js_1.EmbedBuilder()
                        .setTitle(`Admin Action: ${logData.commandName}`)
                        .setDescription(`**User:** <@${logData.actorId}>\n**Server:** ${sourceGuild?.name || logData.guildId}\n**Action:** ${logData.summary}`)
                        .setColor(0xFFA500)
                        .setTimestamp();
                    if (logData.targetSummary) embed.addFields({ name: 'Target', value: String(logData.targetSummary) });
                    await logChannel.send({ embeds: [embed] }).catch(()=>null);
                }
            }
        } catch (e) { console.error('Error sending guild admin audit log:', e); }
    });

    client.on('messageDelete', wrapAsyncEventHandler('messageDelete', async (message) => {
        try {
            if (!message.guild) return;

            if (!message.author?.bot) return;
            const db = (0, database_1.getDB)();
            const logSetting = await db.get(`SELECT admin_audit_log_channel_id,
                COALESCE(admin_audit_logs_enabled, 1) AS admin_audit_logs_enabled
                FROM guild_settings
                WHERE guild_id = ?`, message.guild.id);
            if (logSetting?.admin_audit_log_channel_id && logSetting.admin_audit_logs_enabled !== 0 && message.channel.id === logSetting.admin_audit_log_channel_id) {
                const fetchedLogs = await message.guild.fetchAuditLogs({ limit: 1, type: 72 /* MESSAGE_DELETE */ }).catch(()=>null);
                let deletedBy = "Unknown User";
                if (fetchedLogs) {
                    const deletionLog = fetchedLogs.entries.first();
                    if (deletionLog && deletionLog.target.id === message.author.id && Date.now() - deletionLog.createdTimestamp < 5000) {
                        deletedBy = `<@${deletionLog.executor.id}>`;
                    }
                }
                const logChannel = await client.channels.fetch(logSetting.admin_audit_log_channel_id).catch(()=>null);
                if (logChannel && logChannel.isTextBased?.()) {
                    await logChannel.send(`Warning: An admin audit log message was deleted by ${deletedBy}.`).catch(()=>null);
                }
            }
        } catch (e) { }
    }));

    ensureDirectory(BACKUP_ROOT_DIR);
    ensureDirectory(DAILY_BACKUP_DIR);
    ensureDirectory(MANUAL_BACKUP_DIR);
    ensureDirectory(EXPORT_BACKUP_DIR);
    ensureDailyBackup()
        .then(result => {
        if (result.created) {
            console.log(`Daily backup created: ${result.relativePath}`);
        }
    })
        .catch((err) => console.error('Initial daily backup failed:', err));
    (0, iplPredictionSystem_1.processAutoAnnouncements)(client).catch((err) => console.error('Initial IPL auto-announce failed:', err));
    finalizeCompletedHcAutoMatches().catch((err) => console.error('Initial HC auto finalization failed:', err));
    pruneOldHcAutoHistory().catch((err) => console.error('Initial HC auto prune failed:', err));
    
    // Check for scheduled messages every 60 seconds
    setInterval(() => {
        (0, commands_1.checkScheduledMessages)(client).catch((err) => console.error('Scheduled message loop failed:', err));
        matchSystem_1.matchSystem.checkScheduledMatches(client).catch((err) => console.error('Match scheduler loop failed:', err));
        (0, commands_1.checkPotdAutoPosts)(client).catch((err) => console.error('POTD auto-post loop failed:', err));
        (0, commands_1.checkPotdPolls)(client).catch((err) => console.error('POTD poll loop failed:', err));
        (0, iplPredictionSystem_1.processAutoAnnouncements)(client).catch((err) => console.error('IPL auto-announce loop failed:', err));
        finalizeCompletedHcAutoMatches().catch((err) => console.error('HC auto finalization loop failed:', err));
        pruneOldHcAutoHistory().catch((err) => console.error('HC auto prune failed:', err));
        checkAutoFixtureAnnouncements().catch((err) => console.error('Auto fixture announcement loop failed:', err));
        }, 60000);
    setInterval(() => {
        refreshDynamicBotPresence().catch((err) => console.error('Presence refresh loop failed:', err));
    }, 15 * 60 * 1000);
    setInterval(() => {
        ensureDailyBackup()
            .then(result => {
            if (result.created) {
                console.log(`Daily backup created: ${result.relativePath}`);
            }
        })
            .catch((err) => console.error('Daily backup loop failed:', err));
    }, DAILY_BACKUP_CHECK_INTERVAL_MS);
}));
client.on('messageCreate', wrapAsyncEventHandler('messageCreate', async (message) => {
    if (message.author.id === HC_CRICKET_BOT_ID) {
        try {
            await captureHcAnalysisMessage(message);
        }
        catch (err) {
            console.error('Failed to capture HC analysis message:', err);
        }
        try {
            await captureHcAutoMessageVersion(message, 'create');
        }
        catch (err) {
            console.error('Failed to auto-track HC message:', err);
        }
    }
    if (message.author.bot && message.author.id !== client.user?.id)
        return;
    const prefix = message.content.startsWith('?')
        ? '?'
        : (message.content.startsWith('/')
            ? '/'
            : (message.content.startsWith('+') ? '+' : null));
    if (!prefix) {
        // Check for time agreement in match channels
        const handled = await matchSystem_1.matchSystem.handlePotentialTimeAgreement(message);
        if (handled) return;
        return;
    }
    const guildId = message.guild?.id;
    if (!guildId)
        return; // Ignore DMs
    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();
    if (!command)
        return;

    const allowPlusLeaveteam = prefix === '+' && command === 'leaveteam';
    if (prefix !== '?' && !allowPlusLeaveteam)
        return;
    try {
        await recordCommandUsage(guildId, command);
    }
    catch (err) {
        console.error('Failed to record command usage:', err);
    }
    if (await handleGlobalAdminCommand(message, command, args)) {
        return;
    }
    if (command === 'bowlervsbatter' || command === 'bvb' || command === 'matchup') {
        await handleBowlerVsBatterCommand(message, args);
        return;
    }
    if (['auditlog', 'alog'].includes(command)) {
        if (!(0, utils_1.isAdmin)(message.member))
            return;
        await handleAuditLogCommand(message, args);
        return;
    }
    if (['healthcheck', 'diag'].includes(command)) {
        if (!(0, utils_1.isAdmin)(message.member))
            return;
        await handleHealthCheckCommand(message);
        return;
    }
    if (command === 'hcrecover' || command === 'hccatchup' || command === 'hcreplay') {
        const handled = await handleRecoverHcMatchCommand(message);
        await appendAutomaticCommandAudit(message, 'hcrecover', args);
        return;
    }
    if (await (0, supportServerSystem_1.handleCommand)(message, command, args)) {
        return;
    }

    // Route Commands
    // Point Table System
    if (['setpointtableseason', 'spts', 'setalias', 'setabb', 'sa', 'aliases', 'abbs', 'pt', 'pointtable', 'ptmatch', 'ptm', 'deletematch', 'delm', 'listmatches', 'lm', 'editptmatch', 'ptedit'].includes(command)) {
        let actualPtCommand = command;
        if (command === 'spts') actualPtCommand = 'setpointtableseason';
        if (command === 'sa' || command === 'setabb') actualPtCommand = 'setalias';
        if (command === 'ptm') actualPtCommand = 'ptmatch';
        if (command === 'delm') actualPtCommand = 'deletematch';
        if (command === 'ptedit') actualPtCommand = 'editptmatch';
        if (command === 'abbs') actualPtCommand = 'aliases';

        if (['ptmatch', 'deletematch', 'editptmatch', 'setpointtableseason', 'setalias'].includes(actualPtCommand)) {
            if (!(0, utils_1.isAdmin)(message.member)) return;
        }

        switch (actualPtCommand) {
            case 'setpointtableseason':
                await pointTable_1.handleSetSeason(message, args);
                break;
            case 'setalias':
                await pointTable_1.handleSetAlias(message, args);
                break;
            case 'aliases':
                await pointTable_1.handleShowAliases(message, args);
                break;
            case 'pt':
            case 'pointtable':
                await pointTable_1.handleShowPointTable(message, args);
                break;
            case 'ptmatch':
                await pointTable_1.handlePtMatch(message, args);
                break;
            case 'deletematch':
                await pointTable_1.handleDeleteMatch(message, args);
                break;
            case 'editptmatch':
                await pointTable_1.handleEditPtMatch(message, args);
                break;
            case 'listmatches':
            case 'lm':
                await (0, commands_1.handleAdminCommand)(message, 'listmatches', args);
                break;
        }
        return;
    }
    // Auction Control (Admin)
    if (['auction', 'start', 'pause', 'ps', 'resume', 're', 'sold', 'sd', 'pass', 'pa', 'undo', 'ud', 'auctionseason', 'aucs'].includes(command)) {
        if (!(0, utils_1.isAdmin)(message.member))
            return;
        try {
            let actualCommand = command;
            if (command === 'ps') actualCommand = 'pause';
            if (command === 're') actualCommand = 'resume';
            if (command === 'sd') actualCommand = 'sold';
            if (command === 'pa') actualCommand = 'pass';
            if (command === 'ud') actualCommand = 'undo';
            if (command === 'aucs') actualCommand = 'auctionseason';

            switch (actualCommand) {
                case 'auctionseason':
                    await (0, commands_1.handleAdminCommand)(message, 'auctionseason', args);
                    break;
                case 'auction':
                    if (args[0] === 'start') {
                        const setName = args[1];
                        if (!setName) {
                            message.reply("Usage: ?auction start [SetName]");
                            return;
                        }
                        await auctionManager_1.auctionManager.startAuction(guildId, setName, message.channel);
                    }
                    break;
                case 'start':
                    if (args[0] === 'auction') {
                        const setName = args[1];
                        if (!setName) {
                            message.reply("Usage: ?start auction [SetName]");
                            return;
                        }
                        await auctionManager_1.auctionManager.startAuction(guildId, setName, message.channel);
                    }
                    else if (args.length > 0) {
                        await auctionManager_1.auctionManager.startAuction(guildId, args[0], message.channel);
                    }
                    break;
                case 'pause':
                    await auctionManager_1.auctionManager.pause(guildId);
                    break;
                case 'resume':
                    await auctionManager_1.auctionManager.resume(guildId);
                    break;
                case 'sold':
                    await auctionManager_1.auctionManager.sold(guildId);
                    break;
                case 'pass':
                    await auctionManager_1.auctionManager.pass(guildId);
                    break;
                case 'undo':
                    if (args.length > 0 && args[0].startsWith('<@')) {
                        await (0, commands_1.handleManagementCommand)(message, 'unsell', args);
                    }
                    else {
                        if (await (0, utils_1.askConfirmation)(message, "Are you sure you want to **REVERT the last bid**?")) {
                            await auctionManager_1.auctionManager.undo(guildId);
                        }
                    }
                    break;
            }
        }
        catch (e) {
            message.reply(`Error: ${e.message}`);
        }
        return;
    }
    // IPL Predictions (Admin)
    if (['setiplpredictchannel', 'sipc', 'setiplannouncechannel', 'siac', 'setiplannouncepingroles', 'siapr', 'announceipl', 'aipl', 'iplwinner', 'ipw', 'iplwinner1', 'ipw1', 'iplwinner2', 'ipw2', 'editiplwinner', 'ipwedit', 'eipw', 'ipltop4result', 'it4r', 'ipltop4picks', 'it4p', 'iplfixtures', 'ifx', 'ipf', 'iplmatchreport', 'imr', 'ipr', 'ipldaypicks', 'idp', 'predictionstatspreview', 'psprev', 'psp', 'predictlbpreview', 'plbprev', 'plbp', 'predictionflowpreview', 'pfprev', 'pfp', 'postpredictguide', 'ppguide', 'predguide', 'predictiondmpanel', 'pdpanel'].includes(command)) {
        if (!(0, utils_1.isAdmin)(message.member))
            return;
        let finalCommand = command;
        if (command === 'sipc')
            finalCommand = 'setiplpredictchannel';
        if (command === 'siac')
            finalCommand = 'setiplannouncechannel';
        if (command === 'siapr')
            finalCommand = 'setiplannouncepingroles';
        if (command === 'aipl')
            finalCommand = 'announceipl';
        if (command === 'pdpanel')
            finalCommand = 'predictiondmpanel';
        if (command === 'ipw')
            finalCommand = 'iplwinner';
        if (command === 'ipwedit' || command === 'eipw')
            finalCommand = 'editiplwinner';
        if (command === 'ipw1')
            finalCommand = 'iplwinner1';
        if (command === 'ipw2')
            finalCommand = 'iplwinner2';
        if (command === 'it4r')
            finalCommand = 'ipltop4result';
        if (command === 'it4p')
            finalCommand = 'ipltop4picks';
        if (command === 'ifx' || command === 'ipf')
            finalCommand = 'iplfixtures';
        if (command === 'imr' || command === 'ipr')
            finalCommand = 'iplmatchreport';
        if (command === 'idp')
            finalCommand = 'ipldaypicks';
        if (command === 'psprev' || command === 'psp')
            finalCommand = 'predictionstatspreview';
        if (command === 'plbprev' || command === 'plbp')
            finalCommand = 'predictlbpreview';
        if (command === 'pfprev' || command === 'pfp')
            finalCommand = 'predictionflowpreview';
        if (command === 'ppguide' || command === 'predguide')
            finalCommand = 'postpredictguide';
        await (0, iplPredictionSystem_1.handleAdminCommand)(message, finalCommand, args);
        return;
    }
    // Admin Configuration
    if (['createset', 'cs', 'removeset', 'rmset', 'deleteset', 'ds', 'renameset', 'rs', 'reordersets', 'rset', 'moveset', 'mset', 'setincrement', 'si', 'setbase', 'sb', 'addplayer', 'ap', 'add', 'assignset', 'aset', 'addstats', 'as', 'createteam', 'ct', 'setpurse', 'sp', 'setpurseall', 'spa', 'setowner', 'so', 'setlimit', 'sl', 'setteamlimit', 'stl', 'setlimitall', 'sla', 'setupseason', 'ss', 'recalculateall', 'recalcall', 'recalculateoverall', 'recalcov', 'removematch', 'undostats', 'remmatch', 'removeplayerstat', 'rps', 'setmatchcap', 'smc', 'removematchcap', 'rmc', 'setreservelimit', 'srl', 'reservesleft', 'rleft', 'recheckstadiums', 'rcheck', 'setstadium', 'sstad', 'schedule', 'sch', 'adminreserve', 'ares', 'clearreserves', 'cr', 'removereserve', 'rr', 'setseasonschedule', 'sss', 'reservequeue', 'rq', 'resetmatchsystem', 'rms', 'resetseason', 'rsn', 'listadmins', 'la', 'removeadmin', 'rma', 'fixturesetup', 'fsetup', 'resetfixturesetup', 'rfsetup', 'fixturesettings', 'fs', 'fixtures', 'fixture', 'fix', 'renameseason', 'rns', 'regteam', 'rt', 'unregteam', 'urt', 'regteams', 'rts', 'setfixturechannel', 'sfc', 'fixturesetupchannel', 'appc', 'adminpingplacement', 'addpublicping', 'app', 'removepublicping', 'rpp', 'listpublicpings', 'lpp', 'setpubliccooldown', 'spc', 'setallpubliccooldown', 'sapc', 'addpublicpingwithchannel', 'appwc', 'tradeconfig', 'tc', 'auctionseason', 'auctiontime', 'atime', 'goingtime', 'gtime', 'setgroup', 'sg', 'groupstatus', 'gs', 'groupfixture', 'gf', 'mixgroups', 'mg', 'teamrenamelimit', 'trl', 'teamrenamewindow', 'trw', 'lockrenames', 'lrn', 'teamrenamedeadline', 'trd', 'setregteamchannel', 'srtc', 'setpotdwindow', 'spw', 'potdtimewindow', 'ptw', 'setpotdresultchannel', 'sprc', 'setpotdpingrole', 'sppr', 'potdpreview', 'pprev', 'potdvotepreview', 'pvp', 'potd', 'restartpotd', 'rpotd', 'potdmultivote', 'pmv', 'tots', 'endtots', 'stots', 'hchistory', 'hcedit', 'hcdelete'].includes(command)) {
        if (!(0, utils_1.isAdmin)(message.member))
            return;
        if (command === 'auctiontime' || command === 'atime') {
            await (0, commands_1.handleAdminCommand)(message, 'auctiontime', args);
            await appendAutomaticCommandAudit(message, 'auctiontime', args);
            return;
        }
        if (command === 'goingtime' || command === 'gtime') {
            await (0, commands_1.handleAdminCommand)(message, 'goingtime', args);
            await appendAutomaticCommandAudit(message, 'goingtime', args);
            return;
        }
        
        if (['fixturesetup', 'fsetup', 'resetfixturesetup', 'rfsetup', 'fixturesettings', 'fs', 'fixtures', 'fixture', 'fix', 'regteam', 'rt', 'unregteam', 'urt', 'regteams', 'rts', 'setfixturechannel', 'sfc', 'fixturesetupchannel', 'appc', 'adminpingplacement'].includes(command)) {
            let finalCommand = command;
            if (command === 'fsetup') finalCommand = 'fixturesetup';
            if (command === 'rfsetup') finalCommand = 'resetfixturesetup';
            if (command === 'fs') finalCommand = 'fixturesettings';
            if (command === 'fix') finalCommand = 'fixtures';
            if (command === 'rt') finalCommand = 'regteam';
            if (command === 'urt') finalCommand = 'unregteam';
            if (command === 'rts') finalCommand = 'regteams';
            if (command === 'sfc' || command === 'fixturesetupchannel') finalCommand = 'setfixturechannel';
            if (command === 'adminpingplacement') finalCommand = 'appc';
            await commands_1.handleFixtureCommand(message, finalCommand, args);
            await appendAutomaticCommandAudit(message, finalCommand, args);
            return;
        }
        if (command === 'reservequeue' || command === 'rq') {
            await matchSystem_1.matchSystem.showFixtureScheduleQueue(message, 'reserve');
            await appendAutomaticCommandAudit(message, 'reservequeue', args);
            return;
        }
        if (command === 'resetmatchsystem' || command === 'rms') {
            await matchSystem_1.matchSystem.resetMatchSystem(message);
            await appendAutomaticCommandAudit(message, 'resetmatchsystem', args);
            return;
        }
        if (command === 'resetseason' || command === 'rsn') {
            await matchSystem_1.matchSystem.resetSeason(message);
            await appendAutomaticCommandAudit(message, 'resetseason', args);
            return;
        }
        if (command === 'setmatchcap' || command === 'smc') {
            await matchSystem_1.matchSystem.setCaptain(message, args);
            await appendAutomaticCommandAudit(message, 'setmatchcap', args);
            return;
        }
        if (command === 'removematchcap' || command === 'rmc') {
            await matchSystem_1.matchSystem.removeCaptain(message);
            await appendAutomaticCommandAudit(message, 'removematchcap', args);
            return;
        }
        if (command === 'schedule' || command === 'sch') {
            await matchSystem_1.matchSystem.scheduleMatch(message, args);
            await appendAutomaticCommandAudit(message, 'schedule', args);
            return;
        }
        if (command === 'adminreserve' || command === 'ares') {
            await matchSystem_1.matchSystem.adminReserveMatch(message, args);
            await appendAutomaticCommandAudit(message, 'adminreserve', args);
            return;
        }
        if (command === 'clearreserves' || command === 'cr') {
            await matchSystem_1.matchSystem.clearAllReserves(message);
            await appendAutomaticCommandAudit(message, 'clearreserves', args);
            return;
        }
        if (command === 'removereserve' || command === 'rr') {
            await matchSystem_1.matchSystem.removeReserveAdmin(message);
            await appendAutomaticCommandAudit(message, 'removereserve', args);
            return;
        }
        if (command === 'setseasonschedule' || command === 'sss') {
            if (args.length < 1) return message.reply("Usage: `?setseasonschedule [SeasonName]`.");
            await matchSystem_1.matchSystem.setScheduleSeason(message, args.join(' '));
            await appendAutomaticCommandAudit(message, 'setseasonschedule', args);
            return;
        }
        if (command === 'setstadium' || command === 'sstad') {
            await matchSystem_1.matchSystem.setStadium(message, args);
            await appendAutomaticCommandAudit(message, 'setstadium', args);
            return;
        }
        if (command === 'setregteamchannel' || command === 'srtc') {
            let channel = message.mentions.channels.first();
            let selection = null;
            if (channel && channel.type !== discord_js_1.ChannelType.GuildText)
                channel = null;
            if (!channel) {
                selection = await (0, commands_1.promptForCategoryTextChannel)(message, {
                    categoryPrompt: 'Select the **Category** for the reg-team channel:',
                    channelPrompt: 'Select the **Reg-Team Channel**:',
                    noCategoriesText: 'No categories found in this server.',
                    noChannelsText: 'No text channels were found in that category.'
                });
                if (!selection)
                    return;
                channel = selection.channel;
            }
            const db = (0, database_1.getDB)();
            await db.run('INSERT INTO guild_settings (guild_id, regteam_command_channel_id) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET regteam_command_channel_id = excluded.regteam_command_channel_id', guildId, channel.id);
            if (selection?.interaction) {
                await appendAutomaticCommandAudit(message, 'setregteamchannel', [channel.id], {
                    summary: `Updated the reg-team command channel to ${channel}.`,
                    targetSummary: `${channel.name} (${channel.id})`,
                    force: true
                });
                await selection.interaction.editReply({
                    content: `✅ Reg-team command channel set to ${channel}.`,
                    components: []
                }).catch(() => null);
                return;
            }
            message.reply(`✅ Reg-team command channel set to ${channel}.`);
            await appendAutomaticCommandAudit(message, 'setregteamchannel', [channel.id], {
                summary: `Updated the reg-team command channel to ${channel}.`,
                targetSummary: `${channel.name} (${channel.id})`,
                force: true
            });
            return;
        }
        if (command === 'setreservelimit' || command === 'srl') {
            const limit = parseInt(args[0]);
            if (isNaN(limit)) return message.reply("Usage: ?setreservelimit <number>");
            await matchSystem_1.matchSystem.setReserveLimit(message, limit);
            await appendAutomaticCommandAudit(message, 'setreservelimit', args);
            return;
        }
        if (command === 'reservesleft' || command === 'rleft') {
            await matchSystem_1.matchSystem.showReservesLeft(message);
            await appendAutomaticCommandAudit(message, 'reservesleft', args);
            return;
        }
        if (command === 'recheckstadiums' || command === 'rcheck') {
            await matchSystem_1.matchSystem.recheckStadiumMessages(message);
            await appendAutomaticCommandAudit(message, 'recheckstadiums', args);
            return;
        }

        if (command === 'teamrenamelimit' || command === 'trl') {
            const limit = parseInt(args[0]);
            if (isNaN(limit) || limit < 0 || limit > 10)
                return message.reply("Usage: `?teamrenamelimit <0-10>`");
            const db = (0, database_1.getDB)();
            await db.run('INSERT INTO guild_settings (guild_id, team_name_change_limit) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET team_name_change_limit = excluded.team_name_change_limit', guildId, limit);
            message.reply(`✅ Team rename limit set to **${limit}** per team.`);
            await appendAutomaticCommandAudit(message, 'teamrenamelimit', args);
            return;
        }

        if (command === 'teamrenamewindow' || command === 'trw') {
            const toggle = (args[0] || '').toLowerCase();
            if (!['on', 'off', 'open', 'close', 'enable', 'disable', 'lock', 'unlock'].includes(toggle))
                return message.reply("Usage: `?teamrenamewindow on|off`");
            const db = (0, database_1.getDB)();
            const enabled = ['on', 'open', 'enable', 'unlock'].includes(toggle);
            await db.run(`INSERT INTO guild_settings (guild_id, team_rename_window_open, team_rename_window_expires_at)
                VALUES (?, ?, NULL)
                ON CONFLICT(guild_id) DO UPDATE SET
                    team_rename_window_open = excluded.team_rename_window_open,
                    team_rename_window_expires_at = NULL`, guildId, enabled ? 1 : 0);
            const notice = enabled
                ? "Admins have unlocked `?stadiumname` and `?teamrename`. No expiry is currently set."
                : "Admins have locked `?stadiumname` and `?teamrename` with immediate effect.";
            const dmResult = await notifyCaptainsAboutRenameWindow(message.guild, notice);
            message.reply(`${enabled ? "🔓 Team rename window unlocked." : "🔒 Team rename window locked."} Captains notified: **${dmResult.sent}**${dmResult.failed ? ` | Failed DMs: **${dmResult.failed}**` : ''}.`);
            await appendAutomaticCommandAudit(message, 'teamrenamewindow', args);
            return;
        }

        if (command === 'lockrenames' || command === 'lrn') {
            const db = (0, database_1.getDB)();
            await db.run(`INSERT INTO guild_settings (guild_id, team_rename_window_open, team_rename_window_expires_at)
                VALUES (?, 0, NULL)
                ON CONFLICT(guild_id) DO UPDATE SET
                    team_rename_window_open = 0,
                    team_rename_window_expires_at = NULL`, guildId);
            const dmResult = await notifyCaptainsAboutRenameWindow(message.guild, "Admins have locked `?stadiumname` and `?teamrename` with immediate effect.");
            message.reply(`🔒 Stadium/team rename commands locked. Captains notified: **${dmResult.sent}**${dmResult.failed ? ` | Failed DMs: **${dmResult.failed}**` : ''}.`);
            await appendAutomaticCommandAudit(message, 'lockrenames', args);
            return;
        }

        if (command === 'teamrenamedeadline' || command === 'trd') {
            const rawInput = args.join(' ').trim();
            if (!rawInput)
                return message.reply("Usage: `?teamrenamedeadline 12 dec 11:59pm`");
            const timeZone = await getGuildTimeZone(guildId);
            const expiresAt = parseTeamRenameDeadlineInput(rawInput, timeZone);
            if (!expiresAt)
                return message.reply("Usage: `?teamrenamedeadline 12 dec 11:59pm` or `?teamrenamedeadline 12 dec 23:59`");
            const db = (0, database_1.getDB)();
            await db.run(`INSERT INTO guild_settings (guild_id, team_rename_window_open, team_rename_window_expires_at)
                VALUES (?, 1, ?)
                ON CONFLICT(guild_id) DO UPDATE SET
                    team_rename_window_open = 1,
                    team_rename_window_expires_at = excluded.team_rename_window_expires_at`, guildId, expiresAt);
            const expiryLabel = await formatGuildDateTime(guildId, expiresAt);
            const dmResult = await notifyCaptainsAboutRenameWindow(message.guild, `Admins set a deadline for \`?stadiumname\` and \`?teamrename\`.\nExpiry: **${expiryLabel}**`);
            message.reply(`⏳ Rename deadline set to **${expiryLabel}**. Captains notified: **${dmResult.sent}**${dmResult.failed ? ` | Failed DMs: **${dmResult.failed}**` : ''}.`);
            await appendAutomaticCommandAudit(message, 'teamrenamedeadline', args);
            return;
        }

        // Alias mapping
        let finalCommand = command;
        if (command === 'cs')
            finalCommand = 'createset';
        if (command === 'rmset' || command === 'ds')
            finalCommand = 'deleteset';
        if (command === 'rs')
            finalCommand = 'renameset';
        if (command === 'mset')
            finalCommand = 'moveset';
        if (command === 'si')
            finalCommand = 'setincrement';
        if (command === 'sb')
            finalCommand = 'setbase';
        if (command === 'ap' || command === 'add')
            finalCommand = 'addplayer';
        if (command === 'aset')
            finalCommand = 'assignset';
        if (command === 'as')
            finalCommand = 'addstats';
        if (command === 'ct')
            finalCommand = 'createteam';
        if (command === 'sp')
            finalCommand = 'setpurse';
        if (command === 'spa')
            finalCommand = 'setpurseall';
        if (command === 'so')
            finalCommand = 'setowner';
        if (command === 'sl')
            finalCommand = 'setlimit';
        if (command === 'setteamlimit' || command === 'stl')
            finalCommand = 'setlimit';
        if (command === 'sla')
            finalCommand = 'setlimitall';
        if (command === 'ss')
            finalCommand = 'setupseason';
        if (command === 'rns')
            finalCommand = 'renameseason';
        if (command === 'recalcall')
            finalCommand = 'recalculateall';
        if (command === 'recalcov')
            finalCommand = 'recalculateoverall';
        if (command === 'undostats' || command === 'remmatch')
            finalCommand = 'removematch';
        if (command === 'rps')
            finalCommand = 'removeplayerstat';
        if (command === 'la')
            finalCommand = 'listadmins';
        if (command === 'rma')
            finalCommand = 'removeadmin';
        if (command === 'app') finalCommand = 'addpublicping';
        if (command === 'rpp') finalCommand = 'removepublicping';
        if (command === 'lpp') finalCommand = 'listpublicpings';
        if (command === 'spc') finalCommand = 'setpubliccooldown';
        if (command === 'sapc') finalCommand = 'setallpubliccooldown';
        if (command === 'tc') finalCommand = 'tradeconfig';
        if (command === 'sg') finalCommand = 'setgroup';
        if (command === 'gs') finalCommand = 'groupstatus';
        if (command === 'gf') finalCommand = 'groupfixture';
        if (command === 'mg') finalCommand = 'mixgroups';
        if (command === 'rset') finalCommand = 'reordersets';
        if (command === 'spw' || command === 'potdtimewindow' || command === 'ptw') finalCommand = 'setpotdwindow';
        if (command === 'sprc') finalCommand = 'setpotdresultchannel';
        if (command === 'sppr') finalCommand = 'setpotdpingrole';
        if (command === 'pprev') finalCommand = 'potdpreview';
        if (command === 'pvp') finalCommand = 'potdvotepreview';
        if (command === 'rpotd') finalCommand = 'restartpotd';
        if (command === 'pmv') finalCommand = 'potdmultivote';
        if (command === 'endtots' || command === 'stots') finalCommand = 'tots';
        
        if (finalCommand === 'tradeconfig') {
            await tradeSystem_1.tradeSystem.config(message, args);
            await appendAutomaticCommandAudit(message, finalCommand, args);
            return;
        }

        await (0, commands_1.handleAdminCommand)(message, finalCommand, args);
        await appendAutomaticCommandAudit(message, finalCommand, args);
        return;
    }
    if (['removeplayer', 'rp', 'resetauction', 'ra', 'makeadmin', 'ma', 'makesuperadmin', 'msa', 'removesuperadmin', 'rmsa', 'removeadmin', 'rma', 'unsell', 'uns', 'clearset', 'clearroster', 'cl', 'deleteteam', 'dt', 'unroster', 'ur', 'manualsell', 'ms', 'teamrole', 'tr', 'atr', 'assignteamrole', 'assignstadium', 'asd', 'forceteamrename', 'ftr', 'teamnamefromrole', 'tnr', 'addtoteam', 'att', 'assignplayer', 'addusertoteam', 'aut', 'removefromteam', 'rft', 'createteamrole', 'ctr', 'createteamchannel', 'ctc', 'settimezone', 'stz', 'setrolecaptain', 'src', 'removerolecaptain', 'rrc', 'ctcrole', 'createprivatechannel', 'cpc', 'assignrole', 'ar', 'removerole', 'rmrole', 'renamerole', 'rrl', 'copyrole', 'r2r', 'transferroles', 'trr', 'createallteamchannels', 'catc', 'createallteamroles', 'catr', 'createchannel', 'cc', 'setsaleschannel', 'ssc', 'setauditlogchannel', 'salc', 'setdestructivelogchannel', 'sdlc', 'auditlogtoggle', 'alt', 'setplayerlogchannel', 'splc', 'setteamlogchannel', 'stlc', 'playerlogtoggle', 'plt', 'teammanagetoggle', 'tmt', 'jointeamtoggle', 'jtt', 'setpinger', 'sping', 'removepinger', 'rping', 'listscheduled', 'lsdm', 'delscheduled', 'delsdm', 'tradeconfig', 'tc', 'listpingers', 'lp', 'setupauctionteams', 'sat', 'setfixturechannel', 'sfc', 'fixturesetupchannel', 'appc', 'adminpingplacement', 'announce', 'ann'].includes(command)) {
        // Alias
        let finalCommand = command;
        if (command === 'ann') finalCommand = 'announce';
        if (command === 'trr') finalCommand = 'transferroles';
        if (command === 'lp')
            finalCommand = 'listpingers';
        if (command === 'ma')
            finalCommand = 'makeadmin';
        if (command === 'msa')
            finalCommand = 'makesuperadmin';
        if (command === 'rmsa')
            finalCommand = 'removesuperadmin';
        if (command === 'rma')
            finalCommand = 'removeadmin';
        if (command === 'sat')
            finalCommand = 'setupauctionteams';
        if (command === 'asd')
            finalCommand = 'assignstadium';
        if (command === 'ftr')
            finalCommand = 'forceteamrename';
        if (command === 'tnr')
            finalCommand = 'teamnamefromrole';
        if (command === 'rrl')
            finalCommand = 'renamerole';
        if (command === 'rmrole')
            finalCommand = 'removerole';
        if (command === 'r2r')
            finalCommand = 'copyrole';
        if (command === 'createprivatechannel' || command === 'cpc')
            finalCommand = 'ctcrole';
        if (command === 'salc' || command === 'setdestructivelogchannel' || command === 'sdlc')
            finalCommand = 'setauditlogchannel';
        if (command === 'alt')
            finalCommand = 'auditlogtoggle';
        if (command === 'splc')
            finalCommand = 'setplayerlogchannel';
        if (command === 'stlc')
            finalCommand = 'setteamlogchannel';
        if (command === 'plt')
            finalCommand = 'playerlogtoggle';
        if (command === 'sfc' || command === 'fixturesetupchannel')
            finalCommand = 'setfixturechannel';
        if (command === 'adminpingplacement')
            finalCommand = 'appc';

        if (finalCommand === 'announce') {
            await matchSystem_1.matchSystem.announceTime(message, args);
            await appendAutomaticCommandAudit(message, finalCommand, args);
            return;
        }

        if (finalCommand === 'tradeconfig') {
            await tradeSystem_1.tradeSystem.config(message, args);
            await appendAutomaticCommandAudit(message, finalCommand, args);
            return;
        }

        await (0, commands_1.handleManagementCommand)(message, finalCommand, args);
        await appendAutomaticCommandAudit(message, finalCommand, args);
        return;
    }
    // IPL Predictions (Users)
    if (['predict', 'pred', 'predict1', 'pred1', 'predict2', 'pred2', 'predictlb', 'plb', 'iplmatch', 'ipm', 'predicttop4', 'pt4', 'predictionstats', 'pstats', 'mypredictions', 'mypred', 'mpred'].includes(command)) {
        let finalUserCommand = command;
        if (command === 'pred')
            finalUserCommand = 'predict';
        if (command === 'pred1')
            finalUserCommand = 'predict1';
        if (command === 'pred2')
            finalUserCommand = 'predict2';
        if (command === 'plb')
            finalUserCommand = 'predictlb';
        if (command === 'ipm')
            finalUserCommand = 'iplmatch';
        if (command === 'pt4')
            finalUserCommand = 'predicttop4';
        if (command === 'pstats')
            finalUserCommand = 'predictionstats';
        if (command === 'mypred' || command === 'mpred')
            finalUserCommand = 'mypredictions';
        const handled = await (0, iplPredictionSystem_1.handleUserCommand)(message, finalUserCommand, args);
        if (handled)
            return;
    }
    // User Commands
    if (['wallet', 'checkset', 'cset', 'roster', 'teams', 'sets', 'players', 'leaderboard', 'tlb', 'allrosters', 'renameteam', 'summary', 'wait', 'wt', 'rosterwithping', 'rwp', 'teammsg', 'tm', 'jointeam', 'jt', 'requestteam', 'joinrequests', 'jr', 'myteamdetail', 'mtd', 'teamdetail', 'opponentteamdetail', 'otd', 'checktime', 'time', 'dmrole', 'scheduledm', 'sdm', 'stats', 'st', 'overallstats', 'lb', 'statlb', 'reserve', 'res', 'freewin', 'fw', 'agree', 'ag', 'os', 'allr', 'rnt', 'sum', 'rq', 'publicping', 'pping', 'pp', 'listregteams', 'lrt', 'trade', 'td', 'listpublicpings', 'lpp', 'seasons', 'szn', 'leaveteam', 'lt', 'stadiumname', 'renamestadium', 'teamrename', 'trn', 'myteamrename', 'teamkick', 'tk', 'kickinactive', 'teamadd', 'ta', 'transfercaptain', 'tcap', 'changecaptain', 'setcaptain', 'setvicecaptain', 'svc', 'removevicecaptain', 'rvc'].includes(command)) {
        let finalUserCommand = command;
        if (command === 'cset') finalUserCommand = 'checkset';
        if (command === 'tlb') finalUserCommand = 'leaderboard';
        if (command === 'pping' || command === 'pp') finalUserCommand = 'publicping';
        if (command === 'lpp') finalUserCommand = 'listpublicpings';
        if (command === 'os') finalUserCommand = 'overallstats';
        if (command === 'allr') finalUserCommand = 'allrosters';
        if (command === 'rnt') finalUserCommand = 'renameteam';
        if (command === 'szn') finalUserCommand = 'seasons';
        if (command === 'sum') finalUserCommand = 'summary';
        if (command === 'res' || command === 'reserved') finalUserCommand = 'reserve';
        if (command === 'fw') finalUserCommand = 'freewin';
        if (command === 'rq') finalUserCommand = 'reservequeue';
        if (command === 'ag') finalUserCommand = 'agree';
        if (command === 'statlb') finalUserCommand = 'lb';
        if (command === 'st') finalUserCommand = 'stats';
        if (command === 'td') finalUserCommand = 'trade';
        if (command === 'lrt') finalUserCommand = 'listregteams';
        if (command === 'lt') finalUserCommand = 'leaveteam';
        if (command === 'wt') finalUserCommand = 'wait';
        if (command === 'jt' || command === 'requestteam') finalUserCommand = 'jointeam';
        if (command === 'jr') finalUserCommand = 'joinrequests';
        if (command === 'mtd' || command === 'teamdetail') finalUserCommand = 'myteamdetail';
        if (command === 'otd') finalUserCommand = 'opponentteamdetail';
        if (command === 'renamestadium') finalUserCommand = 'stadiumname';
        if (command === 'trn') finalUserCommand = 'teamrename';
        if (command === 'myteamrename') finalUserCommand = 'teamrename';
        if (command === 'tk') finalUserCommand = 'teamkick';
        if (command === 'kickinactive') finalUserCommand = 'teamkick';
        if (command === 'ta') finalUserCommand = 'teamadd';
        if (command === 'tcap') finalUserCommand = 'transfercaptain';
        if (command === 'svc') finalUserCommand = 'setvicecaptain';
        if (command === 'rvc') finalUserCommand = 'removevicecaptain';

        if (finalUserCommand === 'wait') {
            await auctionManager_1.auctionManager.wait(guildId);
            return;
        }
        if (finalUserCommand === 'trade') {
            await tradeSystem_1.tradeSystem.proposeTrade(message, args);
            return;
        }
        if (finalUserCommand === 'reserve') {
            await matchSystem_1.matchSystem.reserveMatch(message, args);
            return;
        }
        if (finalUserCommand === 'freewin') {
            await matchSystem_1.matchSystem.freeWinMatchCommand(message, args);
            return;
        }
        if (finalUserCommand === 'listregteams') {
            await matchSystem_1.matchSystem.listRegTeams(message);
            return;
        }
        if (finalUserCommand === 'agree') {
            await matchSystem_1.matchSystem.agreeTime(message, args.join(' '));
            return;
        }
        if (finalUserCommand === 'reservequeue') {
            await matchSystem_1.matchSystem.showFixtureScheduleQueue(message, 'reserve');
            return;
        }
        await (0, commands_1.handleUserCommand)(message, finalUserCommand, args);
        return;
    }
    // Check for Dynamic Role Pings
    if (await (0, commands_1.handleDynamicPings)(message, command)) {
        return;
    }
    if (command === 'embedtotext' || command === 'emb2txt' || command === 'etxt') {
        await handleEmbedToTextCommand(message, args);
        return;
    }
    if (command === 'ping') {
        const start = Date.now();
        const sent = await message.reply('Pinging...');
        const dbStart = Date.now();
        let dbPing = 'N/A';
        try {
            await (0, database_1.getDB)().get('SELECT 1');
            dbPing = `${Date.now() - dbStart}ms`;
        } catch (e) {
            console.error('DB Ping failed:', e);
            dbPing = 'Error';
        }
        sent.edit(`🏓 Pong! Latency: ${sent.createdTimestamp - message.createdTimestamp}ms. API Latency: ${Math.round(client.ws.ping)}ms. DB Latency: ${dbPing}.`);
        return;
    }
    if (command === 'qualify') {
        await pointTable_1.handleQualifyInfo(message);
        return;
    }
    if (command === 'helppredict' || command === 'hpred') {
        const userIsAdmin = (0, utils_1.isAdmin)(message.member);
        const userEmbed = new discord_js_1.EmbedBuilder()
            .setColor(0x2563eb)
            .setTitle('IPL Prediction Help')
            .setDescription('User commands for IPL match predictions, Top 4 picks, stats, and leaderboard.')
            .addFields({ name: '`?predict` / `?pred`', value: 'Predict the active match on a single-match day.' }, { name: '`?predict1` / `?pred1`', value: 'Predict match 1 on a doubleheader day.' }, { name: '`?predict2` / `?pred2`', value: 'Predict match 2 on a doubleheader day.' }, { name: '`?predicttop4 SRH RCB CSK MI` / `?pt4 ...`', value: 'Submit your season Top 4 before the Top 4 deadline.' }, { name: '`?mypredictions` / `?mypred` / `?mpred`', value: 'See your saved match picks, Top 4 pick, and whether settled results were right or wrong.' }, { name: '`?predictlb` / `?plb`', value: 'View the combined IPL prediction leaderboard.' }, { name: '`?predictionstats` / `?pstats`', value: 'View your IPL points, correct/wrong match picks, Top 4 hits, and saved Top 4 entry.' }, { name: '`?iplmatch` / `?ipm`', value: 'See the currently active match batch, deadlines, and which predict command to use.' })
            .setFooter({ text: userIsAdmin ? 'Admin prediction tools are in the next embed.' : 'Use predict commands in the configured IPL prediction channel.' });
        if (!userIsAdmin) {
            await message.reply({ embeds: [userEmbed] });
            return;
        }
        const adminEmbed = new discord_js_1.EmbedBuilder()
            .setColor(0xf59e0b)
            .setTitle('IPL Prediction Help: Admin')
            .setDescription('Admin setup, settlement, inspection, and preview commands.')
            .addFields({ name: '`?setiplpredictchannel [#channel]` / `?sipc`', value: 'Set the dedicated IPL prediction channel. If no channel is mentioned, the bot first asks for a category, then a text channel from that category.' }, { name: '`?predictiondmpanel [#channel]` / `?pdpanel`', value: 'Post the IPL reminder panel. Users react with 🔔 to get the reminder role and receive DMs when a new prediction batch is announced.' }, { name: '`?announceipl next` / `?aipl next`', value: 'Announce the next IPL date from `iplmatches.md`. If that date has two matches, both are announced with their own deadlines, commands, and the prediction channel to use. Opted-in reminder users are DMed automatically.' }, { name: '`?announceipl <fixture no>` / `?aipl <fixture no>`', value: 'Announce a specific fixture date batch starting from that fixture number.' }, { name: '`?postpredictguide [#channel]` / `?ppguide` / `?predguide`', value: 'Post a public IPL prediction explainer with how to predict, scoring, and useful commands.' }, { name: '`?iplwinner TEAM` / `?ipw TEAM`', value: 'Settle the active match on a single-match day.' }, { name: '`?iplwinner1 TEAM` / `?ipw1 TEAM`', value: 'Settle match 1 on a doubleheader day.' }, { name: '`?iplwinner2 TEAM` / `?ipw2 TEAM`', value: 'Settle match 2 on a doubleheader day.' }, { name: '`?ipltop4result SRH RCB CSK MI` / `?it4r ...`', value: 'Set the final Top 4. 3 matched teams give 15 points, all 4 give 25, and 0-2 give 0.' }, { name: '`?ipltop4picks` / `?it4p`', value: 'Show submitted Top 4 predictions only. Names are sorted alphabetically and paginated 10 per page.' }, { name: '`?iplfixtures` / `?ifx` / `?ipf`', value: 'List all IPL fixture numbers from `iplmatches.md`.' }, { name: '`?iplmatchreport <no>` / `?imr <no>` / `?ipr <no>`', value: 'Inspect one fixture: status, winner, entry count, and which users picked each team.' }, { name: '`?ipldaypicks [fixture no]` / `?idp [fixture no]`', value: 'Show match picks only for the active IPL prediction day, or for a specific fixture date batch. Names are sorted alphabetically and paginated 10 per page.' }, { name: '`?predictionstatspreview` / `?psprev` / `?psp`', value: 'Preview the stats embed with dummy data and avatar.' }, { name: '`?predictlbpreview` / `?plbprev` / `?plbp`', value: 'Preview the leaderboard embed with dummy data.' })
            .spliceFields(0, 100, { name: '`?setiplpredictchannel [#channel]` / `?sipc`', value: 'Set the dedicated IPL prediction channel. If no channel is mentioned, the bot first asks for a category, then a text channel from that category.' }, { name: '`?setiplannouncechannel [#channel]` / `?siac`', value: 'Set the separate IPL announcement channel used for public match alerts, deadlines, and where-to-predict notices.' }, { name: '`?setiplannouncepingroles @Role1 @Role2 ...` / `?siapr`', value: 'Set one or more roles to ping on the next line of each IPL announcement. Run it with no role mentions to clear all announcement ping roles.' }, { name: '`?predictiondmpanel [#channel]` / `?pdpanel`', value: 'Post the IPL reminder panel. Users react with 🔔 to get the reminder role and receive DMs when a new prediction batch is announced.' }, { name: '`?announceipl next` / `?aipl next`', value: 'Announce the next IPL date from `iplmatches.md` manually. Auto-announcements now also run every minute after the previous deadline passes.' }, { name: '`?announceipl <fixture no>` / `?aipl <fixture no>`', value: 'Announce a specific fixture date batch starting from that fixture number.' }, { name: '`?predictionflowpreview [double]` / `?pfprev [double]` / `?pfp [double]`', value: 'Preview the public announcement message, the prediction prompt(s), and the reminder DM. Use `double` to force a double-header preview with both `?predict1` and `?predict2`.' }, { name: '`?postpredictguide [#channel]` / `?ppguide` / `?predguide`', value: 'Post a public IPL prediction explainer with how to predict, scoring, and useful commands.' }, { name: '`?iplwinner` / `?ipw`', value: 'Open a dropdown picker for overdue unsettled matches, choose the winner or match cancelled, then confirm the result.' }, { name: '`?editiplwinner` / `?ipwedit` / `?eipw`', value: 'Open the same picker for already settled matches so admins can correct a result and confirm the edit.' }, { name: '`?iplwinner1 TEAM` / `?ipw1 TEAM`', value: 'Fast-settle match 1 on a doubleheader day with a typed result after the deadline passes.' }, { name: '`?iplwinner2 TEAM` / `?ipw2 TEAM`', value: 'Fast-settle match 2 on a doubleheader day with a typed result after the deadline passes.' }, { name: '`?ipltop4result SRH RCB CSK MI` / `?it4r ...`', value: 'Set the final Top 4. 3 matched teams give 15 points, all 4 give 25, and 0-2 give 0.' }, { name: '`?ipltop4picks` / `?it4p`', value: 'Show submitted Top 4 predictions only. Names are sorted alphabetically and paginated 10 per page.' }, { name: '`?iplfixtures` / `?ifx` / `?ipf`', value: 'List all IPL fixture numbers from `iplmatches.md`.' }, { name: '`?iplmatchreport <no>` / `?imr <no>` / `?ipr <no>`', value: 'Inspect one fixture: status, winner, entry count, and which users picked each team.' }, { name: '`?ipldaypicks [fixture no]` / `?idp [fixture no]`', value: 'Show match picks only for the active IPL prediction day, or for a specific fixture date batch. Names are sorted alphabetically and paginated 10 per page.' }, { name: '`?predictionstatspreview` / `?psprev` / `?psp`', value: 'Preview the stats embed with dummy data and avatar.' }, { name: '`?predictlbpreview` / `?plbprev` / `?plbp`', value: 'Preview the leaderboard embed with dummy data.' })
            .setFooter({ text: 'Scoring: match correct +2, wrong -1, Top 4 3/4 = 15, 4/4 = 25.' });
        await message.reply({ embeds: [userEmbed, adminEmbed] });
        return;
    }
    if (command === 'help') {
        const userIsAdmin = (0, utils_1.isAdmin)(message.member);
        
        const allPages = [
            {
                id: 'home',
                emoji: '🏠',
                title: 'Home & Basics',
                description: 'Core bot commands and navigation.',
                fields: [
                    { name: '`?help`', value: 'Shows this help menu.\n**Usage:** `?help`' },
                    { name: '`?helppredict`', value: 'Shows the dedicated IPL prediction help page with user and admin commands.\n**Alias:** `?hpred`' },
                    { name: '`?ping`', value: 'Checks bot and API latency.\n**Usage:** `?ping`' },
                    { name: '`?qualify`', value: 'Show the qualification and playoff rules for the current season.\n**Usage:** `?qualify`' },
                    { name: '`?time` / `?checktime`', value: 'Shows current server time using the configured server timezone.\n**Usage:** `?time`' },
                    { name: '`?pp` / `?publicping` / `?pping`', value: 'Ping a registered role (with global cooldown).\n**Usage:** `?pp @Role` or `?pp [alias]`' },
                    { name: '`?listpublicpings`', value: 'List the public roles users are allowed to ping.\n**Aliases:** `?lpp`' },
                    { name: '`?abbs [Group]` / `?aliases [Group]`', value: 'Show team abbreviations. In grouped formats, `?abbs` opens group pages and `?abbs A` shows only Group A.' }
                ]
            },
            {
                id: 'user_stats',
                emoji: '🏏',
                title: 'Player Stats & Leaderboards',
                description: 'View player performance, ratings, and global rankings.',
                fields: [
                    { name: '`?stats [@User] [Season]`', value: 'View player stats for current or a specific season.\n**Aliases:** `?st`' },
                    { name: '`?lb [Season]`', value: 'View top performers for current or a specific season.\n**Aliases:** `?statlb`' },
                    { name: '`?overallstats [@User]`', value: 'View all-time career summary for a player.\n**Aliases:** `?os`' },
                    { name: '`?seasons`', value: 'List all recorded seasons and see which is active.\n**Alias:** `?szn`' }
                ]
            },
            {
                id: 'support_server',
                emoji: '🛠️',
                title: 'Support Server',
                description: 'Tickets, feature suggestions, and bug tracking for the managed support server.',
                fields: [
                    { name: '`?warn` / `?timeout` / `?mute` / `?unmute` / `?kick` / `?ban` / `?purge`', value: 'Hardcoded Global Admin moderation tools for the managed support server. These can now be enabled or disabled per guild. Actions are logged to `#mod-logs` when configured.' },
                    { name: '`?ticket claim|unclaim|close|reopen|transcript|rename|add|remove|priority|move`', value: 'Manage a tracked support ticket from inside the ticket channel.' },
                    { name: '`?request approve|deny|moreinfo|note|status`', value: 'Manage Add Bot Request tickets from inside the ticket channel.' },
                    { name: '`?suggest <text>`', value: 'Create a tracked feature suggestion in the configured suggestions channel.' },
                    { name: '`?suggestion pending|planned|progress|added|deny <id> [reason]`', value: 'Support staff update suggestion status.' },
                    { name: '`?roadmap`', value: 'Show planned, in-progress, and shipped suggestions.' },
                    { name: '`?bug <title> | <details>`', value: 'Create a tracked bug report in the configured bug channel.' },
                    { name: '`?bugstatus` / `?bugseverity` / `?buglist` / `?bugnote`', value: 'Support staff manage tracked bugs, severity, and notes.' }
                ]
            },
            {
                id: 'user_auction',
                emoji: '💰',
                title: 'Auction & Roster Info',
                description: 'Check available players, team budgets, and rosters.',
                fields: [
                    { name: '`?teams`', value: 'List all teams, their owners, and current budgets.' },
                    { name: '`?leaderboard`', value: 'View the team purse leaderboard.\n**Alias:** `?tlb`' },
                    { name: '`?sets`', value: 'View all player sets and their base prices.' },
                    { name: '`?players`', value: 'List all players in a specific set.\n**Usage:** `?players [SetName]`' },
                    { name: '`?checkset`', value: 'Check which set a player is in.\n**Usage:** `?checkset [@User/Username]`\n**Alias:** `?cset`' },
                    { name: '`?roster`', value: 'View a specific team\'s full roster.\n**Usage:** `?roster [@Owner/TeamName]`' },
                    { name: '`?allrosters`', value: 'View every team\'s roster at once.\n**Aliases:** `?allr`' },
                    { name: '`?wallet`', value: 'Quickly check your own team\'s budget and roster size.' },
                    { name: '`?renameteam`', value: 'Owners rename their team name.\n**Usage:** `?renameteam New Team Name`\n**Alias:** `?rnt`' },
                    { name: '`?summary`', value: 'View summary of the auction progress.\n**Aliases:** `?sum`' },
                    { name: '`?trade`', value: 'Propose a 1-for-1 player swap.\n**Usage:** `?trade @MyPlayer @TheirPlayer`\n**Aliases:** `?td`' }
                ]
            },
            {
                id: 'user_bidding',
                emoji: '🔨',
                title: 'Bidding & Auction Participation',
                description: 'Commands for participating in a live auction.',
                fields: [
                    { name: '`?bid`', value: 'Place a bid.\n**Usage:** `?bid [Amount]`\n**Aliases:** `?b`' },
                    { name: '`?bid +`', value: 'Bid current price + minimum increment.' },
                    { name: '`?wait`', value: 'Request a 30s pause during your turn (Team Owners only).\n**Aliases:** `?wt`' }
                ]
            },
            {
                id: 'user_scheduling',
                emoji: '📅',
                title: 'Match Scheduling (Reservations)',
                description: 'System for teams to agree on match times.',
                fields: [
                    { name: '`?reserve`', value: 'Send a match request to another team. If an admin runs this inside an active fixture stadium, the bot shows `Team 1`, `Team 2`, and `Admin Team` buttons. `Admin Team` does not reduce either team\'s reserve limit.\n**Usage:** `?reserve @OpponentCaptain`\n**Aliases:** `?res`' },
                    { name: '`?reservequeue`', value: 'View all pending match requests.\n**Aliases:** `?rq`' },
                    { name: '`?agree`', value: 'Used to confirm a match time.\n**Usage:** `?agree [Time]`\n**Example:** `?agree 8 30 PM`\n**Aliases:** `?ag`' },
                    { name: '`?freewin`', value: 'Captains or vice-captains can concede a match in their stadium channel. Admins can also run it there and pick which team is conceding. PT is updated automatically.\n**Alias:** `?fw`' },
                    { name: '`?listregteams`', value: 'View all registered non-auction teams.\n**Aliases:** `?lrt`' },
                    { name: '`?announce`', value: 'Admins can post or reschedule the announced match time even after it has already been confirmed or scheduled.\n**Usage:** `?announce [Time]`\n**Example:** `?announce 9:30 PM`\n**Aliases:** `?ann`' },
                    { name: '`?stadiumname`', value: 'Captains/owners rename their stadium text channel.\n**Usage:** `?stadiumname <channel-name>`' }
                ]
            },
            {
                id: 'user_pt',
                emoji: '📊',
                title: 'Point Table & Results',
                description: 'Track league standings and match outcomes.',
                fields: [
                    { name: '`?pt`', value: 'Generates the league standings image.\n**Aliases:** `?pointtable`' },
                    { name: '`?listmatches`', value: 'Shows all recorded match results.\n**Aliases:** `?lm`' }
                ]
            },
            {
                id: 'user_comm',
                emoji: '💬',
                title: 'Communication',
                description: 'Commands to message teams and roles.',
                fields: [
                    { name: '`?teammsg`', value: 'DM everyone on a specific roster.\n**Usage:** `?teammsg @TeamRole [Message]`\n**Aliases:** `?tm`' },
                    { name: '`?rosterwithping`', value: 'Show a roster but ping everyone on it.\n**Aliases:** `?rwp`' },
                    { name: '`?jointeam`', value: 'Request to join a non-auction team; the captain gets a DM embed with approve/reject buttons. Admins can toggle this flow with `?jointeamtoggle`.\n**Aliases:** `?jt`' },
                    { name: '`?joinrequests`', value: 'Captains/Admins manage pending join requests via interactive dropdowns or typed actions.\n**Aliases:** `?jr`' },
                    { name: '`?myteamdetail` / `?teamdetail`', value: 'Show your team abbreviation, captain, stadium, roster size, role, etc. Works for teammates too.\n**Alias:** `?mtd`' },
                    { name: '`?opponentteamdetail`', value: 'Pick an opponent team from dropdowns and view its details.\nIn grouped formats it asks for the group first.\n**Alias:** `?otd`' },
                    { name: '`?teamrename`', value: 'Captains/owners rename their team + abbreviation.\n**Usage:** `?teamrename New Name | ABBV`\n**Aliases:** `?trn`, `?myteamrename`' },
                    { name: '`?teamadd`', value: 'Captains add a player directly to their non-auction team.\n**Usage:** `?teamadd @Member`\n**Alias:** `?ta`' },
                    { name: '`?teamkick`', value: 'Captains remove a player from their non-auction roster.\n**Usage:** `?teamkick @Member [reason]`\n**Aliases:** `?tk`, `?kickinactive`' },
                    { name: '`?transfercaptain`', value: 'Current captains and auction owners can transfer their own team captainship without mentioning the team.\n**Usage:** `?transfercaptain @NewCaptain`\n**Optional Admin Target:** `?transfercaptain @NewCaptain [Team]`\n**Admin:** `?changecaptain` opens dropdowns for team and captain.\n**Aliases:** `?tcap`, `?setcaptain`' },
                    { name: '`?setvicecaptain`', value: 'Set a vice-captain for your team.\n**Usage:** `?setvicecaptain @Member [Optional: Team]`\n**Admin:** if no team is provided, the bot opens a dropdown and shows the group picker first in grouped seasons.\n**Alias:** `?svc`' },
                    { name: '`?removevicecaptain`', value: 'Remove the current vice-captain from your team.\n**Usage:** `?removevicecaptain [Optional: Team]`\n**Admin:** if no team is provided, the bot opens a dropdown and shows the group picker first in grouped seasons.\n**Alias:** `?rvc`' },
                    { name: '`?leaveteam`', value: 'Players leave non-auction teams.\n**Alias:** `?lt`\nAlso available as `+leaveteam`.' },
                    { name: '`?dmrole`', value: 'DM every member of a role.\n**Usage:** `?dmrole @Role [Message]`' },
                    { name: '`?scheduledm`', value: 'Schedule a DM to a role or user for later.\n**Usage:** `?scheduledm @Role/@User [Time] [Message]`\n**Aliases:** `?sdm`' }
                ]
            }
        ];

        const adminPages = [
            {
                id: 'admin_pings',
                emoji: '📢',
                title: 'Admin: Public Pings',
                description: 'Manage roles that users can ping with cooldowns.',
                fields: [
                    { name: '`?addpublicping`', value: 'Register a role for public pings.\n**Usage:** `?addpublicping @Role [alias] [cooldown_min]`\n**Aliases:** `?app`' },
                    { name: '`?addpublicpingwithchannel`', value: 'Register a role restricted to a specific channel.\n**Usage:** `?addpublicpingwithchannel @Role [alias] [cooldown_min]`\n**Aliases:** `?appwc`' },
                    { name: '`?removepublicping`', value: 'Unregister a role from public pings.\n**Usage:** `?removepublicping @Role`\n**Aliases:** `?rpp`' },
                    { name: '`?setpubliccooldown`', value: 'Change the global cooldown for a role.\n**Usage:** `?setpubliccooldown @Role [min]`\n**Aliases:** `?spc`' },
                    { name: '`?setallpubliccooldown`', value: 'Set a uniform cooldown for ALL roles.\n**Usage:** `?setallpubliccooldown [min]`\n**Aliases:** `?sapc`' },
                    { name: '`?listpublicpings`', value: 'List all registered roles and their cooldowns.\n**Usage:** `?listpublicpings`\n**Aliases:** `?lpp`' }
                ]
            },
            {
                id: 'admin_setup',
                emoji: '⚙️',
                title: 'Admin: Auction Setup',
                description: 'Core commands to prepare the auction database.',
                fields: [
                    { name: '`?createset`', value: 'Create a new player set.\n**Usage:** `?createset [Name] [Base]`\n**Aliases:** `?cs`' },
                    { name: '`?deleteset`', value: 'Delete one or more sets (Interactive).\n**Aliases:** `?ds`, `?rmset`' },
                    { name: '`?renameset`', value: 'Rename a set and update all linked auction players.\n**Usage:** `?renameset "Old Name" "New Name"`\n**Alias:** `?rs`' },
                    { name: '`?reordersets`', value: 'Move a set to a new position in the set order.\n**Usage:** `?reordersets 5 2` or `?reordersets "Silver Set" 1`\n**Alias:** `?rset`' },
                    { name: '`?setincrement`', value: 'Set minimum bid increase.\n**Aliases:** `?si`' },
                    { name: '`?setbase`', value: 'Update base price for a set.\n**Aliases:** `?sb`' },
                    { name: '`?addplayer`', value: 'Register one or more players. If no set is provided, the bot opens a set dropdown.\n**Aliases:** `?ap`, `?add`' },
                    { name: '`?assignset`', value: 'Move player to different set.\n**Aliases:** `?aset`' },
                    { name: '`?moveset`', value: 'Interactive player move/swap between sets.\n**Aliases:** `?mset`' },
                    { name: '`?removeplayer`', value: 'Delete players from the auction by mentions/usernames, or open a set-first picker when no users are given.\n**Aliases:** `?rp`' },
                    { name: '`?createprivatechannel`', value: 'Create a private text channel for a role.\n**Usage:** `?createprivatechannel @Role [channel-name]`\n**Aliases:** `?cpc`, `?ctcrole`' },
                    { name: '`?resetauction`', value: '**DANGER:** Wipes all auction data.\n**Aliases:** `?ra`' }
                ]
            },
            {
                id: 'admin_teams',
                emoji: '🛡️',
                title: 'Admin: Team Management',
                description: 'Configure teams, budgets, and owners.',
                fields: [
                    { name: '`?createteam`', value: 'Create team and link to owner.\n**Usage:** `?ct Team Name @Owner` or `?ct @Owner`\n**Aliases:** `?ct`' },
                    { name: '`?deleteteam`', value: 'Permanently delete team.\n**Aliases:** `?dt`' },
                    { name: '`?forceteamrename`', value: 'Admin rename for a team, its alias, and optionally its linked stadium. With no args, the bot shows a team dropdown with current name, abbreviation, and captain.\n**Usage:** `?forceteamrename Team/@Role/@Captain | New Team Name | ALIAS | new-stadium-name`\n**Aliases:** `?ftr`' },
                    { name: '`?teamnamefromrole`', value: 'Admin sync: rename a team to its linked role name and auto-set a 3-letter abbreviation. With no args, the bot shows a team dropdown.\n**Usage:** `?teamnamefromrole [Team/@Role/@Captain]`\n**Aliases:** `?tnr`' },
                    { name: '`?setpurse`', value: 'Set team budget.\n**Aliases:** `?sp`' },
                    { name: '`?setpurseall`', value: 'Set budget for ALL teams.\n**Aliases:** `?spa`' },
                    { name: '`?setteamlimit` / `?setlimit`', value: 'Set roster size limit for any auction or non-auction team by team name, role, captain, owner, or alias.\n**Usage:** `?setteamlimit [Team/@Role/@Captain/Alias] [Limit]`\n**Aliases:** `?stl`, `?sl`' },
                    { name: '`?setlimitall`', value: 'Set cap for ALL teams.\n**Aliases:** `?sla`' },
                    { name: '`?setowner`', value: 'Transfer team ownership.\n**Aliases:** `?so`' },
                    { name: '`?setregteamchannel`', value: 'Pick the text channel where reg-team instructions appear. You can mention a channel or choose category -> channel from dropdowns.\n**Aliases:** `?srtc`' }
                ]
            },
            {
                id: 'admin_live',
                emoji: '🎮',
                title: 'Admin: Live Auction Control',
                description: 'Manage active bidding.',
                fields: [
                    { name: '`?start`', value: 'Start bidding for a player.\n**Usage:** `?start [Set/@Player]`' },
                    { name: '`?pause`', value: 'Pause timer.\n**Aliases:** `?ps`' },
                    { name: '`?resume`', value: 'Resume timer.\n**Aliases:** `?re`' },
                    { name: '`?sold`', value: 'Force sell player.\n**Aliases:** `?sd`' },
                    { name: '`?pass`', value: 'Skip player.\n**Aliases:** `?pa`' },
                    { name: '`?undo`', value: 'Revert last bid.\n**Aliases:** `?ud`' },
                    { name: '`?unsell`', value: 'Refund and return a sold auction player to the pool. Use `?unsell @Player` during a live auction to restart that player immediately and queue the interrupted lot to resume after.\nAfter `?sat`, this also removes the player from the team role.\n**Aliases:** `?uns`' },
                    { name: '`?manualsell`', value: 'Manually assign an auction player to a team. After `?sat`, this also grants the team role.\n**Aliases:** `?ms`' }
                ]
            },
            {
                id: 'admin_roster',
                emoji: '📝',
                title: 'Admin: Roster Edits',
                description: 'Force adjustments to team rosters.',
                fields: [
                    { name: '`?addtoteam`', value: 'Force add an auction player to a team. After `?sat`, this also grants the team role.\n**Aliases:** `?att`' },
                    { name: '`?addusertoteam`', value: 'Directly add a server member to a non-auction team role.\n**Usage:** `?addusertoteam @User Team Name/@TeamRole/@Captain`\n**Alias:** `?aut`' },
                    { name: '`?removefromteam`', value: 'Admin kick for non-auction teams. You can pass `@User TeamName`, or run it with no args to choose group -> team -> player from dropdowns.\n**Alias:** `?rft`' },
                    { name: '`?ur` / `?unroster`', value: 'Auction unsell/remove flow for sold auction players. After `?sat`, this also removes the team role.' },
                    { name: '`?clearroster`', value: 'Clear team\'s roster.\n**Aliases:** `?cl`' },
                    { name: '`?clearset`', value: 'Clear all players from a set.' }
                ]
            },
            {
                id: 'admin_stats',
                emoji: '📈',
                title: 'Admin: Stats & Seasons',
                description: 'Manage player data and seasons.',
                fields: [
                    { name: '`?setupseason`', value: 'Set active season. (**Super Admin** for `--fresh`)\n**Aliases:** `?ss`' },
                    { name: '`?renameseason`', value: 'Rename a season.\n**Aliases:** `?rns`' },
                    { name: '`?resetseason`', value: '**SUPER ADMIN:** Wipe all teams/matches for a fresh start.\n**Aliases:** `?rsn`' },
                    { name: '`?addstats`', value: 'Record stats (Reply to match).\n**Aliases:** `?as`' },
                    { name: '`?setpotdwindow`', value: 'Set the daily Player of the Day match window and target channel. If no channel is mentioned, the bot first asks for a category, then a channel from that category.\n**Usage:** `?setpotdwindow today 8pm till tomorrow 3am [#channel]`\n**Aliases:** `?spw`, `?potdtimewindow`, `?ptw`' },
                    { name: '`?setpotdresultchannel`', value: 'Set the channel where the final POTD winner embed is announced after voting closes. If no channel is mentioned, the bot first asks for a category, then a channel from that category.\n**Usage:** `?setpotdresultchannel [#channel]`\n**Alias:** `?sprc`' },
                    { name: '`?setpotdpingrole`', value: 'Set which role POTD voting posts should ping. Use `off` to stop pinging any role.\n**Usage:** `?setpotdpingrole @Role` or `?setpotdpingrole off`\n**Alias:** `?sppr`' },
                    { name: '`?potdmultivote`', value: 'Allow or block multiple votes on POTD polls.\n**Usage:** `?potdmultivote on|off`\n**Alias:** `?pmv`' },
                    { name: '`?potdpreview`', value: 'Preview the final POTD winner embed using a sample player such as `.bavuma`, including avatar thumbnail.\n**Usage:** `?potdpreview .bavuma`\n**Alias:** `?pprev`' },
                    { name: '`?potdvotepreview`', value: 'Post a fake POTD voting message with reactions in the current channel so admins can see how the poll will look.\n**Usage:** `?potdvotepreview .bavuma`\n**Alias:** `?pvp`' },
                    { name: '`?potd`', value: 'Post the Player of the Day ranking in the configured voting channel. If a previous POTD poll is still open, the next day cannot start until voting closes and the winner is announced.\n**Usage:** `?potd day 1`\nUses the most recent completed configured window.' },
                    { name: '`?restartpotd`', value: 'Delete the current open POTD poll and post it again immediately. Use `clear` if you only want to remove the current poll and re-run `?potd` manually.\n**Usage:** `?restartpotd` or `?restartpotd clear`\n**Alias:** `?rpotd`' },
                    { name: '`?tots [Season]`', value: 'Ask for confirmation that the season is over, then choose `stadium` or `red` background before generating the Team Of The Season top 11 image from MVP.\n**Aliases:** `?endtots`, `?stots`' },
                    { name: '`?recalculateall`', value: 'Refresh season stats.\n**Aliases:** `?recalcall`' },
                    { name: '`?recalculateoverall`', value: 'Refresh career stats.\n**Aliases:** `?recalcov`' },
                    { name: '`?removematch`', value: 'Rollback a match.\n**Aliases:** `?undostats`, `?remmatch`' },
                    { name: '`?removeplayerstat`', value: 'Remove match stats for player.\n**Aliases:** `?rps`' }
                ]
            },
            {
                id: 'admin_fixtures',
                emoji: '📅',
                title: 'Admin: Fixture System',
                description: 'Tournament scheduling.',
                fields: [
                    { name: '`?fixturesettings`', value: 'Set rules and format.\n**Aliases:** `?fs`' },
                    { name: '`?fixturesetup`', value: 'Multi-step setup.\n**Aliases:** `?fsetup`' },
                    { name: '`?resetfixturesetup`', value: 'Clear the saved unfinished fixture setup session and start over cleanly.\n**Aliases:** `?rfsetup`' },
                    { name: '`?setfixturechannel`', value: 'Pick the text channel used for fixture announcements.\n**Aliases:** `?sfc`, `?fixturesetupchannel`' },
                    { name: '`?fixture edit`', value: 'Modify match data.' },
                    { name: '`?fixtures all`', value: 'Show full schedule.\n**Aliases:** `?fix`' },
                    { name: '`?fixture day`', value: 'Show matches for a day.' },
                    { name: '`?groupfixture`', value: 'Show generated fixtures filtered by day and/or group.\n**Usage:** `?groupfixture day 1 [group A]` or `?groupfixture group A`\n**Alias:** `?gf`' },
                    { name: '`?regteam`', value: 'Register a non-auction team.\n`?regteam @Role` uses that role.\n`?regteam Team Name` auto-creates that role.\n`?regteam` asks for the captain first, then auto-creates a temporary role from the captain name.\n**Aliases:** `?rt`' },
                    { name: '`?unregteam`', value: 'Unregister non-auction team.\n**Aliases:** `?urt`' },
                    { name: '`?regteams`', value: 'List/Manage reg teams.\n**Aliases:** `?rts`' }
                ]
            },
            {
                id: 'admin_pt_setup',
                emoji: '📊',
                title: 'Admin: Point Table System',
                description: 'League standings setup.',
                fields: [
                    { name: '`?setpointtableseason`', value: 'Set season and layout (Supports 6, 7, 8, and 10 teams).\n**Aliases:** `?spts`' },
                    { name: '`?auctionseason`', value: 'Choose which season stats are shown during auctions.\n**Alias:** `?aucs`' },
                    { name: '`?auctiontime`', value: 'Set the live auction bid timer after each valid bid.\n**Usage:** `?auctiontime 15`\n**Alias:** `?atime`' },
                    { name: '`?goingtime`', value: 'Set how long `GOING ONCE` and `GOING TWICE` last.\n**Usage:** `?goingtime 2`\n**Alias:** `?gtime`' },
                    { name: '`?setabb` / `?setalias`', value: 'Map team name to its abbreviation.\n**Alias:** `?sa`' },
                    { name: '`?setgroup`', value: 'Assign one or more teams to a group.\n**Usage:** `?setgroup A Team 1 | Team 2`\n**Aliases:** `?sg`' },
                    { name: '`?groupstatus`', value: 'Show group sizes and any unassigned teams.\n**Alias:** `?gs`' },
                    { name: '`?mixgroups`', value: 'Randomly rebalance groups when group mode is enabled.\n**Aliases:** `?mg`' },
                    { name: '`?ptmatch`', value: 'Record PT result.\n**Aliases:** `?ptm`' },
                    { name: '`?deletematch`', value: 'Delete PT result.\n**Aliases:** `?delm`' },
                    { name: '`?editptmatch`', value: 'Edit PT result with a recent-match dropdown. In group stage use `?editptmatch A`.\n**Aliases:** `?ptedit`' }
                ]
            },
            {
                id: 'admin_scheduling',
                emoji: '⏱️',
                title: 'Admin: Scheduling System',
                description: 'Fixture scheduling and reserve management.',
                fields: [
                    { name: '`?setseasonschedule`', value: 'Set scheduling season. (**Super Admin**)\n**Aliases:** `?sss`' },
                    { name: '`?setstadium`', value: 'Set match alert channel.\n**Aliases:** `?sstad`' },
                    { name: '`?setreservelimit`', value: 'Set the max reserve usage per team for the active scheduling season.\n**Aliases:** `?srl`' },
                    { name: '`?reservesleft`', value: 'Show how many reserves each team has left in the active scheduling season.\n**Aliases:** `?rleft`' },
                    { name: '`?recheckstadiums`', value: 'Re-scan recent non-bot messages in all active open stadiums and process any missed time/reserve messages.\n**Aliases:** `?rcheck`' },
                    { name: '`?setmatchcap`', value: 'Assign team captain.\n**Aliases:** `?smc`' },
                    { name: '`?removematchcap`', value: 'Remove team captain.\n**Aliases:** `?rmc`' },
                    { name: '`?schedule`', value: 'Force start scheduling.\n**Aliases:** `?sch`' },
                    { name: '`?fixture reserve day`', value: 'Announce one pending reserve batch for a specific reserve day using the rebuilt reserve queue.\n**Usage:** `?fixture reserve day <number>`' },
                    { name: '`?fixture reserve all`', value: 'Preview all pending reserve batches in paginated embeds without announcing them.' },
                    { name: '`?adminreserve`', value: 'Apply a reserve for a fixture by day and team roles. First mentioned team uses the reserve.\n**Usage:** `?adminreserve day 3 @ReserveTeam @OpponentTeam`\n**Aliases:** `?ares`' },
                    { name: '`?freewin`', value: 'Use inside an active fixture stadium. Admins get buttons to choose which team is conceding, then the bot records the PT result automatically.\n**Alias:** `?fw`' },
                    { name: '`?fixture auto time`', value: 'Set the daily time for automatic fixture announcements.\n**Usage:** `?fixture auto time <HH:MM>`\n**Example:** `?fixture auto time 21:00`' },
                    { name: '`?fixture auto enable`', value: 'Turn on automatic daily fixture posts.\n**Aliases:** `?fixture auto on`, `?fixture auto enable`' },
                    { name: '`?fixture auto disable`', value: 'Turn off automatic daily fixture posts.\n**Aliases:** `?fixture auto off`, `?fixture auto disable`' },
                    { name: '`?fixture auto day`', value: 'Manually trigger the next available automatic fixture announcement immediately.' },
                    { name: '`?fixture over`', value: 'Show which normal fixture days are fully over and which still have active or missing matches.' },
                    { name: '`?fixture fix day`', value: 'Step through all matches in a day and repair each one as completed, reserved by team1/team2/admin, or still open.\n**Usage:** `?fixture fix day <number>`' },
                    { name: '`?fixture repair reserve day`', value: 'Manually repair which team used reserve for a fixture day.\n**Usage:** `?fixture repair reserve day <number> @ReserveTeam @OpponentTeam [nocount]`' },
                    { name: '`?fixture undo day`', value: 'Undo an announced day so it can be posted again.\n**Usage:** `?fixture undo day <number>` or `?fixture undo reserve day <number>`' },
                    { name: '`?announce`', value: 'Post or reschedule the announced match time even after it has already been confirmed or scheduled.\n**Usage:** `?announce [Time]`\n**Example:** `?announce 9:30 PM`\n**Aliases:** `?ann`' },
                    { name: '`?resetmatchsystem`', value: 'Clear all fixture scheduling rows for this server. (**Super Admin**)\n**Aliases:** `?rms`' },
                    { name: '`?clearreserves`', value: 'Clear stored reserve usage counters.\n**Aliases:** `?cr`' },
                    { name: '`?removereserve`', value: 'Remove an active scheduling row from the system.\n**Aliases:** `?rr`' },
                    { name: '`?teamrenamelimit`', value: 'Set how many renames captains get.\n**Aliases:** `?trl`' },
                    { name: '`?teamrenamewindow`', value: 'Lock or unlock both `?stadiumname` and `?teamrename` immediately. Also clears any scheduled expiry and DMs captains.\n**Usage:** `?teamrenamewindow on|off`\n**Aliases:** `?trw`' },
                    { name: '`?lockrenames`', value: 'Instantly lock both `?stadiumname` and `?teamrename`, then DM captains.\n**Alias:** `?lrn`' },
                    { name: '`?teamrenamedeadline`', value: 'Set the exact deadline after which captains can no longer use `?stadiumname` or `?teamrename`.\n**Usage:** `?teamrenamedeadline 12 dec 11:59pm`\n**Alias:** `?trd`' }
                ]
            },
            {
                id: 'admin_infra',
                emoji: '🏗️',
                title: 'Admin: Infra & Channels',
                description: 'Manage roles and channels.',
                fields: [
                    { name: '`?createallteamchannels`', value: 'Create private channels.\n**Aliases:** `?catc`' },
                    { name: '`?createchannel`', value: 'Create a regular text channel after choosing the target category from a dropdown.\n**Usage:** `?createchannel [name]`\n**Alias:** `?cc`' },
                    { name: '`?createallteamroles`', value: 'Create roles for all teams.\n**Aliases:** `?catr`' },
                    { name: '`?createteamchannel`', value: 'Create a private channel for one team.\n**Aliases:** `?ctc`' },
                    { name: '`?createteamrole`', value: 'Create a role for one team.\n**Aliases:** `?ctr`' },
                    { name: '`?setupauctionteams`', value: 'Post-auction bootstrap for auction teams: creates/links roles, assigns owners and bought players, asks for a stadium category and a private dressing-room category, creates/moves both channel types, and prompts owners about `?teamrename` / `?stadiumname`.\n**Alias:** `?sat`' },
                    { name: '`?assignstadium`', value: 'Assign an existing text channel as a team stadium by team name, role, owner, or captain. Repoints future home fixtures and active home reservations, then deletes the team\'s previous stadium channel if it changed. With no args, the bot asks for team/captain, then category, then stadium.\n**Usage:** `?assignstadium [Team/@Role/@Captain] [#stadium-channel]`\n**Alias:** `?asd`' },
                    { name: '`?teamrole`', value: 'Link or change the Discord role for a team.\n**Aliases:** `?tr`, `?atr`, `?assignteamrole`' },
                    { name: '`?setsaleschannel`', value: 'Set SOLD log channel.\n**Aliases:** `?ssc`' },
                    { name: '`?setplayerlogchannel` / `?setteamlogchannel`', value: 'Set or clear the player activity log channel for join, leave, add, kick, and approved join-request updates. You can mention a channel or choose category -> channel from dropdowns.\n**Usage:** `?setplayerlogchannel #channel`, `?setplayerlogchannel`, or `?setplayerlogchannel off`\n**Aliases:** `?splc`, `?stlc`' },
                    { name: '`?playerlogtoggle`', value: 'Turn player activity logs on or off without clearing the saved channel.\n**Usage:** `?playerlogtoggle on|off`\n**Alias:** `?plt`' },
                    { name: '`?teammanagetoggle`', value: 'Enable or disable captain `?teamadd` / `?teamkick` commands and DM community leaders about the change.\n**Usage:** `?teammanagetoggle on|off`\n**Alias:** `?tmt`' },
                    { name: '`?jointeamtoggle`', value: 'Enable or disable `?jointeam` requests and DM community leaders about the change.\n**Usage:** `?jointeamtoggle on|off`\n**Alias:** `?jtt`' },
                    { name: '`?appc`', value: 'Set the admin-only ping restricted channel.\n**Alias:** `?adminpingplacement`' },
                    { name: '`?assignrole`', value: 'Mass assign role to users.\n**Aliases:** `?ar`' },
                    { name: '`?removerole`', value: 'Remove one role from many users, or multiple roles from one user. Works with mentions or without pings using `users:` / `roles:` sections.\n**Usage:** `?removerole @Role @User1 @User2`, `?removerole @User @Role1 @Role2`, or `?removerole users: User One, User Two | roles: Role Name`\n**Alias:** `?rmrole`' },
                    { name: '`?renamerole`', value: 'Rename an existing Discord role.\n**Usage:** `?renamerole @Role New Role Name`\n**Alias:** `?rrl`' },
                    { name: '`?copyrole`', value: 'Give a target role to every member who has a source role.\n**Usage:** `?copyrole @SourceRole @TargetRole` or `?copyrole Target Role Name @SourceRole`\nCreates the target role if needed.\n**Alias:** `?r2r`' },
                    { name: '`?setrolecaptain`', value: 'Set role captain.\n**Aliases:** `?src`' },
                    { name: '`?removerolecaptain`', value: 'Remove role captain.\n**Aliases:** `?rrc`' },
                    { name: '`?setpinger`', value: 'Grant pinger access.\n**Aliases:** `?sping`' },
                    { name: '`?listpingers`', value: 'List users with pinger permissions.\n**Aliases:** `?lp`' },
                    { name: '`?removepinger`', value: 'Remove pinger access.\n**Aliases:** `?rping`' },
                    { name: '`?listscheduled`', value: 'List pending scheduled DMs.\n**Aliases:** `?lsdm`' },
                    { name: '`?delscheduled`', value: 'Delete pending scheduled DMs.\n**Aliases:** `?delsdm`' },
                    { name: '`?tradeconfig`', value: 'Open/Close Transfer Window.\n**Aliases:** `?tc`' }
                ]
            },
            {
                id: 'admin_system',
                emoji: '💻',
                title: 'Admin: System Settings',
                description: 'Core bot management and server config.',
                fields: [
                    { name: '`?makesuperadmin`', value: 'Promote to Super Admin (Global Admin Only).\n**Aliases:** `?msa`' },
                    { name: '`?removesuperadmin`', value: 'Demote Super Admin to standard Admin (Global Only).\n**Aliases:** `?rmsa`' },
                    { name: '`?makeadmin`', value: 'Grant Auction Admin role (Super Admin Only).\n**Aliases:** `?ma`' },
                    { name: '`?removeadmin`', value: 'Revoke Admin access (Super Admin Only).\n**Aliases:** `?rma`' },
                    { name: '`?listadmins`', value: 'Displays a paginated list of all authorized users categorized by Global Admin, Global Manager, Super Admin, and Admin.\n**Usage:** `?listadmins`\n**Aliases:** `?la`' },
                    { name: '`?setglobalmanager`', value: 'Promote a user to Global Manager, which gives them automatic Super Admin access in every enabled server.\n**Usage:** `?setglobalmanager @user`\n**Aliases:** `?sgm`' },
                    { name: '`?removeglobalmanager`', value: 'Revoke Global Manager status from a user.\n**Usage:** `?removeglobalmanager @user`\n**Aliases:** `?rgm`' },
                    { name: '`?globalmanagerservers`', value: 'Open an interactive paginated menu to enable or disable Global Manager powers in specific servers.\n**Usage:** `?globalmanagerservers`\n**Aliases:** `?gms`' },
                    { name: '`?setauditlogchannel`', value: 'Set or clear this server\'s admin audit log channel. You can mention a channel or choose category -> channel from dropdowns.\n**Usage:** `?setauditlogchannel #channel`, `?setauditlogchannel`, or `?setauditlogchannel off`\n**Aliases:** `?salc`, `?setdestructivelogchannel`, `?sdlc`' },
                    { name: '`?auditlogtoggle`', value: 'Turn this server\'s admin audit log delivery on or off without clearing the saved channel.\n**Usage:** `?auditlogtoggle on|off`\n**Alias:** `?alt`' },
                    { name: '`?settimezone`', value: 'Set server local time.\n**Aliases:** `?stz`' },
                    { name: '`?auditlog [count]`', value: 'Admin: view recent high-impact admin actions recorded for this server.\n**Alias:** `?alog`' },
                    { name: '`?healthcheck`', value: 'Admin: audit core setup, key channels, team links, and pending jobs for this server.\n**Alias:** `?diag`' },
                    { name: '`?setupserver`', value: 'Global Admin only: double-confirmed full support-server setup with tracked roles, categories, channels, starter messages, ticket panel, and logs.\n**Aliases:** `?serversetup`, `?setupsupportserver`, `?setupmanagerserver`, `?cmsetup`' },
                    { name: '`?repairserver` / `?rebuildserver` / `?setupstatus` / `?sendpanels`', value: 'Global Admin only: repair tracked items, rebuild only bot-managed structure, inspect support setup health, or resend starter panels.' },
                    { name: '`?sendmodpanel` / `?modpanel`', value: 'Global Admin only: send or refresh the managed dropdown moderation panel in the current channel or a mentioned text channel.' },
                    { name: '`?modcmdservers` / `?mcservers`', value: 'Global Admin only: open a dropdown panel of every server the bot is in and enable or disable the global moderation command set per guild.' },
                    { name: '`?superadminmod` / `?samod`', value: 'Global Admin only: open a dropdown panel to enable or disable Super Admin access to global moderation commands (`?warn`, `?ban`, etc) per guild.' },
                    { name: '`?backupnow`', value: 'Global Admin: create an immediate SQLite backup snapshot on disk.' },
                    { name: '`?exportdata`', value: 'Global Admin: create a fresh SQLite export snapshot and attach it if the file fits Discord upload limits.' },
                    { name: '`?botstatus`', value: 'Global Admin: show bot health plus the full server list with status and member counts.\n**Aliases:** `?botservers`, `?bs`' },
                    { name: '`?cmdstats`', value: 'Global Admin: view aggregated command usage counts. Use `?cmdstats <command>` for per-guild usage.\n**Aliases:** `?commandstats`, `?cusage`' },
                    { name: '`?bvb` / `?matchup`', value: 'Bowler vs Batter matchup command. During standard match play, HC matchup data is auto-saved as soon as the match-end payload is detected.\n**Usage:** `?bvb @bowler @batter [sessionId]`, `?bvb bowler vs batter`, or quoted names.' },
                    { name: '`?analysehcbot` / `?endanalyse`', value: 'Global Admin HC analysis flow. Start live capture with `?analysehcbot`, stop it with `?endanalyse`.' },
                    { name: '`?savehc` / `?savedhc` / `?hcemojimap` / `?findhcemoji`', value: 'Global Admin HC utilities for storing trusted HC bot entries, listing saved items, checking the confirmed emoji map, and searching captured emoji usage.\n**Aliases:** `?listhc`, `?hcemojis`, `?hcmap`, `?hcfindemoji`, `?fhe`' }
                ]
            }
        ];

        const pages = userIsAdmin ? [...allPages, ...adminPages] : allPages;
        let currentPage = 0;
        
        const getEmbed = (pageIndex) => {
            const page = pages[pageIndex];
            return new discord_js_1.EmbedBuilder()
                .setColor(userIsAdmin ? 0xFFD700 : 0x0099ff)
                .setTitle(`${page.emoji} ${page.title}`)
                .setDescription(page.description)
                .addFields(page.fields)
                .setFooter({ text: `Page ${pageIndex + 1} of ${pages.length} | HCG Auction Bot v3.1` });
        };

        const getRows = (pageIndex) => {
            const selectMenu = new discord_js_1.StringSelectMenuBuilder()
                .setCustomId('help_select')
                .setPlaceholder('📖 Jump to Section...')
                .addOptions(pages.map((page, index) => new discord_js_1.StringSelectMenuOptionBuilder()
                    .setLabel(page.title)
                    .setValue(index.toString())
                    .setEmoji(page.emoji)
                    .setDefault(index === pageIndex)));
            
            const selectRow = new discord_js_1.ActionRowBuilder().addComponents(selectMenu);
            const buttonRow = new discord_js_1.ActionRowBuilder()
                .addComponents(new discord_js_1.ButtonBuilder()
                    .setCustomId('prev')
                    .setLabel('◀️ Previous')
                    .setStyle(discord_js_1.ButtonStyle.Primary)
                    .setDisabled(pageIndex === 0), 
                new discord_js_1.ButtonBuilder()
                    .setCustomId('next')
                    .setLabel('Next ▶️')
                    .setStyle(discord_js_1.ButtonStyle.Primary)
                    .setDisabled(pageIndex === pages.length - 1));
            
            return [selectRow, buttonRow];
        };

        const response = await message.reply({
            embeds: [getEmbed(currentPage)],
            components: getRows(currentPage)
        });
        
        const collector = response.createMessageComponentCollector({ time: 300000 });
        
        collector.on('collect', async (i) => {
            try {
                if (i.user.id !== message.author.id) {
                    await i.reply({ content: 'Only the person who asked for help can use these controls.', flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                if (i.isStringSelectMenu()) {
                    currentPage = parseInt(i.values[0]);
                } else if (i.isButton()) {
                    if (i.customId === 'prev') currentPage = Math.max(0, currentPage - 1);
                    else if (i.customId === 'next') currentPage = Math.min(pages.length - 1, currentPage + 1);
                }
                await i.update({
                    embeds: [getEmbed(currentPage)],
                    components: getRows(currentPage)
                });
            } catch (e) {
                console.error("Help collector error:", e);
            }
        });
        
        collector.on('end', () => {
            response.edit({ components: [] }).catch(() => { });
        });
        return;
    }
    // Bidding
    if (command === 'bid' || command === 'b') {
        const db = (0, database_1.getDB)();
        // Identify Team
        // Update query to check guild_id
        const team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND owner_discord_id = ?', guildId, message.author.id);
        if (!team) {
            message.reply("You are not a registered team owner.");
            return;
        }
        // Parse Amount
        let amount = 0;
        const input = args.join(' ');
        if (input === '+' || input === '') {
            amount = 'increment';
        }
        else {
            const parsed = (0, utils_1.parseBidToLakhs)(input);
            if (parsed === null) {
                message.reply("Invalid bid amount format.");
                return;
            }
            amount = parsed;
        }
        try {
            await auctionManager_1.auctionManager.placeBid(guildId, team, amount, message.channel);
        }
        catch (e) {
            message.reply(`Error: ${e.message}`);
        }
    }
}));
client.on('messageUpdate', wrapAsyncEventHandler('messageUpdate', async (_oldMessage, newMessage) => {
    let resolvedMessage = newMessage;
    if (resolvedMessage.partial) {
        resolvedMessage = await resolvedMessage.fetch().catch(() => null);
    }
    if (!resolvedMessage || resolvedMessage.author?.id !== HC_CRICKET_BOT_ID) {
        return;
    }
    try {
        await captureHcAutoMessageVersion(resolvedMessage, 'update');
    }
    catch (err) {
        console.error('Failed to auto-track HC message update:', err);
    }
}));

client.on('interactionCreate', wrapAsyncEventHandler('interactionCreate', async (interaction) => {
    if (await (0, supportServerSystem_1.handleInteraction)(interaction)) {
        return;
    }
    if (interaction.isButton() || interaction.isStringSelectMenu()) {
        const customId = interaction.customId;
        if (customId.startsWith('joinreqdm_')) {
            await (0, commands_1.handleJoinRequestInteraction)(interaction);
            return;
        }
        if (customId.startsWith('ipl_predict:') || customId.startsWith('ipl_settle:')) {
            await (0, iplPredictionSystem_1.handleInteraction)(interaction);
            return;
        }
        
        // Trade System
        if (customId.startsWith('trade_') || customId.startsWith('admin_approve_trade_') || customId.startsWith('admin_reject_trade_')) {
            await tradeSystem_1.tradeSystem.handleInteraction(interaction);
            return;
        }
    }
}));
client.on('messageReactionAdd', wrapAsyncEventHandler('messageReactionAdd', async (reaction, user) => {
    await (0, commands_1.handlePotdReactionAdd)(reaction, user);
    await (0, iplPredictionSystem_1.handleReactionAdd)(reaction, user);
}));
client.on('messageReactionRemove', wrapAsyncEventHandler('messageReactionRemove', async (reaction, user) => {
    await (0, iplPredictionSystem_1.handleReactionRemove)(reaction, user);
}));
async function checkAutoFixtureAnnouncements() {
    const db = (0, database_1.getDB)();
    const now = new Date();
    
    const guildsSettings = await db.all('SELECT * FROM fixture_settings WHERE auto_announce_enabled = 1 AND auto_announce_time IS NOT NULL');
    
    for (const setting of guildsSettings) {
        const guild = client.guilds.cache.get(setting.guild_id);
        if (!guild) continue;

        const gSettings = await db.get('SELECT timezone FROM guild_settings WHERE guild_id = ?', guild.id);
        let tz = gSettings?.timezone || 'Asia/Kolkata';
        if (tz === 'IST') tz = 'Asia/Kolkata';

        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            hour: '2-digit', minute: '2-digit', hour12: false
        });
        const timeStr = formatter.format(now); // "HH:MM"

        if (timeStr === setting.auto_announce_time) {
            console.log(`Auto-announcing fixtures for guild ${guild.name} (${guild.id}) at ${timeStr}`);
            
            const season = await matchSystem_1.matchSystem.getActiveScheduleSeason(guild.id);
            if (!season) continue;

            const nextNormalState = await matchSystem_1.matchSystem.getNextNormalAnnouncementState(guild.id, season);
            if (nextNormalState.kind === 'ready' && Number.isInteger(nextNormalState.dayNumber)) {
                await matchSystem_1.matchSystem.announceFixtureDay(guild, nextNormalState.dayNumber, false).catch(e => console.error(`Auto-announce failed for ${guild.name} (Day ${nextNormalState.dayNumber}):`, e));
            }
            else if (nextNormalState.kind === 'already_active' || nextNormalState.kind === 'blocked') {
                console.log(`Auto-announce skipped for ${guild.name}: Day ${nextNormalState.dayNumber} is not ready yet.`);
            }
            else {
                // Try next reserve day
                const announcedReserves = (await db.all('SELECT DISTINCT reserve_day_number FROM match_reservations WHERE guild_id = ? AND season_name = ? AND reserve_day_number IS NOT NULL', [guild.id, season])).map(r => r.reserve_day_number);
                let nextReserveDay = 1;
                if (announcedReserves.length > 0) nextReserveDay = Math.max(...announcedReserves) + 1;
                await matchSystem_1.matchSystem.announceFixtureDay(guild, nextReserveDay, true).catch(e => console.error(`Auto-announce failed for ${guild.name} (Reserve Day ${nextReserveDay}):`, e));
            }
        }
    }
}

async function startBot() {
    await (0, database_1.initDB)();
    await utils_1.loadGlobalManagerCache((0, database_1.getDB)());
    await client.login(process.env.DISCORD_TOKEN);
}
module.exports = {
    rebuildHcFinalizedMatchupData
};
if (require.main === module) {
    startBot().catch((err) => {
        console.error('Failed to start bot:', err);
        process.exit(1);
    });
}
