"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleFixtureCommand = handleFixtureCommand;
exports.handleAdminCommand = handleAdminCommand;
exports.handleUserCommand = handleUserCommand;
exports.handleManagementCommand = handleManagementCommand;
exports.checkScheduledMessages = checkScheduledMessages;
exports.checkPotdAutoPosts = checkPotdAutoPosts;
exports.checkPotdPolls = checkPotdPolls;
exports.handlePotdReactionAdd = handlePotdReactionAdd;
exports.handleJoinRequestInteraction = handleJoinRequestInteraction;
exports.handleDynamicPings = handleDynamicPings;
exports.promptForCategoryTextChannel = promptForCategoryTextChannel;
const SCHEDULED_MESSAGE_BATCH_SIZE = 5;
const DM_CONCURRENCY_LIMIT = 5;
const JOIN_REQUEST_DM_TTL_MS = 7 * 24 * 60 * 60 * 1000;
let scheduledMessageJobRunning = false;

function isComponentTimeoutError(error) {
    if (!error)
        return false;
    if (error.name === 'InteractionCollectorError')
        return typeof error.message === 'string' && error.message.toLowerCase().includes('time');
    if (typeof error.message === 'string') {
        const lower = error.message.toLowerCase();
        if (lower.includes('time') || lower.includes('timed out'))
            return true;
    }
    return false;
}
function isComponentMessageDeletedError(error) {
    if (!error)
        return false;
    if (error.reason === 'messageDelete' || error.reason === 'messageDeleteBulk')
        return true;
    if (typeof error.message === 'string') {
        const lower = error.message.toLowerCase();
        if (lower.includes('reason: messagedelete') || lower.includes('reason: message delete'))
            return true;
    }
    return false;
}
function isUnknownMessageError(error) {
    if (!error)
        return false;
    if (error.code === 10008 || error.rawError?.code === 10008)
        return true;
    if (typeof error.message === 'string' && error.message.toLowerCase().includes('unknown message'))
        return true;
    return false;
}
async function respondComponentError(targetMessage, error, timeoutText, genericText = '⚠️ Something went wrong. Please try again.') {
    if (!targetMessage || typeof targetMessage.edit !== 'function')
        return;
    if (isComponentMessageDeletedError(error))
        return;
    const payload = { content: '', components: [] };
    if (isComponentTimeoutError(error)) {
        payload.content = timeoutText;
    }
    else {
        console.error(error);
        payload.content = genericText;
    }
    if (targetMessage.editable) {
        try {
            await targetMessage.edit(payload);
        }
        catch (err) {
            if (isUnknownMessageError(err))
                return;
            console.error('Failed to edit component response:', err);
        }
    }
}
async function awaitComponent(message, options, timeoutText = '❌ Interaction timed out.', failureText = '⚠️ Unable to process the selection.') {
    try {
        return await message.awaitMessageComponent(options);
    }
    catch (e) {
        await respondComponentError(message, e, timeoutText, failureText);
        return null;
    }
}

async function promptForCategoryTextChannel(message, options = {}) {
    if (!message.guild) {
        return null;
    }
    const categoryCustomId = options.categoryCustomId || `channel_category_${message.id}`;
    const channelCustomId = options.channelCustomId || `channel_select_${message.id}`;
    const categories = message.guild.channels.cache
        .filter(channel => channel.type === discord_js_1.ChannelType.GuildCategory)
        .map(channel => ({
        label: channel.name.slice(0, 100),
        value: channel.id
    }))
        .slice(0, 25);
    if (!categories.length) {
        await message.reply(options.noCategoriesText || "No categories found in this server.");
        return null;
    }
    const categoryRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
        .setCustomId(categoryCustomId)
        .setPlaceholder(options.categoryPlaceholder || 'Select Category')
        .addOptions(categories));
    const response = await message.reply({
        content: options.categoryPrompt || "Select a **Category** first:",
        components: [categoryRow]
    });
    const categorySelection = await awaitComponent(response, {
        filter: i => i.user.id === message.author.id && i.customId === categoryCustomId,
        time: 60000,
        max: 1
    }, options.categoryTimeoutText || "❌ Category selection timed out.", options.categoryFailureText || "⚠️ Failed to select a category.");
    if (!categorySelection) {
        return null;
    }
    await categorySelection.deferUpdate();
    const selectedCategoryId = categorySelection.values[0];
    const channels = message.guild.channels.cache
        .filter(channel => channel.parentId === selectedCategoryId && channel.type === discord_js_1.ChannelType.GuildText)
        .map(channel => ({
        label: channel.name.slice(0, 100),
        value: channel.id
    }))
        .slice(0, 25);
    if (!channels.length) {
        await categorySelection.editReply({
            content: options.noChannelsText || "No text channels found in this category.",
            components: []
        }).catch(() => null);
        return null;
    }
    const channelRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
        .setCustomId(channelCustomId)
        .setPlaceholder(options.channelPlaceholder || 'Select Channel')
        .addOptions(channels));
    await categorySelection.editReply({
        content: options.channelPrompt || "Select the **Channel**:",
        components: [channelRow]
    }).catch(() => null);
    const channelSelection = await awaitComponent(response, {
        filter: i => i.user.id === message.author.id && i.customId === channelCustomId,
        time: 60000,
        max: 1
    }, options.channelTimeoutText || "❌ Channel selection timed out.", options.channelFailureText || "⚠️ Failed to select a channel.");
    if (!channelSelection) {
        return null;
    }
    await channelSelection.deferUpdate();
    const channel = await message.guild.channels.fetch(channelSelection.values[0]).catch(() => null);
    if (!channel || channel.type !== discord_js_1.ChannelType.GuildText) {
        await channelSelection.editReply({
            content: options.invalidChannelText || "⚠️ The selected channel is no longer available.",
            components: []
        }).catch(() => null);
        return null;
    }
    return { channel, interaction: channelSelection, response };
}

async function formatDate(guildId, timestamp, includeTime = true) {
    const db = (0, database_1.getDB)();
    const settings = await db.get('SELECT timezone FROM guild_settings WHERE guild_id = ?', guildId);
    let tz = settings ? settings.timezone : 'IST';
    if (tz === 'IST') tz = 'Asia/Kolkata';

    return new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: includeTime ? 'numeric' : undefined,
        minute: includeTime ? 'numeric' : undefined,
        hour12: true
    }).format(new Date(timestamp));
}

async function formatTeamRenameExpiry(guildId, timestamp) {
    if (!timestamp)
        return null;
    const db = (0, database_1.getDB)();
    const settings = await db.get('SELECT timezone FROM guild_settings WHERE guild_id = ?', guildId);
    let tz = settings ? settings.timezone : 'IST';
    if (tz === 'IST')
        tz = 'Asia/Kolkata';
    const formatted = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        dateStyle: 'medium',
        timeStyle: 'short'
    }).format(new Date(timestamp));
    return `${formatted} (${tz})`;
}

async function checkScheduledMessages(client) {
    if (scheduledMessageJobRunning)
    scheduledMessageJobRunning = true;
    try {
        const db = (0, database_1.getDB)();
        const now = Math.floor(Date.now() / 1000);
        while (true) {
            const pending = await db.all('SELECT * FROM scheduled_messages WHERE status = "PENDING" AND scheduled_time <= ? ORDER BY scheduled_time ASC LIMIT ?', now, SCHEDULED_MESSAGE_BATCH_SIZE);
            if (pending.length === 0)
                break;
            const ids = pending.map(m => m.id);
            if (ids.length > 0) {
                const placeholders = ids.map(() => '?').join(',');
                await db.run(`UPDATE scheduled_messages SET status = "IN_PROGRESS" WHERE id IN (${placeholders})`, ids);
            }
            for (const msg of pending) {
                await dispatchScheduledMessage(client, msg);
            }
            if (pending.length < SCHEDULED_MESSAGE_BATCH_SIZE)
                break;
        }
    }
    catch (err) {
        console.error('Failed to process scheduled messages:', err);
    }
    finally {
        scheduledMessageJobRunning = false;
    }
}
async function dispatchScheduledMessage(client, msg) {
    const db = (0, database_1.getDB)();
    let status = 'FAILED';
    try {
        const guild = await client.guilds.fetch(msg.guild_id);
        if (!guild)
            throw new Error('Guild not found');
        const authorName = await resolveAuthorName(client, msg.author_id);
        const payload = `📢 **Message from ${authorName}:**\n\n${msg.message_content}`;
        let successCount = 0;
        if (msg.target_type === 'USER') {
            try {
                const user = await client.users.fetch(msg.target_role_id);
                await user.send(payload);
                successCount = 1;
            }
            catch (err) {
                console.error(`Failed to DM user ${msg.target_role_id}`, err);
            }
        }
        else {
            const role = await guild.roles.fetch(msg.target_role_id);
            if (!role)
                throw new Error(`Role ${msg.target_role_id} not found`);
            if (!role.members.size) {
                await guild.members.fetch({ role: role.id }).catch(() => null);
            }
            const members = Array.from(role.members.values());
            successCount = await sendPayloadInBatches(members, payload);
        }
        status = successCount > 0 ? 'SENT' : 'FAILED';
        console.log(`Executed scheduled message ID ${msg.id}. Sent to ${successCount} targets.`);
    }
    catch (err) {
        console.error(`Failed to process scheduled message ${msg.id}:`, err);
    }
    finally {
        await db.run('UPDATE scheduled_messages SET status = ? WHERE id = ?', status, msg.id);
    }
}
async function resolveAuthorName(client, authorId) {
    if (!authorId)
        return "Admin";
    try {
        const author = await client.users.fetch(authorId);
        return author?.username || "Admin";
    }
    catch (_a) {
        return "Admin";
    }
}
async function sendPayloadInBatches(targets, payload) {
    let successCount = 0;
    const queue = [...targets];
    while (queue.length) {
        const chunk = queue.splice(0, DM_CONCURRENCY_LIMIT);
        const results = await Promise.allSettled(chunk.map(member => member?.send(payload)));
        for (const result of results) {
            if (result.status === 'fulfilled') {
                successCount++;
            }
        }
    }
    return successCount;
}
const POTD_TIMEZONE = 'Asia/Kolkata';
const POTD_SPONSOR_USER_ID = '690549928757559297';
const POTD_PING_ROLE_ID = '1469201829903601798';
const POTD_MAX_ENTRIES = 6;
const POTD_REACTION_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣'];
const POTD_PREVIEW_MAX_AGE_SECONDS = 86400;
const potdPreviewMessages = new Map();

function parsePotdClockTime(input) {
    const normalized = (input || '').trim().toLowerCase();
    const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (!match)
        return null;
    let hours = parseInt(match[1], 10);
    const minutes = match[2] ? parseInt(match[2], 10) : 0;
    const meridiem = match[3] ? match[3].toLowerCase() : null;
    if (minutes < 0 || minutes > 59)
        return null;
    if (meridiem) {
        if (hours < 1 || hours > 12)
            return null;
        if (meridiem === 'pm' && hours < 12)
            hours += 12;
        if (meridiem === 'am' && hours === 12)
            hours = 0;
    }
    else if (hours > 23) {
        return null;
    }
    return { hours, minutes };
}

function getTimeZoneOffsetMinutes(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        timeZoneName: 'shortOffset'
    }).formatToParts(date);
    const offsetPart = parts.find(p => p.type === 'timeZoneName');
    const offsetName = offsetPart ? offsetPart.value : 'GMT+0';
    const match = offsetName.match(/([+-])(\d+):(\d+)/);
    if (!match)
        return 0;
    const sign = match[1] === '-' ? -1 : 1;
    return sign * ((parseInt(match[2], 10) * 60) + parseInt(match[3], 10));
}

function zonedDateTimeToUtcMs(year, month, day, hours, minutes, timeZone) {
    const utcGuess = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0));
    const offsetMinutes = getTimeZoneOffsetMinutes(utcGuess, timeZone);
    return utcGuess.getTime() - (offsetMinutes * 60000);
}

function getTimeZoneDateParts(date, timeZone) {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric'
    });
    const parts = formatter.formatToParts(date);
    const findPart = (type) => parseInt(parts.find(p => p.type === type)?.value || '0', 10);
    return {
        year: findPart('year'),
        month: findPart('month'),
        day: findPart('day')
    };
}

function shiftDateParts(parts, days) {
    const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
    return {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate()
    };
}

function formatPotdTimeLabel(totalMinutes) {
    const hours24 = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const meridiem = hours24 >= 12 ? 'PM' : 'AM';
    const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
    if (minutes === 0)
        return `${hours12}${meridiem.toLowerCase()}`;
    return `${hours12}:${String(minutes).padStart(2, '0')}${meridiem.toLowerCase()}`;
}

function computeLatestCompletedPotdWindow(settings, now = new Date()) {
    const startMinute = settings?.window_start_minute ?? 1200;
    const endMinute = settings?.window_end_minute ?? 180;
    const endOffset = settings?.window_end_day_offset ?? 1;
    const today = getTimeZoneDateParts(now, POTD_TIMEZONE);
    const endTodayParts = shiftDateParts(today, endOffset);
    const endTodayMs = zonedDateTimeToUtcMs(endTodayParts.year, endTodayParts.month, endTodayParts.day, Math.floor(endMinute / 60), endMinute % 60, POTD_TIMEZONE);
    const anchor = now.getTime() >= endTodayMs ? today : shiftDateParts(today, -1);
    const startParts = anchor;
    const endParts = shiftDateParts(anchor, endOffset);
    return {
        startMs: zonedDateTimeToUtcMs(startParts.year, startParts.month, startParts.day, Math.floor(startMinute / 60), startMinute % 60, POTD_TIMEZONE),
        endMs: zonedDateTimeToUtcMs(endParts.year, endParts.month, endParts.day, Math.floor(endMinute / 60), endMinute % 60, POTD_TIMEZONE),
        anchor
    };
}

async function savePotdWindowSettings(guildId, channelId, windowStartMinute, windowEndMinute, windowEndDayOffset) {
    const db = (0, database_1.getDB)();
    await db.run(`INSERT INTO potd_settings (guild_id, channel_id, window_start_minute, window_end_minute, window_end_day_offset)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET
            channel_id = excluded.channel_id,
            window_start_minute = excluded.window_start_minute,
            window_end_minute = excluded.window_end_minute,
            window_end_day_offset = excluded.window_end_day_offset`, guildId, channelId, windowStartMinute, windowEndMinute, windowEndDayOffset);
}

function formatBallsAsOvers(balls) {
    const completedOvers = Math.floor((balls || 0) / 6);
    const extraBalls = (balls || 0) % 6;
    return `${completedOvers}.${extraBalls}`;
}

function formatPotdPerformance(row) {
    const batting = `${row.runs}(${row.balls_played})`;
    const bowling = `${row.wickets}-${row.runs_conceded}(${formatBallsAsOvers(row.balls_bowled)})`;
    return `${batting} & ${bowling}`;
}
function formatPotdVotingPerformance(row) {
    const batting = `${row.runs} (${row.balls_played})`;
    const bowling = `${row.wickets}/${row.runs_conceded} (${formatBallsAsOvers(row.balls_bowled)})`;
    return `${batting} & ${bowling}`;
}
function buildPotdVotingMessage(label, entries, allowMultipleVotes, pingRoleId, includePreviewNote = false) {
    const displayLabel = sanitizePotdDisplayLabel(label);
    const lines = ['# 🏆 Player of the Day 🏆', '', `## ${displayLabel}`, ''];
    for (const entry of entries) {
        lines.push(`**${entry.emoji} ${entry.playerLine}**`);
        if (entry.teamLine) {
            lines.push(`> ${entry.teamLine}`);
        }
        lines.push(`> ${entry.detailLine}`);
        lines.push('');
    }
    if (pingRoleId) {
        lines.push(`<@&${pingRoleId}>`);
        lines.push('');
    }
    lines.push('- React below to vote');
    lines.push(allowMultipleVotes
        ? '- Multiple votes are allowed'
        : '- No multiple votes. If you react on another option, your latest vote stays and the old one is removed automatically.');
    lines.push('- Voting closes 24 hours after posting');
    if (includePreviewNote) {
        lines.push('- **Preview only** - reactions on this post will not be counted');
    }
    return lines.join('\n');
}
function sanitizePotdDisplayLabel(label) {
    const raw = String(label || '').trim();
    if (!raw)
        return 'Match Day';
    const withoutSeason = raw
        .replace(/\bseason\s*\d+\b/ig, '')
        .replace(/\bs\s*\d+\b/ig, '')
        .replace(/\s*[-|:]\s*/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
    return withoutSeason || 'Match Day';
}
function parsePotdDayNumberFromLabel(label) {
    const match = String(label || '').trim().match(/^Match Day\s+(\d+)$/i);
    return match ? parseInt(match[1], 10) : null;
}
async function resolveAutomaticPotdDayNumber(db, guildId, activeSeason, rows) {
    const distinctDays = [...new Set(rows
            .map(row => Number.isInteger(row.fixture_day_number) ? row.fixture_day_number : null)
            .filter(day => Number.isInteger(day) && day > 0))]
        .sort((a, b) => a - b);
    const lastPoll = await db.get(`SELECT label_text
        FROM potd_polls
        WHERE guild_id = ? AND season_name = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1`, guildId, activeSeason);
    const lastDay = parsePotdDayNumberFromLabel(lastPoll?.label_text);
    if (lastDay !== null) {
        const nextDay = lastDay + 1;
        if (distinctDays.includes(nextDay)) {
            return nextDay;
        }
    }
    if (distinctDays.length === 1) {
        return distinctDays[0];
    }
    return distinctDays.length ? distinctDays[0] : null;
}
function getPotdPreviewConfig(messageId, guildId) {
    const preview = potdPreviewMessages.get(messageId);
    if (!preview)
        return null;
    if (preview.guildId !== guildId || preview.expiresAt <= Math.floor(Date.now() / 1000)) {
        potdPreviewMessages.delete(messageId);
        return null;
    }
    return preview;
}

async function addPotdPollReactions(message, optionCount) {
    const capped = Math.max(0, Math.min(optionCount, POTD_REACTION_EMOJIS.length));
    for (let i = 0; i < capped; i++) {
        await message.react(POTD_REACTION_EMOJIS[i]).catch(() => null);
    }
}

async function tallyPotdPollMessage(message, optionCount) {
    const results = [];
    for (let i = 0; i < optionCount && i < POTD_REACTION_EMOJIS.length; i++) {
        const emoji = POTD_REACTION_EMOJIS[i];
        const reaction = message.reactions.cache.find(r => r.emoji.name === emoji);
        if (!reaction) {
            results.push({ emoji, count: 0, rank: i + 1 });
            continue;
        }
        const users = await reaction.users.fetch().catch(() => null);
        const count = users ? [...users.values()].filter(user => !user.bot).length : Math.max(0, (reaction.count || 1) - 1);
        results.push({ emoji, count, rank: i + 1 });
    }
    results.sort((a, b) => b.count - a.count || a.rank - b.rank);
    return results;
}

async function checkPotdPolls(client) {
    const db = (0, database_1.getDB)();
    const now = Math.floor(Date.now() / 1000);
    const polls = await db.all('SELECT * FROM potd_polls WHERE status = "OPEN" AND closes_at <= ?', now);
    for (const poll of polls) {
        try {
            const channel = await client.channels.fetch(poll.channel_id).catch(() => null);
            if (!channel || !channel.isTextBased?.()) {
                await db.run('UPDATE potd_polls SET status = "CLOSED" WHERE id = ?', poll.id);
                continue;
            }
            const message = await channel.messages.fetch(poll.message_id).catch(() => null);
            if (!message) {
                await db.run('UPDATE potd_polls SET status = "CLOSED" WHERE id = ?', poll.id);
                continue;
            }
            const results = await tallyPotdPollMessage(message, poll.option_count);
            const winner = results[0];
            const candidate = winner
                ? await db.get('SELECT * FROM potd_poll_candidates WHERE poll_id = ? AND option_rank = ?', poll.id, winner.rank)
                : null;
            const settings = await db.get('SELECT results_channel_id FROM potd_settings WHERE guild_id = ?', poll.guild_id);
            const resultsChannelId = settings?.results_channel_id || poll.channel_id;
            let resultsChannel = await client.channels.fetch(resultsChannelId).catch(() => null);
            if (!resultsChannel || !resultsChannel.isTextBased?.()) {
                resultsChannel = channel;
            }
            const lines = [
                `# 🏆 Player Of The Day Voting Closed`,
                `${poll.label_text}`,
                winner ? `Winner: ${winner.emoji} Option **${winner.rank}** with **${winner.count}** vote${winner.count === 1 ? '' : 's'}.` : 'No votes were cast.',
                ...results.map(result => `${result.emoji} Option ${result.rank}: **${result.count}** vote${result.count === 1 ? '' : 's'}`)
            ];
            lines.length = 0;
            lines.push('# Player Of The Day Voting Closed', `${sanitizePotdDisplayLabel(poll.label_text)}`);
            if (resultsChannel.id !== channel.id) {
                lines.push(`Winner announcement is being posted in ${resultsChannel}.`);
            }
            lines.push(winner ? `Winner: ${winner.emoji} Option **${winner.rank}** with **${winner.count}** vote${winner.count === 1 ? '' : 's'}.` : 'No votes were cast.');
            lines.push(...results.map(result => `${result.emoji} Option ${result.rank}: **${result.count}** vote${result.count === 1 ? '' : 's'}`));
            let resultAnnouncement = null;
            if (winner && candidate && winner.count > 0) {
                const guild = message.guild || await client.guilds.fetch(poll.guild_id).catch(() => null);
                const member = guild ? await guild.members.fetch(candidate.user_id).catch(() => null) : null;
                const user = member?.user || await client.users.fetch(candidate.user_id).catch(() => null);
                const displayName = member?.displayName || user?.username || candidate.user_id;
                const avatarUrl = member?.displayAvatarURL({ extension: 'png', size: 256 }) || user?.displayAvatarURL({ extension: 'png', size: 256 }) || null;
                const embed = new discord_js_1.EmbedBuilder()
                    .setColor(0xF1C40F)
                    .setTitle('🏆 Player Of The Day')
                    .setDescription(`${sanitizePotdDisplayLabel(poll.label_text)}`)
                    .addFields({ name: 'Player', value: `<@${candidate.user_id}>`, inline: true }, { name: 'Username', value: displayName, inline: true }, { name: 'Team', value: candidate.team_name_snapshot || 'Unknown Team', inline: true }, { name: 'Performance', value: formatPotdPerformance(candidate), inline: false }, { name: 'Opponent', value: candidate.opponent_name_snapshot || 'Unknown Opponent', inline: true }, { name: 'Votes', value: String(winner.count), inline: true })
                    .setFooter({ text: `Winning option ${winner.rank}` })
                    .setTimestamp(new Date(poll.closes_at * 1000));
                if (avatarUrl) {
                    embed.setThumbnail(avatarUrl);
                }
                resultAnnouncement = await resultsChannel.send({ embeds: [embed] }).catch(() => null);
            }
            await channel.send(lines.join('\n')).catch(() => null);
            await db.run('UPDATE potd_polls SET status = "CLOSED", result_message_id = ? WHERE id = ?', resultAnnouncement?.id || null, poll.id);
        }
        catch (err) {
            console.error('Failed to finalize POTD poll:', err);
        }
    }
}

async function createPotdPollForGuild(client, guildId, options = {}) {
    const requestedDay = Number.isInteger(options.requestedDay) ? options.requestedDay : null;
    const replyMessage = options.replyMessage || null;
    const autoMode = !!options.auto;
    const db = (0, database_1.getDB)();
    const activeSeason = await statsSystem.getActiveSeason(guildId);
    if (!activeSeason) {
        return { ok: false, code: 'NO_ACTIVE_SEASON', userMessage: "No active season set. Use `?setupseason <name>` first." };
    }
    const settings = await db.get('SELECT * FROM potd_settings WHERE guild_id = ?', guildId);
    if (!settings || !settings.channel_id) {
        return { ok: false, code: 'NO_SETTINGS', userMessage: "POTD window not configured. Use `?setpotdwindow today 8pm till tomorrow 3am [#channel]` first." };
    }
    const existingOpenPoll = await db.get('SELECT * FROM potd_polls WHERE guild_id = ? AND status = "OPEN" ORDER BY created_at DESC LIMIT 1', guildId);
    if (existingOpenPoll) {
        const resultsTargetId = settings.results_channel_id || settings.channel_id;
        const resultsMention = resultsTargetId ? `<#${resultsTargetId}>` : 'the results channel';
        return {
            ok: false,
            code: 'OPEN_POLL',
            userMessage: `A POTD poll is already open for **${sanitizePotdDisplayLabel(existingOpenPoll.label_text)}**. Wait for voting to close and the winner to be announced in ${resultsMention} before starting the next day.`
        };
    }
    const guild = replyMessage?.guild || client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
        return { ok: false, code: 'GUILD_UNAVAILABLE' };
    }
    const targetChannel = settings.channel_id
        ? await guild.channels.fetch(settings.channel_id).catch(() => null)
        : replyMessage?.channel || null;
    if (!targetChannel || !targetChannel.isTextBased?.()) {
        return { ok: false, code: 'INVALID_CHANNEL', userMessage: "POTD channel is invalid. Re-run `?setpotdwindow` in the correct channel." };
    }
    const window = computeLatestCompletedPotdWindow(settings);
    const windowStartSec = Math.floor(window.startMs / 1000);
    const windowEndSec = Math.floor(window.endMs / 1000);
    const existingWindowPoll = await db.get(`SELECT id, status, label_text
        FROM potd_polls
        WHERE guild_id = ? AND season_name = ?
          AND source_window_start_at = ? AND source_window_end_at = ?
        ORDER BY id DESC
        LIMIT 1`, guildId, activeSeason, windowStartSec, windowEndSec);
    if (existingWindowPoll) {
        return {
            ok: false,
            code: 'WINDOW_ALREADY_POSTED',
            userMessage: `POTD has already been posted for **${sanitizePotdDisplayLabel(existingWindowPoll.label_text)}** in the latest completed window.`
        };
    }
    const rows = await db.all(`SELECT sm.*, ctx.team_name_snapshot, ctx.opponent_name_snapshot, ctx.fixture_day_number, COALESCE(ctx.match_timestamp, sm.timestamp) AS potd_match_timestamp
        FROM stats_matches sm
        LEFT JOIN stats_match_context ctx
          ON ctx.guild_id = sm.guild_id AND ctx.match_id = sm.match_id AND ctx.user_id = sm.user_id
        WHERE sm.guild_id = ? AND sm.season_name = ? AND COALESCE(ctx.match_timestamp, sm.timestamp) >= ? AND COALESCE(ctx.match_timestamp, sm.timestamp) < ?
        ORDER BY sm.match_id ASC, sm.match_mvp DESC, sm.runs DESC, sm.wickets DESC`, guildId, activeSeason, window.startMs, window.endMs);
    if (!rows.length) {
        return { ok: false, code: 'NO_MATCHES', userMessage: "No recorded matches were found in the latest completed POTD window." };
    }
    const effectiveRequestedDay = requestedDay !== null
        ? requestedDay
        : (autoMode ? await resolveAutomaticPotdDayNumber(db, guildId, activeSeason, rows) : null);
    const label = effectiveRequestedDay !== null ? `Match Day ${effectiveRequestedDay}` : 'Match Day';
    const winnersByMatch = new Map();
    for (const row of rows) {
        if (!winnersByMatch.has(row.match_id)) {
            winnersByMatch.set(row.match_id, row);
        }
    }
    let winners = [...winnersByMatch.values()];
    if (effectiveRequestedDay !== null && winners.some(row => row.fixture_day_number === effectiveRequestedDay)) {
        winners = winners.filter(row => row.fixture_day_number === effectiveRequestedDay);
    }
    winners.sort((a, b) => (b.match_mvp - a.match_mvp) || (b.runs - a.runs) || (b.wickets - a.wickets));
    winners = winners.slice(0, POTD_MAX_ENTRIES);
    if (!winners.length) {
        return { ok: false, code: 'NO_ELIGIBLE', userMessage: "No eligible match MVPs were found for that POTD selection." };
    }
    const entries = winners.map((row, index) => ({
        emoji: POTD_REACTION_EMOJIS[index] || `${index + 1}.`,
        playerLine: `<@${row.user_id}>`,
        teamLine: `Team: ${row.team_name_snapshot || 'Unknown Team'}`,
        detailLine: `${formatPotdVotingPerformance(row)} vs ${row.opponent_name_snapshot || 'Unknown Opponent'}`
    }));
    const pollMessage = await targetChannel.send(buildPotdVotingMessage(label, entries, !!settings.allow_multiple_votes, settings.ping_role_id ?? POTD_PING_ROLE_ID));
    await addPotdPollReactions(pollMessage, winners.length);
    const createdAt = Math.floor(Date.now() / 1000);
    const pollInsert = await db.run(`INSERT INTO potd_polls (guild_id, channel_id, message_id, season_name, label_text, option_count, allow_multiple_votes, source_window_start_at, source_window_end_at, created_at, closes_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')`, guildId, targetChannel.id, pollMessage.id, activeSeason, label, winners.length, settings.allow_multiple_votes ? 1 : 0, windowStartSec, windowEndSec, createdAt, createdAt + 86400);
    const pollId = pollInsert?.lastID;
    if (pollId) {
        for (let index = 0; index < winners.length; index++) {
            const winner = winners[index];
            await db.run(`INSERT INTO potd_poll_candidates (poll_id, option_rank, user_id, match_id, runs, balls_played, wickets, runs_conceded, balls_bowled, match_mvp, team_name_snapshot, opponent_name_snapshot, fixture_day_number)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, pollId, index + 1, winner.user_id, winner.match_id, winner.runs, winner.balls_played, winner.wickets, winner.runs_conceded, winner.balls_bowled, winner.match_mvp, winner.team_name_snapshot || null, winner.opponent_name_snapshot || null, winner.fixture_day_number || null);
        }
    }
    return { ok: true, targetChannel, label, pollMessage };
}

async function checkPotdAutoPosts(client) {
    const db = (0, database_1.getDB)();
    const settingsRows = await db.all('SELECT guild_id FROM potd_settings WHERE channel_id IS NOT NULL');
    for (const row of settingsRows) {
        try {
            const result = await createPotdPollForGuild(client, row.guild_id, { auto: true });
            if (result?.ok) {
                console.log(`Auto-posted POTD poll for guild ${row.guild_id} in channel ${result.targetChannel?.id || 'unknown'}.`);
            }
        }
        catch (err) {
            console.error(`Failed to auto-post POTD for guild ${row.guild_id}:`, err);
        }
    }
}

async function removeCurrentPotdPoll(client, guildId) {
    const db = (0, database_1.getDB)();
    const existingOpenPoll = await db.get('SELECT * FROM potd_polls WHERE guild_id = ? AND status = "OPEN" ORDER BY created_at DESC LIMIT 1', guildId);
    if (!existingOpenPoll) {
        return { ok: false, code: 'NO_OPEN_POLL', userMessage: 'There is no open POTD poll to remove.' };
    }
    const channel = await client.channels.fetch(existingOpenPoll.channel_id).catch(() => null);
    if (channel?.isTextBased?.()) {
        const pollMessage = await channel.messages.fetch(existingOpenPoll.message_id).catch(() => null);
        if (pollMessage) {
            await pollMessage.delete().catch(() => null);
        }
    }
    await db.run('DELETE FROM potd_polls WHERE id = ?', existingOpenPoll.id);
    return { ok: true, poll: existingOpenPoll };
}

async function handlePotdReactionAdd(reaction, user) {
    if (!reaction || !user || user.bot)
        return;
    try {
        if (reaction.partial)
            reaction = await reaction.fetch();
        const message = reaction.message;
        if (!message?.guildId)
            return;
        const db = (0, database_1.getDB)();
        const poll = await db.get('SELECT * FROM potd_polls WHERE guild_id = ? AND message_id = ? AND status = "OPEN"', message.guildId, message.id);
        const previewConfig = !poll ? getPotdPreviewConfig(message.id, message.guildId) : null;
        const optionCount = poll ? poll.option_count : previewConfig?.optionCount;
        if ((!poll && !previewConfig) || !optionCount)
            return;
        const emojiName = reaction.emoji?.name;
        if (!POTD_REACTION_EMOJIS.slice(0, optionCount).includes(emojiName)) {
            await reaction.users.remove(user.id).catch(() => null);
            return;
        }
        const allowMultipleVotes = poll ? !!poll.allow_multiple_votes : !!previewConfig?.allowMultipleVotes;
        if (allowMultipleVotes)
            return;
        for (const candidate of POTD_REACTION_EMOJIS.slice(0, optionCount)) {
            if (candidate === emojiName)
                continue;
            const otherReaction = message.reactions.cache.find(r => r.emoji.name === candidate);
            if (!otherReaction)
                continue;
            const otherUsers = await otherReaction.users.fetch().catch(() => null);
            if (!otherUsers?.has(user.id))
                continue;
            await otherReaction.users.remove(user.id).catch(() => null);
        }
    }
    catch (err) {
        console.error('Failed to enforce POTD vote rules:', err);
    }
}

async function resolveFixtureDayForMatchContext(guildId, seasonName, reservation) {
    if (!reservation)
        return null;
    if (reservation.reserve_day_number) {
        return `Reserve Day ${reservation.reserve_day_number}`;
    }
    if (reservation.fixture_day_number) {
        return reservation.fixture_day_number;
    }
    const db = (0, database_1.getDB)();
    let row = await db.get(`SELECT day_number
        FROM generated_fixtures
        WHERE guild_id = ? AND season_name = ? AND team_a_id = ? AND team_b_id = ? AND stadium_id = ?
        ORDER BY day_number ASC
        LIMIT 1`, guildId, seasonName, reservation.team_a_id, reservation.team_b_id, reservation.stadium_channel_id);
    if (!row) {
        row = await db.get(`SELECT day_number
            FROM generated_fixtures
            WHERE guild_id = ? AND season_name = ?
              AND ((team_a_id = ? AND team_b_id = ?) OR (team_a_id = ? AND team_b_id = ?))
            ORDER BY CASE WHEN stadium_id = ? THEN 0 ELSE 1 END, day_number ASC
            LIMIT 1`, guildId, seasonName, reservation.team_a_id, reservation.team_b_id, reservation.team_b_id, reservation.team_a_id, reservation.stadium_channel_id);
    }
    return row?.day_number ?? null;
}

async function resolveReservationContextForStats(guildId, seasonName, channelId, matchTimestampMs) {
    const db = (0, database_1.getDB)();
    const matchTimestampSec = Math.floor(matchTimestampMs / 1000);
    const reservations = await db.all(`SELECT r.*, t1.team_name AS team_a_name, t2.team_name AS team_b_name
        FROM match_reservations r
        JOIN teams t1 ON r.team_a_id = t1.team_id
        JOIN teams t2 ON r.team_b_id = t2.team_id
        WHERE r.guild_id = ? AND r.season_name = ? AND r.stadium_channel_id = ?
        ORDER BY CASE WHEN r.scheduled_time IS NULL THEN 1 ELSE 0 END,
                 ABS(COALESCE(r.scheduled_time, r.created_at) - ?) ASC
        LIMIT 5`, guildId, seasonName, channelId, matchTimestampSec);
    if (!reservations.length)
        return null;
    const reservation = reservations.find(r => Math.abs((r.scheduled_time || r.created_at || matchTimestampSec) - matchTimestampSec) <= 86400) || reservations[0];
    return {
        ...reservation,
        fixture_day_number: await resolveFixtureDayForMatchContext(guildId, seasonName, reservation)
    };
}

async function resolveUserTeamForReservation(guildId, userId, reservation, guild) {
    if (!reservation)
        return null;
    const db = (0, database_1.getDB)();
    const teamAId = reservation.team_a_id;
    const teamBId = reservation.team_b_id;
    let row = await db.get('SELECT team_id, team_name FROM teams WHERE guild_id = ? AND owner_discord_id = ? AND team_id IN (?, ?)', guildId, userId, teamAId, teamBId);
    if (row)
        return row;
    row = await db.get(`SELECT t.team_id, t.team_name
        FROM team_captains tc
        JOIN teams t ON t.team_id = tc.team_id
        WHERE tc.guild_id = ? AND tc.captain_discord_id = ? AND t.team_id IN (?, ?)`, guildId, userId, teamAId, teamBId);
    if (row)
        return row;
    row = await db.get(`SELECT t.team_id, t.team_name
        FROM auction_players ap
        JOIN teams t ON t.team_id = ap.sold_to_team_id
        WHERE ap.guild_id = ? AND ap.discord_id = ? AND ap.sold_to_team_id IN (?, ?)`, guildId, userId, teamAId, teamBId);
    if (row)
        return row;
    row = await db.get(`SELECT t.team_id, t.team_name
        FROM team_join_requests jr
        JOIN teams t ON t.team_id = jr.team_id
        WHERE jr.guild_id = ? AND jr.requester_id = ? AND jr.status = 'APPROVED' AND jr.team_id IN (?, ?)
        ORDER BY jr.responded_at DESC
        LIMIT 1`, guildId, userId, teamAId, teamBId);
    if (row)
        return row;
    if (!guild)
        return null;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member)
        return null;
    const roleTeams = await db.all(`SELECT team_id, team_name, role_id
        FROM teams
        WHERE guild_id = ? AND team_id IN (?, ?) AND role_id IS NOT NULL`, guildId, teamAId, teamBId);
    const matchingRoleTeams = roleTeams.filter(team => team.role_id && member.roles.cache.has(team.role_id));
    if (matchingRoleTeams.length === 1) {
        return {
            team_id: matchingRoleTeams[0].team_id,
            team_name: matchingRoleTeams[0].team_name
        };
    }
    return null;
}

function sanitizeChannelNameInput(input) {
    if (!input)
        return null;
    const normalized = input
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (!normalized)
        return null;
    return normalized.slice(0, 90);
}

async function getTeamRenameSettings(guildId) {
    const db = (0, database_1.getDB)();
    const row = await db.get('SELECT team_name_change_limit, team_rename_window_open, team_rename_window_expires_at FROM guild_settings WHERE guild_id = ?', guildId);
    const limit = row && typeof row.team_name_change_limit === 'number' ? row.team_name_change_limit : 3;
    const expiresAt = row && typeof row.team_rename_window_expires_at === 'number' ? row.team_rename_window_expires_at : null;
    const expired = !!(expiresAt && Date.now() >= expiresAt);
    const enabled = (row ? row.team_rename_window_open !== 0 : true) && !expired;
    return {
        limit: limit < 0 ? 0 : limit,
        enabled,
        expiresAt,
        expired
    };
}

async function attemptStadiumRename(guild, guildId, teamId, channelId, requestedName) {
    const db = (0, database_1.getDB)();
    const renameSettings = await getTeamRenameSettings(guildId);
    if (!renameSettings.enabled || renameSettings.limit === 0) {
        return { ok: false, reason: 'window_closed', settings: renameSettings };
    }
    const record = await db.get('SELECT COALESCE(rename_count, 0) as rename_count FROM team_stadiums WHERE guild_id = ? AND team_id = ?', guildId, teamId);
    const currentCount = record?.rename_count || 0;
    if (currentCount >= renameSettings.limit) {
        return { ok: false, reason: 'limit', used: currentCount, settings: renameSettings };
    }
    const sanitizedName = sanitizeChannelNameInput(requestedName);
    if (!sanitizedName) {
        return { ok: false, reason: 'invalid_name', settings: renameSettings };
    }
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) {
        return { ok: false, reason: 'missing_channel', settings: renameSettings };
    }
    await channel.edit({ name: sanitizedName }).catch(() => null);
    await db.run('UPDATE team_stadiums SET rename_count = COALESCE(rename_count, 0) + 1 WHERE guild_id = ? AND team_id = ?', guildId, teamId);
    return {
        ok: true,
        newName: sanitizedName,
        used: currentCount + 1,
        settings: renameSettings
    };
}

async function forceRenameStadiumChannel(guild, channelId, requestedName) {
    const sanitizedName = sanitizeChannelNameInput(requestedName);
    if (!sanitizedName) {
        return { ok: false, reason: 'invalid_name' };
    }
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== discord_js_1.ChannelType.GuildText) {
        return { ok: false, reason: 'missing_channel' };
    }
    const renamed = await channel.edit({ name: sanitizedName }).then(() => true).catch(() => false);
    if (!renamed) {
        return { ok: false, reason: 'rename_failed' };
    }
    return {
        ok: true,
        newName: sanitizedName
    };
}

async function findNonAuctionTeamByIdentifier(guildId, identifier) {
    if (!identifier)
        return null;
    const db = (0, database_1.getDB)();
    const roleMatch = identifier.match(/<@&(\d+)>/);
    if (roleMatch) {
        const teamByRole = await db.get('SELECT * FROM teams WHERE guild_id = ? AND purse_lakhs = -1 AND role_id = ?', guildId, roleMatch[1]);
        if (teamByRole)
            return teamByRole;
    }
    const mentionMatch = identifier.match(/<@!?(\d+)>/);
    if (mentionMatch) {
        const teamByCaptain = await db.get(`SELECT t.* FROM team_captains tc
            JOIN teams t ON tc.team_id = t.team_id
            WHERE tc.guild_id = ? AND tc.captain_discord_id = ? AND t.purse_lakhs = -1`, guildId, mentionMatch[1]);
        if (teamByCaptain)
            return teamByCaptain;
    }
    const normalized = identifier.toLowerCase();
    let team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND purse_lakhs = -1 AND LOWER(team_name) = ?', guildId, normalized);
    if (!team) {
        team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND purse_lakhs = -1 AND team_name LIKE ?', guildId, `%${identifier}%`);
    }
    if (!team) {
        const aliasRow = await db.get('SELECT full_name FROM pt_team_aliases WHERE guild_id = ? AND alias = ?', guildId, normalized.toUpperCase());
        if (aliasRow) {
            team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND purse_lakhs = -1 AND team_name = ?', guildId, aliasRow.full_name);
        }
    }
    return team || null;
}

async function findExistingCommunityTeamMembership(guildId, userId, roleIds = [], excludeTeamId = null) {
    const db = (0, database_1.getDB)();
    const ownerTeam = await db.get('SELECT * FROM teams WHERE guild_id = ? AND purse_lakhs = -1 AND owner_discord_id = ?', guildId, userId);
    if (ownerTeam && ownerTeam.team_id !== excludeTeamId) {
        return { team: ownerTeam, source: 'OWNER' };
    }
    const captainTeam = await db.get(`SELECT t.* FROM team_captains tc
        JOIN teams t ON tc.team_id = t.team_id
        WHERE tc.guild_id = ? AND tc.captain_discord_id = ? AND t.purse_lakhs = -1`, guildId, userId);
    if (captainTeam && captainTeam.team_id !== excludeTeamId) {
        return { team: captainTeam, source: 'CAPTAIN' };
    }
    if (roleIds.length) {
        const placeholders = roleIds.map(() => '?').join(',');
        const params = [guildId, ...roleIds];
        const roleTeam = await db.get(`SELECT * FROM teams WHERE guild_id = ? AND purse_lakhs = -1 AND role_id IN (${placeholders})`, ...params);
        if (roleTeam && roleTeam.team_id !== excludeTeamId) {
            return { team: roleTeam, source: 'ROLE' };
        }
    }
    return null;
}

async function getCommunityRosterControls(guildId) {
    const db = (0, database_1.getDB)();
    const row = await db.get(`SELECT admin_audit_log_channel_id,
        COALESCE(admin_audit_logs_enabled, 1) AS admin_audit_logs_enabled,
        COALESCE(community_player_log_channel_id, community_roster_log_channel_id) AS community_player_log_channel_id,
        COALESCE(community_player_logs_enabled, 1) AS community_player_logs_enabled,
        COALESCE(community_roster_manage_open, 1) AS community_roster_manage_open,
        COALESCE(community_join_requests_open, 1) AS community_join_requests_open
        FROM guild_settings WHERE guild_id = ?`, guildId);
    return {
        enabled: !row || row.community_roster_manage_open !== 0,
        captainManageEnabled: !row || row.community_roster_manage_open !== 0,
        joinRequestsEnabled: !row || row.community_join_requests_open !== 0,
        logChannelId: row?.community_player_log_channel_id || null,
        playerLogsEnabled: !row || row.community_player_logs_enabled !== 0,
        adminAuditLogChannelId: row?.admin_audit_log_channel_id || null,
        adminAuditLogsEnabled: !row || row.admin_audit_logs_enabled !== 0
    };
}

async function updateGuildLogChannelSetting(message, config) {
    const guildId = message.guild.id;
    const db = (0, database_1.getDB)();
    const raw = config.rawInput || '';
    const mentionedChannel = message.mentions.channels.first();
    if (!mentionedChannel && (raw === 'off' || raw === 'clear')) {
        await db.run(config.clearSql, guildId);
        await (0, auditLog_1.appendAdminAuditLog)({
            guildId,
            actorId: message.author.id,
            commandName: config.commandName,
            summary: config.clearedSummary,
            targetSummary: message.guild.name,
            channelId: message.channel.id
        }).catch(() => null);
        return message.reply(config.clearedReply);
    }
    let channel = mentionedChannel;
    let selection = null;
    if (channel && channel.type !== discord_js_1.ChannelType.GuildText) {
        channel = null;
    }
    if (!channel) {
        selection = await promptForCategoryTextChannel(message, {
            categoryPrompt: config.categoryPrompt,
            channelPrompt: config.channelPrompt,
            noCategoriesText: 'No categories found in this server.',
            noChannelsText: 'No text channels were found in that category.'
        });
        if (!selection) {
            return;
        }
        channel = selection.channel;
    }
    await db.run(config.saveSql, guildId, channel.id, channel.id);
    await (0, auditLog_1.appendAdminAuditLog)({
        guildId,
        actorId: message.author.id,
        commandName: config.commandName,
        summary: config.updatedSummary(channel),
        targetSummary: `${channel.name} (${channel.id})`,
        channelId: message.channel.id
    }).catch(() => null);
    if (selection?.interaction) {
        return await selection.interaction.editReply({
            content: config.updatedReply(channel),
            components: []
        }).catch(() => null);
    }
    return message.reply(config.updatedReply(channel));
}

async function updateGuildLogToggle(message, config) {
    const guildId = message.guild.id;
    const db = (0, database_1.getDB)();
    const value = (config.value || '').toLowerCase();
    if (!['on', 'off'].includes(value)) {
        return message.reply(config.usageText);
    }
    const enabled = value === 'on' ? 1 : 0;
    await db.run(config.sql, guildId, enabled, enabled);
    await (0, auditLog_1.appendAdminAuditLog)({
        guildId,
        actorId: message.author.id,
        commandName: config.commandName,
        summary: config.summary(enabled === 1),
        targetSummary: message.guild.name,
        channelId: message.channel.id
    }).catch(() => null);
    return message.reply(config.reply(enabled === 1));
}

async function getCommunityLeadershipUserIds(guildId) {
    const db = (0, database_1.getDB)();
    const teams = await db.all('SELECT owner_discord_id FROM teams WHERE guild_id = ? AND purse_lakhs = -1 AND owner_discord_id IS NOT NULL', guildId);
    const captains = await db.all(`SELECT tc.captain_discord_id
        FROM team_captains tc
        JOIN teams t ON tc.team_id = t.team_id
        WHERE tc.guild_id = ? AND tc.captain_discord_id IS NOT NULL AND t.purse_lakhs = -1`, guildId);
    return [...new Set([
            ...teams.map(row => row.owner_discord_id),
            ...captains.map(row => row.captain_discord_id)
        ].filter(id => /^\d{15,21}$/.test(String(id || ''))))];
}

async function notifyCommunityLeadersAboutRosterSetting(guild, notice) {
    const ids = await getCommunityLeadershipUserIds(guild.id);
    let sent = 0;
    let failed = 0;
    for (const userId of ids) {
        try {
            const user = await guild.client.users.fetch(userId);
            await user.send(`ℹ️ **${guild.name}**\n${notice}`);
            sent++;
        }
        catch (_a) {
            failed++;
        }
    }
    return { sent, failed };
}

async function sendCommunityRosterAuditLog(guild, actorId, targetMember, team, action, reason = '') {
    const controls = await getCommunityRosterControls(guild.id);
    if (!controls.playerLogsEnabled || !controls.logChannelId)
        return;
    const channel = await guild.channels.fetch(controls.logChannelId).catch(() => null);
    if (!channel || typeof channel.send !== 'function')
        return;
    const normalizedAction = String(action || '').toUpperCase();
    const titleMap = {
        ADD: 'Player Added',
        JOIN: 'Player Joined',
        KICK: 'Player Removed',
        LEAVE: 'Player Left'
    };
    const isPositive = normalizedAction === 'ADD' || normalizedAction === 'JOIN';
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(isPositive ? 0x57F287 : 0xED4245)
        .setTitle(titleMap[normalizedAction] || 'Community Roster Update')
        .setThumbnail(targetMember.displayAvatarURL({ size: 256 }))
        .addFields({ name: 'Team', value: `**${team.team_name}**`, inline: true }, { name: 'By', value: actorId ? `<@${actorId}>` : 'System', inline: true }, { name: 'Player', value: `<@${targetMember.id}>`, inline: true })
        .setTimestamp();
    if (reason) {
        embed.addFields({ name: 'Reason', value: reason.slice(0, 1024) });
    }
    await channel.send({ embeds: [embed] }).catch(() => null);
}

async function getCommunityTeamMembersForSelection(guild, guildId, team) {
    if (!team?.role_id)
        return [];
    const role = await guild.roles.fetch(team.role_id).catch(() => null);
    if (!role)
        return [];
    if (!role.members.size) {
        await guild.members.fetch().catch(() => null);
    }
    const captainRow = await (0, database_1.getDB)().get('SELECT captain_discord_id FROM team_captains WHERE guild_id = ? AND team_id = ?', guildId, team.team_id);
    const captainId = captainRow?.captain_discord_id || null;
    return [...role.members.values()]
        .filter(member => member.id !== team.owner_discord_id && member.id !== captainId)
        .sort((a, b) => a.user.username.localeCompare(b.user.username));
}

async function findTeamByIdentifier(guildId, identifier) {
    if (!identifier)
        return null;
    const db = (0, database_1.getDB)();
    const roleMatch = identifier.match(/<@&(\d+)>/);
    if (roleMatch) {
        const teamByRole = await db.get('SELECT * FROM teams WHERE guild_id = ? AND role_id = ?', guildId, roleMatch[1]);
        if (teamByRole)
            return teamByRole;
    }
    const mentionMatch = identifier.match(/<@!?(\d+)>/);
    if (mentionMatch) {
        const userId = mentionMatch[1];
        let team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND owner_discord_id = ?', guildId, userId);
        if (team)
            return team;
        team = await db.get(`SELECT t.* FROM team_captains tc
            JOIN teams t ON tc.team_id = t.team_id
            WHERE tc.guild_id = ? AND tc.captain_discord_id = ?`, guildId, userId);
        if (team)
            return team;
    }
    const normalized = identifier.toLowerCase();
    let team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND LOWER(team_name) = ?', guildId, normalized);
    if (!team) {
        team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND team_name LIKE ?', guildId, `%${identifier}%`);
    }
    if (!team) {
        const aliasRow = await db.get('SELECT full_name FROM pt_team_aliases WHERE guild_id = ? AND alias = ?', guildId, normalized.toUpperCase());
        if (aliasRow) {
            team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND team_name = ?', guildId, aliasRow.full_name);
        }
    }
    return team || null;
}

async function promptCaptainForInitialStadiumName(guild, team, captainId, channelId) {
    const db = (0, database_1.getDB)();
    const settings = await db.get('SELECT regteam_command_channel_id FROM guild_settings WHERE guild_id = ?', guild.id);
    let targetChannel = null;
    if (settings?.regteam_command_channel_id) {
        targetChannel = await guild.channels.fetch(settings.regteam_command_channel_id).catch(() => null);
    }
    if (!targetChannel || targetChannel.type !== discord_js_1.ChannelType.GuildText) {
        targetChannel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
    }
    if (!targetChannel || targetChannel.type !== discord_js_1.ChannelType.GuildText) {
        targetChannel = guild.systemChannel || null;
    }
    if (!targetChannel)
        return;
    const renameSettings = await getTeamRenameSettings(guild.id);
    const renamesOpen = renameSettings.enabled && renameSettings.limit !== 0;
    const lines = [
        `🏟️ <@${captainId}> your team **${team.team_name}** is registered.`
    ];
    if (renamesOpen) {
        lines.push('');
        lines.push('**Stadium Rename**');
        lines.push('Use this in the same channel:');
        lines.push('`?stadiumname <channel-name>`');
        lines.push('Example: `?stadiumname bavuma-arena`');
        lines.push(`Limit: **${renameSettings.limit}** renames`);
        if (renameSettings.expiresAt) {
            const expiryLabel = await formatTeamRenameExpiry(guild.id, renameSettings.expiresAt);
            if (expiryLabel)
                lines.push(`Expiry for both commands: **${expiryLabel}**`);
        }
        lines.push('');
        lines.push('**Team Rename**');
        lines.push('Use this format:');
        lines.push('`?teamrename New Team Name | ABBV`');
        lines.push('Example: `?teamrename Bavuma Blasters | BB`');
    }
    else {
        lines.push('');
        if (renameSettings.expired && renameSettings.expiresAt) {
            const expiryLabel = await formatTeamRenameExpiry(guild.id, renameSettings.expiresAt);
            lines.push(`Stadium and team renames closed automatically at **${expiryLabel}**.`);
        }
        else {
            lines.push('Stadium and team renames are currently locked by admins.');
        }
    }
    await targetChannel.send(lines.join('\n'));
}

async function ensureAuctionSetupRole(guild, guildId, team) {
    const db = (0, database_1.getDB)();
    let role = null;
    if (team.role_id) {
        role = await guild.roles.fetch(team.role_id).catch(() => null);
    }
    if (!role) {
        role = guild.roles.cache.find(r => r.name === team.team_name) || null;
    }
    let created = false;
    if (!role) {
        role = await guild.roles.create({
            name: team.team_name,
            colors: { primaryColor: 'Random' },
            permissions: [],
            mentionable: false,
            reason: 'Auction team setup'
        });
        created = true;
    }
    if (role && (role.mentionable || role.permissions?.bitfield !== 0n)) {
        role = await role.edit({
            permissions: [],
            mentionable: false,
            reason: 'Team roles are display-only'
        }).catch(() => role);
    }
    if (role && team.role_id !== role.id) {
        await db.run('UPDATE teams SET role_id = ? WHERE guild_id = ? AND team_id = ?', role.id, guildId, team.team_id);
        team.role_id = role.id;
    }
    return { role, created };
}

async function assignAuctionSetupRoleMembers(guild, guildId, team, role) {
    const db = (0, database_1.getDB)();
    const players = await db.all('SELECT discord_id FROM auction_players WHERE guild_id = ? AND sold_to_team_id = ?', guildId, team.team_id);
    const memberIds = [...new Set([team.owner_discord_id, ...players.map(row => row.discord_id)].filter(id => /^\d{15,21}$/.test(String(id || ''))))];
    let assigned = 0;
    let failed = 0;
    for (const memberId of memberIds) {
        const member = await guild.members.fetch(memberId).catch(() => null);
        if (!member) {
            failed++;
            continue;
        }
        if (member.roles.cache.has(role.id)) {
            continue;
        }
        try {
            await member.roles.add(role);
            assigned++;
        }
        catch (_a) {
            failed++;
        }
    }
    return { assigned, failed, totalTargets: memberIds.length };
}

async function syncAuctionTeamRoleForMember(guild, team, userId, mode) {
    if (!guild || !team?.role_id || !/^\d{15,21}$/.test(String(userId || '')))
        return false;
    const role = await guild.roles.fetch(team.role_id).catch(() => null);
    if (!role)
        return false;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member)
        return false;
    try {
        if (mode === 'add') {
            if (!member.roles.cache.has(role.id)) {
                await member.roles.add(role);
            }
        }
        else if (mode === 'remove') {
            if (member.roles.cache.has(role.id)) {
                await member.roles.remove(role);
            }
        }
        return true;
    }
    catch (_a) {
        return false;
    }
}

async function ensureAuctionSetupStadium(guild, guildId, team, role, categoryId) {
    const db = (0, database_1.getDB)();
    const stadiumRow = await db.get('SELECT channel_id FROM team_stadiums WHERE guild_id = ? AND team_id = ?', guildId, team.team_id);
    let channel = stadiumRow?.channel_id ? await guild.channels.fetch(stadiumRow.channel_id).catch(() => null) : null;
    let created = false;
    let moved = false;
    if (!channel || channel.type !== discord_js_1.ChannelType.GuildText) {
        const baseSlug = sanitizeChannelNameInput(`${team.team_name}-stadium`) || `team-${team.team_id}-stadium`;
        let channelName = baseSlug;
        let suffix = 1;
        while (guild.channels.cache.some(existing => existing.name === channelName)) {
            channelName = `${baseSlug}-${suffix++}`;
        }
        channel = await guild.channels.create({
            name: channelName,
            type: discord_js_1.ChannelType.GuildText,
            parent: categoryId,
            reason: `Auction team stadium for ${team.team_name}`
        });
        await channel.lockPermissions().catch(() => null);
        created = true;
    }
    else {
        const previousParentId = channel.parentId;
        if (previousParentId !== categoryId) {
            await channel.edit({ parent: categoryId }).catch(() => null);
            moved = true;
        }
        await channel.lockPermissions().catch(() => null);
    }
    await db.run('INSERT INTO team_stadiums (guild_id, team_id, channel_id) VALUES (?, ?, ?) ON CONFLICT(guild_id, team_id) DO UPDATE SET channel_id = excluded.channel_id', guildId, team.team_id, channel.id);
    return { channel, created, moved };
}
async function assignExistingStadiumToTeam(guild, guildId, team, targetChannelId, options = {}) {
    const db = (0, database_1.getDB)();
    const targetChannel = await guild.channels.fetch(targetChannelId).catch(() => null);
    if (!targetChannel || targetChannel.type !== discord_js_1.ChannelType.GuildText) {
        return { ok: false, reason: 'invalid_target' };
    }
    await db.run(`DELETE FROM team_stadiums
        WHERE guild_id = ?
          AND team_id NOT IN (SELECT team_id FROM teams WHERE guild_id = ?)`, guildId, guildId);
    const conflict = await db.get(`SELECT ts.team_id, t.team_name
        FROM team_stadiums ts
        JOIN teams t ON t.team_id = ts.team_id AND t.guild_id = ts.guild_id
        WHERE ts.guild_id = ? AND ts.channel_id = ? AND ts.team_id != ?`, guildId, targetChannel.id, team.team_id);
    const previousOwnerTeamId = conflict?.team_id || null;
    const previousOwnerTeamName = conflict?.team_name || null;
    const currentRow = await db.get('SELECT channel_id FROM team_stadiums WHERE guild_id = ? AND team_id = ?', guildId, team.team_id);
    const oldChannelId = currentRow?.channel_id || null;
    if (previousOwnerTeamId) {
        await db.run('DELETE FROM team_stadiums WHERE guild_id = ? AND team_id = ?', guildId, previousOwnerTeamId);
    }
    await db.run('INSERT INTO team_stadiums (guild_id, team_id, channel_id) VALUES (?, ?, ?) ON CONFLICT(guild_id, team_id) DO UPDATE SET channel_id = excluded.channel_id', guildId, team.team_id, targetChannel.id);
    const settings = await db.get('SELECT schedule_season FROM guild_settings WHERE guild_id = ?', guildId);
    const scheduleSeason = settings?.schedule_season || await statsSystem.getActiveSeason(guildId);
    let updatedFixtures = 0;
    let updatedReservations = 0;
    let previousOwnerFixturesCleared = 0;
    let previousOwnerReservationsCleared = 0;
    if (scheduleSeason) {
        const fixtureResult = await db.run(`UPDATE generated_fixtures
            SET stadium_id = ?
            WHERE guild_id = ? AND season_name = ? AND team_a_id = ? AND status = 'PENDING'`, targetChannel.id, guildId, scheduleSeason, team.team_id);
        updatedFixtures = fixtureResult?.changes || 0;

        // Fetch affected reservations to notify them
        const affectedRes = await db.all(`
            SELECT r.*, t1.team_name as t1name, t2.team_name as t2name, t1.role_id as t1role, t2.role_id as t2role
            FROM match_reservations r
            JOIN teams t1 ON r.team_a_id = t1.team_id
            JOIN teams t2 ON r.team_b_id = t2.team_id
            WHERE r.guild_id = ? AND r.season_name = ? AND r.team_a_id = ? AND r.status IN ('PENDING', 'OPEN', 'SCHEDULED')
        `, [guildId, scheduleSeason, team.team_id]);

        const reservationResult = await db.run(`UPDATE match_reservations
            SET stadium_channel_id = ?
            WHERE guild_id = ? AND season_name = ? AND team_a_id = ? AND status IN ('PENDING', 'OPEN', 'SCHEDULED')`, targetChannel.id, guildId, scheduleSeason, team.team_id);
        updatedReservations = reservationResult?.changes || 0;

        for (const res of affectedRes) {
            const p1 = res.t1role ? `<@&${res.t1role}>` : `**${res.t1name}**`;
            const p2 = res.t2role ? `<@&${res.t2role}>` : `**${res.t2name}**`;
            await targetChannel.send(`🏟️ **Stadium Updated:** The stadium for ${p1} vs ${p2} has been changed to this channel. Captains, please continue your scheduling here.`).catch(() => null);
        }

        if (previousOwnerTeamId) {
            const previousFixtureResult = await db.run(`UPDATE generated_fixtures
                SET stadium_id = NULL
                WHERE guild_id = ? AND season_name = ? AND team_a_id = ? AND stadium_id = ? AND status = 'PENDING'`, guildId, scheduleSeason, previousOwnerTeamId, targetChannel.id);
            previousOwnerFixturesCleared = previousFixtureResult?.changes || 0;
            const previousReservationResult = await db.run(`UPDATE match_reservations
                SET stadium_channel_id = NULL
                WHERE guild_id = ? AND season_name = ? AND team_a_id = ? AND stadium_channel_id = ? AND status IN ('PENDING', 'OPEN', 'SCHEDULED')`, guildId, scheduleSeason, previousOwnerTeamId, targetChannel.id);
            previousOwnerReservationsCleared = previousReservationResult?.changes || 0;
        }
    }
    let deletedOldChannel = false;
    let oldChannelDeleteFailed = false;
    let oldChannelMoved = false;
    let oldChannelMoveFailed = false;
    let oldChannelUnassigned = false;
    let oldChannelCategoryId = null;
    if (oldChannelId && oldChannelId !== targetChannel.id) {
        const oldChannel = await guild.channels.fetch(oldChannelId).catch(() => null);
        if (oldChannel) {
            if (options.deleteOldChannel === false) {
                oldChannelUnassigned = true;
                oldChannelCategoryId = options.unusedCategoryId || null;
                if (oldChannelCategoryId) {
                    try {
                        await oldChannel.edit({ parent: oldChannelCategoryId, reason: `Unused stadium kept after reassignment for ${team.team_name}` });
                        oldChannelMoved = true;
                    }
                    catch (_a) {
                        oldChannelMoveFailed = true;
                    }
                }
            }
            else {
                try {
                    await oldChannel.delete(`Stadium reassigned for ${team.team_name}`);
                    deletedOldChannel = true;
                }
                catch (_b) {
                    oldChannelDeleteFailed = true;
                }
            }
        }
    }
    return {
        ok: true,
        targetChannel,
        oldChannelId,
        oldChannelUnassigned,
        deletedOldChannel,
        oldChannelDeleteFailed,
        oldChannelMoved,
        oldChannelMoveFailed,
        oldChannelCategoryId,
        updatedFixtures,
        updatedReservations,
        previousOwnerTeamId,
        previousOwnerTeamName,
        previousOwnerFixturesCleared,
        previousOwnerReservationsCleared
    };
}

async function ensureAuctionSetupDressingRoom(guild, guildId, team, role, categoryId) {
    const db = (0, database_1.getDB)();
    const channelName = sanitizeChannelNameInput(team.team_name) || `team-${team.team_id}`;
    const permissionOverwrites = [
        {
            id: guild.id,
            deny: [discord_js_1.PermissionFlagsBits.ViewChannel]
        }
    ];
    if (/^\d{15,21}$/.test(String(team.owner_discord_id || ''))) {
        permissionOverwrites.push({
            id: team.owner_discord_id,
            allow: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.SendMessages]
        });
    }
    if (role) {
        permissionOverwrites.push({
            id: role.id,
            allow: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.SendMessages]
        });
    }
    else {
        const players = await db.all('SELECT discord_id FROM auction_players WHERE guild_id = ? AND sold_to_team_id = ?', guildId, team.team_id);
        for (const player of players) {
            if (!/^\d{15,21}$/.test(String(player.discord_id || '')))
                continue;
            permissionOverwrites.push({
                id: player.discord_id,
                allow: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.SendMessages]
            });
        }
    }
    let channel = guild.channels.cache.find(existing => existing.type === discord_js_1.ChannelType.GuildText && existing.name === channelName) || null;
    let created = false;
    let moved = false;
    if (!channel) {
        channel = await guild.channels.create({
            name: channelName,
            type: discord_js_1.ChannelType.GuildText,
            parent: categoryId,
            permissionOverwrites,
            reason: `Auction team dressing room for ${team.team_name}`
        });
        created = true;
    }
    else {
        const previousParentId = channel.parentId;
        await channel.permissionOverwrites.set(permissionOverwrites).catch(() => null);
        if (previousParentId !== categoryId) {
            await channel.edit({ parent: categoryId }).catch(() => null);
            moved = true;
        }
    }
    return { channel, created, moved };
}

async function getJoinRequestRoleAssignmentBlock(guild, member, role) {
    const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
    if (!botMember)
        return "I couldn't resolve my server member profile.";
    if (!botMember.permissions.has(discord_js_1.PermissionFlagsBits.ManageRoles))
        return 'I am missing the Manage Roles permission.';
    if (!role.editable)
        return `My highest role is below the team role ${role}. Move my bot role above it.`;
    if (!member.manageable)
        return `I cannot modify ${member.user.tag}. Their highest role is above or equal to my bot role.`;
    return null;
}

async function finalizeJoinRequestAction(message, requestId, action, responderId) {
    const db = (0, database_1.getDB)();
    const request = await db.get('SELECT * FROM team_join_requests WHERE id = ?', requestId);
    if (!request)
        return { success: false, message: `⚠️ Join request #${requestId} was not found.` };
    if (request.guild_id !== message.guild.id)
        return { success: false, message: `⚠️ Join request #${requestId} does not belong to this server.` };
    if (request.status !== 'PENDING')
        return { success: false, message: `⚠️ Join request #${requestId} is already ${request.status}.` };
    const team = await db.get('SELECT * FROM teams WHERE team_id = ?', request.team_id);
    if (!team) {
        await db.run('UPDATE team_join_requests SET status = "FAILED", responder_id = ?, responded_at = ? WHERE id = ?', responderId, Date.now(), requestId);
        return { success: false, message: `⚠️ Team linked to request #${requestId} no longer exists.` };
    }
    const now = Date.now();
    const applicantId = request.requester_id;
    const guildMember = await message.guild.members.fetch(applicantId).catch(() => null);
    const applicantUser = guildMember?.user || await message.client.users.fetch(applicantId).catch(() => null);
    if (action === 'APPROVE') {
        if (!guildMember) {
            await db.run('UPDATE team_join_requests SET status = "FAILED", responder_id = ?, responded_at = ? WHERE id = ?', responderId, now, requestId);
            return { success: false, message: `⚠️ Applicant already left the server. Request #${requestId} marked as failed.` };
        }
        const roleIds = guildMember.roles.cache.map(role => role.id).filter(Boolean);
        const existingMembership = await findExistingCommunityTeamMembership(message.guild.id, applicantId, roleIds, team.team_id);
        if (existingMembership) {
            return { success: false, message: `⚠️ Cannot approve request #${requestId} because the player is already on **${existingMembership.team.team_name}**. Ask them to leave that team first.` };
        }
        let assignmentNote = '';
        if (team.role_id) {
            const teamRole = await message.guild.roles.fetch(team.role_id).catch(() => null);
            if (teamRole) {
                if (guildMember.roles.cache.has(teamRole.id)) {
                    assignmentNote = `Member already had ${teamRole} role.`;
                }
                else {
                    const assignmentBlock = await getJoinRequestRoleAssignmentBlock(message.guild, guildMember, teamRole);
                    if (assignmentBlock) {
                        return { success: false, message: `⚠️ Cannot approve request #${requestId} until the team role can be assigned. ${assignmentBlock}` };
                    }
                    try {
                        await guildMember.roles.add(teamRole);
                        assignmentNote = `Role ${teamRole} assigned.`;
                    }
                    catch (err) {
                        return { success: false, message: `⚠️ Cannot approve request #${requestId} because assigning ${teamRole} failed: ${err.message}` };
                    }
                }
            }
            else {
                return { success: false, message: `⚠️ Cannot approve request #${requestId} because this team's role no longer exists in the server.` };
            }
        }
        else {
            return { success: false, message: `⚠️ Cannot approve request #${requestId} because this team has no Discord role configured yet.` };
        }
        await db.run('UPDATE team_join_requests SET status = "APPROVED", responder_id = ?, responded_at = ? WHERE id = ?', responderId, now, requestId);
        await sendCommunityRosterAuditLog(message.guild, responderId, guildMember, team, 'JOIN');
        if (applicantUser) {
            applicantUser.send(`🎉 Your request to join **${team.team_name}** in **${message.guild.name}** was accepted.\n${assignmentNote}`).catch(() => { });
        }
        return { success: true, message: `✅ Request #${requestId} approved. ${assignmentNote}` };
    }
    if (action === 'DECLINE') {
        await db.run('UPDATE team_join_requests SET status = "DECLINED", responder_id = ?, responded_at = ? WHERE id = ?', responderId, now, requestId);
        if (applicantUser) {
            applicantUser.send(`❌ Your request to join **${team.team_name}** in **${message.guild.name}** was declined.`).catch(() => { });
        }
        return { success: true, message: `❌ Request #${requestId} declined.` };
    }
    return { success: false, message: '⚠️ Invalid action.' };
}
async function finalizeJoinRequestActionWithGuildContext(guild, client, requestId, action, responderId) {
    return await finalizeJoinRequestAction({ guild, client }, requestId, action, responderId);
}
function buildJoinRequestCaptainDmEmbed(guildName, teamName, applicantMention, requestedAt, statusText = 'Pending', color = 0x1D9BF0) {
    return new discord_js_1.EmbedBuilder()
        .setTitle('Join Request')
        .setColor(color)
        .addFields({ name: 'Player', value: applicantMention, inline: true }, { name: 'Team', value: `**${teamName}**`, inline: true }, { name: 'Status', value: statusText, inline: true })
        .setFooter({ text: `${guildName} • Expires in 7 days` })
        .setTimestamp(new Date(requestedAt));
}
function buildJoinRequestCaptainDmButtons(requestId, disabled = false) {
    return new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder()
        .setCustomId(`joinreqdm_approve_${requestId}`)
        .setLabel('Approve')
        .setStyle(discord_js_1.ButtonStyle.Success)
        .setDisabled(disabled), new discord_js_1.ButtonBuilder()
        .setCustomId(`joinreqdm_reject_${requestId}`)
        .setLabel('Reject')
        .setStyle(discord_js_1.ButtonStyle.Danger)
        .setDisabled(disabled));
}
async function handleJoinRequestInteraction(interaction) {
    if (!interaction.isButton())
        return false;
    if (!interaction.customId.startsWith('joinreqdm_'))
        return false;
    const parts = interaction.customId.split('_');
    const actionToken = parts[1];
    const requestId = parseInt(parts[2], 10);
    if (!requestId || !['approve', 'reject'].includes(actionToken)) {
        await interaction.reply({ content: 'Invalid join request action.', flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => { });
        return true;
    }
    const db = (0, database_1.getDB)();
    const request = await db.get('SELECT * FROM team_join_requests WHERE id = ?', requestId);
    if (!request) {
        await interaction.update({ content: 'This join request no longer exists.', embeds: [], components: [] }).catch(() => { });
        return true;
    }
    const guild = await interaction.client.guilds.fetch(request.guild_id).catch(() => null);
    if (!guild) {
        await interaction.update({ content: 'The server for this join request is no longer available.', embeds: [], components: [] }).catch(() => { });
        return true;
    }
    const responderMember = await guild.members.fetch(interaction.user.id).catch(() => null);
    const captainRow = await db.get('SELECT captain_discord_id FROM team_captains WHERE guild_id = ? AND team_id = ?', request.guild_id, request.team_id);
    const isAuthorizedCaptain = captainRow?.captain_discord_id === interaction.user.id;
    const isAuthorizedAdmin = responderMember ? (0, utils_1.isAdmin)(responderMember) : false;
    if (!isAuthorizedCaptain && !isAuthorizedAdmin) {
        await interaction.reply({ content: 'Only the team captain or an admin can use these buttons.', flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => { });
        return true;
    }
    const team = await db.get('SELECT team_name FROM teams WHERE team_id = ?', request.team_id);
    const requestedAt = request.created_at || Date.now();
    if (Date.now() - requestedAt > JOIN_REQUEST_DM_TTL_MS && request.status === 'PENDING') {
        await db.run('UPDATE team_join_requests SET status = "EXPIRED", responded_at = ? WHERE id = ?', Date.now(), request.id);
        const expiredEmbed = buildJoinRequestCaptainDmEmbed(guild.name, team?.team_name || 'Unknown Team', `<@${request.requester_id}>`, requestedAt, 'Expired', 0x808080);
        await interaction.update({ embeds: [expiredEmbed], components: [buildJoinRequestCaptainDmButtons(request.id, true)] }).catch(() => { });
        return true;
    }
    if (request.status !== 'PENDING') {
        const statusText = request.status.charAt(0) + request.status.slice(1).toLowerCase();
        const staleEmbed = buildJoinRequestCaptainDmEmbed(guild.name, team?.team_name || 'Unknown Team', `<@${request.requester_id}>`, requestedAt, statusText, request.status === 'APPROVED' ? 0x2ECC71 : 0xE74C3C);
        await interaction.update({ embeds: [staleEmbed], components: [buildJoinRequestCaptainDmButtons(request.id, true)] }).catch(() => { });
        return true;
    }
    const action = actionToken === 'approve' ? 'APPROVE' : 'DECLINE';
    const result = await finalizeJoinRequestActionWithGuildContext(guild, interaction.client, request.id, action, interaction.user.id);
    const statusText = result.success ? (action === 'APPROVE' ? 'Approved' : 'Rejected') : 'Failed';
    const resultColor = action === 'APPROVE' && result.success ? 0x2ECC71 : (action === 'DECLINE' && result.success ? 0xE74C3C : 0xF39C12);
    const resultEmbed = buildJoinRequestCaptainDmEmbed(guild.name, team?.team_name || 'Unknown Team', `<@${request.requester_id}>`, requestedAt, statusText, resultColor)
        .addFields({ name: 'Result', value: result.message.slice(0, 1024), inline: false });
    await interaction.update({ embeds: [resultEmbed], components: [buildJoinRequestCaptainDmButtons(request.id, true)] }).catch(() => { });
    return true;
}
const discord_js_1 = require("discord.js");
const path = require("path");
const database_1 = require("./database");
const auditLog_1 = require("./auditLog");
const utils_1 = require("./utils");
const auctionManager_1 = require("./auctionManager");
const matchSystem_1 = require("./matchSystem");
const statsSystem = require("./statsSystem");
const { renderTotsImage } = require("./totsRenderer");
const { createCanvas, loadImage } = require('canvas');
const redTotsLayout = require("./redTotsLayout.json");

function getAlphabetRange(limit = 'A') {
    const upper = (limit || 'A').toUpperCase();
    const start = 'A'.charCodeAt(0);
    const end = upper.charCodeAt(0);
    const list = [];
    for (let c = start; c <= end; c++) {
        list.push(String.fromCharCode(c));
    }
    return list;
}

async function getPtConfig(guildId) {
    const db = (0, database_1.getDB)();
    let settings = await db.get('SELECT * FROM pt_settings WHERE guild_id = ?', guildId);
    if (!settings) {
        settings = { current_season: 1, layout_size: 6, format_type: 'LEAGUE', group_limit: 'A' };
    }
    if (!settings.format_type)
        settings.format_type = 'LEAGUE';
    if (!settings.group_limit)
        settings.group_limit = 'A';
    return settings;
}

async function setTeamGroup(guildId, seasonName, teamId, groupLetter) {
    const db = (0, database_1.getDB)();
    if (!teamId || !seasonName)
        return;
    const letter = (groupLetter || 'A').toUpperCase();
    await db.run('INSERT INTO team_groups (guild_id, season_name, team_id, group_letter) VALUES (?, ?, ?, ?) ON CONFLICT(guild_id, season_name, team_id) DO UPDATE SET group_letter = ?', guildId, seasonName, teamId, letter, letter);
}

async function getTeamGroupLetter(guildId, seasonName, teamId) {
    if (!teamId)
        return 'LEAGUE';
    const db = (0, database_1.getDB)();
    const row = await db.get('SELECT group_letter FROM team_groups WHERE guild_id = ? AND season_name = ? AND team_id = ?', guildId, seasonName, teamId);
    return row?.group_letter || 'LEAGUE';
}

function normalizeAlias(input, fallback = 'TEAM') {
    const cleaned = (input || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    return cleaned || fallback.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'TEAM';
}

function buildAutoThreeLetterAlias(input) {
    const tokens = String(input || '')
        .toUpperCase()
        .split(/[^A-Z0-9]+/)
        .map(token => token.trim())
        .filter(Boolean);
    if (tokens.length === 0) {
        return 'TEA';
    }
    if (tokens.length === 1) {
        return tokens[0].slice(0, 3);
    }
    if (tokens.length === 2) {
        if (tokens[0].length <= 2) {
            return (tokens[0] + tokens[1][0]).slice(0, 3);
        }
        return (tokens[0][0] + tokens[1].slice(0, 2)).slice(0, 3);
    }
    return tokens.slice(0, 3).map(token => token[0]).join('').slice(0, 3);
}

function formatSeasonLabel(seasonName) {
    const value = String(seasonName || '').trim();
    const match = value.match(/^s\s*(\d+)$/i);
    if (match) {
        return `Season ${parseInt(match[1], 10)}`;
    }
    return value;
}

async function transferCommunityCaptain(message, team, newCaptainMember) {
    const db = (0, database_1.getDB)();
    const guildId = message.guild.id;
    if (!team) {
        return { success: false, message: "Warning: Team not found. Mention the team role or include its name." };
    }
    if (team.purse_lakhs >= 0) {
        return { success: false, message: "Captain transfers only apply to non-auction/community teams." };
    }
    if (!newCaptainMember) {
        return { success: false, message: "Warning: Could not find that member in the server." };
    }
    if (newCaptainMember.user.bot) {
        return { success: false, message: "Warning: Bots cannot be captains." };
    }
    const currentCaptainRow = await db.get('SELECT captain_discord_id FROM team_captains WHERE guild_id = ? AND team_id = ?', guildId, team.team_id);
    if (currentCaptainRow?.captain_discord_id === newCaptainMember.id) {
        return { success: false, message: `Warning: ${newCaptainMember} is already the captain of **${team.team_name}**.` };
    }
    const newCaptainRoles = newCaptainMember.roles.cache.map(role => role.id).filter(Boolean);
    const membershipBlock = await findExistingCommunityTeamMembership(guildId, newCaptainMember.id, newCaptainRoles, team.team_id);
    if (membershipBlock && membershipBlock.team.team_id !== team.team_id) {
        return { success: false, message: `Warning: ${newCaptainMember} already belongs to **${membershipBlock.team.team_name}**. Ask them to leave that team first.` };
    }
    if (team.role_id) {
        const teamRole = await message.guild.roles.fetch(team.role_id).catch(() => null);
        if (teamRole && !newCaptainMember.roles.cache.has(teamRole.id)) {
            return { success: false, message: `Warning: ${newCaptainMember} must have ${teamRole} before becoming captain.` };
        }
    }
    const conflictingCaptain = await db.get(`SELECT t.team_name FROM team_captains tc
        JOIN teams t ON tc.team_id = t.team_id
        WHERE tc.guild_id = ? AND tc.captain_discord_id = ? AND tc.team_id != ?`, guildId, newCaptainMember.id, team.team_id);
    if (conflictingCaptain) {
        return { success: false, message: `Warning: ${newCaptainMember} is already captain of **${conflictingCaptain.team_name}**.` };
    }
    await db.run('INSERT INTO team_captains (guild_id, team_id, captain_discord_id) VALUES (?, ?, ?) ON CONFLICT(guild_id, team_id) DO UPDATE SET captain_discord_id = excluded.captain_discord_id', guildId, team.team_id, newCaptainMember.id);
    await db.run('DELETE FROM team_vice_captains WHERE guild_id = ? AND team_id = ? AND vice_captain_discord_id = ?', guildId, team.team_id, newCaptainMember.id);
    const lines = [`Done: Captainship for **${team.team_name}** has been transferred to ${newCaptainMember}.`];
    if (currentCaptainRow?.captain_discord_id && currentCaptainRow.captain_discord_id !== newCaptainMember.id) {
        lines.push(`Info: Previous captain <@${currentCaptainRow.captain_discord_id}> has been notified.`);
    }
    const dmText = `Captain Update: You are now the registered captain of **${team.team_name}** in **${message.guild.name}**.\nUse \`?joinrequests\` to review player requests and \`?stadiumname\` / \`?teamrename\` for stadium or name changes.`;
    newCaptainMember.send(dmText).catch(() => { });
    if (currentCaptainRow?.captain_discord_id && currentCaptainRow.captain_discord_id !== newCaptainMember.id) {
        const prevUser = await message.client.users.fetch(currentCaptainRow.captain_discord_id).catch(() => null);
        prevUser?.send(`Info: You are no longer the captain of **${team.team_name}** in **${message.guild.name}**.`).catch(() => { });
    }
    return { success: true, message: lines.join('\n') };
}

async function getTransferManagedTeams(guildId, userId) {
    const db = (0, database_1.getDB)();
    const ownedTeams = await db.all('SELECT * FROM teams WHERE guild_id = ? AND owner_discord_id = ?', guildId, userId);
    const captainedTeams = await db.all(`SELECT t.* FROM team_captains tc
        JOIN teams t ON tc.team_id = t.team_id
        WHERE tc.guild_id = ? AND tc.captain_discord_id = ?`, guildId, userId);
    const uniqueTeams = new Map();
    [...ownedTeams, ...captainedTeams].forEach(team => {
        if (team?.team_id) {
            uniqueTeams.set(team.team_id, team);
        }
    });
    return [...uniqueTeams.values()].sort((a, b) => a.team_name.localeCompare(b.team_name));
}

async function promptForAdminManagedTeamSelection(message, guildId, options = {}) {
    const db = (0, database_1.getDB)();
    const allTeams = await db.all('SELECT * FROM teams WHERE guild_id = ? ORDER BY team_name COLLATE NOCASE ASC', guildId);
    if (!allTeams.length) {
        return { ok: false, message: options.emptyMessage || "No teams are registered yet." };
    }
    const ptConfig = await getPtConfig(guildId);
    const seasonLabel = await statsSystem.getActiveSeason(guildId) || `S${ptConfig.current_season || 1}`;
    const formatType = ptConfig.format_type || 'LEAGUE';
    let filteredTeams = allTeams;
    if (formatType === 'GROUPS') {
        const groupRows = await db.all('SELECT team_id, group_letter FROM team_groups WHERE guild_id = ? AND season_name = ?', guildId, seasonLabel);
        const groupMap = new Map(groupRows.map(row => [row.team_id, (row.group_letter || 'UNASSIGNED').toUpperCase()]));
        const groupedTeams = new Map();
        allTeams.forEach(team => {
            const key = groupMap.get(team.team_id) || 'UNASSIGNED';
            if (!groupedTeams.has(key)) {
                groupedTeams.set(key, []);
            }
            groupedTeams.get(key).push(team);
        });
        const groupKeys = [...groupedTeams.keys()].filter(key => (groupedTeams.get(key) || []).length > 0).sort();
        if (groupKeys.length > 1) {
            const groupCustomId = `admin_team_group_select_${message.id}`;
            const groupOptions = groupKeys.map(key => ({
                label: key === 'UNASSIGNED' ? 'Unassigned' : `Group ${key}`,
                description: `${(groupedTeams.get(key) || []).length} team${(groupedTeams.get(key) || []).length === 1 ? '' : 's'}`,
                value: key
            })).slice(0, 25);
            const groupRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
                .setCustomId(groupCustomId)
                .setPlaceholder('Select group')
                .setMinValues(1)
                .setMaxValues(1)
                .addOptions(groupOptions));
            const groupPrompt = await message.reply({ content: options.groupPrompt || 'Select the group first.', components: [groupRow] });
            const groupSelection = await awaitComponent(groupPrompt, { filter: i => i.user.id === message.author.id && i.customId === groupCustomId, time: 60000 }, "âŒ Group selection timed out.", "âš ï¸ Failed to select a group.");
            if (!groupSelection) {
                return { ok: false, silent: true };
            }
            const selectedGroup = groupSelection.values[0];
            filteredTeams = groupedTeams.get(selectedGroup) || [];
            await groupSelection.update({
                content: `Selected **${selectedGroup === 'UNASSIGNED' ? 'Unassigned' : `Group ${selectedGroup}`}**. Now choose the team.`,
                components: []
            }).catch(() => null);
        }
    }
    if (!filteredTeams.length) {
        return { ok: false, message: options.emptyMessage || "No teams were found for that selection." };
    }
    const teamCustomId = `admin_team_select_${message.id}`;
    const teamOptions = filteredTeams.slice(0, 25).map(team => ({
        label: team.team_name.length > 100 ? `${team.team_name.slice(0, 97)}...` : team.team_name,
        description: team.role_id ? 'Team role linked' : 'No team role linked',
        value: String(team.team_id)
    }));
    const teamRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
        .setCustomId(teamCustomId)
        .setPlaceholder('Select team')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(teamOptions));
    let promptText = options.teamPrompt || 'Select the team to update.';
    if (filteredTeams.length > 25) {
        promptText += '\nShowing the first 25 teams due to Discord menu limits.';
    }
    const teamPrompt = await message.reply({ content: promptText, components: [teamRow] });
    const teamSelection = await awaitComponent(teamPrompt, { filter: i => i.user.id === message.author.id && i.customId === teamCustomId, time: 60000 }, "âŒ Team selection timed out.", "âš ï¸ Failed to select a team.");
    if (!teamSelection) {
        return { ok: false, silent: true };
    }
    const selectedTeam = filteredTeams.find(team => String(team.team_id) === teamSelection.values[0]);
    if (!selectedTeam) {
        await teamSelection.update({ content: 'âš ï¸ Selected team was not found.', components: [] }).catch(() => null);
        return { ok: false, silent: true };
    }
    await teamSelection.update({ content: `Selected **${selectedTeam.team_name}**.`, components: [] }).catch(() => null);
    return { ok: true, team: selectedTeam };
}

async function resolveManagedTeamForCaptainCommand(message, guildId, args, options = {}) {
    const isAdm = (0, utils_1.isAdmin)(message.member);
    const roleMention = message.mentions.roles.first();
    const explicitIds = options.explicitIds || [];
    const filteredArgs = (args || []).filter(token => {
        if (token.match(/^<@!?\d+>$/))
            return false;
        if (token.match(/^<@&\d+>$/))
            return false;
        if (explicitIds.includes(token))
            return false;
        return true;
    });
    let identifierText = filteredArgs.join(' ').trim();
    for (const explicitId of explicitIds) {
        if (identifierText.includes(explicitId)) {
            identifierText = identifierText.replace(new RegExp(explicitId, 'g'), '').trim();
        }
    }
    let requestedTeam = null;
    if (roleMention) {
        requestedTeam = await (0, database_1.getDB)().get('SELECT * FROM teams WHERE guild_id = ? AND role_id = ?', guildId, roleMention.id);
    }
    if (!requestedTeam && identifierText) {
        requestedTeam = await findTeamByIdentifier(guildId, identifierText);
    }
    const managedTeams = await getTransferManagedTeams(guildId, message.author.id);
    let team = null;
    if (isAdm) {
        if (requestedTeam) {
            team = requestedTeam;
        }
        else if (options.allowAdminTeamPrompt) {
            const selectedTeam = await promptForAdminManagedTeamSelection(message, guildId, {
                emptyMessage: options.adminEmptyMessage,
                groupPrompt: options.adminGroupPrompt,
                teamPrompt: options.adminTeamPrompt
            });
            if (!selectedTeam.ok) {
                return selectedTeam;
            }
            team = selectedTeam.team;
        }
        else {
            team = managedTeams.length === 1 ? managedTeams[0] : null;
        }
        if (!team) {
            if (managedTeams.length > 1) {
                return { ok: false, message: options.multiTeamMessage || "You manage multiple teams. Specify which team to update." };
            }
            return { ok: false, message: options.adminMessage || "Admins must specify which team to update unless they already manage exactly one team." };
        }
    }
    else {
        if (!managedTeams.length) {
            return { ok: false, message: options.nonManagerMessage || "Only admins or the current captain/owner can use this command." };
        }
        if (requestedTeam && !managedTeams.some(candidate => candidate.team_id === requestedTeam.team_id)) {
            return { ok: false, message: options.unauthorizedMessage || "You can only update your own team." };
        }
        if (requestedTeam) {
            team = requestedTeam;
        }
        else if (managedTeams.length === 1) {
            team = managedTeams[0];
        }
        else {
            return { ok: false, message: options.multiTeamMessage || "You manage multiple teams. Specify which team to update." };
        }
    }
    return { ok: true, team };
}

async function transferAuctionCaptain(message, team, newCaptainMember) {
    const db = (0, database_1.getDB)();
    const guildId = message.guild.id;
    if (!team) {
        return { success: false, message: "Team not found. Mention the team role or include its name." };
    }
    if (!newCaptainMember) {
        return { success: false, message: "Could not find that member in the server." };
    }
    if (newCaptainMember.user.bot) {
        return { success: false, message: "Bots cannot be captains." };
    }
    if (team.owner_discord_id === newCaptainMember.id) {
        return { success: false, message: `${newCaptainMember} is already the owner/captain of **${team.team_name}**.` };
    }
    const otherOwnedTeam = await db.get('SELECT * FROM teams WHERE guild_id = ? AND owner_discord_id = ? AND team_id != ?', guildId, newCaptainMember.id, team.team_id);
    if (otherOwnedTeam) {
        return { success: false, message: `${newCaptainMember} already owns **${otherOwnedTeam.team_name}**.` };
    }
    const previousOwnerId = team.owner_discord_id;
    await db.run('UPDATE teams SET owner_discord_id = ? WHERE guild_id = ? AND team_id = ?', newCaptainMember.id, guildId, team.team_id);
    await db.run('DELETE FROM team_vice_captains WHERE guild_id = ? AND team_id = ? AND vice_captain_discord_id = ?', guildId, team.team_id, newCaptainMember.id);
    const lines = [`Captainship for **${team.team_name}** has been transferred to ${newCaptainMember}.`];
    if (previousOwnerId && previousOwnerId !== newCaptainMember.id) {
        lines.push(`Previous owner <@${previousOwnerId}> has been notified.`);
    }
    newCaptainMember.send(`You are now the owner/captain of **${team.team_name}** in **${message.guild.name}**.`).catch(() => { });
    if (previousOwnerId && previousOwnerId !== newCaptainMember.id) {
        const prevUser = await message.client.users.fetch(previousOwnerId).catch(() => null);
        prevUser?.send(`You are no longer the owner/captain of **${team.team_name}** in **${message.guild.name}**.`).catch(() => { });
    }
    return { success: true, message: lines.join('\n') };
}

async function transferTeamCaptain(message, team, newCaptainMember) {
    if (team?.purse_lakhs >= 0) {
        return transferAuctionCaptain(message, team, newCaptainMember);
    }
    return transferCommunityCaptain(message, team, newCaptainMember);
}

async function getTeamAliasMaps(guildId) {
    const db = (0, database_1.getDB)();
    const aliasRows = await db.all('SELECT alias, full_name FROM pt_team_aliases WHERE guild_id = ?', guildId);
    return {
        aliasByName: new Map(aliasRows.map(row => [row.full_name.toLowerCase(), row.alias])),
        nameByAlias: new Map(aliasRows.map(row => [row.alias.toUpperCase(), row.full_name]))
    };
}

async function resolveTeamFromSearch(guildId, searchText, roleMention, nameByAlias) {
    const db = (0, database_1.getDB)();
    let team = null;
    let cleanedSearch = searchText || '';
    if (roleMention) {
        team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND role_id = ?', guildId, roleMention.id);
        cleanedSearch = cleanedSearch.replace(new RegExp(`<@&${roleMention.id}>`, 'g'), '').trim();
    }
    if (!team && cleanedSearch) {
        const normalized = cleanedSearch.toLowerCase();
        team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND LOWER(team_name) = ?', guildId, normalized);
        if (!team) {
            team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND team_name LIKE ?', guildId, `%${cleanedSearch}%`);
        }
        if (!team) {
            const aliasMatch = nameByAlias.get(normalized.toUpperCase());
            if (aliasMatch) {
                team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND team_name = ?', guildId, aliasMatch);
            }
        }
    }
    return team || null;
}

async function resolveOwnTeamForMember(message, guildId) {
    const db = (0, database_1.getDB)();
    let team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND owner_discord_id = ?', guildId, message.author.id);
    if (team) {
        return { team, ambiguousTeams: [] };
    }
    team = await db.get(`SELECT t.* FROM team_captains tc
        JOIN teams t ON tc.team_id = t.team_id
        WHERE tc.guild_id = ? AND tc.captain_discord_id = ?`, guildId, message.author.id);
    if (team) {
        return { team, ambiguousTeams: [] };
    }
    if (!message.member) {
        return { team: null, ambiguousTeams: [] };
    }
    const roleIds = message.member.roles.cache.map(role => role.id).filter(Boolean);
    if (!roleIds.length) {
        return { team: null, ambiguousTeams: [] };
    }
    const placeholders = roleIds.map(() => '?').join(',');
    const teams = await db.all(`SELECT * FROM teams WHERE guild_id = ? AND role_id IN (${placeholders}) ORDER BY team_name ASC`, guildId, ...roleIds);
    if (teams.length === 1) {
        return { team: teams[0], ambiguousTeams: [] };
    }
    if (teams.length > 1) {
        return { team: null, ambiguousTeams: teams };
    }
    return { team: null, ambiguousTeams: [] };
}

async function buildTeamDetailEmbed(message, guildId, team, aliasByName) {
    const db = (0, database_1.getDB)();
        return;
        return;
        const embed = await buildTeamDetailEmbed(message, guildId, team, aliasByName);
        await message.reply({ embeds: [embed] });
        return;
        const aliasValue = aliasByName.get(team.team_name.toLowerCase()) || '-';
    const aliasDisplay = aliasByName.get(team.team_name.toLowerCase()) || '-';
    const captainRow = await db.get('SELECT captain_discord_id FROM team_captains WHERE guild_id = ? AND team_id = ?', guildId, team.team_id);
    const stadiumRow = await db.get('SELECT channel_id FROM team_stadiums WHERE guild_id = ? AND team_id = ?', guildId, team.team_id);
    const ptConfig = await getPtConfig(guildId);
    const seasonLabel = await statsSystem.getActiveSeason(guildId) || `S${ptConfig.current_season || 1}`;
    const groupLetter = await getTeamGroupLetter(guildId, seasonLabel, team.team_id);
    const rosterMap = new Map();
    const addRosterEntry = (id, label) => {
        if (!id)
            return;
        const normalized = id.toString();
        if (!rosterMap.has(normalized)) {
            rosterMap.set(normalized, { id: normalized, tags: new Set(), label: label || `<@${normalized}>` });
        }
        else if (label) {
            rosterMap.get(normalized).label = label;
        }
        return rosterMap.get(normalized);
    };
    let role = null;
    if (team.role_id) {
        role = await message.guild.roles.fetch(team.role_id).catch(() => null);
        if (role) {
            await message.guild.members.fetch().catch(() => null);
            role.members.forEach(member => {
                const entry = addRosterEntry(member.id, `<@${member.id}>`);
                entry?.tags.add('Role');
            });
        }
    }
    const approvedRequests = await db.all('SELECT requester_id FROM team_join_requests WHERE guild_id = ? AND team_id = ? AND status = "APPROVED"', guildId, team.team_id);
    for (const row of approvedRequests) {
        const entry = addRosterEntry(row.requester_id, `<@${row.requester_id}>`);
        entry?.tags.add('Member');
    }
    if (team.purse_lakhs >= 0) {
        const playerRows = await db.all('SELECT discord_id, ign FROM auction_players WHERE guild_id = ? AND sold_to_team_id = ?', guildId, team.team_id);
        for (const row of playerRows) {
            if (!row?.discord_id)
                continue;
            const entry = addRosterEntry(row.discord_id, `<@${row.discord_id}>`);
            if (entry)
                entry.tags.add('Player');
        }
    }
    if (captainRow?.captain_discord_id) {
        const entry = addRosterEntry(captainRow.captain_discord_id, `<@${captainRow.captain_discord_id}>`);
        entry?.tags.add('Captain');
    }
    const sortedRoster = [...rosterMap.values()].sort((a, b) => {
        const aRank = a.tags.has('Captain') ? 0 : 1;
        const bRank = b.tags.has('Captain') ? 0 : 1;
        if (aRank !== bRank)
            return aRank - bRank;
        return (a.label || '').localeCompare(b.label || '');
    });
    const rosterEntries = sortedRoster.map((entry, index) => {
        const position = index + 1;
        const suffix = entry.tags.has('Captain') ? '  [Captain]' : '';
        return `${position}. ${entry.label}${suffix}`;
    });
    const rosterCount = rosterEntries.length;
    const captainText = captainRow?.captain_discord_id ? `<@${captainRow.captain_discord_id}>` : 'Not set';
    const stadiumText = stadiumRow?.channel_id ? `<#${stadiumRow.channel_id}>` : 'Not set';
    const roleText = team.role_id ? `<@&${team.role_id}>` : 'Not assigned';
    const groupText = (ptConfig.format_type || 'LEAGUE') === 'GROUPS'
        ? `Group ${groupLetter || 'A'}`
        : 'League';
    const rosterFieldValue = (() => {
        if (!rosterEntries.length)
            return 'No members yet.';
        const maxLines = 25;
        const lines = rosterEntries.slice(0, maxLines);
        if (rosterEntries.length > maxLines) {
            lines.push(`... +${rosterEntries.length - maxLines} more`);
        }
        return lines.join('\n').slice(0, 1024);
    })();
    const rosterCapacityText = team.max_roster_size ? `${rosterCount}/${team.max_roster_size}` : `${rosterCount}`;
    const rosterFieldLabel = team.max_roster_size ? `Roster Members (${rosterCapacityText})` : 'Roster Members';
    return new discord_js_1.EmbedBuilder()
        .setTitle(`${team.team_name} - Team Details`)
        .setColor(0x0099FF)
        .addFields({ name: 'Abbreviation', value: `\`${aliasDisplay}\``, inline: true }, { name: 'Captain', value: captainText, inline: true }, { name: 'Team Role', value: roleText, inline: true }, { name: 'Group', value: groupText, inline: true }, { name: 'Stadium', value: stadiumText, inline: true }, { name: rosterFieldLabel, value: rosterFieldValue });
}

function summarizeRecentTeamMatches(matches, teamName, aliasByName) {
    if (!matches.length) {
        return {
            lines: ['No recent point-table matches found.'],
            form: 'N/A'
        };
    }
    const form = [];
    const lines = matches.map((matchRow, index) => {
        const isTeamA = matchRow.team_a === teamName;
        const opponentName = isTeamA ? matchRow.team_b : matchRow.team_a;
        const opponentAlias = aliasByName.get(opponentName.toLowerCase()) || opponentName;
        const ownScore = `${isTeamA ? matchRow.score_a_runs : matchRow.score_b_runs}/${isTeamA ? matchRow.score_a_wickets : matchRow.score_b_wickets}`;
        const oppScore = `${isTeamA ? matchRow.score_b_runs : matchRow.score_a_runs}/${isTeamA ? matchRow.score_b_wickets : matchRow.score_a_wickets}`;
        let resultMarker = 'D';
        if (matchRow.winner === teamName) {
            resultMarker = 'W';
        }
        else if (matchRow.winner && matchRow.winner !== 'Draw') {
            resultMarker = 'L';
        }
        form.push(resultMarker);
        return `${index + 1}. **${resultMarker}** vs \`${opponentAlias}\` (${ownScore} - ${oppScore})`;
    });
    return {
        lines,
        form: form.join(' • ')
    };
}

async function buildTeamDetailEmbedSafe(message, guildId, team, aliasByName, options = {}) {
    const db = (0, database_1.getDB)();
    const thumbnailMode = options.thumbnailMode || 'captain';
    const aliasDisplay = aliasByName.get(team.team_name.toLowerCase()) || '-';
    const captainRow = await db.get('SELECT captain_discord_id FROM team_captains WHERE guild_id = ? AND team_id = ?', guildId, team.team_id);
    const captainId = captainRow?.captain_discord_id || (team.purse_lakhs >= 0 && isDiscordUserIdToken(team.owner_discord_id) ? team.owner_discord_id : null);
    const viceCaptainRow = await db.get('SELECT vice_captain_discord_id FROM team_vice_captains WHERE guild_id = ? AND team_id = ?', guildId, team.team_id);
    const viceCaptainId = viceCaptainRow?.vice_captain_discord_id || null;
    const stadiumRow = await db.get('SELECT channel_id FROM team_stadiums WHERE guild_id = ? AND team_id = ?', guildId, team.team_id);
    const ptConfig = await getPtConfig(guildId);
    const seasonLabel = await statsSystem.getActiveSeason(guildId) || `S${ptConfig.current_season || 1}`;
    const groupLetter = await getTeamGroupLetter(guildId, seasonLabel, team.team_id);
    const rosterMap = new Map();
    const addRosterEntry = (id, label) => {
        if (!id)
            return;
        const normalized = id.toString();
        if (!rosterMap.has(normalized)) {
            rosterMap.set(normalized, { id: normalized, tags: new Set(), label: label || `<@${normalized}>` });
        }
        else if (label) {
            rosterMap.get(normalized).label = label;
        }
        return rosterMap.get(normalized);
    };
    let role = null;
    if (team.role_id) {
        role = await message.guild.roles.fetch(team.role_id).catch(() => null);
        if (role) {
            await message.guild.members.fetch().catch(() => null);
            role.members.forEach(member => {
                const entry = addRosterEntry(member.id, `<@${member.id}>`);
                entry?.tags.add('Role');
            });
        }
    }
    const approvedRequests = await db.all('SELECT requester_id FROM team_join_requests WHERE guild_id = ? AND team_id = ? AND status = "APPROVED"', guildId, team.team_id);
    for (const row of approvedRequests) {
        const entry = addRosterEntry(row.requester_id, `<@${row.requester_id}>`);
        entry?.tags.add('Member');
    }
    if (team.purse_lakhs >= 0) {
        const playerRows = await db.all('SELECT discord_id, ign FROM auction_players WHERE guild_id = ? AND sold_to_team_id = ?', guildId, team.team_id);
        for (const row of playerRows) {
            if (!row?.discord_id)
                continue;
            const entry = addRosterEntry(row.discord_id, `<@${row.discord_id}>`);
            if (entry)
                entry.tags.add('Player');
        }
    }
    if (captainId) {
        const entry = addRosterEntry(captainId, `<@${captainId}>`);
        entry?.tags.add('Captain');
    }
    if (viceCaptainId) {
        const entry = addRosterEntry(viceCaptainId, `<@${viceCaptainId}>`);
        entry?.tags.add('Vice');
    }
    const sortedRoster = [...rosterMap.values()].sort((a, b) => {
        const aRank = a.tags.has('Captain') ? 0 : (a.tags.has('Vice') ? 1 : 2);
        const bRank = b.tags.has('Captain') ? 0 : (b.tags.has('Vice') ? 1 : 2);
        if (aRank !== bRank)
            return aRank - bRank;
        return (a.label || '').localeCompare(b.label || '');
    });
    const rosterEntries = sortedRoster.map((entry, index) => {
        const position = index + 1;
        let suffix = '';
        if (entry.tags.has('Captain')) {
            suffix = ' (Captain)';
        }
        else if (entry.tags.has('Vice')) {
            suffix = ' (Vice-Captain)';
        }
        return `${position}. ${entry.label}${suffix}`;
    });
    const rosterCount = rosterEntries.length;
    const captainText = captainId ? `<@${captainId}>` : 'Not set';
    const viceCaptainText = viceCaptainId ? `<@${viceCaptainId}>` : 'Not set';
    const stadiumText = stadiumRow?.channel_id ? `<#${stadiumRow.channel_id}>` : 'Not set';
    const roleText = team.role_id ? `<@&${team.role_id}>` : 'Not assigned';
    const groupText = (ptConfig.format_type || 'LEAGUE') === 'GROUPS' ? `Group ${groupLetter || 'A'}` : 'League';
    const rosterFieldValue = (() => {
        if (!rosterEntries.length)
            return 'No members yet.';
        const maxLines = 15;
        const lines = rosterEntries.slice(0, maxLines);
        if (rosterEntries.length > maxLines) {
            lines.push(`... +${rosterEntries.length - maxLines} more`);
        }
        return lines.join('\n').slice(0, 1024);
    })();
    const rosterCapacityText = team.max_roster_size ? `${rosterCount}/${team.max_roster_size}` : `${rosterCount}`;
    const rosterFieldLabel = team.max_roster_size ? `Roster (${rosterCapacityText})` : 'Roster';

    const allSeasonMatches = await db.all(`SELECT *
        FROM pt_matches
        WHERE guild_id = ? AND season = ? AND (team_a = ? OR team_b = ?)
        ORDER BY timestamp DESC`, guildId, ptConfig.current_season || 1, team.team_name, team.team_name);
    let played = 0;
    let won = 0;
    let lost = 0;
    let drawn = 0;
    let points = 0;
    for (const matchRow of allSeasonMatches) {
        played++;
        if (matchRow.winner === team.team_name) {
            won++;
            points += 2;
        }
        else if (matchRow.winner === 'Draw') {
            drawn++;
            points += 1;
        }
        else if (matchRow.winner) {
            lost++;
        }
    }
    const standingsTeams = (ptConfig.format_type || 'LEAGUE') === 'GROUPS'
        ? await db.all(`SELECT t.team_name
            FROM teams t
            JOIN team_groups tg ON tg.team_id = t.team_id
            WHERE t.guild_id = ? AND tg.season_name = ? AND tg.group_letter = ?
            ORDER BY t.team_name COLLATE NOCASE`, guildId, seasonLabel, groupLetter || 'A')
        : await db.all('SELECT team_name FROM teams WHERE guild_id = ? ORDER BY team_name COLLATE NOCASE', guildId);
    const standingsMap = new Map();
    for (const row of standingsTeams) {
        standingsMap.set(row.team_name, { played: 0, won: 0, lost: 0, points: 0 });
    }
    for (const matchRow of allSeasonMatches) {
        if (!standingsMap.has(matchRow.team_a)) {
            standingsMap.set(matchRow.team_a, { played: 0, won: 0, lost: 0, points: 0 });
        }
        if (!standingsMap.has(matchRow.team_b)) {
            standingsMap.set(matchRow.team_b, { played: 0, won: 0, lost: 0, points: 0 });
        }
        const teamAStats = standingsMap.get(matchRow.team_a);
        const teamBStats = standingsMap.get(matchRow.team_b);
        teamAStats.played += 1;
        teamBStats.played += 1;
        if (matchRow.winner === matchRow.team_a) {
            teamAStats.won += 1;
            teamAStats.points += 2;
            teamBStats.lost += 1;
        }
        else if (matchRow.winner === matchRow.team_b) {
            teamBStats.won += 1;
            teamBStats.points += 2;
            teamAStats.lost += 1;
        }
        else {
            teamAStats.points += 1;
            teamBStats.points += 1;
        }
    }
    const standings = [...standingsMap.entries()]
        .map(([teamName, stats]) => ({ teamName, ...stats }))
        .sort((a, b) => b.points - a.points || b.won - a.won || a.teamName.localeCompare(b.teamName));
    const rankIndex = standings.findIndex(row => row.teamName === team.team_name);
    const rankLabel = (ptConfig.format_type || 'LEAGUE') === 'GROUPS'
        ? `Group ${groupLetter || 'A'} Rank`
        : 'Rank';
    const rankText = rankIndex >= 0 ? `**#${rankIndex + 1}** / **${standings.length}**` : 'Not ranked';
    const recentSummary = summarizeRecentTeamMatches(allSeasonMatches.slice(0, 5), team.team_name, aliasByName);
    const recordText = `P: **${played}** | W: **${won}** | L: **${lost}** | Pts: **${points}**\n${rankLabel}: ${rankText}\nForm: ${recentSummary.form}`;

    const recentMatchesValue = recentSummary.lines.join('\n').slice(0, 1024);
    const roleColor = role?.color && role.color !== 0 ? role.color : 0x0F6CBD;
    const roleIconUrl = role?.iconURL ? role.iconURL({ size: 256 }) : null;
    const captainMember = captainId ? await message.guild.members.fetch(captainId).catch(() => null) : null;
    const captainUser = captainMember?.user || (captainId ? await message.client.users.fetch(captainId).catch(() => null) : null);
    const captainAvatarUrl = captainMember?.displayAvatarURL({ extension: 'png', size: 256 })
        || captainUser?.displayAvatarURL?.({ extension: 'png', size: 256 })
        || null;
    const viewerMember = thumbnailMode === 'viewer' && rosterMap.has(message.author.id)
        ? (message.member?.id === message.author.id ? message.member : await message.guild.members.fetch(message.author.id).catch(() => null))
        : null;
    const viewerAvatarUrl = viewerMember?.displayAvatarURL?.({ extension: 'png', size: 256 }) || null;
    const logoUrl = thumbnailMode === 'viewer'
        ? (viewerAvatarUrl || captainAvatarUrl || roleIconUrl || null)
        : (captainAvatarUrl || roleIconUrl || null);
    const roleEmoji = role?.unicodeEmoji ? `${role.unicodeEmoji} ` : '';

    const embed = new discord_js_1.EmbedBuilder()
        .setTitle(`${roleEmoji}${team.team_name} Profile`)
        .setColor(roleColor)
        .setDescription(`Season: **${seasonLabel}**${groupText ? ` | ${groupText}` : ''}`)
        .addFields(
            { name: 'Aliases', value: `\`${aliasDisplay}\``, inline: true },
            { name: team.purse_lakhs >= 0 ? 'Owner / Captain' : 'Captain', value: captainText, inline: true },
            { name: 'Vice-Captain', value: viceCaptainText, inline: true },
            { name: 'Stadium', value: stadiumText, inline: true },
            { name: 'Team Role', value: roleText, inline: true },
            { name: 'Record', value: recordText, inline: false },
            { name: 'Recent Matches', value: recentMatchesValue, inline: false },
            { name: rosterFieldLabel, value: rosterFieldValue, inline: false }
        );
    if (logoUrl) {
        embed.setThumbnail(logoUrl);
    }
    return embed;
}

async function buildTeamStatsEmbedsSafe(message, guildId, team, aliasByName, options = {}) {
    const db = (0, database_1.getDB)();
    const thumbnailMode = options.thumbnailMode || 'captain';
    const aliasDisplay = aliasByName.get(team.team_name.toLowerCase()) || '-';
    const captainRow = await db.get('SELECT captain_discord_id FROM team_captains WHERE guild_id = ? AND team_id = ?', guildId, team.team_id);
    const captainId = captainRow?.captain_discord_id || (team.purse_lakhs >= 0 && isDiscordUserIdToken(team.owner_discord_id) ? team.owner_discord_id : null);
    const viceCaptainRow = await db.get('SELECT vice_captain_discord_id FROM team_vice_captains WHERE guild_id = ? AND team_id = ?', guildId, team.team_id);
    const viceCaptainId = viceCaptainRow?.vice_captain_discord_id || null;
    const ptConfig = await getPtConfig(guildId);
    const seasonLabel = await statsSystem.getActiveSeason(guildId) || `S${ptConfig.current_season || 1}`;
    const groupLetter = await getTeamGroupLetter(guildId, seasonLabel, team.team_id);
    const rosterMap = new Map();
    const addRosterEntry = (id, label) => {
        if (!id)
            return;
        const normalized = id.toString();
        if (!rosterMap.has(normalized)) {
            rosterMap.set(normalized, { id: normalized, label: label || normalized, tags: new Set() });
        }
        else if (label) {
            rosterMap.get(normalized).label = label;
        }
        return rosterMap.get(normalized);
    };
    const resolveStatsLabel = async (userId, fallback = null) => {
        if (!userId)
            return fallback || 'Unknown User';
        const guildMember = message.guild.members.cache.get(String(userId)) || await message.guild.members.fetch(String(userId)).catch(() => null);
        const username = guildMember?.user?.username
            || (await message.client.users.fetch(String(userId)).catch(() => null))?.username
            || fallback
            || String(userId);
        return discord_js_1.escapeMarkdown(username);
    };
    await message.guild.members.fetch().catch(() => null);
    let role = null;
    if (team.role_id) {
        role = await message.guild.roles.fetch(team.role_id).catch(() => null);
        if (role) {
            role.members.forEach(member => {
                const entry = addRosterEntry(member.id, member.user.username || member.id);
                entry?.tags.add('Role');
            });
        }
    }
    const approvedRequests = await db.all('SELECT requester_id FROM team_join_requests WHERE guild_id = ? AND team_id = ? AND status = "APPROVED"', guildId, team.team_id);
    for (const row of approvedRequests) {
        const label = await resolveStatsLabel(row?.requester_id);
        const entry = addRosterEntry(row.requester_id, label);
        entry?.tags.add('Member');
    }
    if (team.purse_lakhs >= 0) {
        const playerRows = await db.all('SELECT discord_id, ign FROM auction_players WHERE guild_id = ? AND sold_to_team_id = ?', guildId, team.team_id);
        for (const row of playerRows) {
            if (!row?.discord_id)
                continue;
            const label = await resolveStatsLabel(row.discord_id, row.ign || null);
            const entry = addRosterEntry(row.discord_id, label);
            entry?.tags.add('Player');
        }
    }
    if (captainId) {
        const entry = addRosterEntry(captainId, await resolveStatsLabel(captainId));
        entry?.tags.add('Captain');
    }
    if (viceCaptainId) {
        const entry = addRosterEntry(viceCaptainId, await resolveStatsLabel(viceCaptainId));
        entry?.tags.add('Vice');
    }
    const rosterIds = [...rosterMap.keys()];
    let statsRows = [];
    if (rosterIds.length > 0) {
        const placeholders = rosterIds.map(() => '?').join(', ');
        statsRows = await db.all(`SELECT * FROM stats_players WHERE guild_id = ? AND season_name = ? AND user_id IN (${placeholders})`, guildId, seasonLabel, ...rosterIds);
    }
    const statsByUser = new Map(statsRows.map(row => [String(row.user_id), row]));
    const playerStats = rosterIds.map(userId => {
        const rosterEntry = rosterMap.get(userId);
        const stats = statsByUser.get(userId) || {};
        const runs = Number(stats.runs || 0);
        const wickets = Number(stats.wickets || 0);
        const runsConceded = Number(stats.runs_conceded || 0);
        const battingAverage = statsSystem.calculateBattingAverage(stats);
        const bowlingAverage = wickets > 0 ? runsConceded / wickets : null;
        const totalMvp = Number(stats.total_mvp || 0);
        return {
            userId,
            label: rosterEntry?.label || userId,
            runs,
            wickets,
            battingAverage,
            bowlingAverage,
            totalMvp
        };
    }).sort((a, b) => {
        if (b.totalMvp !== a.totalMvp)
            return b.totalMvp - a.totalMvp;
        if (b.runs !== a.runs)
            return b.runs - a.runs;
        if (b.wickets !== a.wickets)
            return b.wickets - a.wickets;
        const aBowl = a.bowlingAverage == null ? Number.POSITIVE_INFINITY : a.bowlingAverage;
        const bBowl = b.bowlingAverage == null ? Number.POSITIVE_INFINITY : b.bowlingAverage;
        if (aBowl !== bBowl)
            return aBowl - bBowl;
        return a.label.localeCompare(b.label);
    });
    const lines = playerStats.length
        ? playerStats.map((player, index) => {
            const battingAverage = player.runs > 0 || player.battingAverage > 0 ? player.battingAverage.toFixed(2) : '-';
            const bowlingAverage = player.bowlingAverage == null ? '-' : player.bowlingAverage.toFixed(2);
            return `${index + 1}. **${player.label}** | MVP: **${player.totalMvp.toFixed(2)}**\nBatting: Runs **${player.runs}** | Bat Avg **${battingAverage}**\nBowling: Wkts **${player.wickets}** | Bowl Avg **${bowlingAverage}**`;
        })
        : ['No player stats recorded for this team yet.'];
    const pages = [];
    for (let index = 0; index < lines.length; index += 6) {
        pages.push(lines.slice(index, index + 6));
    }
    if (!pages.length) {
        pages.push(['No player stats recorded for this team yet.']);
    }
    const roleColor = role?.color && role.color !== 0 ? role.color : 0x0F6CBD;
    const roleIconUrl = role?.iconURL ? role.iconURL({ size: 256 }) : null;
    const captainMember = captainId ? await message.guild.members.fetch(captainId).catch(() => null) : null;
    const captainUser = captainMember?.user || (captainId ? await message.client.users.fetch(captainId).catch(() => null) : null);
    const captainAvatarUrl = captainMember?.displayAvatarURL({ extension: 'png', size: 256 })
        || captainUser?.displayAvatarURL?.({ extension: 'png', size: 256 })
        || null;
    const viewerMember = thumbnailMode === 'viewer' && rosterMap.has(message.author.id)
        ? (message.member?.id === message.author.id ? message.member : await message.guild.members.fetch(message.author.id).catch(() => null))
        : null;
    const viewerAvatarUrl = viewerMember?.displayAvatarURL?.({ extension: 'png', size: 256 }) || null;
    const logoUrl = thumbnailMode === 'viewer'
        ? (viewerAvatarUrl || captainAvatarUrl || roleIconUrl || null)
        : (captainAvatarUrl || roleIconUrl || null);
    const groupText = (ptConfig.format_type || 'LEAGUE') === 'GROUPS' ? ` | Group ${groupLetter || 'A'}` : '';
    return pages.map((pageLines, pageIndex) => {
        const pageSuffix = pages.length > 1 ? ` (${pageIndex + 1}/${pages.length})` : '';
        const embed = new discord_js_1.EmbedBuilder()
            .setTitle(`${team.team_name} Player Stats${pageSuffix}`)
            .setColor(roleColor)
            .setDescription(`Season: **${seasonLabel}**${groupText}\nAlias: \`${aliasDisplay}\`\nOrdered best to worst by MVP score.`)
            .addFields({
            name: 'Player Stats',
            value: pageLines.join('\n\n').slice(0, 1024),
            inline: false
        });
        if (logoUrl) {
            embed.setThumbnail(logoUrl);
        }
        return embed;
    });
}

function buildTeamProfilePageRow(baseId, currentPage, totalPages) {
    const buttons = [];
    if (currentPage !== 0) {
        buttons.push(new discord_js_1.ButtonBuilder()
            .setCustomId(`team_profile_detail_${baseId}`)
            .setLabel('Team Details')
            .setStyle(discord_js_1.ButtonStyle.Primary));
    }
    if (currentPage === 0) {
        buttons.push(new discord_js_1.ButtonBuilder()
            .setCustomId(`team_profile_stats_1_${baseId}`)
            .setLabel('Performance')
            .setStyle(discord_js_1.ButtonStyle.Primary));
    }
    else {
        if (currentPage > 1) {
            buttons.push(new discord_js_1.ButtonBuilder()
                .setCustomId(`team_profile_stats_${currentPage - 1}_${baseId}`)
                .setLabel('Previous')
                .setStyle(discord_js_1.ButtonStyle.Secondary));
        }
        if (currentPage < totalPages - 1) {
            buttons.push(new discord_js_1.ButtonBuilder()
                .setCustomId(`team_profile_stats_${currentPage + 1}_${baseId}`)
                .setLabel('Next')
                .setStyle(discord_js_1.ButtonStyle.Secondary));
        }
    }
    return new discord_js_1.ActionRowBuilder().addComponents(buttons);
}

function buildDisabledTeamProfilePageRow(baseId, currentPage, totalPages) {
    const row = buildTeamProfilePageRow(baseId, currentPage, totalPages);
    row.components.forEach(component => component.setDisabled(true).setStyle(discord_js_1.ButtonStyle.Secondary));
    return row;
}

async function sendPagedTeamProfile(message, guildId, team, aliasByName, options = {}) {
    const detailEmbed = await buildTeamDetailEmbedSafe(message, guildId, team, aliasByName, options);
    const statsEmbeds = await buildTeamStatsEmbedsSafe(message, guildId, team, aliasByName, options);
    const pages = [detailEmbed, ...statsEmbeds];
    const baseId = `${team.team_id}_${message.author.id}_${Date.now()}`;
    const initialRow = buildTeamProfilePageRow(baseId, 0, pages.length);
    const sentMessage = options.interaction
        ? await options.interaction.editReply({ content: null, embeds: [detailEmbed], components: [initialRow] }).catch(() => null)
        : await message.reply({ embeds: [detailEmbed], components: [initialRow] }).catch(() => null);
    if (!sentMessage || typeof sentMessage.createMessageComponentCollector !== 'function') {
        return sentMessage;
    }
    let currentPage = 0;
    const collector = sentMessage.createMessageComponentCollector({
        filter: interaction => interaction.user.id === message.author.id
            && (interaction.customId === `team_profile_detail_${baseId}`
                || interaction.customId.startsWith(`team_profile_stats_`)),
        time: 120000
    });
    collector.on('collect', async (interaction) => {
        if (interaction.customId === `team_profile_detail_${baseId}`) {
            currentPage = 0;
        }
        else {
            const pageToken = interaction.customId.replace(`team_profile_stats_`, '').replace(`_${baseId}`, '');
            const parsedPage = parseInt(pageToken, 10);
            currentPage = Number.isInteger(parsedPage) ? parsedPage : 1;
        }
        const embed = pages[currentPage] || pages[0];
        await interaction.update({
            embeds: [embed],
            components: [buildTeamProfilePageRow(baseId, currentPage, pages.length)]
        }).catch(() => null);
    });
    collector.on('end', async () => {
        if (!sentMessage.editable)
            return;
        await sentMessage.edit({
            components: [buildDisabledTeamProfilePageRow(baseId, currentPage, pages.length)]
        }).catch(() => null);
    });
    return sentMessage;
}

async function promptPointTableLayout(message) {
    const row = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId('layout_6').setLabel('6 Teams').setStyle(discord_js_1.ButtonStyle.Primary), new discord_js_1.ButtonBuilder().setCustomId('layout_8').setLabel('8 Teams').setStyle(discord_js_1.ButtonStyle.Primary), new discord_js_1.ButtonBuilder().setCustomId('layout_10').setLabel('10 Teams').setStyle(discord_js_1.ButtonStyle.Primary));
    const prompt = await message.reply({ content: "📊 Select the **Point Table Layout** for this season:", components: [row] });
    const selection = await awaitComponent(prompt, { filter: i => i.user.id === message.author.id, time: 60000 }, "❌ Layout selection timed out.", "⚠️ Failed to choose a layout.");
    if (!selection)
        return 6;
    await selection.deferUpdate();
    const size = parseInt(selection.customId.split('_')[1]);
    await selection.editReply({ content: `✅ Layout set to **${size} teams**.`, components: [] }).catch(() => { });
    return size;
}

async function promptSeasonFormat(message) {
    const row = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
        .setCustomId('format_select')
        .setPlaceholder('Select Season Format')
        .addOptions([
        { label: 'Single League', value: 'LEAGUE', description: 'All teams share one table.' },
        { label: 'Groups (A-H)', value: 'GROUPS', description: 'Split teams into lettered groups.' }
    ]));
    const prompt = await message.reply({ content: "🏗️ Choose the **Season Format**:", components: [row] });
    const selection = await awaitComponent(prompt, { filter: i => i.user.id === message.author.id, time: 60000 }, "❌ Format selection timed out.", "⚠️ Failed to choose a format.");
    if (!selection)
        return { format: 'LEAGUE', limit: 'A' };
    await selection.deferUpdate();
    const format = selection.values[0];
    let limit = 'A';
    if (format === 'GROUPS') {
        const groupOptions = getAlphabetRange('H').map(letter => ({
            label: `Groups A-${letter}`,
            value: letter
        }));
        const gRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder().setCustomId('group_limit').setPlaceholder('How many groups?').addOptions(groupOptions));
        await selection.editReply({ content: "🔤 Select the highest **Group Letter** (A-H):", components: [gRow] });
        const gSelect = await awaitComponent(prompt, { filter: i => i.user.id === message.author.id, time: 60000 }, "❌ Group selection timed out.", "⚠️ Failed to choose group limit.");
        if (!gSelect)
            return { format: 'GROUPS', limit: 'A' };
        await gSelect.deferUpdate();
        limit = gSelect.values[0];
        await gSelect.editReply({ content: `✅ Format set to **Groups A-${limit}**.`, components: [] }).catch(() => { });
    }
    else {
        await selection.editReply({ content: "✅ Format set to **Single League**.", components: [] }).catch(() => { });
    }
    return { format, limit };
}
async function updateCapRoles(guild, seasonName) {
    const db = (0, database_1.getDB)();
    const ORANGE_CAP = '1459094827894575198';
    const PURPLE_CAP = '1459451484319125565';
    const DUCK_CAP = '1459451591542177854';

    const allStats = await db.all('SELECT user_id, runs, wickets, ducks FROM stats_players WHERE guild_id = ? AND season_name = ?', guild.id, seasonName);
    if (allStats.length === 0) return;

    const orangeWinner = [...allStats].sort((a, b) => b.runs - a.runs)[0];
    const purpleWinner = [...allStats].sort((a, b) => b.wickets - a.wickets)[0];
    const duckWinner = [...allStats].sort((a, b) => b.ducks - a.ducks)[0];

    const roles = {
        [ORANGE_CAP]: (orangeWinner && orangeWinner.runs > 0) ? orangeWinner.user_id : null,
        [PURPLE_CAP]: (purpleWinner && purpleWinner.wickets > 0) ? purpleWinner.user_id : null,
        [DUCK_CAP]: (duckWinner && duckWinner.ducks > 0) ? duckWinner.user_id : null
    };

    // Fetch members once to populate cache for role management
    await guild.members.fetch().catch(() => {});

    for (const [roleId, userId] of Object.entries(roles)) {
        const role = await guild.roles.fetch(roleId).catch(() => null);
        if (!role) continue;

        // Remove from everyone else who has the role but shouldn't
        for (const [memberId, member] of role.members) {
            if (memberId !== userId) {
                await member.roles.remove(role).catch(() => {});
            }
        }

        // Add to winner
        if (userId) {
            const member = await guild.members.fetch(userId).catch(() => null);
            if (member && !member.roles.cache.has(roleId)) {
                await member.roles.add(role).catch(() => {});
            }
        }
    }
}

async function resolveTargetUserBySearchTerm(message, searchTerm) {
    const db = (0, database_1.getDB)();
    const guildId = message.guild.id;
    if (!searchTerm)
        return null;

    // 1. Try IGN search
    const player = await db.get('SELECT discord_id FROM auction_players WHERE guild_id = ? AND ign LIKE ?', guildId, `%${searchTerm}%`);
    if (player) {
        try { return await message.client.users.fetch(player.discord_id); } catch (e) {}
    }

    // 2. Try Guild search
    try {
        const members = await message.guild.members.fetch({ query: searchTerm, limit: 1 });
        const member = members.first();
        if (member) return member.user;
    } catch (e) {}

    return null;
}

exports.resolveTargetUser = resolveTargetUser;
async function resolveTargetUser(message, args, mentionOnly = false) {
    const mention = message.mentions.users.first();
    if (mention)
        return mention;
    if (mentionOnly || args.length === 0)
        return null;
    const searchTerm = args.find(a => !a.startsWith('<@'));
    return await resolveTargetUserBySearchTerm(message, searchTerm);
}

function isUserMentionToken(token) {
    return /^<@!?\d{15,21}>$/.test(String(token || '').trim());
}

function isRoleMentionToken(token) {
    return /^<@&\d{15,21}>$/.test(String(token || '').trim());
}

function isDiscordUserIdToken(token) {
    return /^\d{15,21}$/.test(String(token || '').trim());
}

function splitRoleRemovalInputs(rawText) {
    return String(rawText || '')
        .split(/\s*,\s*/)
        .map(chunk => chunk.trim())
        .filter(Boolean);
}

function stripRoleRemovalSegmentPrefix(text, type) {
    const pattern = type === 'user'
        ? /^\s*(users?|members?)\s*:\s*/i
        : /^\s*roles?\s*:\s*/i;
    return String(text || '').replace(pattern, '').trim();
}

async function resolveGuildMemberBySearchTerm(message, searchTerm) {
    const trimmed = String(searchTerm || '').trim();
    if (!trimmed || !message.guild) {
        return null;
    }
    const mentionMatch = trimmed.match(/^<@!?(\d{15,21})>$/);
    if (mentionMatch) {
        return await message.guild.members.fetch(mentionMatch[1]).catch(() => null);
    }
    if (isDiscordUserIdToken(trimmed)) {
        return await message.guild.members.fetch(trimmed).catch(() => null);
    }
    const normalized = trimmed.toLowerCase();
    const exactCacheMatch = message.guild.members.cache.find(member => {
        const username = (member.user?.username || '').toLowerCase();
        const displayName = (member.displayName || '').toLowerCase();
        const userTag = (member.user?.tag || '').toLowerCase();
        return username === normalized || displayName === normalized || userTag === normalized;
    });
    if (exactCacheMatch) {
        return exactCacheMatch;
    }
    try {
        const members = await message.guild.members.fetch({ query: trimmed, limit: 10 });
        const exactSearchMatch = members.find(member => {
            const username = (member.user?.username || '').toLowerCase();
            const displayName = (member.displayName || '').toLowerCase();
            const userTag = (member.user?.tag || '').toLowerCase();
            return username === normalized || displayName === normalized || userTag === normalized;
        });
        if (exactSearchMatch) {
            return exactSearchMatch;
        }
        return members.find(member => {
            const username = (member.user?.username || '').toLowerCase();
            const displayName = (member.displayName || '').toLowerCase();
            const userTag = (member.user?.tag || '').toLowerCase();
            return username.includes(normalized) || displayName.includes(normalized) || userTag.includes(normalized);
        }) || null;
    }
    catch (_a) {
        return null;
    }
}

async function resolveGuildRoleBySearchTerm(guild, searchTerm) {
    const trimmed = String(searchTerm || '').trim();
    if (!trimmed || !guild) {
        return null;
    }
    const mentionMatch = trimmed.match(/^<@&(\d{15,21})>$/);
    if (mentionMatch) {
        return await guild.roles.fetch(mentionMatch[1]).catch(() => null);
    }
    if (/^\d{15,21}$/.test(trimmed)) {
        return await guild.roles.fetch(trimmed).catch(() => null);
    }
    const normalized = trimmed.toLowerCase();
    const exactMatch = guild.roles.cache.find(role => role.name.toLowerCase() === normalized);
    if (exactMatch) {
        return exactMatch;
    }
    const startsWithMatch = guild.roles.cache.find(role => role.name.toLowerCase().startsWith(normalized));
    if (startsWithMatch) {
        return startsWithMatch;
    }
    return guild.roles.cache.find(role => role.name.toLowerCase().includes(normalized)) || null;
}

async function resolveRoleRemovalMembers(message, rawText) {
    const membersById = new Map();
    const unresolvedInputs = [];
    const inputs = splitRoleRemovalInputs(stripRoleRemovalSegmentPrefix(rawText, 'user'));
    for (const input of inputs) {
        const member = await resolveGuildMemberBySearchTerm(message, input);
        if (member) {
            membersById.set(member.id, member);
        }
        else {
            unresolvedInputs.push(input);
        }
    }
    return {
        members: [...membersById.values()],
        unresolvedInputs
    };
}

async function resolveRoleRemovalRoles(guild, rawText) {
    const rolesById = new Map();
    const unresolvedInputs = [];
    const inputs = splitRoleRemovalInputs(stripRoleRemovalSegmentPrefix(rawText, 'role'));
    for (const input of inputs) {
        const role = await resolveGuildRoleBySearchTerm(guild, input);
        if (role) {
            rolesById.set(role.id, role);
        }
        else {
            unresolvedInputs.push(input);
        }
    }
    return {
        roles: [...rolesById.values()],
        unresolvedInputs
    };
}

function resolveAddPlayerSetSuffix(args, sets) {
    if (!Array.isArray(args) || args.length === 0 || !Array.isArray(sets) || sets.length === 0) {
        return { setName: null, playerArgs: [...(args || [])] };
    }

    for (let suffixLength = args.length; suffixLength >= 1; suffixLength--) {
        const candidate = args.slice(args.length - suffixLength).join(' ').trim();
        const matchedSet = sets.find(set => set.set_name.toLowerCase() === candidate.toLowerCase());
        if (matchedSet) {
            return {
                setName: matchedSet.set_name,
                playerArgs: args.slice(0, args.length - suffixLength)
            };
        }
    }

    return { setName: null, playerArgs: [...args] };
}

async function resolveAddPlayerTargets(message, args) {
    const resolvedUsers = new Map();
    const unresolvedInputs = [];

    for (const user of message.mentions.users.values()) {
        resolvedUsers.set(user.id, user);
    }

    const idTokens = [...new Set(args.filter(isDiscordUserIdToken))];
    for (const id of idTokens) {
        if (resolvedUsers.has(id))
            continue;
        const user = await message.client.users.fetch(id).catch(() => null);
        if (user) {
            resolvedUsers.set(user.id, user);
        } else {
            unresolvedInputs.push(id);
        }
    }

    const textTokens = args.filter(token => !isUserMentionToken(token) && !isDiscordUserIdToken(token));
    const textChunks = textTokens.join(' ')
        .split(/\s*[|,]\s*/)
        .map(chunk => chunk.trim())
        .filter(Boolean);

    for (const chunk of textChunks) {
        const user = await resolveTargetUserBySearchTerm(message, chunk);
        if (user) {
            resolvedUsers.set(user.id, user);
        } else {
            unresolvedInputs.push(chunk);
        }
    }

    return {
        users: [...resolvedUsers.values()],
        unresolvedInputs
    };
}

function formatAuctionPlayerSelectionSummary(players) {
    const names = players.map(p => `**${p.ign}**`);
    if (names.length <= 10)
        return names.join(', ');
    return `${names.slice(0, 10).join(', ')} and **${names.length - 10}** more`;
}

async function removeAuctionPlayersForGuild(guild, guildId, players) {
    const db = (0, database_1.getDB)();
    let refundTotal = 0;
    for (const player of players) {
        let soldTeam = null;
        if (player.status === 'SOLD' && player.sold_to_team_id) {
            soldTeam = await db.get('SELECT * FROM teams WHERE guild_id = ? AND team_id = ?', guildId, player.sold_to_team_id);
            await db.run('UPDATE teams SET purse_lakhs = purse_lakhs + ? WHERE guild_id = ? AND team_id = ?', player.sold_for_lakhs, guildId, player.sold_to_team_id);
            refundTotal += (player.sold_for_lakhs || 0);
            await db.run('DELETE FROM team_vice_captains WHERE guild_id = ? AND team_id = ? AND vice_captain_discord_id = ?', guildId, player.sold_to_team_id, player.discord_id);
        }
        await db.run('DELETE FROM auction_players WHERE guild_id = ? AND discord_id = ?', guildId, player.discord_id);
        if (soldTeam) {
            await syncAuctionTeamRoleForMember(guild, soldTeam, player.discord_id, 'remove');
        }
    }
    return { refundTotal, removedCount: players.length };
}

async function getOrderedSets(guildId) {
    const db = (0, database_1.getDB)();
    return await db.all('SELECT * FROM sets WHERE guild_id = ? ORDER BY CASE WHEN set_order IS NULL THEN 1 ELSE 0 END, set_order ASC, set_name ASC', guildId);
}

async function reorderGuildSets(guildId, orderedSets) {
    const db = (0, database_1.getDB)();
    let transactionActive = false;
    try {
        await db.run('BEGIN TRANSACTION');
        transactionActive = true;
        for (let i = 0; i < orderedSets.length; i++) {
            await db.run('UPDATE sets SET set_order = ? WHERE guild_id = ? AND set_name = ?', i + 1, guildId, orderedSets[i].set_name);
        }
        await db.run('COMMIT');
        transactionActive = false;
    }
    catch (err) {
        if (transactionActive)
            await db.run('ROLLBACK');
        throw err;
    }
}

async function handleAdminCommand(message, command, args) {
    const db = (0, database_1.getDB)();
    const guildId = message.guild?.id;
    if (!guildId)
        return;
    if (!(0, utils_1.isAdmin)(message.member)) {
        return message.reply("You do not have permission to use this command.");
    }
    try {
        switch (command) {
            case 'hchistory': {
                if (!(0, utils_1.isSuperAdmin)(message.member)) {
                    return message.reply("Only Super Admins and Global Admins can use this command.");
                }
                await handleHcHistoryCommand(message);
                break;
            }
            case 'hcedit': {
                if (!(0, utils_1.isSuperAdmin)(message.member)) {
                    return message.reply("Only Super Admins and Global Admins can use this command.");
                }
                await handleHcEditCommand(message, args);
                break;
            }
            case 'trr':
            case 'transferroles': {
                const sourceUser = message.mentions.members.first();
                const targetUser = message.mentions.members.last();

                if (!sourceUser || !targetUser || sourceUser.id === targetUser.id) {
                    return message.reply("Usage: `?transferroles @OldAcc @NewAcc`\n(Make sure to mention two different users)");
                }

                const rolesToCopy = sourceUser.roles.cache.filter(role => 
                    role.name !== '@everyone' && 
                    !role.managed && 
                    role.editable
                );

                if (rolesToCopy.size === 0) {
                    return message.reply(`❌ No transferable roles found on **${sourceUser.user.tag}**.`);
                }

                try {
                    await targetUser.roles.add(rolesToCopy, `Role transfer from ${sourceUser.user.tag} requested by ${message.author.tag}`);
                    message.reply(`✅ Successfully copied **${rolesToCopy.size}** roles from **${sourceUser.user.tag}** to **${targetUser.user.tag}**.\n*(Note: Roles were not removed from the old account)*`);
                } catch (err) {
                    console.error('Role transfer failed:', err);
                    message.reply("❌ Failed to transfer some roles. This usually happens if the bot's role is below the roles being transferred in the hierarchy.");
                }
                break;
            }
            case 'hcdelete': {
                if (!(0, utils_1.isSuperAdmin)(message.member)) {
                    return message.reply("Only Super Admins and Global Admins can use this command.");
                }
                const matchId = parseInt(args[0]);
                if (isNaN(matchId)) return message.reply("Usage: `?hcdelete [MatchID]`");

                const match = await db.get('SELECT * FROM hc_auto_matches WHERE id = ? AND guild_id = ?', matchId, guildId);
                if (!match) return message.reply(`Match ID \`${matchId}\` was not found in this server.`);

                if (!await (0, utils_1.askConfirmation)(message, `Are you sure you want to delete all matchup data and logs for Match ID **${matchId}**? This cannot be undone.`)) {
                    return;
                }
                let transactionActive = false;
                try {
                    await db.run('BEGIN IMMEDIATE TRANSACTION');
                    transactionActive = true;
                    const matchupRows = await db.get('SELECT COUNT(*) AS total FROM hc_matchup_match_log WHERE match_id = ?', matchId);
                    await db.run('DELETE FROM hc_matchup_match_log WHERE match_id = ?', matchId);
                    await db.run('DELETE FROM hc_auto_message_versions WHERE match_id = ?', matchId);
                    await db.run('DELETE FROM hc_auto_matches WHERE id = ?', matchId);
                    await rebuildHcGlobalMatchupsAfterDelete(db);
                    await db.run('COMMIT');
                    transactionActive = false;
                    message.reply(`✅ Deleted all saved HC data for Match ID \`${matchId}\` and rebuilt global matchup totals.\nRemoved matchup rows: **${matchupRows?.total || 0}**`);
                }
                catch (error) {
                    if (transactionActive) {
                        await db.run('ROLLBACK').catch(() => null);
                    }
                    throw error;
                }
                break;
                
                message.reply(`✅ Deleted all data for Match ID \`${matchId}\`.`);
                break;
            }
            case 'addpublicping': {
                const role = message.mentions.roles.first();
                if (!role) return message.reply("Usage: `?addpublicping @Role [alias] [cooldown_minutes]`");
                
                // Get alias and cooldown from args
                // args[0] is @Role, so alias might be args[1], cooldown args[2]
                let alias = null;
                let cooldownMin = 60;

                const roleArg = args[0];
                const otherArgs = args.slice(1);

                if (otherArgs.length > 0) {
                    // Check if last arg is a number (cooldown)
                    if (!isNaN(parseInt(otherArgs[otherArgs.length - 1]))) {
                        cooldownMin = parseInt(otherArgs.pop());
                    }
                    if (otherArgs.length > 0) {
                        alias = otherArgs.join(' ').toLowerCase();
                    }
                }

                await db.run(`INSERT INTO public_pings (guild_id, role_id, alias, cooldown_seconds)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(guild_id, role_id) DO UPDATE SET
                        alias = excluded.alias,
                        cooldown_seconds = excluded.cooldown_seconds`, guildId, role.id, alias, cooldownMin * 60);
                message.reply(`✅ Role **${role.name}** added to public pings with **${cooldownMin}** minute cooldown.${alias ? ` Alias: **${alias}**` : ''}`);
                break;
            }
            case 'addpublicpingwithchannel':
            case 'appwc': {
                const role = message.mentions.roles.first();
                if (!role) return message.reply("Usage: `?addpublicpingwithchannel @Role [alias] [cooldown_minutes]`");

                let alias = null;
                let cooldownMin = 60;
                const otherArgs = args.slice(1);

                if (otherArgs.length > 0) {
                    if (!isNaN(parseInt(otherArgs[otherArgs.length - 1]))) {
                        cooldownMin = parseInt(otherArgs.pop());
                    }
                    if (otherArgs.length > 0) {
                        alias = otherArgs.join(' ').toLowerCase();
                    }
                }

                const categories = message.guild.channels.cache
                    .filter(c => c.type === discord_js_1.ChannelType.GuildCategory)
                    .map(c => ({ label: c.name, value: c.id }))
                    .slice(0, 25);

                if (categories.length === 0) return message.reply("No categories found in this server.");

                const catRow = new discord_js_1.ActionRowBuilder().addComponents(
                    new discord_js_1.StringSelectMenuBuilder()
                        .setCustomId('ping_cat_select')
                        .setPlaceholder('Select Category')
                        .addOptions(categories)
                );

                const response = await message.reply({ content: "Select a **Category** for the restricted channel:", components: [catRow] });

                try {
                    const catInteraction = await awaitComponent(response, { filter: i => i.user.id === message.author.id, time: 60000, max: 1 }, "❌ Interaction timed out.", "⚠️ Failed to choose a category.");
                    if (!catInteraction)
                        return;
                    await catInteraction.deferUpdate();
                    const categoryId = catInteraction.values[0];

                    const channels = message.guild.channels.cache
                        .filter(ch => ch.parentId === categoryId && ch.type === discord_js_1.ChannelType.GuildText)
                        .map(ch => ({ label: ch.name, value: ch.id }))
                        .slice(0, 25);

                    if (channels.length === 0) {
                        return await catInteraction.editReply({ content: "No text channels found in this category.", components: [] });
                    }

                    const chanRow = new discord_js_1.ActionRowBuilder().addComponents(
                        new discord_js_1.StringSelectMenuBuilder()
                            .setCustomId('ping_chan_select')
                            .setPlaceholder('Select Channel')
                            .addOptions(channels)
                    );

                    await catInteraction.editReply({ content: "Select the **Channel** where this ping can be used:", components: [chanRow] });

                    const chanInteraction = await awaitComponent(response, { filter: i => i.user.id === message.author.id, time: 60000, max: 1 }, "❌ Interaction timed out.", "⚠️ Failed to choose a channel.");
                    if (!chanInteraction)
                        return;
                    await chanInteraction.deferUpdate();
                    const channelId = chanInteraction.values[0];

                    await db.run(`INSERT INTO public_pings (guild_id, role_id, alias, cooldown_seconds, restricted_channel_id)
                        VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT(guild_id, role_id) DO UPDATE SET
                            alias = excluded.alias,
                            cooldown_seconds = excluded.cooldown_seconds,
                            restricted_channel_id = excluded.restricted_channel_id`, guildId, role.id, alias, cooldownMin * 60, channelId);

                    await chanInteraction.editReply({ 
                        content: `✅ Role **${role.name}** added to public pings.\n📍 Restricted to: <#${channelId}>\n⏳ Cooldown: **${cooldownMin}**m${alias ? `\n🏷️ Alias: **${alias}**` : ''}`, 
                        components: [] 
                    });

                } catch (e) {
                    await respondComponentError(response, e, "❌ Interaction timed out.", "⚠️ Unable to finish channel selection.");
                }
                break;
            }
            case 'removepublicping': {
                const pings = await db.all('SELECT * FROM public_pings WHERE guild_id = ?', guildId);
                if (pings.length === 0) return message.reply("No roles registered for public pings.");

                const options = await Promise.all(pings.map(async p => {
                    let roleName = "Unknown Role";
                    try {
                        const role = await message.guild.roles.fetch(p.role_id);
                        if (role) roleName = role.name;
                    } catch(e) {}
                    return {
                        label: roleName,
                        description: `Cooldown: ${Math.floor(p.cooldown_seconds / 60)}m`,
                        value: p.role_id
                    };
                })).then(opts => opts.slice(0, 25));

                const row = new discord_js_1.ActionRowBuilder().addComponents(
                    new discord_js_1.StringSelectMenuBuilder()
                        .setCustomId('remove_public_ping_select')
                        .setPlaceholder('Select one or more roles to remove')
                        .setMinValues(1)
                        .setMaxValues(options.length)
                        .addOptions(options)
                );

                const resp = await message.reply({ content: "Select roles to **REMOVE** from public pings:", components: [row] });
                try {
                    const selectInteraction = await awaitComponent(resp, { filter: i => i.user.id === message.author.id, time: 60000 }, "❌ Selection timed out.", "⚠️ Failed to select roles.");
                    if (!selectInteraction)
                        return;
                    await selectInteraction.deferUpdate();
                    const selectedRoleIds = selectInteraction.values;
                    
                    const names = await Promise.all(selectedRoleIds.map(async rid => {
                        const role = await message.guild.roles.fetch(rid).catch(() => null);
                        return role ? `**${role.name}**` : `**${rid}**`;
                    }));

                    if (!await (0, utils_1.askConfirmation)(message, `Are you sure you want to remove the following roles from public pings?\n${names.join(', ')}`)) {
                        return await selectInteraction.editReply({ content: "❌ Action cancelled.", components: [] });
                    }

                    for (const rid of selectedRoleIds) {
                        await db.run('DELETE FROM public_pings WHERE guild_id = ? AND role_id = ?', guildId, rid);
                    }
                    
                    await selectInteraction.editReply({ content: `✅ Successfully removed roles: ${names.join(', ')}.`, components: [] });
                } catch (e) {
                    console.error(e);
                }
                break;
            }
            case 'setpubliccooldown': {
                let role = message.mentions.roles.first();
                let cooldownMin = null;
                let pingData = null;

                // Find the number in args
                const numArg = args.find(a => !isNaN(parseInt(a)) && !a.includes('<@&'));
                if (numArg) cooldownMin = parseInt(numArg);

                if (role) {
                    pingData = await db.get('SELECT * FROM public_pings WHERE guild_id = ? AND role_id = ?', guildId, role.id);
                } else {
                    // Try alias
                    const aliasParts = args.filter(a => a !== numArg && !a.includes('<@&'));
                    if (aliasParts.length > 0) {
                        const alias = aliasParts.join(' ').toLowerCase();
                        pingData = await db.get('SELECT * FROM public_pings WHERE guild_id = ? AND alias = ?', guildId, alias);
                        if (pingData) {
                            role = await message.guild.roles.fetch(pingData.role_id).catch(() => null);
                        }
                    }
                }

                if (!pingData || !role || cooldownMin === null) return message.reply("Usage: `?setpubliccooldown @Role [minutes]` or `?setpubliccooldown [alias] [minutes]`");
                
                await db.run('UPDATE public_pings SET cooldown_seconds = ? WHERE guild_id = ? AND role_id = ?', cooldownMin * 60, guildId, role.id);
                message.reply(`✅ Cooldown for **${role.name}** updated to **${cooldownMin}** minutes.`);
                break;
            }
            case 'mixgroups': {
                const ptConfig = await getPtConfig(guildId);
                if ((ptConfig.format_type || 'LEAGUE') !== 'GROUPS')
                    return message.reply("Current season is configured as a single league. Use `?setupseason` to enable groups before mixing.");
                const seasonLabel = await statsSystem.getActiveSeason(guildId) || `S${ptConfig.current_season || 1}`;
                const teams = await db.all('SELECT team_id, team_name FROM teams WHERE guild_id = ?', guildId);
                if (!teams.length)
                    return message.reply("No teams found to mix.");
                const allowed = getAlphabetRange(ptConfig.group_limit || 'A');
                if (!allowed.length)
                    return message.reply("No group letters configured.");
                const shuffled = [...teams];
                for (let i = shuffled.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
                }
                const assignments = new Map();
                allowed.forEach(letter => assignments.set(letter, []));
                for (let i = 0; i < shuffled.length; i++) {
                    const letter = allowed[i % allowed.length];
                    assignments.get(letter).push(shuffled[i]);
                    await setTeamGroup(guildId, seasonLabel, shuffled[i].team_id, letter);
                }
                const embed = new discord_js_1.EmbedBuilder()
                    .setTitle('🔀 Teams Mixed Across Groups')
                    .setColor(0x00AE86)
                    .setFooter({ text: `Season ${seasonLabel}` });
                for (const letter of allowed) {
                    const list = assignments.get(letter) || [];
                    embed.addFields({
                        name: `Group ${letter}`,
                        value: list.length ? list.map(t => `• ${t.team_name}`).join('\n') : 'No teams',
                        inline: true
                    });
                }
                message.reply({ embeds: [embed] });
                break;
            }
            case 'setallpubliccooldown': {
                const cooldownMin = parseInt(args[0]);
                if (isNaN(cooldownMin)) return message.reply("Usage: `?setallpubliccooldown [minutes]`");
                const res = await db.run('UPDATE public_pings SET cooldown_seconds = ? WHERE guild_id = ?', cooldownMin * 60, guildId);
                message.reply(`✅ Cooldown for **ALL** registered roles updated to **${cooldownMin}** minutes (${res.changes} roles affected).`);
                break;
            }
            case 'listpublicpings': {
                const pings = await db.all('SELECT * FROM public_pings WHERE guild_id = ?', guildId);
                if (pings.length === 0)
                    return message.reply("No roles registered for public pings.");

                const rows = await Promise.all(pings.map(async (p) => {
                    const role = await message.guild.roles.fetch(p.role_id).catch(() => null);
                    const roleName = role?.name || 'Unknown Role';
                    const cooldownMin = Math.floor(p.cooldown_seconds / 60);
                    let aliasText = '';
                    if (p.alias) {
                        aliasText = ` • Alias: \`${p.alias}\``;
                    }
                    let channelText = '';
                    if (p.restricted_channel_id) {
                        const channel = await message.guild.channels.fetch(p.restricted_channel_id).catch(() => null);
                        const channelName = channel?.name || 'Unknown Channel';
                        channelText = ` • Channel: #${channelName}`;
                    }
                    return `• **${roleName}**\n   Cooldown: **${cooldownMin}m**${aliasText}${channelText}`;
                }));

                const embed = new discord_js_1.EmbedBuilder()
                    .setTitle('📋 Public Ping Roles')
                    .setColor(0x00AE86) // match ping feature accent color
                    .setDescription(rows.join('\n\n'))
                    .setTimestamp();

                message.reply({ embeds: [embed] });
                break;
            }
            case 'createset':
                if (args.length < 2)
                    return message.reply("Usage: ?createset [Name] [BasePrice]");
                const basePriceArg = args.pop();
                const setName = args.join(' ');
                const basePrice = (0, utils_1.parseBidToLakhs)(basePriceArg);
                if (basePrice === null)
                    return message.reply("Invalid base price.");
                if (basePrice % 5 !== 0)
                    return message.reply("Base price must end in 0 or 5 Lakhs.");
                const nextSetOrderRow = await db.get('SELECT COALESCE(MAX(set_order), 0) as maxOrder FROM sets WHERE guild_id = ?', guildId);
                await db.run('INSERT INTO sets (guild_id, set_name, base_price_lakhs, set_order) VALUES (?, ?, ?, ?)', guildId, setName, basePrice, (nextSetOrderRow?.maxOrder || 0) + 1);
                message.reply(`Set "${setName}" created with Base Price ${(0, utils_1.lakhsToDisplay)(basePrice)}.`);
                break;
            case 'setincrement':
                if (args.length < 2)
                    return message.reply("Usage: ?setincrement [SetName] [Value]");
                const incVal = (0, utils_1.parseBidToLakhs)(args.pop());
                const incSet = args.join(' ');
                if (incVal === null)
                    return message.reply("Invalid increment value.");
                if (incVal % 5 !== 0)
                    return message.reply("Increment must end in 0 or 5 Lakhs.");
                const siResult = await db.run('UPDATE sets SET increment_lakhs = ? WHERE guild_id = ? AND set_name = ?', incVal, guildId, incSet);
                if (siResult.changes === 0) return message.reply(`⚠️ Set "${incSet}" not found.`);
                message.reply(`✅ Set "**${incSet}**" increment updated to **${(0, utils_1.lakhsToDisplay)(incVal)}**.`);
                break;
            case 'setbase':
                if (args.length < 2)
                    return message.reply("Usage: ?setbase [SetName] [Value]");
                const baseVal = (0, utils_1.parseBidToLakhs)(args.pop());
                const baseSet = args.join(' ');
                if (baseVal === null)
                    return message.reply("Invalid base value.");
                if (baseVal % 5 !== 0)
                    return message.reply("Base price must end in 0 or 5 Lakhs.");
                const sbResult = await db.run('UPDATE sets SET base_price_lakhs = ? WHERE guild_id = ? AND set_name = ?', baseVal, guildId, baseSet);
                if (sbResult.changes === 0) return message.reply(`⚠️ Set "${baseSet}" not found.`);
                message.reply(`✅ Set "**${baseSet}**" base price updated to **${(0, utils_1.lakhsToDisplay)(baseVal)}**.`);
                break;
            case 'rps':
            case 'removeplayerstat': {
                const target = await resolveTargetUser(message, args);
                if (!target) return message.reply("Please mention a user or provide a username/IGN.");

                const activeSeason = await statsSystem.getActiveSeason(guildId);
                if (!activeSeason) return message.reply("There is no active season.");

                const matches = await db.all(
                    `SELECT * FROM stats_matches 
                     WHERE guild_id = ? AND season_name = ? AND user_id = ? 
                     ORDER BY timestamp DESC LIMIT 25`,
                    guildId, activeSeason, target.id
                );

                if (matches.length === 0) {
                    return message.reply(`No matches found for **${target.username}** in season **${activeSeason}**.`);
                }

                const matchOptions = await Promise.all(matches.map(async (m, index) => {
                    const dateStr = await formatDate(guildId, m.timestamp);
                    return {
                        label: `Match #${m.match_number || (matches.length - index)}`,
                        description: `Runs: ${m.runs}, Wkts: ${m.wickets}, Date: ${dateStr}`,
                        value: m.match_id.toString()
                    };
                }));

                const selectMenu = new discord_js_1.StringSelectMenuBuilder()
                    .setCustomId('remove_stat_select')
                    .setPlaceholder('Select one or more matches to remove stats from')
                    .setMinValues(1)
                    .setMaxValues(matchOptions.length)
                    .addOptions(matchOptions);

                const row = new discord_js_1.ActionRowBuilder().addComponents(selectMenu);

                const response = await message.reply({
                    content: `Select which match's stats to remove for **${target.username}**:`,
                    components: [row]
                });

                try {
                    const selectInteraction = await awaitComponent(response, {
                        filter: i => i.user.id === message.author.id && i.customId === 'remove_stat_select',
                        time: 60000
                    }, "❌ Selection timed out.", "⚠️ Failed to select matches.");
                    if (!selectInteraction)
                        return;
                    await selectInteraction.deferUpdate();
                    const selectedMatchIds = selectInteraction.values;
                    const confirmMsg = `Are you sure you want to remove stats for **${target.username}** from **${selectedMatchIds.length}** matches?`;
                    
                    if (!await (0, utils_1.askConfirmation)(message, confirmMsg)) {
                        return await selectInteraction.editReply({ content: "❌ Action cancelled.", components: [] });
                    }

                    for (const matchId of selectedMatchIds) {
                        await db.run('DELETE FROM stats_matches WHERE match_id = ? AND user_id = ?', matchId, target.id);
                        await db.run('DELETE FROM stats_match_context WHERE guild_id = ? AND match_id = ? AND user_id = ?', guildId, matchId, target.id);
                    }
                    
                    await statsSystem.recalculatePlayerStats(guildId, activeSeason, target.id);
                    
                    await selectInteraction.editReply({
                        content: `✅ Successfully removed stats for **${target.username}** from **${selectedMatchIds.length}** matches and recalculated totals.`,
                        components: []
                    });
                } catch (e) {
                    console.error(e);
                }
                break;
            }
            case 'addplayer': {
                const availableSets = await getOrderedSets(guildId);
                const { setName: explicitSetName, playerArgs } = resolveAddPlayerSetSuffix(args, availableSets);
                const { users, unresolvedInputs } = await resolveAddPlayerTargets(message, playerArgs);

                if (users.length === 0) {
                    return message.reply("Usage: `?addplayer @user1 @user2 [SetName]`\nYou can also use user IDs or `name1 | name2 | name3`.");
                }

                let targetSetName = explicitSetName;
                if (!targetSetName) {
                    if (availableSets.length === 0) {
                        return message.reply("No sets found. Create a set first, or include a valid set name in the command.");
                    }

                    const selectCustomId = `addplayer_set_select_${message.id}`;
                    const setOptions = [
                        new discord_js_1.StringSelectMenuOptionBuilder()
                            .setLabel('No Set / Unassigned')
                            .setValue('__NO_SET__')
                            .setDescription('Add the players without assigning a set'),
                        ...availableSets.map(setRow => new discord_js_1.StringSelectMenuOptionBuilder()
                            .setLabel(setRow.set_name)
                            .setValue(setRow.set_name)
                            .setDescription(`Assign players to ${setRow.set_name}`))
                    ].slice(0, 25);

                    const row = new discord_js_1.ActionRowBuilder().addComponents(
                        new discord_js_1.StringSelectMenuBuilder()
                            .setCustomId(selectCustomId)
                            .setPlaceholder('Select the set for these players')
                            .addOptions(setOptions)
                    );
                    const playerPreview = users.length <= 8
                        ? users.map(user => `**${user.username}**`).join(', ')
                        : `${users.slice(0, 8).map(user => `**${user.username}**`).join(', ')} and **${users.length - 8}** more`;

                    const selectionPrompt = await message.reply({
                        content: `Select the set for **${users.length}** player(s): ${playerPreview}`,
                        components: [row]
                    });
                    const selection = await awaitComponent(
                        selectionPrompt,
                        {
                            filter: i => i.user.id === message.author.id && i.customId === selectCustomId,
                            time: 60000,
                            max: 1
                        },
                        'Selection timed out.',
                        'Failed to choose a set for the added players.'
                    );
                    if (!selection) {
                        return;
                    }

                    await selection.deferUpdate();
                    targetSetName = selection.values[0] === '__NO_SET__' ? null : selection.values[0];
                    await selection.editReply({
                        content: `Adding **${users.length}** player(s) to **${targetSetName || 'No Set / Unassigned'}**...`,
                        components: []
                    });
                }

                let addedCount = 0;
                let existingCount = 0;
                for (const user of users) {
                    const existing = await db.get('SELECT * FROM auction_players WHERE guild_id = ? AND discord_id = ?', guildId, user.id);
                    if (existing) {
                        existingCount++;
                        continue;
                    }

                    await db.run('INSERT INTO auction_players (guild_id, discord_id, ign, set_name) VALUES (?, ?, ?, ?)', guildId, user.id, user.username, targetSetName);
                    addedCount++;
                }

                let replyMsg = addedCount > 0
                    ? `Added **${addedCount}** player${addedCount === 1 ? '' : 's'}.`
                    : 'No new players were added.';
                replyMsg += targetSetName
                    ? ` Assigned to set **${targetSetName}**.`
                    : ' Assigned to **No Set / Unassigned**.';
                if (existingCount > 0) {
                    replyMsg += ` (${existingCount} already registered).`;
                }
                if (unresolvedInputs.length > 0) {
                    const unresolvedPreview = unresolvedInputs.slice(0, 5).map(item => `**${item}**`).join(', ');
                    replyMsg += ` Could not find: ${unresolvedPreview}${unresolvedInputs.length > 5 ? ` and **${unresolvedInputs.length - 5}** more` : ''}.`;
                }
                message.reply(replyMsg);
                break;
            }
            case 'assignset': {
                const users = message.mentions.users;
                const targetSetArgs = args.filter(a => !a.startsWith('<@') && !a.match(/^\d+$/));
                const targetSet = targetSetArgs.join(' ');

                if (users.size === 0) {
                    const target = await resolveTargetUser(message, args);
                    if (target && targetSet) {
                        await db.run('UPDATE auction_players SET set_name = ? WHERE guild_id = ? AND discord_id = ?', targetSet, guildId, target.id);
                        return message.reply(`✅ Assigned **${target.username}** to set "**${targetSet}**".`);
                    }
                    return message.reply("Usage: ?assignset [@user/Username] [SetName]");
                }

                if (!targetSet)
                    return message.reply("Please specify a set name.");
                let assignedCount = 0;
                for (const [id, user] of users) {
                    await db.run('UPDATE auction_players SET set_name = ? WHERE guild_id = ? AND discord_id = ?', targetSet, guildId, id);
                    assignedCount++;
                }
                message.reply(`✅ Assigned **${assignedCount}** players to set "**${targetSet}**".`);
                break;
            }
            case 'createteam': {
                const owner = await resolveTargetUser(message, args);
                if (!owner)
                    return message.reply("Usage: ?createteam [Name] [@Owner/Username] or `?ct @Owner`");

                // If only the owner is provided, default to "Team <username>".
                let teamName = args.filter(a => !a.includes(owner.id) && a.toLowerCase() !== owner.username.toLowerCase()).join(' ');
                if (!teamName) {
                    teamName = `Team ${owner.username}`;
                }
                if (!teamName) return message.reply("Please provide a team name.");
                
                await db.run('INSERT INTO teams (guild_id, team_name, owner_discord_id, purse_lakhs) VALUES (?, ?, ?, 0)', guildId, teamName, owner.id);
                message.reply(`Team "${teamName}" created for ${owner.username}.`);
                break;
            }
            case 'setpurse': {
                if (args.length < 2)
                    return message.reply("Usage: ?setpurse [Teams/Owners...] [Amount]");
                const amountArg = args.pop();
                const spAmount = (0, utils_1.parseBidToLakhs)(amountArg);
                if (spAmount === null)
                    return message.reply("Invalid amount.");
                
                let updatedCount = 0;
                const updatedTeamNames = [];
                let notFound = [];
                const mentionedUsers = message.mentions.users;
                
                if (mentionedUsers.size > 0) {
                    for (const [id, user] of mentionedUsers) {
                        const team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND owner_discord_id = ?', guildId, id);
                        if (team) {
                            await db.run('UPDATE teams SET purse_lakhs = ? WHERE guild_id = ? AND team_id = ?', spAmount, guildId, team.team_id);
                            updatedCount++;
                            updatedTeamNames.push(team.team_name);
                        }
                        else {
                            notFound.push(user.username);
                        }
                    }
                }
                else {
                    const targetStr = args.join(' ');
                    // Try as team name first
                    let team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND team_name = ?', guildId, targetStr);
                    if (!team) {
                        // Try resolving as a user/IGN
                        const targetUser = await resolveTargetUser(message, args);
                        if (targetUser) {
                            team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND owner_discord_id = ?', guildId, targetUser.id);
                        }
                    }

                    if (team) {
                        await db.run('UPDATE teams SET purse_lakhs = ? WHERE guild_id = ? AND team_id = ?', spAmount, guildId, team.team_id);
                        updatedCount++;
                        updatedTeamNames.push(team.team_name);
                    }
                    else {
                        notFound.push(targetStr);
                    }
                }
                if (updatedCount > 0) {
                    await (0, auditLog_1.appendAdminAuditLog)({
                        guildId,
                        actorId: message.author.id,
                        commandName: 'setpurse',
                        summary: `Set purse to ${(0, utils_1.lakhsToDisplay)(spAmount)} for ${updatedCount} team(s).`,
                        targetSummary: updatedTeamNames.join(', '),
                        channelId: message.channel.id
                    });
                    message.reply(`✅ Updated purse to **${(0, utils_1.lakhsToDisplay)(spAmount)}** for **${updatedCount}** teams.`);
                }
                if (notFound.length > 0) {
                    message.reply(`⚠️ Could not find teams for: ${notFound.join(', ')}`);
                }
                break;
            }
            case 'setpurseall':
                if (args.length < 1)
                    return message.reply("Usage: ?setpurseall [Amount]");
                const allAmountArg = args[0];
                const allAmount = (0, utils_1.parseBidToLakhs)(allAmountArg);
                if (allAmount === null)
                    return message.reply("Invalid amount.");
                const teamCountRow = await db.get('SELECT COUNT(*) AS count FROM teams WHERE guild_id = ?', guildId);
                await db.run('UPDATE teams SET purse_lakhs = ? WHERE guild_id = ?', allAmount, guildId);
                await (0, auditLog_1.appendAdminAuditLog)({
                    guildId,
                    actorId: message.author.id,
                    commandName: 'setpurseall',
                    summary: `Set purse to ${(0, utils_1.lakhsToDisplay)(allAmount)} for all teams.`,
                    targetSummary: `${Number(teamCountRow?.count || 0)} team(s)`,
                    channelId: message.channel.id
                });
                message.reply(`✅ Updated purse to **${(0, utils_1.lakhsToDisplay)(allAmount)}** for ALL teams.`);
                break;
            case 'setowner': {
                const newOwner = await resolveTargetUser(message, args);
                if (!newOwner || args.length < 2)
                    return message.reply("Usage: ?setowner [TeamName] [@NewOwner/Username]");
                
                // Extract team name by filtering out newOwner details
                const teamNameOwner = args.filter(a => !a.includes(newOwner.id) && a.toLowerCase() !== newOwner.username.toLowerCase()).join(' ');
                
                const teamExists = await db.get('SELECT * FROM teams WHERE guild_id = ? AND team_name = ?', guildId, teamNameOwner);
                if (!teamExists)
                    return message.reply(`Team "${teamNameOwner}" not found.`);
                
                const userOwns = await db.get('SELECT * FROM teams WHERE guild_id = ? AND owner_discord_id = ?', guildId, newOwner.id);
                if (userOwns)
                    return message.reply(`User ${newOwner.username} already owns team "${userOwns.team_name}".`);
                
                const previousOwnerId = teamExists.owner_discord_id;
                await db.run('UPDATE teams SET owner_discord_id = ? WHERE guild_id = ? AND team_name = ?', newOwner.id, guildId, teamNameOwner);
                await (0, auditLog_1.appendAdminAuditLog)({
                    guildId,
                    actorId: message.author.id,
                    commandName: 'setowner',
                    summary: `Transferred ownership of ${teamNameOwner} to ${newOwner.username}.`,
                    targetSummary: `From <@${previousOwnerId}> to <@${newOwner.id}>`,
                    channelId: message.channel.id
                });
                message.reply(`✅ Transferred ownership of "**${teamNameOwner}**" to **${newOwner.username}**.`);
                break;
            }
            case 'moveset': {
                const sets = await getOrderedSets(guildId);
                if (sets.length === 0) return message.reply("⚠️ No sets found in database.");

                const setOptions = sets.map(s => ({
                    label: s.set_name,
                    description: `Base Price: ${(0, utils_1.lakhsToDisplay)(s.base_price_lakhs)}`,
                    value: s.set_name
                })).slice(0, 25);

                const row1 = new discord_js_1.ActionRowBuilder().addComponents(
                    new discord_js_1.StringSelectMenuBuilder()
                        .setCustomId('move_source_set')
                        .setPlaceholder('Step 1: Select SOURCE Set')
                        .addOptions(setOptions)
                );

                const resp = await message.reply({ content: "➡️ **Step 1:** Select the set containing players you want to move:", components: [row1] });
                
                try {
                    const sourceInteraction = await awaitComponent(resp, { filter: i => i.user.id === message.author.id, time: 60000, max: 1 }, "❌ Selection timed out.", "⚠️ Failed to pick the source set.");
                    if (!sourceInteraction)
                        return;
                    await sourceInteraction.deferUpdate();
                    const sourceSet = sourceInteraction.values[0];

                    const players = await db.all('SELECT discord_id, ign FROM auction_players WHERE guild_id = ? AND set_name = ?', guildId, sourceSet);
                    if (players.length === 0) {
                        return await sourceInteraction.editReply({ content: `⚠️ No players found in set "**${sourceSet}**".`, components: [] });
                    }

                    const playerOptions = players.map(p => ({
                        label: p.ign || "Unknown",
                        description: `ID: ${p.discord_id}`,
                        value: p.discord_id
                    })).slice(0, 25);

                    const row2 = new discord_js_1.ActionRowBuilder().addComponents(
                        new discord_js_1.StringSelectMenuBuilder()
                            .setCustomId('move_players_select')
                            .setPlaceholder('Step 2: Select Players to Move')
                            .setMinValues(1)
                            .setMaxValues(playerOptions.length)
                            .addOptions(playerOptions)
                    );

                    await sourceInteraction.editReply({ content: `➡️ **Step 2:** Select players from **${sourceSet}** to move:`, components: [row2] });
                    const playerInteraction = await awaitComponent(resp, { filter: i => i.user.id === message.author.id, time: 60000, max: 1 }, "❌ Selection timed out.", "⚠️ Failed to pick players.");
                    if (!playerInteraction)
                        return;
                    await playerInteraction.deferUpdate();
                    const selectedPlayerIds = playerInteraction.values;

                    const row3 = new discord_js_1.ActionRowBuilder().addComponents(
                        new discord_js_1.StringSelectMenuBuilder()
                            .setCustomId('move_target_set')
                            .setPlaceholder('Step 3: Select TARGET Set')
                            .addOptions(setOptions)
                    );

                    await playerInteraction.editReply({ content: `➡️ **Step 3:** Move ${selectedPlayerIds.length} players to which set?`, components: [row3] });
                    const targetInteraction = await awaitComponent(resp, { filter: i => i.user.id === message.author.id, time: 60000, max: 1 }, "❌ Selection timed out.", "⚠️ Failed to pick the destination set.");
                    if (!targetInteraction)
                        return;
                    await targetInteraction.deferUpdate();
                    const targetSet = targetInteraction.values[0];

                    if (sourceSet === targetSet) {
                        return await targetInteraction.editReply({ content: "⚠️ Source and Target sets are the same. Action aborted.", components: [] });
                    }

                    const playerNames = players.filter(p => selectedPlayerIds.includes(p.discord_id)).map(p => `**${p.ign}**`).join(', ');

                    if (!await (0, utils_1.askConfirmation)(message, `Move the following players from **${sourceSet}** to **${targetSet}**?\n${playerNames}`)) {
                        return await targetInteraction.editReply({ content: "❌ Move cancelled.", components: [] });
                    }

                    for (const pid of selectedPlayerIds) {
                        await db.run('UPDATE auction_players SET set_name = ? WHERE guild_id = ? AND discord_id = ?', targetSet, guildId, pid);
                    }

                    await targetInteraction.editReply({ content: `✅ Successfully moved **${selectedPlayerIds.length}** players to **${targetSet}**.`, components: [] });

                } catch (e) {
                    await respondComponentError(resp, e, "❌ Selection timed out.", "⚠️ Move operation failed. Please try again.");
                }
                break;
            }
            case 'deleteset': {
                const sets = await getOrderedSets(guildId);
                if (sets.length === 0) return message.reply("No sets found.");

                const options = sets.map(s => ({
                    label: s.set_name,
                    description: `Base Price: ${(0, utils_1.lakhsToDisplay)(s.base_price_lakhs)}`,
                    value: s.set_name
                })).slice(0, 25);

                const row = new discord_js_1.ActionRowBuilder().addComponents(
                    new discord_js_1.StringSelectMenuBuilder()
                        .setCustomId('remove_set_select')
                        .setPlaceholder('Select one or more sets to remove')
                        .setMinValues(1)
                        .setMaxValues(options.length)
                        .addOptions(options)
                );

                const resp = await message.reply({ content: "Select sets to **REMOVE** (This will unassign players from these sets):", components: [row] });
                try {
                    const selectInteraction = await awaitComponent(resp, { filter: i => i.user.id === message.author.id, time: 60000 }, "❌ Selection timed out.", "⚠️ Failed to pick sets.");
                    if (!selectInteraction)
                        return;
                    await selectInteraction.deferUpdate();
                    const selectedSetNames = selectInteraction.values;
                    const setNamesStr = selectedSetNames.map(s => `**${s}**`).join(', ');

                    if (!await (0, utils_1.askConfirmation)(message, `Are you sure you want to remove the following sets?\n${setNamesStr}\n\nPlayers in these sets will be unassigned.`)) {
                        return await selectInteraction.editReply({ content: "❌ Action cancelled.", components: [] });
                    }

                    let transactionActive = false;
                    try {
                        await db.run('BEGIN TRANSACTION');
                        transactionActive = true;
                        for (const sName of selectedSetNames) {
                            await db.run('UPDATE auction_players SET set_name = NULL WHERE guild_id = ? AND set_name = ?', guildId, sName);
                            await db.run('DELETE FROM sets WHERE guild_id = ? AND set_name = ?', guildId, sName);
                        }
                        await db.run('COMMIT');
                        transactionActive = false;
                        await selectInteraction.editReply({ content: `✅ Successfully removed sets: ${setNamesStr}.`, components: [] });
                    } catch (err) {
                        if (transactionActive) await db.run('ROLLBACK');
                        throw err;
                    }
                } catch (e) {
                    console.error(e);
                }
                break;
            }
            case 'reordersets': {
                const sets = await getOrderedSets(guildId);
                if (sets.length < 2)
                    return message.reply("At least 2 sets are required to reorder.");
                const currentOrderText = sets.map((set, index) => `${index + 1}. **${set.set_name}**`).join('\n');
                if (args.length < 2) {
                    return message.reply(`Current set order:\n${currentOrderText}\n\nUsage: \`?reordersets 5 2\` or \`?reordersets "Silver Set" 1\``);
                }
                const destinationArg = args[args.length - 1];
                const destination = parseInt(destinationArg, 10);
                if (Number.isNaN(destination) || destination < 1 || destination > sets.length) {
                    return message.reply(`Destination position must be between 1 and ${sets.length}.`);
                }
                const sourceArg = args.slice(0, -1).join(' ').trim();
                if (!sourceArg) {
                    return message.reply("Provide a source set position or set name.");
                }
                let sourceIndex = Number.NaN;
                if (/^\d+$/.test(sourceArg)) {
                    sourceIndex = parseInt(sourceArg, 10) - 1;
                }
                else {
                    sourceIndex = sets.findIndex(set => set.set_name.toLowerCase() === sourceArg.toLowerCase());
                }
                if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= sets.length) {
                    return message.reply(`Could not find a set matching \`${sourceArg}\`.`);
                }
                const targetIndex = destination - 1;
                if (sourceIndex === targetIndex) {
                    return message.reply("That set is already in that position.");
                }
                const reorderedSets = [...sets];
                const [movedSet] = reorderedSets.splice(sourceIndex, 1);
                reorderedSets.splice(targetIndex, 0, movedSet);
                await reorderGuildSets(guildId, reorderedSets);
                const preview = reorderedSets.map((set, index) => `${index + 1}. **${set.set_name}**`).join('\n');
                message.reply(`✅ Moved **${movedSet.set_name}** to position **${destination}**.\n\nNew set order:\n${preview}`);
                break;
            }
            case 'renameset':
                const input = args.join(' ');
                const match = input.match(/"([^\"]+)"\s+"([^\"]+)"/) || input.match(/(\S+)\s+(\S+)/);
                if (!match)
                    return message.reply('Usage: ?renameset "Old Name" "New Name" (Use quotes for spaces)');
                const oldName = match[1];
                const newSetName = match[2];
                const setExists = await db.get('SELECT * FROM sets WHERE guild_id = ? AND set_name = ?', guildId, oldName);
                if (!setExists)
                    return message.reply(`Set "${oldName}" not found.`);
                const nameTaken = await db.get('SELECT * FROM sets WHERE guild_id = ? AND set_name = ?', guildId, newSetName);
                if (nameTaken)
                    return message.reply(`Set name "${newSetName}" is already taken.`);
                
                let transactionActive = false;
                try {
                    await db.run('BEGIN TRANSACTION');
                    transactionActive = true;
                    await db.run('UPDATE auction_players SET set_name = ? WHERE guild_id = ? AND set_name = ?', newSetName, guildId, oldName);
                    await db.run('UPDATE sets SET set_name = ? WHERE guild_id = ? AND set_name = ?', newSetName, guildId, oldName);
                    await db.run('COMMIT');
                    transactionActive = false;
                    message.reply(`✅ Set "${oldName}" renamed to "${newSetName}".`);
                }
                catch (err) {
                    if (transactionActive) await db.run('ROLLBACK');
                    throw err;
                }
                break;
            case 'setlimit': {
                if (args.length < 2)
                    return message.reply("Usage: `?setteamlimit [Team/@Role/@Captain/Alias] [Limit]`");
                const limitArg = args.pop();
                const limitVal = parseInt(limitArg);
                if (isNaN(limitVal) || limitVal < 1)
                    return message.reply("Invalid limit. Must be a number > 0.");
                
                const targetStr = args.join(' ');
                let limitTeam = await findTeamByIdentifier(guildId, targetStr);
                
                if (!limitTeam) {
                    const limitOwner = await resolveTargetUser(message, args);
                    if (limitOwner) {
                        limitTeam = await findTeamByIdentifier(guildId, `<@${limitOwner.id}>`);
                    }
                }

                if (!limitTeam)
                    return message.reply("Team not found. Use a team name, abbreviation, team role, captain mention, or owner mention.");
                
                await db.run('UPDATE teams SET max_roster_size = ? WHERE guild_id = ? AND team_id = ?', limitVal, guildId, limitTeam.team_id);
                message.reply(`✅ Roster limit for **${limitTeam.team_name}** updated to **${limitVal}**.`);
                break;
            }
            case 'setlimitall':
                if (args.length < 1)
                    return message.reply("Usage: ?setlimitall [Limit]");
                const limitAllVal = parseInt(args[0]);
                if (isNaN(limitAllVal) || limitAllVal < 1)
                    return message.reply("Invalid limit.");
                await db.run('UPDATE teams SET max_roster_size = ? WHERE guild_id = ?', limitAllVal, guildId);
                message.reply(`✅ Roster limit for **ALL TEAMS** updated to **${limitAllVal}**.`);
                break;
            case 'setgroup': {
                const ptConfig = await getPtConfig(guildId);
                if ((ptConfig.format_type || 'LEAGUE') !== 'GROUPS')
                    return message.reply("Current season is not configured for groups.");
                if (args.length < 2)
                    return message.reply("Usage: `?setgroup <Letter> <Team Name | @Role | Team1 | Team2>`");
                const targetLetter = args.shift().toUpperCase();
                const allowed = getAlphabetRange(ptConfig.group_limit || 'A');
                if (!allowed.includes(targetLetter))
                    return message.reply(`Group must be between A and ${ptConfig.group_limit || 'A'}.`);
                const targets = args.join(' ').split('|').map(s => s.trim()).filter(Boolean);
                if (!targets.length)
                    return message.reply("Provide at least one team name or role.");
                const seasonLabel = await statsSystem.getActiveSeason(guildId) || `S${ptConfig.current_season || 1}`;
                const updated = [];
                for (const target of targets) {
                    const cleaned = target.replace(/\s+/g, ' ').trim();
                    let team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND team_name LIKE ?', guildId, `%${cleaned}%`);
                    if (!team) {
                        const mentionMatch = target.match(/<@&(\d+)>/);
                        if (mentionMatch) {
                            const role = await message.guild.roles.fetch(mentionMatch[1]).catch(() => null);
                            if (role)
                                team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND role_id = ?', guildId, role.id);
                        }
                    }
                    if (!team) {
                        const ownerMention = target.match(/<@!?(\d+)>/);
                        if (ownerMention) {
                            team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND owner_discord_id = ?', guildId, ownerMention[1]);
                        }
                    }
                    if (!team) {
                        team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND team_name LIKE ?', guildId, `%${target}%`);
                    }
                    if (team) {
                        await setTeamGroup(guildId, seasonLabel, team.team_id, targetLetter);
                        updated.push(team.team_name);
                    }
                }
                if (!updated.length)
                    return message.reply("No matching teams found.");
                message.reply(`✅ Updated **${updated.length}** team(s) to Group **${targetLetter}**: ${updated.map(t => `**${t}**`).join(', ')}`);
                break;
            }
            case 'groupstatus': {
                const ptConfig = await getPtConfig(guildId);
                const seasonLabel = await statsSystem.getActiveSeason(guildId) || `S${ptConfig.current_season || 1}`;
                const allowed = getAlphabetRange(ptConfig.group_limit || 'A');
                const groupCounts = await db.all('SELECT group_letter, COUNT(*) as count FROM team_groups WHERE guild_id = ? AND season_name = ? GROUP BY group_letter', guildId, seasonLabel);
                const countMap = {};
                for (const row of groupCounts)
                    countMap[row.group_letter] = row.count;
                const unassigned = await db.all('SELECT team_name FROM teams WHERE guild_id = ? AND team_id NOT IN (SELECT team_id FROM team_groups WHERE guild_id = ? AND season_name = ?)', guildId, guildId, seasonLabel);
                const embed = new discord_js_1.EmbedBuilder()
                    .setTitle(`📋 Group Status — ${seasonLabel}`)
                    .setColor(0x00AE86)
                    .setDescription((ptConfig.format_type || 'LEAGUE') === 'GROUPS' ? `Groups A-${ptConfig.group_limit || 'A'}` : 'Single League');
                for (const letter of allowed) {
                    embed.addFields({ name: `Group ${letter}`, value: `${countMap[letter] || 0} teams`, inline: true });
                }
                if (unassigned.length) {
                    embed.addFields({ name: 'Unassigned Teams', value: unassigned.map(t => `• ${t.team_name}`).join('\n') });
                }
                else {
                    embed.addFields({ name: 'Unassigned Teams', value: '✅ All teams assigned.' });
                }
                message.reply({ embeds: [embed] });
                break;
            }
            case 'setupseason': {
                if (args.length < 1)
                    return message.reply("Usage: ?setupseason [Name] [--fresh]");
                const isFresh = args.includes('--fresh');
                const seasonName = args.filter(a => a !== '--fresh').join(' ');
                
                if (isFresh) {
                    if (!(0, utils_1.isSuperAdmin)(message.member)) return message.reply("❌ The `--fresh` flag requires **Super Admin** permissions.");
                    if (!await (0, utils_1.askConfirmation)(message, "⚠️ **FRESH SEASON RESET?**\nThis will permanently DELETE all current teams, captains, match reservations, AND Point Table data (matches & aliases). This cannot be undone.")) {
                        return;
                    }
                    await db.run('DELETE FROM match_reservations WHERE guild_id = ?', guildId);
                    await db.run('DELETE FROM team_captains WHERE guild_id = ?', guildId);
                    await db.run('DELETE FROM team_reservations WHERE guild_id = ?', guildId);
                    await db.run('DELETE FROM teams WHERE guild_id = ?', guildId);
                    
                    // Point Table Reset
                    await db.run('DELETE FROM pt_matches WHERE guild_id = ?', guildId);
                    await db.run('DELETE FROM pt_team_aliases WHERE guild_id = ?', guildId);
                    await db.run('DELETE FROM pt_settings WHERE guild_id = ?', guildId);

                    await db.run('UPDATE auction_players SET status = "AVAILABLE", sold_to_team_id = NULL, sold_for_lakhs = NULL WHERE guild_id = ?', guildId);
                    await db.run('DELETE FROM auction_ledger WHERE guild_id = ?', guildId);
                }

                await db.run('UPDATE stats_seasons SET is_active = 0 WHERE guild_id = ?', guildId);
                
                const existingSeason = await db.get('SELECT layout_size, format_type, group_limit FROM stats_seasons WHERE guild_id = ? AND season_name = ?', guildId, seasonName);
                
                let layoutSize, formatData;
                if (existingSeason && existingSeason.layout_size && existingSeason.format_type) {
                    layoutSize = existingSeason.layout_size;
                    formatData = { format: existingSeason.format_type, limit: existingSeason.group_limit || 'A' };
                } else {
                    layoutSize = await promptPointTableLayout(message);
                    formatData = await promptSeasonFormat(message);
                }

                const seasonNumber = parseInt(seasonName.replace(/\D/g, '')) || 1;
                await db.run(`INSERT INTO pt_settings (guild_id, current_season, layout_size, format_type, group_limit)
                              VALUES (?, ?, ?, ?, ?)
                              ON CONFLICT(guild_id) DO UPDATE SET current_season = excluded.current_season,
                              layout_size = excluded.layout_size,
                              format_type = excluded.format_type,
                              group_limit = excluded.group_limit`,
                    guildId, seasonNumber, layoutSize, formatData.format, formatData.limit);

                await db.run('INSERT INTO stats_seasons (guild_id, season_name, is_active, season_num, layout_size, format_type, group_limit) VALUES (?, ?, 1, ?, ?, ?, ?) ON CONFLICT(guild_id, season_name) DO UPDATE SET is_active = 1, season_num = excluded.season_num, layout_size = excluded.layout_size, format_type = excluded.format_type, group_limit = excluded.group_limit', 
                    guildId, seasonName, seasonNumber, layoutSize, formatData.format, formatData.limit);

                let msg = `✅ Active season set to "**${seasonName}**".\n• Point Table Layout: **${layoutSize} teams**\n• Format: **${formatData.format === 'LEAGUE' ? 'Single League' : `Groups A-${formatData.limit}`}**`;
                if (isFresh)
                    msg += "\n🧹 **Database cleared for a fresh start.**";
                message.reply(msg);
                break;
            }
            case 'recalculateall': {
                const activeSeason = await statsSystem.getActiveSeason(guildId);
                if (!activeSeason) return message.reply("No active season set.");
                
                const msg = await message.reply(`🔄 Recalculating all stats for season **${activeSeason}**... This may take a moment.`);
                try {
                    const count = await statsSystem.recalculateAllSeasonStats(guildId, activeSeason);
                    await msg.edit(`✅ Successfully recalculated stats for **${count}** players in season **${activeSeason}**.`);
                } catch (e) {
                    await msg.edit(`❌ Error during recalculation: ${e.message}`);
                }
                break;
            }
            case 'recalculateoverall': {
                const msg = await message.reply(`🔄 Recalculating **ENTIRE OVERALL** stats (all seasons) for all players... This may take a moment.`);
                try {
                    const count = await statsSystem.recalculateEntireOverall(guildId);
                    await msg.edit(`✅ Successfully recalculated entire career stats for all players across all seasons.`);
                } catch (e) {
                    await msg.edit(`❌ Error during recalculation: ${e.message}`);
                }
                break;
            }
            case 'setpotdwindow': {
                const mentionedChannel = message.mentions.channels.first() || null;
                const rawInput = args.filter(a => !/^<#\d+>$/.test(a)).join(' ').trim();
                const parsedWindow = rawInput.match(/^today\s+(.+?)\s+(?:till|to|until)\s+(today|tomorrow)\s+(.+)$/i);
                if (!parsedWindow)
                    return message.reply("Usage: `?setpotdwindow today 8pm till tomorrow 3am [#channel]`.");
                const startTime = parsePotdClockTime(parsedWindow[1]);
                const endKeyword = parsedWindow[2].toLowerCase();
                const endTime = parsePotdClockTime(parsedWindow[3]);
                if (!startTime || !endTime)
                    return message.reply("Invalid time format. Example: `?setpotdwindow today 8pm till tomorrow 3am`.");
                const windowStartMinute = (startTime.hours * 60) + startTime.minutes;
                const windowEndMinute = (endTime.hours * 60) + endTime.minutes;
                const windowEndDayOffset = endKeyword === 'tomorrow' ? 1 : 0;
                if (mentionedChannel) {
                    await savePotdWindowSettings(guildId, mentionedChannel.id, windowStartMinute, windowEndMinute, windowEndDayOffset);
                    message.reply(`Player of the Day window set to today ${formatPotdTimeLabel(windowStartMinute)} till ${endKeyword} ${formatPotdTimeLabel(windowEndMinute)}.\nChannel: ${mentionedChannel}`);
                    break;
                }
                {
                    const categories = message.guild.channels.cache
                        .filter(c => c.type === discord_js_1.ChannelType.GuildCategory)
                        .map(c => ({ label: c.name, value: c.id }))
                        .slice(0, 25);
                    if (categories.length === 0)
                        return message.reply("No categories found in this server.");
                    const catRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
                        .setCustomId('potd_window_category_select')
                        .setPlaceholder('Select Category')
                        .addOptions(categories));
                    const prompt = await message.reply({
                        content: `Select a **Category** for the POTD voting channel.\nWindow: today ${formatPotdTimeLabel(windowStartMinute)} till ${endKeyword} ${formatPotdTimeLabel(windowEndMinute)}.`,
                        components: [catRow]
                    });
                    const categorySelection = await awaitComponent(prompt, {
                        filter: i => i.user.id === message.author.id && i.customId === 'potd_window_category_select',
                        time: 60000
                    }, "Error: Category selection timed out.", "Warning: Failed to select the POTD category.");
                    if (!categorySelection)
                        return;
                    await categorySelection.deferUpdate();
                    const categoryId = categorySelection.values[0];
                    const channels = message.guild.channels.cache
                        .filter(ch => ch.parentId === categoryId && ch.type === discord_js_1.ChannelType.GuildText)
                        .map(ch => ({ label: ch.name, value: ch.id }))
                        .slice(0, 25);
                    if (channels.length === 0) {
                        await categorySelection.editReply({ content: "No text channels found in this category.", components: [] }).catch(() => null);
                        return;
                    }
                    const chanRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
                        .setCustomId('potd_window_channel_select')
                        .setPlaceholder('Select Channel')
                        .addOptions(channels));
                    await categorySelection.editReply({ content: "Select the **POTD voting channel**:", components: [chanRow] }).catch(() => null);
                    const selection = await awaitComponent(prompt, {
                        filter: i => i.user.id === message.author.id && i.customId === 'potd_window_channel_select',
                        time: 60000
                    }, "Error: Channel selection timed out.", "Warning: Failed to select the POTD channel.");
                    if (!selection)
                        return;
                    const selectedChannel = await message.guild.channels.fetch(selection.values?.[0]).catch(() => null);
                    if (!selectedChannel || !selectedChannel.isTextBased?.()) {
                        await selection.update({ content: 'Warning: Invalid channel selected for POTD.', components: [] }).catch(() => null);
                        return;
                    }
                    await savePotdWindowSettings(guildId, selectedChannel.id, windowStartMinute, windowEndMinute, windowEndDayOffset);
                    await selection.update({
                        content: `Player of the Day window set to today ${formatPotdTimeLabel(windowStartMinute)} till ${endKeyword} ${formatPotdTimeLabel(windowEndMinute)}.\nChannel: ${selectedChannel}`,
                        components: []
                    }).catch(() => null);
                    break;
                }
                const channelRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ChannelSelectMenuBuilder()
                    .setCustomId('potd_window_channel_select')
                    .setPlaceholder('Select the POTD voting channel')
                    .setChannelTypes(discord_js_1.ChannelType.GuildText)
                    .setMinValues(1)
                    .setMaxValues(1));
                const prompt = await message.reply({
                    content: `Select the POTD voting channel for today ${formatPotdTimeLabel(windowStartMinute)} till ${endKeyword} ${formatPotdTimeLabel(windowEndMinute)}.`,
                    components: [channelRow]
                });
                const selection = await awaitComponent(prompt, {
                    filter: i => i.user.id === message.author.id && i.customId === 'potd_window_channel_select',
                    time: 60000
                }, "❌ Channel selection timed out.", "⚠️ Failed to select the POTD channel.");
                if (!selection)
                    return;
                const selectedChannel = selection.channels?.first() || await message.guild.channels.fetch(selection.values?.[0]).catch(() => null);
                if (!selectedChannel || !selectedChannel.isTextBased?.()) {
                    await selection.update({ content: '⚠️ Invalid channel selected for POTD.', components: [] }).catch(() => null);
                    return;
                }
                await savePotdWindowSettings(guildId, selectedChannel.id, windowStartMinute, windowEndMinute, windowEndDayOffset);
                await selection.update({
                    content: `Player of the Day window set to today ${formatPotdTimeLabel(windowStartMinute)} till ${endKeyword} ${formatPotdTimeLabel(windowEndMinute)}.\nChannel: ${selectedChannel}`,
                    components: []
                }).catch(() => null);
                break;
            }
            case 'setpotdresultchannel': {
                if (!message.mentions.channels.first()) {
                    const categories = message.guild.channels.cache
                        .filter(c => c.type === discord_js_1.ChannelType.GuildCategory)
                        .map(c => ({ label: c.name, value: c.id }))
                        .slice(0, 25);
                    if (categories.length === 0)
                        return message.reply("No categories found in this server.");
                    const catRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
                        .setCustomId('potd_result_category_select')
                        .setPlaceholder('Select Category')
                        .addOptions(categories));
                    const prompt = await message.reply({ content: "Select a **Category** for the POTD results channel:", components: [catRow] });
                    const categorySelection = await awaitComponent(prompt, {
                        filter: i => i.user.id === message.author.id && i.customId === 'potd_result_category_select',
                        time: 60000
                    }, "Error: Category selection timed out.", "Warning: Failed to select the POTD results category.");
                    if (!categorySelection)
                        return;
                    await categorySelection.deferUpdate();
                    const categoryId = categorySelection.values[0];
                    const channels = message.guild.channels.cache
                        .filter(ch => ch.parentId === categoryId && ch.type === discord_js_1.ChannelType.GuildText)
                        .map(ch => ({ label: ch.name, value: ch.id }))
                        .slice(0, 25);
                    if (channels.length === 0) {
                        await categorySelection.editReply({ content: "No text channels found in this category.", components: [] }).catch(() => null);
                        return;
                    }
                    const chanRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
                        .setCustomId('potd_result_channel_select')
                        .setPlaceholder('Select Channel')
                        .addOptions(channels));
                    await categorySelection.editReply({ content: "Select the **POTD results channel**:", components: [chanRow] }).catch(() => null);
                    const channelSelection = await awaitComponent(prompt, {
                        filter: i => i.user.id === message.author.id && i.customId === 'potd_result_channel_select',
                        time: 60000
                    }, "Error: Channel selection timed out.", "Warning: Failed to select the POTD results channel.");
                    if (!channelSelection)
                        return;
                    const selectedChannel = await message.guild.channels.fetch(channelSelection.values?.[0]).catch(() => null);
                    if (!selectedChannel || !selectedChannel.isTextBased?.()) {
                        await channelSelection.update({ content: "Please choose a text channel for POTD results.", components: [] }).catch(() => null);
                        return;
                    }
                    await db.run(`INSERT INTO potd_settings (guild_id, results_channel_id)
                        VALUES (?, ?)
                        ON CONFLICT(guild_id) DO UPDATE SET results_channel_id = excluded.results_channel_id`, guildId, selectedChannel.id);
                    await channelSelection.update({ content: `Player of the Day results channel set to ${selectedChannel}.`, components: [] }).catch(() => null);
                    break;
                }
                const channel = message.mentions.channels.first() || message.channel;
                if (!channel.isTextBased?.())
                    return message.reply("Please choose a text channel for POTD results.");
                await db.run(`INSERT INTO potd_settings (guild_id, results_channel_id)
                    VALUES (?, ?)
                    ON CONFLICT(guild_id) DO UPDATE SET results_channel_id = excluded.results_channel_id`, guildId, channel.id);
                message.reply(`Player of the Day results channel set to ${channel}.`);
                break;
            }
            case 'potdmultivote': {
                const toggle = (args[0] || '').toLowerCase();
                if (!['on', 'off', 'enable', 'disable'].includes(toggle))
                    return message.reply("Usage: `?potdmultivote on|off`.");
                const enabled = toggle === 'on' || toggle === 'enable';
                await db.run(`INSERT INTO potd_settings (guild_id, allow_multiple_votes)
                    VALUES (?, ?)
                    ON CONFLICT(guild_id) DO UPDATE SET allow_multiple_votes = excluded.allow_multiple_votes`,
                    guildId, enabled ? 1 : 0);
                message.reply(enabled ? 'POTD multiple voting enabled.' : 'POTD multiple voting disabled.');
                break;
            }
            case 'setpotdpingrole': {
                const role = message.mentions.roles.first();
                const toggle = (args[0] || '').toLowerCase();
                if (!role && !['off', 'none', 'clear', 'remove'].includes(toggle)) {
                    return message.reply("Usage: `?setpotdpingrole @Role` or `?setpotdpingrole off`.");
                }
                await db.run(`INSERT INTO potd_settings (guild_id, ping_role_id)
                    VALUES (?, ?)
                    ON CONFLICT(guild_id) DO UPDATE SET ping_role_id = excluded.ping_role_id`, guildId, role?.id || '');
                if (!role) {
                    return message.reply('POTD ping role cleared.');
                }
                return message.reply(`POTD ping role set to ${role}.`);
            }
            case 'potdpreview': {
                const previewArgs = args.length > 0 ? args : ['.bavuma'];
                const targetUser = await resolveTargetUser(message, previewArgs);
                if (!targetUser)
                    return message.reply("Usage: `?potdpreview [@user/username/IGN]`");
                const member = await message.guild.members.fetch(targetUser.id).catch(() => null);
                const displayName = member?.displayName || targetUser.username || targetUser.id;
                const avatarUrl = member?.displayAvatarURL({ extension: 'png', size: 256 }) || targetUser.displayAvatarURL({ extension: 'png', size: 256 }) || null;
                const embed = new discord_js_1.EmbedBuilder()
                    .setColor(0xF1C40F)
                    .setTitle('🏆 Player Of The Day')
                    .setDescription(`Match Day 1`)
                    .addFields({ name: 'Player', value: `<@${targetUser.id}>`, inline: true }, { name: 'Username', value: displayName, inline: true }, { name: 'Team', value: 'South Africa', inline: true }, { name: 'Performance', value: '74(48) & 0-12(1.0)', inline: false }, { name: 'Opponent', value: 'India', inline: true }, { name: 'Votes', value: '12', inline: true })
                    .setFooter({ text: 'Winning option 1' })
                    .setTimestamp();
                if (avatarUrl) {
                    embed.setThumbnail(avatarUrl);
                }
                return message.reply({ content: 'POTD winner embed preview:', embeds: [embed] });
            }
            case 'potdvotepreview': {
                const previewArgs = args.length > 0 ? args : ['.bavuma'];
                const targetUser = await resolveTargetUser(message, previewArgs);
                if (!targetUser)
                    return message.reply("Usage: `?potdvotepreview [@user/username/IGN]`");
                const settings = await db.get('SELECT allow_multiple_votes, ping_role_id FROM potd_settings WHERE guild_id = ?', guildId);
                const previewContent = buildPotdVotingMessage('Match Day 1', [
                    {
                        emoji: POTD_REACTION_EMOJIS[0],
                        playerLine: `<@${targetUser.id}>`,
                        teamLine: 'Team: South Africa',
                        detailLine: '74 (48) & 0/12 (1.0) vs India'
                    },
                    {
                        emoji: POTD_REACTION_EMOJIS[1],
                        playerLine: '@sampleplayer2',
                        teamLine: 'Team: Pakistan',
                        detailLine: '61 (39) & 1/20 (2.0) vs Australia'
                    },
                    {
                        emoji: POTD_REACTION_EMOJIS[2],
                        playerLine: '@sampleplayer3',
                        teamLine: 'Team: New Zealand',
                        detailLine: '44 (21) & 3/18 (4.0) vs England'
                    }
                ], !!settings?.allow_multiple_votes, settings?.ping_role_id ?? POTD_PING_ROLE_ID, true);
                const previewMessage = await message.channel.send({
                    content: previewContent,
                    allowedMentions: { parse: [] }
                });
                await addPotdPollReactions(previewMessage, 3);
                potdPreviewMessages.set(previewMessage.id, {
                    guildId,
                    optionCount: 3,
                    allowMultipleVotes: !!settings?.allow_multiple_votes,
                    expiresAt: Math.floor(Date.now() / 1000) + POTD_PREVIEW_MAX_AGE_SECONDS
                });
                return;
            }
            case 'potd': {
                const requestedDay = args[0]?.toLowerCase() === 'day' && /^\d+$/.test(args[1] || '') ? parseInt(args[1], 10) : null;
                const result = await createPotdPollForGuild(message.client, guildId, { requestedDay, replyMessage: message });
                if (!result.ok) {
                    if (result.userMessage) {
                        return message.reply(result.userMessage);
                    }
                    return;
                }
                if (result.targetChannel.id !== message.channel.id) {
                    await message.reply(`Player of the Day announced in ${result.targetChannel}.`);
                }
                break;
            }
            case 'restartpotd': {
                const clearOnly = String(args[0] || '').toLowerCase() === 'clear';
                const removed = await removeCurrentPotdPoll(message.client, guildId);
                if (!removed.ok) {
                    return message.reply(removed.userMessage || 'Unable to remove the current POTD poll.');
                }
                if (clearOnly) {
                    return message.reply(`Removed the current POTD poll for **${sanitizePotdDisplayLabel(removed.poll.label_text)}**. You can now run \`?potd\` again manually.`);
                }
                const requestedDay = removed.poll.label_text?.match(/^Match Day\s+(\d+)$/i) ? parseInt(removed.poll.label_text.match(/^Match Day\s+(\d+)$/i)[1], 10) : null;
                const result = await createPotdPollForGuild(message.client, guildId, { requestedDay, replyMessage: message });
                if (!result.ok) {
                    return message.reply(result.userMessage || 'Removed the current POTD poll, but failed to post the new one.');
                }
                if (result.targetChannel.id !== message.channel.id) {
                    return message.reply(`Restarted POTD and posted the new poll in ${result.targetChannel}.`);
                }
                return message.reply('Restarted the current POTD poll.');
            }
            case 'addstats': {
                const activeSeason = await statsSystem.getActiveSeason(guildId);
                if (!activeSeason)
                    return message.reply("No active season set. Use `?setupseason <name>` first.");
                
                if (!message.reference)
                    return message.reply("Please reply to an HC Bot match message to Use `?addstats`.");

                const repliedMsg = await message.channel.messages.fetch(message.reference.messageId);
                if (!repliedMsg)
                    return message.reply("Could not find the replied message.");

                const existingMatch = await db.get('SELECT * FROM stats_matches WHERE message_id = ?', repliedMsg.id);
                if (existingMatch)
                    return message.reply(`⚠️ This match (${activeSeason} - Match ${existingMatch.match_number}) has already been recorded.`);

                let addedCount = 0;
                const matchId = `M${repliedMsg.id.slice(-6)}${Date.now().toString().slice(-4)}`;
                const matchTimestamp = repliedMsg.createdTimestamp || Date.now();
                const reservationContext = await resolveReservationContextForStats(guildId, activeSeason, message.channel.id, matchTimestamp);
                
                // Get next match number for this season
                const lastMatch = await db.get('SELECT MAX(match_number) as maxNum FROM stats_matches WHERE guild_id = ? AND season_name = ?', guildId, activeSeason);
                const nextMatchNum = (lastMatch?.maxNum || 0) + 1;

                // Collect all possible text sources
                let allSources = [];
                
                // 1. Add Message Content - Parse only the FIRST code block
                if (repliedMsg.content) {
                    const segments = repliedMsg.content.split(/```/);
                    let foundBlocks = 0;
                    for (let i = 1; i < segments.length; i += 2) {
                        const textBefore = segments[i-1].toLowerCase();
                        const blockContent = segments[i].replace(/^[a-z]*\n?/, ''); 
                        
                        if (textBefore.includes('rep') || textBefore.includes('replacement')) {
                            continue; // Explicitly skip if labeled
                        }
                        
                        allSources.push(blockContent);
                        foundBlocks++;
                        break; // Only take the first valid block
                    }
                    
                    if (foundBlocks === 0 && repliedMsg.content.trim() && !repliedMsg.content.includes('```')) {
                        allSources.push(repliedMsg.content);
                    }
                }

                // 2. Add Embed Content - Parse only the FIRST valid embed
                let validEmbedFound = false;
                for (const embed of repliedMsg.embeds) {
                    if (embed.footer?.text?.includes('REP') || (embed.title && embed.title.includes('Replacement'))) {
                        continue; 
                    }
                    
                    if (validEmbedFound) continue; // Skip second embed and beyond

                    let hasData = false;
                    if (embed.description) {
                        allSources.push(embed.description);
                        hasData = true;
                    }
                    if (embed.fields && embed.fields.length > 0) {
                        embed.fields.forEach(f => allSources.push(f.value));
                        hasData = true;
                    }
                    
                    if (hasData) validEmbedFound = true;
                }

                if (allSources.length === 0)
                    return message.reply("Replied message does not contain any usable content or embeds.");

                let transactionActive = false;
                try {
                    await db.run('BEGIN TRANSACTION');
                    transactionActive = true;
                    const processedUsers = new Set();
                    for (const source of allSources) {
                        const lines = source.split('\n').filter(line => line.trim().length > 0);
                        for (const line of lines) {
                            const parts = line.split(',').map(p => p.trim());
                            if (parts.length < 7) continue;

                            const [uId, runs, ballsP, runsC, ballsB, wickets, notOut] = parts;
                            if (!uId.match(/^\d+$/)) continue; // Ensure it's a User ID
                            if (processedUsers.has(uId)) continue; // Prevent double counting same user in one match

                            const matchData = {
                                runs: parseInt(runs) || 0,
                                balls_played: parseInt(ballsP) || 0,
                                runs_conceded: parseInt(runsC) || 0,
                                balls_bowled: parseInt(ballsB) || 0,
                                wickets: parseInt(wickets) || 0,
                                not_out: parseInt(notOut) || 0
                            };

                            const matchMVP = await statsSystem.updatePlayerStats(guildId, activeSeason, uId, matchData);
                            const resolvedTeam = await resolveUserTeamForReservation(guildId, uId, reservationContext, message.guild);
                            const opponentTeamId = resolvedTeam
                                ? (resolvedTeam.team_id === reservationContext?.team_a_id ? reservationContext?.team_b_id : reservationContext?.team_a_id)
                                : null;
                            const opponentTeamName = resolvedTeam
                                ? (resolvedTeam.team_id === reservationContext?.team_a_id ? reservationContext?.team_b_name : reservationContext?.team_a_name)
                                : null;

                            await db.run(`
                                INSERT INTO stats_matches (match_id, guild_id, season_name, user_id, runs, balls_played, runs_conceded, balls_bowled, wickets, not_out, match_mvp, timestamp, message_id, match_number)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            `, [
                                matchId, guildId, activeSeason, uId, matchData.runs, matchData.balls_played, matchData.runs_conceded, matchData.balls_bowled, matchData.wickets, matchData.not_out, matchMVP, matchTimestamp, repliedMsg.id, nextMatchNum
                            ]);
                            await db.run(`
                                INSERT INTO stats_match_context (guild_id, match_id, user_id, season_name, source_message_id, source_channel_id, match_timestamp, team_id, opponent_team_id, team_name_snapshot, opponent_name_snapshot, fixture_day_number)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            `, [
                                guildId,
                                matchId,
                                uId,
                                activeSeason,
                                repliedMsg.id,
                                message.channel.id,
                                matchTimestamp,
                                resolvedTeam?.team_id || null,
                                opponentTeamId || null,
                                resolvedTeam?.team_name || null,
                                opponentTeamName || null,
                                reservationContext?.fixture_day_number || null
                            ]);
                            processedUsers.add(uId);
                            addedCount++;
                        }
                    }
                    
                    if (addedCount === 0) {
                        if (transactionActive) await db.run('ROLLBACK');
                        transactionActive = false;
                        return message.reply("❌ No valid match data found in the replied message (or only REP embeds found).");
                    }

                    await db.run('COMMIT');
                    transactionActive = false;
                    await updateCapRoles(message.guild, activeSeason);
                    message.reply(`✅ Successfully recorded match **${nextMatchNum}** for ${addedCount} players in season **${activeSeason}**.`);
                } catch (e) {
                    if (transactionActive) await db.run('ROLLBACK');
                    throw e;
                }
                break;
            }
            case 'undostats':
            case 'removematch': {
                const seasons = await db.all('SELECT DISTINCT season_name FROM stats_matches WHERE guild_id = ? ORDER BY season_name DESC', guildId);
                if (seasons.length === 0) return message.reply("No matches found to remove.");

                const seasonSelect = new discord_js_1.StringSelectMenuBuilder()
                    .setCustomId('rm_season_select')
                    .setPlaceholder('Select a season')
                    .addOptions(seasons.map(s => ({ label: s.season_name, value: s.season_name })));

                const row = new discord_js_1.ActionRowBuilder().addComponents(seasonSelect);
                const response = await message.reply({ content: 'Select the season to remove matches from:', components: [row] });

                const collector = response.createMessageComponentCollector({ 
                    filter: i => i.user.id === message.author.id,
                    time: 60000 
                });

                collector.on('collect', async i => {
                    if (i.customId === 'rm_season_select') {
                        await i.deferUpdate();
                        const selectedSeason = i.values[0];
                        const matches = await db.all('SELECT match_id, match_number, timestamp FROM stats_matches WHERE guild_id = ? AND season_name = ? GROUP BY match_id ORDER BY match_number DESC LIMIT 25', guildId, selectedSeason);
                        
                        if (matches.length === 0) return i.editReply({ content: `No matches found for season ${selectedSeason}.`, components: [] });

                        const matchOptions = await Promise.all(matches.map(async (m) => {
                            const dateStr = await formatDate(guildId, m.timestamp);
                            return {
                                label: `Match ${m.match_number}`,
                                description: dateStr,
                                value: m.match_id
                            };
                        }));

                        const matchSelect = new discord_js_1.StringSelectMenuBuilder()
                            .setCustomId('rm_match_select')
                            .setPlaceholder('Select one or more matches to remove')
                            .setMinValues(1)
                            .setMaxValues(matchOptions.length)
                            .addOptions(matchOptions);
                        const row2 = new discord_js_1.ActionRowBuilder().addComponents(matchSelect);
                        await i.editReply({ content: `Select matches from **${selectedSeason}** to remove:`, components: [row2] });
                    } else if (i.customId === 'rm_match_select') {
                        const selectedMatchIds = i.values;
                        const matchCount = selectedMatchIds.length;

                        // Confirmation Step
                        await i.update({ content: `⚠️ **Are you sure?** You are about to rollback **${matchCount}** matches. This will permanently remove all stats from these matches.`, components: [] });
                        const confirmRow = new discord_js_1.ActionRowBuilder().addComponents(
                            new discord_js_1.ButtonBuilder().setCustomId('confirm_yes').setLabel('Confirm Rollback').setStyle(discord_js_1.ButtonStyle.Danger),
                            new discord_js_1.ButtonBuilder().setCustomId('confirm_no').setLabel('Cancel').setStyle(discord_js_1.ButtonStyle.Secondary)
                        );
                        await i.editReply({ components: [confirmRow] });

                        const confirmCollector = i.channel.createMessageComponentCollector({ filter: c => c.user.id === message.author.id, time: 30000, max: 1 });
                        confirmCollector.on('collect', async ci => {
                            if (ci.customId === 'confirm_yes') {
                                await ci.deferUpdate();
                                let transactionActive = false;
                                try {
                                    await db.run('BEGIN TRANSACTION');
                                    transactionActive = true;
                                    
                                    const affectedSeasons = new Set();

                                    for (const rmMatchId of selectedMatchIds) {
                                        const matchesToRemove = await db.all('SELECT * FROM stats_matches WHERE match_id = ? AND guild_id = ?', rmMatchId, guildId);
                                        if (matchesToRemove.length === 0) continue;

                                        const sName = matchesToRemove[0].season_name;
                                        affectedSeasons.add(sName);

                                        for (const match of matchesToRemove) {
                                            await db.run('DELETE FROM stats_matches WHERE match_id = ? AND guild_id = ? AND user_id = ?', rmMatchId, guildId, match.user_id);
                                            await db.run('DELETE FROM stats_match_context WHERE guild_id = ? AND match_id = ? AND user_id = ?', guildId, rmMatchId, match.user_id);
                                            await statsSystem.recalculatePlayerStats(guildId, match.season_name, match.user_id);
                                        }
                                    }
                                    await db.run('COMMIT');
                                    transactionActive = false;
                                    await (0, auditLog_1.appendAdminAuditLog)({
                                        guildId,
                                        actorId: message.author.id,
                                        commandName: 'removematch',
                                        summary: `Rolled back ${matchCount} match(es) from season ${selectedSeason}.`,
                                        targetSummary: selectedMatchIds.join(', '),
                                        channelId: message.channel.id
                                    });
                                    for (const sName of affectedSeasons) {
                                        await updateCapRoles(message.guild, sName);
                                    }
                                    await ci.editReply({ content: `✅ Successfully rolled back **${matchCount}** matches.`, components: [] });
                                } catch (e) {
                                    if (transactionActive) await db.run('ROLLBACK');
                                    console.error(e);
                                    await ci.editReply({ content: "❌ Error during rollback.", components: [] });
                                }
                            } else {
                                await ci.update({ content: '❌ Rollback cancelled.', components: [] });
                            }
                        });
                        collector.stop();
                    }
                });
                break;
            }
            case 'removeplayer': {
                const seasons = await db.all('SELECT DISTINCT season_name FROM stats_matches WHERE guild_id = ? ORDER BY season_name DESC', guildId);
                if (seasons.length === 0) return message.reply("No matches found.");

                const seasonSelect = new discord_js_1.StringSelectMenuBuilder()
                    .setCustomId('rp_season_select')
                    .setPlaceholder('Select a season')
                    .addOptions(seasons.map(s => ({ label: s.season_name, value: s.season_name })));

                const row = new discord_js_1.ActionRowBuilder().addComponents(seasonSelect);
                const response = await message.reply({ content: 'Select the season:', components: [row] });

                const collector = response.createMessageComponentCollector({ 
                    filter: i => i.user.id === message.author.id,
                    time: 60000 
                });

                let selectedSeason = '';
                let selectedMatchId = '';

                collector.on('collect', async i => {
                    await i.deferUpdate();
                    if (i.customId === 'rp_season_select') {
                        selectedSeason = i.values[0];
                        const matches = await db.all('SELECT match_id, match_number, timestamp FROM stats_matches WHERE guild_id = ? AND season_name = ? GROUP BY match_id ORDER BY match_number DESC LIMIT 25', guildId, selectedSeason);
                        
                        if (matches.length === 0) return i.editReply({ content: `No matches found for ${selectedSeason}.`, components: [] });

                        const matchOptions = await Promise.all(matches.map(async (m) => {
                            const dateStr = await formatDate(guildId, m.timestamp);
                            return {
                                label: `Match ${m.match_number}`,
                                description: dateStr,
                                value: m.match_id
                            };
                        }));

                        const matchSelect = new discord_js_1.StringSelectMenuBuilder()
                            .setCustomId('rp_match_select')
                            .setPlaceholder('Select a match')
                            .addOptions(matchOptions);
                        const row2 = new discord_js_1.ActionRowBuilder().addComponents(matchSelect);
                        await i.editReply({ content: `Select a match from **${selectedSeason}**:`, components: [row2] });
                    } else if (i.customId === 'rp_match_select') {
                        selectedMatchId = i.values[0];
                        const players = await db.all('SELECT user_id, runs, wickets FROM stats_matches WHERE match_id = ? AND guild_id = ? LIMIT 25', selectedMatchId, guildId);
                        
                        const playerOptions = await Promise.all(players.map(async p => {
                            let name = p.user_id;
                            try {
                                const user = await message.client.users.fetch(p.user_id);
                                name = user.username;
                            } catch (e) {}
                            return { 
                                label: name, 
                                description: `${p.runs} runs, ${p.wickets} wkts`, 
                                value: p.user_id 
                            };
                        }));

                        const playerSelect = new discord_js_1.StringSelectMenuBuilder()
                            .setCustomId('rp_player_select')
                            .setPlaceholder('Select a player to remove')
                            .addOptions(playerOptions);

                        const row3 = new discord_js_1.ActionRowBuilder().addComponents(playerSelect);
                        await i.editReply({ content: `Select a player to remove from this match:`, components: [row3] });
                    } else if (i.customId === 'rp_player_select') {
                        const targetUserId = i.values[0];
                        const match = await db.get('SELECT * FROM stats_matches WHERE match_id = ? AND guild_id = ? AND user_id = ?', selectedMatchId, guildId, targetUserId);
                        
                        if (!match) return i.editReply({ content: "Record not found.", components: [] });

                        let transactionActive = false;
                        try {
                            await db.run('BEGIN TRANSACTION');
                            transactionActive = true;
                            await db.run('DELETE FROM stats_matches WHERE match_id = ? AND guild_id = ? AND user_id = ?', selectedMatchId, guildId, targetUserId);
                            await db.run('DELETE FROM stats_match_context WHERE guild_id = ? AND match_id = ? AND user_id = ?', guildId, selectedMatchId, targetUserId);
                            await statsSystem.recalculatePlayerStats(guildId, match.season_name, match.user_id);
                            await db.run('COMMIT');
                            transactionActive = false;
                            await updateCapRoles(message.guild, match.season_name);
                            
                            let userName = targetUserId;
                            try { const u = await message.client.users.fetch(targetUserId); userName = u.username; } catch(e) {}
                            
                            await i.editReply({ content: `✅ Removed **${userName}** from **Match ${match.match_number}** in season **${match.season_name}**.`, components: [] });
                        } catch (e) {
                            if (transactionActive) await db.run('ROLLBACK');
                            console.error(e);
                            await i.editReply({ content: "❌ Error during removal.", components: [] });
                        }
                        collector.stop();
                    }
                });
                break;
            }
            case 'rps':
            case 'removeplayerstats': {
                const mention = message.mentions.users.first();
                let targetUser = mention || message.author;
                
                if (!mention && args.length > 0) {
                    const searchTerm = args.find(a => !a.startsWith('<@'));
                    if (searchTerm) {
                        const player = await db.get('SELECT discord_id FROM auction_players WHERE guild_id = ? AND ign LIKE ?', guildId, `%${searchTerm}%`);
                        if (player) {
                            try { targetUser = await message.client.users.fetch(player.discord_id); } catch (e) {}
                        } else {
                            try {
                                const members = await message.guild.members.fetch({ query: searchTerm, limit: 1 });
                                const member = members.first();
                                if (member) targetUser = member.user;
                            } catch (e) {}
                        }
                    }
                }

                if (!targetUser) return message.reply("User not found.");

                const curSeason = await statsSystem.getActiveSeason(guildId);
                if (!curSeason) return message.reply("No active season found.");

                const playerMatches = await db.all('SELECT * FROM stats_matches WHERE guild_id = ? AND season_name = ? AND user_id = ? ORDER BY match_number DESC LIMIT 25', guildId, curSeason, targetUser.id);
                
                if (playerMatches.length === 0) return message.reply(`No match records found for **${targetUser.username}** in season **${curSeason}**.`);

                const matchOptions = await Promise.all(playerMatches.map(async (m) => {
                    const dateStr = await formatDate(guildId, m.timestamp, false);
                    return {
                        label: `Match ${m.match_number}`,
                        description: `${m.runs} runs, ${m.wickets} wkts (${dateStr})`,
                        value: m.match_id
                    };
                }));

                const matchSelect = new discord_js_1.StringSelectMenuBuilder()
                    .setCustomId('rps_match_select')
                    .setPlaceholder('Select a match to remove stats from')
                    .addOptions(matchOptions);
                const row = new discord_js_1.ActionRowBuilder().addComponents(matchSelect);
                const response = await message.reply({ content: `Select a match to remove **${targetUser.username}**'s stats from in **${curSeason}**:`, components: [row] });

                const collector = response.createMessageComponentCollector({ 
                    filter: i => i.user.id === message.author.id,
                    time: 60000 
                });

                collector.on('collect', async i => {
                    await i.deferUpdate();
                    if (i.customId === 'rps_match_select') {
                        const selectedMatchId = i.values[0];
                        const match = await db.get('SELECT * FROM stats_matches WHERE match_id = ? AND guild_id = ? AND user_id = ?', selectedMatchId, guildId, targetUser.id);

                        if (!match) return i.editReply({ content: "Record not found.", components: [] });

                        let transactionActive = false;
                        try {
                            await db.run('BEGIN TRANSACTION');
                            transactionActive = true;

                            await db.run('DELETE FROM stats_matches WHERE match_id = ? AND guild_id = ? AND user_id = ?', selectedMatchId, guildId, targetUser.id);
                            await db.run('DELETE FROM stats_match_context WHERE guild_id = ? AND match_id = ? AND user_id = ?', guildId, selectedMatchId, targetUser.id);
                            await statsSystem.recalculatePlayerStats(guildId, curSeason, targetUser.id);
                            await db.run('COMMIT');
                            transactionActive = false;

                            await updateCapRoles(message.guild, curSeason);
                            await i.editReply({ content: `✅ Removed **${targetUser.username}** from **Match ${match.match_number}** in season **${curSeason}**.`, components: [] });
                        } catch (e) {
                            if (transactionActive) await db.run('ROLLBACK');
                            console.error(e);
                            await i.editReply({ content: "❌ Error during removal.", components: [] });
                        }
                        collector.stop();
                    }
                });
                break;
            }
            case 'auctionseason': {
                const seasons = await db.all('SELECT DISTINCT season_name FROM stats_seasons WHERE guild_id = ?', guildId);
                if (seasons.length === 0)
                    return message.reply("No seasons found. Please create a season first.");
                const options = seasons.map(s => ({
                    label: s.season_name,
                    value: s.season_name
                }));
                options.push({ label: "Overall Career", value: "OVERALL" });
                const row = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
                    .setCustomId('auction_season_select')
                    .setPlaceholder('Select season for Auction stats')
                    .addOptions(options.slice(0, 25)));
                const response = await message.reply({ content: "Select which season stats should be shown during auctions:", components: [row] });
                const selection = await awaitComponent(response, { filter: i => i.user.id === message.author.id, time: 60000, max: 1 }, "❌ Selection timed out.", "⚠️ Failed to update auction season.");
                if (!selection)
                    return;
                await selection.deferUpdate();
                const selectedSeason = selection.values[0];
                await db.run(`INSERT INTO guild_settings (guild_id, auction_stats_season) VALUES (?, ?) 
                                  ON CONFLICT(guild_id) DO UPDATE SET auction_stats_season = excluded.auction_stats_season`, [guildId, selectedSeason]);
                await selection.editReply({ content: `✅ Auction stats set to: **${selectedSeason}**`, components: [] });
                break;
            }
            case 'auctiontime': {
                const current = await db.get('SELECT auction_bid_timer_seconds FROM guild_settings WHERE guild_id = ?', guildId);
                const currentSeconds = Math.max(5, Math.min(120, parseInt(String(current?.auction_bid_timer_seconds ?? 15), 10) || 15));
                if (!args[0]) {
                    return message.reply(`Current auction bid timer is **${currentSeconds}s**.\nUsage: \`?auctiontime <5-120>\`\nThis controls how long the auction stays open after each valid bid.`);
                }
                const seconds = parseInt(args[0], 10);
                if (!Number.isInteger(seconds) || seconds < 5 || seconds > 120) {
                    return message.reply("Usage: `?auctiontime <5-120>`");
                }
                await db.run(`INSERT INTO guild_settings (guild_id, auction_bid_timer_seconds) VALUES (?, ?)
                              ON CONFLICT(guild_id) DO UPDATE SET auction_bid_timer_seconds = excluded.auction_bid_timer_seconds`, guildId, seconds);
                message.reply(`Done: Auction bid timer set to **${seconds}s**.\nThis is the countdown after each valid bid before **GOING ONCE** starts.`);
                break;
            }
            case 'goingtime': {
                const current = await db.get('SELECT auction_call_timer_seconds FROM guild_settings WHERE guild_id = ?', guildId);
                const currentSeconds = Math.max(1, Math.min(30, parseInt(String(current?.auction_call_timer_seconds ?? 2), 10) || 2));
                if (!args[0]) {
                    return message.reply(`Current GOING ONCE / GOING TWICE timer is **${currentSeconds}s** each.\nUsage: \`?goingtime <1-30>\``);
                }
                const seconds = parseInt(args[0], 10);
                if (!Number.isInteger(seconds) || seconds < 1 || seconds > 30) {
                    return message.reply("Usage: `?goingtime <1-30>`");
                }
                await db.run(`INSERT INTO guild_settings (guild_id, auction_call_timer_seconds) VALUES (?, ?)
                              ON CONFLICT(guild_id) DO UPDATE SET auction_call_timer_seconds = excluded.auction_call_timer_seconds`, guildId, seconds);
                message.reply(`Done: GOING ONCE and GOING TWICE are now **${seconds}s** each.`);
                break;
            }
            case 'tots': {
                let seasonName = await statsSystem.getActiveSeason(guildId);
                const seasonArg = args.find(arg => !arg.startsWith('<@'));
                if (seasonArg) {
                    const seasonRecord = await db.get(
                        'SELECT season_name FROM stats_seasons WHERE guild_id = ? AND (season_name = ? OR season_name = ? OR season_name = ?)',
                        guildId,
                        seasonArg,
                        `S${seasonArg}`,
                        `Season${seasonArg}`
                    );
                    if (!seasonRecord) {
                        return message.reply(`Season **${seasonArg}** was not found.`);
                    }
                    seasonName = seasonRecord.season_name;
                }

                if (!seasonName) {
                    return message.reply("No active season found. Usage: `?tots [SeasonName]`");
                }

                const confirmed = await (0, utils_1.askConfirmation)(
                    message,
                    `Are you sure **${seasonName}** has ended?\nIf you continue, I will generate the **Top 11 TOTS** based on **MVP**.`
                );
                if (!confirmed) {
                    return;
                }

                const topRows = await db.all(
                    `SELECT *
                     FROM stats_players
                     WHERE guild_id = ? AND season_name = ? AND matches_played > 0
                     ORDER BY total_mvp DESC, matches_played DESC, runs DESC, wickets DESC
                     LIMIT 11`,
                    guildId,
                    seasonName
                );

                if (topRows.length === 0) {
                    return message.reply(`No completed stats were found for **${seasonName}**.`);
                }

                const backgroundChoiceRow = new discord_js_1.ActionRowBuilder().addComponents(
                    new discord_js_1.ButtonBuilder()
                        .setCustomId(`tots_bg_stadium_${message.id}`)
                        .setLabel('Stadium Background')
                        .setStyle(discord_js_1.ButtonStyle.Primary),
                    new discord_js_1.ButtonBuilder()
                        .setCustomId(`tots_bg_red_${message.id}`)
                        .setLabel('Red Background')
                        .setStyle(discord_js_1.ButtonStyle.Danger)
                );
                const backgroundPrompt = await message.reply({
                    content: `Choose the TOTS background for **${formatSeasonLabel(seasonName)}**:`,
                    components: [backgroundChoiceRow]
                });
                const backgroundSelection = await awaitComponent(
                    backgroundPrompt,
                    {
                        filter: i => i.user.id === message.author.id && [`tots_bg_stadium_${message.id}`, `tots_bg_red_${message.id}`].includes(i.customId),
                        time: 60000,
                        max: 1
                    },
                    '❌ Background selection timed out.',
                    '⚠️ Failed to choose the TOTS background.'
                );
                if (!backgroundSelection) {
                    return;
                }
                await backgroundSelection.deferUpdate();

                const useRedBackground = backgroundSelection.customId === `tots_bg_red_${message.id}`;
                await backgroundSelection.editReply({
                    content: `Generating **${formatSeasonLabel(seasonName)}** TOTS with the **${useRedBackground ? 'red' : 'stadium'}** background...`,
                    components: []
                });

                const totsPlayers = await Promise.all(topRows.map(async row => {
                    const member = await message.guild.members.fetch(row.user_id).catch(() => null);
                    if (member) {
                        return {
                            username: member.displayName || member.user.username,
                            avatarUrl: member.displayAvatarURL({ extension: 'png', size: 256 }),
                            mvp: Number(row.total_mvp || 0),
                            userId: row.user_id
                        };
                    }

                    const user = await message.client.users.fetch(row.user_id).catch(() => null);
                    if (user) {
                        return {
                            username: user.username,
                            avatarUrl: user.displayAvatarURL({ extension: 'png', size: 256 }),
                            mvp: Number(row.total_mvp || 0),
                            userId: row.user_id
                        };
                    }

                    return {
                        username: row.user_id,
                        avatarUrl: null,
                        mvp: Number(row.total_mvp || 0),
                        userId: row.user_id
                    };
                }));

                const safeSeasonName = seasonName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
                const attachmentName = `${safeSeasonName || 'season'}_${useRedBackground ? 'red' : 'stadium'}_tots.png`;
                const imageBuffer = await renderTotsImage(totsPlayers, {
                    subtitle: formatSeasonLabel(seasonName),
                    config: useRedBackground ? redTotsLayout : undefined,
                    templatePath: useRedBackground ? path.join(__dirname, "redtotseason.png") : undefined
                });
                const attachment = new discord_js_1.AttachmentBuilder(imageBuffer, { name: attachmentName });
                await message.reply({ files: [attachment] });
                break;
            }
            case 'listadmins': {
                await message.guild.members.fetch();

                const globalAdmins = [];
                for (const id of utils_1.ADMIN_USER_IDS) {
                    try {
                        const user = await message.client.users.fetch(id);
                        globalAdmins.push(`• **${user.username}** (ID: ${id})`);
                    } catch (e) {}
                }

                const globalManagers = [];
                for (const id of (0, utils_1.getGlobalManagersList)()) {
                    try {
                        const user = await message.client.users.fetch(id);
                        globalManagers.push(`• **${user.username}** (ID: ${id})`);
                    } catch (e) {}
                }

                const superAdminRoleName = utils_1.SUPER_ADMIN_ROLE_NAME;
                const superAdminRole = message.guild.roles.cache.find(r => r.name === superAdminRoleName);
                const superAdmins = superAdminRole ? superAdminRole.members.map(m => `• **${m.user.username}** (ID: ${m.id})`) : [];

                const adminRoleName = utils_1.ADMIN_ROLE_NAME;
                const adminRole = message.guild.roles.cache.find(r => r.name === adminRoleName);
                const admins = adminRole ? adminRole.members.map(m => `• **${m.user.username}** (ID: ${m.id})`) : [];

                const pages = [
                    { title: 'Global Admins', data: globalAdmins.length ? globalAdmins.join('\n') : 'None' },
                    { title: 'Global Managers', data: globalManagers.length ? globalManagers.join('\n') : 'None' },
                    { title: 'Super Admins', data: superAdmins.length ? superAdmins.join('\n') : 'None' },
                    { title: 'Admins', data: admins.length ? admins.join('\n') : 'None' }
                ];

                let page = 0;
                const buildEmbed = (index) => new discord_js_1.EmbedBuilder()
                    .setTitle(`🛡️ Bot Administrators - ${pages[index].title}`)
                    .setDescription(pages[index].data)
                    .setColor(0xFF0000)
                    .setFooter({ text: `Page ${index + 1} of ${pages.length} | Prefix: ?` });

                const response = await message.reply({ 
                    embeds: [buildEmbed(page)], 
                    components: [(0, utils_1.buildPagedButtonRow)('listadmins', page, pages.length)] 
                });

                const collector = response.createMessageComponentCollector({
                    filter: i => i.user.id === message.author.id && ['listadmins_prev', 'listadmins_next'].includes(i.customId),
                    time: 300000
                });

                collector.on('collect', async (i) => {
                    if (i.customId === 'listadmins_prev' && page > 0) page--;
                    if (i.customId === 'listadmins_next' && page < pages.length - 1) page++;
                    await i.update({ embeds: [buildEmbed(page)], components: [(0, utils_1.buildPagedButtonRow)('listadmins', page, pages.length)] }).catch(() => null);
                });

                collector.on('end', () => { response.edit({ components: [] }).catch(() => null); });
                break;
            }            case 'removeadmin': {
                const ownerId = '1007182472401924126';
                if (message.author.id !== ownerId) {
                    return message.reply("❌ Only the bot owner can use this command.");
                }

                const adminRoleName = 'Auction Admin';
                const adminRole = message.guild.roles.cache.find(r => r.name === adminRoleName);
                if (!adminRole) return message.reply(`Role "${adminRoleName}" not found.`);

                await message.guild.members.fetch();
                const adminMembers = adminRole.members.filter(m => m.id !== ownerId); 

                if (adminMembers.size === 0) {
                    return message.reply("No other admins found to remove.");
                }

                const options = adminMembers.map(m => ({
                    label: m.user.username,
                    description: `ID: ${m.id}`,
                    value: m.id
                })).slice(0, 25);

                const selectMenu = new discord_js_1.StringSelectMenuBuilder()
                    .setCustomId('remove_admin_select')
                    .setPlaceholder('Select one or more admins to remove')
                    .setMinValues(1)
                    .setMaxValues(options.length)
                    .addOptions(options);

                const row = new discord_js_1.ActionRowBuilder().addComponents(selectMenu);
                const response = await message.reply({ content: "Select the admins you want to **REMOVE**:", components: [row] });

                try {
                    const selectInteraction = await awaitComponent(response, {
                        filter: i => i.user.id === message.author.id && i.customId === 'remove_admin_select',
                        time: 60000
                    }, "❌ Selection timed out.", "⚠️ Failed to choose admins.");
                    if (!selectInteraction)
                        return;
                    await selectInteraction.deferUpdate();
                    const selectedIds = selectInteraction.values;
                    const selectedMembers = adminMembers.filter(m => selectedIds.includes(m.id));
                    const names = selectedMembers.map(m => `**${m.user.username}**`).join(', ');

                    if (!await (0, utils_1.askConfirmation)(message, `Are you sure you want to remove the admin role from: ${names}?`)) {
                        return await selectInteraction.editReply({ content: "❌ Action cancelled.", components: [] });
                    }

                    for (const targetId of selectedIds) {
                        const targetMember = await message.guild.members.fetch(targetId);
                        if (targetMember) await targetMember.roles.remove(adminRole);
                    }
                    
                    await selectInteraction.editReply({ content: `✅ Successfully removed admin role from: ${names}.`, components: [] });
                } catch (e) {
                    console.error(e);
                }
                break;
            }
            case 'renameseason': {
                if (args.length < 2) return message.reply("Usage: `?renameseason [OldName] [NewName]` (e.g. `?renameseason S11 S12`) ");
                
                const oldName = args[0];
                const newName = args[1];
                
                const oldNum = parseInt(oldName.replace(/\D/g, ''));
                const newNum = parseInt(newName.replace(/\D/g, ''));
                
                const oldFormatted = oldName.startsWith('S') ? oldName : `S${oldName}`;
                const newFormatted = newName.startsWith('S') ? newName : `S${newName}`;

                if (!await (0, utils_1.askConfirmation)(message, `Are you sure you want to **RENAME** all data from **${oldFormatted}** to **${newFormatted}**?\nThis affects Stats, Point Table, Reservations, and Fixtures.`)) return;

                // 1. Stats System
                await db.run('UPDATE stats_seasons SET season_name = ? WHERE guild_id = ? AND season_name = ?', newFormatted, guildId, oldFormatted);
                await db.run('UPDATE stats_matches SET season_name = ? WHERE guild_id = ? AND season_name = ?', newFormatted, guildId, oldFormatted);
                await db.run('UPDATE stats_players SET season_name = ? WHERE guild_id = ? AND season_name = ?', newFormatted, guildId, oldFormatted);
                
                // 2. Point Table System (Uses numbers)
                if (!isNaN(oldNum) && !isNaN(newNum)) {
                    await db.run('UPDATE pt_settings SET current_season = ? WHERE guild_id = ? AND current_season = ?', newNum, guildId, oldNum);
                    await db.run('UPDATE pt_matches SET season = ? WHERE guild_id = ? AND season = ?', newNum, guildId, oldNum);
                }

                // 3. Scheduling & Reservations
                await db.run('UPDATE guild_settings SET schedule_season = ? WHERE guild_id = ? AND schedule_season = ?', newFormatted, guildId, oldFormatted);
                await db.run('UPDATE match_reservations SET season_name = ? WHERE guild_id = ? AND season_name = ?', newFormatted, guildId, oldFormatted);

                // 4. Generated Fixtures
                await db.run('UPDATE generated_fixtures SET season_name = ? WHERE guild_id = ? AND season_name = ?', newFormatted, guildId, oldFormatted);

                message.reply(`✅ Successfully renamed **${oldFormatted}** to **${newFormatted}** across all systems.`);
                break;
            }
            case 'listmatches':
            case 'lm': {
                const settings = await db.get('SELECT current_season FROM pt_settings WHERE guild_id = ?', guildId);
                const season = settings ? settings.current_season : 1;
                const ptMatches = await db.all('SELECT * FROM pt_matches WHERE guild_id = ? AND season = ? ORDER BY match_number ASC', guildId, season);

                if (ptMatches.length === 0) return message.reply(`No matches found for Season ${season} in the Point Table system.`);
                const itemsPerPage = 10;
                const totalPages = Math.ceil(ptMatches.length / itemsPerPage);
                let currentPage = 0;

                const generateEmbed = (page) => {
                    const start = page * itemsPerPage;
                    const end = start + itemsPerPage;
                    const pageMatches = ptMatches.slice(start, end);

                    const list = pageMatches.map(m => {
                        const date = new Date(m.timestamp).toLocaleDateString();
                        const winnerText = m.winner ? `🏆 Winner: **${m.winner}**` : '🤝 Draw';
                        return `**Match ${m.match_number}** | ${date}\n${m.team_a} ${m.score_a_runs}/${m.score_a_wickets} vs ${m.team_b} ${m.score_b_runs}/${m.score_b_wickets}\n${winnerText}\n`;
                    });

                    return new discord_js_1.EmbedBuilder()
                        .setTitle(`🏏 Season ${season} Matches`)
                        .setDescription(list.join('\n---\n'))
                        .setColor(0x0099ff)
                        .setFooter({ text: `Page ${page + 1} of ${totalPages} | Total Matches: ${ptMatches.length}` })
                        .setTimestamp();
                };

                const getButtons = (page) => {
                    return new discord_js_1.ActionRowBuilder().addComponents(
                        new discord_js_1.ButtonBuilder()
                            .setCustomId('lm_prev')
                            .setLabel('◀️ Previous')
                            .setStyle(discord_js_1.ButtonStyle.Primary)
                            .setDisabled(page === 0),
                        new discord_js_1.ButtonBuilder()
                            .setCustomId('lm_next')
                            .setLabel('Next ▶️')
                            .setStyle(discord_js_1.ButtonStyle.Primary)
                            .setDisabled(page === totalPages - 1)
                    );
                };

                const response = await message.reply({ 
                    embeds: [generateEmbed(currentPage)],
                    components: totalPages > 1 ? [getButtons(currentPage)] : [] 
                });

                if (totalPages > 1) {
                    const collector = response.createMessageComponentCollector({ 
                        filter: i => i.user.id === message.author.id,
                        time: 60000 
                    });

                    collector.on('collect', async i => {
                        if (i.customId === 'lm_prev') currentPage--;
                        else if (i.customId === 'lm_next') currentPage++;

                        await i.update({ 
                            embeds: [generateEmbed(currentPage)],
                            components: [getButtons(currentPage)] 
                        });
                    });

                    collector.on('end', () => {
                        response.edit({ components: [] }).catch(() => {});
                    });
                }
                break;
            }

        }
    }
    catch (e) {
        console.error(e);
        message.reply(`Error: ${e.message}`);
    }
}
async function handleFixtureCommand(message, command, args) {
    const db = (0, database_1.getDB)();
    const guildId = message.guild?.id;
    if (!guildId) return;

    if (command === 'resetfixturesetup') {
        if (!(0, utils_1.isAdmin)(message.member)) return message.reply("Admin only.");
        const existingState = await db.get('SELECT step, timestamp FROM fixture_setup_state WHERE guild_id = ?', guildId);
        if (!existingState) {
            return message.reply("No saved fixture setup session was found.");
        }
        if (!await (0, utils_1.askConfirmation)(message, "Reset the saved fixture setup session? This only clears the unfinished setup progress.")) {
            return message.reply("Action cancelled.");
        }
        await db.run('DELETE FROM fixture_setup_state WHERE guild_id = ?', guildId);
        return message.reply("✅ Saved fixture setup session cleared. You can run `?fixturesetup` again from the start.");
    }

    if (command === 'fixturesettings') {
        if (!(0, utils_1.isAdmin)(message.member)) return message.reply("Admin only.");
        
        const settings = await db.get('SELECT * FROM fixture_settings WHERE guild_id = ?', guildId) || {
            title_text: 'Cinematic Showdown',
            sponsor_text: '',
            min_players: '6v6',
            max_players: '9v9',
            max_reserve: 2,
            rep_rules: '3 Rep max ; 1 rep = 30 runs , 2 rep = 25 runs , 3 rep = 20 runs',
            match_format: '20 Overs Elite with catch'
        };
        
        const embed = new discord_js_1.EmbedBuilder()
            .setTitle('⚙️ Current Fixture Settings')
            .addFields(
                { name: 'Tournament Title', value: `\`${settings.title_text}\``, inline: true },
                { name: 'Sponsor', value: settings.sponsor_text ? `\`${settings.sponsor_text}\`` : '`Not set`', inline: true },
                { name: 'Player Limits', value: `\`${settings.min_players} to ${settings.max_players}\``, inline: true },
                { name: 'Max Reserves', value: `\`${settings.max_reserve}\``, inline: true },
                { name: 'Match Format', value: `\`${settings.match_format}\``, inline: true },
                { name: 'REP Rules', value: `\`${settings.rep_rules}\`` }
            )
            .setColor(0x00FF00)
            .setFooter({ text: "Click the button below to modify all settings." });

        const row = new discord_js_1.ActionRowBuilder().addComponents(
            new discord_js_1.ButtonBuilder()
                .setCustomId('edit_fixtures_btn')
                .setLabel('Edit All Settings')
                .setStyle(discord_js_1.ButtonStyle.Primary)
        );

        const response = await message.reply({ embeds: [embed], components: [row] });

        try {
            const btnInteraction = await awaitComponent(response, { 
                filter: i => i.user.id === message.author.id && i.customId === 'edit_fixtures_btn', 
                time: 60000 
            });
            if (!btnInteraction)
                return;

            const modal = new discord_js_1.ModalBuilder()
                .setCustomId('fixture_modal')
                .setTitle('Edit Fixture Settings');

            modal.addComponents(
                new discord_js_1.ActionRowBuilder().addComponents(
                    new discord_js_1.TextInputBuilder()
                        .setCustomId('title_text')
                        .setLabel('Tournament Title')
                        .setPlaceholder('Tournament Title')
                        .setValue(settings.title_text)
                        .setStyle(discord_js_1.TextInputStyle.Short)
                ),
                new discord_js_1.ActionRowBuilder().addComponents(
                    new discord_js_1.TextInputBuilder()
                        .setCustomId('sponsor_text')
                        .setLabel('Presented By (Optional)')
                        .setPlaceholder('@Sponsor or Sponsor Name')
                        .setRequired(false)
                        .setValue(settings.sponsor_text || '')
                        .setStyle(discord_js_1.TextInputStyle.Short)
                ),
                new discord_js_1.ActionRowBuilder().addComponents(
                    new discord_js_1.TextInputBuilder()
                        .setCustomId('player_range')
                        .setLabel('Player Limits (Min to Max)')
                        .setPlaceholder('e.g., 7v7 to 10v10')
                        .setValue(`${settings.min_players} to ${settings.max_players}`)
                        .setStyle(discord_js_1.TextInputStyle.Short)
                ),
                new discord_js_1.ActionRowBuilder().addComponents(
                    new discord_js_1.TextInputBuilder()
                        .setCustomId('max_reserve')
                        .setLabel('Max Reserves')
                        .setValue(String(settings.max_reserve))
                        .setStyle(discord_js_1.TextInputStyle.Short)
                ),
                new discord_js_1.ActionRowBuilder().addComponents(
                    new discord_js_1.TextInputBuilder()
                        .setCustomId('match_rules')
                        .setLabel('Format then REP Rules')
                        .setPlaceholder('20 Overs Elite with catch\n3 Rep max ; 1 rep = 30 runs , 2 rep = 25 runs , 3 rep = 20 runs')
                        .setValue(`${settings.match_format}\n${settings.rep_rules}`)
                        .setStyle(discord_js_1.TextInputStyle.Paragraph)
                )
            );

            await btnInteraction.showModal(modal);

            const modalSubmit = await btnInteraction.awaitModalSubmit({
                filter: i => i.user.id === message.author.id && i.customId === 'fixture_modal',
                time: 300000
            });

            await modalSubmit.deferUpdate();

            const newTitle = modalSubmit.fields.getTextInputValue('title_text').trim() || settings.title_text;
            const newSponsor = modalSubmit.fields.getTextInputValue('sponsor_text').trim();
            const newRange = modalSubmit.fields.getTextInputValue('player_range');
            const newReserve = parseInt(modalSubmit.fields.getTextInputValue('max_reserve')) || 0;
            const matchRulesInput = modalSubmit.fields.getTextInputValue('match_rules');
            const matchRuleLines = matchRulesInput
                .split(/\r?\n/)
                .map(line => line.trim())
                .filter(Boolean);
            const newFormat = (matchRuleLines.shift() || settings.match_format).trim();
            const newRepRules = (matchRuleLines.join(' ') || settings.rep_rules).trim();

            let minP = settings.min_players;
            let maxP = settings.max_players;
            const rangeMatch = newRange.match(/(\d+v\d+)\s*to\s*(\d+v\d+)/i);
            if (rangeMatch) {
                minP = rangeMatch[1].toLowerCase();
                maxP = rangeMatch[2].toLowerCase();
            }

            await db.run(`INSERT INTO fixture_settings (guild_id, title_text, sponsor_text, min_players, max_players, max_reserve, match_format, rep_rules) 
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?) 
                          ON CONFLICT(guild_id) DO UPDATE SET 
                          title_text = excluded.title_text, 
                          sponsor_text = excluded.sponsor_text, 
                          min_players = excluded.min_players, 
                          max_players = excluded.max_players, 
                          max_reserve = excluded.max_reserve, 
                          match_format = excluded.match_format, 
                          rep_rules = excluded.rep_rules`, 
                          [guildId, newTitle, newSponsor || null, minP, maxP, newReserve, newFormat, newRepRules]);

            await modalSubmit.editReply({ content: "✅ **Fixture Settings Updated Successfully!**", embeds: [], components: [] });

        } catch (e) {
            // Timeout or user cancelled
        }
        return;
    }

    if (command === 'regteam') {
        if (!(0, utils_1.isAdmin)(message.member)) return message.reply("Admin only.");
        
        let role = message.mentions.roles.first();
        let roleInteractionRef = null;
        let createdRoleForRegTeam = false;
        let preselectedCaptainId = null;
        let preselectedCaptainMember = null;
        const typedTeamNameForRegTeam = !role
            ? args.filter(arg => !/^<@!?(\d+)>$/.test(arg) && !/^<@&(\d+)>$/.test(arg)).join(' ').trim()
            : '';
        if (!role && typedTeamNameForRegTeam) {
            role = message.guild.roles.cache.find(existingRole => existingRole.name.toLowerCase() === typedTeamNameForRegTeam.toLowerCase()) || null;
            if (!role) {
                try {
                    role = await message.guild.roles.create({
                        name: typedTeamNameForRegTeam,
                        colors: { primaryColor: 'Random' },
                        permissions: [],
                        mentionable: false,
                        reason: 'Created via ?regteam'
                    });
                    createdRoleForRegTeam = true;
                }
                catch (e) {
                    return message.reply("Failed to create the team role automatically. Check my `Manage Roles` permission, or mention an existing role instead.");
                }
            }
        }

        if (!role && !typedTeamNameForRegTeam) {
            const captainRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.UserSelectMenuBuilder()
                .setCustomId('reg_cap_auto_role')
                .setPlaceholder('Select Team Captain'));
            const captainPrompt = await message.reply({ content: "Select the **Team Captain** first. I will create a temporary team role from that captain's name.", components: [captainRow] });
            const captainSelection = await awaitComponent(captainPrompt, { filter: i => i.user.id === message.author.id && i.customId === 'reg_cap_auto_role', time: 60000 }, "Captain selection timed out.", "Failed to select a captain.");
            if (!captainSelection)
                return;
            await captainSelection.deferUpdate();
            preselectedCaptainId = captainSelection.values[0];
            preselectedCaptainMember = await message.guild.members.fetch(preselectedCaptainId).catch(() => null);
            if (!preselectedCaptainMember) {
                await captainSelection.editReply({ content: "I couldn't fetch that captain from the server.", components: [] }).catch(() => null);
                return;
            }
            const existingCaptainTeam = await db.get(`SELECT t.team_name FROM team_captains tc
                JOIN teams t ON tc.team_id = t.team_id
                WHERE tc.guild_id = ? AND tc.captain_discord_id = ? AND t.purse_lakhs = -1`, [guildId, preselectedCaptainId]);
            if (existingCaptainTeam) {
                await captainSelection.editReply({ content: `<@${preselectedCaptainId}> is already registered as captain of **${existingCaptainTeam.team_name}**. Select a different captain or unregister that team first.`, components: [] }).catch(() => null);
                return;
            }
            const baseRoleNameRaw = (preselectedCaptainMember.displayName || preselectedCaptainMember.user?.username || 'Temporary Team').trim();
            const normalizedBaseRoleName = baseRoleNameRaw.slice(0, 90) || `Team-${preselectedCaptainId.slice(-4)}`;
            let generatedRoleName = normalizedBaseRoleName;
            let suffix = 2;
            while (message.guild.roles.cache.some(existingRole => existingRole.name.toLowerCase() === generatedRoleName.toLowerCase())) {
                const suffixText = ` ${suffix}`;
                generatedRoleName = `${normalizedBaseRoleName.slice(0, Math.max(1, 100 - suffixText.length))}${suffixText}`;
                suffix++;
            }
            try {
                role = await message.guild.roles.create({
                    name: generatedRoleName,
                    colors: { primaryColor: 'Random' },
                    permissions: [],
                    mentionable: false,
                    reason: 'Created via ?regteam using captain name'
                });
                createdRoleForRegTeam = true;
                await captainSelection.editReply({ content: `Captain selected: <@${preselectedCaptainId}>.\nCreated temporary team role **${role.name}**.`, components: [] }).catch(() => null);
            }
            catch (e) {
                await captainSelection.editReply({ content: "Failed to create the temporary team role automatically. Check my `Manage Roles` permission.", components: [] }).catch(() => null);
                return;
            }
        }

        if (!role)
            return message.reply("Usage: `?regteam`, `?regteam Team Name`, or `?regteam @Role`.");
        if (!role) {
            const row = new discord_js_1.ActionRowBuilder().addComponents(
                new discord_js_1.RoleSelectMenuBuilder()
                    .setCustomId('reg_role_select')
                    .setPlaceholder('Search or select a role to register as a team')
            );
            const resp = await message.reply({ content: "Select a **Role** to register as a team, or use `?regteam Team Name` to auto-create one:", components: [row] });
            const roleInteraction = await awaitComponent(resp, { filter: i => i.user.id === message.author.id, time: 60000 }, "❌ Role selection timed out.", "⚠️ Failed to select a role.");
            if (!roleInteraction)
                return;
            roleInteractionRef = roleInteraction;
            role = roleInteraction.roles.first();
        }

        if (createdRoleForRegTeam && !preselectedCaptainId) {
            await message.channel.send(`Created team role **${role.name}**.`).catch(() => null);
        }

        const existingRoleTeam = await db.get('SELECT team_name FROM teams WHERE guild_id = ? AND role_id = ? AND purse_lakhs = -1', [guildId, role.id]);
        if (existingRoleTeam) {
            const msg = `❌ The role **${role.name}** is already registered as **${existingRoleTeam.team_name}**. Use \`?unregteam\` first if you need to reuse it.`;
            if (roleInteractionRef) {
                await roleInteractionRef.update({ content: msg, components: [] }).catch(() => message.reply(msg));
            }
            else {
                await message.reply(msg);
            }
            return;
        }

        const categories = message.guild.channels.cache.filter(c => c.type === discord_js_1.ChannelType.GuildCategory);
        if (categories.size === 0) {
            const msg = "No categories found in this server.";
            return roleInteractionRef ? roleInteractionRef.update({ content: msg, components: [] }) : message.reply(msg);
        }

        const catOptions = categories.map(c => ({ label: c.name.slice(0, 100), value: c.id })).slice(0, 25);
        const cRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
            .setCustomId(`reg_cat_${role.id}`)
            .setPlaceholder(`Select category for ${role.name}'s stadium`)
            .addOptions(catOptions));
        let cResp;
        if (roleInteractionRef) {
            await roleInteractionRef.update({ content: `Select **Category** for **${role.name}** stadium:`, components: [cRow] });
            cResp = await roleInteractionRef.fetchReply();
        }
        else {
            cResp = await message.reply({ content: `Select **Category** for **${role.name}** stadium:`, components: [cRow] });
        }
        try {
            const cSelect = await awaitComponent(cResp, { filter: i => i.user.id === message.author.id, time: 60000 }, "❌ Category selection timed out.", "⚠️ Failed to select a category.");
            if (!cSelect)
                return;
            await cSelect.deferUpdate();
            const catId = cSelect.values[0];
            let captainSelectionRef = cSelect;
            let captainId = preselectedCaptainId;
            if (!captainId) {
            const uRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.UserSelectMenuBuilder()
                .setCustomId(`reg_cap_${role.id}`)
                .setPlaceholder(`Select Team Captain for ${role.name}`));
            await cSelect.editReply({ content: `Select the **Team Captain** for **${role.name}**:`, components: [uRow] });
            const uSelect = await awaitComponent(cResp, { filter: i => i.user.id === message.author.id, time: 60000 }, "❌ Captain selection timed out.", "⚠️ Failed to select a captain.");
            if (!uSelect)
                return;
            await uSelect.deferUpdate();
            captainSelectionRef = uSelect;
            captainId = uSelect.values[0];
            }
            else {
                await cSelect.editReply({ content: `Captain selected: <@${captainId}>. Continuing setup for **${role.name}**.`, components: [] }).catch(() => null);
            }
            const existingCaptainTeam = await db.get(`SELECT t.team_name FROM team_captains tc
                JOIN teams t ON tc.team_id = t.team_id
                WHERE tc.guild_id = ? AND tc.captain_discord_id = ? AND t.purse_lakhs = -1`, [guildId, captainId]);
            if (existingCaptainTeam) {
                await captainSelectionRef.editReply({ content: `❌ <@${captainId}> is already registered as captain of **${existingCaptainTeam.team_name}**. Select a different captain or unregister that team first.`, components: [] }).catch(() => { });
                return;
            }
            const uniqueOwnerId = `NON_AUCTION_${role.id}`;
            const existingAuction = await db.get('SELECT * FROM teams WHERE guild_id = ? AND team_name = ? AND purse_lakhs >= 0', [guildId, role.name]);
            if (existingAuction)
                return captainSelectionRef.editReply({ content: `❌ The name **${role.name}** is already taken by an auction team.`, components: [] });
            const baseSlug = sanitizeChannelNameInput(`${role.name}-stadium`) || `team-${Math.floor(Math.random() * 9999)}`;
            let channelName = baseSlug;
            let suffix = 1;
            while (message.guild.channels.cache.some(ch => ch.name === channelName)) {
                channelName = `${baseSlug}-${suffix++}`;
            }
            let createdChannel = null;
            try {
                createdChannel = await message.guild.channels.create({
                    name: channelName,
                    type: discord_js_1.ChannelType.GuildText,
                    parent: catId,
                    reason: `Non-auction stadium for ${role.name}`
                });
                await createdChannel.lockPermissions().catch(() => null);
            }
            catch (e) {
                await captainSelectionRef.editReply({ content: `⚠️ Failed to create stadium channel: ${e.message}`, components: [] }).catch(() => { });
                return;
            }
            const channelId = createdChannel?.id;

            await db.run('INSERT INTO teams (guild_id, team_name, owner_discord_id, purse_lakhs, role_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT(guild_id, owner_discord_id) DO UPDATE SET team_name=excluded.team_name, role_id=excluded.role_id', 
                [guildId, role.name, uniqueOwnerId, -1, role.id]);
            
            const team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND owner_discord_id = ?', [guildId, uniqueOwnerId]);
            await db.run('INSERT INTO team_stadiums (guild_id, team_id, channel_id) VALUES (?, ?, ?) ON CONFLICT(guild_id, team_id) DO UPDATE SET channel_id=excluded.channel_id',
                [guildId, team.team_id, channelId]);

            await db.run('INSERT INTO team_captains (guild_id, team_id, captain_discord_id) VALUES (?, ?, ?) ON CONFLICT(guild_id, team_id) DO UPDATE SET captain_discord_id=excluded.captain_discord_id',
                [guildId, team.team_id, captainId]);

            const captainMember = preselectedCaptainMember?.id === captainId ? preselectedCaptainMember : await message.guild.members.fetch(captainId).catch(() => null);
            const captainCanAccess = captainMember && createdChannel
                ? createdChannel.permissionsFor(captainMember)?.has(discord_js_1.PermissionFlagsBits.ViewChannel)
                : false;
            if (!captainCanAccess) {
                message.author.send(`Warning: the stadium channel <#${channelId}> for **${role.name}** may not be accessible to captain <@${captainId}> because it now inherits the selected category permissions. You may need to change the permissions on that category.`).catch(() => { });
            }

            await promptCaptainForInitialStadiumName(message.guild, team, captainId, channelId);

            const ptConfig = await getPtConfig(guildId);
            const activeSeasonLabel = await statsSystem.getActiveSeason(guildId) || `S${ptConfig.current_season || 1}`;
            const collectManualAlias = async ({ showPrompt = true, promptText = "Please type the abbreviation (up to 6 letters/numbers). Type `cancel` to abort." } = {}) => {
                if (showPrompt)
                    await message.channel.send(promptText);
                while (true) {
                    let aliasResponse = null;
                    try {
                        const aliasCollect = await message.channel.awaitMessages({ filter: m => m.author.id === message.author.id, max: 1, time: 120000 });
                        aliasResponse = aliasCollect.first()?.content?.trim();
                    }
                    catch (e) { }
                    if (!aliasResponse) {
                        await message.channel.send("⌛ Abbreviation input timed out. Registration cancelled.");
                        return null;
                    }
                    if (aliasResponse.toLowerCase() === 'cancel') {
                        await message.channel.send("❌ Abbreviation entry cancelled. Registration aborted.");
                        return null;
                    }
                    const aliasCandidate = normalizeAlias(aliasResponse, role.name);
                    if (!aliasCandidate) {
                        await message.channel.send("⚠️ Abbreviation must contain at least one letter or number. Try again (or type `cancel`).");
                        continue;
                    }
                    const existingAlias = await db.get('SELECT full_name FROM pt_team_aliases WHERE guild_id = ? AND alias = ?', guildId, aliasCandidate);
                    if (existingAlias && existingAlias.full_name !== role.name) {
                        await message.channel.send(`⚠️ Abbreviation **${aliasCandidate}** is already used by **${existingAlias.full_name}**. Try another or type \`cancel\`.`);
                        continue;
                    }
                    return aliasCandidate;
                }
            };

            const aliasChoiceRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId(`alias_auto_${team.team_id}`).setLabel('Auto Abbreviation').setStyle(discord_js_1.ButtonStyle.Success), new discord_js_1.ButtonBuilder().setCustomId(`alias_manual_${team.team_id}`).setLabel('Enter Abbreviation').setStyle(discord_js_1.ButtonStyle.Primary));
            const aliasChoiceMsg = await message.reply({ content: `How should I set the **Point Table Abbreviation** for **${role.name}**?`, components: [aliasChoiceRow] });
            const aliasChoice = await awaitComponent(aliasChoiceMsg, { filter: i => i.user.id === message.author.id, time: 30000 }, "⌛ Abbreviation mode selection timed out. Using auto abbreviation.", "⚠️ Failed to choose abbreviation mode.");
            if (!aliasChoice) {
                await aliasChoiceMsg.edit({ content: "⌛ Abbreviation mode selection timed out. Using auto abbreviation.", components: [] }).catch(() => { });
            }

            let aliasValue = null;
            if (aliasChoice && aliasChoice.customId.startsWith('alias_manual')) {
                await aliasChoice.update({ content: "✍️ Please type the abbreviation (type `cancel` to abort).", components: [] });
                aliasValue = await collectManualAlias({ showPrompt: false });
                if (!aliasValue)
                    return;
            }
            else {
                aliasValue = normalizeAlias(role.name, role.name);
                const existingAlias = await db.get('SELECT full_name FROM pt_team_aliases WHERE guild_id = ? AND alias = ?', guildId, aliasValue);
                if (existingAlias && existingAlias.full_name !== role.name) {
                    if (aliasChoice)
                        await aliasChoice.update({ content: `⚠️ Auto abbreviation **${aliasValue}** is already used by **${existingAlias.full_name}**. Please type a new abbreviation (type \`cancel\`).`, components: [] });
                    else
                        await message.channel.send(`⚠️ Auto abbreviation **${aliasValue}** is already used by **${existingAlias.full_name}**. Please type a new abbreviation (type \`cancel\`).`);
                    aliasValue = await collectManualAlias({ showPrompt: !aliasChoice });
                    if (!aliasValue)
                        return;
                }
                else {
                    if (aliasChoice)
                        await aliasChoice.update({ content: `✅ Auto abbreviation set to **${aliasValue}**.`, components: [] });
                    else
                        await message.channel.send(`✅ Auto abbreviation set to **${aliasValue}**.`);
                }
            }
            await db.run('INSERT INTO pt_team_aliases (guild_id, full_name, alias) VALUES (?, ?, ?) ON CONFLICT(guild_id, alias) DO UPDATE SET full_name = ?', guildId, role.name, aliasValue, role.name);

            let selectedGroup = (ptConfig.format_type || 'LEAGUE') === 'GROUPS' ? 'A' : 'LEAGUE';
            if ((ptConfig.format_type || 'LEAGUE') === 'GROUPS') {
                const groupRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
                    .setCustomId(`reg_group_${role.id}`)
                    .setPlaceholder('Select Group')
                    .addOptions(getAlphabetRange(ptConfig.group_limit || 'A').map(letter => ({
                    label: `Group ${letter}`,
                    value: letter
                }))));
                const groupPrompt = await message.reply({ content: `Select a **Group** for **${role.name}**:`, components: [groupRow] });
                const groupSelect = await awaitComponent(groupPrompt, { filter: i => i.user.id === message.author.id, time: 60000 }, "❌ Group selection timed out.", "⚠️ Failed to select a group.");
                if (groupSelect) {
                    await groupSelect.deferUpdate();
                    selectedGroup = groupSelect.values[0];
                    await groupSelect.editReply({ content: `✅ Group set to **${selectedGroup}**.`, components: [] });
                }
            }
            await setTeamGroup(guildId, activeSeasonLabel, team.team_id, selectedGroup);

            const summaryEmbed = new discord_js_1.EmbedBuilder()
                .setTitle('✅ Team Registered')
                .setColor(0x00AE86)
                .addFields({ name: 'Team Name', value: `**${role.name}**`, inline: true }, { name: 'Abbreviation', value: `\`${aliasValue}\``, inline: true }, { name: 'Group', value: `**${selectedGroup}**`, inline: true }, { name: 'Captain', value: `<@${captainId}>`, inline: true }, { name: 'Stadium', value: `<#${channelId}>`, inline: true });
            await message.channel.send({ embeds: [summaryEmbed] });
        } catch (e) { 
            return message.reply("Registration timed out or failed."); 
        }
        return;
    }

    if (command === 'unregteam') {
        if (!(0, utils_1.isAdmin)(message.member)) return message.reply("Admin only.");
        
        const teams = await db.all('SELECT team_id, team_name, role_id, owner_discord_id FROM teams WHERE guild_id = ? AND purse_lakhs = -1', [guildId]);
        if (teams.length === 0) return message.reply("No teams are currently registered for fixtures.");

        const ptConfig = await getPtConfig(guildId);
        const seasonLabel = await statsSystem.getActiveSeason(guildId) || `S${ptConfig.current_season || 1}`;
        const aliasRows = await db.all('SELECT alias, full_name FROM pt_team_aliases WHERE guild_id = ?', guildId);
        const aliasMap = new Map(aliasRows.map(r => [r.full_name.toLowerCase(), r.alias]));
        const groupRows = await db.all('SELECT team_id, group_letter FROM team_groups WHERE guild_id = ? AND season_name = ?', guildId, seasonLabel);
        const groupMap = new Map(groupRows.map(r => [r.team_id, r.group_letter]));
        const stadiumRows = await db.all('SELECT team_id, channel_id FROM team_stadiums WHERE guild_id = ?', guildId);
        const stadiumMap = new Map(stadiumRows.map(r => [r.team_id, r.channel_id]));
        const captainRows = await db.all('SELECT team_id, captain_discord_id FROM team_captains WHERE guild_id = ?', guildId);
        const captainMap = new Map(captainRows.map(r => [r.team_id, r.captain_discord_id]));

        const memberLookupCache = new Map();
        const fetchMemberById = async (userId) => {
            if (!userId || !message.guild)
                return null;
            if (memberLookupCache.has(userId))
                return memberLookupCache.get(userId);
            let member = message.guild.members.cache.get(userId) || null;
            if (!member) {
                try {
                    member = await message.guild.members.fetch(userId);
                }
                catch (e) {
                    member = null;
                }
            }
            memberLookupCache.set(userId, member);
            return member;
        };
        const getMemberLabel = async (userId) => {
            if (!userId)
                return null;
            const member = await fetchMemberById(userId);
            if (member) {
                if (member.displayName && member.user?.username && member.displayName !== member.user.username) {
                    return `${member.displayName} (${member.user.username})`;
                }
                return member.displayName || member.user?.username || `User ${userId}`;
            }
            return `User ${userId}`;
        };

        const teamMeta = await Promise.all(teams.map(async team => {
            let roleName = "Unknown Role";
            try {
                const role = team.role_id ? await message.guild.roles.fetch(team.role_id).catch(() => null) : null;
                if (role)
                    roleName = role.name;
            }
            catch (e) { }
            const alias = aliasMap.get(team.team_name.toLowerCase()) || '—';
            const groupLetter = groupMap.get(team.team_id) || ((ptConfig.format_type || 'LEAGUE') === 'GROUPS' ? 'Unassigned' : 'LEAGUE');
            const captainId = captainMap.get(team.team_id) || null;
            const stadiumId = stadiumMap.get(team.team_id) || null;
            const bucketKey = (groupLetter || ((ptConfig.format_type || 'LEAGUE') === 'GROUPS' ? 'Unassigned' : 'LEAGUE')).toString().toUpperCase();
            const captainLabel = captainId ? await getMemberLabel(captainId) : null;
            return {
                team,
                alias,
                group: groupLetter,
                captainId,
                captainLabel,
                stadiumId,
                roleName,
                bucketKey
            };
        }));

        const nameIndex = new Map(teamMeta.map(meta => [meta.team.team_name.toLowerCase(), meta]));
        const aliasIndex = new Map();
        aliasRows.forEach(row => {
            const meta = nameIndex.get(row.full_name.toLowerCase());
            if (meta && row.alias)
                aliasIndex.set(row.alias.toLowerCase(), meta);
        });

        const groupedMetas = new Map();
        teamMeta.forEach(meta => {
            const key = meta.bucketKey || 'LEAGUE';
            if (!groupedMetas.has(key))
                groupedMetas.set(key, []);
            groupedMetas.get(key).push(meta);
        });
        const nonEmptyGroupKeys = [...groupedMetas.entries()]
            .filter(([, list]) => list.length > 0)
            .map(([key]) => key);
        const requiresGroupSelect = ((ptConfig.format_type || 'LEAGUE') === 'GROUPS') && nonEmptyGroupKeys.length > 1;
        const formatGroupLabel = (groupKey) => {
            if (!groupKey || groupKey === 'LEAGUE')
                return 'League';
            if (groupKey === 'UNASSIGNED')
                return 'Unassigned';
            if (/^[A-Z]$/.test(groupKey))
                return `Group ${groupKey}`;
            return groupKey;
        };
        const buildTeamOptions = (metas) => metas.slice(0, 25).map(meta => ({
            label: meta.team.team_name,
            value: meta.team.team_id.toString(),
            description: meta.captainLabel ? `Captain: ${meta.captainLabel}` : 'Captain: No captain'
        }));
        const buildTeamSelectRow = (metas) => {
            const opts = buildTeamOptions(metas);
            if (!opts.length)
                return null;
            const menu = new discord_js_1.StringSelectMenuBuilder()
                .setCustomId('unreg_team_select')
                .setPlaceholder('Select one or more teams to unregister')
                .setMinValues(1)
                .setMaxValues(opts.length)
                .addOptions(opts);
            return new discord_js_1.ActionRowBuilder().addComponents(menu);
        };

        const executeUnregister = async (selectedMetas, interactionForReply = null) => {
            if (!selectedMetas.length)
                return;
            const teamNames = selectedMetas.map(meta => `**${meta.team.team_name}**`).join(', ');
            if (!await (0, utils_1.askConfirmation)(message, `Are you sure you want to **UNREGISTER** the following teams?\n${teamNames}`)) {
                if (interactionForReply) {
                    try {
                        await interactionForReply.editReply({ content: "❌ Unregistration cancelled.", components: [] });
                    }
                    catch (e) { }
                }
                else {
                    await message.channel.send("❌ Unregistration cancelled.");
                }
                return;
            }
            const summaryEmbed = new discord_js_1.EmbedBuilder()
                .setTitle('✅ Teams Unregistered')
                .setColor(0xFF5555);
            selectedMetas.forEach((meta, idx) => {
                summaryEmbed.addFields({
                    name: `${idx + 1}. ${meta.team.team_name}`,
                    value: `Abbreviation **${meta.alias}** removed; Group **${meta.group}** cleared; Captain: ${meta.captainLabel || 'None'}.`,
                    inline: false
                });
            });
            for (const meta of selectedMetas) {
                await db.run('DELETE FROM pt_team_aliases WHERE guild_id = ? AND full_name = ?', [guildId, meta.team.team_name]);
                await db.run('DELETE FROM team_stadiums WHERE guild_id = ? AND team_id = ?', [guildId, meta.team.team_id]);
                await db.run('DELETE FROM team_groups WHERE guild_id = ? AND team_id = ?', [guildId, meta.team.team_id]);
                await db.run('DELETE FROM teams WHERE team_id = ?', [meta.team.team_id]);
            }
            if (interactionForReply) {
                try {
                    await interactionForReply.editReply({ embeds: [summaryEmbed], components: [] });
                }
                catch (e) {
                    await message.channel.send({ embeds: [summaryEmbed] });
                }
            }
            else {
                await message.channel.send({ embeds: [summaryEmbed] });
            }
        };

        const typedFilterMap = {
            teamname: 'teamname',
            team: 'teamname',
            name: 'teamname',
            teamrole: 'teamrole',
            role: 'teamrole',
            captain: 'captain',
            owner: 'owner',
            alias: 'alias',
            group: 'group',
            stadium: 'stadium',
            channel: 'stadium',
            teamid: 'teamid',
            id: 'teamid'
        };
        const typedFilterLabels = {
            teamname: 'team name',
            teamrole: 'team role',
            captain: 'captain',
            owner: 'owner',
            alias: 'alias',
            group: 'group',
            stadium: 'stadium',
            teamid: 'team ID'
        };
        const snowflakeFrom = (value) => {
            if (!value)
                return null;
            const match = value.match(/\d{5,}/);
            return match ? match[0] : null;
        };
        const applyTypedFilter = async (filterKey, rawValue) => {
            const trimmed = (rawValue || '').trim();
            const valueLower = trimmed.toLowerCase();
            const snowflake = snowflakeFrom(trimmed);
            switch (filterKey) {
                case 'teamname':
                    return teamMeta.filter(meta => meta.team.team_name.toLowerCase().includes(valueLower));
                case 'teamrole':
                    if (snowflake)
                        return teamMeta.filter(meta => meta.team.role_id === snowflake);
                    return teamMeta.filter(meta => (meta.roleName || '').toLowerCase().includes(valueLower));
                case 'alias':
                    return teamMeta.filter(meta => {
                        const aliasText = meta.alias && meta.alias !== '—' ? meta.alias.toLowerCase() : '';
                        return aliasText && aliasText.includes(valueLower);
                    });
                case 'group': {
                    const normalizedGroup = valueLower.replace(/group\s*/g, '').trim().toUpperCase();
                    if (!normalizedGroup)
                        return [];
                    return teamMeta.filter(meta => (meta.group || '').toUpperCase() === normalizedGroup);
                }
                case 'stadium': {
                    if (snowflake)
                        return teamMeta.filter(meta => meta.stadiumId === snowflake);
                    if (!message.guild)
                        return [];
                    const matchingChannels = [];
                    message.guild.channels.cache.forEach(ch => {
                        if (ch && ch.type === discord_js_1.ChannelType.GuildText && (ch.name || '').toLowerCase().includes(valueLower)) {
                            matchingChannels.push(ch.id);
                        }
                    });
                    return teamMeta.filter(meta => meta.stadiumId && matchingChannels.includes(meta.stadiumId));
                }
                case 'captain': {
                    if (snowflake)
                        return teamMeta.filter(meta => meta.captainId === snowflake);
                    const matched = [];
                    for (const meta of teamMeta) {
                        if (!meta.captainId)
                            continue;
                        const member = await fetchMemberById(meta.captainId);
                        if (!member)
                            continue;
                        const display = (member.displayName || '').toLowerCase();
                        const username = (member.user?.username || '').toLowerCase();
                        if ((display && display.includes(valueLower)) || (username && username.includes(valueLower))) {
                            matched.push(meta);
                        }
                    }
                    return matched;
                }
                case 'owner': {
                    if (snowflake)
                        return teamMeta.filter(meta => meta.team.owner_discord_id === snowflake);
                    const matched = [];
                    for (const meta of teamMeta) {
                        if (!meta.team.owner_discord_id)
                            continue;
                        const member = await fetchMemberById(meta.team.owner_discord_id);
                        if (!member)
                            continue;
                        const display = (member.displayName || '').toLowerCase();
                        const username = (member.user?.username || '').toLowerCase();
                        if ((display && display.includes(valueLower)) || (username && username.includes(valueLower))) {
                            matched.push(meta);
                        }
                    }
                    return matched;
                }
                case 'teamid': {
                    const numericId = parseInt(trimmed, 10);
                    return teamMeta.filter(meta => {
                        if (!Number.isNaN(numericId) && meta.team.team_id === numericId)
                            return true;
                        if (snowflake)
                            return meta.team.team_id.toString() === snowflake;
                        return meta.team.team_id.toString() === trimmed;
                    });
                }
                default:
                    return [];
            }
        };
        const typeArgRaw = (args[0] || '').toLowerCase();
        const typedFilterKey = typedFilterMap[typeArgRaw];
        const searchArgs = typedFilterKey ? args.slice(1) : args;
        if (typedFilterKey) {
            const typedValue = searchArgs.join(' ').trim();
            if (typedValue.length) {
                const typedMatches = await applyTypedFilter(typedFilterKey, typedValue);
                if (typedMatches.length) {
                    await executeUnregister(typedMatches);
                    return;
                }
                await message.reply(`No teams matched the ${typedFilterLabels[typedFilterKey] || typedFilterKey} **${typedValue}**. Showing selector instead.`);
            }
        }
        const collectTeamSelection = async (targetMessage, metas) => {
            try {
                const select = await awaitComponent(targetMessage, { filter: i => i.user.id === message.author.id && i.customId === 'unreg_team_select', time: 60000 }, "❌ Selection timed out.", "⚠️ Failed to select teams.");
                if (!select)
                    return;
                await select.deferUpdate();
                const selectedMetas = metas.filter(meta => select.values.includes(meta.team.team_id.toString()));
                await executeUnregister(selectedMetas, select);
            }
            catch (e) {
                // handled by awaitComponent already
            }
        };

        const searchInput = searchArgs.join(' ').trim();
        const mentionedRole = message.mentions.roles.first();
        const mentionedUser = message.mentions.users.first();
        let preselectedMetas = [];

        if (mentionedRole) {
            preselectedMetas = teamMeta.filter(meta => meta.team.role_id === mentionedRole.id);
        }
        else if (mentionedUser) {
            preselectedMetas = teamMeta.filter(meta => meta.captainId === mentionedUser.id || meta.team.owner_discord_id === mentionedUser.id);
        }
        else if (searchInput) {
            const terms = searchInput.split('|').map(t => t.trim().toLowerCase()).filter(Boolean);
            const collected = new Map();
            const addMeta = (meta) => {
                if (meta)
                    collected.set(meta.team.team_id, meta);
            };
            for (const term of terms) {
                const aliasMeta = aliasIndex.get(term);
                if (aliasMeta)
                    addMeta(aliasMeta);
                const nameMeta = nameIndex.get(term);
                if (nameMeta)
                    addMeta(nameMeta);
                teamMeta.forEach(meta => {
                    if (meta.team.team_name.toLowerCase().includes(term) ||
                        (meta.alias && meta.alias.toLowerCase().includes(term)) ||
                        meta.roleName.toLowerCase().includes(term)) {
                        addMeta(meta);
                    }
                });
            }
            preselectedMetas = [...collected.values()];
        }
        if (preselectedMetas.length > 0) {
            await executeUnregister(preselectedMetas);
            return;
        }

        if (requiresGroupSelect) {
            const groupOptions = nonEmptyGroupKeys.slice(0, 25).map(key => new discord_js_1.StringSelectMenuOptionBuilder()
                .setLabel(formatGroupLabel(key))
                .setValue(key));
            const groupRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
                .setCustomId('unreg_group_select')
                .setPlaceholder('Select a group to manage')
                .addOptions(groupOptions));
            const groupPrompt = await message.reply({ content: "Select a **Group** to view registered teams:", components: [groupRow] });
            try {
                const groupSelect = await awaitComponent(groupPrompt, { filter: i => i.user.id === message.author.id && i.customId === 'unreg_group_select', time: 60000 }, "❌ Group selection timed out.", "⚠️ Failed to select a group.");
                if (!groupSelect)
                    return;
                await groupSelect.deferUpdate();
                const selectedGroupKey = groupSelect.values[0];
                const groupMetas = groupedMetas.get(selectedGroupKey) || [];
                const groupLabel = formatGroupLabel(selectedGroupKey);
                if (!groupMetas.length) {
                    await groupSelect.editReply({ content: `No teams found in ${groupLabel}.`, components: [] }).catch(() => { });
                    return;
                }
                const row = buildTeamSelectRow(groupMetas);
                if (!row) {
                    await groupSelect.editReply({ content: `No teams available in ${groupLabel}.`, components: [] }).catch(() => { });
                    return;
                }
                let teamMessage;
                try {
                    teamMessage = await groupSelect.editReply({ content: `Select team(s) in **${groupLabel}** to unregister:`, components: [row] });
                }
                catch (err) {
                    teamMessage = await message.channel.send({ content: `Select team(s) in **${groupLabel}** to unregister:`, components: [row] });
                }
                if (!teamMessage)
                    return;
                await collectTeamSelection(teamMessage, groupMetas);
            }
            catch (e) {
                await respondComponentError(groupPrompt, e, '❌ Group selection timed out.', '⚠️ Failed to select a group.');
            }
            return;
        }

        const defaultRow = buildTeamSelectRow(teamMeta);
        if (!defaultRow) {
            await message.reply("No teams available to unregister.").catch(() => { });
            return;
        }
        const resp = await message.reply({ content: "Select teams to **unregister**:", components: [defaultRow] });
        await collectTeamSelection(resp, teamMeta);
        return;
    }

    if (command === 'regteams') {
        const registered = await db.all('SELECT t.*, ts.channel_id FROM teams t LEFT JOIN team_stadiums ts ON t.team_id = ts.team_id WHERE t.guild_id = ? AND t.purse_lakhs = -1', [guildId]);
        if (registered.length === 0)
            return message.reply("No teams registered for fixtures yet. Use `?regteam @Role` to add some.");
        const ptConfig = await getPtConfig(guildId);
        const seasonLabel = await statsSystem.getActiveSeason(guildId) || `S${ptConfig.current_season || 1}`;
        const aliasRows = await db.all('SELECT alias, full_name FROM pt_team_aliases WHERE guild_id = ?', guildId);
        const aliasMap = new Map(aliasRows.map(r => [r.full_name.toLowerCase(), r.alias]));
        const groupRows = await db.all('SELECT team_id, group_letter FROM team_groups WHERE guild_id = ? AND season_name = ?', guildId, seasonLabel);
        const groupMap = new Map(groupRows.map(r => [r.team_id, r.group_letter]));
        const captainRows = await db.all('SELECT team_id, captain_discord_id FROM team_captains WHERE guild_id = ?', guildId);
        const captainMap = new Map(captainRows.map(r => [r.team_id, r.captain_discord_id]));
        const grouped = new Map();
        const formatType = ptConfig.format_type || 'LEAGUE';
        const defaultGroup = formatType === 'GROUPS' ? 'UNASSIGNED' : 'LEAGUE';
        const allowedGroups = formatType === 'GROUPS' ? getAlphabetRange(ptConfig.group_limit || 'A') : ['LEAGUE'];
        allowedGroups.forEach(letter => grouped.set(letter, []));
        if (!grouped.has(defaultGroup))
            grouped.set(defaultGroup, []);
        registered.forEach(team => {
            const entry = {
                team,
                alias: aliasMap.get(team.team_name.toLowerCase()) || '—',
                captain: captainMap.get(team.team_id),
                stadium: team.channel_id
            };
            const groupLetter = groupMap.get(team.team_id) || defaultGroup;
            if (!grouped.has(groupLetter))
                grouped.set(groupLetter, []);
            grouped.get(groupLetter).push(entry);
        });
        const pages = [...allowedGroups];
        if (grouped.has('UNASSIGNED') && grouped.get('UNASSIGNED').length && !pages.includes('UNASSIGNED'))
            pages.push('UNASSIGNED');
        if (defaultGroup === 'LEAGUE' && !pages.includes('LEAGUE'))
            pages.push('LEAGUE');
        const buildDescription = (letter) => {
            const items = grouped.get(letter) || [];
            if (!items.length)
                return 'No teams in this group yet.';
            return items
                .sort((a, b) => a.team.team_name.localeCompare(b.team.team_name))
                .map((entry, idx) => {
                const number = idx + 1;
                const roleText = entry.team.role_id ? `<@&${entry.team.role_id}>` : 'No role';
                const captainText = entry.captain ? `<@${entry.captain}>` : 'No captain';
                const stadiumText = entry.stadium ? `<#${entry.stadium}>` : 'Not set';
                return `${number}. **${entry.team.team_name}** (\`${entry.alias}\`)\n   Captain: ${captainText}\n   Role: ${roleText}\n   Stadium: ${stadiumText}`;
            }).join('\n\n');
        };
        const buildEmbed = (letter) => {
            const title = letter === 'LEAGUE'
                ? `Registered Teams — ${seasonLabel} (League)`
                : (letter === 'UNASSIGNED'
                    ? `Registered Teams — ${seasonLabel} (Unassigned)`
                    : `Registered Teams — ${seasonLabel} (Group ${letter})`);
            return new discord_js_1.EmbedBuilder()
                .setTitle(title)
                .setDescription(buildDescription(letter))
                .setColor(0x00AE86)
                .setFooter({ text: `${(grouped.get(letter) || []).length} team(s)` });
        };
        const buildRow = (selected) => {
            if (pages.length <= 1)
                return [];
            const selectMenu = new discord_js_1.StringSelectMenuBuilder()
                .setCustomId('regteams_group_select')
                .setPlaceholder('Select group to view')
                .addOptions(pages.map(letter => {
                const label = letter === 'LEAGUE'
                    ? 'League'
                    : (letter === 'UNASSIGNED' ? 'Unassigned' : `Group ${letter}`);
                return new discord_js_1.StringSelectMenuOptionBuilder()
                    .setLabel(label)
                    .setValue(letter)
                    .setDefault(letter === selected);
            }));
            return [new discord_js_1.ActionRowBuilder().addComponents(selectMenu)];
        };
        const initialGroup = pages[0] || defaultGroup;
        const resp = await message.reply({ embeds: [buildEmbed(initialGroup)], components: buildRow(initialGroup) });
        if (pages.length > 1) {
            const collector = resp.createMessageComponentCollector({ filter: i => i.user.id === message.author.id && i.customId === 'regteams_group_select', time: 300000 });
            collector.on('collect', async interaction => {
                const selectedValue = interaction.values[0];
                await interaction.update({ embeds: [buildEmbed(selectedValue)], components: buildRow(selectedValue) });
            });
            collector.on('end', () => {
                resp.edit({ components: [] }).catch(() => { });
            });
        }
        return;
    }

    if (command === 'fixturesetmatchesperday' || command === 'fmd') {
        if (!(0, utils_1.isAdmin)(message.member)) return message.reply("Admin only.");
        const val = parseInt(args[0]);
        if (isNaN(val) || val < 1) return message.reply("Usage: `?fmd [number]` (e.g. `?fmd 1`) ");
        await db.run('INSERT INTO fixture_settings (guild_id, max_matches_per_day) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET max_matches_per_day = excluded.max_matches_per_day', [guildId, val]);
        return message.reply(`✅ Max matches per day set to **${val}**.`);
    }

    if (command === 'fixturesetup') {
        if (!(0, utils_1.isAdmin)(message.member)) return message.reply("Admin only.");

        const existingState = await db.get('SELECT * FROM fixture_setup_state WHERE guild_id = ?', guildId);
        let setupData = { step: 'TYPE_SELECT', data: {} };
        let resume = false;

        if (existingState) {
            const resumeRow = new discord_js_1.ActionRowBuilder().addComponents(
                new discord_js_1.ButtonBuilder().setCustomId('resume_setup').setLabel('Resume Existing').setStyle(discord_js_1.ButtonStyle.Success),
                new discord_js_1.ButtonBuilder().setCustomId('new_setup').setLabel('Start New').setStyle(discord_js_1.ButtonStyle.Danger)
            );
            const resumeMsg = await message.reply({ content: "Found an unfinished fixture setup. Would you like to resume or start a new one?", components: [resumeRow] });
            const choice = await awaitComponent(resumeMsg, { filter: i => i.user.id === message.author.id, time: 30000 }, "Timed out. Use `?fixturesetup` again to resume.", "⚠️ Failed to choose an option.");
            if (!choice)
                return;
            if (choice.customId === 'resume_setup') {
                setupData = { step: existingState.step, data: JSON.parse(existingState.data) };
                resume = true;
                await choice.update({ content: "Resuming setup...", components: [] });
            } else {
                await db.run('DELETE FROM fixture_setup_state WHERE guild_id = ?', guildId);
                await choice.update({ content: "Starting new setup.", components: [] });
            }
        }

        const saveState = async (step, data) => {
            await db.run('INSERT INTO fixture_setup_state (guild_id, step, data, timestamp) VALUES (?, ?, ?, ?) ON CONFLICT(guild_id) DO UPDATE SET step=excluded.step, data=excluded.data, timestamp=excluded.timestamp',
                [guildId, step, JSON.stringify(data), Date.now()]);
        };

        let teams = setupData.data.teams || [];
        let stadiumMap = setupData.data.stadiumMap || {};
        let setupType = setupData.data.setupType;

        if (setupData.step === 'TYPE_SELECT' && !resume) {
            const setupRow = new discord_js_1.ActionRowBuilder().addComponents(
                new discord_js_1.ButtonBuilder().setCustomId('setup_auction').setLabel('Auction Teams').setStyle(discord_js_1.ButtonStyle.Primary),
                new discord_js_1.ButtonBuilder().setCustomId('setup_non_auction').setLabel('Non-Auction Teams').setStyle(discord_js_1.ButtonStyle.Secondary)
            );
            const setupTypeMsg = await message.reply({ content: "Are you setting up fixtures for **Auction Teams** or **Non-Auction Teams**?", components: [setupRow] });
            try {
                const typeSelect = await awaitComponent(setupTypeMsg, { filter: i => i.user.id === message.author.id, time: 60000 }, "Setup timed out.", "⚠️ Failed to choose an option.");
                if (!typeSelect)
                    return;
                setupType = typeSelect.customId === 'setup_auction' ? 'auction' : 'non-auction';
                setupData.data.setupType = setupType;
                await typeSelect.update({ content: `Starting setup for **${setupType === 'auction' ? 'Auction' : 'Non-Auction'}** teams.`, components: [] });
                
                if (setupType === 'auction') {
                    teams = await db.all('SELECT * FROM teams WHERE guild_id = ? AND purse_lakhs >= 0', guildId);
                    if (teams.length < 2) return message.reply("Need at least 2 auction teams.");
                    setupData.step = 'LEGS_COUNT';
                } else {
                    const regTeams = await db.all('SELECT t.*, ts.channel_id FROM teams t LEFT JOIN team_stadiums ts ON t.team_id = ts.team_id WHERE t.guild_id = ? AND t.purse_lakhs = -1', [guildId]);
                    if (regTeams.length < 2) return message.reply("Need at least 2 registered teams. Use `?regteam @Role` to register teams first.");
                    
                    const list = regTeams.map(t => `• **${t.team_name}** (<@&${t.role_id}>)`).join('\n');
                    const confirmRow = new discord_js_1.ActionRowBuilder().addComponents(
                        new discord_js_1.ButtonBuilder().setCustomId('confirm_gen').setLabel('Yes, Generate Fixtures').setStyle(discord_js_1.ButtonStyle.Success),
                        new discord_js_1.ButtonBuilder().setCustomId('cancel_gen').setLabel('Cancel').setStyle(discord_js_1.ButtonStyle.Danger)
                    );
                    
                    const confirmMsg = await message.channel.send({ 
                        content: `Found **${regTeams.length}** registered teams:\n${list}\n\nDo you want to generate fixtures for these teams?`, 
                        components: [confirmRow] 
                    });
                    
                    const confirmChoice = await awaitComponent(confirmMsg, { filter: i => i.user.id === message.author.id, time: 60000 }, "Setup timed out.", "⚠️ Failed to choose an option.");
                    if (!confirmChoice)
                        return;
                    if (confirmChoice.customId === 'confirm_gen') {
                        teams = regTeams;
                        for (const t of regTeams) {
                            stadiumMap[t.team_id] = t.channel_id;
                        }
                        setupData.data.teams = teams;
                        setupData.data.stadiumMap = stadiumMap;
                        setupData.step = 'LEGS_COUNT';
                        await confirmChoice.update({ content: "✅ Using registered teams. Proceeding to legs count...", components: [] });
                    } else {
                        await confirmChoice.editReply({ content: "❌ Setup cancelled.", components: [] });
                        return;
                    }
                }
                await saveState(setupData.step, setupData.data);
            } catch (e) { return message.reply("Setup timed out."); }
        }

        // Skip TEAMS_COUNT and TEAM_INPUT if non-auction and we already have teams
        if (setupData.step === 'TEAMS_COUNT' && setupType === 'non-auction' && teams.length >= 2) {
            setupData.step = 'LEGS_COUNT';
            await saveState(setupData.step, setupData.data);
        }

        if (setupData.step === 'TEAMS_COUNT') {
            await message.reply("How many non-auction teams are participating? (Enter a number)");
            const countColl = await message.channel.awaitMessages({ filter: m => m.author.id === message.author.id, time: 60000, max: 1 });
            const count = parseInt(countColl.first()?.content);
            if (isNaN(count) || count < 2) return message.reply("Invalid number of teams.");
            setupData.data.totalTeams = count;
            setupData.step = 'TEAM_INPUT';
            setupData.data.currentTeamIndex = 0;
            await saveState(setupData.step, setupData.data);
        }

        if (setupData.step === 'TEAM_INPUT') {
            const categories = message.guild.channels.cache.filter(c => c.type === discord_js_1.ChannelType.GuildCategory);
            const catOptions = categories.map(c => ({ label: c.name, value: c.id })).slice(0, 25);

            for (let i = setupData.data.currentTeamIndex; i < setupData.data.totalTeams; i++) {
                await message.reply(`Mention the **Role** for **Team ${i + 1}**:`);
                const roleColl = await message.channel.awaitMessages({ filter: m => m.author.id === message.author.id, time: 60000, max: 1 });
                const content = roleColl.first()?.content || "";
                const roleId = content.match(/<@&(\d+)>/)?.[1];
                const role = message.guild.roles.cache.get(roleId);
                if (!role) {
                    i--; // Retry this team
                    await message.reply("❌ Invalid role mention. Please try again.");
                    continue;
                }
                const teamName = role.name;
                const teamId = -(i + 1);

                // Stadium Mapping right away
                const cRow = new discord_js_1.ActionRowBuilder().addComponents(
                    new discord_js_1.StringSelectMenuBuilder()
                        .setCustomId(`cat_${teamId}`)
                        .setPlaceholder(`Select category for ${teamName}'s stadium`)
                        .addOptions(catOptions)
                );
                const cResp = await message.channel.send({ content: `Select **Category** for **${teamName}** stadium:`, components: [cRow] });
                try {
                    const cSelect = await awaitComponent(cResp, { filter: i => i.user.id === message.author.id, time: 60000 }, "Setup timed out. Resume later with `.fixturesetup`.", "⚠️ Failed to select a category.");
                    if (!cSelect)
                        return;
                    await cSelect.deferUpdate();
                    const catId = cSelect.values[0];
                    const channels = message.guild.channels.cache.filter(ch => ch.parentId === catId && ch.type === discord_js_1.ChannelType.GuildText);
                    
                    if (channels.size === 0) {
                        await cSelect.editReply({ content: "❌ No text channels in this category. Setup failed.", components: [] });
                        return;
                    }

                    const sOptions = channels.map(ch => ({ label: ch.name, value: ch.id })).slice(0, 25);
                    const sRow = new discord_js_1.ActionRowBuilder().addComponents(
                        new discord_js_1.StringSelectMenuBuilder().setCustomId(`stadium_${teamId}`).setPlaceholder(`Select specific stadium channel`).addOptions(sOptions)
                    );
                    
                    await cSelect.editReply({ content: `Now select the **Channel** for **${teamName}**:`, components: [sRow] });
                    const sSelect = await awaitComponent(cResp, { filter: i => i.user.id === message.author.id, time: 60000 }, "Setup timed out. Resume later with `.fixturesetup`.", "⚠️ Failed to select a channel.");
                    if (!sSelect)
                        return;
                    await sSelect.deferUpdate();
                    const channelId = sSelect.values[0];
                    
                    teams.push({ team_id: teamId, team_name: teamName, role_id: roleId, owner_discord_id: message.author.id });
                    stadiumMap[teamId] = channelId;
                    
                    setupData.data.teams = teams;
                    setupData.data.stadiumMap = stadiumMap;
                    setupData.data.currentTeamIndex = i + 1;
                    await saveState('TEAM_INPUT', setupData.data);
                    await sSelect.editReply({ content: `✅ **${teamName}** setup complete with stadium <#${channelId}>.`, components: [] });
                } catch (e) { return message.reply("Setup timed out. Resume later with `.fixturesetup`."); }
            }
            setupData.step = 'LEGS_COUNT';
            await saveState(setupData.step, setupData.data);
        }

        if (setupData.step === 'LEGS_COUNT') {
            if (setupType === 'auction') {
                // For auction teams, we still need to map stadiums if they don't exist
                await message.reply("⏳ Checking stadium mapping for auction teams...");
                for (const team of teams) {
                    const existingStadium = await db.get('SELECT channel_id FROM team_stadiums WHERE guild_id = ? AND team_id = ?', guildId, team.team_id);
                    if (!existingStadium) {
                        const categories = message.guild.channels.cache.filter(c => c.type === discord_js_1.ChannelType.GuildCategory);
                        const catOptions = categories.map(c => ({ label: c.name, value: c.id })).slice(0, 25);
                        const cRow = new discord_js_1.ActionRowBuilder().addComponents(
                            new discord_js_1.StringSelectMenuBuilder().setCustomId(`cat_${team.team_id}`).setPlaceholder(`Select category for ${team.team_name}'s stadium`).addOptions(catOptions)
                        );
                        const cResp = await message.channel.send({ content: `Select **Category** for **${team.team_name}** stadium:`, components: [cRow] });
                        try {
                            const cSelect = await awaitComponent(cResp, { filter: i => i.user.id === message.author.id, time: 60000 }, "Setup timed out.", "⚠️ Failed to select a category.");
                            if (!cSelect)
                                return;
                            const catId = cSelect.values[0];
                            const channels = message.guild.channels.cache.filter(ch => ch.parentId === catId && ch.type === discord_js_1.ChannelType.GuildText);
                            const sOptions = channels.map(ch => ({ label: ch.name, value: ch.id })).slice(0, 25);
                            const sRow = new discord_js_1.ActionRowBuilder().addComponents(
                                new discord_js_1.StringSelectMenuBuilder().setCustomId(`stadium_${team.team_id}`).setPlaceholder(`Select channel`).addOptions(sOptions)
                            );
                            await cSelect.update({ content: `Select **Channel** for **${team.team_name}**:`, components: [sRow] });
                            const sSelect = await awaitComponent(cResp, { filter: i => i.user.id === message.author.id, time: 60000 }, "Setup timed out.", "⚠️ Failed to select a channel.");
                            if (!sSelect)
                                return;
                            await sSelect.deferUpdate();
                            stadiumMap[team.team_id] = sSelect.values[0];
                            await db.run('INSERT INTO team_stadiums (guild_id, team_id, channel_id) VALUES (?, ?, ?) ON CONFLICT(guild_id, team_id) DO UPDATE SET channel_id=excluded.channel_id',
                                [guildId, team.team_id, sSelect.values[0]]);
                            await sSelect.editReply({ content: `✅ Stadium set to <#${sSelect.values[0]}>`, components: [] });
                        } catch (e) { return message.reply("Setup timed out."); }
                    } else {
                        stadiumMap[team.team_id] = existingStadium.channel_id;
                    }
                }
            }

            await message.reply("How many matches should each team play against every other team? (1 or 2)");
            const legColl = await message.channel.awaitMessages({ filter: m => m.author.id === message.author.id, time: 60000, max: 1 });
            const matchPerPair = parseInt(legColl.first()?.content);
            if (![1, 2].includes(matchPerPair)) return message.reply("Please enter 1 or 2.");

            // Generate Fixtures
            const season = await statsSystem.getActiveSeason(guildId) || "Season 1";
            const ptConfig = await getPtConfig(guildId);
            const isGroupSeason = (ptConfig.format_type || 'LEAGUE') === 'GROUPS';
            await db.run('DELETE FROM generated_fixtures WHERE guild_id = ? AND season_name = ?', guildId, season);

            const teamDataForGen = teams.map(t => ({ id: t.team_id, name: t.team_name, role: t.role_id }));
            if (teamDataForGen.length % 2 !== 0) teamDataForGen.push({ id: null, name: "BYE", role: null });

            const numTeams = teamDataForGen.length;
            const roundsPerCycle = numTeams - 1;
            const half = numTeams / 2;

            for (let cycle = 0; cycle < matchPerPair; cycle++) {
                let cycleTeams = [...teamDataForGen];
                for (let r = 0; r < roundsPerCycle; r++) {
                    const dayNum = (cycle * roundsPerCycle) + r + 1;
                    for (let i = 0; i < half; i++) {
                        const t1 = cycleTeams[i];
                        const t2 = cycleTeams[numTeams - 1 - i];
                        if (t1.id !== null && t2.id !== null) {
                            const homeTeam = cycle === 0 ? t1 : t2;
                            const awayTeam = cycle === 0 ? t2 : t1;
                            const stadium = stadiumMap[homeTeam.id];
                            let fixtureGroup = 'LEAGUE';
                            if (isGroupSeason) {
                                const homeGroup = await getTeamGroupLetter(guildId, season, homeTeam.id);
                                const awayGroup = await getTeamGroupLetter(guildId, season, awayTeam.id);
                                fixtureGroup = homeGroup === awayGroup ? homeGroup : 'CROSS';
                            }
                            await db.run('INSERT INTO generated_fixtures (guild_id, season_name, day_number, team_a_id, team_b_id, stadium_id, group_letter) VALUES (?, ?, ?, ?, ?, ?, ?)',
                                [guildId, season, dayNum, homeTeam.id, awayTeam.id, stadium, fixtureGroup]);
                        }
                    }
                    cycleTeams.splice(1, 0, cycleTeams.pop());
                }
            }
            
            // Handle non-auction team metadata storage
            for (const t of teams) {
                if (t.team_id < 0) {
                    const uniqueOwnerId = `NON_AUCTION_${t.team_name.replace(/\s+/g, '_')}_${Date.now()}`;
                    await db.run('INSERT INTO teams (guild_id, team_name, owner_discord_id, purse_lakhs, role_id) VALUES (?, ?, ?, ?, ?)',
                        [guildId, t.team_name, uniqueOwnerId, -1, t.role_id]);
                    const newTeam = await db.get('SELECT team_id FROM teams WHERE guild_id = ? AND team_name = ?', [guildId, t.team_name]);
                    await db.run('UPDATE generated_fixtures SET team_a_id = ? WHERE team_a_id = ? AND guild_id = ?', [newTeam.team_id, t.team_id, guildId]);
                    await db.run('UPDATE generated_fixtures SET team_b_id = ? WHERE team_b_id = ? AND guild_id = ?', [newTeam.team_id, t.team_id, guildId]);
                    await db.run('INSERT INTO team_stadiums (guild_id, team_id, channel_id) VALUES (?, ?, ?) ON CONFLICT(guild_id, team_id) DO UPDATE SET channel_id=excluded.channel_id',
                        [guildId, newTeam.team_id, stadiumMap[t.team_id]]);
                }
            }
            await db.run('DELETE FROM fixture_setup_state WHERE guild_id = ?', guildId);
            message.channel.send(`✅ Successfully generated fixtures for **${season}**!`);
        }
        return;
    }

    if (command === 'groupfixture') {
        if (!(0, utils_1.isAdmin)(message.member)) return message.reply("Admin only.");
        const season = await statsSystem.getActiveSeason(guildId);
        if (!season)
            return message.reply("No active season found.");
        if (args.length === 0)
            return message.reply("Usage: `?groupfixture day <number> [group <letter>]` or `?groupfixture group <letter>`");
        let dayFilter = null;
        let groupFilter = null;
        for (let i = 0; i < args.length; i++) {
            const token = args[i].toLowerCase();
            if (token === 'day' && args[i + 1]) {
                dayFilter = parseInt(args[i + 1]);
                i++;
                continue;
            }
            if (token === 'group' && args[i + 1]) {
                groupFilter = args[i + 1].toUpperCase();
                i++;
                continue;
            }
        }
        if (!dayFilter && !groupFilter)
            return message.reply("Specify a day or group, e.g. `?groupfixture day 1`.");
        const teams = await db.all('SELECT * FROM teams WHERE guild_id = ?', guildId);
        let query = `SELECT f.*, t1.team_name as team_a, t2.team_name as team_b
                     FROM generated_fixtures f
                     JOIN teams t1 ON f.team_a_id = t1.team_id
                     JOIN teams t2 ON f.team_b_id = t2.team_id
                     WHERE f.guild_id = ? AND f.season_name = ?`;
        const params = [guildId, season];
        if (dayFilter) {
            query += ' AND f.day_number = ?';
            params.push(dayFilter);
        }
        if (groupFilter) {
            query += ' AND f.group_letter = ?';
            params.push(groupFilter);
        }
        query += ' ORDER BY f.day_number, f.group_letter';
        const fixtures = await db.all(query, params);
        if (fixtures.length === 0)
            return message.reply("No fixtures found for that selection.");
        const formatMatch = (f) => {
            const teamAId = f.fixture?.team_a_id || f.team_a_id;
            const teamBId = f.fixture?.team_b_id || f.team_b_id;
            const t1 = teams.find(t => t.team_id === teamAId);
            const t2 = teams.find(t => t.team_id === teamBId);
            const ping1 = t1?.role_id ? `<@&${t1.role_id}>` : (t1 ? t1.team_name : "Unknown");
            const ping2 = t2?.role_id ? `<@&${t2.role_id}>` : (t2 ? t2.team_name : "Unknown");
            return `${ping1} vs ${ping2} ✈️ <#${f.stadium_id}>`;
        };
        const embed = new discord_js_1.EmbedBuilder()
            .setColor(0x00AAFF)
            .setTitle(dayFilter ? `Group Fixtures — Day ${dayFilter}` : `Group Fixtures`);
        if (dayFilter && !groupFilter) {
            const grouped = {};
            fixtures.forEach(f => {
                const key = f.group_letter && f.group_letter !== 'LEAGUE' ? f.group_letter : 'LEAGUE';
                if (!grouped[key])
                    grouped[key] = [];
                grouped[key].push(formatMatch(f));
            });
            Object.keys(grouped).sort().forEach(letter => {
                embed.addFields({ name: letter === 'LEAGUE' ? 'League' : `Group ${letter}`, value: grouped[letter].join('\n') });
            });
        }
        else {
            const lines = fixtures.map(f => {
                const dayPrefix = dayFilter ? '' : `Day ${f.day_number}: `;
                const groupPrefix = groupFilter ? '' : (f.group_letter && f.group_letter !== 'LEAGUE' ? `[Group ${f.group_letter}] ` : '');
                return `${dayPrefix}${groupPrefix}${formatMatch(f)}`;
            });
            embed.setDescription(lines.join('\n'));
        }
        message.reply({ embeds: [embed] });
        return;
    }

    if ((command === 'fixtures' || command === 'fixture') && args[0] === 'edit') {
        if (!(0, utils_1.isAdmin)(message.member)) return message.reply("Admin only.");
        
        const editRow = new discord_js_1.ActionRowBuilder().addComponents(
            new discord_js_1.ButtonBuilder().setCustomId('edit_team').setLabel('Edit Team (Role/Stadium)').setStyle(discord_js_1.ButtonStyle.Primary),
            new discord_js_1.ButtonBuilder().setCustomId('edit_match').setLabel('Edit Specific Match').setStyle(discord_js_1.ButtonStyle.Secondary)
        );
        const editMsg = await message.reply({ content: "What would you like to edit?", components: [editRow] });
        
        try {
            const editChoice = await awaitComponent(editMsg, { filter: i => i.user.id === message.author.id, time: 60000 }, "Edit timed out.", "⚠️ Failed to choose an option.");
            if (!editChoice)
                return;
            await editChoice.deferUpdate();
            if (editChoice.customId === 'edit_team') {
                const teams = await db.all('SELECT * FROM teams WHERE guild_id = ?', guildId);
                const tSelect = new discord_js_1.StringSelectMenuBuilder().setCustomId('team_select').setPlaceholder('Select a team').addOptions(teams.map(t => ({ label: t.team_name, value: String(t.team_id) })).slice(0, 25));
                await editChoice.editReply({ content: "Select a team to edit:", components: [new discord_js_1.ActionRowBuilder().addComponents(tSelect)] });
                
                const tChoice = await awaitComponent(editMsg, { filter: i => i.user.id === message.author.id, time: 60000 }, "Edit timed out.", "⚠️ Failed to choose a team.");
                if (!tChoice)
                    return;
                await tChoice.deferUpdate();
                const teamId = tChoice.values[0];
                const team = teams.find(t => t.team_id === parseInt(teamId));

                const optRow = new discord_js_1.ActionRowBuilder().addComponents(
                    new discord_js_1.ButtonBuilder().setCustomId('change_role').setLabel('Change Role').setStyle(discord_js_1.ButtonStyle.Primary),
                    new discord_js_1.ButtonBuilder().setCustomId('change_stadium').setLabel('Change Stadium').setStyle(discord_js_1.ButtonStyle.Secondary)
                );
                await tChoice.editReply({ content: `Editing **${team.team_name}**. What to change?`, components: [optRow] });

                const optChoice = await awaitComponent(editMsg, { filter: i => i.user.id === message.author.id, time: 60000 }, "Edit timed out.", "⚠️ Failed to choose an option.");
                if (!optChoice)
                    return;
                await optChoice.deferUpdate();
                if (optChoice.customId === 'change_role') {
                    await optChoice.editReply({ content: `Mention the new **Role** for **${team.team_name}**:`, components: [] });
                    const rColl = await message.channel.awaitMessages({ filter: m => m.author.id === message.author.id, time: 60000, max: 1 });
                    const rId = rColl.first()?.content.match(/<@&(\d+)>/)?.[1];
                    if (!rId) return message.reply("Invalid role.");
                    await db.run('UPDATE teams SET role_id = ? WHERE guild_id = ? AND team_id = ?', [rId, guildId, teamId]);
                    message.reply(`✅ Updated role for **${team.team_name}**.`);
                } else {
                    const categories = message.guild.channels.cache.filter(c => c.type === discord_js_1.ChannelType.GuildCategory);
                    const cRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder().setCustomId('cat_edit').setPlaceholder('Select Category').addOptions(categories.map(c => ({ label: c.name, value: c.id })).slice(0, 25)));
                    await optChoice.editReply({ content: `Select new **Category** for **${team.team_name}**:`, components: [cRow] });
                    const cSelect = await awaitComponent(editMsg, { filter: i => i.user.id === message.author.id, time: 60000 }, "Edit timed out.", "⚠️ Failed to select a category.");
                    if (!cSelect)
                        return;
                    await cSelect.deferUpdate();
                    const channels = message.guild.channels.cache.filter(ch => ch.parentId === cSelect.values[0] && ch.type === discord_js_1.ChannelType.GuildText);
                    const sRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder().setCustomId('s_edit').setPlaceholder('Select Channel').addOptions(channels.map(ch => ({ label: ch.name, value: ch.id })).slice(0, 25)));
                    await cSelect.editReply({ content: `Select new **Channel** for **${team.team_name}**:`, components: [sRow] });
                    const sSelect = await awaitComponent(editMsg, { filter: i => i.user.id === message.author.id, time: 60000 }, "Edit timed out.", "⚠️ Failed to select a channel.");
                    if (!sSelect)
                        return;
                    await sSelect.deferUpdate();
                    const newChId = sSelect.values[0];
                    const oldStadiumRow = await db.get('SELECT channel_id FROM team_stadiums WHERE guild_id = ? AND team_id = ?', guildId, teamId);
                    const oldChId = oldStadiumRow?.channel_id;

                    await db.run('INSERT INTO team_stadiums (guild_id, team_id, channel_id) VALUES (?, ?, ?) ON CONFLICT(guild_id, team_id) DO UPDATE SET channel_id=excluded.channel_id', [guildId, teamId, newChId]);
                    
                    const season = await statsSystem.getActiveSeason(guildId);
                    
                    // Update active reservations to the new stadium
                    const activeRes = await db.all(`
                        SELECT r.*, t1.team_name as t1name, t2.team_name as t2name, t1.role_id as t1role, t2.role_id as t2role
                        FROM match_reservations r
                        JOIN teams t1 ON r.team_a_id = t1.team_id
                        JOIN teams t2 ON r.team_b_id = t2.team_id
                        WHERE r.guild_id = ? AND r.season_name = ? AND (r.team_a_id = ? OR r.team_b_id = ?) 
                        AND r.status IN ('PENDING', 'OPEN', 'SCHEDULED')
                    `, [guildId, season, teamId, teamId]);

                    for (const res of activeRes) {
                        // If the match was in the old stadium, move it
                        if (res.stadium_channel_id === oldChId) {
                            await db.run('UPDATE match_reservations SET stadium_channel_id = ? WHERE id = ?', [newChId, res.id]);
                            
                            const newCh = await message.guild.channels.fetch(newChId).catch(() => null);
                            if (newCh) {
                                const p1 = res.t1role ? `<@&${res.t1role}>` : `**${res.t1name}**`;
                                const p2 = res.t2role ? `<@&${res.t2role}>` : `**${res.t2name}**`;
                                await newCh.send(`🏟️ **Stadium Updated:** The stadium for ${p1} vs ${p2} has been changed to this channel. Captains, please continue your scheduling here.`);
                            }
                        }
                    }

                    if (await (0, utils_1.askConfirmation)(message, `Do you also want to update the stadium for all **future fixtures** where **${team.team_name}** is the home team?`)) {
                        await db.run('UPDATE generated_fixtures SET stadium_id = ? WHERE guild_id = ? AND season_name = ? AND team_a_id = ? AND status = "PENDING"', [newChId, guildId, season, teamId]);
                        await sSelect.editReply({ content: `✅ Updated team stadium, active negotiations, and future fixtures for **${team.team_name}**.`, components: [] });
                    } else {
                        await sSelect.editReply({ content: `✅ Updated home stadium and active negotiations for **${team.team_name}**. (Future fixtures unchanged)`, components: [] });
                    }
                }
            } else {
                // Edit Specific Match
                const season = await statsSystem.getActiveSeason(guildId);
                const days = await db.all('SELECT DISTINCT day_number FROM generated_fixtures WHERE guild_id = ? AND season_name = ? ORDER BY day_number', [guildId, season]);
                const dSelect = new discord_js_1.StringSelectMenuBuilder().setCustomId('day_select').setPlaceholder('Select Day').addOptions(days.map(d => ({ label: `Day ${d.day_number}`, value: String(d.day_number) })).slice(0, 25));
                await editChoice.editReply({ content: "Select the day of the match:", components: [new discord_js_1.ActionRowBuilder().addComponents(dSelect)] });
                
                const dChoice = await awaitComponent(editMsg, { filter: i => i.user.id === message.author.id, time: 60000 }, "Edit timed out.", "⚠️ Failed to choose a day.");
                if (!dChoice)
                    return;
                await dChoice.deferUpdate();
                const day = dChoice.values[0];
                const matches = await db.all('SELECT f.*, t1.team_name as team_a, t2.team_name as team_b FROM generated_fixtures f JOIN teams t1 ON f.team_a_id = t1.team_id JOIN teams t2 ON f.team_b_id = t2.team_id WHERE f.guild_id = ? AND f.season_name = ? AND f.day_number = ?', [guildId, season, day]);
                const mSelect = new discord_js_1.StringSelectMenuBuilder().setCustomId('match_select').setPlaceholder('Select Match').addOptions(matches.map(m => ({ label: `${m.team_a} vs ${m.team_b}`, value: String(m.id) })));
                await dChoice.editReply({ content: `Select match on **Day ${day}**:`, components: [new discord_js_1.ActionRowBuilder().addComponents(mSelect)] });
                
                const mChoice = await awaitComponent(editMsg, { filter: i => i.user.id === message.author.id, time: 60000 }, "Edit timed out.", "⚠️ Failed to choose a match.");
                if (!mChoice)
                    return;
                await mChoice.deferUpdate();
                const fixtureId = mChoice.values[0];
                const fixture = matches.find(m => m.id === parseInt(fixtureId));

                const mOptRow = new discord_js_1.ActionRowBuilder().addComponents(
                    new discord_js_1.ButtonBuilder().setCustomId('swap_teams').setLabel('Swap Home/Away').setStyle(discord_js_1.ButtonStyle.Primary),
                    new discord_js_1.ButtonBuilder().setCustomId('change_match_stadium').setLabel('Change Stadium').setStyle(discord_js_1.ButtonStyle.Secondary)
                );
                await mChoice.editReply({ content: `Editing **${fixture.team_a} vs ${fixture.team_b}**.`, components: [mOptRow] });

                const mOptChoice = await awaitComponent(editMsg, { filter: i => i.user.id === message.author.id, time: 60000 }, "Edit timed out.", "⚠️ Failed to choose an option.");
                if (!mOptChoice)
                    return;
                await mOptChoice.deferUpdate();
                if (mOptChoice.customId === 'swap_teams') {
                    await db.run('UPDATE generated_fixtures SET team_a_id = ?, team_b_id = ? WHERE id = ?', [fixture.team_b_id, fixture.team_a_id, fixtureId]);
                    await mOptChoice.editReply({ content: `✅ Swapped teams. New: **${fixture.team_b} vs ${fixture.team_a}**.`, components: [] });
                } else {
                    const categories = message.guild.channels.cache.filter(c => c.type === discord_js_1.ChannelType.GuildCategory);
                    const cRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder().setCustomId('cat_m_edit').setPlaceholder('Select Category').addOptions(categories.map(c => ({ label: c.name, value: c.id })).slice(0, 25)));
                    await mOptChoice.editReply({ content: "Select new **Category** for this match:", components: [cRow] });
                    const cSelect = await awaitComponent(editMsg, { filter: i => i.user.id === message.author.id, time: 60000 }, "Edit timed out.", "⚠️ Failed to select a category.");
                    if (!cSelect)
                        return;
                    await cSelect.deferUpdate();
                    const channels = message.guild.channels.cache.filter(ch => ch.parentId === cSelect.values[0] && ch.type === discord_js_1.ChannelType.GuildText);
                    const sRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder().setCustomId('s_m_edit').setPlaceholder('Select Channel').addOptions(channels.map(ch => ({ label: ch.name, value: ch.id })).slice(0, 25)));
                    await cSelect.editReply({ content: "Select new **Channel** for this match:", components: [sRow] });
                    const sSelect = await awaitComponent(editMsg, { filter: i => i.user.id === message.author.id, time: 60000 }, "Edit timed out.", "⚠️ Failed to select a channel.");
                    if (!sSelect)
                        return;
                    await sSelect.deferUpdate();
                    await db.run('UPDATE generated_fixtures SET stadium_id = ? WHERE id = ?', [sSelect.values[0], fixtureId]);
                    await sSelect.editReply({ content: `✅ Match stadium updated to <#${sSelect.values[0]}>.`, components: [] });
                }
            }
        } catch (e) { return message.reply("Edit timed out."); }
        return;
    }

    if (command === 'setfixturechannel') {
        const categories = message.guild.channels.cache
            .filter(c => c.type === discord_js_1.ChannelType.GuildCategory)
            .map(c => ({ label: c.name, value: c.id }))
            .slice(0, 25);

        if (categories.length === 0) return message.reply("No categories found in this server.");

        const catRow = new discord_js_1.ActionRowBuilder().addComponents(
            new discord_js_1.StringSelectMenuBuilder()
                .setCustomId('fix_cat_select')
                .setPlaceholder('Select Category')
                .addOptions(categories)
        );

        const response = await message.reply({ content: "Select a **Category** for the fixture announcement channel:", components: [catRow] });

        try {
            const catInteraction = await awaitComponent(response, { filter: i => i.user.id === message.author.id, time: 60000, max: 1 }, "❌ Interaction timed out.", "⚠️ Failed to select a category.");
            if (!catInteraction)
                return;
            await catInteraction.deferUpdate();
            const categoryId = catInteraction.values[0];

            const channels = message.guild.channels.cache
                .filter(ch => ch.parentId === categoryId && ch.type === discord_js_1.ChannelType.GuildText)
                .map(ch => ({ label: ch.name, value: ch.id }))
                .slice(0, 25);

            if (channels.length === 0) {
                return await catInteraction.editReply({ content: "No text channels found in this category.", components: [] });
            }

            const chanRow = new discord_js_1.ActionRowBuilder().addComponents(
                new discord_js_1.StringSelectMenuBuilder()
                    .setCustomId('fix_chan_select')
                    .setPlaceholder('Select Channel')
                    .addOptions(channels)
            );

            await catInteraction.editReply({ content: "Select the **Channel** for fixture announcements:", components: [chanRow] });

            const chanInteraction = await awaitComponent(response, { filter: i => i.user.id === message.author.id, time: 60000, max: 1 }, "❌ Interaction timed out.", "⚠️ Failed to select a channel.");
            if (!chanInteraction)
                return;
            await chanInteraction.deferUpdate();
            const channelId = chanInteraction.values[0];

            await db.run(`INSERT INTO guild_settings (guild_id, fixture_announcement_channel_id) VALUES (?, ?)
                          ON CONFLICT(guild_id) DO UPDATE SET fixture_announcement_channel_id = ?`,
                          guildId, channelId, channelId);

            await chanInteraction.editReply({ 
                content: `✅ Fixture announcement channel updated to <#${channelId}>.`, 
                components: [] 
            });

        } catch (e) {
            await respondComponentError(response, e, "❌ Interaction timed out.", "⚠️ Failed to update fixture announcement channel.");
        }
        return;
    }

    if (command === 'appc') {
        const channel = message.mentions.channels.first();
        if (!channel) return message.reply("Usage: `?appc [#channel]`");

        await db.run(`INSERT INTO guild_settings (guild_id, ping_restricted_channel_id) VALUES (?, ?)
                      ON CONFLICT(guild_id) DO UPDATE SET ping_restricted_channel_id = ?`,
                      guildId, channel.id, channel.id);

        return message.reply(`✅ Admin ping restricted channel updated to ${channel}.`);
    }

    if (command === 'fixtures' || command === 'fixture') {
        const season = await matchSystem_1.matchSystem.getActiveScheduleSeason(guildId);
        if (!season) return message.reply("No scheduling season found.");

        if (args[0] === 'playoff') {
            return await pointTable_1.handlePlayoffFixture(message, args.slice(1));
        }

        if (args[0] === 'auto') {
            if (!(0, utils_1.isAdmin)(message.member)) return message.reply("Admin only.");
            const sub = args[1]?.toLowerCase();
            
            if (sub === 'settime' || sub === 'time') {
                const timeStr = args[2];
                if (!timeStr) return message.reply("Usage: `?fixture auto time <HH:MM>` (e.g. `?fixture auto time 21:00`) ");
                await db.run('INSERT INTO fixture_settings (guild_id, auto_announce_time) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET auto_announce_time = excluded.auto_announce_time', [guildId, timeStr]);
                return message.reply(`✅ Auto fixture announcement time set to **${timeStr}**. Use \`?fixture auto enable\` to turn it on.`);
            }
            if (sub === 'enable' || sub === 'on') {
                const settings = await db.get('SELECT auto_announce_time FROM fixture_settings WHERE guild_id = ?', guildId);
                if (!settings?.auto_announce_time) return message.reply("❌ Please set an announcement time first using `?fixture auto time <HH:MM>`.");
                await db.run('UPDATE fixture_settings SET auto_announce_enabled = 1 WHERE guild_id = ?', guildId);
                return message.reply(`✅ Auto fixture announcement **ENABLED** for **${settings.auto_announce_time}** daily.`);
            }
            if (sub === 'disable' || sub === 'off') {
                await db.run('UPDATE fixture_settings SET auto_announce_enabled = 0 WHERE guild_id = ?', guildId);
                return message.reply("✅ Auto fixture announcement **DISABLED**.");
            }
            if (sub === 'day') {
                const nextNormalState = await matchSystem_1.matchSystem.getNextNormalAnnouncementState(guildId, season);
                if (nextNormalState.kind === 'ready' && Number.isInteger(nextNormalState.dayNumber)) {
                    const result = await matchSystem_1.matchSystem.announceFixtureDay(message.guild, nextNormalState.dayNumber, false);
                    if (result.ok) return message.reply(`✅ Automatically announced **Day ${nextNormalState.dayNumber}** (${result.fixturesCount} matches).`);
                    return message.reply(`❌ Failed to announce: ${result.error}`);
                }
                if (nextNormalState.kind === 'already_active') {
                    return message.reply(`❌ Day ${nextNormalState.dayNumber} is already active in stadiums. Finish or undo it before announcing a newer day.`);
                }
                if (nextNormalState.kind === 'blocked') {
                    return message.reply(`❌ Day ${nextNormalState.dayNumber} is not over yet. The bot will not skip unfinished earlier days anymore.`);
                }
                const nextNormalDay = null;
                
                if (nextNormalDay) {
                    const result = await matchSystem_1.matchSystem.announceFixtureDay(message.guild, nextNormalDay, false);
                    if (result.ok) return message.reply(`✅ Automatically announced **Day ${nextNormalDay}** (${result.fixturesCount} matches).`);
                    return message.reply(`❌ Failed to announce: ${result.error}`);
                }

                const reserveBatches = await matchSystem_1.matchSystem.buildReserveDayBatches(guildId, season);
                const nextReserveDay = reserveBatches.batches[0]?.dayNumber || null;
                if (!nextReserveDay) {
                    return message.reply(`âŒ No more fixtures to announce.`);
                }
                const result = await matchSystem_1.matchSystem.announceFixtureDay(message.guild, nextReserveDay, true);
                if (result.ok) return message.reply(`✅ Automatically announced **Reserve Day ${nextReserveDay}** (${result.fixturesCount} matches).`);
                return message.reply(`❌ No more fixtures to announce.`);
            }
            return message.reply("Usage: `?fixture auto <time|enable|disable|day>`");
        }

        if (args[0] === 'over' || args[0] === 'overdays') {
            return await matchSystem_1.matchSystem.getFixtureDayStatusReport(message);
        }

        if (args[0] === 'repair') {
            if (!(0, utils_1.isAdmin)(message.member)) return message.reply("Admin only.");
            if (args[1] === 'reserve' && args[2] === 'day' && args[3]) {
                return await matchSystem_1.matchSystem.repairFixtureReserve(message, args.slice(1));
            }
            return message.reply("Usage: `?fixture repair reserve day <number> @ReserveTeam @OpponentTeam [nocount]`.");
        }

        if (args[0] === 'fix') {
            if (!(0, utils_1.isAdmin)(message.member)) return message.reply("Admin only.");
            if (args[1] === 'day' && args[2]) {
                const dayNumber = parseInt(args[2], 10);
                return await matchSystem_1.matchSystem.fixFixtureDay(message, dayNumber);
            }
            return message.reply("Usage: `?fixture fix day <number>`.");
        }

        if (args[0] === 'undo') {
            if (!(0, utils_1.isAdmin)(message.member)) return message.reply("Admin only.");
            if (args[1] === 'reserve' && args[2] === 'day' && args[3]) {
                const reserveDayNumber = parseInt(args[3], 10);
                return await matchSystem_1.matchSystem.undoFixtureDay(message, reserveDayNumber, true);
            }
            if (args[1] === 'day' && args[2]) {
                const dayNumber = parseInt(args[2], 10);
                return await matchSystem_1.matchSystem.undoFixtureDay(message, dayNumber, false);
            }
            return message.reply("Usage: `?fixture undo day <number>` or `?fixture undo reserve day <number>`.");
        }

        if (args.length === 0) {
            return message.reply("Please specify an option: `?fixture all`, `?fixture day [number]`, `?fixture reserve day [number]`, `?fixture reserve all`, `?fixture over`, `?fixture fix day [number]`, `?fixture repair reserve day [number]`, or `?fixture undo day [number]`.\nAdmin: `?fixture auto <time|enable|disable|day>`");
        }

        const settings = await db.get('SELECT * FROM fixture_settings WHERE guild_id = ?', guildId) || {};
        const teams = await db.all('SELECT * FROM teams WHERE guild_id = ?', guildId);

        if (args[0] === 'all') {
            const fixtures = await db.all('SELECT * FROM generated_fixtures WHERE guild_id = ? AND season_name = ? ORDER BY day_number', guildId, season);
            if (fixtures.length === 0) return message.reply("No fixtures found.");

            const days = [...new Set(fixtures.map(f => f.day_number))].sort((a,b) => a-b);
            const itemsPerPage = 3; // Reduced to 3 days to avoid character limits
            const totalPages = Math.ceil(days.length / itemsPerPage);
            let currentPage = 0;

            const getEmbed = (page) => {
                const start = page * itemsPerPage;
                const end = start + itemsPerPage;
                const pageDays = days.slice(start, end);

                const embed = new discord_js_1.EmbedBuilder()
                    .setTitle(`📅 Full Fixture List: ${season}`)
                    .setColor(0x00AAFF)
                    .setFooter({ text: `Page ${page + 1} of ${totalPages} | ${fixtures.length} Total Matches` });

                for (const day of pageDays) {
                    const dayFix = fixtures.filter(f => f.day_number === day);
                    const matchText = dayFix.map(f => {
                        const t1 = teams.find(t => t.team_id === f.team_a_id);
                        const t2 = teams.find(t => t.team_id === f.team_b_id);
                        return `• **${t1?.team_name || 'Unknown'}** vs **${t2?.team_name || 'Unknown'}** ✈️ in <#${f.stadium_id}>`;
                    }).join('\n');
                    embed.addFields({ name: `Day ${day}`, value: matchText || 'No matches' });
                }
                return embed;
            };

            const row = new discord_js_1.ActionRowBuilder().addComponents(
                new discord_js_1.ButtonBuilder().setCustomId('fix_prev').setLabel('◀️').setStyle(discord_js_1.ButtonStyle.Primary).setDisabled(currentPage === 0),
                new discord_js_1.ButtonBuilder().setCustomId('fix_next').setLabel('▶️').setStyle(discord_js_1.ButtonStyle.Primary).setDisabled(currentPage === totalPages - 1)
            );

            const resp = await message.reply({ embeds: [getEmbed(0)], components: totalPages > 1 ? [row] : [] });
            if (totalPages > 1) {
                const collector = resp.createMessageComponentCollector({ filter: i => i.user.id === message.author.id, time: 300000 });
                collector.on('collect', async i => {
                    if (i.customId === 'fix_prev') currentPage = Math.max(0, currentPage - 1);
                    if (i.customId === 'fix_next') currentPage = Math.min(totalPages - 1, currentPage + 1);
                    
                    const newRow = new discord_js_1.ActionRowBuilder().addComponents(
                        new discord_js_1.ButtonBuilder().setCustomId('fix_prev').setLabel('◀️').setStyle(discord_js_1.ButtonStyle.Primary).setDisabled(currentPage === 0),
                        new discord_js_1.ButtonBuilder().setCustomId('fix_next').setLabel('▶️').setStyle(discord_js_1.ButtonStyle.Primary).setDisabled(currentPage === totalPages - 1)
                    );
                    await i.update({ embeds: [getEmbed(currentPage)], components: [newRow] });
                });
            }
            return;
        }

        let dayNum = null;
        let isReserveDay = false;
        let isReserveAll = false;

        if (args[0] === 'reserve' && args[1] === 'day' && args[2]) {
            if (!(0, utils_1.isAdmin)(message.member)) return message.reply("Admin only.");
            dayNum = parseInt(args[2], 10);
            isReserveDay = true;
        } else if (args[0] === 'reserve' && args[1] === 'all') {
            if (!(0, utils_1.isAdmin)(message.member)) return message.reply("Admin only.");
            isReserveDay = true;
            isReserveAll = true;
        } else if (args[0] === 'day' && args[1]) {
            if (!(0, utils_1.isAdmin)(message.member)) return message.reply("Admin only.");
            dayNum = parseInt(args[1], 10);
        } else {
            return message.reply("Invalid option. Use `?fixture all`, `?fixture day [number]`, `?fixture reserve day [number]`, or `?fixture reserve all`.");
        }

        let fixtures;
        let reserveBatches = null;
        if (isReserveDay) {
            reserveBatches = await matchSystem_1.matchSystem.buildReserveDayBatches(guildId, season);
            if (!reserveBatches.batches.length) return message.reply("No pending reserved matches found.");
            if (isReserveAll) {
                fixtures = reserveBatches.batches.flatMap(batch => batch.entries);
            } else {
                const selectedBatch = reserveBatches.batches.find(batch => batch.dayNumber === Number(dayNum)) || null;
                if (!selectedBatch) return message.reply(`No pending reserved matches found for Reserve Day ${dayNum}.`);
                fixtures = selectedBatch.entries;
            }
        } else {
            fixtures = await db.all('SELECT * FROM generated_fixtures WHERE guild_id = ? AND season_name = ? AND day_number = ?', [guildId, season, dayNum]);
        }

        if (fixtures.length === 0) return message.reply(isReserveDay ? "No pending reserved matches found." : "No fixtures found for that day.");

        const formatMatch = (f) => {
            const teamAId = f.fixture?.team_a_id || f.team_a_id;
            const teamBId = f.fixture?.team_b_id || f.team_b_id;
            const t1 = teams.find(t => t.team_id === teamAId);
            const t2 = teams.find(t => t.team_id === teamBId);
            const ping1 = t1?.role_id ? `<@&${t1.role_id}>` : (t1 ? t1.team_name : "Unknown");
            const ping2 = t2?.role_id ? `<@&${t2.role_id}>` : (t2 ? t2.team_name : "Unknown");
            const stadium = f.reservation?.stadium_channel_id || f.fixture?.stadium_id || f.stadium_id || f.stadium_channel_id;
            return `${ping1} VS ${ping2} ✈️ in <#${stadium}>`;
        };

        const settingsTZ = await db.get('SELECT timezone FROM guild_settings WHERE guild_id = ?', guildId);
        let tz = settingsTZ ? settingsTZ.timezone : 'Asia/Kolkata';
        if (tz === 'IST') tz = 'Asia/Kolkata';

        const now = new Date();
        const deadlineDate = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'long', year: 'numeric' }).format(now);
        const deadlineStr = `11:59 PM ${deadlineDate}`;

        let header = `# ${settings.title_text || 'Cinematic Showdown'}\n`;
        if (settings.sponsor_text && String(settings.sponsor_text).trim()) {
            header += `-# Presented by ${String(settings.sponsor_text).trim()}\n`;
        }
        header += `\n# ${isReserveAll ? 'All Reserve Days' : `${isReserveDay ? 'Reserve ' : ''}Day ${dayNum}`} Fixture \n`;

        if (!isReserveDay) {
            const maxDayRes = await db.get('SELECT MAX(day_number) as maxDay FROM generated_fixtures WHERE guild_id = ? AND season_name = ?', [guildId, season]);
            if (maxDayRes && maxDayRes.maxDay === dayNum) {
                header += `### 📢 Last Day of Normal Fixtures! 🏁\n`;
            }
        }

        const matchLines = isReserveAll
            ? reserveBatches.batches.flatMap(batch => [
                `### Reserve Day ${batch.dayNumber}`,
                ...batch.entries.map(f => `- ${formatMatch(f)}`)
            ])
            : fixtures.map(f => `- ${formatMatch(f)}`);

        let footer = `\nRules -\n`;
        footer += `- Min ${settings.min_players || '6v6'} Max ${settings.max_players || '9v9'}\n`;
        footer += `- Must do .tm ; .ctn ; .o before starting \n`;
        footer += `- Max Reserve : ${settings.max_reserve || 2} per team \n`;
        footer += `- ${settings.rep_rules || '3 Rep max ; 1 rep = 30 runs , 2 rep = 25 runs , 3 rep = 20 runs'}\n`;
        footer += `- Please agree on time in your respective stadiums.\n\n`;
        footer += `### Format - ${settings.match_format || '20 Overs Elite with catch'}\n\n`;
        footer += `### Deadline - Complete matches before ${deadlineStr}`;

        const gSettings = await db.get('SELECT fixture_announcement_channel_id FROM guild_settings WHERE guild_id = ?', guildId);
        let channel = message.mentions.channels.first();
        if (!channel && gSettings?.fixture_announcement_channel_id) {
            channel = await message.guild.channels.fetch(gSettings.fixture_announcement_channel_id).catch(() => null);
        }
        if (!channel) channel = message.channel;

        {
            const reservePreviewText = isReserveDay
                ? (isReserveAll
                    ? reserveBatches.batches.map(batch => `Reserve Day ${batch.dayNumber}\n${batch.entries.map(f => `- ${formatMatch(f)}`).join('\n')}`).join('\n\n')
                    : fixtures.map(f => `- ${formatMatch(f)}`).join('\n'))
                : '';
            if (isReserveAll) {
                const reserveDays = reserveBatches.batches;
                const itemsPerPage = 3;
                const totalPages = Math.ceil(reserveDays.length / itemsPerPage);
                let currentPage = 0;
                const getReserveEmbed = (page) => {
                    const start = page * itemsPerPage;
                    const end = start + itemsPerPage;
                    const pageDays = reserveDays.slice(start, end);
                    const embed = new discord_js_1.EmbedBuilder()
                        .setTitle(`Pending Reserve Days: ${season}`)
                        .setColor(0xFACC15)
                        .setFooter({ text: `Page ${page + 1} of ${totalPages} | ${reserveDays.length} Reserve Day(s) | Limit: ${reserveBatches.maxMatchesPerDay} match(es) per team/day` });
                    for (const batch of pageDays) {
                        const matchText = batch.entries.map(f => `- ${formatMatch(f)}`).join('\n');
                        embed.addFields({ name: `Reserve Day ${batch.dayNumber}`, value: matchText || 'No matches' });
                    }
                    return embed;
                };
                const makeRow = () => new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId('reserve_all_prev_clean').setLabel('Prev').setStyle(discord_js_1.ButtonStyle.Primary).setDisabled(currentPage === 0), new discord_js_1.ButtonBuilder().setCustomId('reserve_all_next_clean').setLabel('Next').setStyle(discord_js_1.ButtonStyle.Primary).setDisabled(currentPage === totalPages - 1));
                const resp = await message.reply({ embeds: [getReserveEmbed(0)], components: totalPages > 1 ? [makeRow()] : [] });
                if (totalPages > 1) {
                    const collector = resp.createMessageComponentCollector({ filter: i => i.user.id === message.author.id, time: 300000 });
                    collector.on('collect', async i => {
                        if (i.customId === 'reserve_all_prev_clean')
                            currentPage = Math.max(0, currentPage - 1);
                        if (i.customId === 'reserve_all_next_clean')
                            currentPage = Math.min(totalPages - 1, currentPage + 1);
                        await i.update({ embeds: [getReserveEmbed(currentPage)], components: [makeRow()] });
                    });
                }
                return;
            }
            if (isReserveAll) {
                const reserveDays = reserveBatches.batches;
                const itemsPerPage = 3;
                const totalPages = Math.ceil(reserveDays.length / itemsPerPage);
                let currentPage = 0;
                const getReserveEmbed = (page) => {
                    const start = page * itemsPerPage;
                    const end = start + itemsPerPage;
                    const pageDays = reserveDays.slice(start, end);
                    const embed = new discord_js_1.EmbedBuilder()
                        .setTitle(`ðŸ“… Pending Reserve Days: ${season}`)
                        .setColor(0xFACC15)
                        .setFooter({ text: `Page ${page + 1} of ${totalPages} | ${reserveDays.length} Reserve Day(s) | Limit: ${reserveBatches.maxMatchesPerDay} match(es) per team/day` });
                    for (const batch of pageDays) {
                        const matchText = batch.entries.map(f => `â€¢ ${formatMatch(f)}`).join('\n');
                        embed.addFields({ name: `Reserve Day ${batch.dayNumber}`, value: matchText || 'No matches' });
                    }
                    return embed;
                };
                const row = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId('reserve_all_prev').setLabel('â—€ï¸').setStyle(discord_js_1.ButtonStyle.Primary).setDisabled(currentPage === 0), new discord_js_1.ButtonBuilder().setCustomId('reserve_all_next').setLabel('â–¶ï¸').setStyle(discord_js_1.ButtonStyle.Primary).setDisabled(currentPage === totalPages - 1));
                const resp = await message.reply({ embeds: [getReserveEmbed(0)], components: totalPages > 1 ? [row] : [] });
                if (totalPages > 1) {
                    const collector = resp.createMessageComponentCollector({ filter: i => i.user.id === message.author.id, time: 300000 });
                    collector.on('collect', async i => {
                        if (i.customId === 'reserve_all_prev')
                            currentPage = Math.max(0, currentPage - 1);
                        if (i.customId === 'reserve_all_next')
                            currentPage = Math.min(totalPages - 1, currentPage + 1);
                        const newRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId('reserve_all_prev').setLabel('â—€ï¸').setStyle(discord_js_1.ButtonStyle.Primary).setDisabled(currentPage === 0), new discord_js_1.ButtonBuilder().setCustomId('reserve_all_next').setLabel('â–¶ï¸').setStyle(discord_js_1.ButtonStyle.Primary).setDisabled(currentPage === totalPages - 1));
                        await i.update({ embeds: [getReserveEmbed(currentPage)], components: [newRow] });
                    });
                }
                return;
            }
            const confirmText = isReserveAll
                ? `Are you sure all the normal fixtures have been completed? This will announce **${reserveBatches.batches.length}** reserve day(s). Teams are still limited to **${reserveBatches.maxMatchesPerDay}** match(es) per reserve day.\n\n${reservePreviewText}`
                : `Announce **${isReserveDay ? 'Reserve ' : ''}Day ${dayNum}** fixtures and open those stadiums for scheduling?${reservePreviewText ? `\n\n${reservePreviewText}` : ''}`;
            if (!await (0, utils_1.askConfirmation)(message, confirmText)) {
                return message.reply("Action cancelled.");
            }
            if (isReserveAll) {
                const results = [];
                for (const batch of reserveBatches.batches) {
                    const result = await matchSystem_1.matchSystem.announceFixtureDay(message.guild, batch.dayNumber, true, null);
                    if (!result.ok) {
                        return message.reply(`âŒ Error while announcing Reserve Day ${batch.dayNumber}: ${result.error}`);
                    }
                    results.push(`Reserve Day ${batch.dayNumber}: ${result.fixturesCount} match(es)`);
                }
                return message.reply(`âœ… Announced all pending reserve days.\n${results.join('\n')}`);
            }
            const result = await matchSystem_1.matchSystem.announceFixtureDay(message.guild, dayNum, isReserveDay, null);
            if (!result.ok) return message.reply(`❌ Error: ${result.error}`);
        }
        return;
    }
}

async function drawCircularImage(ctx, url, x, y, size) {
    try {
        const img = await loadImage(url);
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, size / 2, 0, Math.PI * 2, true);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
        ctx.restore();
    } catch (e) {
        // Just skip if image fails to load
    }
}

async function generateLBImage(cat, allStats, seasonName, client, authorId) {
    const canvas = createCanvas(772, 1159);
    const ctx = canvas.getContext('2d');
    
    try {
        const background = await loadImage('./bluelb2.png');
        ctx.drawImage(background, 0, 0);
    } catch (e) {
        console.error("Failed to load bluelb2.png", e);
        ctx.fillStyle = '#0a1a2f';
        ctx.fillRect(0, 0, 772, 1159);
    }

    const config = {
        "title": { "x": 386, "y": 50, "size": 36 },
        "subtitle": { "x": 386, "y": 1155, "size": 25 },
        "top10": [
            { "avatarY": 230, "avatarX": 167, "avatarSize": 65, "textY": 247, "nameX": 249, "nameSize": 24, "statX": 686, "statSize": 26 },
            { "avatarY": 306.6, "avatarX": 166, "avatarSize": 60, "textY": 304.6, "nameX": 249, "nameSize": 24, "statX": 686, "statSize": 26 },
            { "avatarY": 372.2, "avatarX": 167, "avatarSize": 54, "textY": 365.2, "nameX": 249, "nameSize": 24, "statX": 686, "statSize": 26 },
            { "avatarY": 426.8, "avatarX": 169, "avatarSize": 48, "textY": 422.8, "nameX": 249, "nameSize": 24, "statX": 686, "statSize": 26 },
            { "avatarY": 480.4, "avatarX": 169, "avatarSize": 48, "textY": 480.4, "nameX": 249, "nameSize": 24, "statX": 686, "statSize": 26 },
            { "avatarY": 535, "avatarX": 169, "avatarSize": 48, "textY": 535, "nameX": 249, "nameSize": 24, "statX": 686, "statSize": 26 },
            { "avatarY": 590.6, "avatarX": 169, "avatarSize": 48, "textY": 590.6, "nameX": 249, "nameSize": 24, "statX": 686, "statSize": 26 },
            { "avatarY": 647.2, "avatarX": 169, "avatarSize": 48, "textY": 647.2, "nameX": 249, "nameSize": 24, "statX": 686, "statSize": 26 },
            { "avatarY": 703.8, "avatarX": 169, "avatarSize": 48, "textY": 703.8, "nameX": 249, "nameSize": 24, "statX": 686, "statSize": 26 },
            { "avatarY": 758.4, "avatarX": 169, "avatarSize": 48, "textY": 760.4, "nameX": 249, "nameSize": 24, "statX": 686, "statSize": 26 }
        ],
        "bottom": {
            "avatarY": 875, "avatarX": 169, "avatarSize": 49,
            "rankX": 110, "rankY": 875, "rankSize": 27,
            "nameX": 229, "nameY": 875, "nameSize": 29,
            "statX": 688, "statY": 875, "statSize": 31
        }
    };

    let filtered = [...allStats];
    if (cat.filter) filtered = allStats.filter(cat.filter);
    
    const fullSorted = filtered.sort(cat.sort);
    const top10 = fullSorted.slice(0, 10);

    // Draw Category Title
    ctx.fillStyle = '#00d4ff';
    ctx.font = `bold ${config.title.size}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(`${cat.label}`, config.title.x, config.title.y);
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.font = `italic ${config.subtitle.size}px sans-serif`;
    ctx.fillText(`Season: ${seasonName} | Category: ${cat.type.toUpperCase()}`, config.subtitle.x, config.subtitle.y);

    if (top10.length === 0) {
        ctx.fillStyle = 'white';
        ctx.font = 'bold 40px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText("NO DATA AVAILABLE", 386, 450);
    } else {
        // Fetch all users and avatars in parallel
        const top10Data = await Promise.all(top10.map(async (p) => {
            let avatarUrl = 'https://cdn.discordapp.com/embed/avatars/0.png';
            let username = p.user_id;
            try {
                const user = await client.users.fetch(p.user_id);
                avatarUrl = user.displayAvatarURL({ extension: 'png', size: 128 });
                username = user.username;
            } catch (e) {}

            let img = null;
            try {
                img = await loadImage(avatarUrl);
            } catch (e) {}

            return { p, img, username };
        }));

        for (let i = 0; i < top10Data.length; i++) {
            const { p, img, username } = top10Data[i];
            const rowCfg = config.top10[i];
            
            if (img) {
                ctx.save();
                ctx.beginPath();
                ctx.arc(rowCfg.avatarX, rowCfg.avatarY, rowCfg.avatarSize / 2, 0, Math.PI * 2, true);
                ctx.closePath();
                ctx.clip();
                ctx.drawImage(img, rowCfg.avatarX - rowCfg.avatarSize / 2, rowCfg.avatarY - rowCfg.avatarSize / 2, rowCfg.avatarSize, rowCfg.avatarSize);
                ctx.restore();
            }

            // Name
            ctx.fillStyle = 'white';
            ctx.textAlign = 'left';
            ctx.font = `bold ${rowCfg.nameSize}px sans-serif`;
            ctx.fillText(username.length > 18 ? username.slice(0, 16) + '..' : username, rowCfg.nameX, rowCfg.textY + 12);

            // Stats
            ctx.textAlign = 'right';
            ctx.font = `bold ${rowCfg.statSize}px sans-serif`;
            ctx.fillStyle = '#00d4ff';
            ctx.fillText(cat.format(p), rowCfg.statX, rowCfg.textY + 12);
        }
    }

    // Requester's rank in bottom box
    const userRankIndex = fullSorted.findIndex(p => p.user_id === authorId);
    if (userRankIndex !== -1) {
        const p = fullSorted[userRankIndex];
        const b = config.bottom;
        
        // Avatar
        let avatarUrl = 'https://cdn.discordapp.com/embed/avatars/0.png';
        let username = p.user_id;
        try {
            const user = await client.users.fetch(p.user_id);
            avatarUrl = user.displayAvatarURL({ extension: 'png', size: 128 });
            username = user.username;
        } catch (e) {}

        // Draw Rank BEFORE Avatar
        ctx.fillStyle = '#00d4ff';
        ctx.textAlign = 'center';
        ctx.font = `bold ${b.rankSize}px sans-serif`;
        ctx.fillText(`${userRankIndex + 1}.`, b.rankX, b.rankY + 12);

        // Avatar
        await drawCircularImage(ctx, avatarUrl, b.avatarX, b.avatarY, b.avatarSize);

        // Name
        ctx.fillStyle = 'white';
        ctx.textAlign = 'left';
        ctx.font = `bold ${b.nameSize}px sans-serif`;
        ctx.fillText(username.length > 18 ? username.slice(0, 16) + '..' : username, b.nameX, b.nameY + 12);

        // Stats
        ctx.textAlign = 'right';
        ctx.font = `bold ${b.statSize}px sans-serif`;
        ctx.fillStyle = '#00d4ff';
        ctx.fillText(cat.format(p), b.statX, b.statY + 12);
    }

    return canvas.toBuffer();
}

async function displayTeamHistory(message, team) {
    const db = (0, database_1.getDB)();
    const guildId = message.guild.id;
    const matches = await db.all(`
        SELECT * FROM pt_matches
        WHERE guild_id = ? AND (team_a = ? OR team_b = ?)
        ORDER BY timestamp DESC
    `, guildId, team.team_name, team.team_name);

    if (matches.length === 0) {
        return message.reply(`No matches found for **${team.team_name}**.`);
    }

    const history = new Map(); // Opponent -> { wins, losses, draws }
    let totalWins = 0;
    let totalLosses = 0;
    let totalDraws = 0;

    for (const m of matches) {
        const opponent = m.team_a === team.team_name ? m.team_b : m.team_a;
        if (!history.has(opponent)) {
            history.set(opponent, { wins: 0, losses: 0, draws: 0 });
        }
        const data = history.get(opponent);
        
        if (m.winner === team.team_name) {
            data.wins++;
            totalWins++;
        } else if (m.winner === 'Draw') {
            data.draws++;
            totalDraws++;
        } else if (m.winner) {
            data.losses++;
            totalLosses++;
        }
    }

    const embed = new discord_js_1.EmbedBuilder()
        .setTitle(`📊 Match History: ${team.team_name}`)
        .setDescription(`Overall Record: **${totalWins}W - ${totalLosses}L${totalDraws > 0 ? ` - ${totalDraws}D` : ''}**`)
        .setColor(0x3498DB)
        .setTimestamp()
        .setFooter({ text: `Requested by ${message.author.username}`, iconURL: message.author.displayAvatarURL() });

    const opponentLines = [];
    for (const [opponent, data] of history.entries()) {
        opponentLines.push(`**vs ${opponent}**: \`${data.wins}W - ${data.losses}L${data.draws > 0 ? ` - ${data.draws}D` : ''}\``);
    }

    // Split into fields if list is long, or just description
    if (opponentLines.length <= 15) {
        embed.addFields({ name: 'Opponents', value: opponentLines.join('\n') });
    } else {
        // Handle long lists by splitting into multiple fields or truncated list
        const mid = Math.ceil(opponentLines.length / 2);
        embed.addFields(
            { name: 'Opponents (1/2)', value: opponentLines.slice(0, mid).join('\n'), inline: true },
            { name: 'Opponents (2/2)', value: opponentLines.slice(mid).join('\n'), inline: true }
        );
    }

    return message.reply({ embeds: [embed] });
}

async function handleUserCommand(message, command, args) {
    const db = (0, database_1.getDB)();
    const guildId = message.guild?.id;
    if (!guildId)
        return;
    if (command === 'wallet') {
        const mention = message.mentions.users.first();
        let targetUser = mention || message.author;

        // Support for searching by IGN or Username
        if (!mention && args.length > 0) {
            const searchTerm = args.find(a => !a.startsWith('<@'));
            if (searchTerm) {
                const player = await db.get('SELECT discord_id FROM auction_players WHERE guild_id = ? AND ign LIKE ?', guildId, `%${searchTerm}%`);
                if (player) {
                    try { targetUser = await message.client.users.fetch(player.discord_id); } catch (e) {}
                } else {
                    try {
                        const members = await message.guild.members.fetch({ query: searchTerm, limit: 1 });
                        const member = members.first();
                        if (member) targetUser = member.user;
                    } catch (e) {}
                }
            }
        }

        const team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND owner_discord_id = ?', guildId, targetUser.id);
        if (!team) {
            if (targetUser.id === message.author.id)
                return message.reply("You do not own a team.");
            else
                return message.reply(`**${targetUser.username}** does not own a team.`);
        }
        const rosterCount = await db.get('SELECT COUNT(*) as count FROM auction_players WHERE guild_id = ? AND sold_to_team_id = ?', guildId, team.team_id);
        message.reply(`💰 **${team.team_name} Wallet:** ${(0, utils_1.lakhsToDisplay)(team.purse_lakhs)}
👥 **Roster Size:** ${rosterCount?.count || 0}/${team.max_roster_size}`);
    }
    else if (command === 'checkset') {
        const targetUser = args.length > 0 ? await resolveTargetUser(message, args) : message.author;
        if (!targetUser)
            return message.reply("Usage: `?checkset [@user/Username]`");
        const player = await db.get('SELECT ign, set_name FROM auction_players WHERE guild_id = ? AND discord_id = ?', guildId, targetUser.id);
        if (!player)
            return message.reply(`**${targetUser.username}** is not registered in the auction player list.`);
        const displayName = player.ign || targetUser.username;
        if (player.set_name)
            return message.reply(`**${displayName}** is in set **${player.set_name}**.`);
        return message.reply(`**${displayName}** is currently **Unassigned**.`);
    }
    else if (command === 'roster') {
        let team;
        const mention = message.mentions.users.first();
        let targetUser = mention || message.author;

        // Try to find target user if a name is provided
        if (!mention && args.length > 0) {
            const searchTerm = args.join(' ');
            // Check if it's a team name first
            const foundTeam = await db.get('SELECT * FROM teams WHERE guild_id = ? AND team_name LIKE ?', guildId, `%${searchTerm}%`);
            if (foundTeam) {
                team = foundTeam;
            } else {
                // Try searching for a user
                const player = await db.get('SELECT discord_id FROM auction_players WHERE guild_id = ? AND ign LIKE ?', guildId, `%${searchTerm}%`);
                if (player) {
                    try { targetUser = await message.client.users.fetch(player.discord_id); } catch (e) {}
                } else {
                    try {
                        const members = await message.guild.members.fetch({ query: searchTerm, limit: 1 });
                        const member = members.first();
                        if (member) targetUser = member.user;
                    } catch (e) {}
                }
            }
        }

        if (!team) {
            team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND owner_discord_id = ?', guildId, targetUser.id);
        }

        if (!team) {
            return message.reply(`No team found for **${targetUser.username}**. Usage: ?roster [TeamName/@Owner/Username]`);
        }

        const players = await db.all('SELECT * FROM auction_players WHERE guild_id = ? AND sold_to_team_id = ?', guildId, team.team_id);
        const embed = new discord_js_1.EmbedBuilder().setTitle(`📋 ${team.team_name} Roster (${players.length}/${team.max_roster_size})`).setColor(0x00FF00);
        if (players.length === 0) {
            embed.setDescription("(Empty)");
        }
        else {
            const playerList = players.map(p => `- **${p.ign}** (${(0, utils_1.lakhsToDisplay)(p.sold_for_lakhs)})`).join('\n');
            embed.setDescription(playerList);
        }
        message.reply({ embeds: [embed] });
    }
    else if (command === 'teamhistory') {
        const identifier = args.join(' ');
        if (!identifier) {
            const selection = await promptForAdminManagedTeamSelection(message, guildId, {
                groupPrompt: "Select a **Group** to view team history:",
                teamPrompt: "Select a **Team** to view history:"
            });
            if (selection.ok) {
                return await displayTeamHistory(message, selection.team);
            }
            return;
        }
        const team = await findTeamByIdentifier(guildId, identifier);
        if (!team) {
            return message.reply("Could not find that team.");
        }
        return await displayTeamHistory(message, team);
    }
    else if (command === 'publicping' || command === 'pping' || command === 'pp') {
        let role = message.mentions.roles.first();
        let pingData = null;

        if (role) {
            pingData = await db.get('SELECT * FROM public_pings WHERE guild_id = ? AND role_id = ?', guildId, role.id);
        } else if (args.length > 0) {
            const alias = args.join(' ').toLowerCase();
            pingData = await db.get('SELECT * FROM public_pings WHERE guild_id = ? AND alias = ?', guildId, alias);
            if (pingData) {
                role = await message.guild.roles.fetch(pingData.role_id).catch(() => null);
            }
        }

        if (!pingData || !role) return message.reply("Usage: `?pp @Role` or `?pp [alias]` (The role must be registered for public pings by an admin)");

        if (pingData.restricted_channel_id && message.channel.id !== pingData.restricted_channel_id) {
            return message.reply(`⚠️ This ping can only be used in <#${pingData.restricted_channel_id}>.`);
        }

        const now = Math.floor(Date.now() / 1000);        const nextAllowed = pingData.last_ping_timestamp + pingData.cooldown_seconds;
        
        if (now < nextAllowed) {
            const remaining = nextAllowed - now;
            const min = Math.floor(remaining / 60);
            const sec = remaining % 60;
            return message.reply(`⏳ **Cooldown Active!** You can ping **${role.name}** again in **${min}m ${sec}s**.`);
        }
        
        await db.run('UPDATE public_pings SET last_ping_timestamp = ? WHERE guild_id = ? AND role_id = ?', now, guildId, role.id);
        await message.channel.send(`📢 **Public Ping for ${role.name}!**\n<@&${role.id}> (Sent by ${message.author.username})`);
    }
    else if (command === 'checktime' || command === 'time') {
        const settings = await db.get('SELECT timezone FROM guild_settings WHERE guild_id = ?', guildId);
        let timezone = settings ? settings.timezone : 'IST';
        if (timezone === 'IST') timezone = 'Asia/Kolkata';
        
        try {
            const now = new Date();
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: timezone,
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                timeZoneName: 'short'
            });
            message.reply(`🕒 **Current Time:** ${formatter.format(now)}`);
        } catch (e) {
            message.reply(`⚠️ Error: Invalid timezone configured ('${timezone}'). Defaulting to UTC.\n${new Date().toUTCString()}`);
        }
    }
    else if (command === 'dmrole') {
        const role = message.mentions.roles.first();
        if (!role) return message.reply("Usage: ?dmrole [@Role] [Message]");

        const isAdm = (0, utils_1.isAdmin)(message.member);
        const captainRecord = await db.get('SELECT * FROM role_captains WHERE guild_id = ? AND role_id = ? AND captain_id = ?', guildId, role.id, message.author.id);

        if (!isAdm && !captainRecord) {
            return message.reply("You do not have permission to message this role.");
        }
        
        const content = args.filter(a => !a.includes(role.id)).join(' ');
        if (!content) return message.reply("Please provide a message to send.");
        
        await message.reply(`📨 Sending DM to **${role.members.size}** members with role **${role.name}**...`);
        let sent = 0;
        let failed = 0;
        
        // Fetch only members with this role
        await message.guild.members.fetch({ role: role.id });
        
        for (const [id, member] of role.members) {
            try {
                await member.send(`📢 **Message from ${message.author.username}:**\n\n${content}`);
                sent++;
            } catch (e) {
                failed++;
            }
        }
        message.channel.send(`✅ Sent: **${sent}** | ❌ Failed: **${failed}** (DMs closed/Blocked)`);
    }
    else if (command === 'scheduledm' || command === 'sdm') {
        const role = message.mentions.roles.first();
        const user = message.mentions.users.first();
        
        if (!role && !user) return message.reply("Usage: ?scheduledm [@Role/@User] [Time] [Message]");
        
        const targetId = role ? role.id : user.id;
        const targetType = role ? 'ROLE' : 'USER';
        const targetName = role ? role.name : user.username;

        // Permission Check
        const isAdm = (0, utils_1.isAdmin)(message.member);
        let hasPerm = isAdm;

        if (!isAdm) {
            if (targetType === 'ROLE') {
                const captainRecord = await db.get('SELECT * FROM role_captains WHERE guild_id = ? AND role_id = ? AND captain_id = ?', guildId, role.id, message.author.id);
                if (captainRecord) hasPerm = true;
            }
            // For USER targets, currently restricting to Admin only to prevent abuse
        }

        if (!hasPerm) return message.reply("You do not have permission to schedule messages for this target.");

        const argsWithoutTarget = args.filter(a => !a.includes(targetId));
        const timeArg = argsWithoutTarget[0];
        const content = argsWithoutTarget.slice(1).join(' ');
        
        if (!timeArg || !content) return message.reply("Missing time or message content.");
        
        let scheduledTime = 0;
        const now = new Date();
        
        if (timeArg.match(/^\d+[mh]$/)) {
            const val = parseInt(timeArg.slice(0, -1));
            const unit = timeArg.slice(-1);
            if (unit === 'm') scheduledTime = Math.floor(now.getTime() / 1000) + (val * 60);
            if (unit === 'h') scheduledTime = Math.floor(now.getTime() / 1000) + (val * 3600);
        } else if (timeArg.match(/^\d{1,2}:\d{2}(\s*(AM|PM))?$/i)) {
            const settings = await db.get('SELECT timezone FROM guild_settings WHERE guild_id = ?', guildId);
            let tz = settings ? settings.timezone : 'IST';
            if (tz === 'IST') tz = 'Asia/Kolkata';
            
            const match = timeArg.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
            let hrs = parseInt(match[1]);
            const mins = parseInt(match[2]);
            const ampm = match[3];

            let is12Hour = !!ampm;
            if (is12Hour) {
                if (ampm.toUpperCase() === 'PM' && hrs < 12) hrs += 12;
                if (ampm.toUpperCase() === 'AM' && hrs === 12) hrs = 0;
            }
            
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: tz,
                year: 'numeric', month: 'numeric', day: 'numeric',
                hour12: false
            });
            const parts = formatter.formatToParts(now);
            const getPart = (type) => parseInt(parts.find(p => p.type === type).value);
            
            const tYear = getPart('year');
            const tMonth = getPart('month');
            const tDay = getPart('day');

            const targetISO = `${tYear}-${String(tMonth).padStart(2, '0')}-${String(tDay).padStart(2, '0')}T${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:00`;
            
            const getOffset = (date, timeZone) => {
                const parts = new Intl.DateTimeFormat('en-US', {
                    timeZone,
                    timeZoneName: 'shortOffset'
                }).formatToParts(date);
                const offsetName = parts.find(p => p.type === 'timeZoneName').value;
                const match = offsetName.match(/[+-](\d+):(\d+)/);
                if (!match) return 0;
                const oHrs = parseInt(match[1]);
                const oMins = parseInt(match[2]);
                const totalMins = (oHrs * 60) + oMins;
                return offsetName.startsWith('GMT-') ? -totalMins : totalMins;
            };

            const tempDate = new Date(targetISO + 'Z'); 
            const offsetMins = getOffset(tempDate, tz);
            scheduledTime = Math.floor((tempDate.getTime() - (offsetMins * 60000)) / 1000);

            // Ambiguity Resolution: If no AM/PM provided and hrs <= 12, assume next occurrence
            if (!is12Hour && hrs <= 12 && scheduledTime < Math.floor(now.getTime() / 1000)) {
                const pmTime = scheduledTime + (12 * 3600);
                if (pmTime > Math.floor(now.getTime() / 1000)) {
                    scheduledTime = pmTime;
                }
            }

            if (scheduledTime < Math.floor(now.getTime() / 1000)) {
                scheduledTime += 86400;
            }

        } else if (timeArg.match(/^\d{4}-\d{2}-\d{2}_\d{2}:\d{2}$/)) {
             // YYYY-MM-DD_HH:MM
             const settings = await db.get('SELECT timezone FROM guild_settings WHERE guild_id = ?', guildId);
             let tz = settings ? settings.timezone : 'IST';
             if (tz === 'IST') tz = 'Asia/Kolkata';

             const cleanTime = timeArg.replace('_', 'T'); // ISO format T
             const tempDate = new Date(cleanTime + ':00Z');

             if (isNaN(tempDate.getTime())) return message.reply("Invalid date format.");

             const getOffset = (date, timeZone) => {
                 const parts = new Intl.DateTimeFormat('en-US', {
                     timeZone,
                     timeZoneName: 'shortOffset'
                 }).formatToParts(date);
                 const offsetName = parts.find(p => p.type === 'timeZoneName').value;
                 const match = offsetName.match(/[+-](\d+):(\d+)/);
                 if (!match) return 0;
                 const oHrs = parseInt(match[1]);
                 const oMins = parseInt(match[2]);
                 const totalMins = (oHrs * 60) + oMins;
                 return offsetName.startsWith('GMT-') ? -totalMins : totalMins;
             };

             const offsetMins = getOffset(tempDate, tz);
             scheduledTime = Math.floor((tempDate.getTime() - (offsetMins * 60000)) / 1000);
        } else {             return message.reply("Invalid time format.");
        }
        
        await db.run('INSERT INTO scheduled_messages (guild_id, target_role_id, target_type, message_content, scheduled_time, status, author_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
            guildId, targetId, targetType, content, scheduledTime, 'PENDING', message.author.id);
            
        const displayTime = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Kolkata',
            dateStyle: 'full',
            timeStyle: 'short'
        }).format(new Date(scheduledTime * 1000));

        message.reply(`✅ Message scheduled for **${displayTime} IST** to **${targetName}**.`);
    }
    else if (command === 'teams') {
        const teams = await db.all('SELECT * FROM teams WHERE guild_id = ?', guildId);
        if (teams.length === 0)
            return message.reply("No teams registered.");
        const counts = await db.all('SELECT sold_to_team_id, COUNT(*) as count FROM auction_players WHERE guild_id = ? AND sold_to_team_id IS NOT NULL GROUP BY sold_to_team_id', guildId);
        const countMap = new Map();
        counts.forEach(c => countMap.set(c.sold_to_team_id, c.count));
        const embed = new discord_js_1.EmbedBuilder().setTitle('🏆 Registered Teams').setColor(0x00FF00);
        teams.forEach(t => {
            const count = countMap.get(t.team_id) || 0;
            embed.addFields({
                name: t.team_name,
                value: `💰 Budget: **${(0, utils_1.lakhsToDisplay)(t.purse_lakhs)}**\n👥 Players: **${count}/${t.max_roster_size}**`,
                inline: true
            });
        });
        message.reply({ embeds: [embed] });
    }
    else if (command === 'sets') {
        const sets = await getOrderedSets(guildId);
        if (sets.length === 0)
            return message.reply("No sets created.");
        const stats = await db.all('SELECT set_name, status, COUNT(*) as count FROM auction_players WHERE guild_id = ? GROUP BY set_name, status', guildId);
        const setStats = new Map();
        sets.forEach(s => setStats.set(s.set_name, { total: 0, available: 0 }));
        stats.forEach(st => {
            if (st.set_name && setStats.has(st.set_name)) {
                const entry = setStats.get(st.set_name);
                entry.total += st.count;
                if (st.status === 'AVAILABLE')
                    entry.available += st.count;
            }
        });
        const embed = new discord_js_1.EmbedBuilder().setTitle('📂 Auction Sets').setColor(0xFFD700);
        sets.forEach(s => {
            const stat = setStats.get(s.set_name);
            embed.addFields({
                name: s.set_name,
                value: `💰 Base: **${(0, utils_1.lakhsToDisplay)(s.base_price_lakhs)}**\n📊 Available: **${stat.available}/${stat.total}**`,
                inline: true
            });
        });
        message.reply({ embeds: [embed] });
    }
    else if (command === 'leaderboard') {
        const teams = await db.all('SELECT * FROM teams WHERE guild_id = ? ORDER BY purse_lakhs DESC', guildId);
        if (teams.length === 0)
            return message.reply("No teams found.");
        const embed = new discord_js_1.EmbedBuilder().setTitle('🏆 Team Leaderboard').setColor(0xFFA500).setDescription(teams.map((t, i) => `${i + 1}. **${t.team_name}**: ${(0, utils_1.lakhsToDisplay)(t.purse_lakhs)}`).join('\n'));
        message.reply({ embeds: [embed] });
    }
    else if (command === 'allrosters') {
        const teams = await db.all('SELECT * FROM teams WHERE guild_id = ?', guildId);
        if (teams.length === 0)
            return message.reply("No teams registered.");
        const players = await db.all('SELECT * FROM auction_players WHERE guild_id = ? AND status = "SOLD"', guildId);
        const rosterMap = new Map();
        teams.forEach(t => rosterMap.set(t.team_id, []));
        players.forEach(p => {
            if (p.sold_to_team_id && rosterMap.has(p.sold_to_team_id)) {
                rosterMap.get(p.sold_to_team_id).push(`- ${p.ign} (${(0, utils_1.lakhsToDisplay)(p.sold_for_lakhs)})`);
            }
        });
        const embed = new discord_js_1.EmbedBuilder().setTitle('👥 All Team Rosters').setColor(0x00AAAA);
        teams.forEach(t => {
            const list = rosterMap.get(t.team_id);
            embed.addFields({
                name: `${t.team_name} (${list.length})`,
                value: list.join('\n') || '*(Empty)*',
                inline: true
            });
        });
        message.reply({ embeds: [embed] });
    }
    else if (command === 'players') {
        const setName = args.join(' ');
        const embed = new discord_js_1.EmbedBuilder().setColor(0x0099ff);
        if (setName) {
            const players = await db.all('SELECT * FROM auction_players WHERE guild_id = ? AND set_name LIKE ?', guildId, setName);
            if (players.length === 0)
                return message.reply(`No players found in set "${setName}".`);
            const list = players.map((p) => {
                let nameStr = p.ign;
                let statusStr = '';
                if (p.status === 'SOLD') {
                    nameStr = `~~${p.ign}~~`;
                    statusStr = `(Sold: ${(0, utils_1.lakhsToDisplay)(p.sold_for_lakhs)})`;
                }
                else if (p.status === 'UNSOLD') {
                    statusStr = `(Unsold)`;
                }
                return `**${nameStr}** ${statusStr}`;
            }).join('\n');
            embed.setTitle(`📂 Players in "${setName}" (${players.length})`).setDescription(list);
            message.reply({ embeds: [embed] });
        }
        else {
            const players = await db.all('SELECT * FROM auction_players WHERE guild_id = ? ORDER BY set_name', guildId);
            if (players.length === 0)
                return message.reply("No players registered.");
            const grouped = new Map();
            players.forEach(p => {
                const s = p.set_name || 'Unassigned';
                if (!grouped.has(s))
                    grouped.set(s, []);
                let display = p.ign;
                if (p.status === 'SOLD') {
                    display = `~~${p.ign}~~ (Sold: ${(0, utils_1.lakhsToDisplay)(p.sold_for_lakhs)})`;
                }
                else if (p.status === 'UNSOLD') {
                    display = `${p.ign} (Unsold)`;
                }
                grouped.get(s).push(display);
            });
            embed.setTitle(`📜 All Auction Players (${players.length})`);
            grouped.forEach((list, set) => {
                const formattedList = list.join('\n');
                embed.addFields({ name: `**${set} (${list.length})**`, value: formattedList || 'None', inline: false });
            });
            message.reply({ embeds: [embed] });
        }
    }
    else if (command === 'renameteam') {
        const targetUser = message.mentions.users.first();
        const userIsAdmin = (0, utils_1.isAdmin)(message.member);
        let teamToRename;
        let newName = '';
        if (targetUser && userIsAdmin) {
            teamToRename = await db.get('SELECT * FROM teams WHERE guild_id = ? AND owner_discord_id = ?', guildId, targetUser.id);
            if (!teamToRename)
                return message.reply(`User ${targetUser.username} does not own a team.`);
            newName = args.filter(a => !a.startsWith('<@') && !a.match(/^\d+$/)).join(' ').trim();
        }
        else {
            teamToRename = await db.get('SELECT * FROM teams WHERE guild_id = ? AND owner_discord_id = ?', guildId, message.author.id);
            if (!teamToRename)
                return message.reply("You do not own a team.");
            newName = args.join(' ').trim();
        }
        if (!newName)
            return message.reply("Usage: ?renameteam [New Name] (or .renameteam @Owner [New Name] for admins)");
        const existing = await db.get('SELECT * FROM teams WHERE guild_id = ? AND team_name = ?', guildId, newName);
        if (existing)
            return message.reply(`Team name "${newName}" is already taken.`);
        await db.run('UPDATE teams SET team_name = ? WHERE guild_id = ? AND team_id = ?', newName, guildId, teamToRename.team_id);
        message.reply(`✅ Team renamed to **${newName}**.`);
    }
    else if (command === 'rosterwithping' || command === 'rwp') {
        if (args.length === 1 && args[0].toLowerCase() === 'all') {
            const teams = await db.all('SELECT * FROM teams WHERE guild_id = ? ORDER BY team_name COLLATE NOCASE ASC', guildId);
            if (teams.length === 0) {
                await message.channel.send("No teams registered.");
                return;
            }
            const captainRows = await db.all('SELECT team_id, captain_discord_id FROM team_captains WHERE guild_id = ?', guildId);
            const captainMap = new Map(captainRows.map(row => [row.team_id, row.captain_discord_id]));
            const soldPlayers = await db.all('SELECT sold_to_team_id, discord_id FROM auction_players WHERE guild_id = ? AND status = "SOLD"', guildId);
            const soldMap = new Map();
            soldPlayers.forEach(player => {
                if (!player.sold_to_team_id)
                    return;
                if (!soldMap.has(player.sold_to_team_id)) {
                    soldMap.set(player.sold_to_team_id, []);
                }
                soldMap.get(player.sold_to_team_id).push(player.discord_id);
            });
            const teamBlocks = [];
            for (const currentTeam of teams) {
                const memberIds = new Set();
                if (/^\d{15,21}$/.test(String(currentTeam.owner_discord_id || ''))) {
                    memberIds.add(currentTeam.owner_discord_id);
                }
                const captainId = captainMap.get(currentTeam.team_id);
                if (/^\d{15,21}$/.test(String(captainId || ''))) {
                    memberIds.add(captainId);
                }
                const soldIds = soldMap.get(currentTeam.team_id) || [];
                soldIds.forEach(discordId => {
                    if (/^\d{15,21}$/.test(String(discordId || ''))) {
                        memberIds.add(discordId);
                    }
                });
                if (currentTeam.role_id) {
                    const role = message.guild.roles.cache.get(currentTeam.role_id) || await message.guild.roles.fetch(currentTeam.role_id).catch(() => null);
                    if (role) {
                        for (const member of role.members.values()) {
                            memberIds.add(member.id);
                        }
                    }
                }
                const squadText = memberIds.size
                    ? [...memberIds].map(id => `<@${id}>`).join(' ')
                    : '*No squad linked.*';
                const heading = currentTeam.role_id ? `**${currentTeam.team_name}** <@&${currentTeam.role_id}>` : `**${currentTeam.team_name}**`;
                teamBlocks.push(`${heading}\nSquad: ${squadText}`);
            }
            let currentMessage = '';
            for (const block of teamBlocks) {
                const nextChunk = currentMessage ? `${currentMessage}\n\n${block}` : block;
                if (nextChunk.length > 1900) {
                    await message.channel.send(currentMessage);
                    currentMessage = block;
                }
                else {
                    currentMessage = nextChunk;
                }
            }
            if (currentMessage) {
                await message.channel.send(currentMessage);
            }
            return;
        }
        let team;
        const mention = message.mentions.users.first();
        let targetUser = mention || message.author;

        // Try to find target user if a name is provided
        if (!mention && args.length > 0) {
            const searchTerm = args.join(' ');
            // Check if it's a team name first
            const foundTeam = await db.get('SELECT * FROM teams WHERE guild_id = ? AND team_name LIKE ?', guildId, `%${searchTerm}%`);
            if (foundTeam) {
                team = foundTeam;
            } else {
                // Try searching for a user
                const player = await db.get('SELECT discord_id FROM auction_players WHERE guild_id = ? AND ign LIKE ?', guildId, `%${searchTerm}%`);
                if (player) {
                    try { targetUser = await message.client.users.fetch(player.discord_id); } catch (e) {}
                } else {
                    try {
                        const members = await message.guild.members.fetch({ query: searchTerm, limit: 1 });
                        const member = members.first();
                        if (member) targetUser = member.user;
                    } catch (e) {}
                }
            }
        }

        if (!team) {
            team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND owner_discord_id = ?', guildId, targetUser.id);
        }

        if (!team) {
            return message.reply(`No team found for **${targetUser.username}**. Usage: ?rwp [TeamName/@Owner/Username]`);
        }

        const players = await db.all('SELECT * FROM auction_players WHERE guild_id = ? AND sold_to_team_id = ?', guildId, team.team_id);
        if (players.length === 0) {
            message.channel.send(`**${team.team_name}** has no players yet.`);
        }
        else {
            let replyContent = `**${team.team_name} Roster:**\n`;
            replyContent += `Captain: <@${team.owner_discord_id}>\n`;
            const playerMentions = players.map(p => `<@${p.discord_id}>`).join('\n');
            replyContent += playerMentions;
            message.channel.send(replyContent);
        }
    }
    else if (command === 'summary') {
        const sales = await db.all('SELECT p.ign, t.team_name, p.sold_for_lakhs FROM auction_players p JOIN teams t ON p.sold_to_team_id = t.team_id WHERE p.guild_id = ? AND p.status = "SOLD" ORDER BY t.team_name', guildId);
        if (sales.length === 0)
            return message.reply("No sales recorded yet.");
        let report = "MATCH SUMMARY\n===========================\n\n";
        let currentTeam = "";
        sales.forEach(s => {
            if (s.team_name !== currentTeam) {
                report += `\n[ ${s.team_name} ]\n`;
                currentTeam = s.team_name;
            }
            report += `${s.ign.padEnd(20)} : ${(0, utils_1.lakhsToDisplay)(s.sold_for_lakhs)}\n`;
        });
        if (report.length > 1900) {
            const buffer = Buffer.from(report, 'utf-8');
            message.reply({ files: [{ attachment: buffer, name: 'auction_summary.txt' }] });
        }
        else {
            message.reply(`\
\
${report}\
\
`);
        }
    }
    else if (command === 'jointeam' || command === 'jt' || command === 'requestteam') {
        const rosterControls = await getCommunityRosterControls(guildId);
        if (!rosterControls.joinRequestsEnabled) {
            return message.reply("Join requests are currently disabled by admins.");
        }
        const targetRole = message.mentions.roles.first();
        const applicantId = message.author.id;
        const applicantMention = `<@${applicantId}>`;
        const mentionedUsers = [...message.mentions.users.values()].filter(user => user.id !== applicantId);
        const mentionedCaptain = mentionedUsers.length ? mentionedUsers[0] : null;
        let identifierText = args.join(' ').trim();
        if (targetRole) {
            identifierText = identifierText.replace(new RegExp(`<@&${targetRole.id}>`, 'g'), '').trim();
        }
        if (mentionedCaptain) {
            identifierText = identifierText.replace(new RegExp(`<@!?${mentionedCaptain.id}>`, 'g'), '').trim();
        }
        let team = null;
        if (targetRole) {
            team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND role_id = ?', guildId, targetRole.id);
        }
        if (!team && mentionedCaptain) {
            team = await db.get(`SELECT t.* FROM team_captains tc 
                JOIN teams t ON tc.team_id = t.team_id 
                WHERE tc.guild_id = ? AND tc.captain_discord_id = ?`, guildId, mentionedCaptain.id);
        }
        if (!team && identifierText) {
            const normalized = identifierText.toLowerCase();
            team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND LOWER(team_name) = ?', guildId, normalized);
            if (!team) {
                team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND team_name LIKE ?', guildId, `%${identifierText}%`);
            }
            if (!team) {
                const aliasRow = await db.get('SELECT full_name FROM pt_team_aliases WHERE guild_id = ? AND alias = ?', guildId, normalized.toUpperCase());
                if (aliasRow) {
                    team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND team_name = ?', guildId, aliasRow.full_name);
                }
            }
        }
        if (!team) {
            return message.reply("⚠️ Team not found. Usage: `?jointeam @TeamRole` or `?jointeam Team Name`.");
        }
        if (team.purse_lakhs >= 0) {
            return message.reply("⚠️ `?jointeam` is only available for non-auction/community teams. Auction roster changes must be handled by admins.");
        }
        const captainRow = await db.get('SELECT captain_discord_id FROM team_captains WHERE guild_id = ? AND team_id = ?', guildId, team.team_id);
        const captainId = captainRow?.captain_discord_id;
        if (!captainId) {
            return message.reply("⚠️ This team does not have a registered captain yet.");
        }
        if (captainId === applicantId) {
            return message.reply("You already manage this team.");
        }
        const applicantMember = await message.guild.members.fetch(applicantId).catch(() => null);
        if (!applicantMember) {
            return message.reply("⚠️ Could not find your Discord member record. Please rejoin the server.");
        }
        if (team.role_id && applicantMember.roles.cache.has(team.role_id)) {
            return message.reply("✅ You already have this team's role.");
        }
        const memberRoleIds = applicantMember.roles.cache.map(role => role.id).filter(Boolean);
        const conflictingMembership = await findExistingCommunityTeamMembership(guildId, applicantId, memberRoleIds, team.team_id);
        if (conflictingMembership) {
            return message.reply(`⚠️ You are already part of **${conflictingMembership.team.team_name}**. Please leave that team before joining another.`);
        }
        const pendingRequest = await db.get(`SELECT id, team_id FROM team_join_requests
            WHERE guild_id = ? AND requester_id = ? AND status = 'PENDING'
            ORDER BY created_at DESC LIMIT 1`, guildId, applicantId);
        if (pendingRequest) {
            if (pendingRequest.team_id === team.team_id) {
                return message.reply("⌛ You already have a pending request for this team. Please wait for the captain to respond.");
            }
            const otherTeam = await db.get('SELECT team_name FROM teams WHERE team_id = ?', pendingRequest.team_id);
            const otherName = otherTeam?.team_name || 'another team';
            return message.reply(`⚠️ You already have a pending request for **${otherName}**. Withdraw that request or wait for a decision before applying elsewhere.`);
        }
        const timestamp = Date.now();
        const insertResult = await db.run('INSERT INTO team_join_requests (guild_id, team_id, requester_id, status, note, created_at) VALUES (?, ?, ?, "PENDING", NULL, ?)', guildId, team.team_id, applicantId, timestamp);
        const requestId = insertResult?.lastID || Math.floor(timestamp / 1000);
        const captainUser = await message.client.users.fetch(captainId).catch(() => null);
        if (!captainUser) {
            await db.run('UPDATE team_join_requests SET status = "FAILED", responded_at = ? WHERE id = ?', Date.now(), requestId);
            return message.reply("⚠️ Unable to contact the team captain right now. Please try again later.");
        }
        const dmEmbed = buildJoinRequestCaptainDmEmbed(message.guild.name, team.team_name, applicantMention, timestamp);
        const dmButtons = buildJoinRequestCaptainDmButtons(requestId);
        try {
            await captainUser.send({ embeds: [dmEmbed], components: [dmButtons] });
        }
        catch (e) {
            await db.run('UPDATE team_join_requests SET status = "FAILED", responded_at = ? WHERE id = ?', Date.now(), requestId);
            return message.reply("⚠️ Unable to DM the team captain. They may have DMs disabled.");
        }
        await message.reply(`✅ Your request to join **${team.team_name}** has been sent and is awaiting the captain's decision.`);
    }
    else if (command === 'joinrequests' || command === 'jr') {
        const isAdm = (0, utils_1.isAdmin)(message.member);
        const captainRows = await db.all('SELECT team_id FROM team_captains WHERE guild_id = ? AND captain_discord_id = ?', guildId, message.author.id);
        const captainTeamIds = new Set(captainRows.map(row => row.team_id));
        if (!isAdm && captainTeamIds.size === 0)
            return message.reply("⚠️ You are not registered as a team captain.");
        const actionMap = {
            'approve': 'APPROVE',
            'accept': 'APPROVE',
            'a': 'APPROVE',
            'reject': 'DECLINE',
            'decline': 'DECLINE',
            'deny': 'DECLINE',
            'r': 'DECLINE'
        };
        const actionToken = (args[0] || '').toLowerCase();
        const targetTokens = args.slice(1);
        const loadPendingRequests = async () => {
            if (isAdm) {
                return await db.all(`SELECT r.*, t.team_name
                    FROM team_join_requests r
                    JOIN teams t ON r.team_id = t.team_id
                    WHERE r.guild_id = ? AND r.status = 'PENDING'
                    ORDER BY r.created_at ASC`, guildId);
            }
            if (captainTeamIds.size) {
                const placeholders = [...captainTeamIds].map(() => '?').join(',');
                return await db.all(`SELECT r.*, t.team_name
                    FROM team_join_requests r
                    JOIN teams t ON r.team_id = t.team_id
                    WHERE r.guild_id = ? AND r.status = 'PENDING' AND r.team_id IN (${placeholders})
                    ORDER BY r.created_at ASC`, guildId, ...captainTeamIds);
            }
            return [];
        };
        let pendingRequests = await loadPendingRequests();
        const actionType = actionMap[actionToken] || null;
        if (actionType) {
            if (!targetTokens.length)
                return message.reply("Specify `all` or one/more request IDs. Example: `?joinrequests approve all` or `?joinrequests reject 42`.");
            const targetText = targetTokens.join(' ').trim().toLowerCase();
            let selectedRequests = [];
            if (targetText === 'all') {
                if (pendingRequests.length === 0)
                    return message.reply("No pending join requests to process.");
                selectedRequests = pendingRequests;
            }
            else {
                const idSet = new Set(targetText.split(/[, ]+/).map(v => parseInt(v, 10)).filter(n => !isNaN(n)));
                if (!idSet.size)
                    return message.reply("Provide valid numeric request IDs, e.g. `?joinrequests approve 15 16`.");
                selectedRequests = pendingRequests.filter(req => idSet.has(req.id));
                if (!selectedRequests.length)
                    return message.reply("Those request IDs are not pending for your teams.");
            }
            const summaries = [];
            for (const req of selectedRequests) {
                if (!isAdm && !captainTeamIds.has(req.team_id)) {
                    summaries.push(`⚠️ Request #${req.id} skipped (not your team).`);
                    continue;
                }
                const result = await finalizeJoinRequestAction(message, req.id, actionType, message.author.id);
                summaries.push(result.message);
            }
            return message.reply(summaries.join('\n'));
        }
        if (pendingRequests.length === 0)
            return message.reply("No pending join requests.");
        const sessionId = `${message.id}_${Date.now()}`;
        const buildSummaryEmbed = async (requests) => {
            const preview = await Promise.all(requests.slice(0, 10).map(async req => {
                const requestedAt = await formatDate(guildId, req.created_at, true);
                return `• **#${req.id}** — **${req.team_name}**\n   Player: <@${req.requester_id}> | Requested: ${requestedAt}`;
            }));
            const extra = requests.length > 10 ? `\n…and ${requests.length - 10} more.` : '';
            const description = preview.length ? `${preview.join('\n\n')}${extra}` : 'All caught up!';
            return new discord_js_1.EmbedBuilder()
                .setTitle('Pending Join Requests')
                .setDescription(description)
                .setColor(0x1D9BF0)
                .setFooter({ text: 'Use the dropdowns below to approve or reject multiple requests at once.' });
        };
        const buildMenuRows = (requests) => {
            const options = requests.slice(0, 25).map(req => ({
                label: `#${req.id} • ${req.team_name}`.slice(0, 100),
                value: req.id.toString(),
                description: `Player ID: ${req.requester_id}`
            }));
            if (!options.length)
                return [];
            const maxValues = Math.min(options.length, 25);
            const approveMenu = new discord_js_1.StringSelectMenuBuilder()
                .setCustomId(`joinreq_approve_${sessionId}`)
                .setPlaceholder('Select players to approve')
                .setMinValues(1)
                .setMaxValues(maxValues)
                .addOptions(options);
            const rejectMenu = new discord_js_1.StringSelectMenuBuilder()
                .setCustomId(`joinreq_reject_${sessionId}`)
                .setPlaceholder('Select players to reject')
                .setMinValues(1)
                .setMaxValues(maxValues)
                .addOptions(options);
            return [
                new discord_js_1.ActionRowBuilder().addComponents(approveMenu),
                new discord_js_1.ActionRowBuilder().addComponents(rejectMenu)
            ];
        };
        let summaryEmbed = await buildSummaryEmbed(pendingRequests);
        let componentRows = buildMenuRows(pendingRequests);
        const dashboardMessage = await message.reply({ embeds: [summaryEmbed], components: componentRows });
        if (!componentRows.length)
            return;
        const filter = (interaction) => {
            if (!interaction.customId.startsWith('joinreq_'))
                return false;
            if (interaction.user.id !== message.author.id)
                return false;
            return true;
        };
        while (true) {
            if (!pendingRequests.length) {
                await dashboardMessage.edit({ embeds: [await buildSummaryEmbed(pendingRequests)], components: [] }).catch(() => { });
                break;
            }
            const interaction = await awaitComponent(dashboardMessage, { filter, time: 300000 }, "⌛ Join request dashboard closed due to inactivity.", "⚠️ Failed to process the join request dashboard.");
            if (!interaction)
                break;
            if (!interaction.isStringSelectMenu()) {
                await interaction.reply({ content: 'Unsupported interaction type.', flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => { });
                continue;
            }
            const selectionIds = interaction.values.map(value => parseInt(value, 10)).filter(id => !isNaN(id));
            if (!selectionIds.length) {
                await interaction.reply({ content: 'Please select at least one request.', flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => { });
                continue;
            }
            const selectedAction = interaction.customId.startsWith('joinreq_approve_') ? 'APPROVE' : 'DECLINE';
            const summaries = [];
            for (const reqId of selectionIds) {
                const target = pendingRequests.find(req => req.id === reqId);
                if (!target) {
                    summaries.push(`⚠️ Request #${reqId} is no longer pending.`);
                    continue;
                }
                if (!isAdm && !captainTeamIds.has(target.team_id)) {
                    summaries.push(`⚠️ Request #${reqId} skipped (not your team).`);
                    continue;
                }
                const result = await finalizeJoinRequestAction(message, reqId, selectedAction, interaction.user.id);
                summaries.push(result.message);
            }
            await interaction.reply({ content: summaries.join('\n'), flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => { });
            pendingRequests = await loadPendingRequests();
            summaryEmbed = await buildSummaryEmbed(pendingRequests);
            componentRows = buildMenuRows(pendingRequests);
            await dashboardMessage.edit({ embeds: [summaryEmbed], components: componentRows }).catch(() => { });
        }
        return;
    }
    else if (command === 'transfercaptain' || command === 'changecaptain' || command === 'setcaptain') {
        const isAdm = (0, utils_1.isAdmin)(message.member);
        if (isAdm && command === 'changecaptain') {
            const teams = await db.all('SELECT * FROM teams WHERE guild_id = ? AND purse_lakhs = -1 ORDER BY team_name ASC', guildId);
            if (!teams.length)
                return message.reply("No non-auction/community teams found.");
            const teamMenuId = `changecap_team_${message.id}`;
            const teamRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
                .setCustomId(teamMenuId)
                .setPlaceholder('Select team')
                .addOptions(teams.slice(0, 25).map(team => ({
                label: team.team_name.slice(0, 100),
                value: String(team.team_id),
                description: team.role_id ? 'Choose this team' : 'No team role configured'
            }))));
            const prompt = await message.reply({
                content: 'Select the team whose captain you want to change:',
                components: [teamRow]
            });
            const teamSelection = await awaitComponent(prompt, {
                filter: i => i.user.id === message.author.id && i.customId === teamMenuId,
                time: 60000
            }, "Error: Team selection timed out.", "Warning: Failed to pick a team.");
            if (!teamSelection)
                return;
            await teamSelection.deferUpdate();
            const selectedTeam = teams.find(team => String(team.team_id) === teamSelection.values[0]);
            if (!selectedTeam) {
                await teamSelection.editReply({ content: "Warning: Selected team was not found.", components: [] }).catch(() => { });
                return;
            }
            if (!selectedTeam.role_id) {
                await teamSelection.editReply({ content: `Warning: **${selectedTeam.team_name}** has no team role configured, so I can't build a captain dropdown.`, components: [] }).catch(() => { });
                return;
            }
            const teamRole = await message.guild.roles.fetch(selectedTeam.role_id).catch(() => null);
            if (!teamRole) {
                await teamSelection.editReply({ content: `Warning: The team role for **${selectedTeam.team_name}** no longer exists.`, components: [] }).catch(() => { });
                return;
            }
            await message.guild.members.fetch({ role: teamRole.id }).catch(() => null);
            const currentCaptainRow = await db.get('SELECT captain_discord_id FROM team_captains WHERE guild_id = ? AND team_id = ?', guildId, selectedTeam.team_id);
            const candidateMembers = [...teamRole.members.values()]
                .filter(member => !member.user.bot)
                .sort((a, b) => a.displayName.localeCompare(b.displayName))
                .slice(0, 25);
            if (!candidateMembers.length) {
                await teamSelection.editReply({ content: `Warning: No eligible team members were found in ${teamRole} to assign as captain.`, components: [] }).catch(() => { });
                return;
            }
            const userMenuId = `changecap_user_${message.id}`;
            const userRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
                .setCustomId(userMenuId)
                .setPlaceholder('Select new captain')
                .addOptions(candidateMembers.map(member => ({
                label: member.displayName.slice(0, 100),
                value: member.id,
                description: `${member.user.username}${currentCaptainRow?.captain_discord_id === member.id ? ' • current captain' : ''}`.slice(0, 100)
            }))));
            await teamSelection.editReply({
                content: `Selected **${selectedTeam.team_name}**. Now choose the new captain:`,
                components: [userRow]
            }).catch(() => { });
            const userSelection = await awaitComponent(prompt, {
                filter: i => i.user.id === message.author.id && i.customId === userMenuId,
                time: 60000
            }, "Error: Captain selection timed out.", "Warning: Failed to pick a captain.");
            if (!userSelection)
                return;
            await userSelection.deferUpdate();
            const selectedMember = await message.guild.members.fetch(userSelection.values[0]).catch(() => null);
            const transferResult = await transferTeamCaptain(message, selectedTeam, selectedMember);
            await userSelection.editReply({ content: transferResult.message, components: [] }).catch(() => { });
            return;
        }
        const mentionedMembers = [...message.mentions.members.values()];
        let newCaptainMember = mentionedMembers.length ? mentionedMembers[0] : null;
        let explicitId = null;
        if (!newCaptainMember) {
            const idToken = args.find(token => /^\d{15,21}$/.test(token));
            if (idToken) {
                explicitId = idToken;
                newCaptainMember = await message.guild.members.fetch(idToken).catch(() => null);
            }
        }
        if (!newCaptainMember)
            return message.reply("Usage: `?transfercaptain @NewCaptain [Optional: Team Name|@TeamRole]`.");
        if (newCaptainMember.user.bot)
            return message.reply("⚠️ Bots cannot be captains.");
        const cleanArgs = args.filter(token => {
            if (token.match(/^<@!?\d+>$/))
                return false;
            if (token.match(/^<@&\d+>$/))
                return false;
            if (explicitId && token === explicitId)
                return false;
            return true;
        });
        const roleMention = message.mentions.roles.first();
        let identifierText = cleanArgs.join(' ').trim();
        if (newCaptainMember && identifierText.includes(newCaptainMember.id)) {
            identifierText = identifierText.replace(new RegExp(newCaptainMember.id, 'g'), '').trim();
        }
        let requestedTeam = null;
        if (roleMention) {
            requestedTeam = await db.get('SELECT * FROM teams WHERE guild_id = ? AND role_id = ?', guildId, roleMention.id);
        }
        if (!requestedTeam && identifierText) {
            requestedTeam = await findTeamByIdentifier(guildId, identifierText);
        }
        const managedTeams = await getTransferManagedTeams(guildId, message.author.id);
        let team = null;
        if (isAdm) {
            team = requestedTeam || (managedTeams.length === 1 ? managedTeams[0] : null);
            if (!team) {
                if (managedTeams.length > 1) {
                    return message.reply("You manage multiple teams. Specify which team to update. Usage: `?transfercaptain @NewCaptain [Team Name|@TeamRole]`.");
                }
                return message.reply("Admins must specify which team to update unless they are the current captain/owner of exactly one team. Usage: `?transfercaptain @NewCaptain [Optional: Team Name|@TeamRole]`.");
            }
        }
        else {
            if (!managedTeams.length)
                return message.reply("Only admins or the current captain/owner can transfer captainship.");
            if (requestedTeam && !managedTeams.some(candidate => candidate.team_id === requestedTeam.team_id)) {
                return message.reply("You can only change the captain for your own team.");
            }
            if (requestedTeam) {
                team = requestedTeam;
            }
            else if (managedTeams.length === 1) {
                team = managedTeams[0];
            }
            else {
                return message.reply("You manage multiple teams. Specify which team to update. Usage: `?transfercaptain @NewCaptain [Team Name|@TeamRole]`.");
            }
        }
        const transferResult = await transferTeamCaptain(message, team, newCaptainMember);
        return message.reply(transferResult.message);
        if (!team)
            return message.reply("⚠️ Team not found. Mention the team role or include its name.");
        if (team.purse_lakhs >= 0)
            return message.reply("Captain transfers only apply to non-auction/community teams.");
        const currentCaptainRow = await db.get('SELECT captain_discord_id FROM team_captains WHERE guild_id = ? AND team_id = ?', guildId, team.team_id);
        if (currentCaptainRow?.captain_discord_id === newCaptainMember.id)
            return message.reply(`⚠️ ${newCaptainMember} is already the captain of **${team.team_name}**.`);
        const newCaptainRoles = newCaptainMember.roles.cache.map(role => role.id).filter(Boolean);
        const membershipBlock = await findExistingCommunityTeamMembership(guildId, newCaptainMember.id, newCaptainRoles, team.team_id);
        if (membershipBlock && membershipBlock.team.team_id !== team.team_id) {
            return message.reply(`⚠️ ${newCaptainMember} already belongs to **${membershipBlock.team.team_name}**. Ask them to leave that team first.`);
        }
        if (team.role_id) {
            const teamRole = await message.guild.roles.fetch(team.role_id).catch(() => null);
            if (teamRole && !newCaptainMember.roles.cache.has(teamRole.id)) {
                return message.reply(`⚠️ ${newCaptainMember} must have ${teamRole} before becoming captain.`);
            }
        }
        const conflictingCaptain = await db.get(`SELECT t.team_name FROM team_captains tc
            JOIN teams t ON tc.team_id = t.team_id
            WHERE tc.guild_id = ? AND tc.captain_discord_id = ? AND tc.team_id != ?`, guildId, newCaptainMember.id, team.team_id);
        if (conflictingCaptain) {
            return message.reply(`⚠️ ${newCaptainMember} is already captain of **${conflictingCaptain.team_name}**.`);
        }
        await db.run('INSERT INTO team_captains (guild_id, team_id, captain_discord_id) VALUES (?, ?, ?) ON CONFLICT(guild_id, team_id) DO UPDATE SET captain_discord_id = excluded.captain_discord_id', guildId, team.team_id, newCaptainMember.id);
        const lines = [`✅ Captainship for **${team.team_name}** has been transferred to ${newCaptainMember}.`];
        if (currentCaptainRow?.captain_discord_id && currentCaptainRow.captain_discord_id !== newCaptainMember.id) {
            lines.push(`🔔 Previous captain <@${currentCaptainRow.captain_discord_id}> has been notified.`);
        }
        await message.reply(lines.join('\n'));
        const dmText = `🎽 You are now the registered captain of **${team.team_name}** in **${message.guild.name}**.\nUse \`?joinrequests\` to review player requests and \`?stadiumname\` / \`?teamrename\` for stadium or name changes.`;
        newCaptainMember.send(dmText).catch(() => { });
        if (currentCaptainRow?.captain_discord_id && currentCaptainRow.captain_discord_id !== newCaptainMember.id) {
            const prevUser = await message.client.users.fetch(currentCaptainRow.captain_discord_id).catch(() => null);
            prevUser?.send(`ℹ️ You are no longer the captain of **${team.team_name}** in **${message.guild.name}**.`).catch(() => { });
        }
    }
    else if (command === 'setvicecaptain') {
        const mentionedMembers = [...message.mentions.members.values()];
        let viceCaptainMember = mentionedMembers.length ? mentionedMembers[0] : null;
        let explicitId = null;
        if (!viceCaptainMember) {
            const idToken = args.find(token => /^\d{15,21}$/.test(token));
            if (idToken) {
                explicitId = idToken;
                viceCaptainMember = await message.guild.members.fetch(idToken).catch(() => null);
            }
        }
        if (!viceCaptainMember)
            return message.reply("Usage: `?setvicecaptain @Member [Optional: Team Name|@TeamRole]`.");
        if (viceCaptainMember.user.bot)
            return message.reply("Bots cannot be vice-captains.");
        const resolvedTeam = await resolveManagedTeamForCaptainCommand(message, guildId, args, {
            explicitIds: explicitId ? [explicitId] : [],
            allowAdminTeamPrompt: true,
            adminMessage: "Admins must specify which team to update unless they already manage exactly one team. Usage: `?setvicecaptain @Member [Optional: Team Name|@TeamRole]`.",
            adminGroupPrompt: "Select the group first.",
            adminTeamPrompt: "Select the team whose vice-captain you want to set.",
            multiTeamMessage: "You manage multiple teams. Specify which team to update. Usage: `?setvicecaptain @Member [Team Name|@TeamRole]`.",
            nonManagerMessage: "Only admins or the current captain/owner can set a vice-captain.",
            unauthorizedMessage: "You can only set the vice-captain for your own team."
        });
        if (!resolvedTeam.ok)
            return resolvedTeam.silent ? undefined : message.reply(resolvedTeam.message);
        const team = resolvedTeam.team;
        const captainRow = await db.get('SELECT captain_discord_id FROM team_captains WHERE guild_id = ? AND team_id = ?', guildId, team.team_id);
        const captainId = captainRow?.captain_discord_id || (team.purse_lakhs >= 0 && isDiscordUserIdToken(team.owner_discord_id) ? team.owner_discord_id : null);
        if (captainId === viceCaptainMember.id)
            return message.reply(`${viceCaptainMember} is already the captain of **${team.team_name}**.`);
        const conflictingVice = await db.get(`SELECT t.team_name
            FROM team_vice_captains tvc
            JOIN teams t ON tvc.team_id = t.team_id
            WHERE tvc.guild_id = ? AND tvc.vice_captain_discord_id = ? AND tvc.team_id != ?`, guildId, viceCaptainMember.id, team.team_id);
        if (conflictingVice)
            return message.reply(`${viceCaptainMember} is already vice-captain of **${conflictingVice.team_name}**.`);
        if (team.role_id) {
            const teamRole = await message.guild.roles.fetch(team.role_id).catch(() => null);
            if (!teamRole)
                return message.reply(`The role for **${team.team_name}** no longer exists.`);
            if (!viceCaptainMember.roles.cache.has(teamRole.id))
                return message.reply(`${viceCaptainMember} must be on **${team.team_name}** before becoming vice-captain.`);
        }
        else if (team.purse_lakhs >= 0) {
            const ownedPlayer = await db.get('SELECT discord_id FROM auction_players WHERE guild_id = ? AND sold_to_team_id = ? AND discord_id = ?', guildId, team.team_id, viceCaptainMember.id);
            const isOwner = team.owner_discord_id === viceCaptainMember.id;
            if (!ownedPlayer && !isOwner)
                return message.reply(`${viceCaptainMember} is not linked to **${team.team_name}**.`);
        }
        else {
            return message.reply(`**${team.team_name}** does not have a team role configured yet, so I cannot verify vice-captain membership.`);
        }
        await db.run(`INSERT INTO team_vice_captains (guild_id, team_id, vice_captain_discord_id)
            VALUES (?, ?, ?)
            ON CONFLICT(guild_id, team_id) DO UPDATE SET vice_captain_discord_id = excluded.vice_captain_discord_id`, guildId, team.team_id, viceCaptainMember.id);
        return message.reply(`Done: ${viceCaptainMember} is now the vice-captain of **${team.team_name}**.`);
    }
    else if (command === 'removevicecaptain') {
        const resolvedTeam = await resolveManagedTeamForCaptainCommand(message, guildId, args, {
            allowAdminTeamPrompt: true,
            adminMessage: "Admins must specify which team to update unless they already manage exactly one team. Usage: `?removevicecaptain [Optional: Team Name|@TeamRole]`.",
            adminGroupPrompt: "Select the group first.",
            adminTeamPrompt: "Select the team whose vice-captain you want to remove.",
            multiTeamMessage: "You manage multiple teams. Specify which team to update. Usage: `?removevicecaptain [Team Name|@TeamRole]`.",
            nonManagerMessage: "Only admins or the current captain/owner can remove a vice-captain.",
            unauthorizedMessage: "You can only remove the vice-captain from your own team."
        });
        if (!resolvedTeam.ok)
            return resolvedTeam.silent ? undefined : message.reply(resolvedTeam.message);
        const team = resolvedTeam.team;
        const viceCaptainRow = await db.get('SELECT vice_captain_discord_id FROM team_vice_captains WHERE guild_id = ? AND team_id = ?', guildId, team.team_id);
        if (!viceCaptainRow?.vice_captain_discord_id)
            return message.reply(`No vice-captain is currently set for **${team.team_name}**.`);
        await db.run('DELETE FROM team_vice_captains WHERE guild_id = ? AND team_id = ?', guildId, team.team_id);
        return message.reply(`Done: Removed <@${viceCaptainRow.vice_captain_discord_id}> as vice-captain of **${team.team_name}**.`);
    }
    else if (command === 'leaveteam') {
        const member = message.member;
        if (!member)
            return message.reply("This command must be used inside the server.");
        let team = null;
        const identifier = args.join(' ').trim();
        if (identifier) {
            team = await findNonAuctionTeamByIdentifier(guildId, identifier);
        }
        if (!team) {
            const captainOwnedTeam = await db.get(`SELECT t.* FROM team_captains tc
                JOIN teams t ON tc.team_id = t.team_id
                WHERE tc.guild_id = ? AND tc.captain_discord_id = ? AND t.purse_lakhs = -1`, guildId, member.id);
            if (captainOwnedTeam) {
                return message.reply("Captains must ask an admin to transfer or reset the team before leaving.");
            }
        }
        if (!team) {
            const teams = await db.all('SELECT * FROM teams WHERE guild_id = ? AND purse_lakhs = -1 AND role_id IS NOT NULL', guildId);
            const matches = teams.filter(t => member.roles.cache.has(t.role_id));
            if (matches.length === 1) {
                team = matches[0];
            }
            else if (matches.length > 1) {
                return message.reply("You are on multiple non-auction teams. Use `?leaveteam Team Name` to specify which one.");
            }
            else {
                return message.reply("You are not on any registered non-auction team.");
            }
        }
        if (team.purse_lakhs >= 0)
            return message.reply("This command only works for non-auction/community teams.");
        if (!team.role_id)
            return message.reply("This team does not have a Discord role configured yet. Please contact an admin.");
        const captainRow = await db.get('SELECT captain_discord_id FROM team_captains WHERE guild_id = ? AND team_id = ?', guildId, team.team_id);
        if (captainRow?.captain_discord_id === member.id)
            return message.reply("Captains must ask an admin to transfer or reset the team before leaving.");
        const role = await message.guild.roles.fetch(team.role_id).catch(() => null);
        if (!role || !member.roles.cache.has(role.id))
            return message.reply("You do not currently have that team role.");
        await member.roles.remove(role).catch(() => null);
        await db.run('DELETE FROM team_vice_captains WHERE guild_id = ? AND team_id = ? AND vice_captain_discord_id = ?', guildId, team.team_id, member.id);
        await message.reply(`✅ You have left **${team.team_name}**.`);
        await sendCommunityRosterAuditLog(message.guild, member.id, member, team, 'LEAVE');
        if (captainRow?.captain_discord_id) {
            const captainUser = await message.client.users.fetch(captainRow.captain_discord_id).catch(() => null);
            if (captainUser) {
                captainUser.send(`ℹ️ ${member.user.tag} left **${team.team_name}** in **${message.guild.name}**.`).catch(() => { });
            }
        }
    }
    else if (command === 'stadiumname') {
        const requestedName = args.join(' ').trim();
        if (!requestedName)
            return message.reply("Usage: `?stadiumname <new-channel-name>`");
        const team = await matchSystem_1.matchSystem.getCaptainTeam(guildId, message.author.id, message.member);
        if (!team)
            return message.reply("Only current team captains/owners can rename stadiums.");
        const stadiumRenameSettings = await getTeamRenameSettings(guildId);
        if ((!stadiumRenameSettings.enabled || stadiumRenameSettings.limit === 0) && stadiumRenameSettings.expired && stadiumRenameSettings.expiresAt)
            return message.reply(`Stadium renames closed at **${await formatTeamRenameExpiry(guildId, stadiumRenameSettings.expiresAt)}**.`);
        const stadiumRow = await db.get('SELECT channel_id FROM team_stadiums WHERE guild_id = ? AND team_id = ?', guildId, team.team_id);
        if (!stadiumRow?.channel_id)
            return message.reply("No stadium channel is linked to your team yet. Please contact an admin.");
        const result = await attemptStadiumRename(message.guild, guildId, team.team_id, stadiumRow.channel_id, requestedName);
        if (!result.ok) {
            if (result.reason === 'limit')
                return message.reply("⚠️ You have already used all of your stadium rename slots.");
            if (result.reason === 'window_closed')
                return message.reply("⚠️ Stadium renames are currently disabled by admins.");
            if (result.reason === 'invalid_name')
                return message.reply("⚠️ That name is not valid for Discord channels. Use letters, numbers, spaces, or dashes.");
            return message.reply("⚠️ Unable to rename the stadium right now. Please try again later.");
        }
        const limitText = result.settings.limit ? `${result.used}/${result.settings.limit}` : `${result.used}`;
        await message.reply(`✅ Stadium channel renamed to **#${result.newName}** (${limitText} uses).`);
    }
    else if (command === 'teamrename') {
        const team = await matchSystem_1.matchSystem.getCaptainTeam(guildId, message.author.id, message.member);
        if (!team)
            return message.reply("Only current team captains/owners can rename their teams.");
        const renameSettings = await getTeamRenameSettings(guildId);
        if ((!renameSettings.enabled || renameSettings.limit === 0) && renameSettings.expired && renameSettings.expiresAt)
            return message.reply(`Team name edits closed at **${await formatTeamRenameExpiry(guildId, renameSettings.expiresAt)}**.`);
        if (!renameSettings.enabled || renameSettings.limit === 0)
            return message.reply("Team name edits are currently locked by admins.");
        const currentCount = team.name_change_count || 0;
        if (currentCount >= renameSettings.limit)
            return message.reply(`⚠️ You have already used all **${renameSettings.limit}** of your rename slots.`);
        const rawInput = args.join(' ').trim();
        if (!rawInput)
            return message.reply("Usage: `?teamrename <New Team Name> | <ALIAS>`");
        let aliasPart = null;
        let namePart = rawInput;
        if (rawInput.includes('|')) {
            const split = rawInput.split('|');
            namePart = split.shift()?.trim() || '';
            aliasPart = split.join('|').trim();
        }
        else if (args.length >= 2) {
            aliasPart = args[args.length - 1];
            namePart = args.slice(0, -1).join(' ');
        }
        if (!namePart || !aliasPart)
            return message.reply("Please provide both the new team name and abbreviation. Format: `?teamrename New Name | ABBV`.");
        const newName = namePart.replace(/\s+/g, ' ').trim();
        if (!newName)
            return message.reply("Team name cannot be blank.");
        const alias = normalizeAlias(aliasPart, newName);
        const existingNameRow = await db.get('SELECT team_id FROM teams WHERE guild_id = ? AND LOWER(team_name) = ? AND team_id != ?', guildId, newName.toLowerCase(), team.team_id);
        if (existingNameRow)
            return message.reply("Another team already uses that name. Choose something unique.");
        const aliasRow = await db.get('SELECT full_name FROM pt_team_aliases WHERE guild_id = ? AND alias = ?', guildId, alias);
        if (aliasRow && aliasRow.full_name !== team.team_name)
            return message.reply(`Abbreviation **${alias}** is already tied to **${aliasRow.full_name}**.`);
        await db.run('DELETE FROM pt_team_aliases WHERE guild_id = ? AND full_name = ?', guildId, team.team_name);
        await db.run('UPDATE teams SET team_name = ?, name_change_count = COALESCE(name_change_count, 0) + 1 WHERE guild_id = ? AND team_id = ?', newName, guildId, team.team_id);
        await db.run('INSERT INTO pt_team_aliases (guild_id, full_name, alias) VALUES (?, ?, ?) ON CONFLICT(guild_id, alias) DO UPDATE SET full_name = excluded.full_name', guildId, newName, alias);
        if (team.role_id) {
            const role = await message.guild.roles.fetch(team.role_id).catch(() => null);
            if (role)
                await role.edit({ name: newName }).catch(() => { });
        }
        const used = currentCount + 1;
        await message.reply(`✅ Team renamed to **${newName}** with abbreviation **${alias}** (${used}/${renameSettings.limit} uses).`);
    }
    else if (command === 'teamkick') {
        const team = await matchSystem_1.matchSystem.getCaptainTeam(guildId, message.author.id, message.member);
        if (!team || team.purse_lakhs >= 0)
            return message.reply("Only non-auction team captains can manage their roster.");
        const rosterControls = await getCommunityRosterControls(guildId);
        if (!rosterControls.enabled)
            return message.reply("Captain add/kick commands are currently disabled by admins.");
        if (!team.role_id)
            return message.reply("This team does not have a role configured yet.");
        const targetMember = message.mentions.members.first() || (args[0] ? await message.guild.members.fetch(args[0]).catch(() => null) : null);
        if (!targetMember)
            return message.reply("Usage: `?teamkick @Member [reason]`");
        if (targetMember.id === message.author.id)
            return message.reply("You cannot remove yourself.");
        const captainRow = await db.get('SELECT captain_discord_id FROM team_captains WHERE guild_id = ? AND team_id = ?', guildId, team.team_id);
        if (captainRow?.captain_discord_id === targetMember.id)
            return message.reply("You cannot remove the registered captain.");
        if (!targetMember.roles.cache.has(team.role_id))
            return message.reply("That member is not on your roster.");
        if ((0, utils_1.isAdmin)(targetMember) && !(0, utils_1.isAdmin)(message.member))
            return message.reply("You cannot remove an admin.");
        const reasonTokens = [...args];
        if (reasonTokens.length && reasonTokens[0].includes(targetMember.id))
            reasonTokens.shift();
        const reason = reasonTokens.join(' ').trim();
        const removed = await targetMember.roles.remove(team.role_id).then(() => true).catch(() => false);
        if (!removed)
            return message.reply("I couldn't remove that player from the team role. Check my role permissions.");
        await db.run('DELETE FROM team_vice_captains WHERE guild_id = ? AND team_id = ? AND vice_captain_discord_id = ?', guildId, team.team_id, targetMember.id);
        await message.reply(`✅ Removed ${targetMember.user.tag} from **${team.team_name}**.`);
        targetMember.send(`You have been removed from **${team.team_name}** in **${message.guild.name}**.${reason ? ` Reason: ${reason}` : ''}`).catch(() => { });
        await sendCommunityRosterAuditLog(message.guild, message.author.id, targetMember, team, 'KICK', reason);
    }
    else if (command === 'teamadd') {
        const team = await matchSystem_1.matchSystem.getCaptainTeam(guildId, message.author.id, message.member);
        if (!team || team.purse_lakhs >= 0)
            return message.reply("Only non-auction team captains can manage their roster.");
        const rosterControls = await getCommunityRosterControls(guildId);
        if (!rosterControls.enabled)
            return message.reply("Captain add/kick commands are currently disabled by admins.");
        if (!team.role_id)
            return message.reply("This team does not have a role configured yet.");
        const targetUser = await resolveTargetUser(message, args);
        if (!targetUser)
            return message.reply("Usage: `?teamadd @Member`");
        const targetMember = await message.guild.members.fetch(targetUser.id).catch(() => null);
        if (!targetMember)
            return message.reply("That member is not in this server.");
        if (targetMember.user.bot)
            return message.reply("Bots cannot be added to team rosters.");
        if (targetMember.roles.cache.has(team.role_id))
            return message.reply("That member is already on your roster.");
        const roleIds = [...targetMember.roles.cache.keys()];
        const existingMembership = await findExistingCommunityTeamMembership(guildId, targetMember.id, roleIds, team.team_id);
        if (existingMembership)
            return message.reply(`<@${targetMember.id}> is already linked to **${existingMembership.team.team_name}**.`);
        const added = await targetMember.roles.add(team.role_id).then(() => true).catch(() => false);
        if (!added)
            return message.reply("I couldn't add that player to the team role. Check my role permissions.");
        await db.run(`UPDATE team_join_requests
            SET status = "APPROVED", responder_id = ?, responded_at = ?
            WHERE guild_id = ? AND team_id = ? AND requester_id = ? AND status = "PENDING"`, message.author.id, Date.now(), guildId, team.team_id, targetMember.id);
        await message.reply(`Done: Added ${targetMember.user.tag} to **${team.team_name}**.`);
        targetMember.send(`You have been added to **${team.team_name}** in **${message.guild.name}**.`).catch(() => { });
        await sendCommunityRosterAuditLog(message.guild, message.author.id, targetMember, team, 'ADD');
    }
    else if (command === 'myteamdetail' || command === 'teamdetail' || command === 'mtd') {
        const { aliasByName, nameByAlias } = await getTeamAliasMaps(guildId);
        const roleMention = message.mentions.roles.first();
        const mentionlessArgs = args.filter(token => !token.match(/^<@!?(\d+)>$/) && !token.match(/^<@&\d+>$/));
        const searchText = mentionlessArgs.join(' ').trim();
        let team = await resolveTeamFromSearch(guildId, searchText, roleMention, nameByAlias);
        if (team) {
            return await sendPagedTeamProfile(message, guildId, team, aliasByName, { thumbnailMode: 'viewer' });
        }
        if (!team) {
            const selfTeamResult = await resolveOwnTeamForMember(message, guildId);
            team = selfTeamResult.team;
            if (team) {
                return await sendPagedTeamProfile(message, guildId, team, aliasByName, { thumbnailMode: 'viewer' });
            }
            if (!team && selfTeamResult.ambiguousTeams.length > 1) {
                return message.reply(`Warning: You are linked to multiple teams: ${selfTeamResult.ambiguousTeams.map(row => `**${row.team_name}**`).join(', ')}. Specify one: \`?myteamdetail Team Name\`.`);
            }
        }
        if (!team) {
            return message.reply("⚠️ Could not determine a team. Mention the team role or include its name/abbreviation: `?myteamdetail Night Owls`.");
        }
        const aliasValue = aliasByName.get(team.team_name.toLowerCase()) || '—';
        const captainRow = await db.get('SELECT captain_discord_id FROM team_captains WHERE guild_id = ? AND team_id = ?', guildId, team.team_id);
        const stadiumRow = await db.get('SELECT channel_id FROM team_stadiums WHERE guild_id = ? AND team_id = ?', guildId, team.team_id);
        const rosterMap = new Map();
        const addRosterEntry = (id, label) => {
            if (!id)
                return;
            const normalized = id.toString();
            if (!rosterMap.has(normalized)) {
                rosterMap.set(normalized, { id: normalized, tags: new Set(), label: label || `<@${normalized}>` });
            }
            else if (label) {
                rosterMap.get(normalized).label = label;
            }
            return rosterMap.get(normalized);
        };
        let role = null;
        if (team.role_id) {
            role = await message.guild.roles.fetch(team.role_id).catch(() => null);
            if (role) {
                await message.guild.members.fetch().catch(() => null);
                role.members.forEach(member => {
                    const entry = addRosterEntry(member.id, `<@${member.id}>`);
                    entry?.tags.add('Role');
                });
            }
        }
        const approvedRequests = await db.all('SELECT requester_id FROM team_join_requests WHERE guild_id = ? AND team_id = ? AND status = "APPROVED"', guildId, team.team_id);
        for (const row of approvedRequests) {
            const entry = addRosterEntry(row.requester_id, `<@${row.requester_id}>`);
            entry?.tags.add('Member');
        }
        if (team.purse_lakhs >= 0) {
            const playerRows = await db.all('SELECT discord_id, ign FROM auction_players WHERE guild_id = ? AND sold_to_team_id = ?', guildId, team.team_id);
            for (const row of playerRows) {
                if (!row?.discord_id)
                    continue;
                const display = row.ign ? `<@${row.discord_id}> (${row.ign})` : `<@${row.discord_id}>`;
                const entry = addRosterEntry(row.discord_id, display);
                if (entry)
                    entry.tags.add('Player');
            }
        }
        if (captainRow?.captain_discord_id) {
            const entry = addRosterEntry(captainRow.captain_discord_id, `<@${captainRow.captain_discord_id}>`);
            entry?.tags.add('Captain');
        }
        const sortedRoster = [...rosterMap.values()].sort((a, b) => {
            const aRank = a.tags.has('Captain') ? 0 : 1;
            const bRank = b.tags.has('Captain') ? 0 : 1;
            if (aRank !== bRank)
                return aRank - bRank;
            return (a.label || '').localeCompare(b.label || '');
        });
        const rosterEntries = sortedRoster.map((entry, index) => {
            const position = index + 1;
            const suffix = entry.tags.has('Captain') ? ' 🧢' : '';
            return `${position}. ${entry.label}${suffix}`;
        });
        const rosterCount = rosterEntries.length;
        const captainText = captainRow?.captain_discord_id ? `<@${captainRow.captain_discord_id}>` : 'Not set';
        const stadiumText = stadiumRow?.channel_id ? `<#${stadiumRow.channel_id}>` : 'Not set';
        const roleText = team.role_id ? `<@&${team.role_id}>` : 'Not assigned';
        const rosterFieldValue = (() => {
            if (!rosterEntries.length)
                return 'No members yet.';
            const maxLines = 25;
            const lines = rosterEntries.slice(0, maxLines);
            if (rosterEntries.length > maxLines) {
                lines.push(`… +${rosterEntries.length - maxLines} more`);
            }
            return lines.join('\n').slice(0, 1024);
        })();
        const rosterCapacityText = team.max_roster_size ? `${rosterCount}/${team.max_roster_size}` : `${rosterCount}`;
        const rosterFieldLabel = team.max_roster_size ? `Roster Members (${rosterCapacityText})` : 'Roster Members';
        const embed = new discord_js_1.EmbedBuilder()
            .setTitle(`🏏 ${team.team_name} — Team Details`)
            .setColor(0x0099FF)
            .addFields({ name: 'Alias', value: `\`${aliasValue}\``, inline: true }, { name: 'Captain', value: captainText, inline: true }, { name: 'Team Role', value: roleText, inline: true }, { name: 'Stadium', value: stadiumText, inline: true }, { name: rosterFieldLabel, value: rosterFieldValue });
        await message.reply({ embeds: [embed] });
    }
    else if (command === 'opponentteamdetail') {
        const { aliasByName } = await getTeamAliasMaps(guildId);
        const ownTeamResult = await resolveOwnTeamForMember(message, guildId);
        if (!ownTeamResult.team) {
            if (ownTeamResult.ambiguousTeams.length > 1) {
                return message.reply(`Warning: You are linked to multiple teams: ${ownTeamResult.ambiguousTeams.map(row => `**${row.team_name}**`).join(', ')}. Use \`?myteamdetail Team Name\` first or ask an admin to clean up your roles.`);
            }
            return message.reply("Warning: I couldn't determine your team from ownership, captainship, or your team role.");
        }
        const ownTeam = ownTeamResult.team;
        const ptConfig = await getPtConfig(guildId);
        const seasonLabel = await statsSystem.getActiveSeason(guildId) || `S${ptConfig.current_season || 1}`;
        if ((ptConfig.format_type || 'LEAGUE') === 'GROUPS') {
            const allowedGroups = getAlphabetRange(ptConfig.group_limit || 'A');
            const groupMenuId = `opp_group_${message.id}`;
            const groupRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
                .setCustomId(groupMenuId)
                .setPlaceholder('Select group')
                .addOptions(allowedGroups.map(letter => ({
                label: `Group ${letter}`,
                value: letter
            }))));
            const prompt = await message.reply({
                content: 'Select the opponent group:',
                components: [groupRow]
            });
            const groupSelection = await awaitComponent(prompt, {
                filter: i => i.user.id === message.author.id && i.customId === groupMenuId,
                time: 60000
            }, "Error: Group selection timed out.", "Warning: Failed to pick a group.");
            if (!groupSelection)
                return;
            await groupSelection.deferUpdate();
            const selectedGroup = groupSelection.values[0];
            const candidateTeams = await db.all(`SELECT t.* FROM teams t
                JOIN team_groups tg ON t.team_id = tg.team_id
                WHERE t.guild_id = ? AND tg.season_name = ? AND tg.group_letter = ? AND t.team_id != ?
                ORDER BY t.team_name ASC`, guildId, seasonLabel, selectedGroup, ownTeam.team_id);
            if (!candidateTeams.length) {
                await groupSelection.editReply({ content: `Warning: No opponent teams found in Group ${selectedGroup}.`, components: [] }).catch(() => { });
                return;
            }
            const teamMenuId = `opp_team_${message.id}`;
            const teamRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
                .setCustomId(teamMenuId)
                .setPlaceholder('Select opponent team')
                .addOptions(candidateTeams.slice(0, 25).map(team => ({
                label: team.team_name.slice(0, 100),
                value: String(team.team_id),
                description: (aliasByName.get(team.team_name.toLowerCase()) || 'No abbreviation').slice(0, 100)
            }))));
            await groupSelection.editReply({
                content: `Group **${selectedGroup}** selected. Now choose the opponent team:`,
                components: [teamRow]
            }).catch(() => { });
            const teamSelection = await awaitComponent(prompt, {
                filter: i => i.user.id === message.author.id && i.customId === teamMenuId,
                time: 60000
            }, "Error: Team selection timed out.", "Warning: Failed to pick an opponent team.");
            if (!teamSelection)
                return;
            await teamSelection.deferUpdate();
            const opponentTeam = candidateTeams.find(team => String(team.team_id) === teamSelection.values[0]);
            if (!opponentTeam) {
                await teamSelection.editReply({ content: 'Warning: Selected opponent team was not found.', components: [] }).catch(() => { });
                return;
            }
            return await sendPagedTeamProfile(message, guildId, opponentTeam, aliasByName, {
                thumbnailMode: 'captain',
                interaction: teamSelection
            });
        }
        const candidateTeams = await db.all('SELECT * FROM teams WHERE guild_id = ? AND team_id != ? ORDER BY team_name ASC', guildId, ownTeam.team_id);
        if (!candidateTeams.length) {
            return message.reply("Warning: No opponent teams found.");
        }
        const teamMenuId = `opp_team_${message.id}`;
        const teamRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
            .setCustomId(teamMenuId)
            .setPlaceholder('Select opponent team')
            .addOptions(candidateTeams.slice(0, 25).map(team => ({
            label: team.team_name.slice(0, 100),
            value: String(team.team_id),
            description: (aliasByName.get(team.team_name.toLowerCase()) || 'No abbreviation').slice(0, 100)
        }))));
        const prompt = await message.reply({
            content: 'Select the opponent team:',
            components: [teamRow]
        });
        const teamSelection = await awaitComponent(prompt, {
            filter: i => i.user.id === message.author.id && i.customId === teamMenuId,
            time: 60000
        }, "Error: Team selection timed out.", "Warning: Failed to pick an opponent team.");
        if (!teamSelection)
            return;
        await teamSelection.deferUpdate();
        const opponentTeam = candidateTeams.find(team => String(team.team_id) === teamSelection.values[0]);
        if (!opponentTeam) {
            await teamSelection.editReply({ content: 'Warning: Selected opponent team was not found.', components: [] }).catch(() => { });
            return;
        }
        return await sendPagedTeamProfile(message, guildId, opponentTeam, aliasByName, {
            thumbnailMode: 'captain',
            interaction: teamSelection
        });
    }
    else if (command === 'teammsg' || command === 'tm') {
        if (!(0, utils_1.isAdmin)(message.member)) {
            return message.reply("Only Admins can use this command.");
        }
        let team;
        let messageText = '';
        const targetUser = await resolveTargetUser(message, args);
        if (targetUser) {
            team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND owner_discord_id = ?', guildId, targetUser.id);
            if (team) {
                const identifierIndex = args.findIndex(arg => arg.includes(targetUser.id) || arg.toLowerCase() === targetUser.username.toLowerCase());
                messageText = args.slice(identifierIndex + 1).join(' ');
            }
        }
        else {
            for (let i = args.length; i > 0; i--) {
                const potentialName = args.slice(0, i).join(' ');
                const foundTeam = await db.get('SELECT * FROM teams WHERE guild_id = ? AND team_name = ?', guildId, potentialName);
                if (foundTeam) {
                    team = foundTeam;
                    messageText = args.slice(i).join(' ');
                    break;
                }
            }
        }
        if (!team)
            return message.reply("Team not found. Usage: ?teammsg [@Owner/TeamName/Username] [Message]");
        if (!messageText.trim())
            return message.reply("Please provide a message to send.");
        if (role && (role.mentionable || role.permissions?.bitfield !== 0n)) {
            role = await role.edit({
                permissions: [],
                mentionable: false,
                reason: 'Team roles are display-only'
            }).catch(() => role);
        }
        const players = await db.all('SELECT * FROM auction_players WHERE guild_id = ? AND sold_to_team_id = ?', guildId, team.team_id);
        let successCount = 0;
        let failCount = 0;
        const recipients = new Set();
        recipients.add(team.owner_discord_id);
        players.forEach(p => recipients.add(p.discord_id));
        const dmMessage = `📢 **Message from ${message.author.username} to ${team.team_name}:**\n\n${messageText.trim()}`;
        await message.reply(`📨 Sending DM to **${recipients.size}** members of **${team.team_name}**...`);
        for (const userId of recipients) {
            try {
                const user = await message.client.users.fetch(userId);
                await user.send(dmMessage);
                successCount++;
            }
            catch (e) {
                failCount++;
                console.error(`Failed to DM user ${userId}:`, e);
            }
        }
        await message.channel.send(`✅ Sent DMs to **${successCount}** members. Failed: **${failCount}**.`);
    }
    else if (command === 'stats') {
        const mention = message.mentions.users.first();
        let targetUser = mention || message.author;
        if (!mention && args.length > 0) {
            const searchTerm = args.find(a => !a.startsWith('<@') && !a.startsWith('S') && !a.match(/^\d+$/));
            if (searchTerm) {
                const player = await db.get('SELECT discord_id FROM auction_players WHERE guild_id = ? AND ign LIKE ?', guildId, `%${searchTerm}%`);
                if (player) {
                    try {
                        targetUser = await message.client.users.fetch(player.discord_id);
                    }
                    catch (e) { }
                }
                else {
                    try {
                        const members = await message.guild.members.fetch({ query: searchTerm, limit: 1 });
                        const member = members.first();
                        if (member)
                            targetUser = member.user;
                    }
                    catch (e) { }
                }
            }
        }
        let seasonName = await statsSystem.getActiveSeason(guildId);
        const seasonArg = args.find(a => !a.startsWith('<@') && (a.startsWith('S') || a.match(/^\d+$/)));
        if (seasonArg) {
            const sExists = await db.get('SELECT season_name FROM stats_seasons WHERE guild_id = ? AND (season_name = ? OR season_name = ? OR season_name = ?)', guildId, seasonArg, `S${seasonArg}`, `Season${seasonArg}`);
            if (sExists)
                seasonName = sExists.season_name;
        }
        if (!seasonName)
            return message.reply("No active season found.");
        const stats = await db.get('SELECT * FROM stats_players WHERE guild_id = ? AND season_name = ? AND user_id = ?', guildId, seasonName, targetUser.id);
        if (!stats)
            return message.channel.send(`No stats found for **${targetUser.username}** in season **${seasonName}**.`);
        const result = await statsSystem.createProfileEmbed(guildId, seasonName, targetUser, stats);
        message.channel.send({ embeds: result.embeds, files: result.files });
    }
    else if (command === 'seasons') {
        const seasons = await db.all('SELECT * FROM stats_seasons WHERE guild_id = ? ORDER BY season_name ASC', guildId);
        if (seasons.length === 0) return message.reply("No seasons have been recorded yet.");

        const list = seasons.map(s => {
            const status = s.is_active ? "🟢" : "⚪";
            const activeText = s.is_active ? " **(Active)**" : "";
            return `${status} ${s.season_name}${activeText}`;
        }).join('\n');

        const embed = new discord_js_1.EmbedBuilder()
            .setTitle('🏟️ Played Seasons')
            .setDescription(`List of all seasons recorded in this server:\n\n${list}\n\n*Use \`?stats @User SeasonName\` or \`?lb SeasonName\` to view data for a specific season.*`)
            .setColor(0x00FF00);
        message.reply({ embeds: [embed] });
    }
    else if (command === 'overallstats') {
        const mention = message.mentions.users.first();
        let targetUser = mention || message.author;

        if (!mention && args.length > 0) {
            const searchTerm = args.find(a => !a.startsWith('<@'));
            if (searchTerm) {
                const player = await db.get('SELECT discord_id FROM auction_players WHERE guild_id = ? AND ign LIKE ?', guildId, `%${searchTerm}%`);
                if (player) {
                    try { targetUser = await message.client.users.fetch(player.discord_id); } catch (e) {}
                } else {
                    try {
                        const members = await message.guild.members.fetch({ query: searchTerm, limit: 1 });
                        const member = members.first();
                        if (member) targetUser = member.user;
                    } catch (e) {}
                }
            }
        }

        const overall = await db.get(`
            SELECT 
                COALESCE(SUM(runs), 0) as runs, COALESCE(SUM(balls_played), 0) as balls_played,
                COALESCE(SUM(runs_conceded), 0) as runs_conceded, COALESCE(SUM(balls_bowled), 0) as balls_bowled,
                COALESCE(SUM(wickets), 0) as wickets, COALESCE(SUM(not_out_count), 0) as not_out_count,
                COALESCE(SUM(innings_bat), 0) as innings_bat, COALESCE(SUM(innings_bowl), 0) as innings_bowl,
                COALESCE(SUM(matches_played), 0) as matches_played, COALESCE(SUM(thirties), 0) as thirties,
                COALESCE(SUM(fifties), 0) as fifties, COALESCE(SUM(hundreds), 0) as hundreds,
                COALESCE(SUM(ducks), 0) as ducks, COALESCE(MAX(highscore), 0) as highscore,
                COALESCE(SUM(total_mvp), 0) as total_mvp, COALESCE(SUM(three_fer), 0) as three_fer,
                COALESCE(SUM(five_fer), 0) as five_fer, COALESCE(SUM(runs_1_5), 0) as runs_1_5,
                COALESCE(SUM(runs_6_9), 0) as runs_6_9, COALESCE(SUM(low_sr_60), 0) as low_sr_60,
                COALESCE(SUM(low_sr_80), 0) as low_sr_80, COALESCE(SUM(zero_wkts_2overs), 0) as zero_wkts_2overs,
                COALESCE(SUM(high_eco_18), 0) as high_eco_18, COALESCE(SUM(high_eco_16), 0) as high_eco_16
            FROM stats_players 
            WHERE guild_id = ? AND user_id = ?
        `, guildId, targetUser.id);

        if (!overall || !overall.matches_played) {
            return message.channel.send(`No stats found for **${targetUser.username}**.`);
        }

        // We need best bowling across all seasons
        const bestBowling = await db.get(`
            SELECT best_bowling_wkts, best_bowling_runs 
            FROM stats_players 
            WHERE guild_id = ? AND user_id = ? 
            ORDER BY best_bowling_wkts DESC, best_bowling_runs ASC 
            LIMIT 1
        `, guildId, targetUser.id);

        const bestBatting = await db.get(`
            SELECT highscore, highscore_not_out
            FROM stats_players
            WHERE guild_id = ? AND user_id = ?
            ORDER BY highscore DESC, highscore_not_out DESC
            LIMIT 1
        `, guildId, targetUser.id);

        overall.highscore = bestBatting?.highscore || overall.highscore || 0;
        overall.highscore_not_out = bestBatting?.highscore_not_out || 0;
        overall.best_bowling_wkts = bestBowling?.best_bowling_wkts || 0;
        overall.best_bowling_runs = bestBowling?.best_bowling_runs || 0;

        const result = await statsSystem.createProfileEmbed(guildId, "All-Time", targetUser, overall);
        message.channel.send({ embeds: result.embeds, files: result.files });
    }
    else if (command === 'lb' || command === 'statlb') {
        let seasonName = await statsSystem.getActiveSeason(guildId);
        const seasonArg = args.find(a => !a.startsWith('<@'));
        if (seasonArg) {
            const sExists = await db.get('SELECT season_name FROM stats_seasons WHERE guild_id = ? AND (season_name = ? OR season_name = ? OR season_name = ?)', guildId, seasonArg, `S${seasonArg}`, `Season${seasonArg}`);
            if (sExists) seasonName = sExists.season_name;
        }

        if (!seasonName) return message.reply("No active season found.");

        const allStats = await db.all('SELECT * FROM stats_players WHERE guild_id = ? AND season_name = ?', guildId, seasonName);
        if (allStats.length === 0) return message.reply(`No stats found for season **${seasonName}**.`);

        // Categories definitions
        const categories = [
            // General
            { label: 'MVP Score', value: 'mvp', type: 'general', sort: (a, b) => b.total_mvp - a.total_mvp, format: p => p.total_mvp.toFixed(2) },
            { label: 'Matches Played', value: 'matches', type: 'general', sort: (a, b) => b.matches_played - a.matches_played, format: p => `${p.matches_played}` },

            // Batting
            { label: 'Runs', value: 'runs', type: 'batting', sort: (a, b) => b.runs - a.runs, format: p => `${p.runs}` },
            { label: 'Batting Average', value: 'avg', type: 'batting', sort: (a, b) => statsSystem.calculateBattingAverage(b) - statsSystem.calculateBattingAverage(a), filter: p => p.innings_bat >= 2, format: p => statsSystem.calculateBattingAverage(p).toFixed(2) },
            { label: 'Strike Rate', value: 'sr', type: 'batting', sort: (a, b) => ((b.runs / Math.max(1, b.balls_played)) * 100) - ((a.runs / Math.max(1, a.balls_played)) * 100), filter: p => p.balls_played >= 15, format: p => ((p.runs / Math.max(1, p.balls_played)) * 100).toFixed(2) },
            { label: 'Fifties', value: 'fifties', type: 'batting', sort: (a, b) => b.fifties - a.fifties, format: p => `${p.fifties}` },
            { label: 'Hundreds', value: 'hundreds', type: 'batting', sort: (a, b) => b.hundreds - a.hundreds, format: p => `${p.hundreds}` },
            { label: 'Ducks', value: 'ducks', type: 'batting', sort: (a, b) => b.ducks - a.ducks, format: p => `${p.ducks}` },
            { label: 'High Score', value: 'hs', type: 'batting', sort: (a, b) => b.highscore - a.highscore, format: p => `${p.highscore}${p.highscore_not_out === 1 ? '*' : ''}` },

            // Bowling
            { label: 'Wickets', value: 'wickets', type: 'bowling', sort: (a, b) => b.wickets - a.wickets, format: p => `${p.wickets}` },
            { label: 'Bowling Average', value: 'bavg', type: 'bowling', sort: (a, b) => (a.runs_conceded / Math.max(1, a.wickets)) - (b.runs_conceded / Math.max(1, b.wickets)), filter: p => p.wickets >= 2, format: p => (p.runs_conceded / Math.max(1, p.wickets)).toFixed(2) },
            { label: 'Economy', value: 'eco', type: 'bowling', sort: (a, b) => ((a.runs_conceded / Math.max(1, a.balls_bowled)) * 6) - ((b.runs_conceded / Math.max(1, b.balls_bowled)) * 6), filter: p => p.balls_bowled >= 12, format: p => ((p.runs_conceded / Math.max(1, p.balls_bowled)) * 6).toFixed(2) },
            { label: 'Runs Conceded', value: 'conceded', type: 'bowling', sort: (a, b) => b.runs_conceded - a.runs_conceded, format: p => `${p.runs_conceded}` },
            { label: 'Three-Wicket Hauls', value: '3w', type: 'bowling', sort: (a, b) => b.three_fer - a.three_fer, format: p => `${p.three_fer}` },
            { label: 'Five-Wicket Hauls', value: '5w', type: 'bowling', sort: (a, b) => b.five_fer - a.five_fer, format: p => `${p.five_fer}` },
            { label: 'Best Bowling Figures', value: 'bbi', type: 'bowling', sort: (a, b) => b.best_bowling_wkts - a.best_bowling_wkts || a.best_bowling_runs - b.best_bowling_runs, format: p => `${p.best_bowling_wkts}/${p.best_bowling_runs}` }
        ];
        const getComponents = (currentType, currentCat) => {
            const typeOptions = [
                { label: 'General', value: 'general', default: currentType === 'general' },
                { label: 'Batting', value: 'batting', default: currentType === 'batting' },
                { label: 'Bowling', value: 'bowling', default: currentType === 'bowling' }
            ];

            const typeMenu = new discord_js_1.StringSelectMenuBuilder()
                .setCustomId('lb_type_select')
                .setPlaceholder('Select Category Type')
                .addOptions(typeOptions);

            const rows = [new discord_js_1.ActionRowBuilder().addComponents(typeMenu)];

            const subCats = categories.filter(c => c.type === currentType);
            if (subCats.length > 0) {
                const subMenu = new discord_js_1.StringSelectMenuBuilder()
                    .setCustomId('lb_sub_select')
                    .setPlaceholder(`Select ${currentType.charAt(0).toUpperCase() + currentType.slice(1)} Option`)
                    .addOptions(subCats.map(c => ({ 
                        label: c.label, 
                        value: c.value, 
                        default: c.value === currentCat 
                    })));
                rows.push(new discord_js_1.ActionRowBuilder().addComponents(subMenu));
            }
            return rows;
        };

        const initialCat = categories.find(c => c.value === 'mvp');
        const initialBuffer = await generateLBImage(initialCat, allStats, seasonName, message.client, message.author.id);
        const initialAttachment = new discord_js_1.AttachmentBuilder(initialBuffer, { name: 'leaderboard.png' });

        const response = await message.reply({ 
            files: [initialAttachment],
            components: getComponents('general', 'mvp') 
        });

        const collector = response.createMessageComponentCollector({ 
            filter: i => i.user.id === message.author.id,
            time: 300000 
        });

        let currentType = 'general';
        let currentCatValue = 'mvp';

        collector.on('collect', async i => {
            await i.deferUpdate();
            if (i.customId === 'lb_type_select') {
                currentType = i.values[0];
                if (currentType === 'batting') currentCatValue = 'runs';
                else if (currentType === 'bowling') currentCatValue = 'wickets';
                else currentCatValue = 'mvp';
            } else if (i.customId === 'lb_sub_select') {
                currentCatValue = i.values[0];
            }
            
            const cat = categories.find(c => c.value === currentCatValue);
            const newBuffer = await generateLBImage(cat, allStats, seasonName, message.client, message.author.id);
            const newAttachment = new discord_js_1.AttachmentBuilder(newBuffer, { name: 'leaderboard.png' });

            await i.editReply({ 
                files: [newAttachment],
                components: getComponents(currentType, currentCatValue) 
            });
        });

        collector.on('end', () => {
            response.edit({ components: [] }).catch(() => {});
        });
    }
}
async function handleManagementCommand(message, command, args) {
    const db = (0, database_1.getDB)();
    const guildId = message.guild?.id;
    if (!guildId)
        return;
    if (!(0, utils_1.isAdmin)(message.member))
        return;
    let actualCommand = command;
    if (command === 'rp')
        actualCommand = 'removeplayer';
    if (command === 'ra')
        actualCommand = 'resetauction';
    if (command === 'ma')
        actualCommand = 'makeadmin';
    if (command === 'cl')
        actualCommand = 'clearroster';
    if (command === 'dt')
        actualCommand = 'deleteteam';
    if (command === 'ur')
        actualCommand = 'unroster';
    if (command === 'removefromteam' || command === 'rft')
        actualCommand = 'removefromteam';
    if (command === 'ms')
        actualCommand = 'manualsell';
    if (command === 'tr' || command === 'atr' || command === 'assignteamrole')
        actualCommand = 'teamrole';
    if (command === 'asd')
        actualCommand = 'assignstadium';
    if (command === 'ftr')
        actualCommand = 'forceteamrename';
    if (command === 'teamnamefromrole' || command === 'tnr')
        actualCommand = 'teamnamefromrole';
    if (command === 'att' || command === 'assignplayer')
        actualCommand = 'addtoteam';
    if (command === 'addusertoteam' || command === 'aut')
        actualCommand = 'addusertoteam';
    if (command === 'ctr')
        actualCommand = 'createteamrole';
    if (command === 'cc' || command === 'createchannel')
        actualCommand = 'createchannel';
    if (command === 'catr' || command === 'createallteamroles')
        actualCommand = 'createallteamroles';
    if (command === 'ctc')
        actualCommand = 'createteamchannel';
    if (command === 'catc' || command === 'createallteamchannels')
        actualCommand = 'createallteamchannels';
    if (command === 'stz')
        actualCommand = 'settimezone';
    if (command === 'ssc' || command === 'setsaleschannel')
        actualCommand = 'setsaleschannel';
    if (command === 'setauditlogchannel' || command === 'salc' || command === 'setdestructivelogchannel' || command === 'sdlc')
        actualCommand = 'setauditlogchannel';
    if (command === 'auditlogtoggle' || command === 'alt')
        actualCommand = 'auditlogtoggle';
    if (command === 'setplayerlogchannel' || command === 'splc')
        actualCommand = 'setplayerlogchannel';
    if (command === 'setteamlogchannel' || command === 'stlc')
        actualCommand = 'setteamlogchannel';
    if (command === 'playerlogtoggle' || command === 'plt')
        actualCommand = 'playerlogtoggle';
    if (command === 'teammanagetoggle' || command === 'tmt')
        actualCommand = 'teammanagetoggle';
    if (command === 'jointeamtoggle' || command === 'jtt')
        actualCommand = 'jointeamtoggle';
    if (command === 'dmrole') actualCommand = 'dmrole';
    if (command === 'assignrole' || command === 'ar') actualCommand = 'assignrole';
    if (command === 'removerole' || command === 'rmrole') actualCommand = 'removerole';
    if (command === 'renamerole' || command === 'rrl') actualCommand = 'renamerole';
    if (command === 'copyrole' || command === 'r2r') actualCommand = 'copyrole';
    if (command === 'transferroles' || command === 'trr') actualCommand = 'transferroles';
    if (command === 'scheduledm' || command === 'sdm') actualCommand = 'scheduledm';
    if (command === 'listscheduled' || command === 'lsdm') actualCommand = 'listscheduled';
    if (command === 'delscheduled' || command === 'delsdm') actualCommand = 'delscheduled';
    if (command === 'setrolecaptain' || command === 'src') actualCommand = 'setrolecaptain';
    if (command === 'removerolecaptain' || command === 'rrc') actualCommand = 'removerolecaptain';
    if (command === 'ctcrole' || command === 'createprivatechannel' || command === 'cpc') actualCommand = 'ctcrole';
    if (command === 'setpinger' || command === 'sping') actualCommand = 'setpinger';
    if (command === 'listpingers' || command === 'lp') actualCommand = 'listpingers';
    if (command === 'removepinger' || command === 'rping') actualCommand = 'removepinger';
    if (command === 'setupauctionteams' || command === 'sat') actualCommand = 'setupauctionteams';
    if (command === 'sfc' || command === 'fixturesetupchannel') actualCommand = 'setfixturechannel';
    if (command === 'adminpingplacement') actualCommand = 'appc';

    if (actualCommand === 'listscheduled') {
        const pending = await db.all('SELECT * FROM scheduled_messages WHERE guild_id = ? AND status = "PENDING" ORDER BY scheduled_time ASC', guildId);
        if (pending.length === 0) return message.reply("No pending scheduled messages.");
        
        const list = pending.map(msg => {
            const timeStr = new Date(msg.scheduled_time * 1000).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
            return `**ID:** ${msg.id} | **Target:** ${msg.target_type} | **Time:** ${timeStr}\n**Content:** ${msg.message_content.substring(0, 50)}...`;
        }).join('\n\n');
        
        const embed = new discord_js_1.EmbedBuilder()
            .setTitle('📅 Scheduled Messages')
            .setDescription(list)
            .setColor(0x00FF00);
        message.reply({ embeds: [embed] });
    }
    else if (actualCommand === 'delscheduled') {
        const pending = await db.all('SELECT * FROM scheduled_messages WHERE guild_id = ? AND status = "PENDING"', guildId);
        if (pending.length === 0) return message.reply("No pending scheduled messages to delete.");

        const options = pending.map(msg => {
            const timeStr = new Date(msg.scheduled_time * 1000).toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
            return {
                label: `ID: ${msg.id} | ${timeStr}`,
                description: msg.message_content.substring(0, 50),
                value: msg.id.toString()
            };
        }).slice(0, 25);

        const row = new discord_js_1.ActionRowBuilder().addComponents(
            new discord_js_1.StringSelectMenuBuilder()
                .setCustomId('del_scheduled_select')
                .setPlaceholder('Select one or more messages to delete')
                .setMinValues(1)
                .setMaxValues(options.length)
                .addOptions(options)
        );

        const resp = await message.reply({ content: "Select scheduled messages to **DELETE**:", components: [row] });
        try {
            const selectInteraction = await awaitComponent(resp, { filter: i => i.user.id === message.author.id, time: 60000 }, "❌ Selection timed out.", "⚠️ Failed to pick messages.");
            if (!selectInteraction)
                return;
            await selectInteraction.deferUpdate();
            const selectedIds = selectInteraction.values;
            const idList = selectedIds.map(id => `**#${id}**`).join(', ');

            if (!await (0, utils_1.askConfirmation)(message, `Are you sure you want to delete the following scheduled messages?\n${idList}`)) {
                return await selectInteraction.editReply({ content: "❌ Deletion cancelled.", components: [] });
            }

            for (const id of selectedIds) {
                await db.run('DELETE FROM scheduled_messages WHERE guild_id = ? AND id = ?', guildId, id);
            }
            
            await selectInteraction.editReply({ content: `✅ Successfully deleted scheduled messages: ${idList}.`, components: [] });
        } catch (e) {
            console.error(e);
        }
    }
    else if (actualCommand === 'setpinger') {
        const role = message.mentions.roles.first();
        const user = await resolveTargetUser(message, args);
        if (!role || !user) return message.reply("Usage: ?setpinger [@Role] [@User/Username] [Optional: CommandName]");
        
        let cmdName = args.filter(a => !a.includes(role.id) && !a.includes(user.id) && (user.username && a.toLowerCase() !== user.username.toLowerCase())).join('');
        if (!cmdName) {
            cmdName = role.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        } else {
            cmdName = cmdName.toLowerCase().replace(/[^a-z0-9]/g, '');
        }
        
        await db.run(`INSERT INTO role_pingers (guild_id, role_id, pinger_id, command_name)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(guild_id, command_name) DO UPDATE SET
                role_id = excluded.role_id,
                pinger_id = excluded.pinger_id`, guildId, role.id, user.id, cmdName);
        message.reply(`✅ **${user.username}** is now the pinger for **${role.name}**. Command: \`?${cmdName}\``);
    }
    else if (actualCommand === 'listpingers') {
        const pingers = await db.all('SELECT * FROM role_pingers WHERE guild_id = ?', guildId);
        if (!pingers.length) return message.reply("📋 No role pingers have been assigned yet.");

        const embed = new discord_js_1.EmbedBuilder()
            .setTitle("📋 Role Pinger Assignments")
            .setColor(0x00AE86)
            .setDescription("List of all custom role pinger commands and their assigned users.")
            .setTimestamp();

        for (const p of pingers) {
            let roleName = "Unknown Role";
            let userName = "Unknown User";
            try {
                const role = await message.guild.roles.fetch(p.role_id);
                if (role) roleName = role.name;
                const user = await message.client.users.fetch(p.pinger_id);
                if (user) userName = user.username;
            } catch (e) { }
            
            embed.addFields({ 
                name: `?${p.command_name}`, 
                value: `**Role:** ${roleName}\n**User:** ${userName}`, 
                inline: true 
            });
        }
        message.reply({ embeds: [embed] });
    }
    else if (actualCommand === 'removepinger') {
        const pingers = await db.all('SELECT * FROM role_pingers WHERE guild_id = ?', guildId);
        if (pingers.length === 0) return message.reply("No role pingers found.");

        const options = await Promise.all(pingers.map(async p => {
            let roleName = "Unknown Role";
            let userName = "Unknown User";
            try {
                const role = await message.guild.roles.fetch(p.role_id);
                if (role) roleName = role.name;
                const user = await message.client.users.fetch(p.pinger_id);
                if (user) userName = user.username;
            } catch(e) {}
            return {
                label: `?${p.command_name}`,
                description: `Role: ${roleName} | User: ${userName}`,
                value: p.command_name
            };
        })).then(opts => opts.slice(0, 25));

        const row = new discord_js_1.ActionRowBuilder().addComponents(
            new discord_js_1.StringSelectMenuBuilder()
                .setCustomId('remove_pinger_select')
                .setPlaceholder('Select one or more pinger commands to remove')
                .setMinValues(1)
                .setMaxValues(options.length)
                .addOptions(options)
        );

        const resp = await message.reply({ content: "Select pinger commands to **REMOVE**:", components: [row] });
        try {
            const selectInteraction = await awaitComponent(resp, { filter: i => i.user.id === message.author.id, time: 60000 }, "❌ Selection timed out.", "⚠️ Failed to pick commands.");
            if (!selectInteraction)
                return;
            await selectInteraction.deferUpdate();
            const selectedCmds = selectInteraction.values;
            const cmdNames = selectedCmds.map(c => `**?${c}**`).join(', ');

            if (!await (0, utils_1.askConfirmation)(message, `Are you sure you want to remove the following pinger commands?\n${cmdNames}`)) {
                return await selectInteraction.editReply({ content: "❌ Action cancelled.", components: [] });
            }

            for (const cmd of selectedCmds) {
                await db.run('DELETE FROM role_pingers WHERE guild_id = ? AND command_name = ?', guildId, cmd);
            }

            await selectInteraction.editReply({ content: `✅ Successfully removed pinger commands: ${cmdNames}.`, components: [] });
        } catch (e) {
            console.error(e);
        }
    }    else if (actualCommand === 'setrolecaptain') {
        const role = message.mentions.roles.first();
        const user = await resolveTargetUser(message, args);
        if (!role || !user) return message.reply("Usage: ?setrolecaptain [@Role] [@User/Username]");
        
        await db.run(`INSERT INTO role_captains (guild_id, role_id, captain_id)
            VALUES (?, ?, ?)
            ON CONFLICT(guild_id, role_id) DO UPDATE SET
                captain_id = excluded.captain_id`, guildId, role.id, user.id);
        message.reply(`✅ **${user.username}** is now the Captain of **${role.name}**.`);
    }
    else if (actualCommand === 'removerolecaptain') {
        const caps = await db.all('SELECT * FROM role_captains WHERE guild_id = ?', guildId);
        if (caps.length === 0) return message.reply("No role captains found.");

        const options = await Promise.all(caps.map(async c => {
            let roleName = "Unknown Role";
            let userName = "Unknown User";
            try { 
                const role = await message.guild.roles.fetch(c.role_id);
                if (role) roleName = role.name;
                const user = await message.client.users.fetch(c.captain_id);
                if (user) userName = user.username;
            } catch(e) {}
            return {
                label: roleName,
                description: `Captain: ${userName}`,
                value: c.role_id
            };
        })).then(opts => opts.slice(0, 25));

        const row = new discord_js_1.ActionRowBuilder().addComponents(
            new discord_js_1.StringSelectMenuBuilder()
                .setCustomId('remove_role_cap_select')
                .setPlaceholder('Select one or more roles to remove captains from')
                .setMinValues(1)
                .setMaxValues(options.length)
                .addOptions(options)
        );

        const resp = await message.reply({ content: "Select roles to **REMOVE captains** from:", components: [row] });
        try {
            const selectInteraction = await awaitComponent(resp, { filter: i => i.user.id === message.author.id, time: 60000 }, "❌ Selection timed out.", "⚠️ Failed to pick roles.");
            if (!selectInteraction)
                return;
            await selectInteraction.deferUpdate();
            const selectedRoleIds = selectInteraction.values;
            const selectedCaps = caps.filter(c => selectedRoleIds.includes(c.role_id));
            
            // Get names for confirmation
            const names = await Promise.all(selectedRoleIds.map(async rid => {
                const role = await message.guild.roles.fetch(rid).catch(() => null);
                return role ? `**${role.name}**` : `**${rid}**`;
            }));

            if (!await (0, utils_1.askConfirmation)(message, `Are you sure you want to remove captains from the following roles?\n${names.join(', ')}`)) {
                return await selectInteraction.editReply({ content: "❌ Action cancelled.", components: [] });
            }

            for (const rid of selectedRoleIds) {
                await db.run('DELETE FROM role_captains WHERE guild_id = ? AND role_id = ?', guildId, rid);
            }
            
            await selectInteraction.editReply({ content: `✅ Successfully removed captains from: ${names.join(', ')}.`, components: [] });
        } catch (e) {
            console.error(e);
        }
    }

    if (actualCommand === 'dmrole') {
        const role = message.mentions.roles.first();
        if (!role) return message.reply("Usage: ?dmrole [@Role] [Message]");
        
        // Extract message content: everything after the role mention
        // Filter out the role ID from args to be safe, but mostly we want the text
        const content = args.filter(a => !a.includes(role.id)).join(' ');
        
        if (!content) return message.reply("Please provide a message to send.");
        
        await message.reply(`📨 Sending DM to **${role.members.size}** members with role **${role.name}**...`);
        
        let sent = 0;
        let failed = 0;
        
        // Fetch only members with this role
        await message.guild.members.fetch({ role: role.id });
        
        for (const [id, member] of role.members) {
            try {
                await member.send(`📢 **Message from ${message.author.username}:**\n\n${content}`);
                sent++;
            } catch (e) {
                failed++;
            }
        }
        
        message.channel.send(`✅ Sent: **${sent}** | ❌ Failed: **${failed}** (DMs closed/Blocked)`);
    }
    else if (actualCommand === 'assignrole') {
        let role = message.mentions.roles.first();
        const users = message.mentions.users;
        
        // If no role mention, try to extract role name from arguments
        if (!role && args.length > 0) {
            // Find where user mentions start (e.g., <@123...>)
            const mentionIndex = args.findIndex(arg => arg.startsWith('<@'));
            
            let potentialName = "";
            if (mentionIndex > 0) {
                // Take everything before the first mention as the role name
                potentialName = args.slice(0, mentionIndex).join(' ');
            } else if (mentionIndex === -1 && users.size === 0) {
                // If no mentions found in args list, try taking the whole thing
                potentialName = args.join(' ');
            } else {
                // Default fallback
                potentialName = args[0];
            }

            // Ensure the first part isn't a user mention and we have users to assign
            if (potentialName && !potentialName.startsWith('<@') && users.size > 0) {
                // Case-insensitive search for existing role
                role = message.guild.roles.cache.find(r => r.name.toLowerCase() === potentialName.toLowerCase());
                if (!role) {
                    try {
                        role = await message.guild.roles.create({
                            name: potentialName,
                            colors: { primaryColor: 'Random' },
                            permissions: [],
                            mentionable: false,
                            reason: 'Created via .assignrole command'
                        });
                        message.channel.send(`✨ Created new role **${role.name}**.`);
                    } catch (e) {
                        return message.reply("Failed to create role. Please check my permissions (Manage Roles).");
                    }
                }
            }
        }
        
        if (!role || users.size === 0) 
            return message.reply("Usage: ?assignrole [@Role OR Role Name] [@User1] [@User2]...");
            
        await message.reply(`🔄 Assigning role **${role.name}** to **${users.size}** users...`);
        
        let count = 0;
        for (const [id, user] of users) {
            try {
                const member = await message.guild.members.fetch(id);
                if (member) {
                    await member.roles.add(role);
                    count++;
                }
            } catch (e) {
                console.error(`Failed to assign role to ${user.username}`);
            }
        }
        
        message.channel.send(`✅ Successfully assigned role to **${count}** users.`);
    }
    else if (actualCommand === 'removerole') {
        const usageText = [
            "Usage:",
            "`?removerole @Role @User1 @User2 ...`",
            "`?removerole @User @Role1 @Role2 ...`",
            "`?removerole users: User One, User Two | roles: Role Name`",
            "`?removerole user: User One | roles: Role One, Role Two`",
            "For non-ping mode, separate multiple names with commas."
        ].join('\n');
        const mentionedRoles = [...message.mentions.roles.values()];
        const mentionedMembers = [...message.mentions.members.values()];
        const rawText = args.filter(token => !isUserMentionToken(token) && !isRoleMentionToken(token)).join(' ').trim();
        let roles = [];
        let members = [];
        let unresolvedRoles = [];
        let unresolvedUsers = [];
        if (mentionedRoles.length > 0 && mentionedMembers.length > 0) {
            roles = mentionedRoles;
            members = mentionedMembers;
        }
        else if (mentionedRoles.length > 0) {
            roles = mentionedRoles;
            const memberResolution = await resolveRoleRemovalMembers(message, rawText);
            members = memberResolution.members;
            unresolvedUsers = memberResolution.unresolvedInputs;
        }
        else if (mentionedMembers.length > 0) {
            members = mentionedMembers;
            const roleResolution = await resolveRoleRemovalRoles(message.guild, rawText);
            roles = roleResolution.roles;
            unresolvedRoles = roleResolution.unresolvedInputs;
        }
        else if (rawText.includes('|')) {
            const segments = rawText.split('|').map(segment => segment.trim()).filter(Boolean);
            if (segments.length !== 2) {
                return message.reply(usageText);
            }
            const [leftSegment, rightSegment] = segments;
            const leftIsUsers = /^\s*(users?|members?)\s*:/i.test(leftSegment);
            const leftIsRoles = /^\s*roles?\s*:/i.test(leftSegment);
            const rightIsUsers = /^\s*(users?|members?)\s*:/i.test(rightSegment);
            const rightIsRoles = /^\s*roles?\s*:/i.test(rightSegment);
            if (leftIsUsers && rightIsRoles) {
                const memberResolution = await resolveRoleRemovalMembers(message, leftSegment);
                const roleResolution = await resolveRoleRemovalRoles(message.guild, rightSegment);
                members = memberResolution.members;
                unresolvedUsers = memberResolution.unresolvedInputs;
                roles = roleResolution.roles;
                unresolvedRoles = roleResolution.unresolvedInputs;
            }
            else if (leftIsRoles && rightIsUsers) {
                const roleResolution = await resolveRoleRemovalRoles(message.guild, leftSegment);
                const memberResolution = await resolveRoleRemovalMembers(message, rightSegment);
                roles = roleResolution.roles;
                unresolvedRoles = roleResolution.unresolvedInputs;
                members = memberResolution.members;
                unresolvedUsers = memberResolution.unresolvedInputs;
            }
            else {
                return message.reply(`For non-ping mode, use explicit \`users:\` and \`roles:\` sections.\n\n${usageText}`);
            }
        }
        else {
            return message.reply(usageText);
        }
        roles = [...new Map(roles.map(role => [role.id, role])).values()];
        members = [...new Map(members.map(member => [member.id, member])).values()];
        if (!roles.length || !members.length) {
            const lines = ["âš ï¸ Couldn't resolve enough valid targets."];
            if (unresolvedUsers.length) {
                lines.push(`Unresolved users: ${unresolvedUsers.join(', ')}`);
            }
            if (unresolvedRoles.length) {
                lines.push(`Unresolved roles: ${unresolvedRoles.join(', ')}`);
            }
            lines.push(usageText);
            return message.reply(lines.join('\n'));
        }
        if (roles.length > 1 && members.length > 1) {
            return message.reply(`Use **one role with multiple users** or **one user with multiple roles**.\n\n${usageText}`);
        }
        const skippedRoles = [];
        const actionableRoles = roles.filter(role => {
            if (role.id === message.guild.id) {
                skippedRoles.push('@everyone');
                return false;
            }
            if (role.managed) {
                skippedRoles.push(`${role.name} (managed role)`);
                return false;
            }
            if (!role.editable) {
                skippedRoles.push(`${role.name} (above bot role or missing permission)`);
                return false;
            }
            return true;
        });
        if (!actionableRoles.length) {
            const lines = ["âš ï¸ None of the requested roles can be removed by the bot."];
            if (skippedRoles.length) {
                lines.push(`Skipped roles: ${skippedRoles.join(', ')}`);
            }
            return message.reply(lines.join('\n'));
        }
        let removedAssignments = 0;
        const touchedMembers = new Set();
        const alreadyMissing = [];
        const failedMembers = [];
        for (const member of members) {
            const removableRoles = actionableRoles.filter(role => member.roles.cache.has(role.id));
            if (!removableRoles.length) {
                alreadyMissing.push(member.displayName || member.user.username || member.id);
                continue;
            }
            try {
                await member.roles.remove(removableRoles, `Roles removed by ${message.author.tag}`);
                removedAssignments += removableRoles.length;
                touchedMembers.add(member.id);
            }
            catch (error) {
                failedMembers.push(`${member.user.tag}: ${error.message}`);
            }
        }
        const responseLines = [];
        if (removedAssignments > 0) {
            responseLines.push(`âœ… Removed **${removedAssignments}** role assignment${removedAssignments === 1 ? '' : 's'} across **${touchedMembers.size}** user${touchedMembers.size === 1 ? '' : 's'}.`);
        }
        else {
            responseLines.push("âš ï¸ No matching removable role assignments were found.");
        }
        if (members.length === 1) {
            responseLines.push(`User: **${members[0].displayName || members[0].user.username}**`);
        }
        if (actionableRoles.length === 1) {
            responseLines.push(`Role: **${actionableRoles[0].name}**`);
        }
        if (skippedRoles.length) {
            responseLines.push(`Skipped roles: ${skippedRoles.join(', ')}`);
        }
        if (alreadyMissing.length) {
            const preview = alreadyMissing.slice(0, 10).join(', ');
            responseLines.push(`Already missing selected role(s): ${preview}${alreadyMissing.length > 10 ? `, +${alreadyMissing.length - 10} more` : ''}`);
        }
        if (unresolvedUsers.length) {
            responseLines.push(`Unresolved users: ${unresolvedUsers.join(', ')}`);
        }
        if (unresolvedRoles.length) {
            responseLines.push(`Unresolved roles: ${unresolvedRoles.join(', ')}`);
        }
        if (failedMembers.length) {
            const preview = failedMembers.slice(0, 5).join(' | ');
            responseLines.push(`Failed removals: ${preview}${failedMembers.length > 5 ? ` | +${failedMembers.length - 5} more` : ''}`);
        }
        return message.reply(responseLines.join('\n'));
    }
    else if (actualCommand === 'renamerole') {
        let role = message.mentions.roles.first();
        if (!role)
            return message.reply("Usage: `?renamerole @Role [New Role Name]`");
        const newRoleName = args.filter(arg => !arg.includes(role.id)).join(' ').trim();
        if (!newRoleName)
            return message.reply("Usage: `?renamerole @Role [New Role Name]`");
        if (role.name === newRoleName)
            return message.reply(`Role is already named **${newRoleName}**.`);
        const renamed = await role.edit({ name: newRoleName, reason: `Renamed by ${message.author.tag}` }).then(() => true).catch(() => false);
        if (!renamed)
            return message.reply("I couldn't rename that role. Check my Manage Roles permission and role hierarchy.");
        return message.reply(`✅ Role renamed to **${newRoleName}**.`);
    }
    else if (actualCommand === 'copyrole') {
        {
            const mentionedRoles = [...message.mentions.roles.values()];
            let sourceRole = null;
            let targetRole = null;
            let createdTargetRole = false;

            if (mentionedRoles.length >= 2) {
                sourceRole = mentionedRoles[0];
                targetRole = mentionedRoles[1];
            }
            else if (mentionedRoles.length === 1) {
                sourceRole = mentionedRoles[0];
                const targetRoleName = args.filter(a => !a.includes(sourceRole.id)).join(' ').trim();
                if (!targetRoleName)
                    return message.reply("Usage: `?copyrole @SourceRole @TargetRole` or `?copyrole Target Role Name @SourceRole`.");
                targetRole = message.guild.roles.cache.find(r => r.name.toLowerCase() === targetRoleName.toLowerCase()) || null;
                if (!targetRole) {
                    try {
                        targetRole = await message.guild.roles.create({
                            name: targetRoleName,
                            colors: { primaryColor: 'Random' },
                            permissions: [],
                            mentionable: false,
                            reason: 'Created via copyrole command'
                        });
                        createdTargetRole = true;
                    }
                    catch (e) {
                        return message.reply("Failed to create target role. Please check my permissions (Manage Roles).");
                    }
                }
            }
            else {
                return message.reply("Usage: `?copyrole @SourceRole @TargetRole` or `?copyrole Target Role Name @SourceRole`.");
            }

            if (sourceRole.id === targetRole.id)
                return message.reply("Source role and target role must be different.");

            await message.guild.members.fetch().catch(() => null);
            const sourceMembers = [...sourceRole.members.values()];
            if (sourceMembers.length === 0)
                return message.reply(`No members currently have **${sourceRole.name}**.`);

            await message.reply(`Copying **${targetRole.name}** to **${sourceMembers.length}** members from **${sourceRole.name}**...`);

            let added = 0;
            let skipped = 0;
            let failed = 0;
            for (const member of sourceMembers) {
                if (member.roles.cache.has(targetRole.id)) {
                    skipped++;
                    continue;
                }
                try {
                    await member.roles.add(targetRole);
                    added++;
                }
                catch (e) {
                    failed++;
                    console.error(`Failed to copy role to ${member.user?.tag || member.id}:`, e);
                }
            }

            const createdLine = createdTargetRole ? `\nCreated target role: **${targetRole.name}**` : '';
            return message.channel.send(`Role copy complete.\nFrom: **${sourceRole.name}**\nTo: **${targetRole.name}**${createdLine}\nAdded: **${added}**\nSkipped: **${skipped}**\nFailed: **${failed}**`);
        }
        const mentionedRoles = [...message.mentions.roles.values()];
        let sourceRole = null;
        let targetRole = null;
        let createdTargetRole = false;
        if (mentionedRoles.length >= 2) {
            sourceRole = mentionedRoles[0];
            targetRole = mentionedRoles[1];
        }
        else if (mentionedRoles.length === 1) {
            sourceRole = mentionedRoles[0];
            const targetRoleName = args.filter(a => !a.includes(sourceRole.id)).join(' ').trim();
            if (!targetRoleName)
                return message.reply("Usage: `?copyrole @SourceRole @TargetRole` or `?copyrole Target Role Name @SourceRole`.");
            targetRole = message.guild.roles.cache.find(r => r.name.toLowerCase() === targetRoleName.toLowerCase()) || null;
            if (!targetRole) {
                try {
                    targetRole = await message.guild.roles.create({
                        name: targetRoleName,
                        colors: { primaryColor: 'Random' },
                        permissions: [],
                        mentionable: false,
                        reason: 'Created via copyrole command'
                    });
                    createdTargetRole = true;
                }
                catch (e) {
                    return message.reply("Failed to create target role. Please check my permissions (Manage Roles).");
                }
            }
        }
        else {
            return message.reply("Usage: `?copyrole @SourceRole @TargetRole` or `?copyrole Target Role Name @SourceRole`.");
        }
        if (sourceRole.id === targetRole.id)
            return message.reply("❌ Source role and target role must be different.");

        await message.guild.members.fetch().catch(() => null);
        const sourceMembers = [...sourceRole.members.values()];
        if (sourceMembers.length === 0)
            return message.reply(`❌ No members currently have **${sourceRole.name}**.`);

        await message.reply(`🔄 Copying **${targetRole.name}** to **${sourceMembers.length}** members from **${sourceRole.name}**...`);

        let added = 0;
        let skipped = 0;
        let failed = 0;
        for (const member of sourceMembers) {
            if (member.roles.cache.has(targetRole.id)) {
                skipped++;
                continue;
            }
            try {
                await member.roles.add(targetRole);
                added++;
            }
            catch (e) {
                failed++;
                console.error(`Failed to copy role to ${member.user?.tag || member.id}:`, e);
            }
        }

        message.channel.send(`✅ Role copy complete.\nFrom: **${sourceRole.name}**\nTo: **${targetRole.name}**\nAdded: **${added}**\nSkipped: **${skipped}**\nFailed: **${failed}**`);
    }
    else if (actualCommand === 'transferroles') {
        const memberIds = args.map(arg => arg.match(/<@!?(\d+)>/)?.[1]).filter(Boolean);
        if (memberIds.length < 2) {
            return message.reply("Usage: `?transferroles @OldUser @NewUser` [Optional: --keep]");
        }

        const oldMember = await message.guild.members.fetch(memberIds[0]).catch(() => null);
        const newMember = await message.guild.members.fetch(memberIds[1]).catch(() => null);

        if (!oldMember || !newMember) {
            return message.reply("One or both users were not found in this server.");
        }

        const keep = args.some(arg => arg.toLowerCase() === '--keep');

        // Ensure we have the latest roles for both
        await message.guild.members.fetch(oldMember.id);
        await message.guild.members.fetch(newMember.id);

        const transferableRoles = oldMember.roles.cache.filter(role => 
            role.id !== message.guild.id && // Skip @everyone
            role.editable && 
            !role.managed // Skip bot/integration roles
        );

        if (transferableRoles.size === 0) {
            return message.reply(`No transferable roles found for ${oldMember}.`);
        }

        await message.reply(`🔄 ${keep ? 'Copying' : 'Transferring'} **${transferableRoles.size}** roles from ${oldMember} to ${newMember}...`);

        let added = 0;
        let removed = 0;
        let failed = 0;

        for (const [roleId, role] of transferableRoles) {
            try {
                if (!newMember.roles.cache.has(roleId)) {
                    await newMember.roles.add(role);
                    added++;
                }
                if (!keep) {
                    await oldMember.roles.remove(role);
                    removed++;
                }
            } catch (e) {
                failed++;
                console.error(`Failed to transfer role ${role.name}:`, e);
            }
        }

        const actionText = keep ? "Copied" : "Transferred";
        message.channel.send(`✅ Role transfer complete.\n- ${actionText}: **${added}** roles\n- Removed from old: **${removed}**\n- Failed: **${failed}**`);
    }
    else if (actualCommand === 'scheduledm') {
        const role = message.mentions.roles.first();
        const user = await resolveTargetUser(message, args);
        
        if (!role && !user) return message.reply("Usage: ?scheduledm [@Role/@User/Username] [Time] [Message]\nTime formats: `10m` (10 mins), `2h` (2 hours), `HH:MM` (Today/Tmr), `YYYY-MM-DD_HH:MM`");
        
        const targetId = role ? role.id : user.id;
        const targetType = role ? 'ROLE' : 'USER';
        const targetName = role ? role.name : user.username;

        // Find time arg
        const argsWithoutTarget = args.filter(a => !a.includes(targetId) && (user ? a.toLowerCase() !== user.username.toLowerCase() : true));
        const timeArg = argsWithoutTarget[0];
        const content = argsWithoutTarget.slice(1).join(' ');
        
        if (!timeArg || !content) return message.reply("Missing time or message content.");
        
        let scheduledTime = 0; // Unix Timestamp
        const now = new Date();
        
        // Parse Time
        if (timeArg.match(/^\d+[mh]$/)) {
            // Relative
            const val = parseInt(timeArg.slice(0, -1));
            const unit = timeArg.slice(-1);
            if (unit === 'm') scheduledTime = Math.floor(now.getTime() / 1000) + (val * 60);
            if (unit === 'h') scheduledTime = Math.floor(now.getTime() / 1000) + (val * 3600);
        } else if (timeArg.match(/^\d{1,2}:\d{2}(\s*(AM|PM))?$/i)) {
            // HH:MM (Assume Guild Timezone or IST if not set)
            // Fetch timezone
            const settings = await db.get('SELECT timezone FROM guild_settings WHERE guild_id = ?', guildId);
            let tz = settings ? settings.timezone : 'IST';
            if (tz === 'IST') tz = 'Asia/Kolkata';
            
            const match = timeArg.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
            let hrs = parseInt(match[1]);
            const mins = parseInt(match[2]);
            const ampm = match[3];

            let is12Hour = !!ampm;
            if (is12Hour) {
                if (ampm.toUpperCase() === 'PM' && hrs < 12) hrs += 12;
                if (ampm.toUpperCase() === 'AM' && hrs === 12) hrs = 0;
            }

            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: tz,
                year: 'numeric', month: 'numeric', day: 'numeric',
                hour12: false
            });
            const parts = formatter.formatToParts(now);
            const getPart = (type) => parseInt(parts.find(p => p.type === type).value);
            
            const tYear = getPart('year');
            const tMonth = getPart('month');
            const tDay = getPart('day');

            const targetISO = `${tYear}-${String(tMonth).padStart(2, '0')}-${String(tDay).padStart(2, '0')}T${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:00`;
            
            const getOffset = (date, timeZone) => {
                const parts = new Intl.DateTimeFormat('en-US', {
                    timeZone,
                    timeZoneName: 'shortOffset'
                }).formatToParts(date);
                const offsetPart = parts.find(p => p.type === 'timeZoneName');
                const offsetName = offsetPart ? offsetPart.value : "GMT+0";
                const match = offsetName.match(/[+-](\d+):(\d+)/);
                if (!match) return 0;
                const oHrs = parseInt(match[1]);
                const oMins = parseInt(match[2]);
                const totalMins = (oHrs * 60) + oMins;
                return offsetName.startsWith('GMT-') ? -totalMins : totalMins;
            };

            const tempDate = new Date(targetISO + 'Z'); 
            const offsetMins = getOffset(tempDate, tz);
            scheduledTime = Math.floor((tempDate.getTime() - (offsetMins * 60000)) / 1000);

            // Ambiguity Resolution
            if (!is12Hour && hrs <= 12 && scheduledTime < Math.floor(now.getTime() / 1000)) {
                const pmTime = scheduledTime + (12 * 3600);
                if (pmTime > Math.floor(now.getTime() / 1000)) {
                    scheduledTime = pmTime;
                }
            }

            if (scheduledTime < Math.floor(now.getTime() / 1000)) {
                scheduledTime += 86400;
            }

        } else if (timeArg.match(/^\d{4}-\d{2}-\d{2}_\d{2}:\d{2}$/)) {
            // YYYY-MM-DD_HH:MM
             const settings = await db.get('SELECT timezone FROM guild_settings WHERE guild_id = ?', guildId);
             let tz = settings ? settings.timezone : 'IST';
             if (tz === 'IST') tz = 'Asia/Kolkata';

             const cleanTime = timeArg.replace('_', 'T');
             const tempDate = new Date(cleanTime + ':00Z');
             if (isNaN(tempDate.getTime())) return message.reply("Invalid date format.");

             const getOffset = (date, timeZone) => {
                 const parts = new Intl.DateTimeFormat('en-US', {
                     timeZone,
                     timeZoneName: 'shortOffset'
                 }).formatToParts(date);
                 const offsetName = parts.find(p => p.type === 'timeZoneName').value;
                 const match = offsetName.match(/[+-](\d+):(\d+)/);
                 if (!match) return 0;
                 const oHrs = parseInt(match[1]);
                 const oMins = parseInt(match[2]);
                 const totalMins = (oHrs * 60) + oMins;
                 return offsetName.startsWith('GMT-') ? -totalMins : totalMins;
             };

             const offsetMins = getOffset(tempDate, tz);
             scheduledTime = Math.floor((tempDate.getTime() - (offsetMins * 60000)) / 1000);
        } else {
             return message.reply("Invalid time format. Use `10m`, `HH:MM`, or `YYYY-MM-DD_HH:MM`");
        }
        
        await db.run('INSERT INTO scheduled_messages (guild_id, target_role_id, target_type, message_content, scheduled_time, status, author_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
            guildId, targetId, targetType, content, scheduledTime, 'PENDING', message.author.id);
            
        const displayTime = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Kolkata',
            dateStyle: 'full',
            timeStyle: 'short'
        }).format(new Date(scheduledTime * 1000));

        message.reply(`✅ Message scheduled for **${displayTime} IST** to **${targetName}**.`);
    }

    if (actualCommand === 'setsaleschannel') {
        const channel = message.mentions.channels.first();
        if (!channel) return message.reply("Usage: ?setsaleschannel [#channel]");

        await db.run(`INSERT INTO guild_settings (guild_id, sales_log_channel_id) VALUES (?, ?)
                      ON CONFLICT(guild_id) DO UPDATE SET sales_log_channel_id = ?`,
                      guildId, channel.id, channel.id);

        message.reply(`✅ Sales Log channel updated to ${channel}.`);
    }

    if (actualCommand === 'setauditlogchannel') {
        return await updateGuildLogChannelSetting(message, {
            rawInput: args.join(' ').trim().toLowerCase(),
            commandName: 'setauditlogchannel',
            clearSql: `INSERT INTO guild_settings (guild_id, admin_audit_log_channel_id)
                VALUES (?, NULL)
                ON CONFLICT(guild_id) DO UPDATE SET admin_audit_log_channel_id = NULL`,
            saveSql: `INSERT INTO guild_settings (guild_id, admin_audit_log_channel_id)
                VALUES (?, ?)
                ON CONFLICT(guild_id) DO UPDATE SET admin_audit_log_channel_id = ?`,
            categoryPrompt: 'Select the **Category** for the admin audit log channel:',
            channelPrompt: 'Select the **Admin Audit Log Channel**:',
            clearedSummary: 'Cleared the server admin audit log channel.',
            clearedReply: 'Done: Server admin audit log channel cleared.',
            updatedSummary: (channel) => `Updated the server admin audit log channel to ${channel}.`,
            updatedReply: (channel) => `Done: Server admin audit logs will now be sent to ${channel}.`
        });
    }

    if (actualCommand === 'auditlogtoggle') {
        return await updateGuildLogToggle(message, {
            value: args[0],
            commandName: 'auditlogtoggle',
            usageText: 'Usage: `?auditlogtoggle on|off`',
            sql: `INSERT INTO guild_settings (guild_id, admin_audit_logs_enabled)
                VALUES (?, ?)
                ON CONFLICT(guild_id) DO UPDATE SET admin_audit_logs_enabled = ?`,
            summary: (enabled) => `Turned ${enabled ? 'on' : 'off'} server admin audit logs.`,
            reply: (enabled) => `Done: Server admin audit logs are now **${enabled ? 'enabled' : 'disabled'}**.`
        });
    }

    if (actualCommand === 'setplayerlogchannel') {
        return await updateGuildLogChannelSetting(message, {
            rawInput: args.join(' ').trim().toLowerCase(),
            commandName: 'setplayerlogchannel',
            clearSql: `INSERT INTO guild_settings (guild_id, community_roster_log_channel_id, community_player_log_channel_id)
                VALUES (?, NULL, NULL)
                ON CONFLICT(guild_id) DO UPDATE SET
                    community_roster_log_channel_id = NULL,
                    community_player_log_channel_id = NULL`,
            saveSql: `INSERT INTO guild_settings (guild_id, community_roster_log_channel_id, community_player_log_channel_id)
                VALUES (?, ?, ?)
                ON CONFLICT(guild_id) DO UPDATE SET
                    community_roster_log_channel_id = excluded.community_roster_log_channel_id,
                    community_player_log_channel_id = excluded.community_player_log_channel_id`,
            categoryPrompt: 'Select the **Category** for the player activity log channel:',
            channelPrompt: 'Select the **Player Activity Log Channel**:',
            clearedSummary: 'Cleared the player activity log channel.',
            clearedReply: 'Done: Player activity log channel cleared.',
            updatedSummary: (channel) => `Updated the player activity log channel to ${channel}.`,
            updatedReply: (channel) => `Done: Player activity logs will now be sent to ${channel}.`
        });
    }

    if (actualCommand === 'setteamlogchannel') {
        return await updateGuildLogChannelSetting(message, {
            rawInput: args.join(' ').trim().toLowerCase(),
            commandName: 'setteamlogchannel',
            clearSql: `INSERT INTO guild_settings (guild_id, community_roster_log_channel_id, community_player_log_channel_id)
                VALUES (?, NULL, NULL)
                ON CONFLICT(guild_id) DO UPDATE SET
                    community_roster_log_channel_id = NULL,
                    community_player_log_channel_id = NULL`,
            saveSql: `INSERT INTO guild_settings (guild_id, community_roster_log_channel_id, community_player_log_channel_id)
                VALUES (?, ?, ?)
                ON CONFLICT(guild_id) DO UPDATE SET
                    community_roster_log_channel_id = excluded.community_roster_log_channel_id,
                    community_player_log_channel_id = excluded.community_player_log_channel_id`,
            categoryPrompt: 'Select the **Category** for the player activity log channel:',
            channelPrompt: 'Select the **Player Activity Log Channel**:',
            clearedSummary: 'Cleared the player activity log channel.',
            clearedReply: 'Done: Player activity log channel cleared.',
            updatedSummary: (channel) => `Updated the player activity log channel to ${channel}.`,
            updatedReply: (channel) => `Done: Player activity logs will now be sent to ${channel}.`
        });
    }

    if (actualCommand === 'playerlogtoggle') {
        return await updateGuildLogToggle(message, {
            value: args[0],
            commandName: 'playerlogtoggle',
            usageText: 'Usage: `?playerlogtoggle on|off`',
            sql: `INSERT INTO guild_settings (guild_id, community_player_logs_enabled)
                VALUES (?, ?)
                ON CONFLICT(guild_id) DO UPDATE SET community_player_logs_enabled = ?`,
            summary: (enabled) => `Turned ${enabled ? 'on' : 'off'} player activity logs.`,
            reply: (enabled) => `Done: Player activity logs are now **${enabled ? 'enabled' : 'disabled'}**.`
        });
    }

    if (actualCommand === 'teammanagetoggle') {
        const value = (args[0] || '').toLowerCase();
        if (!['on', 'off'].includes(value))
            return message.reply("Usage: `?teammanagetoggle on|off`");
        const enabled = value === 'on' ? 1 : 0;
        await db.run(`INSERT INTO guild_settings (guild_id, community_roster_manage_open) VALUES (?, ?)
            ON CONFLICT(guild_id) DO UPDATE SET community_roster_manage_open = ?`, guildId, enabled, enabled);
        const dmResult = await notifyCommunityLeadersAboutRosterSetting(message.guild, enabled
            ? "Admins have enabled captain `?teamadd` / `?teamkick` for community teams."
            : "Admins have disabled captain `?teamadd` / `?teamkick` for community teams.");
        return message.reply(`Done: Captain add/kick commands are now **${enabled ? 'enabled' : 'disabled'}**. Leaders notified: **${dmResult.sent}**${dmResult.failed ? ` | Failed DMs: **${dmResult.failed}**` : ''}.`);
    }

    if (actualCommand === 'jointeamtoggle') {
        const value = (args[0] || '').toLowerCase();
        if (!['on', 'off'].includes(value))
            return message.reply("Usage: `?jointeamtoggle on|off`");
        const enabled = value === 'on' ? 1 : 0;
        await db.run(`INSERT INTO guild_settings (guild_id, community_join_requests_open) VALUES (?, ?)
            ON CONFLICT(guild_id) DO UPDATE SET community_join_requests_open = ?`, guildId, enabled, enabled);
        const dmResult = await notifyCommunityLeadersAboutRosterSetting(message.guild, enabled
            ? "Admins have enabled `?jointeam` requests for community teams."
            : "Admins have disabled `?jointeam` requests for community teams.");
        return message.reply(`Done: Join requests are now **${enabled ? 'enabled' : 'disabled'}**. Leaders notified: **${dmResult.sent}**${dmResult.failed ? ` | Failed DMs: **${dmResult.failed}**` : ''}.`);
    }

    if (actualCommand === 'settimezone') {
        const timezones = [
            'UTC', 'GMT', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 
            'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 
            'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney', 'Asia/Dubai'
        ];
        
        const selectMenu = new discord_js_1.StringSelectMenuBuilder()
            .setCustomId('timezone_select')
            .setPlaceholder('🌍 Select a Timezone')
            .addOptions(timezones.map(tz => new discord_js_1.StringSelectMenuOptionBuilder()
                .setLabel(tz)
                .setValue(tz)
                .setDescription(`Set server time to ${tz}`)
            ));

        const row = new discord_js_1.ActionRowBuilder().addComponents(selectMenu);
        
        const response = await message.reply({
            content: `Please select the timezone for this server:`,
            components: [row]
        });

        const collector = response.createMessageComponentCollector({
            filter: i => i.user.id === message.author.id && i.customId === 'timezone_select',
            time: 60000,
            max: 1
        });

        collector.on('collect', async (i) => {
            const selectedTimezone = i.values[0];
            await db.run(`INSERT INTO guild_settings (guild_id, timezone) VALUES (?, ?) 
                          ON CONFLICT(guild_id) DO UPDATE SET timezone = ?`, 
                          guildId, selectedTimezone, selectedTimezone);
            
            await i.update({
                content: `✅ Timezone updated to **${selectedTimezone}**.`,
                components: []
            });
        });

        collector.on('end', collected => {
            if (collected.size === 0) {
                response.edit({ content: '❌ Timezone selection timed out.', components: [] });
            }
        });
    }
    if (actualCommand === 'removeplayer') {
        const players = await db.all('SELECT * FROM auction_players WHERE guild_id = ? ORDER BY COALESCE(set_name, "ZZZ"), ign ASC', guildId);
        if (players.length === 0)
            return message.reply("No players found in auction.");
        const mentionIds = [...message.mentions.users.keys()];
        const plainTokens = args.filter(a => !/^<@!?(\d+)>$/.test(a));
        if (mentionIds.length > 0 || plainTokens.length > 0) {
            const selectedPlayers = [];
            const selectedIds = new Set();
            for (const userId of mentionIds) {
                const player = players.find(p => p.discord_id === userId);
                if (player && !selectedIds.has(player.discord_id)) {
                    selectedIds.add(player.discord_id);
                    selectedPlayers.push(player);
                }
            }
            for (const token of plainTokens) {
                const targetUser = await resolveTargetUser(message, [token]);
                if (!targetUser)
                    continue;
                const player = players.find(p => p.discord_id === targetUser.id);
                if (player && !selectedIds.has(player.discord_id)) {
                    selectedIds.add(player.discord_id);
                    selectedPlayers.push(player);
                }
            }
            if (selectedPlayers.length === 0) {
                return message.reply("No matching auction players found for the provided users.");
            }
            if (!await (0, utils_1.askConfirmation)(message, `Are you sure you want to remove the following players?\n${formatAuctionPlayerSelectionSummary(selectedPlayers)}`)) {
                return message.reply("❌ Action cancelled.");
            }
            const result = await removeAuctionPlayersForGuild(message.guild, guildId, selectedPlayers);
            return message.reply(`✅ Successfully removed **${result.removedCount}** players from the auction.${result.refundTotal > 0 ? ` Refunded **${(0, utils_1.lakhsToDisplay)(result.refundTotal)}** to respective teams.` : ''}`);
        }
        const sets = await db.all(`SELECT s.set_name, s.set_order, COUNT(ap.discord_id) as player_count
            FROM sets s
            LEFT JOIN auction_players ap ON ap.guild_id = s.guild_id AND ap.set_name = s.set_name
            WHERE s.guild_id = ?
            GROUP BY s.set_name
            HAVING COUNT(ap.discord_id) > 0
            ORDER BY CASE WHEN s.set_order IS NULL THEN 1 ELSE 0 END, s.set_order ASC, s.set_name ASC`, guildId);
        const noSetCount = players.filter(p => !p.set_name).length;
        const setOptions = sets.map(setRow => ({
            label: setRow.set_name,
            description: `${setRow.player_count} player${setRow.player_count === 1 ? '' : 's'}`,
            value: setRow.set_name
        }));
        if (noSetCount > 0) {
            setOptions.push({
                label: 'No Set',
                description: `${noSetCount} player${noSetCount === 1 ? '' : 's'} with no assigned set`,
                value: '__NO_SET__'
            });
        }
        if (setOptions.length === 0) {
            return message.reply("No sets with players were found.");
        }
        const setRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
            .setCustomId('remove_player_set_select')
            .setPlaceholder('Search and select a set')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(setOptions.slice(0, 25)));
        const setResp = await message.reply({ content: "Select the set first, then choose the players to remove.", components: [setRow] });
        try {
            const setInteraction = await awaitComponent(setResp, { filter: i => i.user.id === message.author.id && i.customId === 'remove_player_set_select', time: 60000 }, "❌ Set selection timed out.", "⚠️ Failed to select a set.");
            if (!setInteraction)
                return;
            const selectedSet = setInteraction.values[0];
            const setPlayers = selectedSet === '__NO_SET__'
                ? players.filter(p => !p.set_name)
                : players.filter(p => p.set_name === selectedSet);
            if (setPlayers.length === 0) {
                return await setInteraction.update({ content: "⚠️ No players were found in that set.", components: [] }).catch(() => null);
            }
            const playerOptions = [{
                    label: 'Select All',
                    description: `Remove all ${setPlayers.length} players from ${selectedSet === '__NO_SET__' ? 'No Set' : selectedSet}`,
                    value: '__ALL__'
                }, ...setPlayers.slice(0, 24).map(player => ({
                    label: player.ign.length > 100 ? player.ign.slice(0, 97) + '...' : player.ign,
                    description: `Status: ${player.status} | Set: ${player.set_name || 'None'}`,
                    value: player.discord_id
                }))];
            const playerRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
                .setCustomId('remove_player_from_set_select')
                .setPlaceholder('Search and select players to remove')
                .setMinValues(1)
                .setMaxValues(playerOptions.length)
                .addOptions(playerOptions));
            let detailText = `Set selected: **${selectedSet === '__NO_SET__' ? 'No Set' : selectedSet}**.\nSelect players to **REMOVE** from auction.`;
            if (setPlayers.length > 24) {
                detailText += `\nShowing the first **24** players plus **Select All** due to Discord menu limits.`;
            }
            await setInteraction.update({ content: detailText, components: [playerRow] });
            const playerInteraction = await awaitComponent(setResp, { filter: i => i.user.id === message.author.id && i.customId === 'remove_player_from_set_select', time: 60000 }, "❌ Player selection timed out.", "⚠️ Failed to select players.");
            if (!playerInteraction)
                return;
            const removeAll = playerInteraction.values.includes('__ALL__');
            const chosenPlayers = removeAll
                ? setPlayers
                : setPlayers.filter(player => playerInteraction.values.includes(player.discord_id));
            if (chosenPlayers.length === 0) {
                return await playerInteraction.update({ content: "⚠️ No players were selected.", components: [] }).catch(() => null);
            }
            if (!await (0, utils_1.askConfirmation)(message, `Are you sure you want to remove the following players?\n${formatAuctionPlayerSelectionSummary(chosenPlayers)}`)) {
                return await playerInteraction.update({ content: "❌ Action cancelled.", components: [] }).catch(() => null);
            }
            const result = await removeAuctionPlayersForGuild(message.guild, guildId, chosenPlayers);
            return await playerInteraction.update({
                content: `✅ Successfully removed **${result.removedCount}** players from the auction.${result.refundTotal > 0 ? ` Refunded **${(0, utils_1.lakhsToDisplay)(result.refundTotal)}** to respective teams.` : ''}`,
                components: []
            }).catch(() => null);
        }
        catch (e) {
            console.error(e);
            return;
        }

        const options = players.map(p => ({
            label: p.ign,
            description: `Status: ${p.status} | Set: ${p.set_name || 'None'}`,
            value: p.discord_id
        })).slice(0, 25);

        const row = new discord_js_1.ActionRowBuilder().addComponents(
            new discord_js_1.StringSelectMenuBuilder()
                .setCustomId('remove_player_select')
                .setPlaceholder('Select one or more players to remove')
                .setMinValues(1)
                .setMaxValues(options.length)
                .addOptions(options)
        );

        const resp = await message.reply({ content: "Select players to **REMOVE** from auction:", components: [row] });
        try {
            const selectInteraction = await awaitComponent(resp, { filter: i => i.user.id === message.author.id, time: 60000 }, "❌ Selection timed out.", "⚠️ Failed to select players.");
            if (!selectInteraction)
                return;
            await selectInteraction.deferUpdate();
            const selectedIds = selectInteraction.values;
            const selectedPlayers = players.filter(p => selectedIds.includes(p.discord_id));
            const names = selectedPlayers.map(p => `**${p.ign}**`).join(', ');

            if (!await (0, utils_1.askConfirmation)(message, `Are you sure you want to remove the following players?\n${names}`)) {
                return await selectInteraction.editReply({ content: "❌ Action cancelled.", components: [] });
            }

            let refundTotal = 0;
            for (const p of selectedPlayers) {
                if (p.status === 'SOLD' && p.sold_to_team_id) {
                    await db.run('UPDATE teams SET purse_lakhs = purse_lakhs + ? WHERE guild_id = ? AND team_id = ?', p.sold_for_lakhs, guildId, p.sold_to_team_id);
                    refundTotal += (p.sold_for_lakhs || 0);
                }
                await db.run('DELETE FROM auction_players WHERE guild_id = ? AND discord_id = ?', guildId, p.discord_id);
            }
            
            const successMsg = `✅ Successfully removed **${selectedPlayers.length}** players from the auction.${refundTotal > 0 ? ` Refunded **${(0, utils_1.lakhsToDisplay)(refundTotal)}** to respective teams.` : ''}`;
            try {
                await (0, auditLog_1.appendAdminAuditLog)({
                    guildId,
                    actorId: message.author.id,
                    commandName: 'unroster',
                    summary: `Unsold and returned ${refundCount} player(s) to the auction pool.`,
                    targetSummary: selectedPlayers.map(player => player.ign).join(', '),
                    channelId: message.channel.id
                });
                await selectInteraction.editReply({ content: successMsg, components: [] });
            } catch (e) {
                await message.channel.send(successMsg);
            }
        } catch (e) {
            if (!message.replied) console.error(e);
        }
    }
    else if (actualCommand === 'unsell' || actualCommand === 'unroster') {
        if (message.mentions.users.size === 1) {
            const targetUser = message.mentions.users.first();
            const player = await db.get('SELECT * FROM auction_players WHERE guild_id = ? AND discord_id = ? AND status = "SOLD"', guildId, targetUser.id);
            if (!player)
                return message.reply(`${targetUser.username} is not currently sold.`);
            if (!await (0, utils_1.askConfirmation)(message, `Are you sure you want to unsell and remove **${player.ign}** from the team?`)) {
                return message.reply("Error: Action cancelled.");
            }
            const soldTeam = player.sold_to_team_id
                ? await db.get('SELECT * FROM teams WHERE guild_id = ? AND team_id = ?', guildId, player.sold_to_team_id)
                : null;
            if (player.sold_to_team_id) {
                await db.run('UPDATE teams SET purse_lakhs = purse_lakhs + ? WHERE guild_id = ? AND team_id = ?', player.sold_for_lakhs, guildId, player.sold_to_team_id);
                await db.run('UPDATE auction_players SET status = "AVAILABLE", sold_to_team_id = NULL, sold_for_lakhs = NULL WHERE guild_id = ? AND discord_id = ?', guildId, player.discord_id);
                await db.run('DELETE FROM team_vice_captains WHERE guild_id = ? AND team_id = ? AND vice_captain_discord_id = ?', guildId, player.sold_to_team_id, player.discord_id);
                if (soldTeam) {
                    await syncAuctionTeamRoleForMember(message.guild, soldTeam, player.discord_id, 'remove');
                }
            }
            let reauctionStarted = false;
            try {
                await auctionManager_1.auctionManager.interruptForReauction(guildId, player.discord_id, message.channel);
                reauctionStarted = true;
            }
            catch (err) {
                console.error('Failed to restart unsold player auction:', err);
            }
            const lines = [
                `Done: Successfully unsold **${player.ign}** and returned them to the auction pool.`
            ];
            if (reauctionStarted) {
                lines.push(`**${player.ign}** will restart on auction in **10 seconds**.`);
                lines.push('Any current live lot was cleared and queued to resume after this re-auction finishes.');
            }
            await (0, auditLog_1.appendAdminAuditLog)({
                guildId,
                actorId: message.author.id,
                commandName: 'unroster',
                summary: `Unsold ${player.ign} and returned them to the auction pool.`,
                targetSummary: soldTeam ? `${player.ign} | ${soldTeam.team_name}` : player.ign,
                channelId: message.channel.id
            });
            return message.reply(lines.join('\n'));
        }
        const players = await db.all('SELECT * FROM auction_players WHERE guild_id = ? AND status = "SOLD"', guildId);
        if (players.length === 0) return message.reply("No sold players found.");

        const options = players.map(p => ({
            label: p.ign,
            description: `Sold for: ${(0, utils_1.lakhsToDisplay)(p.sold_for_lakhs)}`,
            value: p.discord_id
        })).slice(0, 25);

        const row = new discord_js_1.ActionRowBuilder().addComponents(
            new discord_js_1.StringSelectMenuBuilder()
                .setCustomId('unsell_player_select')
                .setPlaceholder('Select one or more players to unsell')
                .setMinValues(1)
                .setMaxValues(options.length)
                .addOptions(options)
        );

        const resp = await message.reply({ content: "Select players to **REMOVE from their teams**:", components: [row] });
        try {
            const selectInteraction = await awaitComponent(resp, { filter: i => i.user.id === message.author.id, time: 60000 }, "❌ Selection timed out.", "⚠️ Failed to select players.");
            if (!selectInteraction)
                return;
            await selectInteraction.deferUpdate();
            const selectedIds = selectInteraction.values;
            const selectedPlayers = players.filter(p => selectedIds.includes(p.discord_id));
            const names = selectedPlayers.map(p => `**${p.ign}**`).join(', ');

            if (!await (0, utils_1.askConfirmation)(message, `Are you sure you want to unsell and remove the following players from their teams?\n${names}`)) {
                try { await selectInteraction.editReply({ content: "❌ Action cancelled.", components: [] }); } catch(e) {}
                return;
            }

            let refundCount = 0;
            for (const p of selectedPlayers) {
                if (p.sold_to_team_id) {
                    const soldTeam = await db.get('SELECT * FROM teams WHERE guild_id = ? AND team_id = ?', guildId, p.sold_to_team_id);
                    await db.run('UPDATE teams SET purse_lakhs = purse_lakhs + ? WHERE guild_id = ? AND team_id = ?', p.sold_for_lakhs, guildId, p.sold_to_team_id);
                    await db.run('UPDATE auction_players SET status = "AVAILABLE", sold_to_team_id = NULL, sold_for_lakhs = NULL WHERE guild_id = ? AND discord_id = ?', guildId, p.discord_id);
                    await db.run('DELETE FROM team_vice_captains WHERE guild_id = ? AND team_id = ? AND vice_captain_discord_id = ?', guildId, p.sold_to_team_id, p.discord_id);
                    if (soldTeam) {
                        await syncAuctionTeamRoleForMember(message.guild, soldTeam, p.discord_id, 'remove');
                    }
                    refundCount++;
                }
            }
            
            const successMsg = `✅ Successfully unsold and returned **${refundCount}** players to the auction pool.`;
            try {
                await selectInteraction.editReply({ content: successMsg, components: [] });
            } catch (e) {
                await message.channel.send(successMsg);
            }
        } catch (e) {
            if (!message.replied) console.error(e);
        }
    }
    else if (actualCommand === 'resetauction') {
        if (!await (0, utils_1.askConfirmation)(message, "Are you sure you want to **RESET THE ENTIRE AUCTION**?\nThis will clear all sales and refund all wallets. This cannot be undone."))
            return;
        message.channel.send("⚠️ **Resetting Auction...** (Refunding wallets and resetting rosters)");
        const refunds = await db.all('SELECT sold_to_team_id as team_id, SUM(sold_for_lakhs) as spent FROM auction_players WHERE guild_id = ? AND status = "SOLD" GROUP BY sold_to_team_id', guildId);
        for (const r of refunds) {
            await db.run('UPDATE teams SET purse_lakhs = purse_lakhs + ? WHERE guild_id = ? AND team_id = ?', r.spent, guildId, r.team_id);
        }
        await db.run('UPDATE auction_players SET status = "AVAILABLE", sold_to_team_id = NULL, sold_for_lakhs = NULL WHERE guild_id = ?', guildId);
        await db.run('DELETE FROM auction_ledger WHERE guild_id = ?', guildId);
        message.reply("✅ **Auction Reset Complete.** All players are AVAILABLE. Wallets refunded.");
    }
    else if (actualCommand === 'clearset') {
        const sets = await getOrderedSets(guildId);
        if (sets.length === 0) return message.reply("No sets found.");

        const options = sets.map(s => ({
            label: s.set_name,
            description: `Base Price: ${(0, utils_1.lakhsToDisplay)(s.base_price_lakhs)}`,
            value: s.set_name
        })).slice(0, 25);

        const row = new discord_js_1.ActionRowBuilder().addComponents(
            new discord_js_1.StringSelectMenuBuilder()
                .setCustomId('clear_set_select')
                .setPlaceholder('Select one or more sets to clear')
                .setMinValues(1)
                .setMaxValues(options.length)
                .addOptions(options)
        );

        const resp = await message.reply({ content: "Select sets to **CLEAR** (Removes all players from those sets):", components: [row] });
        try {
            const selectInteraction = await awaitComponent(resp, { filter: i => i.user.id === message.author.id, time: 60000 }, "❌ Selection timed out.", "⚠️ Failed to select sets.");
            if (!selectInteraction)
                return;
            await selectInteraction.deferUpdate();
            const selectedSetNames = selectInteraction.values;
            const setNamesStr = selectedSetNames.map(s => `**${s}**`).join(', ');

            if (!await (0, utils_1.askConfirmation)(message, `Are you sure you want to **REMOVE ALL PLAYERS** from the following sets?\n${setNamesStr}\n\nAny sold players in these sets will be refunded.`)) {
                return await selectInteraction.editReply({ content: "❌ Action cancelled.", components: [] });
            }

            let refundTotal = 0;
            let totalPlayersRemoved = 0;

            for (const sName of selectedSetNames) {
                const players = await db.all('SELECT * FROM auction_players WHERE guild_id = ? AND set_name = ?', guildId, sName);
                for (const player of players) {
                    if (player.status === 'SOLD' && player.sold_to_team_id) {
                        await db.run('UPDATE teams SET purse_lakhs = purse_lakhs + ? WHERE guild_id = ? AND team_id = ?', player.sold_for_lakhs, guildId, player.sold_to_team_id);
                        refundTotal += (player.sold_for_lakhs || 0);
                    }
                }
                await db.run('DELETE FROM auction_players WHERE guild_id = ? AND set_name = ?', guildId, sName);
                totalPlayersRemoved += players.length;
            }
            
            let msg = `✅ Successfully removed **${totalPlayersRemoved}** players from sets: ${setNamesStr}.`;
            if (refundTotal > 0) msg += ` Total refunded: **${(0, utils_1.lakhsToDisplay)(refundTotal)}**.`;
            await (0, auditLog_1.appendAdminAuditLog)({
                guildId,
                actorId: message.author.id,
                commandName: 'clearset',
                summary: `Cleared ${totalPlayersRemoved} player(s) from ${selectedSetNames.length} set(s).`,
                targetSummary: selectedSetNames.join(', '),
                channelId: message.channel.id
            });
            await selectInteraction.editReply({ content: msg, components: [] });
        } catch (e) {
            console.error(e);
        }
    }
    else if (actualCommand === 'clearroster') {
        const teams = await db.all('SELECT * FROM teams WHERE guild_id = ?', guildId);
        if (teams.length === 0) return message.reply("No teams found.");

        const options = await Promise.all(teams.map(async t => {
            let ownerName = "Unknown Owner";
            try {
                const member = await message.guild.members.fetch(t.owner_discord_id).catch(() => null);
                if (member) ownerName = member.user.username;
            } catch (e) {}
            return {
                label: t.team_name,
                description: `Owner: ${ownerName}`,
                value: t.team_id.toString()
            };
        })).then(opts => opts.slice(0, 25));

        const row = new discord_js_1.ActionRowBuilder().addComponents(
            new discord_js_1.StringSelectMenuBuilder()
                .setCustomId('clear_roster_select')
                .setPlaceholder('Select one or more teams to clear rosters')
                .setMinValues(1)
                .setMaxValues(options.length)
                .addOptions(options)
        );

        const resp = await message.reply({ content: "Select teams to **CLEAR ROSTERS**:", components: [row] });
        try {
            const selectInteraction = await awaitComponent(resp, { filter: i => i.user.id === message.author.id, time: 60000 }, "❌ Selection timed out.", "⚠️ Failed to select teams.");
            if (!selectInteraction)
                return;
            await selectInteraction.deferUpdate();
            const selectedTeamIds = selectInteraction.values;
            const selectedTeams = teams.filter(t => selectedTeamIds.includes(t.team_id.toString()));
            const teamNamesStr = selectedTeams.map(t => `**${t.team_name}**`).join(', ');

            if (!await (0, utils_1.askConfirmation)(message, `Are you sure you want to **CLEAR THE ROSTERS** of the following teams?\n${teamNamesStr}\n\nAll players will become AVAILABLE and their cost refunded.`)) {
                try { await selectInteraction.editReply({ content: "❌ Action cancelled.", components: [] }); } catch(e) {}
                return;
            }

            let refundTotal = 0;
            let totalPlayersReturned = 0;

            for (const teamId of selectedTeamIds) {
                const players = await db.all('SELECT * FROM auction_players WHERE guild_id = ? AND sold_to_team_id = ?', guildId, teamId);
                let teamRefund = 0;
                for (const p of players) {
                    teamRefund += (p.sold_for_lakhs || 0);
                }
                await db.run('UPDATE teams SET purse_lakhs = purse_lakhs + ? WHERE guild_id = ? AND team_id = ?', teamRefund, guildId, teamId);
                await db.run('UPDATE auction_players SET status = "AVAILABLE", sold_to_team_id = NULL, sold_for_lakhs = NULL WHERE guild_id = ? AND sold_to_team_id = ?', guildId, teamId);
                refundTotal += teamRefund;
                totalPlayersReturned += players.length;
            }
            await (0, auditLog_1.appendAdminAuditLog)({
                guildId,
                actorId: message.author.id,
                commandName: 'clearroster',
                summary: `Cleared ${totalPlayersReturned} player(s) from ${selectedTeams.length} team roster(s).`,
                targetSummary: selectedTeams.map(team => team.team_name).join(', '),
                channelId: message.channel.id
            });
            
            try {
                await selectInteraction.editReply({ content: `✅ Cleared **${totalPlayersReturned}** players from teams: ${teamNamesStr}. Total refunded: **${(0, utils_1.lakhsToDisplay)(refundTotal)}**.`, components: [] });
            } catch (e) {
                await message.channel.send(`✅ Cleared rosters for teams: ${teamNamesStr}. Refunded **${(0, utils_1.lakhsToDisplay)(refundTotal)}**.`);
            }
        } catch (e) {
            if (!message.replied) console.error(e);
        }
    }
    else if (actualCommand === 'makesuperadmin') {
        if (!(0, utils_1.isGlobalAdmin)(message.author.id)) {
            return message.reply("❌ Only global admins can promote to Super Admin.");
        }
        const user = message.mentions.members?.first();
        if (!user) return message.reply("Usage: `?makesuperadmin [@user]`");
        
        let role = message.guild?.roles.cache.find(r => r.name === utils_1.SUPER_ADMIN_ROLE_NAME);
        if (!role) {
            role = await message.guild?.roles.create({
                name: utils_1.SUPER_ADMIN_ROLE_NAME,
                colors: { primaryColor: 'Gold' },
                reason: 'Hierarchy: Super Admin can manage Admins.'
            });
        }
        await user.roles.add(role);
        message.reply(`👑 **${user.user.username}** is now a **Super Admin**.`);
    }
    else if (actualCommand === 'removesuperadmin') {
        if (!(0, utils_1.isGlobalAdmin)(message.author.id)) {
            return message.reply("❌ Only global admins can demote Super Admins.");
        }
        const user = message.mentions.members?.first();
        if (!user) return message.reply("Usage: `?removesuperadmin [@user]`");
        
        const role = message.guild?.roles.cache.find(r => r.name === utils_1.SUPER_ADMIN_ROLE_NAME);
        if (role) await user.roles.remove(role);
        message.reply(`✅ Removed Super Admin status from **${user.user.username}**.`);
    }
    else if (actualCommand === 'makeadmin') {
        if (!(0, utils_1.isSuperAdmin)(message.member)) {
            return message.reply("❌ Only Super Admins (or higher) can promote to Admin.");
        }
        const user = message.mentions.members?.first();
        if (!user) return message.reply("Usage: `?makeadmin [@user]`");

        let role = message.guild?.roles.cache.find(r => r.name === utils_1.ADMIN_ROLE_NAME);
        if (!role) {
            role = await message.guild?.roles.create({
                name: utils_1.ADMIN_ROLE_NAME,
                colors: { primaryColor: 'Red' },
                reason: 'Hierarchy: Admin can use bot admin features.'
            });
        }
        await user.roles.add(role);
        message.reply(`✅ **${user.user.username}** is now an **Admin**.`);
    }
    else if (actualCommand === 'removeadmin') {
        if (!(0, utils_1.isSuperAdmin)(message.member)) {
            return message.reply("❌ Only Super Admins (or higher) can demote Admins.");
        }
        const user = message.mentions.members?.first();
        if (!user) return message.reply("Usage: `?removeadmin [@user]`");

        // Hierarchy Protection
        if ((0, utils_1.isSuperAdmin)(user) && !(0, utils_1.isGlobalAdmin)(message.author.id)) {
             return message.reply("❌ You cannot demote another Super Admin. Only Global Admins can do that.");
        }

        const adminRole = message.guild?.roles.cache.find(r => r.name === utils_1.ADMIN_ROLE_NAME);
        const superRole = message.guild?.roles.cache.find(r => r.name === utils_1.SUPER_ADMIN_ROLE_NAME);
        
        if (adminRole) await user.roles.remove(adminRole);
        
        if ((0, utils_1.isGlobalAdmin)(message.author.id) && superRole) {
            await user.roles.remove(superRole);
        }

        message.reply(`✅ Revoked admin permissions from **${user.user.username}**.`);
    }
    else if (actualCommand === 'deleteteam') {
        const teams = await db.all('SELECT * FROM teams WHERE guild_id = ?', guildId);
        if (teams.length === 0) return message.reply("No teams found to delete.");

        const options = await Promise.all(teams.map(async t => {
            let ownerName = "Unknown Owner";
            try {
                const member = await message.guild.members.fetch(t.owner_discord_id).catch(() => null);
                if (member) ownerName = member.user.username;
            } catch (e) {}
            return {
                label: t.team_name,
                value: t.team_id.toString(),
                description: `Owner: ${ownerName}`
            };
        })).then(opts => opts.slice(0, 25));

        const row = new discord_js_1.ActionRowBuilder().addComponents(
            new discord_js_1.StringSelectMenuBuilder()
                .setCustomId('delete_team_select')
                .setPlaceholder('Select one or more teams to delete')
                .setMinValues(1)
                .setMaxValues(options.length)
                .addOptions(options)
        );

        const resp = await message.reply({ content: "Select teams to **permanently DELETE**:", components: [row] });
        try {
            const select = await awaitComponent(resp, { filter: i => i.user.id === message.author.id, time: 60000 }, "❌ Selection timed out.", "⚠️ Failed to select teams.");
            if (!select)
                return;
            await select.deferUpdate();
            const selectedTeamIds = select.values;
            const selectedTeams = teams.filter(t => selectedTeamIds.includes(t.team_id.toString()));
            const teamNames = selectedTeams.map(t => `**${t.team_name}**`).join(', ');

            if (!await (0, utils_1.askConfirmation)(message, `Are you sure you want to **DELETE** the following teams?\n${teamNames}\n\nAny players they owned will become **AVAILABLE**.`)) {
                try { await select.editReply({ content: "❌ Deletion cancelled.", components: [] }); } catch(e) {}
                return;
            }

            for (const teamId of selectedTeamIds) {
                await db.run('UPDATE auction_players SET status = "AVAILABLE", sold_to_team_id = NULL, sold_for_lakhs = NULL WHERE guild_id = ? AND sold_to_team_id = ?', guildId, teamId);
                await db.run('DELETE FROM teams WHERE guild_id = ? AND team_id = ?', guildId, teamId);
            }
            
            try {
                await select.editReply({ content: `✅ Deleted teams: ${teamNames}. Players are now AVAILABLE.`, components: [] });
            } catch (e) {
                await message.channel.send(`✅ Deleted teams: ${teamNames}. Players are now AVAILABLE.`);
            }
        } catch (e) { 
            if (!message.replied) console.error(e); 
        }
    }
    else if (actualCommand === 'teamrole') {
        const role = message.mentions.roles.first();
        if (!role)
            return message.reply("Usage: ?atr [TeamName/@Owner/Username] [@Role]");
        // Filter out role mention from arguments
        const teamIdentifierArgs = args.filter(arg => !arg.includes(role.id));
        let team;
        
        const targetUser = await resolveTargetUser(message, teamIdentifierArgs);
        if (targetUser) {
            team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND owner_discord_id = ?', guildId, targetUser.id);
        }
        else {
            const identifier = teamIdentifierArgs.join(' ').trim();
            if (/^\d{17,20}$/.test(identifier)) {
                team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND owner_discord_id = ?', guildId, identifier);
            }
            if (!team) {
                team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND team_name = ?', guildId, identifier);
            }
        }
        if (!team) {
            return message.reply("Could not find the specified team. Please provide a valid team name, @owner mention, or owner's user ID.");
        }
        if (role.mentionable || role.permissions?.bitfield !== 0n) {
            role = await role.edit({
                permissions: [],
                mentionable: false,
                reason: 'Team roles are display-only'
            }).catch(() => role);
        }
        const players = await db.all('SELECT * FROM auction_players WHERE guild_id = ? AND sold_to_team_id = ?', guildId, team.team_id);
        let successCount = 0;
        let failCount = 0;
        try {
            const ownerMember = await message.guild?.members.fetch(team.owner_discord_id);
            if (ownerMember) {
                await ownerMember.roles.add(role);
                successCount++;
            }
        }
        catch (e) {
            failCount++;
        }
        await message.reply(`Assigning role **${role.name}** to Captain <@${team.owner_discord_id}> and ${players.length} players on **${team.team_name}**...`);
        for (const player of players) {
            try {
                const member = await message.guild?.members.fetch(player.discord_id);
                if (member) {
                    await member.roles.add(role);
                    successCount++;
                }
                else {
                    failCount++;
                }
            }
            catch (e) {
                failCount++;
            }
        }
        message.channel.send(`✅ Role assigned to **${successCount}** members (including captain). Failed for **${failCount}**.`);
    }
    else if (actualCommand === 'assignstadium') {
        let targetChannel = message.mentions.channels.first() || null;
        let teamIdentifier = args.filter(arg => !targetChannel || !arg.includes(targetChannel.id)).join(' ').trim();
        let team = null;
        if (teamIdentifier) {
            team = await findTeamByIdentifier(guildId, teamIdentifier);
            if (!team) {
                return message.reply(`Could not find a team from **${teamIdentifier}**.`);
            }
        }
        if (!team) {
            const teams = await db.all('SELECT * FROM teams WHERE guild_id = ? ORDER BY team_name COLLATE NOCASE ASC', guildId);
            if (teams.length === 0) {
                return message.reply("No teams found in this server.");
            }
            const captainRows = await db.all('SELECT team_id, captain_discord_id FROM team_captains WHERE guild_id = ?', guildId);
            const captainMap = new Map(captainRows.map(row => [row.team_id, row.captain_discord_id]));
            const options = [];
            for (const currentTeam of teams.slice(0, 25)) {
                let captainLabel = 'No captain';
                const captainId = captainMap.get(currentTeam.team_id) || currentTeam.owner_discord_id || null;
                if (captainId) {
                    const captainUser = await message.client.users.fetch(captainId).catch(() => null);
                    if (captainUser) {
                        captainLabel = captainUser.username;
                    }
                }
                options.push({
                    label: currentTeam.team_name.slice(0, 100),
                    description: `Captain: ${captainLabel}`.slice(0, 100),
                    value: String(currentTeam.team_id)
                });
            }
            const teamRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
                .setCustomId(`assignstadium_team_${message.id}`)
                .setPlaceholder('Select Team / Captain')
                .addOptions(options));
            const teamPickerMessage = await message.reply({ content: "Select the **Team/Captain** whose stadium you want to assign:", components: [teamRow] });
            const teamInteraction = await awaitComponent(teamPickerMessage, { filter: i => i.user.id === message.author.id, time: 60000 }, "❌ Team selection timed out.", "⚠️ Failed to select a team.");
            if (!teamInteraction)
                return;
            await teamInteraction.deferUpdate();
            team = teams.find(currentTeam => String(currentTeam.team_id) === teamInteraction.values[0]) || null;
            if (!team) {
                return await teamInteraction.editReply({ content: "Could not find the selected team anymore.", components: [] }).catch(() => null);
            }
            teamIdentifier = team.team_name;
            await teamInteraction.editReply({ content: `Selected team: **${team.team_name}**.`, components: [] }).catch(() => null);
        }
        if (!targetChannel) {
            const categories = message.guild.channels.cache
                .filter(c => c.type === discord_js_1.ChannelType.GuildCategory)
                .map(c => ({ label: c.name, value: c.id }))
                .slice(0, 25);
            if (categories.length === 0) {
                return message.reply("No categories found in this server.");
            }
            const catRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
                .setCustomId(`assignstadium_cat_${message.id}`)
                .setPlaceholder('Select Stadium Category')
                .addOptions(categories));
            const pickerMessage = await message.reply({ content: `Select a **Category** for **${team.team_name}**'s stadium:`, components: [catRow] });
            const catInteraction = await awaitComponent(pickerMessage, { filter: i => i.user.id === message.author.id, time: 60000 }, "❌ Category selection timed out.", "⚠️ Failed to select a category.");
            if (!catInteraction)
                return;
            await catInteraction.deferUpdate();
            const categoryId = catInteraction.values[0];
            const channels = message.guild.channels.cache
                .filter(ch => ch.parentId === categoryId && ch.type === discord_js_1.ChannelType.GuildText)
                .map(ch => ({ label: ch.name, value: ch.id }))
                .slice(0, 25);
            if (channels.length === 0) {
                return await catInteraction.editReply({ content: "No text channels found in that category.", components: [] }).catch(() => null);
            }
            const chanRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
                .setCustomId(`assignstadium_chan_${message.id}`)
                .setPlaceholder('Select Stadium Channel')
                .addOptions(channels));
            await catInteraction.editReply({ content: `Select the **Stadium** channel for **${team.team_name}**:`, components: [chanRow] }).catch(() => null);
            const chanInteraction = await awaitComponent(pickerMessage, { filter: i => i.user.id === message.author.id, time: 60000 }, "❌ Stadium selection timed out.", "⚠️ Failed to select a stadium channel.");
            if (!chanInteraction)
                return;
            await chanInteraction.deferUpdate();
            targetChannel = await message.guild.channels.fetch(chanInteraction.values[0]).catch(() => null);
            if (!targetChannel || targetChannel.type !== discord_js_1.ChannelType.GuildText) {
                return await chanInteraction.editReply({ content: "Could not use that stadium channel. Please try again.", components: [] }).catch(() => null);
            }
            await chanInteraction.editReply({ content: `Selected stadium: ${targetChannel}`, components: [] }).catch(() => null);
        }
        if (targetChannel.type !== discord_js_1.ChannelType.GuildText) {
            return message.reply("Please choose an existing text channel as the stadium.");
        }
        const currentRow = await db.get('SELECT channel_id FROM team_stadiums WHERE guild_id = ? AND team_id = ?', guildId, team.team_id);
        if (currentRow?.channel_id === targetChannel.id) {
            return message.reply(`**${team.team_name}** is already assigned to ${targetChannel}.`);
        }
        await db.run(`DELETE FROM team_stadiums
            WHERE guild_id = ?
              AND team_id NOT IN (SELECT team_id FROM teams WHERE guild_id = ?)`, guildId, guildId);
        const targetOwner = await db.get(`SELECT ts.team_id, t.team_name
            FROM team_stadiums ts
            JOIN teams t ON t.team_id = ts.team_id AND t.guild_id = ts.guild_id
            WHERE ts.guild_id = ? AND ts.channel_id = ? AND ts.team_id != ?`, guildId, targetChannel.id, team.team_id);
        let deleteOldStadium = true;
        let unusedCategoryId = null;
        let unusedCategoryName = null;
        if (currentRow?.channel_id && currentRow.channel_id !== targetChannel.id) {
            const cleanupRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
                .setCustomId(`assignstadium_old_cleanup_${message.id}`)
                .setPlaceholder('What should happen to the old stadium?')
                .addOptions([
                { label: 'Delete Old Stadium', value: 'delete', description: 'Delete the team\'s old stadium channel.' },
                { label: 'Keep As Unused', value: 'keep', description: 'Keep it unassigned and move it to another category.' }
            ]));
            const cleanupMessage = await message.reply({ content: `**${team.team_name}** already has <#${currentRow.channel_id}>.\nChoose what to do with the old stadium:`, components: [cleanupRow] });
            const cleanupInteraction = await awaitComponent(cleanupMessage, { filter: i => i.user.id === message.author.id, time: 60000 }, "❌ Stadium cleanup selection timed out.", "⚠️ Failed to choose what to do with the old stadium.");
            if (!cleanupInteraction)
                return;
            await cleanupInteraction.deferUpdate();
            deleteOldStadium = cleanupInteraction.values[0] !== 'keep';
            if (!deleteOldStadium) {
                const categories = message.guild.channels.cache
                    .filter(c => c.type === discord_js_1.ChannelType.GuildCategory)
                    .map(c => ({ label: c.name, value: c.id }))
                    .slice(0, 25);
                if (categories.length === 0) {
                    return await cleanupInteraction.editReply({ content: "No categories found to move the unused stadium into.", components: [] }).catch(() => null);
                }
                const unusedCategoryRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
                    .setCustomId(`assignstadium_unused_cat_${message.id}`)
                    .setPlaceholder('Select category for unused stadium')
                    .addOptions(categories));
                await cleanupInteraction.editReply({ content: `Select the category where unused stadium <#${currentRow.channel_id}> should go:`, components: [unusedCategoryRow] }).catch(() => null);
                const unusedCategoryInteraction = await awaitComponent(cleanupMessage, { filter: i => i.user.id === message.author.id, time: 60000 }, "❌ Unused stadium category selection timed out.", "⚠️ Failed to choose the unused stadium category.");
                if (!unusedCategoryInteraction)
                    return;
                await unusedCategoryInteraction.deferUpdate();
                unusedCategoryId = unusedCategoryInteraction.values[0];
                unusedCategoryName = message.guild.channels.cache.get(unusedCategoryId)?.name || null;
                await unusedCategoryInteraction.editReply({ content: `Unused stadium will be moved to **${unusedCategoryName || 'the selected category'}**.`, components: [] }).catch(() => null);
            }
            else {
                await cleanupInteraction.editReply({ content: "Old stadium will be deleted after reassignment.", components: [] }).catch(() => null);
            }
        }
        const confirmLines = [`Assign ${targetChannel} as the stadium for **${team.team_name}**?`];
        if (targetOwner?.team_name) {
            confirmLines.push(`**${targetOwner.team_name}** currently owns this stadium and will be left without a stadium.`);
        }
        if (currentRow?.channel_id && currentRow.channel_id !== targetChannel.id) {
            if (deleteOldStadium) {
                confirmLines.push(`Old stadium <#${currentRow.channel_id}> will be deleted.`);
            }
            else {
                confirmLines.push(`Old stadium <#${currentRow.channel_id}> will be kept unassigned and moved to **${unusedCategoryName || 'the selected category'}**.`);
            }
        }
        if (!await (0, utils_1.askConfirmation)(message, confirmLines.join('\n'))) {
            return message.reply("Action cancelled.");
        }
        const result = await assignExistingStadiumToTeam(message.guild, guildId, team, targetChannel.id, {
            deleteOldChannel: deleteOldStadium,
            unusedCategoryId
        });
        if (!result.ok) {
            return message.reply("Could not assign that stadium channel. Make sure it is an existing text channel in this server.");
        }
        const lines = [
            `Done: Stadium updated for **${team.team_name}**.`,
            `New stadium: ${result.targetChannel}`,
            `Future home fixtures updated: **${result.updatedFixtures}**`,
            `Active home reservations updated: **${result.updatedReservations}**`
        ];
        lines[0] = `✅ Stadium updated for **${team.team_name}**.`;
        if (result.previousOwnerTeamName) {
            lines.push(`Previous owner **${result.previousOwnerTeamName}** is now without a stadium.`);
            lines.push(`Previous owner home fixtures cleared: **${result.previousOwnerFixturesCleared}**`);
            lines.push(`Previous owner active reservations cleared: **${result.previousOwnerReservationsCleared}**`);
        }
        if (result.oldChannelId && result.oldChannelId !== result.targetChannel.id) {
            lines.push(`Previous stadium: <#${result.oldChannelId}>`);
            if (result.deletedOldChannel) {
                lines.push('Old stadium channel deleted.');
            }
            else if (result.oldChannelDeleteFailed) {
                lines.push('Old stadium channel could not be deleted automatically. Check bot permissions.');
            }
            else if (result.oldChannelUnassigned) {
                lines.push('Old stadium channel kept as unused and unassigned.');
                if (result.oldChannelMoved) {
                    lines.push(`Unused stadium moved to **${unusedCategoryName || 'the selected category'}**.`);
                }
                else if (result.oldChannelMoveFailed) {
                    lines.push('Unused stadium could not be moved to the selected category automatically.');
                }
            }
        }
        return message.reply(lines.join('\n'));
    }
    else if (actualCommand === 'forceteamrename') {
        const rawInput = args.join(' ').trim();
        let team = null;
        let requestedTeamName = '';
        let requestedAlias = '';
        let requestedStadiumName = '';
        if (!rawInput) {
            const teams = await db.all('SELECT * FROM teams WHERE guild_id = ? ORDER BY team_name COLLATE NOCASE ASC', guildId);
            if (teams.length === 0) {
                return message.reply("No teams found in this server.");
            }
            const { aliasByName } = await getTeamAliasMaps(guildId);
            const captainRows = await db.all('SELECT team_id, captain_discord_id FROM team_captains WHERE guild_id = ?', guildId);
            const captainMap = new Map(captainRows.map(row => [row.team_id, row.captain_discord_id]));
            const options = [];
            for (const currentTeam of teams.slice(0, 25)) {
                const currentAlias = aliasByName.get(currentTeam.team_name.toLowerCase()) || '—';
                const captainId = captainMap.get(currentTeam.team_id) || currentTeam.owner_discord_id || null;
                let captainLabel = 'No captain';
                if (captainId) {
                    const captainUser = await message.client.users.fetch(captainId).catch(() => null);
                    if (captainUser) {
                        captainLabel = captainUser.username;
                    }
                }
                options.push({
                    label: `${currentTeam.team_name} [${currentAlias}]`.slice(0, 100),
                    description: `Captain: ${captainLabel}`.slice(0, 100),
                    value: String(currentTeam.team_id)
                });
            }
            const teamRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
                .setCustomId(`forceteamrename_team_${message.id}`)
                .setPlaceholder('Select Team • ABB • Captain')
                .addOptions(options));
            const teamPickerMessage = await message.reply({ content: "Select the team you want to rename:", components: [teamRow] });
            const teamInteraction = await awaitComponent(teamPickerMessage, { filter: i => i.user.id === message.author.id, time: 60000 }, "❌ Team selection timed out.", "⚠️ Failed to select a team.");
            if (!teamInteraction)
                return;
            await teamInteraction.deferUpdate();
            team = teams.find(currentTeam => String(currentTeam.team_id) === teamInteraction.values[0]) || null;
            if (!team) {
                return await teamInteraction.editReply({ content: "Could not find the selected team anymore.", components: [] }).catch(() => null);
            }
            const currentAlias = aliasByName.get(team.team_name.toLowerCase()) || '—';
            await teamInteraction.editReply({ content: `Selected **${team.team_name}** (\`${currentAlias}\`).\nNow type: \`New Team Name | ABB | optional-stadium-name\``, components: [] }).catch(() => null);
            const renameCollect = await message.channel.awaitMessages({ filter: m => m.author.id === message.author.id, max: 1, time: 120000 });
            const renameInput = renameCollect.first()?.content?.trim() || '';
            const typedParts = renameInput.split('|').map(part => part.trim()).filter(Boolean);
            if (typedParts.length < 2) {
                return message.reply("Usage: `New Team Name | ABB | optional-stadium-name`");
            }
            [requestedTeamName, requestedAlias, requestedStadiumName] = typedParts;
        }
        else {
            const parts = rawInput.split('|').map(part => part.trim()).filter(Boolean);
            if (parts.length < 3) {
                return message.reply("Usage: `?forceteamrename [Team/@Role/@Captain] | [New Team Name] | [ALIAS] | [new-stadium-name optional]`");
            }
            const [teamIdentifier, nextTeamName, nextAlias, nextStadiumName] = parts;
            team = await findTeamByIdentifier(guildId, teamIdentifier);
            if (!team) {
                return message.reply(`Could not find a team from **${teamIdentifier}**.`);
            }
            requestedTeamName = nextTeamName;
            requestedAlias = nextAlias;
            requestedStadiumName = nextStadiumName || '';
        }
        const newTeamName = requestedTeamName.replace(/\s+/g, ' ').trim();
        if (!newTeamName) {
            return message.reply("Team name cannot be blank.");
        }
        const existingNameRow = await db.get('SELECT team_id FROM teams WHERE guild_id = ? AND LOWER(team_name) = ? AND team_id != ?', guildId, newTeamName.toLowerCase(), team.team_id);
        if (existingNameRow) {
            return message.reply("Another team already uses that name. Choose something unique.");
        }
        const alias = normalizeAlias(requestedAlias, newTeamName);
        const aliasRow = await db.get('SELECT full_name FROM pt_team_aliases WHERE guild_id = ? AND alias = ?', guildId, alias);
        if (aliasRow && aliasRow.full_name !== team.team_name) {
            return message.reply(`Abbreviation **${alias}** is already tied to **${aliasRow.full_name}**.`);
        }
        if (requestedStadiumName && !sanitizeChannelNameInput(requestedStadiumName)) {
            return message.reply("Stadium name is invalid. Use letters, numbers, spaces, or dashes.");
        }
        const stadiumRow = await db.get('SELECT channel_id FROM team_stadiums WHERE guild_id = ? AND team_id = ?', guildId, team.team_id);
        if (!await (0, utils_1.askConfirmation)(message, `Rename **${team.team_name}** to **${newTeamName}** with alias **${alias}**${requestedStadiumName ? ` and rename its stadium to **${requestedStadiumName}**` : ''}?`)) {
            return message.reply("Action cancelled.");
        }
        await db.run('DELETE FROM pt_team_aliases WHERE guild_id = ? AND full_name = ?', guildId, team.team_name);
        await db.run('UPDATE teams SET team_name = ? WHERE guild_id = ? AND team_id = ?', newTeamName, guildId, team.team_id);
        await db.run('INSERT INTO pt_team_aliases (guild_id, full_name, alias) VALUES (?, ?, ?) ON CONFLICT(guild_id, alias) DO UPDATE SET full_name = excluded.full_name', guildId, newTeamName, alias);
        let roleRenamed = false;
        if (team.role_id) {
            const role = await message.guild.roles.fetch(team.role_id).catch(() => null);
            if (role) {
                await role.edit({ name: newTeamName }).then(() => {
                    roleRenamed = true;
                }).catch(() => null);
            }
        }
        let stadiumRenameStatus = null;
        if (requestedStadiumName) {
            if (!stadiumRow?.channel_id) {
                stadiumRenameStatus = { ok: false, reason: 'missing_link' };
            }
            else {
                stadiumRenameStatus = await forceRenameStadiumChannel(message.guild, stadiumRow.channel_id, requestedStadiumName);
            }
        }
        const lines = [
            `✅ Team renamed from **${team.team_name}** to **${newTeamName}**.`,
            `Alias set to **${alias}**.`
        ];
        if (team.role_id) {
            lines.push(roleRenamed ? 'Team role renamed too.' : 'Team role could not be renamed automatically.');
        }
        if (requestedStadiumName) {
            if (stadiumRenameStatus?.ok) {
                lines.push(`Stadium renamed to **#${stadiumRenameStatus.newName}**.`);
            }
            else if (stadiumRenameStatus?.reason === 'missing_link') {
                lines.push('No linked stadium was found for that team, so only the team name was changed.');
            }
            else {
                lines.push('Stadium name could not be updated. Use letters, numbers, spaces, or dashes.');
            }
        }
        return message.reply(lines.join('\n'));
    }
    else if (actualCommand === 'teamnamefromrole') {
        const rawInput = args.join(' ').trim();
        let team = null;
        if (!rawInput) {
            const teams = await db.all('SELECT * FROM teams WHERE guild_id = ? ORDER BY team_name COLLATE NOCASE ASC', guildId);
            if (teams.length === 0) {
                return message.reply("No teams found in this server.");
            }
            const { aliasByName } = await getTeamAliasMaps(guildId);
            const captainRows = await db.all('SELECT team_id, captain_discord_id FROM team_captains WHERE guild_id = ?', guildId);
            const captainMap = new Map(captainRows.map(row => [row.team_id, row.captain_discord_id]));
            const options = [];
            for (const currentTeam of teams.slice(0, 25)) {
                const currentAlias = aliasByName.get(currentTeam.team_name.toLowerCase()) || '—';
                const captainId = captainMap.get(currentTeam.team_id) || currentTeam.owner_discord_id || null;
                let captainLabel = 'No captain';
                if (captainId) {
                    const captainUser = await message.client.users.fetch(captainId).catch(() => null);
                    if (captainUser) {
                        captainLabel = captainUser.username;
                    }
                }
                options.push({
                    label: `${currentTeam.team_name} [${currentAlias}]`.slice(0, 100),
                    description: `Captain: ${captainLabel}`.slice(0, 100),
                    value: String(currentTeam.team_id)
                });
            }
            const teamRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
                .setCustomId(`teamnamefromrole_team_${message.id}`)
                .setPlaceholder('Select Team • ABB • Captain')
                .addOptions(options));
            const teamPickerMessage = await message.reply({ content: "Select the team to sync from its role name:", components: [teamRow] });
            const teamInteraction = await awaitComponent(teamPickerMessage, { filter: i => i.user.id === message.author.id, time: 60000 }, "❌ Team selection timed out.", "⚠️ Failed to select a team.");
            if (!teamInteraction)
                return;
            await teamInteraction.deferUpdate();
            team = teams.find(currentTeam => String(currentTeam.team_id) === teamInteraction.values[0]) || null;
            if (!team) {
                return await teamInteraction.editReply({ content: "Could not find the selected team anymore.", components: [] }).catch(() => null);
            }
            await teamInteraction.editReply({ content: `Selected **${team.team_name}**. Syncing from its linked role next.`, components: [] }).catch(() => null);
        }
        else {
            team = await findTeamByIdentifier(guildId, rawInput);
            if (!team) {
                return message.reply(`Could not find a team from **${rawInput}**.`);
            }
        }
        if (!team.role_id) {
            return message.reply(`**${team.team_name}** does not have a linked team role.`);
        }
        const role = await message.guild.roles.fetch(team.role_id).catch(() => null);
        if (!role) {
            return message.reply(`The linked role for **${team.team_name}** no longer exists.`);
        }
        const newTeamName = role.name.trim();
        if (!newTeamName) {
            return message.reply("The linked role does not have a valid name.");
        }
        const autoAlias = buildAutoThreeLetterAlias(newTeamName);
        const existingNameRow = await db.get('SELECT team_id FROM teams WHERE guild_id = ? AND LOWER(team_name) = ? AND team_id != ?', guildId, newTeamName.toLowerCase(), team.team_id);
        if (existingNameRow) {
            return message.reply(`Another team already uses the role name **${newTeamName}**.`);
        }
        const aliasRow = await db.get('SELECT full_name FROM pt_team_aliases WHERE guild_id = ? AND alias = ?', guildId, autoAlias);
        if (aliasRow && aliasRow.full_name !== team.team_name) {
            return message.reply(`Auto abbreviation **${autoAlias}** is already tied to **${aliasRow.full_name}**.`);
        }
        if (!await (0, utils_1.askConfirmation)(message, `Rename **${team.team_name}** to linked role name **${newTeamName}** and set auto abbreviation to **${autoAlias}**?`)) {
            return message.reply("Action cancelled.");
        }
        await db.run('DELETE FROM pt_team_aliases WHERE guild_id = ? AND full_name = ?', guildId, team.team_name);
        await db.run('UPDATE teams SET team_name = ? WHERE guild_id = ? AND team_id = ?', newTeamName, guildId, team.team_id);
        await db.run('INSERT INTO pt_team_aliases (guild_id, full_name, alias) VALUES (?, ?, ?) ON CONFLICT(guild_id, alias) DO UPDATE SET full_name = excluded.full_name', guildId, newTeamName, autoAlias);
        return message.reply(`✅ Team renamed to **${newTeamName}** from its linked role.\nAlias set to **${autoAlias}**.`);
    }
    else if (actualCommand === 'manualsell') {
        const mentions = message.mentions.users;
        if (mentions.size !== 2)
            return message.reply("Usage: ?manualsell [@Player] [@Owner] [Price]");
        const priceArg = args.find(a => !a.startsWith('<@'));
        if (!priceArg)
            return message.reply("Missing price argument.");
        const price = (0, utils_1.parseBidToLakhs)(priceArg);
        if (price === null)
            return message.reply("Invalid price format.");
        const playerUser = mentions.first();
        const ownerUser = mentions.last();
        const player = await db.get('SELECT * FROM auction_players WHERE guild_id = ? AND discord_id = ?', guildId, playerUser.id);
        if (!player)
            return message.reply(`Player **${playerUser.username}** not found.`);
        if (player.status === 'SOLD')
            return message.reply(`${player.ign} is already sold.`);
        const team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND owner_discord_id = ?', guildId, ownerUser.id);
        if (!team)
            return message.reply(`**${ownerUser.username}** does not own a team.`);
        if (team.purse_lakhs < price)
            return message.reply(`Team **${team.team_name}** has insufficient funds.`);
        const rosterCount = await db.get('SELECT COUNT(*) as count FROM auction_players WHERE guild_id = ? AND sold_to_team_id = ?', guildId, team.team_id);
        if (rosterCount && rosterCount.count >= team.max_roster_size)
            return message.reply(`Team **${team.team_name}**'s roster is full.`);
        await db.run('UPDATE teams SET purse_lakhs = purse_lakhs - ? WHERE guild_id = ? AND team_id = ?', price, guildId, team.team_id);
        await db.run('UPDATE auction_players SET status = "SOLD", sold_to_team_id = ?, sold_for_lakhs = ? WHERE guild_id = ? AND discord_id = ?', team.team_id, price, guildId, player.discord_id);
        await syncAuctionTeamRoleForMember(message.guild, team, player.discord_id, 'add');
        await (0, auditLog_1.appendAdminAuditLog)({
            guildId,
            actorId: message.author.id,
            commandName: 'addtoteam',
            summary: `Added ${player.ign} to ${team.team_name} for ${(0, utils_1.lakhsToDisplay)(price)}.`,
            targetSummary: `${player.ign} | ${team.team_name}`,
            channelId: message.channel.id
        });
        await (0, utils_1.sendAuctionPurchaseDm)(message.client, {
            guildName: message.guild?.name || '',
            playerDiscordId: player.discord_id,
            playerName: player.ign,
            teamName: team.team_name,
            ownerDiscordId: team.owner_discord_id,
            priceLakhs: price,
            sourceText: 'Admin Manual Sale'
        });
        message.reply(`✅ Manually sold **${player.ign}** to **${team.team_name}** for **${(0, utils_1.lakhsToDisplay)(price)}**.`);
    }
    else if (actualCommand === 'addtoteam') {
        const playerUser = await resolveTargetUser(message, args);
        if (!playerUser)
            return message.reply("Usage: ?addtoteam [@Player/Username] [TeamName/@Owner/Username] [Price (Optional)]");
        
        // Remove the player identifier from args to find team and price
        const otherArgs = args.filter(arg => !arg.includes(playerUser.id) && arg.toLowerCase() !== playerUser.username.toLowerCase());
        
        let price = 0;
        let teamIdentifier = "";
        const lastArg = otherArgs[otherArgs.length - 1];
        const parsedPrice = (0, utils_1.parseBidToLakhs)(lastArg);
        if (parsedPrice !== null) {
            price = parsedPrice;
            teamIdentifier = otherArgs.slice(0, -1).join(' ');
        }
        else {
            teamIdentifier = otherArgs.join(' ');
        }
        if (!teamIdentifier)
            return message.reply("Please specify a team.");
        
        const player = await db.get('SELECT * FROM auction_players WHERE guild_id = ? AND discord_id = ?', guildId, playerUser.id);
        if (!player)
            return message.reply(`Player **${playerUser.username}** not found.`);
        if (player.status === 'SOLD')
            return message.reply(`${player.ign} is already sold.`);
        
        let team;
        const ownerMatch = teamIdentifier.match(/<@!?(\d+)>/);
        if (ownerMatch) {
            team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND owner_discord_id = ?', guildId, ownerMatch[1]);
        }
        else {
            team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND team_name = ?', guildId, teamIdentifier);
            if (!team) {
                // Try resolving as owner username
                const ownerUser = await resolveTargetUser(message, teamIdentifier.split(' '));
                if (ownerUser) {
                    team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND owner_discord_id = ?', guildId, ownerUser.id);
                }
            }
        }
        
        if (!team)
            return message.reply(`Team "${teamIdentifier}" not found.`);
        if (team.purse_lakhs < price)
            return message.reply(`Team **${team.team_name}** has insufficient funds (Needs ${(0, utils_1.lakhsToDisplay)(price)}, has ${(0, utils_1.lakhsToDisplay)(team.purse_lakhs)}).`);
        const rosterCount = await db.get('SELECT COUNT(*) as count FROM auction_players WHERE guild_id = ? AND sold_to_team_id = ?', guildId, team.team_id);
        if (rosterCount && rosterCount.count >= team.max_roster_size)
            return message.reply(`Team **${team.team_name}**'s roster is full.`);
        await db.run('UPDATE teams SET purse_lakhs = purse_lakhs - ? WHERE guild_id = ? AND team_id = ?', price, guildId, team.team_id);
        await db.run('UPDATE auction_players SET status = "SOLD", sold_to_team_id = ?, sold_for_lakhs = ? WHERE guild_id = ? AND discord_id = ?', team.team_id, price, guildId, player.discord_id);
        await syncAuctionTeamRoleForMember(message.guild, team, player.discord_id, 'add');
        message.reply(`✅ Added **${player.ign}** to **${team.team_name}** for **${(0, utils_1.lakhsToDisplay)(price)}**.`);
        await (0, utils_1.sendAuctionPurchaseDm)(message.client, {
            guildName: message.guild?.name || '',
            playerDiscordId: player.discord_id,
            playerName: player.ign,
            teamName: team.team_name,
            ownerDiscordId: team.owner_discord_id,
            priceLakhs: price,
            sourceText: 'Admin Team Assignment'
        });
    }
    else if (actualCommand === 'addusertoteam') {
        const targetMember = message.mentions.members.first() || (args[0] ? await message.guild.members.fetch(args[0]).catch(() => null) : null);
        if (!targetMember)
            return message.reply("Usage: `?addusertoteam @User [TeamName/@TeamRole/@Captain]`");
        const teamIdentifierArgs = args.filter(arg => !arg.includes(targetMember.id));
        const teamIdentifier = teamIdentifierArgs.join(' ').trim();
        if (!teamIdentifier)
            return message.reply("Please specify a non-auction team.");
        const team = await findNonAuctionTeamByIdentifier(guildId, teamIdentifier);
        if (!team)
            return message.reply(`Non-auction team "${teamIdentifier}" not found.`);
        if (!team.role_id)
            return message.reply(`**${team.team_name}** does not have a team role configured yet.`);
        const teamRole = await message.guild.roles.fetch(team.role_id).catch(() => null);
        if (!teamRole)
            return message.reply(`The team role for **${team.team_name}** no longer exists.`);
        if (targetMember.user.bot)
            return message.reply("Bots cannot be added to teams.");
        if (targetMember.roles.cache.has(teamRole.id))
            return message.reply(`${targetMember.user.tag} is already on **${team.team_name}**.`);
        const existingMembership = await findExistingCommunityTeamMembership(guildId, targetMember.id, [...targetMember.roles.cache.keys()], team.team_id);
        if (existingMembership)
            return message.reply(`<@${targetMember.id}> is already linked to **${existingMembership.team.team_name}**.`);
        const assignmentBlock = await getJoinRequestRoleAssignmentBlock(message.guild, targetMember, teamRole);
        if (assignmentBlock)
            return message.reply(`Cannot add ${targetMember.user.tag} to **${team.team_name}**. ${assignmentBlock}`);
        try {
            await targetMember.roles.add(teamRole);
        }
        catch (err) {
            return message.reply(`Could not add ${targetMember.user.tag} to **${team.team_name}**: ${err.message}`);
        }
        await db.run(`UPDATE team_join_requests
            SET status = "APPROVED", responder_id = ?, responded_at = ?
            WHERE guild_id = ? AND team_id = ? AND requester_id = ? AND status = "PENDING"`, message.author.id, Date.now(), guildId, team.team_id, targetMember.id);
        await sendCommunityRosterAuditLog(message.guild, message.author.id, targetMember, team, 'ADD');
        targetMember.send(`An admin added you to **${team.team_name}** in **${message.guild.name}**.`).catch(() => { });
        await (0, auditLog_1.appendAdminAuditLog)({
            guildId,
            actorId: message.author.id,
            commandName: 'addusertoteam',
            summary: `Added ${targetMember.user.tag} to ${team.team_name}.`,
            targetSummary: `${targetMember.id} | ${team.team_name}`,
            channelId: message.channel.id
        });
        return message.reply(`Added ${targetMember.user.tag} to **${team.team_name}**.`);
    }
    else if (actualCommand === 'removefromteam') {
        const mentionedMember = message.mentions.members.first() || (args[0] ? await message.guild.members.fetch(args[0]).catch(() => null) : null);
        if (mentionedMember) {
            const teamIdentifier = args.filter(arg => !arg.includes(mentionedMember.id)).join(' ').trim();
            if (!teamIdentifier)
                return message.reply("Usage: `?removefromteam @User [TeamName/@TeamRole/@Captain]`");
            const team = await findNonAuctionTeamByIdentifier(guildId, teamIdentifier);
            if (!team)
                return message.reply(`Non-auction team "${teamIdentifier}" not found.`);
            if (!team.role_id)
                return message.reply(`**${team.team_name}** does not have a team role configured yet.`);
            const teamRole = await message.guild.roles.fetch(team.role_id).catch(() => null);
            if (!teamRole)
                return message.reply(`The team role for **${team.team_name}** no longer exists.`);
            const captainRow = await db.get('SELECT captain_discord_id FROM team_captains WHERE guild_id = ? AND team_id = ?', guildId, team.team_id);
            if (mentionedMember.id === team.owner_discord_id || mentionedMember.id === captainRow?.captain_discord_id)
                return message.reply("Use the owner/captain transfer flow instead of kicking the owner or captain.");
            if (!mentionedMember.roles.cache.has(teamRole.id))
                return message.reply(`${mentionedMember.user.tag} is not on **${team.team_name}**.`);
            const removed = await mentionedMember.roles.remove(teamRole).then(() => true).catch(() => false);
            if (!removed)
                return message.reply(`I couldn't remove ${mentionedMember.user.tag} from **${team.team_name}**. Check my role permissions.`);
            await db.run('DELETE FROM team_vice_captains WHERE guild_id = ? AND team_id = ? AND vice_captain_discord_id = ?', guildId, team.team_id, mentionedMember.id);
            await sendCommunityRosterAuditLog(message.guild, message.author.id, mentionedMember, team, 'KICK', 'Removed by admin');
            mentionedMember.send(`An admin removed you from **${team.team_name}** in **${message.guild.name}**.`).catch(() => { });
            await (0, auditLog_1.appendAdminAuditLog)({
                guildId,
                actorId: message.author.id,
                commandName: 'removefromteam',
                summary: `Removed ${mentionedMember.user.tag} from ${team.team_name}.`,
                targetSummary: `${mentionedMember.id} | ${team.team_name}`,
                channelId: message.channel.id
            });
            return message.reply(`Removed ${mentionedMember.user.tag} from **${team.team_name}**.`);
        }
        const teams = await db.all('SELECT * FROM teams WHERE guild_id = ? AND purse_lakhs = -1 AND role_id IS NOT NULL ORDER BY team_name COLLATE NOCASE ASC', guildId);
        if (teams.length === 0)
            return message.reply("No non-auction teams with roles were found.");
        const ptConfig = await getPtConfig(guildId);
        const seasonLabel = await statsSystem.getActiveSeason(guildId) || `S${ptConfig.current_season || 1}`;
        const groupRows = await db.all('SELECT team_id, group_letter FROM team_groups WHERE guild_id = ? AND season_name = ?', guildId, seasonLabel);
        const groupMap = new Map(groupRows.map(row => [row.team_id, (row.group_letter || 'UNASSIGNED').toUpperCase()]));
        const groupedTeams = new Map();
        const formatType = ptConfig.format_type || 'LEAGUE';
        teams.forEach(team => {
            const key = formatType === 'GROUPS' ? (groupMap.get(team.team_id) || 'UNASSIGNED') : 'LEAGUE';
            if (!groupedTeams.has(key))
                groupedTeams.set(key, []);
            groupedTeams.get(key).push(team);
        });
        let filteredTeams = teams;
        let prompt = null;
        if (formatType === 'GROUPS') {
            const groupKeys = [...groupedTeams.keys()].filter(key => (groupedTeams.get(key) || []).length > 0).sort();
            if (groupKeys.length > 1) {
                const groupOptions = groupKeys.map(key => ({
                    label: key === 'UNASSIGNED' ? 'Unassigned' : `Group ${key}`,
                    description: `${(groupedTeams.get(key) || []).length} team${(groupedTeams.get(key) || []).length === 1 ? '' : 's'}`,
                    value: key
                })).slice(0, 25);
                const groupRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
                    .setCustomId('admin_remove_team_group_select')
                    .setPlaceholder('Select group')
                    .setMinValues(1)
                    .setMaxValues(1)
                    .addOptions(groupOptions));
                prompt = await message.reply({ content: 'Select the group first.', components: [groupRow] });
                const groupSelection = await awaitComponent(prompt, { filter: i => i.user.id === message.author.id && i.customId === 'admin_remove_team_group_select', time: 60000 }, "❌ Group selection timed out.", "⚠️ Failed to select a group.");
                if (!groupSelection)
                    return;
                const selectedGroup = groupSelection.values[0];
                filteredTeams = groupedTeams.get(selectedGroup) || [];
                await groupSelection.update({ content: `Selected **${selectedGroup === 'UNASSIGNED' ? 'Unassigned' : `Group ${selectedGroup}`}**. Now choose the team.`, components: [] }).catch(() => null);
            }
        }
        if (!filteredTeams.length)
            return message.reply("No teams were found for that selection.");
        const teamOptions = filteredTeams.slice(0, 25).map(team => ({
            label: team.team_name.length > 100 ? `${team.team_name.slice(0, 97)}...` : team.team_name,
            description: team.role_id ? `Role linked` : 'No role linked',
            value: String(team.team_id)
        }));
        const teamRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
            .setCustomId('admin_remove_team_select')
            .setPlaceholder('Select team')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(teamOptions));
        const teamPrompt = await message.reply({ content: 'Select the team to manage.', components: [teamRow] });
        const teamSelection = await awaitComponent(teamPrompt, { filter: i => i.user.id === message.author.id && i.customId === 'admin_remove_team_select', time: 60000 }, "❌ Team selection timed out.", "⚠️ Failed to select a team.");
        if (!teamSelection)
            return;
        const selectedTeam = filteredTeams.find(team => String(team.team_id) === teamSelection.values[0]);
        if (!selectedTeam)
            return await teamSelection.update({ content: '⚠️ Selected team was not found.', components: [] }).catch(() => null);
        const removableMembers = await getCommunityTeamMembersForSelection(message.guild, guildId, selectedTeam);
        if (!removableMembers.length)
            return await teamSelection.update({ content: `No removable players were found in **${selectedTeam.team_name}**.`, components: [] }).catch(() => null);
        const playerOptions = removableMembers.slice(0, 25).map(member => ({
            label: member.user.username.length > 100 ? `${member.user.username.slice(0, 97)}...` : member.user.username,
            description: member.displayName.length > 100 ? member.displayName.slice(0, 100) : member.displayName,
            value: member.id
        }));
        const playerRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
            .setCustomId('admin_remove_team_player_select')
            .setPlaceholder('Search and select player to kick')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(playerOptions));
        let playerText = `Selected **${selectedTeam.team_name}**. Choose the player to kick.`;
        if (removableMembers.length > 25)
            playerText += '\nShowing the first 25 removable players due to Discord menu limits.';
        await teamSelection.update({ content: playerText, components: [playerRow] }).catch(() => null);
        const playerSelection = await awaitComponent(teamPrompt, { filter: i => i.user.id === message.author.id && i.customId === 'admin_remove_team_player_select', time: 60000 }, "❌ Player selection timed out.", "⚠️ Failed to select a player.");
        if (!playerSelection)
            return;
        const selectedMember = removableMembers.find(member => member.id === playerSelection.values[0]);
        if (!selectedMember)
            return await playerSelection.update({ content: '⚠️ Selected player was not found.', components: [] }).catch(() => null);
        const selectedRole = await message.guild.roles.fetch(selectedTeam.role_id).catch(() => null);
        if (!selectedRole)
            return await playerSelection.update({ content: `⚠️ The team role for **${selectedTeam.team_name}** no longer exists.`, components: [] }).catch(() => null);
        const removed = await selectedMember.roles.remove(selectedRole).then(() => true).catch(() => false);
        if (!removed)
            return await playerSelection.update({ content: `⚠️ I couldn't remove ${selectedMember.user.tag} from **${selectedTeam.team_name}**. Check my role permissions.`, components: [] }).catch(() => null);
        await db.run('DELETE FROM team_vice_captains WHERE guild_id = ? AND team_id = ? AND vice_captain_discord_id = ?', guildId, selectedTeam.team_id, selectedMember.id);
        await sendCommunityRosterAuditLog(message.guild, message.author.id, selectedMember, selectedTeam, 'KICK', 'Removed by admin');
        selectedMember.send(`An admin removed you from **${selectedTeam.team_name}** in **${message.guild.name}**.`).catch(() => { });
        await (0, auditLog_1.appendAdminAuditLog)({
            guildId,
            actorId: message.author.id,
            commandName: 'removefromteam',
            summary: `Removed ${selectedMember.user.tag} from ${selectedTeam.team_name}.`,
            targetSummary: `${selectedMember.id} | ${selectedTeam.team_name}`,
            channelId: message.channel.id
        });
        return await playerSelection.update({ content: `Removed ${selectedMember.user.tag} from **${selectedTeam.team_name}**.`, components: [] }).catch(() => null);
    }
    else if (actualCommand === 'createteamrole') {
        const teamIdentifier = args.join(' ');
        if (!teamIdentifier)
            return message.reply("Usage: ?createteamrole [TeamName/@Owner]");
        let team;
        const ownerMatch = teamIdentifier.match(/<@!?(\d+)>/);
        if (ownerMatch) {
            team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND owner_discord_id = ?', guildId, ownerMatch[1]);
        }
        else {
            team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND team_name = ?', guildId, teamIdentifier);
        }
        if (!team)
            return message.reply("Team not found.");
        let role = message.guild?.roles.cache.find(r => r.name === team.team_name);
        if (!role) {
            try {
                role = await message.guild?.roles.create({
                    name: team.team_name,
                    colors: { primaryColor: 'Random' },
                    permissions: [],
                    mentionable: false,
                    reason: 'Team Role Creation'
                });
                message.channel.send(`✅ Created role **${role.name}**.`);
            }
            catch (e) {
                return message.reply("Failed to create role. Check permissions.");
            }
        }
        else {
            message.channel.send(`ℹ️ Role **${role.name}** already exists. Assigning...`);
        }
        const players = await db.all('SELECT * FROM auction_players WHERE guild_id = ? AND sold_to_team_id = ?', guildId, team.team_id);
        let successCount = 0;
        let failCount = 0;
        try {
            const ownerMember = await message.guild?.members.fetch(team.owner_discord_id);
            if (ownerMember) {
                await ownerMember.roles.add(role);
                successCount++;
            }
        }
        catch (e) {
            failCount++;
        }
        for (const player of players) {
            try {
                const member = await message.guild?.members.fetch(player.discord_id);
                if (member) {
                    await member.roles.add(role);
                    successCount++;
                }
            }
            catch (e) {
                failCount++;
            }
        }
        message.reply(`✅ Assigned **${role.name}** to **${successCount}** members (including captain).`);
    }
    else if (actualCommand === 'createteamchannel') {
        const teamIdentifier = args.join(' ');
        if (!teamIdentifier)
            return message.reply("Usage: ?createteamchannel [TeamName/@Owner]");
        let team;
        const ownerMatch = teamIdentifier.match(/<@!?(\d+)>/);
        if (ownerMatch) {
            team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND owner_discord_id = ?', guildId, ownerMatch[1]);
        }
        else {
            team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND team_name = ?', guildId, teamIdentifier);
        }
        if (!team)
            return message.reply("Team not found.");
        // Fetch Categories
        const categories = message.guild?.channels.cache.filter(c => c.type === discord_js_1.ChannelType.GuildCategory);
        if (!categories || categories.size === 0) {
            return message.reply("No categories found in this server. Please create one first.");
        }
        // Create Select Menu for Categories
        const selectMenu = new discord_js_1.StringSelectMenuBuilder()
            .setCustomId('category_select')
            .setPlaceholder('📂 Select a Category for the Channel')
            .addOptions(categories.map(c => new discord_js_1.StringSelectMenuOptionBuilder()
            .setLabel(c.name)
            .setValue(c.id)
            .setDescription(`ID: ${c.id}`)).slice(0, 25) // Discord limit is 25 options
        );
        const row = new discord_js_1.ActionRowBuilder().addComponents(selectMenu);
        const response = await message.reply({
            content: `Please select the category where you want to create the channel for **${team.team_name}**:`,
            components: [row]
        });
        try {
            const selection = await awaitComponent(response, {
                filter: i => i.user.id === message.author.id && i.customId === 'category_select',
                time: 30000,
                max: 1
            }, '❌ Timed out waiting for category selection.', '⚠️ Failed to create team channel.');
            if (!selection)
                return;
            await selection.deferUpdate();
            if (!selection.isStringSelectMenu())
                return;
            const categoryId = selection.values[0];
            const category = categories.get(categoryId);
            // Try to find a role with the team name
            const role = message.guild?.roles.cache.find(r => r.name === team.team_name);
            const channelName = team.team_name.toLowerCase().replace(/[^a-z0-9]/g, '-');
            try {
                const permissionOverwrites = [
                    {
                        id: message.guild.id, // @everyone
                        deny: [discord_js_1.PermissionFlagsBits.ViewChannel],
                    },
                    {
                        id: team.owner_discord_id, // Captain
                        allow: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.SendMessages],
                    }
                ];
                if (role) {
                    permissionOverwrites.push({
                        id: role.id,
                        allow: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.SendMessages],
                    });
                }
                else {
                    // If no role, add individual players
                    const players = await db.all('SELECT * FROM auction_players WHERE guild_id = ? AND sold_to_team_id = ?', guildId, team.team_id);
                    for (const p of players) {
                        permissionOverwrites.push({
                            id: p.discord_id,
                            allow: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.SendMessages],
                        });
                    }
                }
                const channel = await message.guild?.channels.create({
                    name: channelName,
                    type: discord_js_1.ChannelType.GuildText,
                    parent: categoryId,
                    permissionOverwrites: permissionOverwrites,
                    reason: `Team Channel for ${team.team_name}`
                });
                await selection.editReply({
                    content: `✅ Created private channel ${channel} for **${team.team_name}** in category **${category?.name}**. Access granted to Captain${role ? ' and Team Role' : ' and current Roster'}.`,
                    components: []
                });
            }
            catch (e) {
                console.error(e);
                await selection.editReply({ content: `Failed to create channel: ${e.message}`, components: [] });
            }
        }
        catch (e) {
            await respondComponentError(response, e, '❌ Timed out waiting for category selection.', '⚠️ Failed to create team channel.');
        }
    }
    else if (actualCommand === 'createallteamchannels') {
        const teams = await db.all('SELECT * FROM teams WHERE guild_id = ?', guildId);
        if (teams.length === 0)
            return message.reply("No teams found.");
        // Fetch Categories
        const categories = message.guild?.channels.cache.filter(c => c.type === discord_js_1.ChannelType.GuildCategory);
        if (!categories || categories.size === 0) {
            return message.reply("No categories found in this server. Please create one first.");
        }
        const selectMenu = new discord_js_1.StringSelectMenuBuilder()
            .setCustomId('category_select_all')
            .setPlaceholder('📂 Select a Category for all Team Channels')
            .addOptions(categories.map(c => new discord_js_1.StringSelectMenuOptionBuilder()
            .setLabel(c.name)
            .setValue(c.id)
            .setDescription(`ID: ${c.id}`)).slice(0, 25));
        const row = new discord_js_1.ActionRowBuilder().addComponents(selectMenu);
        const response = await message.reply({
            content: `Please select the category where you want to create channels for **ALL ${teams.length} teams**:`,
            components: [row]
        });
        try {
            const selection = await awaitComponent(response, {
                filter: i => i.user.id === message.author.id && i.customId === 'category_select_all',
                time: 30000,
                max: 1
            }, '❌ Timed out waiting for category selection.', '⚠️ Failed to start bulk channel creation.');
            if (!selection)
                return;
            await selection.deferUpdate();
            if (!selection.isStringSelectMenu())
                return;
            const categoryId = selection.values[0];
            const category = categories.get(categoryId);
            await selection.editReply({
                content: `⏳ Creating **${teams.length}** channels in **${category?.name}**...`,
                components: []
            });


            let success = 0;
            let failed = 0;
            for (const team of teams) {
                try {
                    const role = message.guild?.roles.cache.find(r => r.name === team.team_name);
                    const channelName = team.team_name.toLowerCase().replace(/[^a-z0-9]/g, '-');
                    const permissionOverwrites = [
                        {
                            id: message.guild.id, // @everyone
                            deny: [discord_js_1.PermissionFlagsBits.ViewChannel],
                        },
                        {
                            id: team.owner_discord_id, // Captain
                            allow: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.SendMessages],
                        }
                    ];
                    if (role) {
                        permissionOverwrites.push({
                            id: role.id,
                            allow: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.SendMessages],
                        });
                    }
                    else {
                        const players = await db.all('SELECT * FROM auction_players WHERE guild_id = ? AND sold_to_team_id = ?', guildId, team.team_id);
                        for (const p of players) {
                            permissionOverwrites.push({
                                id: p.discord_id,
                                allow: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.SendMessages],
                            });
                        }
                    }
                    await message.guild?.channels.create({
                        name: channelName,
                        type: discord_js_1.ChannelType.GuildText,
                        parent: categoryId,
                        permissionOverwrites: permissionOverwrites,
                        reason: `Bulk Team Channel Creation`
                    });
                    success++;
                }
                catch (e) {
                    console.error(`Failed to create channel for ${team.team_name}:`, e);
                    failed++;
                }
            }
            message.channel.send(`✅ Bulk Channel Creation Complete!\nSuccessfully created: **${success}**\nFailed: **${failed}**`);
        }
        catch (e) {
            await respondComponentError(response, e, '❌ Timed out waiting for category selection.', '⚠️ Failed to start bulk channel creation.');
        }
    }
    else if (actualCommand === 'createallteamroles') {
        const teams = await db.all('SELECT * FROM teams WHERE guild_id = ?', guildId);
        if (teams.length === 0)
            return message.reply("No teams found.");

        await message.reply(`⏳ Creating and assigning roles for **${teams.length}** teams. This may take a moment...`);

        let roleSuccess = 0;
        let roleFailed = 0;
        let totalAssigned = 0;

        for (const team of teams) {
            try {
                let role = message.guild?.roles.cache.find(r => r.name === team.team_name);
                if (!role) {
                    role = await message.guild?.roles.create({
                        name: team.team_name,
                        colors: { primaryColor: 'Random' },
                        permissions: [],
                        mentionable: false,
                        reason: 'Bulk Team Role Creation'
                    });
                    roleSuccess++;
                }

                if (role) {
                    if (role.mentionable || role.permissions?.bitfield !== 0n) {
                        role = await role.edit({
                            permissions: [],
                            mentionable: false,
                            reason: 'Team roles are display-only'
                        }).catch(() => role);
                    }
                    const players = await db.all('SELECT * FROM auction_players WHERE guild_id = ? AND sold_to_team_id = ?', guildId, team.team_id);
                    
                    // Assign to Owner
                    try {
                        const ownerMember = await message.guild?.members.fetch(team.owner_discord_id);
                        if (ownerMember && !ownerMember.roles.cache.has(role.id)) {
                            await ownerMember.roles.add(role);
                            totalAssigned++;
                        }
                    } catch (e) { }

                    // Assign to Players
                    for (const player of players) {
                        try {
                            const member = await message.guild?.members.fetch(player.discord_id);
                            if (member && !member.roles.cache.has(role.id)) {
                                await member.roles.add(role);
                                totalAssigned++;
                            }
                        } catch (e) { }
                    }
                }
            } catch (e) {
                console.error(`Failed to create/assign role for ${team.team_name}:`, e);
                roleFailed++;
            }
        }

        message.channel.send(`✅ **Bulk Role Setup Complete!**\n- New Roles Created: **${roleSuccess}**\n- Roles Failed: **${roleFailed}**\n- Total Assignments: **${totalAssigned}**`);
    }
    else if (actualCommand === 'setupauctionteams') {
        const auctionTeams = await db.all('SELECT * FROM teams WHERE guild_id = ? AND purse_lakhs >= 0 ORDER BY team_name ASC', guildId);
        if (auctionTeams.length === 0)
            return message.reply("No auction teams found.");
        const categories = message.guild?.channels.cache.filter(c => c.type === discord_js_1.ChannelType.GuildCategory);
        if (!categories || categories.size === 0)
            return message.reply("No categories found in this server. Please create one first.");
        const stadiumMenuId = `auction_setup_stadium_category_${message.id}`;
        const selectMenu = new discord_js_1.StringSelectMenuBuilder()
            .setCustomId(stadiumMenuId)
            .setPlaceholder('Select the stadium category for auction teams')
            .addOptions(categories.map(c => new discord_js_1.StringSelectMenuOptionBuilder()
            .setLabel(c.name)
            .setValue(c.id)
            .setDescription(`ID: ${c.id}`)).slice(0, 25));
        const row = new discord_js_1.ActionRowBuilder().addComponents(selectMenu);
        const response = await message.reply({
            content: `Select the category where stadiums should be created for **${auctionTeams.length}** auction teams:`,
            components: [row]
        });
        try {
            const selection = await awaitComponent(response, {
                filter: i => i.user.id === message.author.id && i.customId === stadiumMenuId,
                time: 60000,
                max: 1
            }, 'Error: Timed out waiting for category selection.', 'Warning: Failed to start auction team setup.');
            if (!selection)
                return;
            await selection.deferUpdate();
            const stadiumCategoryId = selection.values[0];
            const stadiumCategory = categories.get(stadiumCategoryId);
            const dressingMenuId = `auction_setup_room_category_${message.id}`;
            const dressingMenu = new discord_js_1.StringSelectMenuBuilder()
                .setCustomId(dressingMenuId)
                .setPlaceholder('Select the dressing-room category for auction teams')
                .addOptions(categories.map(c => new discord_js_1.StringSelectMenuOptionBuilder()
                .setLabel(c.name)
                .setValue(c.id)
                .setDescription(`ID: ${c.id}`)).slice(0, 25));
            const dressingRow = new discord_js_1.ActionRowBuilder().addComponents(dressingMenu);
            await selection.editReply({
                content: `Stadium category set to **${stadiumCategory?.name || 'selected category'}**.\nNow select the category for private team dressing rooms:`,
                components: [dressingRow]
            });
            const dressingSelection = await awaitComponent(response, {
                filter: i => i.user.id === message.author.id && i.customId === dressingMenuId,
                time: 60000,
                max: 1
            }, 'Error: Timed out waiting for dressing-room category selection.', 'Warning: Failed to continue auction team setup.');
            if (!dressingSelection)
                return;
            await dressingSelection.deferUpdate();
            const dressingCategoryId = dressingSelection.values[0];
            const dressingCategory = categories.get(dressingCategoryId);
            await dressingSelection.editReply({
                content: `Running post-auction setup for **${auctionTeams.length}** teams.\nStadiums: **${stadiumCategory?.name || 'selected'}**\nDressing rooms: **${dressingCategory?.name || 'selected'}**`,
                components: []
            });
            let createdRoles = 0;
            let assignedRoles = 0;
            let roleFailures = 0;
            let createdStadiums = 0;
            let movedStadiums = 0;
            let createdRooms = 0;
            let movedRooms = 0;
            let promptCount = 0;
            const failures = [];
            for (const team of auctionTeams) {
                try {
                    const roleResult = await ensureAuctionSetupRole(message.guild, guildId, team);
                    if (roleResult.created)
                        createdRoles++;
                    const assignResult = await assignAuctionSetupRoleMembers(message.guild, guildId, team, roleResult.role);
                    assignedRoles += assignResult.assigned;
                    roleFailures += assignResult.failed;
                    const stadiumResult = await ensureAuctionSetupStadium(message.guild, guildId, team, roleResult.role, stadiumCategoryId);
                    if (stadiumResult.created)
                        createdStadiums++;
                    if (stadiumResult.moved)
                        movedStadiums++;
                    const roomResult = await ensureAuctionSetupDressingRoom(message.guild, guildId, team, roleResult.role, dressingCategoryId);
                    if (roomResult.created)
                        createdRooms++;
                    if (roomResult.moved)
                        movedRooms++;
                    if (/^\d{15,21}$/.test(String(team.owner_discord_id || ''))) {
                        await promptCaptainForInitialStadiumName(message.guild, team, team.owner_discord_id, stadiumResult.channel?.id);
                        promptCount++;
                    }
                }
                catch (err) {
                    failures.push(`**${team.team_name}**: ${err.message || 'Unknown error'}`);
                }
            }
            const summary = [
                `Done: Post-auction setup finished for **${auctionTeams.length}** teams.`,
                `New roles created: **${createdRoles}**`,
                `New role assignments: **${assignedRoles}**`,
                `Assignment failures/missing members: **${roleFailures}**`,
                `New stadiums created: **${createdStadiums}**`,
                `Existing stadiums moved: **${movedStadiums}**`,
                `New dressing rooms created: **${createdRooms}**`,
                `Existing dressing rooms moved/updated: **${movedRooms}**`,
                `Owner prompts sent: **${promptCount}**`
            ];
            if (failures.length) {
                summary.push(`Failures:\n${failures.slice(0, 10).join('\n')}`);
                if (failures.length > 10) {
                    summary.push(`...and ${failures.length - 10} more.`);
                }
            }
            await message.channel.send(summary.join('\n'));
        }
        catch (e) {
            await respondComponentError(response, e, 'Error: Timed out waiting for category selection.', 'Warning: Failed to start auction team setup.');
        }
    }
    else if (actualCommand === 'createchannel') {
        const chanName = args.join('-').toLowerCase().replace(/[^a-z0-9-]/g, '');
        if (!chanName) return message.reply("Usage: ?createchannel [name]");

        const categories = message.guild?.channels.cache.filter(c => c.type === discord_js_1.ChannelType.GuildCategory);
        if (!categories || categories.size === 0) return message.reply("No categories found.");

        const selectMenu = new discord_js_1.StringSelectMenuBuilder()
            .setCustomId('category_select_single')
            .setPlaceholder('📂 Select a Category')
            .addOptions(categories.map(c => new discord_js_1.StringSelectMenuOptionBuilder().setLabel(c.name).setValue(c.id)).slice(0, 25));

        const row = new discord_js_1.ActionRowBuilder().addComponents(selectMenu);
        const response = await message.reply({ content: `Select category for **#${chanName}**:`, components: [row] });

        try {
            const selection = await awaitComponent(response, { filter: i => i.user.id === message.author.id, time: 30000, max: 1 }, '❌ Timed out waiting for category selection.', '⚠️ Failed to create the channel.');
            if (!selection)
                return;
            await selection.deferUpdate();
            const channel = await message.guild.channels.create({
                name: chanName,
                type: discord_js_1.ChannelType.GuildText,
                parent: selection.values[0]
            });
            await selection.editReply({ content: `✅ Created channel ${channel}.`, components: [] });
        } catch (e) {
            await respondComponentError(response, e, '❌ Timed out waiting for category selection.', '⚠️ Failed to create the channel.');
        }
    }
    else if (actualCommand === 'ctcrole') {
        let role = message.mentions.roles.first();
        let channelName = '';

        if (role) {
            // Case 1: Role Mention Used
            const argsWithoutRole = args.filter(a => !a.includes(role.id));
            channelName = argsWithoutRole.join('-').toLowerCase();
        } else {
            // Case 2: Text Name Used (Longest Prefix Match)
            // Try to match the role name from the start of the args
            const allRoles = message.guild.roles.cache;
            let matchedRole = null;
            let matchLength = 0;

            // Try combinations from "Arg1" to "Arg1 Arg2 Arg3..."
            for (let i = args.length; i > 0; i--) {
                const potentialName = args.slice(0, i).join(' ');
                const found = allRoles.find(r => r.name.toLowerCase() === potentialName.toLowerCase());
                if (found) {
                    matchedRole = found;
                    matchLength = i;
                    break; // Found the longest possible match (greedy)? No, we want greedy from start.
                           // Actually, going backwards (args.length -> 1) IS greedy.
                           // "Intra Squad Chat" -> Checks "Intra Squad Chat" -> "Intra Squad" -> "Intra"
                }
            }

            if (matchedRole) {
                role = matchedRole;
                // Remaining args are the channel name
                channelName = args.slice(matchLength).join('-').toLowerCase();
            }
        }

        if (!role) return message.reply("Usage: ?ctcrole [@Role OR RoleName] [ChannelName (Optional)]\nCould not find a role with that name.");

        // Default Channel Name if empty
        if (!channelName) {
             channelName = role.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
        }

        // Fetch Categories
        const categories = message.guild?.channels.cache.filter(c => c.type === discord_js_1.ChannelType.GuildCategory);
        if (!categories || categories.size === 0) {
            return message.reply("No categories found in this server. Please create one first.");
        }

        // Create Select Menu
        const selectMenu = new discord_js_1.StringSelectMenuBuilder()
            .setCustomId('category_select_role')
            .setPlaceholder('📂 Select a Category')
            .addOptions(categories.map(c => new discord_js_1.StringSelectMenuOptionBuilder()
                .setLabel(c.name)
                .setValue(c.id)
                .setDescription(`ID: ${c.id}`)).slice(0, 25)
            );
        
        const row = new discord_js_1.ActionRowBuilder().addComponents(selectMenu);
        const response = await message.reply({
            content: `Select a category for the role channel **#${channelName}** (Access: **${role.name}**):`,
            components: [row]
        });

        try {
            const selection = await awaitComponent(response, {
                filter: i => i.user.id === message.author.id && i.customId === 'category_select_role',
                time: 30000,
                max: 1
            }, '❌ Timed out.', '⚠️ Failed to configure the role channel.');
            if (!selection)
                return;
            await selection.deferUpdate();
            const categoryId = selection.values[0];
            const category = categories.get(categoryId);
            
            try {
                const channel = await message.guild?.channels.create({
                    name: channelName,
                    type: discord_js_1.ChannelType.GuildText,
                    parent: categoryId,
                    permissionOverwrites: [
                        {
                            id: message.guild.id, // @everyone
                            deny: [discord_js_1.PermissionFlagsBits.ViewChannel],
                        },
                        {
                            id: role.id, // The Specific Role
                            allow: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.SendMessages],
                        },
                        {
                            id: message.author.id, // Admin who ran command
                            allow: [discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.SendMessages],
                        }
                    ],
                    reason: `Role Channel for ${role.name}`
                });
                
                await selection.editReply({
                    content: `✅ Created channel ${channel} in **${category?.name}**. Access limited to **${role.name}**.`,
                    components: []
                });
            } catch (e) {
                console.error(e);
                await selection.editReply({ content: `⚠️ Failed to create channel: ${e.message}`, components: [] });
            }
        } catch (e) {
            await respondComponentError(response, e, '❌ Timed out waiting for category selection.', '⚠️ Failed to configure the role channel.');
        }
    }
}

async function handleDynamicPings(message, command) {
    const db = (0, database_1.getDB)();
    const guildId = message.guild?.id;
    if (!guildId) return false;

    const pingerRecord = await db.get('SELECT * FROM role_pingers WHERE guild_id = ? AND command_name = ?', guildId, command);
    if (!pingerRecord) return false;

    // Check if user is the registered pinger OR an admin
    const isPinger = pingerRecord.pinger_id === message.author.id;
    const isAdm = (0, utils_1.isAdmin)(message.member);

    if (!isPinger && !isAdm) {
        return false;
    }

    try {
        const role = await message.guild.roles.fetch(pingerRecord.role_id);
        if (!role) {
            return message.reply("⚠️ Error: Registered role not found.");
        }
        
        await message.channel.send(`📢 **${role.name} Ping!**\n<@&${role.id}>`);
        return true;
    } catch (e) {
        console.error(e);
        return false;
    }
}


async function handleHcHistoryCommand(message) {
    const db = (0, database_1.getDB)();
    const guildId = message.guild?.id;
    const { buildPagedButtonRow } = utils_1;

    const matches = await db.all("SELECT * FROM hc_auto_matches WHERE guild_id = ? ORDER BY id DESC", guildId);
    if (matches.length === 0) return message.reply("No HC auto-tracking history found.");

    const itemsPerPage = 3;
    const totalPages = Math.ceil(matches.length / itemsPerPage);

    const buildEmbed = async (pageIndex) => {
        const start = pageIndex * itemsPerPage;
        const end = start + itemsPerPage;
        const pageMatches = matches.slice(start, end);

        const embed = new discord_js_1.EmbedBuilder()
            .setTitle("🏏 HC Match Auto-Tracking History")
            .setColor(0x0099FF)
            .setFooter({ text: `Page ${pageIndex + 1} of ${totalPages} | Total: ${matches.length}` });

        for (const m of pageMatches) {
            const startTime = m.started_at ? `<t:${m.started_at}:f>` : "Unknown";
            const endTime = m.ended_at ? `<t:${m.ended_at}:f>` : (m.status === "ACTIVE" ? "*Active*" : "Unknown");
            const channel = message.guild.channels.cache.get(m.channel_id) ? `<#${m.channel_id}>` : `#${m.channel_id}`;

            const matchups = await db.all("SELECT batter_display_name, bowler_display_name, runs, balls, dismissals FROM hc_matchup_match_log WHERE match_id = ?", m.id);
            const matchupTextFormatted = buildGroupedHcHistoryMatchupText(matchups, 850);
            embed.addFields({
                name: `Match ID: ${m.id} [${m.status}]`,
                value: `**Started:** ${startTime}\n**Ended:** ${endTime}\n**Channel:** ${channel}\n**Matchups:**\n${matchupTextFormatted}`,
                inline: false
            });
        }
        return embed;
    };

    let page = 0;
    const response = await message.reply({ embeds: [await buildEmbed(page)], components: totalPages > 1 ? [buildPagedButtonRow("hc_history", page, totalPages)] : [] });

    if (totalPages > 1) {
        const collector = response.createMessageComponentCollector({
            filter: interaction => interaction.user.id === message.author.id && ["hc_history_prev", "hc_history_next"].includes(interaction.customId),
            time: 300000
        });

        collector.on("collect", async (interaction) => {
            if (interaction.customId === "hc_history_prev" && page > 0) page--;
            if (interaction.customId === "hc_history_next" && page < totalPages - 1) page++;
            await interaction.update({ embeds: [await buildEmbed(page)], components: [buildPagedButtonRow("hc_history", page, totalPages)] }).catch(() => null);
        });

        collector.on("end", () => {
            response.edit({ components: [] }).catch(() => null);
        });
    }
}
function normalizeHcParticipantValue(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[`*_~]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}
function truncateHcOptionLabel(value, fallback) {
    const text = String(value || fallback || '').replace(/\s+/g, ' ').trim() || fallback;
    return text.length <= 100 ? text : `${text.slice(0, 97).trimEnd()}...`;
}
function parseHcEditSpec(args) {
    const raw = args.join(' ').trim();
    if (!raw || !raw.includes('|')) {
        return { batterInput: null, bowlerInput: null, values: null };
    }
    const parts = raw.split('|').map(part => part.trim());
    const batterInput = parts[0] || null;
    const bowlerInput = parts[1] || null;
    let values = null;
    if (parts.length >= 5) {
        const runs = parseInt(parts[2], 10);
        const balls = parseInt(parts[3], 10);
        const dismissals = parseInt(parts[4], 10);
        if ([runs, balls, dismissals].every(value => Number.isInteger(value) && value >= 0)) {
            values = { runs, balls, dismissals };
        }
    }
    return { batterInput, bowlerInput, values };
}
async function promptHcEditSelect(message, customId, promptText, placeholder, options) {
    if (!options.length) {
        return null;
    }
    const row = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
        .setCustomId(customId)
        .setPlaceholder(placeholder)
        .addOptions(options.slice(0, 25)));
    const response = await message.reply({ content: promptText, components: [row] });
    const interaction = await awaitComponent(response, {
        filter: i => i.user.id === message.author.id && i.customId === customId,
        time: 60000,
        max: 1
    }, '❌ Selection timed out.', '⚠️ Failed to process the selection.');
    if (!interaction) {
        return null;
    }
    const selectedValue = interaction.values?.[0] || null;
    await interaction.deferUpdate().catch(() => null);
    await response.edit({ components: [] }).catch(() => null);
    return selectedValue;
}
function resolveHcParticipantChoice(options, rawInput) {
    const normalizedInput = normalizeHcParticipantValue(rawInput);
    if (!normalizedInput) {
        return null;
    }
    const exact = options.find(option => option.matchers.includes(normalizedInput));
    if (exact) {
        return exact.value;
    }
    const partialMatches = options.filter(option => option.matchers.some(matcher => matcher.includes(normalizedInput)));
    if (partialMatches.length === 1) {
        return partialMatches[0].value;
    }
    return null;
}
async function promptHcEditValues(message, matchId, row) {
    await message.reply(`Editing Match ID \`${matchId}\`\nSelected: **${row.batter_display_name}** vs **${row.bowler_display_name}**\nCurrent: \`${row.runs}\` runs, \`${row.balls}\` balls, \`${row.dismissals}\` dismissals\nReply within 2 minutes with: \`runs balls dismissals\``);
    const collected = await message.channel.awaitMessages({
        filter: reply => reply.author.id === message.author.id,
        max: 1,
        time: 120000
    }).catch(() => null);
    const reply = collected?.first();
    if (!reply) {
        await message.reply('❌ HC edit timed out waiting for the new values.');
        return null;
    }
    const match = reply.content.trim().match(/^(\d+)\s+(\d+)\s+(\d+)$/);
    if (!match) {
        await message.reply('Usage for the value reply is: `runs balls dismissals`');
        return null;
    }
    return {
        runs: parseInt(match[1], 10),
        balls: parseInt(match[2], 10),
        dismissals: parseInt(match[3], 10)
    };
}
async function handleHcEditCommand(message, args) {
    const db = (0, database_1.getDB)();
    const guildId = message.guild?.id;
    if (!guildId) {
        return;
    }
    const matchId = parseInt(args.shift() || '', 10);
    if (!Number.isInteger(matchId) || matchId <= 0) {
        await message.reply('Usage: `?hcedit <MatchID>` or `?hcedit <MatchID> batter | bowler | runs | balls | dismissals`');
        return;
    }
    const match = await db.get('SELECT * FROM hc_auto_matches WHERE id = ? AND guild_id = ?', matchId, guildId);
    if (!match) {
        await message.reply(`Match ID \`${matchId}\` was not found in this server.`);
        return;
    }
    const rows = await db.all(`SELECT *
        FROM hc_matchup_match_log
        WHERE match_id = ? AND guild_id = ?
        ORDER BY batter_display_name COLLATE NOCASE ASC, bowler_display_name COLLATE NOCASE ASC, id ASC`, matchId, guildId);
    if (!rows.length) {
        await message.reply(`Match ID \`${matchId}\` has no saved HC matchup rows to edit.`);
        return;
    }
    const parsedSpec = parseHcEditSpec(args);
    const batterOptions = [...new Map(rows.map(row => {
            const label = row.batter_display_name || row.batter_norm;
            return [row.batter_norm, {
                    label: truncateHcOptionLabel(label, row.batter_norm),
                    value: row.batter_norm,
                    matchers: [...new Set([normalizeHcParticipantValue(label), normalizeHcParticipantValue(row.batter_norm)])].filter(Boolean)
                }];
        })).values()];
    let batterNorm = resolveHcParticipantChoice(batterOptions, parsedSpec.batterInput);
    if (!batterNorm) {
        batterNorm = await promptHcEditSelect(message, `hcedit_batter_${message.id}_${matchId}`, `Select the batter to edit for Match ID \`${matchId}\`.`, 'Select batter', batterOptions.map(option => ({
            label: option.label,
            value: option.value
        })));
        if (!batterNorm) {
            return;
        }
    }
    const batterRows = rows.filter(row => row.batter_norm === batterNorm);
    const bowlerOptions = [...new Map(batterRows.map(row => {
            const label = row.bowler_display_name || row.bowler_norm;
            return [row.bowler_norm, {
                    label: truncateHcOptionLabel(label, row.bowler_norm),
                    value: row.bowler_norm,
                    description: truncateHcOptionLabel(`${row.runs}(${row.balls})${row.dismissals ? ` | W:${row.dismissals}` : ''}`, 'Selected matchup'),
                    matchers: [...new Set([normalizeHcParticipantValue(label), normalizeHcParticipantValue(row.bowler_norm)])].filter(Boolean)
                }];
        })).values()];
    let bowlerNorm = resolveHcParticipantChoice(bowlerOptions, parsedSpec.bowlerInput);
    if (!bowlerNorm) {
        bowlerNorm = await promptHcEditSelect(message, `hcedit_bowler_${message.id}_${matchId}`, `Select the bowler for **${batterRows[0]?.batter_display_name || batterNorm}** in Match ID \`${matchId}\`.`, 'Select bowler', bowlerOptions.map(option => ({
            label: option.label,
            value: option.value,
            description: option.description
        })));
        if (!bowlerNorm) {
            return;
        }
    }
    const targetRow = batterRows.find(row => row.bowler_norm === bowlerNorm) || null;
    if (!targetRow) {
        await message.reply('Could not resolve the selected batter/bowler matchup row.');
        return;
    }
    const nextValues = parsedSpec.values || await promptHcEditValues(message, matchId, targetRow);
    if (!nextValues) {
        return;
    }
    let transactionActive = false;
    try {
        await db.run('BEGIN IMMEDIATE TRANSACTION');
        transactionActive = true;
        await db.run(`UPDATE hc_matchup_match_log
            SET runs = ?, balls = ?, dismissals = ?
            WHERE id = ?`, nextValues.runs, nextValues.balls, nextValues.dismissals, targetRow.id);
        await rebuildHcGlobalMatchupsAfterDelete(db);
        await db.run('COMMIT');
        transactionActive = false;
        await message.reply(`✅ HC matchup updated for Match ID \`${matchId}\`\n**${targetRow.batter_display_name}** vs **${targetRow.bowler_display_name}**\nBefore: \`${targetRow.runs}(${targetRow.balls})\` | dismissals: \`${targetRow.dismissals}\`\nAfter: \`${nextValues.runs}(${nextValues.balls})\` | dismissals: \`${nextValues.dismissals}\``);
    }
    catch (error) {
        if (transactionActive) {
            await db.run('ROLLBACK').catch(() => null);
        }
        throw error;
    }
}
function buildGroupedHcHistoryMatchupText(matchups, maxLength = 900) {
    const activeMatchups = matchups.filter(matchup => (matchup.balls || 0) > 0 || (matchup.dismissals || 0) > 0 || (matchup.runs || 0) > 0);
    if (!activeMatchups.length) {
        return '*No matchup data recorded yet.*';
    }
    const groupedByBowler = new Map();
    for (const matchup of activeMatchups) {
        const bowlerKey = String(matchup.bowler_display_name || 'Unknown Bowler');
        if (!groupedByBowler.has(bowlerKey)) {
            groupedByBowler.set(bowlerKey, {
                bowlerDisplayName: matchup.bowler_display_name || 'Unknown Bowler',
                runs: 0,
                balls: 0,
                dismissals: 0,
                items: []
            });
        }
        const group = groupedByBowler.get(bowlerKey);
        group.runs += Number(matchup.runs || 0);
        group.balls += Number(matchup.balls || 0);
        group.dismissals += Number(matchup.dismissals || 0);
        group.items.push(matchup);
    }
    const lines = [...groupedByBowler.values()]
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
            return String(a.batter_display_name || '').localeCompare(String(b.batter_display_name || ''));
        })
            .map(matchup => {
            const wicketText = matchup.dismissals ? ` | W:${matchup.dismissals}` : '';
            return `- vs ${matchup.batter_display_name}: ${matchup.runs}(${matchup.balls})${wicketText}`;
        });
        return [header, ...itemLines, ''];
    });
    const text = lines.join('\n').trim();
    return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 4)).trimEnd()}\n...`;
}
async function rebuildHcGlobalMatchupsAfterDelete(db) {
    await db.run('DELETE FROM hc_global_matchups');
    await db.run(`INSERT INTO hc_global_matchups (
            batter_norm, bowler_norm, batter_display_name, bowler_display_name,
            runs, balls, dismissals, matches, faced_matches, innings_faced, updated_at
        )
        SELECT
            batter_norm,
            bowler_norm,
            MAX(COALESCE(batter_display_name, batter_norm)) AS batter_display_name,
            MAX(COALESCE(bowler_display_name, bowler_norm)) AS bowler_display_name,
            COALESCE(SUM(runs), 0) AS runs,
            COALESCE(SUM(balls), 0) AS balls,
            COALESCE(SUM(dismissals), 0) AS dismissals,
            COALESCE(SUM(matches), 0) AS matches,
            COALESCE(SUM(faced_matches), 0) AS faced_matches,
            COALESCE(SUM(innings_faced), 0) AS innings_faced,
            COALESCE(MAX(created_at), CAST(strftime('%s','now') AS INTEGER)) AS updated_at
        FROM hc_matchup_match_log
        GROUP BY batter_norm, bowler_norm`);
}
