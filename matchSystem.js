"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchSystem = void 0;
const discord_js_1 = require("discord.js");
const database_1 = require("./database");
const auditLog_1 = require("./auditLog");
const pointTable_1 = require("./pointTable");
const statsSystem = require("./statsSystem");
const utils_1 = require("./utils");
const TIME_SNIPPET_REGEX = /(\d{1,2})(?:[:.]\d{1,2})?\s*(?:am|pm)?/i;
const AGREEMENT_KEYWORDS = new Set(['done', 'yes', 'confirmed', 'matched', 'agree', 'ok', 'okay', 'k']);
const RESERVE_KEYWORDS = new Set(['reserve', 'reserved']);
const FREE_WIN_KEYWORDS = new Set(['fw', 'free win', 'freewin']);
function normalizeSchedulingMessage(content) {
    return String(content || '')
        .trim()
        .toLowerCase()
        .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
        .replace(/\s+/g, ' ');
}
function normalizeFixtureDayKey(dayNumber) {
    if (dayNumber === null || dayNumber === undefined)
        return null;
    const text = String(dayNumber).trim();
    return text || null;
}
function parseReserveDayNumber(dayNumber) {
    const key = normalizeFixtureDayKey(dayNumber);
    if (!key)
        return null;
    const match = key.match(/^reserve\s+(\d+)$/i);
    if (!match)
        return null;
    const parsed = parseInt(match[1], 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
function parseSeasonNumber(seasonName) {
    const match = String(seasonName || '').trim().match(/^S?(\d+)$/i);
    if (!match)
        return null;
    const parsed = parseInt(match[1], 10);
    return Number.isInteger(parsed) ? parsed : null;
}

function normalizePairKey(teamAId, teamBId) {
    return [String(teamAId ?? ''), String(teamBId ?? '')].sort().join(':');
}
function isActiveReservationStatus(status) {
    return ['OPEN', 'PENDING', 'SCHEDULED'].includes(String(status || '').toUpperCase());
}
function isReservedLikeStatus(status) {
    return ['RESERVED', 'INFERRED_RESERVED'].includes(String(status || '').toUpperCase());
}
function isLegacyReserveLinkedReservation(reservation) {
    if (!reservation || !isActiveReservationStatus(reservation.status)) {
        return false;
    }
    const actorId = String(reservation.reserved_by_captain_id || '').trim();
    if (!actorId || actorId.toUpperCase() === 'SYSTEM') {
        return false;
    }
    if (reservation.scheduled_time || reservation.agreement_time) {
        return false;
    }
    return true;
}

async function awaitComponent(message, options, timeoutText = '❌ Interaction timed out.') {
    try {
        return await message.awaitMessageComponent(options);
    }
    catch (e) {
        try {
            if (message.editable) {
                await message.edit({ content: timeoutText, components: [] });
            }
            else if (message.channel) {
                await message.channel.send(timeoutText);
            }
        }
        catch (_a) {
        }
        return null;
    }
}

function getAlphabetRange(limit = 'A') {
    const letters = [];
    const end = (limit || 'A').toUpperCase().charCodeAt(0);
    for (let code = 'A'.charCodeAt(0); code <= end; code++) {
        letters.push(String.fromCharCode(code));
    }
    return letters;
}

async function promptPointTableLayoutPrompt(message) {
    const row = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId('sss_layout_6').setLabel('6 Teams').setStyle(discord_js_1.ButtonStyle.Primary), new discord_js_1.ButtonBuilder().setCustomId('sss_layout_8').setLabel('8 Teams').setStyle(discord_js_1.ButtonStyle.Primary), new discord_js_1.ButtonBuilder().setCustomId('sss_layout_10').setLabel('10 Teams').setStyle(discord_js_1.ButtonStyle.Primary));
    const prompt = await message.reply({ content: "📊 Select the **Point Table Layout** for this season:", components: [row] });
    const selection = await awaitComponent(prompt, { filter: i => i.user.id === message.author.id, time: 60000 }, "❌ Layout selection timed out.", "⚠️ Failed to choose a layout.");
    if (!selection)
        return 6;
    const layout = parseInt(selection.customId.split('_').pop());
    await selection.update({ content: `✅ Layout set to **${layout} teams**.`, components: [] });
    return layout;
}

async function promptSeasonFormatPrompt(message) {
    const row = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
        .setCustomId('sss_format')
        .setPlaceholder('Select Season Format')
        .addOptions([
        { label: 'Single League', value: 'LEAGUE', description: 'All teams share one table.' },
        { label: 'Groups (A-H)', value: 'GROUPS', description: 'Split teams across lettered groups.' }
    ]));
    const prompt = await message.reply({ content: "🏗️ Choose the **Season Format**:", components: [row] });
    const selection = await awaitComponent(prompt, { filter: i => i.user.id === message.author.id, time: 60000 }, "❌ Format selection timed out.", "⚠️ Failed to choose a format.");
    if (!selection)
        return { format: 'LEAGUE', limit: 'A' };
    const format = selection.values[0];
    await selection.deferUpdate();
    if (format === 'GROUPS') {
        const groupOptions = getAlphabetRange('H').map(letter => ({ label: `Groups A-${letter}`, value: letter }));
        const gRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder().setCustomId('sss_group_limit').setPlaceholder('How many groups?').addOptions(groupOptions));
        await selection.editReply({ content: "🔤 Select the highest **Group Letter** (A-H):", components: [gRow] });
        const gSelect = await awaitComponent(prompt, { filter: i => i.user.id === message.author.id, time: 60000 }, "❌ Group selection timed out.", "⚠️ Failed to choose group limit.");
        if (!gSelect)
            return { format: 'GROUPS', limit: 'A' };
        await gSelect.deferUpdate();
        const limit = gSelect.values[0];
        await gSelect.editReply({ content: `✅ Format set to **Groups A-${limit}**.`, components: [] });
        return { format: 'GROUPS', limit };
    }
    await selection.editReply({ content: "✅ Format set to **Single League**.", components: [] });
    return { format: 'LEAGUE', limit: 'A' };
}

class MatchSystem {
    constructor() {
        this.stadiumCacheByChannel = new Map();
        this.guildStadiumRefresh = new Map();
        this.STADIUM_CACHE_TTL_MS = 60 * 1000;
        this.teamCache = new Map();
        this.TEAM_CACHE_TTL_MS = 5 * 60 * 1000;
        this.matchSchedulerRunning = false;
    }
    async setCaptain(message, args) {
        const db = (0, database_1.getDB)();
        const guildId = message.guild.id;

        const targetUser = message.mentions.users.first();
        const role = message.mentions.roles.first();

        if (!targetUser) {
            return message.reply("Usage: `?setmatchcap @user @teamrole` or `?setmatchcap @user \"Team Name\"`.");
        }

        let team = null;
        if (role) {
            team = await this.getTeamByName(guildId, role.name);
            if (!team) {
                // Register as non-auction team if not found
                await db.run('INSERT INTO teams (guild_id, team_name, owner_discord_id, purse_lakhs) VALUES (?, ?, ?, ?)', 
                    guildId, role.name, 'VIRTUAL_TEAM_' + role.id, -1);
                this.invalidateTeamCache(guildId);
                team = await this.getTeamByName(guildId, role.name);
            }
        }

        if (!team) {
            const potentialNames = args.filter(a => !a.includes(targetUser.id) && (role ? !a.includes(role.id) : true));
            if (potentialNames.length > 0) {
                const searchName = potentialNames.join(' ').replace(/\"/g, '');
                team = await this.getTeamByName(guildId, searchName);
            }
        }

        if (!team) {
            const allTeams = await this.getAllTeams(guildId);
            if (allTeams.length === 0) return message.reply("❌ No teams found. Create a team first.");

            const selectMenu = new discord_js_1.StringSelectMenuBuilder()
                .setCustomId('set_captain_team_select')
                .setPlaceholder('Select the correct team...')
                .addOptions(allTeams.map(t => ({
                    label: t.team_name,
                    value: `${t.team_id}_${targetUser.id}`
                })));

            const row = new discord_js_1.ActionRowBuilder().addComponents(selectMenu);
            const response = await message.reply({ content: `Select team for **${targetUser.username}**:`, components: [row] });

            const collector = response.createMessageComponentCollector({ filter: i => i.user.id === message.author.id, time: 30000 });
            collector.on('collect', async i => {
                await i.deferUpdate();
                const [teamId, userId] = i.values[0].split('_');
                await db.run('INSERT INTO team_captains (guild_id, team_id, captain_discord_id) VALUES (?, ?, ?) ON CONFLICT(guild_id, team_id) DO UPDATE SET captain_discord_id = ?', 
                    guildId, teamId, userId, userId);
                const selectedTeam = (await this.getAllTeams(guildId)).find(t => t.team_id == teamId);
                await i.editReply({ content: `✅ **${targetUser.username}** is now Captain of **${selectedTeam.team_name}**.`, components: [] });
                collector.stop();
            });
            return;
        }

        await db.run('INSERT INTO team_captains (guild_id, team_id, captain_discord_id) VALUES (?, ?, ?) ON CONFLICT(guild_id, team_id) DO UPDATE SET captain_discord_id = ?', 
            guildId, team.team_id, targetUser.id, targetUser.id);
        message.reply({ embeds: [new discord_js_1.EmbedBuilder().setDescription(`✅ **${targetUser.username}** is now Captain of **${team.team_name}**.`).setColor(0x00FF00)] });
    }

    async removeCaptain(message) {
        const db = (0, database_1.getDB)();
        const guildId = message.guild.id;
        const captains = await db.all('SELECT tc.*, t.team_name FROM team_captains tc JOIN teams t ON tc.team_id = t.team_id WHERE tc.guild_id = ?', guildId);
        if (captains.length === 0) return message.reply("❌ No captains found.");

        const options = await Promise.all(captains.map(async c => {
            let name = "Unknown";
            try { 
                const m = await message.guild.members.fetch(c.captain_discord_id).catch(() => null); 
                if (m) name = m.user.username; 
            } catch(e) {}
            return { label: c.team_name, description: `Captain: ${name}`, value: c.team_id.toString() };
        })).then(opts => opts.slice(0, 25));

        const row = new discord_js_1.ActionRowBuilder().addComponents(
            new discord_js_1.StringSelectMenuBuilder()
                .setCustomId('rm_cap_multi')
                .setPlaceholder('Select one or more teams to remove captains')
                .setMinValues(1)
                .setMaxValues(options.length)
                .addOptions(options)
        );

        const resp = await message.reply({ content: "Select teams to **REMOVE captains** from:", components: [row] });
        try {
            const select = await awaitComponent(resp, { filter: i => i.user.id === message.author.id, time: 60000 });
            if (!select)
                return;
            await select.deferUpdate();
            const selectedTeamIds = select.values;
            const selectedTeams = captains.filter(c => selectedTeamIds.includes(c.team_id.toString()));
            const teamNames = selectedTeams.map(t => `**${t.team_name}**`).join(', ');

            if (!await (0, utils_1.askConfirmation)(message, `Are you sure you want to **REMOVE captains** from these teams?\n${teamNames}`)) {
                try { await select.editReply({ content: "❌ Action cancelled.", components: [] }); } catch(e) {}
                return;
            }

            for (const teamId of selectedTeamIds) {
                await db.run('DELETE FROM team_captains WHERE guild_id = ? AND team_id = ?', guildId, teamId);
            }
            
            try {
                await select.editReply({ content: `✅ Removed captains from: ${teamNames}.`, components: [] });
            } catch (e) {
                await message.channel.send(`✅ Removed captains from: ${teamNames}.`);
            }
        } catch (e) {
            if (!message.replied) console.error(e);
        }
    }

    async listRegTeams(message) {
        const db = (0, database_1.getDB)();
        const guildId = message.guild.id;
        const teams = await db.all(`
            SELECT t.team_name, tc.captain_discord_id 
            FROM teams t 
            LEFT JOIN team_captains tc ON t.team_id = tc.team_id 
            WHERE t.guild_id = ? AND t.purse_lakhs = -1
        `, guildId);

        if (teams.length === 0) return message.reply("No non-auction teams registered.");

        const list = teams.map((t, i) => {
            const capMention = t.captain_discord_id ? `<@${t.captain_discord_id}>` : "*No Captain*";
            return `${i + 1}. **${t.team_name}** - Captain: ${capMention}`;
        }).join('\n');

        const embed = new discord_js_1.EmbedBuilder()
            .setTitle("Registered Non-Auction Teams")
            .setDescription(list)
            .setColor(0x00AE86);
        
        message.reply({ embeds: [embed] });
    }

    async getCaptainTeam(guildId, userId, member = null) {
        const db = (0, database_1.getDB)();
        let team = await db.get('SELECT t.* FROM teams t JOIN team_captains tc ON t.team_id = tc.team_id WHERE tc.guild_id = ? AND tc.captain_discord_id = ?', guildId, userId);
        if (team) return team;
        team = await db.get('SELECT * FROM teams WHERE guild_id = ? AND owner_discord_id = ?', guildId, userId);
        if (team) return team;
        if (member) {
            const allTeams = await this.getAllTeams(guildId);
            for (const t of allTeams)
                if (member.roles.cache.some(r => r.name === t.team_name))
                    return t;
        }
        return null;
    }

    async setScheduleSeason(message, seasonName) {
        if (!(0, utils_1.isSuperAdmin)(message.member)) return message.reply("❌ This command requires **Super Admin** permissions.");
        const db = (0, database_1.getDB)();
        const guildId = message.guild.id;
        const rawInput = (seasonName || '').trim();
        if (!rawInput)
            return message.reply("Usage: `?setseasonschedule [SeasonName] [fresh|keep]`.");
        const tokens = rawInput.split(/\s+/);
        const seasonToken = tokens.shift();
        if (!seasonToken)
            return message.reply("Usage: `?setseasonschedule [SeasonName] [fresh|keep]`.");
        const flagTokens = tokens.map(t => t.toLowerCase());
        const keepTeams = flagTokens.some(t => t === 'keep' || t === '--keep' || t === 'retain' || t === '--retain');
        const forceFresh = flagTokens.some(t => ['fresh', '--fresh', 'reset', '--reset', 'new', '--new'].includes(t));
        const seasonNum = parseInt(seasonToken.replace(/\D/g, '')) || 1;
        const formattedSeason = seasonToken.startsWith('S') ? seasonToken : `S${seasonToken}`;

        const existingSeason = await db.get('SELECT layout_size, format_type, group_limit FROM stats_seasons WHERE guild_id = ? AND season_name = ?', guildId, formattedSeason);
        
        let layoutSize, formatData;
        if (existingSeason && existingSeason.layout_size && existingSeason.format_type) {
            layoutSize = existingSeason.layout_size;
            formatData = { format: existingSeason.format_type, limit: existingSeason.group_limit || 'A' };
        } else {
            layoutSize = await promptPointTableLayoutPrompt(message);
            formatData = await promptSeasonFormatPrompt(message);
        }

        await db.run('INSERT INTO guild_settings (guild_id, schedule_season) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET schedule_season = ?', guildId, formattedSeason, formattedSeason);
        await db.run(`INSERT INTO pt_settings (guild_id, current_season, layout_size, format_type, group_limit)
                      VALUES (?, ?, ?, ?, ?)
                      ON CONFLICT(guild_id) DO UPDATE SET
                        current_season = excluded.current_season,
                        layout_size = excluded.layout_size,
                        format_type = excluded.format_type,
                        group_limit = excluded.group_limit`,
            guildId, seasonNum, layoutSize, formatData.format, formatData.limit);
        await db.run('UPDATE stats_seasons SET is_active = 0 WHERE guild_id = ?', guildId);
        
        const sResult = await db.run('UPDATE stats_seasons SET is_active = 1, season_num = ?, layout_size = ?, format_type = ?, group_limit = ? WHERE guild_id = ? AND season_name = ?', 
            seasonNum, layoutSize, formatData.format, formatData.limit, guildId, formattedSeason);
        if (sResult.changes === 0) {
            await db.run('INSERT INTO stats_seasons (guild_id, season_name, is_active, season_num, layout_size, format_type, group_limit) VALUES (?, ?, 1, ?, ?, ?, ?)', 
                guildId, formattedSeason, seasonNum, layoutSize, formatData.format, formatData.limit);
        }
        let extraNote = '';
        if (keepTeams) {
            extraNote = '\n- Existing teams were kept (--keep flag).';
        }
        else if (forceFresh) {
            await this.resetTeamsForNewSeason(guildId);
            extraNote = '\n- Cleared previous teams, captains, fixtures, and auction links for a fresh season.';
        }
        else if (existingSeason) {
            // Re-linking an existing season, default to keeping teams without prompting
            extraNote = '\n- Existing teams were kept (re-linked old season).';
        }
        else {
            // Brand new season and no flags specified, ask the user
            const shouldReset = await (0, utils_1.askConfirmation)(message, "Clear all existing teams/captains/match reservations for this **NEW** season?");
            if (shouldReset) {
                await this.resetTeamsForNewSeason(guildId);
                extraNote = '\n- Cleared previous teams, captains, fixtures, and auction links for a fresh season.';
            }
            else {
                extraNote = '\n- Existing teams were kept.';
            }
        }
        const formatSummary = formatData.format === 'LEAGUE' ? 'Single League' : `Groups A-${formatData.limit}`;
        message.reply(`✅ **Season Linked Successfully!**\n- Scheduling: **${formattedSeason}**\n- Point Table: **Season ${seasonNum}**\n- Layout: **${layoutSize} teams**\n- Format: **${formatSummary}**\n- Stats Active: **${formattedSeason}**${extraNote}`);
    }

    async getActiveScheduleSeason(guildId) {
        const db = (0, database_1.getDB)();
        const res = await db.get('SELECT schedule_season FROM guild_settings WHERE guild_id = ?', guildId);
        return res ? res.schedule_season : null;
    }

    async incrementReserveUsage(guildId, seasonName, teamId) {
        if (!teamId)
            return;
        const db = (0, database_1.getDB)();
        await db.run('INSERT INTO team_reservations (guild_id, season_name, team_id, used_count) VALUES (?, ?, ?, 1) ON CONFLICT(guild_id, season_name, team_id) DO UPDATE SET used_count = team_reservations.used_count + 1', guildId, seasonName, teamId);
    }

    async decrementReserveUsage(guildId, seasonName, teamId) {
        if (!teamId)
            return;
        const db = (0, database_1.getDB)();
        await db.run('UPDATE team_reservations SET used_count = CASE WHEN used_count > 0 THEN used_count - 1 ELSE 0 END WHERE guild_id = ? AND season_name = ? AND team_id = ?', guildId, seasonName, teamId);
    }

    async applyReserveToReservation(guild, channel, reservation, reserveTeamId, reserveTeamName, actorId, appliedByAdmin = false, countsTowardLimit = true) {
        const db = (0, database_1.getDB)();
        const guildId = guild.id;
        const activeSeason = reservation.season_name;
        const eligibility = await this.validateReserveEligibility(guildId, activeSeason, reservation, { allowAdminOverride: appliedByAdmin });
        if (!eligibility.ok) {
            return { ok: false, reason: eligibility.reason, message: eligibility.message };
        }
        const teamRows = await db.all('SELECT team_id, team_name, role_id FROM teams WHERE team_id IN (?, ?)', reservation.team_a_id, reservation.team_b_id);
        const teamMap = new Map(teamRows.map(row => [row.team_id, row]));
        const fSettings = await db.get('SELECT max_reserve FROM fixture_settings WHERE guild_id = ?', guildId);
        const limit = fSettings ? fSettings.max_reserve : 2;
        const used = reserveTeamId
            ? await db.get('SELECT used_count FROM team_reservations WHERE guild_id = ? AND season_name = ? AND team_id = ?', guildId, activeSeason, reserveTeamId)
            : null;
        const usedCount = used ? used.used_count : 0;
        if (countsTowardLimit && reserveTeamId && usedCount >= limit) {
            return { ok: false, reason: 'limit', limit, teamName: reserveTeamName };
        }
        if (countsTowardLimit && reserveTeamId) {
            await db.run('INSERT INTO team_reservations (guild_id, season_name, team_id, used_count) VALUES (?, ?, ?, 1) ON CONFLICT(guild_id, season_name, team_id) DO UPDATE SET used_count = team_reservations.used_count + 1', guildId, activeSeason, reserveTeamId);
        }
        await db.run('UPDATE match_reservations SET status = "RESERVED", reserved_by_captain_id = ?, reserve_team_id = ?, agreement_time = NULL, scheduled_time = NULL WHERE id = ?', actorId, reserveTeamId || null, reservation.id);
        await this.lockReservedMatchChannel(guild, channel.id, reservation);
        await this.clearMatchChannelParticipants(channel, reservation);
        this.removeStadiumChannel(channel.id);
        const newUsedCount = countsTowardLimit ? usedCount + 1 : usedCount;
        const teamAMention = teamMap.get(reservation.team_a_id)?.role_id ? `<@&${teamMap.get(reservation.team_a_id).role_id}>` : `**${teamMap.get(reservation.team_a_id)?.team_name || reservation.t1name || 'Team 1'}**`;
        const teamBMention = teamMap.get(reservation.team_b_id)?.role_id ? `<@&${teamMap.get(reservation.team_b_id).role_id}>` : `**${teamMap.get(reservation.team_b_id)?.team_name || reservation.t2name || 'Team 2'}**`;
        const mentionableRoleIds = teamRows.map(row => row.role_id).filter(Boolean);
        const overrideLabel = eligibility.overrideAllowed && eligibility.contextLabel
            ? ` for this ${eligibility.contextLabel}`
            : '';
        const outcomeLine = eligibility.overrideAllowed
            ? 'This fixture has been moved back to reserved status for admin follow-up.'
            : 'This match will now be played after all regular season matches are complete.';
        const description = countsTowardLimit
            ? (appliedByAdmin
                ? `**${reserveTeamName}** has been marked as using a reserve by admin${overrideLabel}. ${outcomeLine}\n\n**Reserves used by ${reserveTeamName}:** ${newUsedCount}/${limit}\n**Applied by:** <@${actorId}>`
                : `**${reserveTeamName}** has used a reserve. ${outcomeLine}\n\n**Reserves used by ${reserveTeamName}:** ${newUsedCount}/${limit}`)
            : `This match has been marked as an admin reserve${overrideLabel}. No team's reserve limit was reduced.\n${outcomeLine}\n\n**Applied by:** <@${actorId}>`;
        await channel.send({
            content: `${teamAMention} ${teamBMention}\nThis match has been reserved.`,
            allowedMentions: { parse: [], roles: mentionableRoleIds },
            embeds: [new discord_js_1.EmbedBuilder()
                .setTitle(!countsTowardLimit ? "Admin Reserve Applied" : (appliedByAdmin ? "Reserve Applied by Admin" : "Match Reserved / Postponed"))
                .setDescription(description)
                .setColor(0xFFFF00)]
        });
        return { ok: true, limit, usedCount: newUsedCount, countsTowardLimit };
    }

    async clearMatchChannelParticipants(channel, reservation) {
        for (const participantId of [reservation.cap1, reservation.cap2, reservation.vc1, reservation.vc2].filter(Boolean)) {
            await channel.permissionOverwrites.delete(participantId).catch(() => { });
        }
    }

    async applyFreeWinToReservation(guild, channel, reservation, giverTeamId, actorId, appliedByAdmin = false) {
        const db = (0, database_1.getDB)();
        const giverIsTeamA = giverTeamId === reservation.team_a_id;
        const giverTeamName = giverIsTeamA ? reservation.t1name : reservation.t2name;
        const receiverTeamName = giverIsTeamA ? reservation.t2name : reservation.t1name;
        let ptResult = null;
        try {
            ptResult = await (0, pointTable_1.recordPointTableMatchByTeams)(guild.id, {
                teamAName: reservation.t1name,
                teamBName: reservation.t2name,
                winner: receiverTeamName,
                teamARuns: giverIsTeamA ? 0 : 1,
                teamAWkts: 0,
                teamBRuns: giverIsTeamA ? 1 : 0,
                teamBWkts: 0
            });
        }
        catch (e) {
            console.error("Failed to auto-record PT result for free win:", e);
            return { ok: false, reason: 'pt_update_failed', giverTeamName, receiverTeamName, error: e };
        }
        await (0, auditLog_1.appendAdminAuditLog)({
            guildId: guild.id,
            actorId,
            commandName: 'freewin',
            summary: `${appliedByAdmin ? 'Admin confirmed' : 'Confirmed'} free win: **${giverTeamName}** -> **${receiverTeamName}**`,
            channelId: channel.id
        });
        await db.run('DELETE FROM match_reservations WHERE id = ?', reservation.id);
        this.removeStadiumChannel(channel.id);
        await this.lockChannel(guild, channel.id);
        await this.clearMatchChannelParticipants(channel, reservation);
        return {
            ok: true,
            giverTeamName,
            receiverTeamName,
            ptResult
        };
    }

    async lockReservedMatchChannel(guild, channelId, reservation) {
        const db = (0, database_1.getDB)();
        await this.lockChannel(guild, channelId);
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel)
            return;
        const teamRoles = await db.all('SELECT role_id FROM teams WHERE team_id IN (?, ?) AND role_id IS NOT NULL', reservation.team_a_id, reservation.team_b_id);
        for (const row of teamRoles) {
            if (row?.role_id) {
                await channel.permissionOverwrites.edit(row.role_id, { SendMessages: false }).catch(() => { });
            }
        }
    }

    async validateReserveEligibility(guildId, seasonName, reservation, options = {}) {
        const db = (0, database_1.getDB)();
        const allowAdminOverride = options.allowAdminOverride === true;
        if (!reservation) {
            return { ok: false, reason: 'missing', message: "Error: No active match was found for reserve handling." };
        }
        if (Number.isInteger(reservation.reserve_day_number) || parseReserveDayNumber(reservation.fixture_day_number || reservation.day_number) !== null) {
            if (allowAdminOverride) {
                return { ok: true, fixtureDayNumber: null, groupLetter: 'LEAGUE', overrideAllowed: true, contextLabel: 'reserve match' };
            }
            return { ok: false, reason: 'reserve_day', message: "Error: Only admins can apply reserve in reserve matches." };
        }
        const fixtureDayNumber = reservation.fixture_day_number && /^\d+$/.test(String(reservation.fixture_day_number).trim())
            ? parseInt(String(reservation.fixture_day_number).trim(), 10)
            : null;
        if (!fixtureDayNumber) {
            return { ok: false, reason: 'non_normal_fixture', message: "Error: Reserve can only be used in normal league/group-stage fixtures." };
        }
        const fixture = await db.get(`SELECT day_number, group_letter
            FROM generated_fixtures
            WHERE guild_id = ? AND season_name = ? AND day_number = ?
              AND ((team_a_id = ? AND team_b_id = ?) OR (team_a_id = ? AND team_b_id = ?))
            ORDER BY CASE WHEN stadium_id = ? THEN 0 ELSE 1 END
            LIMIT 1`, guildId, seasonName, fixtureDayNumber, reservation.team_a_id, reservation.team_b_id, reservation.team_b_id, reservation.team_a_id, reservation.stadium_channel_id || null);
        if (!fixture) {
            return { ok: false, reason: 'non_normal_fixture', message: "Error: Reserve can only be used in normal league/group-stage fixtures." };
        }
        if (String(fixture.group_letter || '').toUpperCase() === 'PLAYOFF') {
            if (allowAdminOverride) {
                return { ok: true, fixtureDayNumber, groupLetter: 'PLAYOFF', overrideAllowed: true, contextLabel: 'playoff fixture' };
            }
            return { ok: false, reason: 'playoff', message: "Error: Only admins can apply reserve in playoff matches." };
        }
        return { ok: true, fixtureDayNumber, groupLetter: fixture.group_letter || 'LEAGUE', overrideAllowed: false, contextLabel: 'league fixture' };
    }

    async reserveMatch(message, args) {
        const db = (0, database_1.getDB)();
        const guildId = message.guild.id;
        const activeSeason = await this.getActiveScheduleSeason(guildId);
        if (!activeSeason) return message.reply("❌ No scheduling season set. Use `?sss [Name]` first.");

        const isAdm = (0, utils_1.isAdmin)(message.member);
        if (isAdm && args.length === 0) {
            const activeReservation = await db.get(`
                SELECT r.*, t1.team_name as t1name, t2.team_name as t2name,
                       COALESCE(tc1.captain_discord_id, t1.owner_discord_id) as cap1,
                       COALESCE(tc2.captain_discord_id, t2.owner_discord_id) as cap2,
                       tvc1.vice_captain_discord_id as vc1,
                       tvc2.vice_captain_discord_id as vc2
                FROM match_reservations r
                JOIN teams t1 ON r.team_a_id = t1.team_id
                JOIN teams t2 ON r.team_b_id = t2.team_id
                LEFT JOIN team_captains tc1 ON r.team_a_id = tc1.team_id AND tc1.guild_id = r.guild_id
                LEFT JOIN team_captains tc2 ON r.team_b_id = tc2.team_id AND tc2.guild_id = r.guild_id
                LEFT JOIN team_vice_captains tvc1 ON r.team_a_id = tvc1.team_id AND tvc1.guild_id = r.guild_id
                LEFT JOIN team_vice_captains tvc2 ON r.team_b_id = tvc2.team_id AND tvc2.guild_id = r.guild_id
                WHERE r.guild_id = ? AND r.stadium_channel_id = ? AND r.season_name = ? AND r.status IN ('PENDING', 'OPEN', 'SCHEDULED')
                ORDER BY r.created_at DESC LIMIT 1
            `, guildId, message.channel.id, activeSeason);
            if (!activeReservation) {
                return message.reply("Use `?reserve` in an active fixture stadium channel, or use `?adminreserve day <number> @ReserveTeam @OpponentTeam`.");
            }
            const eligibility = await this.validateReserveEligibility(guildId, activeSeason, activeReservation, { allowAdminOverride: true });
            if (!eligibility.ok) {
                return message.reply(eligibility.message);
            }
            const actionRow = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder()
                .setCustomId(`admin_reserve_team_a_${message.id}`)
                .setLabel(`Reserved by ${activeReservation.t1name}`.slice(0, 80))
                .setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder()
                .setCustomId(`admin_reserve_team_b_${message.id}`)
                .setLabel(`Reserved by ${activeReservation.t2name}`.slice(0, 80))
                .setStyle(discord_js_1.ButtonStyle.Secondary), new discord_js_1.ButtonBuilder()
                .setCustomId(`admin_reserve_no_count_${message.id}`)
                .setLabel('Reserve by Admin')
                .setStyle(discord_js_1.ButtonStyle.Primary), new discord_js_1.ButtonBuilder()
                .setCustomId(`admin_reserve_cancel_${message.id}`)
                .setLabel('Cancel')
                .setStyle(discord_js_1.ButtonStyle.Danger));
            const promptMessage = await message.reply({
                content: `Who should this reserve be applied to for **${activeReservation.t1name}** vs **${activeReservation.t2name}**?\nChoose **Reserve by Admin** if the reserve should not reduce either team's reserve limit.`,
                components: [actionRow]
            });
            const interaction = await awaitComponent(promptMessage, { filter: i => i.user.id === message.author.id, time: 60000 }, 'Error: Reserve selection timed out.', 'Warning: Failed to choose the reserve team.');
            if (!interaction)
                return;
            if (interaction.customId === `admin_reserve_cancel_${message.id}`) {
                await interaction.update({ content: 'Reserve action cancelled.', components: [] }).catch(() => null);
                return;
            }
            const isAdminTeamSelection = interaction.customId === `admin_reserve_no_count_${message.id}`;
            const reserveTeamId = isAdminTeamSelection
                ? null
                : (interaction.customId === `admin_reserve_team_a_${message.id}` ? activeReservation.team_a_id : activeReservation.team_b_id);
            const reserveTeamName = isAdminTeamSelection
                ? 'Admin Team'
                : (interaction.customId === `admin_reserve_team_a_${message.id}` ? activeReservation.t1name : activeReservation.t2name);
            const result = await this.applyReserveToReservation(message.guild, message.channel, activeReservation, reserveTeamId, reserveTeamName, message.author.id, true, !isAdminTeamSelection);
            if (!result.ok) {
                if (result.reason === 'limit') {
                    await interaction.update({ content: `Error: **${reserveTeamName}** has already reached the maximum reserve limit of **${result.limit}** for this season.`, components: [] }).catch(() => null);
                    return;
                }
                await interaction.update({ content: result.message || 'Warning: Failed to apply the reserve.', components: [] }).catch(() => null);
                return;
            }
            await interaction.update({
                content: isAdminTeamSelection
                    ? "Done: Admin reserve applied without reducing either team's reserve limit."
                    : `Done: Reserve applied by admin for **${reserveTeamName}**.`,
                components: []
            }).catch(() => null);
            return;
        }
        const team = await this.getCaptainTeam(guildId, message.author.id, message.member);
        if (!team) return message.reply("❌ You are not linked to a team.");

        let opponentTeam = null;
        const targetMention = message.mentions.users.first();
        const roleMention = message.mentions.roles.first();

        if (roleMention) opponentTeam = await this.getTeamByName(guildId, roleMention.name);
        else if (targetMention) opponentTeam = await this.getCaptainTeam(guildId, targetMention.id);
        else if (args.length > 0) opponentTeam = await this.getTeamByName(guildId, args.join(' '));

        if (!opponentTeam && args.length === 0) {
            const openMatch = await db.get(`SELECT r.*, t1.team_name as t1n, t2.team_name as t2n FROM match_reservations r JOIN teams t1 ON r.team_a_id = t1.team_id JOIN teams t2 ON r.team_b_id = t2.team_id WHERE r.guild_id = ? AND r.status = 'OPEN' AND r.season_name = ? AND (r.team_a_id = ? OR r.team_b_id = ?) ORDER BY r.created_at DESC LIMIT 1`, guildId, activeSeason, team.team_id, team.team_id);
            if (!openMatch) return message.reply("Usage: `?reserve @Opponent` or confirm a match opened by Admin via `?schedule`.");
            const eligibility = await this.validateReserveEligibility(guildId, activeSeason, openMatch);
            if (!eligibility.ok)
                return message.reply(eligibility.message);
            await db.run('UPDATE match_reservations SET status = "PENDING", reserved_by_captain_id = ? WHERE id = ?', message.author.id, openMatch.id);
            return message.reply({ embeds: [new discord_js_1.EmbedBuilder().setDescription(`✅ Match Reserved: **${openMatch.t1n}** vs **${openMatch.t2n}**`).setColor(0x00FF00)] });
        }

        if (!opponentTeam || opponentTeam.team_id === team.team_id) return message.reply("❌ Invalid opponent.");
        await db.run('INSERT INTO match_reservations (guild_id, season_name, team_a_id, team_b_id, reserved_by_captain_id, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)', guildId, activeSeason, team.team_id, opponentTeam.team_id, message.author.id, Math.floor(Date.now()/1000), 'PENDING');
        message.reply({ embeds: [new discord_js_1.EmbedBuilder().setDescription(`✅ Match Reserved: **${team.team_name}** vs **${opponentTeam.team_name}**`).setColor(0x00FF00)] });
    }

    async freeWinMatchCommand(message, args) {
        const db = (0, database_1.getDB)();
        const guildId = message.guild.id;
        const reservation = await db.get(`
            SELECT r.*, t1.team_name as t1name, t2.team_name as t2name,
                   COALESCE(tc1.captain_discord_id, t1.owner_discord_id) as cap1,
                   COALESCE(tc2.captain_discord_id, t2.owner_discord_id) as cap2,
                   tvc1.vice_captain_discord_id as vc1,
                   tvc2.vice_captain_discord_id as vc2
            FROM match_reservations r
            JOIN teams t1 ON r.team_a_id = t1.team_id
            JOIN teams t2 ON r.team_b_id = t2.team_id
            LEFT JOIN team_captains tc1 ON r.team_a_id = tc1.team_id AND tc1.guild_id = r.guild_id
            LEFT JOIN team_captains tc2 ON r.team_b_id = tc2.team_id AND tc2.guild_id = r.guild_id
            LEFT JOIN team_vice_captains tvc1 ON r.team_a_id = tvc1.team_id AND tvc1.guild_id = r.guild_id
            LEFT JOIN team_vice_captains tvc2 ON r.team_b_id = tvc2.team_id AND tvc2.guild_id = r.guild_id
            WHERE r.guild_id = ? AND r.stadium_channel_id = ? AND r.status IN ('PENDING', 'OPEN', 'SCHEDULED')
            ORDER BY r.created_at DESC LIMIT 1
        `, guildId, message.channel.id);
        if (!reservation) {
            return message.reply("Use `?freewin` in an active fixture stadium channel.");
        }
        const isAdm = (0, utils_1.isAdmin)(message.member);
        const isTeam1 = message.author.id === reservation.cap1 || message.author.id === reservation.vc1;
        const isTeam2 = message.author.id === reservation.cap2 || message.author.id === reservation.vc2;
        if (!isAdm && !isTeam1 && !isTeam2) {
            return message.reply("Only the current captain or vice-captain of either team can use `?freewin` here.");
        }
        if (isAdm) {
            const teamAButtonId = `admin_freewin_team_a_${message.id}`;
            const teamBButtonId = `admin_freewin_team_b_${message.id}`;
            const cancelButtonId = `admin_freewin_cancel_${message.id}`;
            const selectRow = new discord_js_1.ActionRowBuilder().addComponents(
                new discord_js_1.ButtonBuilder().setCustomId(teamAButtonId).setLabel(`${reservation.t1name} gives free win`.slice(0, 80)).setStyle(discord_js_1.ButtonStyle.Secondary),
                new discord_js_1.ButtonBuilder().setCustomId(teamBButtonId).setLabel(`${reservation.t2name} gives free win`.slice(0, 80)).setStyle(discord_js_1.ButtonStyle.Secondary),
                new discord_js_1.ButtonBuilder().setCustomId(cancelButtonId).setLabel('Cancel').setStyle(discord_js_1.ButtonStyle.Danger)
            );
            const prompt = await message.reply({
                content: `Who is conceding the free win for **${reservation.t1name}** vs **${reservation.t2name}**?`,
                components: [selectRow]
            });
            const selection = await awaitComponent(prompt, {
                filter: i => i.user.id === message.author.id && [teamAButtonId, teamBButtonId, cancelButtonId].includes(i.customId),
                time: 60000
            }, 'Error: Free win selection timed out.', 'Warning: Failed to choose the team giving the free win.');
            if (!selection) {
                return;
            }
            if (selection.customId === cancelButtonId) {
                await selection.update({ content: 'Free win action cancelled.', components: [] }).catch(() => null);
                return;
            }
            const giverTeamId = selection.customId === teamAButtonId ? reservation.team_a_id : reservation.team_b_id;
            const giverTeamName = giverTeamId === reservation.team_a_id ? reservation.t1name : reservation.t2name;
            const receiverTeamName = giverTeamId === reservation.team_a_id ? reservation.t2name : reservation.t1name;
            const confirmId = `admin_freewin_confirm_${message.id}`;
            const confirmCancelId = `admin_freewin_confirm_cancel_${message.id}`;
            const confirmRow = new discord_js_1.ActionRowBuilder().addComponents(
                new discord_js_1.ButtonBuilder().setCustomId(confirmId).setLabel('Confirm Free Win').setStyle(discord_js_1.ButtonStyle.Danger),
                new discord_js_1.ButtonBuilder().setCustomId(confirmCancelId).setLabel('Cancel').setStyle(discord_js_1.ButtonStyle.Secondary)
            );
            await selection.update({
                content: `Confirm: **${giverTeamName}** is giving a **FREE WIN** to **${receiverTeamName}**.`,
                components: [confirmRow]
            }).catch(() => null);
            const confirmation = await awaitComponent(prompt, {
                filter: i => i.user.id === message.author.id && [confirmId, confirmCancelId].includes(i.customId),
                time: 30000
            }, 'Free win confirmation timed out.');
            if (!confirmation || confirmation.customId === confirmCancelId) {
                if (confirmation) {
                    await confirmation.update({ content: 'Free win cancelled.', components: [] }).catch(() => null);
                }
                return;
            }
            const applied = await this.applyFreeWinToReservation(message.guild, message.channel, reservation, giverTeamId, message.author.id, true);
            if (!applied.ok) {
                await confirmation.update({
                    content: `Error: I couldn't record the free win because the point table update failed. ${applied.error?.message || ''}`.trim(),
                    components: []
                }).catch(() => null);
                return;
            }
            const groupText = applied.ptResult?.groupLetter && applied.ptResult.groupLetter !== 'LEAGUE' ? `\nGroup: **${applied.ptResult.groupLetter}**` : '';
            await confirmation.update({
                content: `Done: **${applied.giverTeamName}** gave a **FREE WIN** to **${applied.receiverTeamName}**.\nPT updated automatically for **Season ${applied.ptResult.season} Match ${applied.ptResult.matchNumber}**.${groupText}`,
                components: []
            }).catch(() => null);
            return;
        }
        const giverTeamId = isTeam1 ? reservation.team_a_id : reservation.team_b_id;
        const giverTeamName = giverTeamId === reservation.team_a_id ? reservation.t1name : reservation.t2name;
        const receiverTeamName = giverTeamId === reservation.team_a_id ? reservation.t2name : reservation.t1name;
        const confirmId = `freewin_confirm_${message.id}`;
        const cancelId = `freewin_cancel_${message.id}`;
        const row = new discord_js_1.ActionRowBuilder().addComponents(
            new discord_js_1.ButtonBuilder().setCustomId(confirmId).setLabel('Confirm Free Win').setStyle(discord_js_1.ButtonStyle.Danger),
            new discord_js_1.ButtonBuilder().setCustomId(cancelId).setLabel('Cancel').setStyle(discord_js_1.ButtonStyle.Secondary)
        );
        const prompt = await message.reply({
            content: `Confirm: **${giverTeamName}** is giving a **FREE WIN** to **${receiverTeamName}**.`,
            components: [row]
        });
        const confirmation = await awaitComponent(prompt, {
            filter: i => i.user.id === message.author.id && [confirmId, cancelId].includes(i.customId),
            time: 30000
        }, 'Free win timed out.');
        if (!confirmation || confirmation.customId === cancelId) {
            if (confirmation) {
                await confirmation.update({ content: 'Free win cancelled.', components: [] }).catch(() => null);
            }
            return;
        }
        const applied = await this.applyFreeWinToReservation(message.guild, message.channel, reservation, giverTeamId, message.author.id, false);
        if (!applied.ok) {
            await confirmation.update({
                content: `Error: I couldn't record the free win because the point table update failed. ${applied.error?.message || ''}`.trim(),
                components: []
            }).catch(() => null);
            return;
        }
        const groupText = applied.ptResult?.groupLetter && applied.ptResult.groupLetter !== 'LEAGUE' ? `\nGroup: **${applied.ptResult.groupLetter}**` : '';
        await confirmation.update({
            content: `Done: **${applied.giverTeamName}** gave a **FREE WIN** to **${applied.receiverTeamName}**.\nPT updated automatically for **Season ${applied.ptResult.season} Match ${applied.ptResult.matchNumber}**.${groupText}`,
            components: []
        }).catch(() => null);
    }

    async freeWinMatch(message, args) {
        const db = (0, database_1.getDB)();
        const guildId = message.guild.id;
        const reservation = await db.get(`
            SELECT r.*, t1.team_name as t1name, t2.team_name as t2name,
                   COALESCE(tc1.captain_discord_id, t1.owner_discord_id) as cap1,
                   COALESCE(tc2.captain_discord_id, t2.owner_discord_id) as cap2,
                   tvc1.vice_captain_discord_id as vc1,
                   tvc2.vice_captain_discord_id as vc2
            FROM match_reservations r
            JOIN teams t1 ON r.team_a_id = t1.team_id
            JOIN teams t2 ON r.team_b_id = t2.team_id
            LEFT JOIN team_captains tc1 ON r.team_a_id = tc1.team_id AND tc1.guild_id = r.guild_id
            LEFT JOIN team_captains tc2 ON r.team_b_id = tc2.team_id AND tc2.guild_id = r.guild_id
            LEFT JOIN team_vice_captains tvc1 ON r.team_a_id = tvc1.team_id AND tvc1.guild_id = r.guild_id
            LEFT JOIN team_vice_captains tvc2 ON r.team_b_id = tvc2.team_id AND tvc2.guild_id = r.guild_id
            WHERE r.guild_id = ? AND r.stadium_channel_id = ? AND r.status IN ('PENDING', 'OPEN', 'SCHEDULED')
            ORDER BY r.created_at DESC LIMIT 1
        `, guildId, message.channel.id);
        if (!reservation) {
            return message.reply("Use `?freewin` in an active fixture stadium channel.");
        }
        const isAdm = (0, utils_1.isAdmin)(message.member);
        const isTeam1 = message.author.id === reservation.cap1 || message.author.id === reservation.vc1;
        const isTeam2 = message.author.id === reservation.cap2 || message.author.id === reservation.vc2;
        if (!isAdm && !isTeam1 && !isTeam2) {
            return message.reply("Only the current captain or vice-captain of either team can use `?freewin` here.");
        }
        let giverTeamId = null;
        if (isAdm) {
            const cancelPromptId = `admin_freewin_cancel_${message.id}`;
            const selectRow = new discord_js_1.ActionRowBuilder().addComponents(
                new discord_js_1.ButtonBuilder().setCustomId(`admin_freewin_team_a_${message.id}`).setLabel(`${reservation.t1name} gives free win`.slice(0, 80)).setStyle(discord_js_1.ButtonStyle.Secondary),
                new discord_js_1.ButtonBuilder().setCustomId(`admin_freewin_team_b_${message.id}`).setLabel(`${reservation.t2name} gives free win`.slice(0, 80)).setStyle(discord_js_1.ButtonStyle.Secondary),
                new discord_js_1.ButtonBuilder().setCustomId(cancelPromptId).setLabel('Cancel').setStyle(discord_js_1.ButtonStyle.Danger)
            );
            const prompt = await message.reply({
                content: `Who is conceding the free win for **${reservation.t1name}** vs **${reservation.t2name}**?`,
                components: [selectRow]
            });
            const selection = await awaitComponent(prompt, {
                filter: i => i.user.id === message.author.id && [ `admin_freewin_team_a_${message.id}`, `admin_freewin_team_b_${message.id}`, cancelPromptId ].includes(i.customId),
                time: 60000
            }, 'Error: Free win selection timed out.', 'Warning: Failed to choose the team giving the free win.');
            if (!selection) {
                return;
            }
            if (selection.customId === cancelPromptId) {
                await selection.update({ content: 'Free win action cancelled.', components: [] }).catch(() => null);
                return;
            }
            giverTeamId = selection.customId === `admin_freewin_team_a_${message.id}` ? reservation.team_a_id : reservation.team_b_id;
            const giverTeamName = giverTeamId === reservation.team_a_id ? reservation.t1name : reservation.t2name;
            const receiverTeamName = giverTeamId === reservation.team_a_id ? reservation.t2name : reservation.t1name;
            const confirmId = `admin_freewin_confirm_${message.id}`;
            const confirmCancelId = `admin_freewin_confirm_cancel_${message.id}`;
            const confirmRow = new discord_js_1.ActionRowBuilder().addComponents(
                new discord_js_1.ButtonBuilder().setCustomId(confirmId).setLabel('Confirm Free Win').setStyle(discord_js_1.ButtonStyle.Danger),
                new discord_js_1.ButtonBuilder().setCustomId(confirmCancelId).setLabel('Cancel').setStyle(discord_js_1.ButtonStyle.Secondary)
            );
            await selection.update({
                content: `âš ï¸ **${giverTeamName}** is giving a **FREE WIN** to **${receiverTeamName}**. Confirm?`,
                components: [confirmRow]
            }).catch(() => null);
            const confirmation = await awaitComponent(prompt, {
                filter: i => i.user.id === message.author.id && [confirmId, confirmCancelId].includes(i.customId),
                time: 30000
            }, 'âŒ Free win confirmation timed out.');
            if (!confirmation || confirmation.customId === confirmCancelId) {
                if (confirmation) {
                    await confirmation.update({ content: 'Free win cancelled.', components: [] }).catch(() => null);
                }
                return;
            }
            const applied = await this.applyFreeWinToReservation(message.guild, message.channel, reservation, giverTeamId, message.author.id, true);
            if (!applied.ok) {
                await confirmation.update({
                    content: `âŒ I couldn't record the free win because the point table update failed. ${applied.error?.message || ''}`.trim(),
                    components: []
                }).catch(() => null);
                return;
            }
            const groupText = applied.ptResult?.groupLetter && applied.ptResult.groupLetter !== 'LEAGUE' ? `\nGroup: **${applied.ptResult.groupLetter}**` : '';
            await confirmation.update({
                content: `âœ… **${applied.giverTeamName}** gave a **FREE WIN** to **${applied.receiverTeamName}**.\nPT updated automatically for **Season ${applied.ptResult.season} Match ${applied.ptResult.matchNumber}**.${groupText}`,
                components: []
            }).catch(() => null);
            return;
        }
        giverTeamId = isTeam1 ? reservation.team_a_id : reservation.team_b_id;
        const giverTeamName = giverTeamId === reservation.team_a_id ? reservation.t1name : reservation.t2name;
        const receiverTeamName = giverTeamId === reservation.team_a_id ? reservation.t2name : reservation.t1name;
        const confirmId = `freewin_confirm_${message.id}`;
        const cancelId = `freewin_cancel_${message.id}`;
        const row = new discord_js_1.ActionRowBuilder().addComponents(
            new discord_js_1.ButtonBuilder().setCustomId(confirmId).setLabel('Confirm Free Win').setStyle(discord_js_1.ButtonStyle.Danger),
            new discord_js_1.ButtonBuilder().setCustomId(cancelId).setLabel('Cancel').setStyle(discord_js_1.ButtonStyle.Secondary)
        );
        const prompt = await message.reply({
            content: `âš ï¸ **${giverTeamName}** is giving a **FREE WIN** to **${receiverTeamName}**. Are you sure?`,
            components: [row]
        });
        const confirmation = await awaitComponent(prompt, { filter: i => i.user.id === message.author.id && [confirmId, cancelId].includes(i.customId), time: 30000 }, 'âŒ Free win timed out.');
        if (!confirmation || confirmation.customId === cancelId) {
            if (confirmation) {
                await confirmation.update({ content: 'âŒ Free win cancelled.', components: [] }).catch(() => null);
            }
            return;
        }
        const applied = await this.applyFreeWinToReservation(message.guild, message.channel, reservation, giverTeamId, message.author.id, false);
        if (!applied.ok) {
            await confirmation.update({
                content: `âŒ I couldn't record the free win because the point table update failed. ${applied.error?.message || ''}`.trim(),
                components: []
            }).catch(() => null);
            return;
        }
        const groupText = applied.ptResult?.groupLetter && applied.ptResult.groupLetter !== 'LEAGUE' ? `\nGroup: **${applied.ptResult.groupLetter}**` : '';
        await confirmation.update({
            content: `âœ… **${applied.giverTeamName}** gave a **FREE WIN** to **${applied.receiverTeamName}**.\nPT updated automatically for **Season ${applied.ptResult.season} Match ${applied.ptResult.matchNumber}**.${groupText}`,
            components: []
        }).catch(() => null);
    }

    async scheduleMatch(message, args) {
        if (args.length === 0) {
            return await this.showFixtureScheduleQueue(message, 'schedule');
        }
        const db = (0, database_1.getDB)();
        const guildId = message.guild.id;
        const isAdm = (0, utils_1.isAdmin)(message.member);
        const activeSeason = await this.getActiveScheduleSeason(guildId);
        if (!activeSeason) return message.reply("❌ No scheduling season set. Use `?sss [Name]` first.");

        let cap1Id, cap2Id;
        const users = message.mentions.users;
        const roles = message.mentions.roles;
        const caps = [];
        for (const [id] of users) caps.push(id);
        for (const [id, role] of roles) { const cid = await this.getCaptainFromTeamRole(guildId, role); if (cid) caps.push(cid); }

        if (caps.length >= 2) { cap1Id = caps[0]; cap2Id = caps[1]; }
        else if (caps.length === 1) { cap1Id = message.author.id; cap2Id = caps[0]; }
        else return message.reply("❌ Usage: `?schedule @Team1 @Team2` or `?schedule` to view all.");

        if (cap1Id === cap2Id) return message.reply("❌ Select different teams.");
        const t1 = await this.getCaptainTeam(guildId, cap1Id);
        const t2 = await this.getCaptainTeam(guildId, cap2Id);
        if (!t1 || !t2) return message.reply("❌ Teams not found. Ensure both captains are registered.");

        let res = await db.get(`SELECT r.*, t1.team_name as t1n, t2.team_name as t2n FROM match_reservations r JOIN teams t1 ON r.team_a_id = t1.team_id JOIN teams t2 ON r.team_b_id = t2.team_id WHERE r.guild_id = ? AND r.season_name = ? AND ((r.team_a_id=? AND r.team_b_id=?) OR (r.team_a_id=? AND r.team_b_id=?)) AND r.status IN ('PENDING', 'OPEN') ORDER BY r.created_at ASC LIMIT 1`, guildId, activeSeason, t1.team_id, t2.team_id, t2.team_id, t1.team_id);

        if (!res && isAdm) {
            await db.run('INSERT INTO match_reservations (guild_id, season_name, team_a_id, team_b_id, reserved_by_captain_id, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)', guildId, activeSeason, t1.team_id, t2.team_id, message.author.id, Math.floor(Date.now()/1000), 'OPEN');
            res = await db.get('SELECT r.*, t1.team_name as t1n, t2.team_name as t2n FROM match_reservations r JOIN teams t1 ON r.team_a_id = t1.team_id JOIN teams t2 ON r.team_b_id = t2.team_id WHERE r.guild_id = ? AND status = "OPEN" ORDER BY r.created_at DESC LIMIT 1', guildId);
        } else if (!res) return message.reply("❌ No match found.");

        const embed = new discord_js_1.EmbedBuilder().setTitle(`Match Scheduling: ${activeSeason}`).setDescription(`Captains <@${cap1Id}> and <@${cap2Id}>, please decide time for **${res.t1n}** vs **${res.t2n}**.\n\nSimply type the time (e.g., 8:30 PM) or "done" to confirm.`).setColor(0xFFA500);
        message.reply({ content: `<@${cap1Id}> <@${cap2Id}>`, embeds: [embed] });
    }

    async parseTimeToTimestamp(timeStr, guildId) {
        // Robust time matching
        const match = timeStr.match(/(\d{1,4})[:\s]?(\d{2})?\s*(AM|PM)?/i);
        if (!match) return null;

        let hrs = parseInt(match[1]);
        let mins = match[2] ? parseInt(match[2]) : 0;
        const ampm = match[3];

        // Handle case like "830" or "2030"
        if (match[1].length >= 3 && !match[2]) {
            hrs = parseInt(match[1].substring(0, match[1].length - 2));
            mins = parseInt(match[1].substring(match[1].length - 2));
        }

        if (hrs > 24 || mins >= 60) return null; // Basic validation

        const db = (0, database_1.getDB)();
        const settings = await db.get('SELECT timezone FROM guild_settings WHERE guild_id = ?', guildId);
        let tz = settings ? settings.timezone : 'Asia/Kolkata';
        if (tz === 'IST') tz = 'Asia/Kolkata';

        if (ampm) {
            if (ampm.toUpperCase() === 'PM' && hrs < 12) hrs += 12;
            if (ampm.toUpperCase() === 'AM' && hrs === 12) hrs = 0;
        } else if (hrs <= 12) {
            // Default to PM if not specified (user said 99% of time it is PM)
            if (hrs < 12) hrs += 12;
        }
        if (hrs === 24) hrs = 0; // 24:00 is 00:00

        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            year: 'numeric', month: 'numeric', day: 'numeric',
            hour12: false
        });
        const parts = formatter.formatToParts(now);
        const getPart = (type) => {
            const p = parts.find(p => p.type === type);
            return p ? parseInt(p.value) : null;
        };
        
        const tYear = getPart('year');
        const tMonth = getPart('month');
        const tDay = getPart('day');

        if (tYear === null || tMonth === null || tDay === null) return null;

        const targetISO = `${tYear}-${String(tMonth).padStart(2, '0')}-${String(tDay).padStart(2, '0')}T${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:00`;
        
        const getOffset = (date, timeZone) => {
            if (isNaN(date.getTime())) return 0;
            try {
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
            } catch(e) { return 0; }
        };

        const tempDate = new Date(targetISO + 'Z'); 
        if (isNaN(tempDate.getTime())) return null;

        const offsetMins = getOffset(tempDate, tz);
        let scheduledTime = Math.floor((tempDate.getTime() - (offsetMins * 60000)) / 1000);

        if (!ampm && hrs <= 12 && scheduledTime < Math.floor(now.getTime() / 1000)) {
            const pmTime = scheduledTime + (12 * 3600);
            if (pmTime > Math.floor(now.getTime() / 1000)) {
                scheduledTime = pmTime;
            }
        }

        if (scheduledTime < Math.floor(now.getTime() / 1000)) {
            scheduledTime += 86400;
        }

        return scheduledTime;
    }

    async confirmSchedulingInput(message, displayTime, isKeywordConfirmation) {
        const row = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder()
            .setCustomId(`sched_confirm_${message.id}`)
            .setLabel('Confirm')
            .setStyle(discord_js_1.ButtonStyle.Success), new discord_js_1.ButtonBuilder()
            .setCustomId(`sched_cancel_${message.id}`)
            .setLabel('Cancel')
            .setStyle(discord_js_1.ButtonStyle.Danger));
        const prompt = await message.reply({
            content: isKeywordConfirmation
                ? `Confirm **${displayTime}** as your agreed match time?`
                : `I understood your message as **${displayTime}**. Confirm this time?`,
            components: [row]
        });
        const interaction = await awaitComponent(prompt, { filter: i => i.user.id === message.author.id, time: 60000 }, '❌ Scheduling confirmation timed out.');
        if (!interaction)
            return false;
        if (interaction.customId === `sched_cancel_${message.id}`) {
            await interaction.update({ content: 'Scheduling input cancelled.', components: [] }).catch(() => null);
            return false;
        }
        await interaction.update({ content: `✅ Confirmed **${displayTime}**.`, components: [] }).catch(() => null);
        return true;
    }

    async handlePotentialTimeAgreement(message) {
        if (!message.guild) return false;
        const rawContent = (message.content || '').trim();
        if (!rawContent)
            return false;
        const normalizedContent = normalizeSchedulingMessage(rawContent);
        const looksLikeKeyword = AGREEMENT_KEYWORDS.has(normalizedContent) || RESERVE_KEYWORDS.has(normalizedContent) || FREE_WIN_KEYWORDS.has(normalizedContent);
        const looksLikeTime = TIME_SNIPPET_REGEX.test(rawContent);
        if (!looksLikeKeyword && !looksLikeTime)
            return false;
        const guildId = message.guild.id;
        if (!await this.channelLikelyNeedsScheduling(guildId, message.channel.id))
            return false;
        const db = (0, database_1.getDB)();
        const res = await db.get(`
            SELECT r.*, t1.team_name as t1name, t2.team_name as t2name, 
                   COALESCE(tc1.captain_discord_id, t1.owner_discord_id) as cap1,
                   COALESCE(tc2.captain_discord_id, t2.owner_discord_id) as cap2,
                   tvc1.vice_captain_discord_id as vc1,
                   tvc2.vice_captain_discord_id as vc2
            FROM match_reservations r 
            JOIN teams t1 ON r.team_a_id = t1.team_id 
            JOIN teams t2 ON r.team_b_id = t2.team_id 
            LEFT JOIN team_captains tc1 ON r.team_a_id = tc1.team_id AND tc1.guild_id = r.guild_id
            LEFT JOIN team_captains tc2 ON r.team_b_id = tc2.team_id AND tc2.guild_id = r.guild_id
            LEFT JOIN team_vice_captains tvc1 ON r.team_a_id = tvc1.team_id AND tvc1.guild_id = r.guild_id
            LEFT JOIN team_vice_captains tvc2 ON r.team_b_id = tvc2.team_id AND tvc2.guild_id = r.guild_id
            WHERE r.guild_id = ? AND r.stadium_channel_id = ? AND r.status IN ('PENDING', 'OPEN')
            ORDER BY r.created_at DESC LIMIT 1
        `, guildId, message.channel.id);

        if (!res) {
            this.removeStadiumChannel(message.channel.id);
            return false;
        }

        this.markStadiumChannelActive(guildId, message.channel.id);

        const isTeam1 = message.author.id === res.cap1 || message.author.id === res.vc1;
        const isTeam2 = message.author.id === res.cap2 || message.author.id === res.vc2;
        if (!isTeam1 && !isTeam2) return false;

        if (RESERVE_KEYWORDS.has(normalizedContent) && (res.status === 'OPEN' || res.status === 'PENDING')) {
            const teamId = isTeam1 ? res.team_a_id : res.team_b_id;
            const teamName = isTeam1 ? res.t1name : res.t2name;
            const activeSeason = res.season_name;
            const eligibility = await this.validateReserveEligibility(guildId, activeSeason, res, { allowAdminOverride: false });
            if (!eligibility.ok) {
                return message.reply(eligibility.message);
            }
            const result = await this.applyReserveToReservation(message.guild, message.channel, res, teamId, teamName, message.author.id, false, true);
            if (!result.ok) {
                if (result.reason === 'limit') {
                    return message.reply(`❌ **${teamName}** has already reached the maximum reserve limit of **${result.limit}** for this season.`);
                }
                return message.reply(result.message || 'Warning: Failed to apply the reserve.');
            }
            message.reply({ embeds: [new discord_js_1.EmbedBuilder()
                .setTitle("Match Reserved / Postponed")
                .setDescription(`**${teamName}** has used a reserve.\n\n**Reserves used by ${teamName}:** ${result.usedCount}/${result.limit}`)
                .setColor(0xFFFF00)]
            });
            return true;
        }

        if (FREE_WIN_KEYWORDS.has(normalizedContent) && (res.status === 'OPEN' || res.status === 'PENDING')) {
            const giverTeamName = isTeam1 ? res.t1name : res.t2name;
            const receiverTeamName = isTeam1 ? res.t2name : res.t1name;
            const confirmId = `fw_confirm_ascii_${message.id}`;
            const cancelId = `fw_cancel_ascii_${message.id}`;
            const row = new discord_js_1.ActionRowBuilder().addComponents(
                new discord_js_1.ButtonBuilder().setCustomId(confirmId).setLabel('Confirm Free Win').setStyle(discord_js_1.ButtonStyle.Danger),
                new discord_js_1.ButtonBuilder().setCustomId(cancelId).setLabel('Cancel').setStyle(discord_js_1.ButtonStyle.Secondary)
            );
            const prompt = await message.reply({
                content: `Confirm: **${giverTeamName}** is giving a **FREE WIN** to **${receiverTeamName}**.`,
                components: [row]
            });
            const interaction = await awaitComponent(prompt, { filter: i => i.user.id === message.author.id && [confirmId, cancelId].includes(i.customId), time: 30000 }, 'Free win timed out.');
            if (!interaction || interaction.customId === cancelId) {
                if (interaction) {
                    await interaction.update({ content: 'Free win cancelled.', components: [] }).catch(() => null);
                }
                return true;
            }
            const applied = await this.applyFreeWinToReservation(message.guild, message.channel, res, isTeam1 ? res.team_a_id : res.team_b_id, message.author.id, false);
            if (!applied.ok) {
                await interaction.update({
                    content: `Error: I couldn't record the free win because the point table update failed. ${applied.error?.message || ''}`.trim(),
                    components: []
                }).catch(() => null);
                return true;
            }
            const groupText = applied.ptResult?.groupLetter && applied.ptResult.groupLetter !== 'LEAGUE' ? `\nGroup: **${applied.ptResult.groupLetter}**` : '';
            await interaction.update({
                content: `Done: **${giverTeamName}** gave a **FREE WIN** to **${receiverTeamName}**.\nPT updated automatically for **Season ${applied.ptResult.season} Match ${applied.ptResult.matchNumber}**.${groupText}`,
                components: []
            }).catch(() => null);
            return true;
        }
        if (false && FREE_WIN_KEYWORDS.has(normalizedContent) && (res.status === 'OPEN' || res.status === 'PENDING')) {
            const giverTeamName = isTeam1 ? res.t1name : res.t2name;
            const receiverTeamName = isTeam1 ? res.t2name : res.t1name;
            const confirmId = `fw_confirm_${message.id}`;
            const cancelId = `fw_cancel_${message.id}`;
            const row = new discord_js_1.ActionRowBuilder().addComponents(
                new discord_js_1.ButtonBuilder().setCustomId(confirmId).setLabel('Confirm Free Win').setStyle(discord_js_1.ButtonStyle.Danger),
                new discord_js_1.ButtonBuilder().setCustomId(cancelId).setLabel('Cancel').setStyle(discord_js_1.ButtonStyle.Secondary)
            );
            const prompt = await message.reply({
                content: `âš ï¸ **${giverTeamName}** is giving a **FREE WIN** to **${receiverTeamName}**. Are you sure?`,
                components: [row]
            });
            const interaction = await awaitComponent(prompt, { filter: i => i.user.id === message.author.id && [confirmId, cancelId].includes(i.customId), time: 30000 }, "âŒ Free win timed out.");
            if (!interaction || interaction.customId === cancelId) {
                if (interaction)
                    await interaction.update({ content: "âŒ Free win cancelled.", components: [] }).catch(() => null);
                return true;
            }
            const applied = await this.applyFreeWinToReservation(message.guild, message.channel, res, isTeam1 ? res.team_a_id : res.team_b_id, message.author.id, false);
            if (!applied.ok) {
                await interaction.update({
                    content: `âŒ I couldn't record the free win because the point table update failed. ${applied.error?.message || ''}`.trim(),
                    components: []
                }).catch(() => null);
                return true;
            }
            const groupText = applied.ptResult?.groupLetter && applied.ptResult.groupLetter !== 'LEAGUE' ? `\nGroup: **${applied.ptResult.groupLetter}**` : '';
            await interaction.update({
                content: `âœ… **Confirmed:** **${giverTeamName}** gave a **FREE WIN** to **${receiverTeamName}**.\nPT updated automatically for **Season ${applied.ptResult.season} Match ${applied.ptResult.matchNumber}**.${groupText}`,
                components: []
            }).catch(() => null);
            return true;
        }
        if (false && FREE_WIN_KEYWORDS.has(normalizedContent) && (res.status === 'OPEN' || res.status === 'PENDING')) {
            const giverTeamName = isTeam1 ? res.t1name : res.t2name;
            const receiverTeamName = isTeam1 ? res.t2name : res.t1name;

            const row = new discord_js_1.ActionRowBuilder().addComponents(
                new discord_js_1.ButtonBuilder().setCustomId('fw_confirm').setLabel('Confirm Free Win').setStyle(discord_js_1.ButtonStyle.Danger),
                new discord_js_1.ButtonBuilder().setCustomId('fw_cancel').setLabel('Cancel').setStyle(discord_js_1.ButtonStyle.Secondary)
            );
            const prompt = await message.reply({ 
                content: `⚠️ **${giverTeamName}** is giving a **FREE WIN** to **${receiverTeamName}**. Are you sure?`,
                components: [row]
            });

            const interaction = await awaitComponent(prompt, { filter: i => i.user.id === message.author.id, time: 30000 });
            if (!interaction || interaction.customId === 'fw_cancel') {
                if (interaction) await interaction.update({ content: "❌ Free win cancelled.", components: [] }).catch(() => null);
                else await prompt.edit({ content: "❌ Free win timed out.", components: [] }).catch(() => null);
                return true;
            }

            await interaction.update({ 
                content: `✅ **Confirmed:** **${giverTeamName}** gave a **FREE WIN** to **${receiverTeamName}**.\n\nAdmin will update the PT.`, 
                components: [] 
            }).catch(() => null);

            await (0, auditLog_1.appendAdminAuditLog)({
                guildId: message.guild.id,
                actorId: message.author.id,
                commandName: 'freewin',
                summary: `Free Win given: **${giverTeamName}** -> **${receiverTeamName}**`,
                channelId: message.channel.id
            });

            await db.run('DELETE FROM match_reservations WHERE id = ?', res.id);
            this.removeStadiumChannel(message.channel.id);
            await this.lockChannel(message.guild, message.channel.id);
            if (res.cap1) await message.channel.permissionOverwrites.delete(res.cap1).catch(() => {});
            if (res.cap2) await message.channel.permissionOverwrites.delete(res.cap2).catch(() => {});

            return true;
        }

        const isConfirmation = AGREEMENT_KEYWORDS.has(normalizedContent);
        let scheduledTime = await this.parseTimeToTimestamp(rawContent, guildId);
        
        if (!scheduledTime && !isConfirmation) return false;

        let ags = {}; try { ags = JSON.parse(res.agreement_time || "{}"); } catch(e) {}
        
        // Identify any existing agreement from the OTHER team
        const otherTeamIds = isTeam1 ? [res.cap2, res.vc2] : [res.cap1, res.vc1];
        let otherAgreedTime = null;
        for (const id of otherTeamIds) {
            if (id && ags[id]) {
                otherAgreedTime = ags[id];
                break;
            }
        }

        if (isConfirmation) {
            if (otherAgreedTime) {
                scheduledTime = otherAgreedTime;
            } else {
                return false; 
            }
        }

        if (!scheduledTime || isNaN(scheduledTime)) return false;

        const disp = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: 'numeric', hour12: true }).format(new Date(scheduledTime * 1000));
        const confirmed = await this.confirmSchedulingInput(message, disp, isConfirmation);
        if (!confirmed) return true;

        ags[message.author.id] = scheduledTime;
        await db.run('UPDATE match_reservations SET agreement_time = ? WHERE id = ?', JSON.stringify(ags), res.id);

        if (otherAgreedTime === scheduledTime) {
            await db.run('UPDATE match_reservations SET status = "SCHEDULED", scheduled_time = ?, agreement_time = NULL WHERE id = ?', scheduledTime, res.id);
            const t1 = await db.get('SELECT role_id, team_name FROM teams WHERE team_id = ?', res.team_a_id);
            const t2 = await db.get('SELECT role_id, team_name FROM teams WHERE team_id = ?', res.team_b_id);
            const ping1 = t1?.role_id ? `<@&${t1.role_id}>` : `**${t1?.team_name}**`;
            const ping2 = t2?.role_id ? `<@&${t2.role_id}>` : `**${t2?.team_name}**`;

            message.channel.send({ 
                content: `# ${ping1} vs ${ping2}`, 
                embeds: [new discord_js_1.EmbedBuilder().setTitle("Match Confirmed").setDescription(`Time: **${disp}** (IST) / <t:${scheduledTime}:F>\n\nStadium locked for everyone (including captains) until match time.`).setColor(0x00FF00)] 
            });
            
            // Lock for everyone
            await this.lockChannel(message.guild, message.channel.id);
            // Also explicitly revoke captain-specific overrides
            if (res.cap1) await message.channel.permissionOverwrites.delete(res.cap1).catch(() => {});
            if (res.cap2) await message.channel.permissionOverwrites.delete(res.cap2).catch(() => {});
            this.markStadiumChannelActive(guildId, message.channel.id);
        } else {
            message.reply(`✅ Request for **${disp}** recorded. Waiting for other team to say "done" or the same time.`);
            this.markStadiumChannelActive(guildId, message.channel.id);
        }
        
        return true;
    }

    async agreeTime(message, timeStr) {
        return await this.handlePotentialTimeAgreement(message);
    }

    // Developer note:
    // `match_reservations` is a legacy DB/table name from the older reserve
    // system. Today it is the main fixture scheduling state table for the bot.
    // One row here represents the current scheduling state for a fixture or
    // reserve fixture, including normal day opens, captain time agreement,
    // scheduled stadium state, reserve-day assignment, and completion history.
    // Do not read "reservation" here as "reserve match only". `RESERVED` is
    // just one possible status inside the broader fixture scheduling lifecycle.
    // When adding new logic, treat this table as fixture scheduling state first,
    // and reserve handling as one branch of that lifecycle.
    async resolveFixtureScheduleDayInfo(guildId, seasonName, fixtureState) {
        if (!fixtureState) {
            return { fixtureDayNumber: null, fixtureDayLabel: 'Unknown', reserveDayLabel: null };
        }
        let fixtureDayNumber = null;
        if (fixtureState.fixture_day_number && /^\d+$/.test(String(fixtureState.fixture_day_number).trim())) {
            fixtureDayNumber = parseInt(String(fixtureState.fixture_day_number).trim(), 10);
        }
        if (!fixtureDayNumber) {
            const db = (0, database_1.getDB)();
            let row = await db.get(`SELECT day_number
                FROM generated_fixtures
                WHERE guild_id = ? AND season_name = ? AND team_a_id = ? AND team_b_id = ? AND stadium_id = ?
                ORDER BY day_number ASC
                LIMIT 1`, guildId, seasonName, fixtureState.team_a_id, fixtureState.team_b_id, fixtureState.stadium_channel_id);
            if (!row) {
                row = await db.get(`SELECT day_number
                    FROM generated_fixtures
                    WHERE guild_id = ? AND season_name = ?
                      AND ((team_a_id = ? AND team_b_id = ?) OR (team_a_id = ? AND team_b_id = ?))
                    ORDER BY CASE WHEN stadium_id = ? THEN 0 ELSE 1 END, day_number ASC
                    LIMIT 1`, guildId, seasonName, fixtureState.team_a_id, fixtureState.team_b_id, fixtureState.team_b_id, fixtureState.team_a_id, fixtureState.stadium_channel_id);
            }
            if (row?.day_number !== undefined && row?.day_number !== null) {
                fixtureDayNumber = Number(row.day_number);
                if (fixtureState.id && Number.isInteger(fixtureDayNumber) && (!fixtureState.fixture_day_number || !String(fixtureState.fixture_day_number).trim()) && !Number.isInteger(fixtureState.reserve_day_number)) {
                    await db.run("UPDATE match_reservations SET fixture_day_number = ? WHERE id = ? AND (fixture_day_number IS NULL OR TRIM(fixture_day_number) = '')", String(fixtureDayNumber), fixtureState.id).catch(() => null);
                }
            }
        }
        return {
            fixtureDayNumber: Number.isInteger(fixtureDayNumber) ? fixtureDayNumber : null,
            fixtureDayLabel: Number.isInteger(fixtureDayNumber) ? `Day ${fixtureDayNumber}` : 'Unknown',
            reserveDayLabel: Number.isInteger(fixtureState.reserve_day_number) ? `Reserve Day ${fixtureState.reserve_day_number}` : 'Not assigned'
        };
    }

    async resolveReservationDayInfo(guildId, seasonName, reservation) {
        return this.resolveFixtureScheduleDayInfo(guildId, seasonName, reservation);
    }

    async buildFixtureScheduleSnapshot(guildId, seasonName) {
        const db = (0, database_1.getDB)();
        const fixtures = await db.all(`SELECT gf.*, t1.team_name AS team_a_name, t2.team_name AS team_b_name
            FROM generated_fixtures gf
            JOIN teams t1 ON gf.team_a_id = t1.team_id
            JOIN teams t2 ON gf.team_b_id = t2.team_id
            WHERE gf.guild_id = ? AND gf.season_name = ?
            ORDER BY gf.day_number ASC, gf.team_a_id ASC, gf.team_b_id ASC`, guildId, seasonName);
        if (!fixtures.length) {
            return {
                entries: [],
                entriesByDay: new Map(),
                reserveUsageMap: new Map(),
                declaredReserveCount: 0
            };
        }
        const reserveUsageRows = await db.all(`SELECT team_id, used_count
            FROM team_reservations
            WHERE guild_id = ? AND season_name = ? AND used_count > 0`, guildId, seasonName);
        const reserveUsageMap = new Map();
        let declaredReserveCount = 0;
        for (const row of reserveUsageRows) {
            const usedCount = Number(row.used_count) || 0;
            if (usedCount <= 0) {
                continue;
            }
            reserveUsageMap.set(row.team_id, usedCount);
            declaredReserveCount += usedCount;
        }
        const teamNameToId = new Map();
        for (const fixture of fixtures) {
            if (!teamNameToId.has(fixture.team_a_name)) {
                teamNameToId.set(fixture.team_a_name, fixture.team_a_id);
            }
            if (!teamNameToId.has(fixture.team_b_name)) {
                teamNameToId.set(fixture.team_b_name, fixture.team_b_id);
            }
        }
        const ptSeasonNumber = parseSeasonNumber(seasonName);
        const ptRows = ptSeasonNumber === null
            ? []
            : await db.all('SELECT team_a, team_b FROM pt_matches WHERE guild_id = ? AND season = ?', guildId, ptSeasonNumber).catch(() => []);
        const ptCompletionCounts = new Map();
        for (const row of ptRows) {
            const teamAId = teamNameToId.get(row.team_a);
            const teamBId = teamNameToId.get(row.team_b);
            if (!teamAId || !teamBId) {
                continue;
            }
            const pairKey = normalizePairKey(teamAId, teamBId);
            ptCompletionCounts.set(pairKey, (ptCompletionCounts.get(pairKey) || 0) + 1);
        }
        const pairOccurrenceCounts = new Map();
        const entries = [];
        const entriesByDay = new Map();
        for (const fixture of fixtures) {
            const pairKey = normalizePairKey(fixture.team_a_id, fixture.team_b_id);
            const occurrenceIndex = pairOccurrenceCounts.get(pairKey) || 0;
            pairOccurrenceCounts.set(pairKey, occurrenceIndex + 1);
            const reservation = await this.findFixtureScheduleForFixture(guildId, seasonName, { ...fixture, day_number: fixture.day_number }, ['COMPLETED', 'RESERVED', 'OPEN', 'PENDING', 'SCHEDULED']);
            const dayInfo = reservation
                ? await this.resolveFixtureScheduleDayInfo(guildId, seasonName, reservation)
                : {
                    fixtureDayNumber: Number(fixture.day_number),
                    fixtureDayLabel: `Day ${fixture.day_number}`,
                    reserveDayLabel: 'Not assigned'
                };
            const entry = {
                fixture,
                reservation,
                pairKey,
                occurrenceIndex,
                status: 'UNRESOLVED',
                dayInfo,
                inferred: false,
                label: `${fixture.team_a_name} vs ${fixture.team_b_name}`
            };
            entries.push(entry);
            const dayEntries = entriesByDay.get(Number(fixture.day_number)) || [];
            dayEntries.push(entry);
            entriesByDay.set(Number(fixture.day_number), dayEntries);
        }
        const entriesByPair = new Map();
        for (const entry of entries) {
            const pairEntries = entriesByPair.get(entry.pairKey) || [];
            pairEntries.push(entry);
            entriesByPair.set(entry.pairKey, pairEntries);
        }
        for (const [pairKey, pairEntries] of entriesByPair.entries()) {
            pairEntries.sort((a, b) => a.occurrenceIndex - b.occurrenceIndex);
            let remainingCompleted = ptCompletionCounts.get(pairKey) || 0;
            for (const entry of pairEntries) {
                if (entry.reservation?.status === 'COMPLETED') {
                    entry.status = 'COMPLETED';
                    if (remainingCompleted > 0) {
                        remainingCompleted--;
                    }
                    continue;
                }
                if (entry.reservation && (entry.reservation.status === 'RESERVED' || isLegacyReserveLinkedReservation(entry.reservation))) {
                    entry.status = 'RESERVED';
                    continue;
                }
                if (entry.reservation && isActiveReservationStatus(entry.reservation.status)) {
                    entry.status = 'ACTIVE';
                    continue;
                }
            }
            for (const entry of pairEntries) {
                if (entry.status !== 'UNRESOLVED' || remainingCompleted <= 0) {
                    continue;
                }
                entry.status = 'COMPLETED';
                remainingCompleted--;
            }
            for (const entry of pairEntries) {
                if (entry.status === 'UNRESOLVED') {
                    entry.status = 'MISSING';
                }
            }
        }
        let reservesToInfer = Math.max(declaredReserveCount - entries.filter(entry => isReservedLikeStatus(entry.status)).length, 0);
        while (reservesToInfer > 0) {
            const candidates = entries
                .filter(entry => entry.status === 'MISSING')
                .map(entry => {
                const dayEntries = entriesByDay.get(Number(entry.fixture.day_number)) || [];
                const siblingEntries = dayEntries.filter(item => item !== entry);
                const activeSiblingCount = siblingEntries.filter(item => item.status === 'ACTIVE').length;
                const missingSiblingCount = siblingEntries.filter(item => item.status === 'MISSING').length;
                const reserveSignal = (reserveUsageMap.get(entry.fixture.team_a_id) || 0) + (reserveUsageMap.get(entry.fixture.team_b_id) || 0);
                return { entry, activeSiblingCount, missingSiblingCount, reserveSignal };
            })
                .filter(candidate => candidate.reserveSignal > 0 && candidate.activeSiblingCount === 0 && candidate.missingSiblingCount === 0)
                .sort((a, b) => {
                const dayDiff = Number(a.entry.fixture.day_number) - Number(b.entry.fixture.day_number);
                if (dayDiff !== 0) {
                    return dayDiff;
                }
                if (b.reserveSignal !== a.reserveSignal) {
                    return b.reserveSignal - a.reserveSignal;
                }
                return a.entry.occurrenceIndex - b.entry.occurrenceIndex;
            });
            if (!candidates.length) {
                break;
            }
            const selected = candidates[0].entry;
            selected.status = 'INFERRED_RESERVED';
            selected.inferred = true;
            reservesToInfer--;
        }
        return {
            entries,
            entriesByDay,
            reserveUsageMap,
            declaredReserveCount
        };
    }

    async buildFixtureStatusSnapshot(guildId, seasonName) {
        return this.buildFixtureScheduleSnapshot(guildId, seasonName);
    }

    async buildPendingReserveFixtureQueue(guildId, seasonName) {
        const seasonSnapshot = await this.buildFixtureScheduleSnapshot(guildId, seasonName);
        const pendingEntries = seasonSnapshot.entries
            .filter(entry => isReservedLikeStatus(entry.status) && !Number.isInteger(entry.reservation?.reserve_day_number))
            .sort((a, b) => {
            const dayA = Number.isInteger(a.dayInfo?.fixtureDayNumber) ? a.dayInfo.fixtureDayNumber : Number.MAX_SAFE_INTEGER;
            const dayB = Number.isInteger(b.dayInfo?.fixtureDayNumber) ? b.dayInfo.fixtureDayNumber : Number.MAX_SAFE_INTEGER;
            if (dayA !== dayB)
                return dayA - dayB;
            return (a.reservation?.created_at || 0) - (b.reservation?.created_at || 0);
        });
        return { seasonSnapshot, pendingEntries };
    }

    async buildPendingReserveQueue(guildId, seasonName) {
        return this.buildPendingReserveFixtureQueue(guildId, seasonName);
    }

    async buildReserveDayBatches(guildId, seasonName) {
        const db = (0, database_1.getDB)();
        const settings = await db.get('SELECT max_matches_per_day FROM fixture_settings WHERE guild_id = ?', guildId) || {};
        const maxMatchesPerDay = Math.max(1, Number(settings.max_matches_per_day) || 1);
        const assignedRows = await db.all('SELECT DISTINCT reserve_day_number FROM match_reservations WHERE guild_id = ? AND season_name = ? AND reserve_day_number IS NOT NULL ORDER BY reserve_day_number ASC', guildId, seasonName);
        const existingAssignedMax = assignedRows.length ? Math.max(...assignedRows.map(row => Number(row.reserve_day_number)).filter(Number.isInteger)) : 0;
        const { pendingEntries } = await this.buildPendingReserveFixtureQueue(guildId, seasonName);
        const batches = [];
        for (const entry of pendingEntries) {
            let targetBatch = null;
            for (const batch of batches) {
                const countA = batch.teamMatchCounts.get(entry.fixture.team_a_id) || 0;
                const countB = batch.teamMatchCounts.get(entry.fixture.team_b_id) || 0;
                if (countA < maxMatchesPerDay && countB < maxMatchesPerDay) {
                    targetBatch = batch;
                    break;
                }
            }
            if (!targetBatch) {
                targetBatch = {
                    dayNumber: existingAssignedMax + batches.length + 1,
                    entries: [],
                    teamMatchCounts: new Map()
                };
                batches.push(targetBatch);
            }
            targetBatch.entries.push(entry);
            targetBatch.teamMatchCounts.set(entry.fixture.team_a_id, (targetBatch.teamMatchCounts.get(entry.fixture.team_a_id) || 0) + 1);
            targetBatch.teamMatchCounts.set(entry.fixture.team_b_id, (targetBatch.teamMatchCounts.get(entry.fixture.team_b_id) || 0) + 1);
        }
        return {
            maxMatchesPerDay,
            existingAssignedMax,
            batches: batches.map(batch => ({
                dayNumber: batch.dayNumber,
                entries: batch.entries
            }))
        };
    }

    async findFixtureScheduleForFixture(guildId, seasonName, fixture, statusList = null) {
        const db = (0, database_1.getDB)();
        const statuses = Array.isArray(statusList) && statusList.length ? statusList : null;
        const statusClause = statuses ? ` AND status IN (${statuses.map(() => '?').join(',')})` : '';
        const statusParams = statuses || [];
        const stadiumId = fixture?.stadium_id || fixture?.stadium_channel_id || null;
        const dayKey = normalizeFixtureDayKey(fixture?.day_number ?? fixture?.fixture_day_number);
        const reserveDayNumber = parseReserveDayNumber(dayKey);
        const pairFixtures = reserveDayNumber === null
            ? await db.all(`SELECT day_number, stadium_id
                FROM generated_fixtures
                WHERE guild_id = ? AND season_name = ?
                  AND ((team_a_id = ? AND team_b_id = ?) OR (team_a_id = ? AND team_b_id = ?))
                ORDER BY day_number ASC`, guildId, seasonName, fixture.team_a_id, fixture.team_b_id, fixture.team_b_id, fixture.team_a_id).catch(() => [])
            : [];
        let row = null;
        if (reserveDayNumber !== null) {
            row = await db.get(`SELECT *
                FROM match_reservations
                WHERE guild_id = ? AND season_name = ? AND reserve_day_number = ?
                  AND ((team_a_id = ? AND team_b_id = ?) OR (team_a_id = ? AND team_b_id = ?))${statusClause}
                ORDER BY created_at DESC
                LIMIT 1`, guildId, seasonName, reserveDayNumber, fixture.team_a_id, fixture.team_b_id, fixture.team_b_id, fixture.team_a_id, ...statusParams);
        }
        else if (dayKey) {
            row = await db.get(`SELECT *
                FROM match_reservations
                WHERE guild_id = ? AND season_name = ? AND fixture_day_number = ?
                  AND ((team_a_id = ? AND team_b_id = ?) OR (team_a_id = ? AND team_b_id = ?))${statusClause}
                ORDER BY created_at DESC
                LIMIT 1`, guildId, seasonName, dayKey, fixture.team_a_id, fixture.team_b_id, fixture.team_b_id, fixture.team_a_id, ...statusParams);
        }
        if (!row && stadiumId) {
            row = await db.get(`SELECT *
                FROM match_reservations
                WHERE guild_id = ? AND season_name = ? AND stadium_channel_id = ?
                  AND ((team_a_id = ? AND team_b_id = ?) OR (team_a_id = ? AND team_b_id = ?))${statusClause}
                ORDER BY created_at DESC
                LIMIT 1`, guildId, seasonName, stadiumId, fixture.team_a_id, fixture.team_b_id, fixture.team_b_id, fixture.team_a_id, ...statusParams);
        }
        if (!row && dayKey && /^\d+$/.test(String(dayKey))) {
            const targetIndex = pairFixtures.findIndex(entry => Number(entry.day_number) === Number(dayKey));
            if (targetIndex !== -1) {
                const pairRows = await db.all(`SELECT *
                    FROM match_reservations
                    WHERE guild_id = ? AND season_name = ?
                      AND ((team_a_id = ? AND team_b_id = ?) OR (team_a_id = ? AND team_b_id = ?))
                      AND (fixture_day_number IS NULL OR TRIM(fixture_day_number) = '')${statusClause}
                    ORDER BY COALESCE(scheduled_time, created_at) ASC, id ASC`, guildId, seasonName, fixture.team_a_id, fixture.team_b_id, fixture.team_b_id, fixture.team_a_id, ...statusParams);
                if (pairRows[targetIndex]) {
                    row = pairRows[targetIndex];
                    if ((!row.fixture_day_number || !String(row.fixture_day_number).trim()) && row.id) {
                        await db.run("UPDATE match_reservations SET fixture_day_number = ? WHERE id = ? AND (fixture_day_number IS NULL OR TRIM(fixture_day_number) = '')", String(dayKey), row.id).catch(() => null);
                        row.fixture_day_number = String(dayKey);
                    }
                }
            }
        }
        if (!row) {
            const fallbackStatuses = (statuses || ['OPEN', 'PENDING', 'SCHEDULED']).filter(status => ['OPEN', 'PENDING', 'SCHEDULED'].includes(status));
            if (fallbackStatuses.length > 0 && pairFixtures.length <= 1) {
                row = await db.get(`SELECT *
                    FROM match_reservations
                    WHERE guild_id = ? AND season_name = ?
                      AND ((team_a_id = ? AND team_b_id = ?) OR (team_a_id = ? AND team_b_id = ?))
                      AND status IN (${fallbackStatuses.map(() => '?').join(',')})
                    ORDER BY created_at DESC
                    LIMIT 1`, guildId, seasonName, fixture.team_a_id, fixture.team_b_id, fixture.team_b_id, fixture.team_a_id, ...fallbackStatuses);
            }
        }
        return row || null;
    }

    async findReservationForFixture(guildId, seasonName, fixture, statusList = null) {
        return this.findFixtureScheduleForFixture(guildId, seasonName, fixture, statusList);
    }

    async getFixtureDaySnapshot(guildId, seasonName, dayNumber, seasonSnapshot = null) {
        const snapshot = seasonSnapshot || await this.buildFixtureScheduleSnapshot(guildId, seasonName);
        const matches = [...(snapshot.entriesByDay.get(Number(dayNumber)) || [])];
        const fixtureCount = matches.length;
        const completedCount = matches.filter(entry => entry.status === 'COMPLETED').length;
        const reservedCount = matches.filter(entry => isReservedLikeStatus(entry.status)).length;
        const activeCount = matches.filter(entry => entry.status === 'ACTIVE').length;
        const missingCount = matches.filter(entry => entry.status === 'MISSING').length;
        return {
            dayNumber,
            fixtureCount,
            completedCount,
            reservedCount,
            activeCount,
            missingCount,
            isOver: fixtureCount > 0 && activeCount === 0 && missingCount === 0,
            matches
        };
    }

    async getFixtureDayStatusReport(message) {
        const db = (0, database_1.getDB)();
        const guildId = message.guild.id;
        const seasonName = await this.getActiveScheduleSeason(guildId);
        if (!seasonName)
            return message.reply("Error: No scheduling season is set. Use `?setseasonschedule` first.");
        const days = (await db.all('SELECT DISTINCT day_number FROM generated_fixtures WHERE guild_id = ? AND season_name = ? ORDER BY day_number ASC', guildId, seasonName)).map(row => row.day_number);
        if (!days.length)
            return message.reply(`Error: No generated fixtures were found for **${seasonName}**.`);
        const seasonSnapshot = await this.buildFixtureScheduleSnapshot(guildId, seasonName);
        const snapshots = [];
        for (const dayNumber of days) {
            snapshots.push(await this.getFixtureDaySnapshot(guildId, seasonName, dayNumber, seasonSnapshot));
        }
        const overLines = snapshots.filter(row => row.isOver).map(row => `Day ${row.dayNumber} | Completed: ${row.completedCount}/${row.fixtureCount} | Reserved: ${row.reservedCount}/${row.fixtureCount}`);
        const pendingLines = snapshots.filter(row => !row.isOver).map(row => `Day ${row.dayNumber} | Completed: ${row.completedCount}/${row.fixtureCount} | Reserved: ${row.reservedCount}/${row.fixtureCount} | Active: ${row.activeCount} | Missing: ${row.missingCount}`);
        const firstUnfinished = snapshots.find(row => !row.isOver) || null;
        const progressionWarning = firstUnfinished
            ? snapshots.filter(row => row.dayNumber > firstUnfinished.dayNumber && row.isOver).map(row => `Day ${row.dayNumber}`)
            : [];
        const embed = new discord_js_1.EmbedBuilder()
            .setTitle(`Fixture Day Status: ${seasonName}`)
            .setColor(0x3b82f6);
        embed.addFields({
            name: overLines.length ? 'Days Over' : 'Days Over',
            value: overLines.length ? overLines.join('\n') : 'None'
        });
        embed.addFields({
            name: pendingLines.length ? 'Still Open / Incomplete' : 'Still Open / Incomplete',
            value: pendingLines.length ? pendingLines.join('\n') : 'None'
        });
        if (progressionWarning.length > 0) {
            embed.addFields({
                name: 'Progression Warning',
                value: `Earlier unfinished day: Day ${firstUnfinished.dayNumber}\nLater days already marked over: ${progressionWarning.join(', ')}`
            });
        }
        return message.reply({ embeds: [embed] });
    }

    async getNormalFixtureProgress(guildId, seasonName) {
        const db = (0, database_1.getDB)();
        const days = (await db.all('SELECT DISTINCT day_number FROM generated_fixtures WHERE guild_id = ? AND season_name = ? ORDER BY day_number ASC', guildId, seasonName)).map(row => Number(row.day_number)).filter(Number.isInteger);
        const seasonSnapshot = await this.buildFixtureScheduleSnapshot(guildId, seasonName);
        const snapshots = [];
        for (const dayNumber of days) {
            snapshots.push(await this.getFixtureDaySnapshot(guildId, seasonName, dayNumber, seasonSnapshot));
        }
        const firstUnfinished = snapshots.find(snapshot => !snapshot.isOver) || null;
        return { days, seasonSnapshot, snapshots, firstUnfinished };
    }

    async getNextNormalAnnouncementState(guildId, seasonName) {
        const progress = await this.getNormalFixtureProgress(guildId, seasonName);
        if (!progress.firstUnfinished) {
            return { kind: 'all_over', progress };
        }
        const snapshot = progress.firstUnfinished;
        const hasTrackedState = snapshot.matches.some(match => match.status !== 'MISSING');
        if (snapshot.activeCount > 0) {
            return { kind: 'already_active', dayNumber: snapshot.dayNumber, snapshot, progress };
        }
        if (!hasTrackedState) {
            return { kind: 'ready', dayNumber: snapshot.dayNumber, snapshot, progress };
        }
        return { kind: 'blocked', dayNumber: snapshot.dayNumber, snapshot, progress };
    }

    async undoFixtureDay(message, dayNumber, isReserveDay = false) {
        const db = (0, database_1.getDB)();
        const guildId = message.guild.id;
        const seasonName = await this.getActiveScheduleSeason(guildId);
        if (!seasonName)
            return message.reply("Error: No scheduling season is set. Use `?setseasonschedule` first.");
        if (!Number.isInteger(dayNumber) || dayNumber < 1)
            return message.reply(`Usage: \`?fixture undo ${isReserveDay ? 'reserve day' : 'day'} <number>\``);
        let targets = [];
        let blocked = [];
        if (isReserveDay) {
            const rows = await db.all(`SELECT r.*, t1.team_name AS t1n, t2.team_name AS t2n
                FROM match_reservations r
                JOIN teams t1 ON r.team_a_id = t1.team_id
                JOIN teams t2 ON r.team_b_id = t2.team_id
                WHERE r.guild_id = ? AND r.season_name = ? AND r.reserve_day_number = ?
                ORDER BY r.created_at DESC`, guildId, seasonName, dayNumber);
            if (!rows.length)
                return message.reply(`Error: No matches are currently tagged to **Reserve Day ${dayNumber}**.`);
            targets = rows.filter(row => ['OPEN', 'PENDING', 'SCHEDULED'].includes(row.status));
            blocked = rows.filter(row => !['OPEN', 'PENDING', 'SCHEDULED'].includes(row.status));
        }
        else {
            const fixtures = await db.all(`SELECT gf.*, t1.team_name AS team_a_name, t2.team_name AS team_b_name
                FROM generated_fixtures gf
                JOIN teams t1 ON gf.team_a_id = t1.team_id
                JOIN teams t2 ON gf.team_b_id = t2.team_id
                WHERE gf.guild_id = ? AND gf.season_name = ? AND gf.day_number = ?`, guildId, seasonName, dayNumber);
            if (!fixtures.length)
                return message.reply(`Error: No fixtures were found for **Day ${dayNumber}**.`);
            const byId = new Map();
            for (const fixture of fixtures) {
                const row = await this.findFixtureScheduleForFixture(guildId, seasonName, { ...fixture, day_number: dayNumber }, ['COMPLETED', 'RESERVED', 'OPEN', 'PENDING', 'SCHEDULED']);
                if (!row)
                    continue;
                if (!byId.has(row.id)) {
                    byId.set(row.id, {
                        ...row,
                        t1n: fixture.team_a_name,
                        t2n: fixture.team_b_name
                    });
                }
            }
            const rows = [...byId.values()];
            if (!rows.length)
                return message.reply(`Error: No active announcement state was found for **Day ${dayNumber}**.`);
            targets = rows.filter(row => ['OPEN', 'PENDING', 'SCHEDULED'].includes(row.status));
            blocked = rows.filter(row => !['OPEN', 'PENDING', 'SCHEDULED'].includes(row.status));
        }
        if (blocked.length > 0) {
            const blockedLines = blocked.map(row => `- **${row.t1n || row.team_a_id} vs ${row.t2n || row.team_b_id}** (${row.status})`).join('\n');
            return message.reply(`Error: Can't undo ${isReserveDay ? `Reserve Day ${dayNumber}` : `Day ${dayNumber}`} because some matches are already locked into non-reversible states.\n${blockedLines}`);
        }
        if (targets.length === 0) {
            return message.reply(`Error: No undoable matches were found for ${isReserveDay ? `Reserve Day ${dayNumber}` : `Day ${dayNumber}`}.`);
        }
        const summary = targets.map(row => `- **${row.t1n || row.team_a_id} vs ${row.t2n || row.team_b_id}** (${row.status})`).join('\n');
        const confirmText = isReserveDay
            ? `Undo **Reserve Day ${dayNumber}** and move these matches back into the reserve queue?\n${summary}`
            : `Undo **Day ${dayNumber}** so it can be announced again?\n${summary}`;
        if (!await (0, utils_1.askConfirmation)(message, confirmText)) {
            return message.reply("Action cancelled.");
        }
        for (const row of targets) {
            if (row.stadium_channel_id) {
                this.removeStadiumChannel(row.stadium_channel_id);
                await this.lockChannel(message.guild, row.stadium_channel_id).catch(() => null);
            }
            if (isReserveDay) {
                await db.run('UPDATE match_reservations SET status = "RESERVED", scheduled_time = NULL, agreement_time = NULL, reserve_day_number = NULL WHERE id = ?', row.id);
            }
            else {
                await db.run('DELETE FROM match_reservations WHERE id = ?', row.id);
            }
        }
        return message.reply(`✅ ${isReserveDay ? `Reserve Day ${dayNumber}` : `Day ${dayNumber}`} was undone for **${targets.length}** match(es). You can announce it again now.`);
    }

    async showQueue(message, mode = 'all') {
        return this.showFixtureScheduleQueue(message, mode);
        const activeSeason = await this.getActiveScheduleSeason(message.guild.id);
        if (!activeSeason) return message.reply("❌ No season set.");
        
        let statuses = ["PENDING", "OPEN", "SCHEDULED", "RESERVED"];
        if (mode === 'reserve') statuses = ["RESERVED"];
        if (mode === 'schedule') statuses = ["PENDING", "OPEN", "SCHEDULED"];

        const res = await db.all(`
            SELECT r.*, t1.team_name as t1n, t2.team_name as t2n 
            FROM match_reservations r 
            JOIN teams t1 ON r.team_a_id = t1.team_id 
            JOIN teams t2 ON r.team_b_id = t2.team_id 
            WHERE r.guild_id = ? AND r.season_name = ? AND r.status IN (${statuses.map(() => '?').join(',')})
            ORDER BY 
                CASE r.status 
                    WHEN 'SCHEDULED' THEN 1 
                    WHEN 'OPEN' THEN 2 
                    WHEN 'PENDING' THEN 3 
                    WHEN 'RESERVED' THEN 4
                END,
                r.scheduled_time ASC, r.created_at ASC
        `, message.guild.id, activeSeason, ...statuses);

        if (res.length === 0) return message.reply(`No matches found in ${mode === 'reserve' ? 'reserve queue' : 'schedule'}.`);

        const enriched = await Promise.all(res.map(async (row) => ({
            ...row,
            dayInfo: await this.resolveFixtureScheduleDayInfo(message.guild.id, activeSeason, row)
        })));

        const activeMatches = enriched.filter(r => r.status !== 'RESERVED');
        const postponedMatches = enriched
            .filter(r => r.status === 'RESERVED')
            .sort((a, b) => {
            const reserveA = Number.isInteger(a.reserve_day_number) ? a.reserve_day_number : Number.MAX_SAFE_INTEGER;
            const reserveB = Number.isInteger(b.reserve_day_number) ? b.reserve_day_number : Number.MAX_SAFE_INTEGER;
            if (reserveA !== reserveB)
                return reserveA - reserveB;
            const dayA = Number.isInteger(a.dayInfo?.fixtureDayNumber) ? a.dayInfo.fixtureDayNumber : Number.MAX_SAFE_INTEGER;
            const dayB = Number.isInteger(b.dayInfo?.fixtureDayNumber) ? b.dayInfo.fixtureDayNumber : Number.MAX_SAFE_INTEGER;
            if (dayA !== dayB)
                return dayA - dayB;
            return (a.created_at || 0) - (b.created_at || 0);
        });

        const activeList = activeMatches.map((r, i) => {
            let timeStr = r.scheduled_time ? `<t:${r.scheduled_time}:t>` : 'TBD';
            const stadiumMention = r.stadium_channel_id ? `<#${r.stadium_channel_id}>` : 'TBD';
            const dayLabel = r.dayInfo?.fixtureDayLabel || 'Unknown';
            return `${i + 1}. **${r.t1n}** vs **${r.t2n}**\nFixture: ${dayLabel} | Stadium: ${stadiumMention} | Time: ${timeStr}`;
        });

        const reserveDisplayList = postponedMatches.map((r, i) => {
            const stadiumMention = r.stadium_channel_id ? `<#${r.stadium_channel_id}>` : 'TBD';
            const originalDay = r.dayInfo?.fixtureDayLabel || 'Unknown';
            const reserveDay = r.dayInfo?.reserveDayLabel || 'Not assigned';
            return `${i + 1}. **${r.t1n}** vs **${r.t2n}**\nOriginal Fixture: ${originalDay}\nReserve Slot: ${reserveDay}\nStadium: ${stadiumMention}`;
        });

        const postponedList = postponedMatches.map((r, i) => {
            const stadiumMention = r.stadium_channel_id ? `<#${r.stadium_channel_id}>` : 'TBD';
            return `${i + 1}. **${r.t1n}** vs **${r.t2n}** ✈️\nStadium: ${stadiumMention}`;
        });

        const embed = new discord_js_1.EmbedBuilder()
            .setTitle(mode === 'reserve' ? `Reserve Queue: ${activeSeason}` : `Match Schedule: ${activeSeason}`)
            .setColor(mode === 'reserve' ? 0xFFFF00 : 0x00FFFF);

        if (mode === 'reserve') {
            if (reserveDisplayList.length > 0) {
                embed.setDescription(reserveDisplayList.join('\n\n'));
            } else {
                embed.setDescription("No reserved matches.");
            }
        } else {
            if (activeList.length > 0) {
                embed.addFields({ name: "Matches", value: activeList.join('\n\n') });
            }
            if (postponedList.length > 0 && mode === 'all') {
                embed.addFields({ name: "Postponed / Reserved Matches", value: reserveDisplayList.join('\n\n') + "\n*(These will be played after regular season)*" });
            }
        }

        message.reply({ embeds: [embed] });
    }

    async showFixtureScheduleQueue(message, mode = 'all') {
        return this.showQueueV2(message, mode);
    }

    async showQueueV2(message, mode = 'all') {
        const activeSeason = await this.getActiveScheduleSeason(message.guild.id);
        if (!activeSeason)
            return message.reply("âŒ No season set.");
        const seasonSnapshot = await this.buildFixtureScheduleSnapshot(message.guild.id, activeSeason);
        const reserveQueue = await this.buildPendingReserveFixtureQueue(message.guild.id, activeSeason);
        const activeMatches = seasonSnapshot.entries
            .filter(entry => entry.status === 'ACTIVE')
            .sort((a, b) => {
            const scheduleA = a.reservation?.scheduled_time || Number.MAX_SAFE_INTEGER;
            const scheduleB = b.reservation?.scheduled_time || Number.MAX_SAFE_INTEGER;
            if (scheduleA !== scheduleB)
                return scheduleA - scheduleB;
            const createdA = a.reservation?.created_at || 0;
            const createdB = b.reservation?.created_at || 0;
            if (createdA !== createdB)
                return createdA - createdB;
            return Number(a.fixture.day_number) - Number(b.fixture.day_number);
        });
        const postponedMatches = reserveQueue.pendingEntries
            .sort((a, b) => {
            const reserveA = Number.isInteger(a.reservation?.reserve_day_number) ? a.reservation.reserve_day_number : Number.MAX_SAFE_INTEGER;
            const reserveB = Number.isInteger(b.reservation?.reserve_day_number) ? b.reservation.reserve_day_number : Number.MAX_SAFE_INTEGER;
            if (reserveA !== reserveB)
                return reserveA - reserveB;
            const dayA = Number.isInteger(a.dayInfo?.fixtureDayNumber) ? a.dayInfo.fixtureDayNumber : Number.MAX_SAFE_INTEGER;
            const dayB = Number.isInteger(b.dayInfo?.fixtureDayNumber) ? b.dayInfo.fixtureDayNumber : Number.MAX_SAFE_INTEGER;
            if (dayA !== dayB)
                return dayA - dayB;
            return (a.reservation?.created_at || 0) - (b.reservation?.created_at || 0);
        });
        if (mode === 'reserve' && postponedMatches.length === 0) {
            return message.reply("No matches found in reserve queue.");
        }
        if (mode === 'schedule' && activeMatches.length === 0) {
            return message.reply("No matches found in schedule.");
        }
        if (mode === 'all' && activeMatches.length === 0 && postponedMatches.length === 0) {
            return message.reply("No matches found in schedule.");
        }
        const activeList = activeMatches.map((entry, i) => {
            const timeStr = entry.reservation?.scheduled_time ? `<t:${entry.reservation.scheduled_time}:t>` : 'TBD';
            const stadiumId = entry.reservation?.stadium_channel_id || entry.fixture.stadium_id || null;
            const stadiumMention = stadiumId ? `<#${stadiumId}>` : 'TBD';
            const dayLabel = entry.dayInfo?.fixtureDayLabel || `Day ${entry.fixture.day_number}`;
            return `${i + 1}. **${entry.fixture.team_a_name}** vs **${entry.fixture.team_b_name}**\nFixture: ${dayLabel} | Stadium: ${stadiumMention} | Time: ${timeStr}`;
        });
        const reserveDisplayList = postponedMatches.map((entry, i) => {
            const stadiumId = entry.reservation?.stadium_channel_id || entry.fixture.stadium_id || null;
            const stadiumMention = stadiumId ? `<#${stadiumId}>` : 'TBD';
            const originalDay = entry.dayInfo?.fixtureDayLabel || `Day ${entry.fixture.day_number}`;
            const reserveDay = entry.inferred
                ? 'Not assigned (recovered from season state)'
                : (entry.dayInfo?.reserveDayLabel || 'Not assigned');
            const reserveTeamLabel = Number(entry.reservation?.reserve_team_id) === Number(entry.fixture.team_a_id)
                ? entry.fixture.team_a_name
                : Number(entry.reservation?.reserve_team_id) === Number(entry.fixture.team_b_id)
                    ? entry.fixture.team_b_name
                    : null;
            return `${i + 1}. **${entry.fixture.team_a_name}** vs **${entry.fixture.team_b_name}**\nOriginal Fixture: ${originalDay}\nReserve Team: ${reserveTeamLabel ? `**${reserveTeamLabel}**` : 'Unknown'}\nReserve Slot: ${reserveDay}\nStadium: ${stadiumMention}`;
        });
        const embed = new discord_js_1.EmbedBuilder()
            .setTitle(mode === 'reserve' ? `Reserve Queue: ${activeSeason}` : `Match Schedule: ${activeSeason}`)
            .setColor(mode === 'reserve' ? 0xFFFF00 : 0x00FFFF);
        if (mode === 'reserve') {
            embed.setDescription(reserveDisplayList.length ? reserveDisplayList.join('\n\n') : "No reserved matches.");
        }
        else {
            if (activeList.length > 0) {
                embed.addFields({ name: "Matches", value: activeList.join('\n\n') });
            }
            if (reserveDisplayList.length > 0 && mode === 'all') {
                embed.addFields({ name: "Postponed / Reserved Matches", value: reserveDisplayList.join('\n\n') + "\n*(These will be played after regular season)*" });
            }
        }
        return message.reply({ embeds: [embed] });
    }

    async recheckStadiumMessages(message) {
        if (!(0, utils_1.isAdmin)(message.member))
            return message.reply("Error: This command requires admin permissions.");
        const db = (0, database_1.getDB)();
        const guildId = message.guild.id;
        const activeReservations = await db.all(`
            SELECT id, stadium_channel_id, created_at
            FROM match_reservations
            WHERE guild_id = ? AND stadium_channel_id IS NOT NULL AND status IN ('PENDING', 'OPEN')
            ORDER BY created_at ASC
        `, guildId);
        if (activeReservations.length === 0)
            return message.reply("Error: No open stadium scheduling channels were found.");
        let checkedChannels = 0;
        let replayedMessages = 0;
        let processedMessages = 0;
        for (const reservation of activeReservations) {
            const channel = await message.guild.channels.fetch(reservation.stadium_channel_id).catch(() => null);
            if (!channel || !channel.isTextBased?.() || !('messages' in channel))
                continue;
            checkedChannels++;
            const fetched = await channel.messages.fetch({ limit: 25 }).catch(() => null);
            if (!fetched)
                continue;
            const messages = [...fetched.values()]
                .filter(msg => !msg.author?.bot && msg.createdTimestamp >= ((reservation.created_at || 0) * 1000))
                .sort((a, b) => a.createdTimestamp - b.createdTimestamp);
            for (const msg of messages) {
                replayedMessages++;
                const handled = await this.handlePotentialTimeAgreement(msg);
                if (handled)
                    processedMessages++;
            }
        }
        return message.reply(`Done: Rechecked **${checkedChannels}** stadiums.\nMessages scanned: **${replayedMessages}**\nMessages processed: **${processedMessages}**`);
    }

    async clearAllReserves(message) {
        const db = (0, database_1.getDB)();
        const guildId = message.guild.id;
        const teams = await this.getAllTeams(guildId);
        const options = teams.map(t => ({ label: t.team_name, value: t.team_id.toString() })).slice(0, 25);
        const row = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder().setCustomId('clear_res').setPlaceholder('Select teams').setMinValues(1).setMaxValues(options.length).addOptions(options));
        const resp = await message.reply({ content: "Select teams to clear reservations:", components: [row] });
        try {
            const sel = await awaitComponent(resp, { filter: i => i.user.id === message.author.id, time: 60000 });
            if (!sel)
                return;
            await sel.deferUpdate();
            for (const tid of sel.values)
                await db.run('DELETE FROM match_reservations WHERE guild_id = ? AND (team_a_id = ? OR team_b_id = ?)', guildId, tid, tid);
            await sel.editReply({ content: "✅ Cleared.", components: [] });
        } catch (e) { }
    }

    async setStadium(message, args) {
        if (!(0, utils_1.isAdmin)(message.member))
            return message.reply("❌ This command requires admin permissions.");
        const channelMention = message.mentions.channels.first();
        const channelIdArg = args.find(a => /^\d{15,}$/.test(a));
        const targetChannelId = channelMention?.id || channelIdArg;
        if (!targetChannelId)
            return message.reply("Usage: `?setstadium #channel [matchId]`.");
        const db = (0, database_1.getDB)();
        const matchIdArg = args.find(a => /^\d+$/.test(a) && a !== channelIdArg);
        if (matchIdArg) {
            const matchRow = await db.get('SELECT * FROM match_reservations WHERE guild_id = ? AND id = ?', message.guild.id, parseInt(matchIdArg, 10));
            if (!matchRow)
                return message.reply("❌ Match reservation not found.");
            await db.run('UPDATE match_reservations SET stadium_channel_id = ? WHERE id = ?', targetChannelId, matchRow.id);
            this.markStadiumChannelActive(message.guild.id, targetChannelId);
            return message.reply(`✅ Match #${matchRow.id} stadium updated to <#${targetChannelId}>.`);
        }
        await db.run('INSERT INTO guild_settings (guild_id, stadium_channel_id) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET stadium_channel_id = ?', message.guild.id, targetChannelId, targetChannelId);
        this.markStadiumChannelActive(message.guild.id, targetChannelId);
        return message.reply(`✅ Default stadium channel set to <#${targetChannelId}>.`);
    }

    async setReserveLimit(message, limit) {
        if (!(0, utils_1.isAdmin)(message.member))
            return message.reply("❌ This command requires admin permissions.");
        if (!Number.isInteger(limit) || limit < 0)
            return message.reply("Usage: `?setreservelimit <non-negative number>`.");
        const db = (0, database_1.getDB)();
        await db.run('INSERT INTO reserve_limits (guild_id, limit_count) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET limit_count = ?', message.guild.id, limit, limit);
        await db.run('INSERT INTO fixture_settings (guild_id, max_reserve) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET max_reserve = excluded.max_reserve', message.guild.id, limit);
        message.reply(`✅ Reserve limit updated to **${limit}**.`);
    }

    async showReservesLeft(message) {
        if (!(0, utils_1.isAdmin)(message.member))
            return message.reply("Error: This command requires admin permissions.");
        const db = (0, database_1.getDB)();
        const guildId = message.guild.id;
        const activeSeason = await this.getActiveScheduleSeason(guildId);
        if (!activeSeason)
            return message.reply("Error: No scheduling season set. Use `?sss [Name]` first.");
        const fSettings = await db.get('SELECT max_reserve FROM fixture_settings WHERE guild_id = ?', guildId);
        const limit = fSettings ? fSettings.max_reserve : 2;
        const teams = await db.all('SELECT team_id, team_name FROM teams WHERE guild_id = ? ORDER BY team_name COLLATE NOCASE', guildId);
        if (teams.length === 0)
            return message.reply("Error: No teams found.");
        const reserveRows = await db.all('SELECT team_id, used_count FROM team_reservations WHERE guild_id = ? AND season_name = ?', guildId, activeSeason);
        const reserveMap = new Map(reserveRows.map(row => [row.team_id, row.used_count]));
        const lines = teams.map((team, index) => {
            const usedCount = reserveMap.get(team.team_id) || 0;
            const leftCount = Math.max(limit - usedCount, 0);
            return `${index + 1}. **${team.team_name}**\nLeft: **${leftCount}/${limit}** | Used: **${usedCount}**`;
        });
        const embed = new discord_js_1.EmbedBuilder()
            .setTitle(`Reserves Left: ${activeSeason}`)
            .setDescription(lines.join('\n\n'))
            .setColor(0x00AE86)
            .setFooter({ text: `Reserve limit per team: ${limit}` });
        return message.reply({ embeds: [embed] });
    }

    async resetSeason(message) {
        if (!(0, utils_1.isSuperAdmin)(message.member)) return message.reply("❌ This command requires **Super Admin** permissions.");
        const db = (0, database_1.getDB)();
        const guildId = message.guild.id;

        if (!await (0, utils_1.askConfirmation)(message, "⚠️ **FRESH SEASON RESET?**\nThis will permanently DELETE all current teams, captains, match reservations, AND Point Table data (matches & aliases) for this server. This cannot be undone.")) {
            return;
        }

        await db.run('DELETE FROM match_reservations WHERE guild_id = ?', guildId);
        await db.run('DELETE FROM team_captains WHERE guild_id = ?', guildId);
        await db.run('DELETE FROM team_stadiums WHERE guild_id = ?', guildId);
        await db.run('DELETE FROM team_reservations WHERE guild_id = ?', guildId);
        await db.run('DELETE FROM teams WHERE guild_id = ?', guildId);
        this.invalidateTeamCache(guildId);
        
        // Point Table Reset
        await db.run('DELETE FROM pt_matches WHERE guild_id = ?', guildId);
        await db.run('DELETE FROM pt_team_aliases WHERE guild_id = ?', guildId);
        await db.run('DELETE FROM pt_settings WHERE guild_id = ?', guildId);

        // Also reset auction data to fresh state
        await db.run('UPDATE auction_players SET status = "AVAILABLE", sold_to_team_id = NULL, sold_for_lakhs = NULL WHERE guild_id = ?', guildId);
        await db.run('DELETE FROM auction_ledger WHERE guild_id = ?', guildId);
        await this.refreshStadiumCache(guildId);
        await (0, auditLog_1.appendAdminAuditLog)({
            guildId,
            actorId: message.author.id,
            commandName: 'resetseason',
            summary: 'Performed a fresh season reset and cleared teams, reservations, point table data, and auction state.',
            channelId: message.channel.id
        });

        message.reply("✅ **Season Reset Complete.** All teams, reservations, and Point Table data have been cleared. Auction data is now fresh.");
    }

    async resetTeamsForNewSeason(guildId) {
        const db = (0, database_1.getDB)();
        await db.run('DELETE FROM match_reservations WHERE guild_id = ?', guildId);
        await db.run('DELETE FROM team_reservations WHERE guild_id = ?', guildId);
        await db.run('DELETE FROM team_captains WHERE guild_id = ?', guildId);
        await db.run('DELETE FROM team_stadiums WHERE guild_id = ?', guildId);
        await db.run('DELETE FROM reserve_limits WHERE guild_id = ?', guildId);
        await db.run('DELETE FROM pt_team_aliases WHERE guild_id = ?', guildId);
        await db.run('UPDATE auction_players SET status = "AVAILABLE", sold_to_team_id = NULL, sold_for_lakhs = NULL WHERE guild_id = ?', guildId);
        await db.run('DELETE FROM auction_ledger WHERE guild_id = ?', guildId);
        await db.run('DELETE FROM teams WHERE guild_id = ?', guildId);
        this.invalidateTeamCache(guildId);
        await this.refreshStadiumCache(guildId);
    }

    async resetMatchSystem(message) {
        if (!(0, utils_1.isSuperAdmin)(message.member)) return message.reply("❌ This command requires **Super Admin** permissions.");
        const db = (0, database_1.getDB)();
        if (!await (0, utils_1.askConfirmation)(message, "⚠️ **RESET?**")) return;
        await db.run('DELETE FROM match_reservations WHERE guild_id = ?', message.guild.id);
        await this.refreshStadiumCache(message.guild.id);
        await (0, auditLog_1.appendAdminAuditLog)({
            guildId: message.guild.id,
            actorId: message.author.id,
            commandName: 'resetmatchsystem',
            summary: 'Cleared all match reservations for the current server.',
            channelId: message.channel.id
        });
        message.reply("✅ Reset.");
    }

    async removeReserveAdmin(message) {
        const db = (0, database_1.getDB)();
        const res = await db.all(`SELECT r.*, t1.team_name as t1n, t2.team_name as t2n FROM match_reservations r JOIN teams t1 ON r.team_a_id = t1.team_id JOIN teams t2 ON r.team_b_id = t2.team_id WHERE r.guild_id = ? AND r.status IN ("PENDING", "SCHEDULED", "OPEN")`, message.guild.id);
        if (res.length === 0) return message.reply("No matches.");
        const opts = res.map(r => ({ label: `${r.t1n} vs ${r.t2n}`, value: r.id.toString() })).slice(0, 25);
        const row = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder().setCustomId('rm_res').setMinValues(1).setMaxValues(opts.length).addOptions(opts));
        const resp = await message.reply({ content: "Select to remove:", components: [row] });
        try {
            const sel = await awaitComponent(resp, { filter: i => i.user.id === message.author.id, time: 60000 });
            if (!sel)
                return;
            await sel.deferUpdate();
            for (const rid of sel.values)
                await db.run('DELETE FROM match_reservations WHERE id = ?', rid);
            await sel.editReply({ content: "✅ Removed.", components: [] });
        } catch (e) { }
    }

    async adminReserveMatch(message, args) {
        if (!(0, utils_1.isAdmin)(message.member))
            return message.reply("Error: This command requires admin permissions.");
        const db = (0, database_1.getDB)();
        const guildId = message.guild.id;
        const activeSeason = await this.getActiveScheduleSeason(guildId);
        if (!activeSeason)
            return message.reply("Error: No scheduling season is set. Use `?setseasonschedule` first.");
        const dayIndex = args.findIndex(arg => /^\d+$/.test(arg));
        if (dayIndex === -1)
            return message.reply("Usage: `?adminreserve day 3 @ReserveTeam @OpponentTeam`.\nThe first mentioned team uses the reserve.");
        const dayNumber = parseInt(args[dayIndex], 10);
        if (!Number.isInteger(dayNumber) || dayNumber < 1)
            return message.reply("Error: Provide a valid day number.");
        const mentionedRoles = [...message.mentions.roles.values()];
        if (mentionedRoles.length < 2)
            return message.reply("Usage: `?adminreserve day 3 @ReserveTeam @OpponentTeam`.\nMention both team roles.");
        const reserveRole = mentionedRoles[0];
        const opponentRole = mentionedRoles[1];
        const reserveTeam = await db.get('SELECT * FROM teams WHERE guild_id = ? AND role_id = ?', guildId, reserveRole.id);
        const opponentTeam = await db.get('SELECT * FROM teams WHERE guild_id = ? AND role_id = ?', guildId, opponentRole.id);
        if (!reserveTeam || !opponentTeam)
            return message.reply("Error: Both mentioned roles must belong to registered teams.");
        const fixture = await db.get(`SELECT *
            FROM generated_fixtures
            WHERE guild_id = ? AND season_name = ? AND day_number = ?
              AND ((team_a_id = ? AND team_b_id = ?) OR (team_a_id = ? AND team_b_id = ?))
            LIMIT 1`, guildId, activeSeason, dayNumber, reserveTeam.team_id, opponentTeam.team_id, opponentTeam.team_id, reserveTeam.team_id);
        if (!fixture)
            return message.reply(`Error: No fixture found for **Day ${dayNumber}** between **${reserveTeam.team_name}** and **${opponentTeam.team_name}** in **${activeSeason}**.`);
        const fSettings = await db.get('SELECT max_reserve FROM fixture_settings WHERE guild_id = ?', guildId);
        const limit = fSettings ? fSettings.max_reserve : 2;
        const used = await db.get('SELECT used_count FROM team_reservations WHERE guild_id = ? AND season_name = ? AND team_id = ?', guildId, activeSeason, reserveTeam.team_id);
        const usedCount = used ? used.used_count : 0;
        if (usedCount >= limit) {
            return message.reply(`Error: **${reserveTeam.team_name}** has already reached the reserve limit of **${limit}** for **${activeSeason}**.`);
        }
        const pairFixtures = await db.all(`SELECT day_number, stadium_id
            FROM generated_fixtures
            WHERE guild_id = ? AND season_name = ?
              AND ((team_a_id = ? AND team_b_id = ?) OR (team_a_id = ? AND team_b_id = ?))
            ORDER BY day_number ASC`, guildId, activeSeason, reserveTeam.team_id, opponentTeam.team_id, opponentTeam.team_id, reserveTeam.team_id).catch(() => []);
        const existing = await db.get(`SELECT *
            FROM match_reservations
            WHERE guild_id = ? AND season_name = ? AND fixture_day_number = ?
              AND ((team_a_id = ? AND team_b_id = ?) OR (team_a_id = ? AND team_b_id = ?))
            ORDER BY created_at DESC
            LIMIT 1`, guildId, activeSeason, String(dayNumber), reserveTeam.team_id, opponentTeam.team_id, opponentTeam.team_id, reserveTeam.team_id)
            || await db.get(`SELECT *
                FROM match_reservations
                WHERE guild_id = ? AND season_name = ?
                  AND stadium_channel_id = ?
                  AND ((team_a_id = ? AND team_b_id = ?) OR (team_a_id = ? AND team_b_id = ?))
                  AND (fixture_day_number IS NULL OR TRIM(fixture_day_number) = '')
                  AND status IN ('OPEN', 'PENDING', 'SCHEDULED')
                ORDER BY created_at DESC
                LIMIT 1`, guildId, activeSeason, fixture.stadium_id || null, reserveTeam.team_id, opponentTeam.team_id, opponentTeam.team_id, reserveTeam.team_id)
            || (pairFixtures.length <= 1 ? await db.get(`SELECT *
                FROM match_reservations
                WHERE guild_id = ? AND season_name = ?
                  AND ((team_a_id = ? AND team_b_id = ?) OR (team_a_id = ? AND team_b_id = ?))
                  AND (fixture_day_number IS NULL OR TRIM(fixture_day_number) = '')
                  AND status IN ('OPEN', 'PENDING', 'SCHEDULED')
                ORDER BY created_at DESC
                LIMIT 1`, guildId, activeSeason, reserveTeam.team_id, opponentTeam.team_id, opponentTeam.team_id, reserveTeam.team_id) : null);
        if (existing?.status === 'RESERVED') {
            return message.reply(`Info: This match is already marked as reserved for **${reserveTeam.team_name}**.`);
        }
        if (!await (0, utils_1.askConfirmation)(message, `Reserve **Day ${dayNumber}**: **${reserveTeam.team_name}** vs **${opponentTeam.team_name}**?\nThis will count a reserve against **${reserveTeam.team_name}**.`)) {
            return message.reply("Error: Action cancelled.");
        }
        await db.run('INSERT INTO team_reservations (guild_id, season_name, team_id, used_count) VALUES (?, ?, ?, 1) ON CONFLICT(guild_id, season_name, team_id) DO UPDATE SET used_count = team_reservations.used_count + 1', guildId, activeSeason, reserveTeam.team_id);
        const stadiumChannelId = existing?.stadium_channel_id || fixture.stadium_id || null;
        if (existing) {
            await db.run('UPDATE match_reservations SET status = "RESERVED", reserved_by_captain_id = ?, reserve_team_id = ?, scheduled_time = NULL, agreement_time = NULL, stadium_channel_id = COALESCE(?, stadium_channel_id), fixture_day_number = ? WHERE id = ?', message.author.id, reserveTeam.team_id, stadiumChannelId, String(dayNumber), existing.id);
        }
        else {
            await db.run('INSERT INTO match_reservations (guild_id, season_name, team_a_id, team_b_id, reserved_by_captain_id, status, scheduled_time, created_at, agreement_time, stadium_channel_id, fixture_day_number, reserve_team_id) VALUES (?, ?, ?, ?, ?, "RESERVED", NULL, ?, NULL, ?, ?, ?)', guildId, activeSeason, fixture.team_a_id, fixture.team_b_id, message.author.id, Math.floor(Date.now() / 1000), stadiumChannelId, String(dayNumber), reserveTeam.team_id);
        }
        if (stadiumChannelId) {
            const stadiumChannel = await message.guild.channels.fetch(stadiumChannelId).catch(() => null);
            if (stadiumChannel && stadiumChannel.isTextBased?.()) {
                await this.lockReservedMatchChannel(message.guild, stadiumChannelId, existing || fixture);
                const cap1 = await db.get('SELECT captain_discord_id FROM team_captains WHERE guild_id = ? AND team_id = ?', guildId, fixture.team_a_id);
                const cap2 = await db.get('SELECT captain_discord_id FROM team_captains WHERE guild_id = ? AND team_id = ?', guildId, fixture.team_b_id);
                const vc1 = await db.get('SELECT vice_captain_discord_id FROM team_vice_captains WHERE guild_id = ? AND team_id = ?', guildId, fixture.team_a_id);
                const vc2 = await db.get('SELECT vice_captain_discord_id FROM team_vice_captains WHERE guild_id = ? AND team_id = ?', guildId, fixture.team_b_id);
                if (cap1?.captain_discord_id)
                    await stadiumChannel.permissionOverwrites.delete(cap1.captain_discord_id).catch(() => {});
                if (cap2?.captain_discord_id)
                    await stadiumChannel.permissionOverwrites.delete(cap2.captain_discord_id).catch(() => {});
                if (vc1?.vice_captain_discord_id)
                    await stadiumChannel.permissionOverwrites.delete(vc1.vice_captain_discord_id).catch(() => {});
                if (vc2?.vice_captain_discord_id)
                    await stadiumChannel.permissionOverwrites.delete(vc2.vice_captain_discord_id).catch(() => {});
            }
            this.removeStadiumChannel(stadiumChannelId);
        }
        const newUsedCount = usedCount + 1;
        return message.reply({
            embeds: [new discord_js_1.EmbedBuilder()
                .setTitle("Admin Reserve Applied")
                .setDescription(`**Day ${dayNumber}**\n**${reserveTeam.team_name}** has been marked as using a reserve against **${opponentTeam.team_name}**.\n\n**Reserves used by ${reserveTeam.team_name}:** ${newUsedCount}/${limit}`)
                .setColor(0xFFFF00)
                .setFooter({ text: `Season: ${activeSeason}` })]
        });
    }

    async repairFixtureReserve(message, args) {
        if (!(0, utils_1.isAdmin)(message.member))
            return message.reply("Error: This command requires admin permissions.");
        const db = (0, database_1.getDB)();
        const guildId = message.guild.id;
        const activeSeason = await this.getActiveScheduleSeason(guildId);
        if (!activeSeason)
            return message.reply("Error: No scheduling season is set. Use `?setseasonschedule` first.");
        const dayIndex = args.findIndex(arg => /^\d+$/.test(arg));
        if (dayIndex === -1)
            return message.reply("Usage: `?fixture repair reserve day <number> @ReserveTeam @OpponentTeam [nocount]`.");
        const dayNumber = parseInt(args[dayIndex], 10);
        if (!Number.isInteger(dayNumber) || dayNumber < 1)
            return message.reply("Error: Provide a valid day number.");
        const mentionedRoles = [...message.mentions.roles.values()];
        if (mentionedRoles.length < 2)
            return message.reply("Usage: `?fixture repair reserve day <number> @ReserveTeam @OpponentTeam [nocount]`.");
        const reserveRole = mentionedRoles[0];
        const opponentRole = mentionedRoles[1];
        const reserveTeam = await db.get('SELECT * FROM teams WHERE guild_id = ? AND role_id = ?', guildId, reserveRole.id);
        const opponentTeam = await db.get('SELECT * FROM teams WHERE guild_id = ? AND role_id = ?', guildId, opponentRole.id);
        if (!reserveTeam || !opponentTeam)
            return message.reply("Error: Both mentioned roles must belong to registered teams.");
        const fixture = await db.get(`SELECT *
            FROM generated_fixtures
            WHERE guild_id = ? AND season_name = ? AND day_number = ?
              AND ((team_a_id = ? AND team_b_id = ?) OR (team_a_id = ? AND team_b_id = ?))
            LIMIT 1`, guildId, activeSeason, dayNumber, reserveTeam.team_id, opponentTeam.team_id, opponentTeam.team_id, reserveTeam.team_id);
        if (!fixture)
            return message.reply(`Error: No fixture found for **Day ${dayNumber}** between **${reserveTeam.team_name}** and **${opponentTeam.team_name}** in **${activeSeason}**.`);
        const pairFixtures = await db.all(`SELECT day_number, stadium_id
            FROM generated_fixtures
            WHERE guild_id = ? AND season_name = ?
              AND ((team_a_id = ? AND team_b_id = ?) OR (team_a_id = ? AND team_b_id = ?))
            ORDER BY day_number ASC`, guildId, activeSeason, reserveTeam.team_id, opponentTeam.team_id, opponentTeam.team_id, reserveTeam.team_id).catch(() => []);
        const existing = await db.get(`SELECT *
            FROM match_reservations
            WHERE guild_id = ? AND season_name = ? AND fixture_day_number = ?
              AND ((team_a_id = ? AND team_b_id = ?) OR (team_a_id = ? AND team_b_id = ?))
            ORDER BY created_at DESC
            LIMIT 1`, guildId, activeSeason, String(dayNumber), reserveTeam.team_id, opponentTeam.team_id, opponentTeam.team_id, reserveTeam.team_id)
            || await db.get(`SELECT *
                FROM match_reservations
                WHERE guild_id = ? AND season_name = ?
                  AND stadium_channel_id = ?
                  AND ((team_a_id = ? AND team_b_id = ?) OR (team_a_id = ? AND team_b_id = ?))
                  AND (fixture_day_number IS NULL OR TRIM(fixture_day_number) = '')
                ORDER BY created_at DESC
                LIMIT 1`, guildId, activeSeason, fixture.stadium_id || null, reserveTeam.team_id, opponentTeam.team_id, opponentTeam.team_id, reserveTeam.team_id)
            || (pairFixtures.length <= 1 ? await db.get(`SELECT *
                FROM match_reservations
                WHERE guild_id = ? AND season_name = ?
                  AND ((team_a_id = ? AND team_b_id = ?) OR (team_a_id = ? AND team_b_id = ?))
                  AND (fixture_day_number IS NULL OR TRIM(fixture_day_number) = '')
                ORDER BY created_at DESC
                LIMIT 1`, guildId, activeSeason, reserveTeam.team_id, opponentTeam.team_id, opponentTeam.team_id, reserveTeam.team_id) : null);
        const noCount = args.some(arg => String(arg).toLowerCase() === 'nocount' || String(arg).toLowerCase() === '--nocount');
        const previousReserveTeamId = existing?.reserve_team_id ? Number(existing.reserve_team_id) : null;
        const actionSummary = [];
        const confirmText = `Repair **Day ${dayNumber}** reserve as **${reserveTeam.team_name}** vs **${opponentTeam.team_name}**?${noCount ? '\nReserve counter: unchanged (`nocount`).' : ''}`;
        if (!await (0, utils_1.askConfirmation)(message, confirmText)) {
            return message.reply("Action cancelled.");
        }
        if (!noCount) {
            if (existing?.status === 'RESERVED') {
                if (previousReserveTeamId && previousReserveTeamId !== reserveTeam.team_id) {
                    await db.run('UPDATE team_reservations SET used_count = CASE WHEN used_count > 0 THEN used_count - 1 ELSE 0 END WHERE guild_id = ? AND season_name = ? AND team_id = ?', guildId, activeSeason, previousReserveTeamId);
                    await db.run('INSERT INTO team_reservations (guild_id, season_name, team_id, used_count) VALUES (?, ?, ?, 1) ON CONFLICT(guild_id, season_name, team_id) DO UPDATE SET used_count = team_reservations.used_count + 1', guildId, activeSeason, reserveTeam.team_id);
                    actionSummary.push('Moved reserve usage to the new team.');
                }
                else if (!previousReserveTeamId) {
                    actionSummary.push('Reserve counter left unchanged because this row was already reserved without a stored reserve side.');
                }
            }
            else {
                await db.run('INSERT INTO team_reservations (guild_id, season_name, team_id, used_count) VALUES (?, ?, ?, 1) ON CONFLICT(guild_id, season_name, team_id) DO UPDATE SET used_count = team_reservations.used_count + 1', guildId, activeSeason, reserveTeam.team_id);
                actionSummary.push('Reserve usage count incremented.');
            }
        }
        const stadiumChannelId = existing?.stadium_channel_id || fixture.stadium_id || null;
        if (existing) {
            await db.run('UPDATE match_reservations SET status = "RESERVED", reserved_by_captain_id = ?, reserve_team_id = ?, scheduled_time = NULL, agreement_time = NULL, reserve_day_number = NULL, stadium_channel_id = COALESCE(?, stadium_channel_id), fixture_day_number = ? WHERE id = ?', message.author.id, reserveTeam.team_id, stadiumChannelId, String(dayNumber), existing.id);
        }
        else {
            await db.run('INSERT INTO match_reservations (guild_id, season_name, team_a_id, team_b_id, reserved_by_captain_id, status, scheduled_time, created_at, agreement_time, stadium_channel_id, fixture_day_number, reserve_day_number, reserve_team_id) VALUES (?, ?, ?, ?, ?, "RESERVED", NULL, ?, NULL, ?, ?, NULL, ?)', guildId, activeSeason, fixture.team_a_id, fixture.team_b_id, message.author.id, Math.floor(Date.now() / 1000), stadiumChannelId, String(dayNumber), reserveTeam.team_id);
            actionSummary.push('Created a missing reserved fixture row.');
        }
        await (0, auditLog_1.appendAdminAuditLog)({
            guildId,
            actorId: message.author.id,
            commandName: 'fixturerepair',
            summary: `Repaired Day ${dayNumber} reserve: ${reserveTeam.team_name} vs ${opponentTeam.team_name}.`,
            targetSummary: noCount ? 'Counter unchanged' : (actionSummary.join(' ') || 'Counter/data updated'),
            channelId: message.channel.id
        });
        const used = await db.get('SELECT used_count FROM team_reservations WHERE guild_id = ? AND season_name = ? AND team_id = ?', guildId, activeSeason, reserveTeam.team_id);
        const usedCount = used ? used.used_count : 0;
        return message.reply({
            embeds: [new discord_js_1.EmbedBuilder()
                .setTitle("Fixture Reserve Repaired")
                .setDescription(`**Day ${dayNumber}**\nReserve team: **${reserveTeam.team_name}**\nOpponent: **${opponentTeam.team_name}**\nCounter: **${noCount ? 'unchanged' : usedCount}**${noCount ? '' : ` used in ${activeSeason}`}\n\n${actionSummary.length ? actionSummary.join('\n') : 'Stored reserve side on the fixture row.'}`)
                .setColor(0xf59e0b)
                .setFooter({ text: `Season: ${activeSeason}` })]
        });
    }

    async fixFixtureDay(message, dayNumber) {
        if (!(0, utils_1.isAdmin)(message.member))
            return message.reply("Error: This command requires admin permissions.");
        const db = (0, database_1.getDB)();
        const guildId = message.guild.id;
        const activeSeason = await this.getActiveScheduleSeason(guildId);
        if (!activeSeason)
            return message.reply("Error: No scheduling season is set. Use `?setseasonschedule` first.");
        if (!Number.isInteger(dayNumber) || dayNumber < 1)
            return message.reply("Usage: `?fixture fix day <number>`.");
        const seasonSnapshot = await this.buildFixtureScheduleSnapshot(guildId, activeSeason);
        const daySnapshot = await this.getFixtureDaySnapshot(guildId, activeSeason, dayNumber, seasonSnapshot);
        if (!daySnapshot.fixtureCount)
            return message.reply(`Error: No fixtures were found for **Day ${dayNumber}**.`);
        const groupKeys = [...new Set(daySnapshot.matches.map(entry => String(entry.fixture.group_letter || 'LEAGUE').toUpperCase()))];
        let selectedGroup = null;
        let matchesToFix = [...daySnapshot.matches];
        if (groupKeys.length > 1) {
            const groupSelectId = `fixture_fix_group_${dayNumber}_${Date.now()}`;
            const groupOptions = groupKeys
                .sort((a, b) => a.localeCompare(b))
                .map(group => ({
                label: group === 'LEAGUE' ? 'League' : `Group ${group}`,
                value: group,
                description: `Fix only ${group === 'LEAGUE' ? 'league' : `Group ${group}`} matches for Day ${dayNumber}.`
            }));
            const groupPrompt = await message.reply({
                embeds: [new discord_js_1.EmbedBuilder()
                    .setTitle(`Select Group For Day ${dayNumber}`)
                    .setDescription(`Multiple groups were found for **Day ${dayNumber}**. Choose which group to fix first.`)
                    .setColor(0x3b82f6)],
                components: [new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
                        .setCustomId(groupSelectId)
                        .setPlaceholder('Select a group')
                        .addOptions(groupOptions))]
            });
            const groupSelection = await awaitComponent(groupPrompt, {
                filter: i => i.user.id === message.author.id && i.customId === groupSelectId,
                time: 60000
            }, 'Error: Group selection timed out.');
            if (!groupSelection)
                return;
            selectedGroup = groupSelection.values[0];
            matchesToFix = daySnapshot.matches.filter(entry => String(entry.fixture.group_letter || 'LEAGUE').toUpperCase() === selectedGroup);
            await groupSelection.update({
                embeds: [new discord_js_1.EmbedBuilder()
                    .setTitle(`Selected ${selectedGroup === 'LEAGUE' ? 'League' : `Group ${selectedGroup}`}`)
                    .setDescription(`Fixing **Day ${dayNumber}** for **${selectedGroup === 'LEAGUE' ? 'League' : `Group ${selectedGroup}`}**.`)
                    .setColor(0x22c55e)],
                components: []
            });
        }
        const overviewLines = matchesToFix.map((entry, index) => {
            const reserveTeamLabel = Number(entry.reservation?.reserve_team_id) === Number(entry.fixture.team_a_id)
                ? entry.fixture.team_a_name
                : Number(entry.reservation?.reserve_team_id) === Number(entry.fixture.team_b_id)
                    ? entry.fixture.team_b_name
                    : (entry.status === 'INFERRED_RESERVED' ? 'Unknown (recovered)' : 'None');
            return `${index + 1}. **${entry.fixture.team_a_name}** vs **${entry.fixture.team_b_name}**\nCurrent: **${entry.status}**${isReservedLikeStatus(entry.status) ? ` | Reserve Team: **${reserveTeamLabel}**` : ''}`;
        });
        await message.reply({
            embeds: [new discord_js_1.EmbedBuilder()
                .setTitle(`Fix Fixture Day ${dayNumber}${selectedGroup ? ` - ${selectedGroup === 'LEAGUE' ? 'League' : `Group ${selectedGroup}`}` : ''}`)
                .setDescription(overviewLines.join('\n\n'))
                .setColor(0xf59e0b)
                .setFooter({ text: `Season: ${activeSeason}` })]
        });
        const decisions = [];
        for (let index = 0; index < matchesToFix.length; index++) {
            const entry = matchesToFix[index];
            const selectId = `fixture_fix_day_${dayNumber}_${index}_${Date.now()}`;
            const row = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
                .setCustomId(selectId)
                .setPlaceholder(`Pick result for ${entry.fixture.team_a_name} vs ${entry.fixture.team_b_name}`)
                .addOptions([
                { label: 'Completed / No Reserve', value: 'completed', description: 'Mark this fixture as completed.' },
                { label: `Reserved by ${entry.fixture.team_a_name}`, value: 'reserve_team_a', description: `${entry.fixture.team_a_name} used the reserve.` },
                { label: `Reserved by ${entry.fixture.team_b_name}`, value: 'reserve_team_b', description: `${entry.fixture.team_b_name} used the reserve.` },
                { label: 'Reserved by Admin', value: 'reserve_admin', description: 'Admin reserve, no team reserve usage.' },
                { label: 'Open / Not Done', value: 'open', description: 'Keep this fixture as not completed yet.' }
            ]));
            const prompt = await message.reply({
                embeds: [new discord_js_1.EmbedBuilder()
                    .setTitle(`Day ${dayNumber}${selectedGroup ? ` ${selectedGroup === 'LEAGUE' ? 'League' : `Group ${selectedGroup}`}` : ''} Match ${index + 1}/${matchesToFix.length}`)
                    .setDescription(`**${entry.fixture.team_a_name}** vs **${entry.fixture.team_b_name}**\nCurrent state: **${entry.status}**`)
                    .setColor(0x3b82f6)],
                components: [row]
            });
            const interaction = await awaitComponent(prompt, {
                filter: i => i.user.id === message.author.id && i.customId === selectId,
                time: 60000
            }, 'Error: Fixture day fix timed out.');
            if (!interaction)
                return;
            const selection = interaction.values[0];
            decisions.push({ entry, selection });
            const savedLabel = selection === 'completed'
                ? 'Completed / No Reserve'
                : selection === 'reserve_team_a'
                    ? `Reserved by ${entry.fixture.team_a_name}`
                    : selection === 'reserve_team_b'
                        ? `Reserved by ${entry.fixture.team_b_name}`
                        : selection === 'reserve_admin'
                            ? 'Reserved by Admin'
                            : 'Open / Not Done';
            await interaction.update({
                embeds: [new discord_js_1.EmbedBuilder()
                    .setTitle(`Saved: Day ${dayNumber}${selectedGroup ? ` ${selectedGroup === 'LEAGUE' ? 'League' : `Group ${selectedGroup}`}` : ''} Match ${index + 1}`)
                    .setDescription(`**${entry.fixture.team_a_name}** vs **${entry.fixture.team_b_name}**\nSelected: **${savedLabel}**`)
                    .setColor(0x22c55e)],
                components: []
            });
        }
        const summaryLines = decisions.map((decision, index) => {
            const entry = decision.entry;
            const label = decision.selection === 'completed'
                ? 'Completed / No Reserve'
                : decision.selection === 'reserve_team_a'
                    ? `Reserved by ${entry.fixture.team_a_name}`
                    : decision.selection === 'reserve_team_b'
                        ? `Reserved by ${entry.fixture.team_b_name}`
                        : decision.selection === 'reserve_admin'
                            ? 'Reserved by Admin'
                            : 'Open / Not Done';
            return `${index + 1}. **${entry.fixture.team_a_name}** vs **${entry.fixture.team_b_name}** -> **${label}**`;
        });
        if (!await (0, utils_1.askConfirmation)(message, `Apply these fixes for **Day ${dayNumber}${selectedGroup ? ` ${selectedGroup === 'LEAGUE' ? 'League' : `Group ${selectedGroup}`}` : ''}**?\n${summaryLines.join('\n')}`)) {
            return message.reply("Action cancelled.");
        }
        const applyNotes = [];
        for (const decision of decisions) {
            const entry = decision.entry;
            const fixture = entry.fixture;
            const existing = entry.reservation || await this.findFixtureScheduleForFixture(guildId, activeSeason, { ...fixture, day_number: dayNumber }, ['COMPLETED', 'RESERVED', 'OPEN', 'PENDING', 'SCHEDULED']);
            const previousStoredReserveTeamId = existing?.reserve_team_id ? Number(existing.reserve_team_id) : null;
            const previousReservedLike = isReservedLikeStatus(entry.status) || existing?.status === 'RESERVED';
            let nextStatus = 'COMPLETED';
            let nextReserveTeamId = null;
            if (decision.selection === 'open') {
                nextStatus = 'OPEN';
            }
            else if (decision.selection === 'reserve_team_a') {
                nextStatus = 'RESERVED';
                nextReserveTeamId = fixture.team_a_id;
            }
            else if (decision.selection === 'reserve_team_b') {
                nextStatus = 'RESERVED';
                nextReserveTeamId = fixture.team_b_id;
            }
            else if (decision.selection === 'reserve_admin') {
                nextStatus = 'RESERVED';
            }
            if (nextStatus === 'RESERVED' && nextReserveTeamId) {
                if (previousStoredReserveTeamId && previousStoredReserveTeamId !== nextReserveTeamId) {
                    await this.decrementReserveUsage(guildId, activeSeason, previousStoredReserveTeamId);
                    await this.incrementReserveUsage(guildId, activeSeason, nextReserveTeamId);
                }
                else if (!previousStoredReserveTeamId && !previousReservedLike) {
                    await this.incrementReserveUsage(guildId, activeSeason, nextReserveTeamId);
                }
            }
            else {
                if (previousStoredReserveTeamId) {
                    await this.decrementReserveUsage(guildId, activeSeason, previousStoredReserveTeamId);
                }
                else if (previousReservedLike && entry.status === 'INFERRED_RESERVED') {
                    applyNotes.push(`${fixture.team_a_name} vs ${fixture.team_b_name}: previous reserve side was inferred only, so no old reserve count was auto-refunded.`);
                }
            }
            const stadiumChannelId = existing?.stadium_channel_id || fixture.stadium_id || null;
            if (existing) {
                await db.run('UPDATE match_reservations SET status = ?, reserved_by_captain_id = ?, reserve_team_id = ?, scheduled_time = NULL, agreement_time = NULL, reserve_day_number = NULL, stadium_channel_id = COALESCE(?, stadium_channel_id), fixture_day_number = ? WHERE id = ?', nextStatus, message.author.id, nextReserveTeamId, stadiumChannelId, String(dayNumber), existing.id);
            }
            else {
                await db.run('INSERT INTO match_reservations (guild_id, season_name, team_a_id, team_b_id, reserved_by_captain_id, status, scheduled_time, created_at, agreement_time, stadium_channel_id, fixture_day_number, reserve_day_number, reserve_team_id) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, NULL, ?)', guildId, activeSeason, fixture.team_a_id, fixture.team_b_id, message.author.id, nextStatus, Math.floor(Date.now() / 1000), stadiumChannelId, String(dayNumber), nextReserveTeamId);
            }
            if (stadiumChannelId) {
                if (nextStatus === 'OPEN') {
                    this.markStadiumChannelActive(guildId, stadiumChannelId);
                }
                else {
                    this.removeStadiumChannel(stadiumChannelId);
                    await this.lockChannel(message.guild, stadiumChannelId).catch(() => null);
                }
            }
        }
        await (0, auditLog_1.appendAdminAuditLog)({
            guildId,
            actorId: message.author.id,
            commandName: 'fixturefix',
            summary: `Fixed Day ${dayNumber} fixture states.`,
            targetSummary: summaryLines.join(' | ').slice(0, 300),
            channelId: message.channel.id
        });
        return message.reply({
            embeds: [new discord_js_1.EmbedBuilder()
                .setTitle(`Fixture Day ${dayNumber} Fixed${selectedGroup ? ` - ${selectedGroup === 'LEAGUE' ? 'League' : `Group ${selectedGroup}`}` : ''}`)
                .setDescription(summaryLines.join('\n') + (applyNotes.length ? `\n\nNotes:\n${applyNotes.join('\n')}` : ''))
                .setColor(0x22c55e)
                .setFooter({ text: `Season: ${activeSeason}` })]
        });
    }

    async announceTime(message, args) {
        if (!(0, utils_1.isAdmin)(message.member)) return;
        const timeStr = args.join(' ');
        if (!timeStr) return message.reply("Usage: `?announce [Time, e.g. 9:00 PM]`");

        const db = (0, database_1.getDB)();
        const guildId = message.guild.id;
        
        const res = await db.get(`
            SELECT r.*, t1.team_name as t1name, t2.team_name as t2name, t1.role_id as t1role, t2.role_id as t2role,
                   COALESCE(tc1.captain_discord_id, t1.owner_discord_id) as cap1,
                   COALESCE(tc2.captain_discord_id, t2.owner_discord_id) as cap2
            FROM match_reservations r 
            JOIN teams t1 ON r.team_a_id = t1.team_id 
            JOIN teams t2 ON r.team_b_id = t2.team_id 
            LEFT JOIN team_captains tc1 ON r.team_a_id = tc1.team_id AND tc1.guild_id = r.guild_id
            LEFT JOIN team_captains tc2 ON r.team_b_id = tc2.team_id AND tc2.guild_id = r.guild_id
            WHERE r.guild_id = ? AND r.stadium_channel_id = ? AND r.status IN ('PENDING', 'OPEN', 'SCHEDULED')
            ORDER BY r.created_at DESC LIMIT 1
        `, guildId, message.channel.id);

        if (!res) return message.reply("❌ No active or scheduled fixture found in this channel to announce for.");

        const scheduledTime = await this.parseTimeToTimestamp(timeStr, guildId);
        if (!scheduledTime) return message.reply("❌ Invalid time format. Try: `9:00 PM` or `21:30`.");

        const disp = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: 'numeric', hour12: true }).format(new Date(scheduledTime * 1000));
        const ping1 = res.t1role ? `<@&${res.t1role}>` : `**${res.t1name}**`;
        const ping2 = res.t2role ? `<@&${res.t2role}>` : `**${res.t2name}**`;
        
        const isReschedule = res.status === 'SCHEDULED';
        const confirmText = isReschedule 
            ? `Reschedule **${res.t1name}** vs **${res.t2name}** to **${disp}** (IST)?` 
            : `Announce **${res.t1name}** vs **${res.t2name}** at **${disp}** (IST)?`;

        if (!await (0, utils_1.askConfirmation)(message, confirmText)) {
            return message.reply("Error: Action cancelled.");
        }
        await db.run('UPDATE match_reservations SET status = "SCHEDULED", scheduled_time = ?, agreement_time = NULL WHERE id = ?', scheduledTime, res.id);

        await message.channel.send({ 
            content: `# ${ping1} vs ${ping2}`, 
            embeds: [new discord_js_1.EmbedBuilder()
                .setTitle(isReschedule ? "Match Time Updated by Admin" : "Match Time Announced by Admin")
                .setDescription(`The match has been ${isReschedule ? 'rescheduled' : 'scheduled'} for: **${disp}** (IST) / <t:${scheduledTime}:F>\n\nStadium locked until match time.`)
                .setColor(isReschedule ? 0xFFA500 : 0xFF0000)
                .setTimestamp()] 
        });

        // Lock for everyone
        await this.lockChannel(message.guild, message.channel.id);
        // Revoke captain overrides
        if (res.cap1) await message.channel.permissionOverwrites.delete(res.cap1).catch(() => {});
        if (res.cap2) await message.channel.permissionOverwrites.delete(res.cap2).catch(() => {});
        this.markStadiumChannelActive(guildId, message.channel.id);
    }

    async announceFixtureDay(guild, dayNum, isReserveDay = false, announcementChannel = null) {
        const db = (0, database_1.getDB)();
        const guildId = guild.id;
        const season = await this.getActiveScheduleSeason(guildId);
        if (!season) return { ok: false, error: "No active season found." };
        if (isReserveDay) {
            const progress = await this.getNormalFixtureProgress(guildId, season);
            if (progress.firstUnfinished) {
                return { ok: false, error: `Normal fixtures are not finished yet. Day ${progress.firstUnfinished.dayNumber} is still not over.` };
            }
        }
        else {
            const progress = await this.getNormalFixtureProgress(guildId, season);
            const earlierBlockingDays = progress.snapshots.filter(snapshot => snapshot.dayNumber < dayNum && !snapshot.isOver).map(snapshot => snapshot.dayNumber);
            if (earlierBlockingDays.length > 0) {
                return { ok: false, error: `Cannot announce Day ${dayNum} while earlier days are unfinished: ${earlierBlockingDays.map(day => `Day ${day}`).join(', ')}.` };
            }
            const targetSnapshot = progress.snapshots.find(snapshot => snapshot.dayNumber === Number(dayNum)) || null;
            if (targetSnapshot?.activeCount > 0) {
                return { ok: false, error: `Day ${dayNum} is already active in stadiums.` };
            }
            if (targetSnapshot?.isOver) {
                return { ok: false, error: `Day ${dayNum} is already over.` };
            }
            const hasPartialState = targetSnapshot?.matches?.some(match => match.status !== 'MISSING') && !targetSnapshot?.activeCount;
            if (hasPartialState) {
                return { ok: false, error: `Day ${dayNum} has partial saved state already. Use \`?fixture undo day ${dayNum}\` before announcing it again.` };
            }
            await this.closeStaleFixtureReservations(guild, season, Number(dayNum)).catch(() => 0);
        }

        const settings = await db.get('SELECT * FROM fixture_settings WHERE guild_id = ?', guildId) || {};
        const teams = await db.all('SELECT * FROM teams WHERE guild_id = ?', guildId);

        let fixtures;
        if (isReserveDay) {
            const reserveBatches = await this.buildReserveDayBatches(guildId, season);
            const targetBatch = reserveBatches.batches.find(batch => batch.dayNumber === Number(dayNum)) || null;
            if (!targetBatch)
                return { ok: false, error: `No pending reserved matches found for Reserve Day ${dayNum}.` };
            fixtures = targetBatch.entries;
        } else {
            fixtures = await db.all('SELECT * FROM generated_fixtures WHERE guild_id = ? AND season_name = ? AND day_number = ?', [guildId, season, dayNum]);
        }

        if (!fixtures || fixtures.length === 0) return { ok: false, error: `No fixtures found for ${isReserveDay ? 'Reserve ' : ''}Day ${dayNum}.` };

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
        header += `\n# ${isReserveDay ? 'Reserve ' : ''}Day ${dayNum} Fixture \n`;

        if (!isReserveDay) {
            const maxDayRes = await db.get('SELECT MAX(day_number) as maxDay FROM generated_fixtures WHERE guild_id = ? AND season_name = ?', [guildId, season]);
            if (maxDayRes && maxDayRes.maxDay === dayNum) {
                header += `### 📢 Last Day of Normal Fixtures! 🏁\n`;
            }
        }

        const matchLines = fixtures.map(f => `- ${formatMatch(f)}`);

        let footer = `\nRules -\n`;
        footer += `- Min ${settings.min_players || '6v6'} Max ${settings.max_players || '9v9'}\n`;
        footer += `- Must do .tm ; .ctn ; .o before starting \n`;
        footer += `- Max Reserve : ${settings.max_reserve || 2} per team \n`;
        footer += `- ${settings.rep_rules || '3 Rep max ; 1 rep = 30 runs , 2 rep = 25 runs , 3 rep = 20 runs'}\n`;
        footer += `- Please agree on time in your respective stadiums.\n\n`;
        footer += `### Format - ${settings.match_format || '20 Overs Elite with catch'}\n\n`;
        footer += `### Deadline - Complete matches before ${deadlineStr}`;

        let channel = announcementChannel;
        if (!channel) {
            const gSettings = await db.get('SELECT fixture_announcement_channel_id FROM guild_settings WHERE guild_id = ?', guildId);
            if (gSettings?.fixture_announcement_channel_id) {
                channel = await guild.channels.fetch(gSettings.fixture_announcement_channel_id).catch(() => null);
            }
        }
        if (!channel) return { ok: false, error: "No announcement channel found." };

        let currentMsg = header;
        for (const line of matchLines) {
            if ((currentMsg + line + '\n').length > 1900) {
                await channel.send(currentMsg);
                currentMsg = "";
            }
            currentMsg += line + '\n';
        }

        if ((currentMsg + footer).length > 2000) {
            await channel.send(currentMsg);
            await channel.send(footer);
        } else {
            await channel.send(currentMsg + footer);
        }

        // Open stadiums
        if (isReserveDay) {
            for (const f of fixtures) {
                await this.openFixtureMatch(guild, {
                    season_name: season,
                    day_number: `Reserve ${dayNum}`,
                    team_a_id: f.fixture.team_a_id,
                    team_b_id: f.fixture.team_b_id,
                    stadium_id: f.reservation?.stadium_channel_id || f.fixture.stadium_id || null
                });
            }
        } else {
            for (const f of fixtures) {
                await this.openFixtureMatch(guild, f);
            }
        }

        return { ok: true, fixturesCount: fixtures.length };
    }

    async getTeamByName(guildId, name) {
        let cached = await this.resolveTeamByNameCached(guildId, name);
        if (cached)
            return cached;
        const db = (0, database_1.getDB)();
        let t = await db.get('SELECT * FROM teams WHERE guild_id = ? AND team_name = ?', guildId, name);
        if (!t)
            t = await db.get('SELECT * FROM teams WHERE guild_id = ? AND team_name LIKE ?', guildId, `%${name}%`);
        if (t)
            this.invalidateTeamCache(guildId);
        return t || null;
    }

    async getCaptainFromTeamRole(guildId, role) {
        const db = (0, database_1.getDB)();
        const t = await this.getTeamByName(guildId, role.name);
        if (!t) return null;
        const c = await db.get('SELECT captain_discord_id FROM team_captains WHERE guild_id = ? AND team_id = ?', guildId, t.team_id);
        return c ? c.captain_discord_id : null;
    }

    async lockChannel(guild, cid) { const c = await guild.channels.fetch(cid).catch(()=>null); if (c) await c.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false }); }
    async unlockChannel(guild, cid) { const c = await guild.channels.fetch(cid).catch(()=>null); if (c) await c.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: true }); }

    async closeStaleFixtureReservations(guild, seasonName, currentDayNumber) {
        const db = (0, database_1.getDB)();
        if (!guild || !seasonName || !Number.isInteger(currentDayNumber) || currentDayNumber <= 1)
            return 0;
        const staleReservations = await db.all(`
            SELECT DISTINCT r.id, r.stadium_channel_id, t1.team_name as t1n, t2.team_name as t2n, gf.day_number
            FROM match_reservations r
            JOIN generated_fixtures gf
              ON gf.guild_id = r.guild_id
             AND gf.season_name = r.season_name
             AND gf.day_number < ?
             AND ((gf.team_a_id = r.team_a_id AND gf.team_b_id = r.team_b_id)
               OR (gf.team_a_id = r.team_b_id AND gf.team_b_id = r.team_a_id))
             AND (r.stadium_channel_id IS NULL OR gf.stadium_id IS NULL OR gf.stadium_id = r.stadium_channel_id)
            JOIN teams t1 ON r.team_a_id = t1.team_id
            JOIN teams t2 ON r.team_b_id = t2.team_id
            WHERE r.guild_id = ? AND r.season_name = ? AND r.status IN ('PENDING', 'OPEN')
        `, currentDayNumber, guild.id, seasonName);
        for (const reservation of staleReservations) {
            await db.run('UPDATE match_reservations SET status = "EXPIRED", agreement_time = NULL WHERE id = ?', reservation.id);
            if (reservation.stadium_channel_id) {
                this.removeStadiumChannel(reservation.stadium_channel_id);
                const stadiumChannel = await guild.channels.fetch(reservation.stadium_channel_id).catch(() => null);
                if (stadiumChannel && stadiumChannel.isTextBased?.()) {
                    await stadiumChannel.send({
                        embeds: [new discord_js_1.EmbedBuilder()
                            .setTitle('Scheduling Closed')
                            .setDescription(`The pending scheduling window for **${reservation.t1n} vs ${reservation.t2n}** from **Day ${reservation.day_number}** has been closed because a newer fixture day is now active.`)
                            .setColor(0x808080)]
                    }).catch(() => null);
                }
            }
        }
        if (staleReservations.length > 0) {
            await this.refreshStadiumCache(guild.id);
        }
        return staleReservations.length;
    }

    async openFixtureMatch(guild, fixture) {
        const db = (0, database_1.getDB)();
        const guildId = guild.id;
        const activeSeason = fixture.season_name;
        const fixtureDayKey = normalizeFixtureDayKey(fixture.day_number);
        const reserveDayNumber = parseReserveDayNumber(fixture.day_number);
        const pairFixtures = reserveDayNumber === null
            ? await db.all(`SELECT day_number, stadium_id
                FROM generated_fixtures
                WHERE guild_id = ? AND season_name = ?
                  AND ((team_a_id = ? AND team_b_id = ?) OR (team_a_id = ? AND team_b_id = ?))
                ORDER BY day_number ASC`, guildId, activeSeason, fixture.team_a_id, fixture.team_b_id, fixture.team_b_id, fixture.team_a_id).catch(() => [])
            : [];
        let existing = null;
        if (reserveDayNumber !== null) {
            existing = await db.get(`SELECT * FROM match_reservations
                WHERE guild_id = ? AND season_name = ? AND reserve_day_number = ?
                  AND ((team_a_id = ? AND team_b_id = ?) OR (team_a_id = ? AND team_b_id = ?))
                ORDER BY created_at DESC
                LIMIT 1`, guildId, activeSeason, reserveDayNumber, fixture.team_a_id, fixture.team_b_id, fixture.team_b_id, fixture.team_a_id);
            if (!existing) {
                existing = await db.get(`SELECT * FROM match_reservations
                    WHERE guild_id = ? AND season_name = ?
                      AND ((team_a_id = ? AND team_b_id = ?) OR (team_a_id = ? AND team_b_id = ?))
                      AND reserve_day_number IS NULL
                      AND status = 'RESERVED'
                    ORDER BY created_at DESC
                    LIMIT 1`, guildId, activeSeason, fixture.team_a_id, fixture.team_b_id, fixture.team_b_id, fixture.team_a_id);
            }
        }
        else {
            existing = await db.get(`SELECT * FROM match_reservations
                WHERE guild_id = ? AND season_name = ? AND fixture_day_number = ?
                  AND ((team_a_id = ? AND team_b_id = ?) OR (team_a_id = ? AND team_b_id = ?))
                ORDER BY created_at DESC
                LIMIT 1`, guildId, activeSeason, fixtureDayKey, fixture.team_a_id, fixture.team_b_id, fixture.team_b_id, fixture.team_a_id);
            if (!existing && pairFixtures.length <= 1) {
                existing = await db.get(`SELECT * FROM match_reservations
                    WHERE guild_id = ? AND season_name = ?
                      AND ((team_a_id = ? AND team_b_id = ?) OR (team_a_id = ? AND team_b_id = ?))
                      AND (fixture_day_number IS NULL OR TRIM(fixture_day_number) = '')
                      AND status IN ('OPEN', 'PENDING', 'SCHEDULED')
                    ORDER BY created_at DESC
                    LIMIT 1`, guildId, activeSeason, fixture.team_a_id, fixture.team_b_id, fixture.team_b_id, fixture.team_a_id);
            }
        }
        if (existing) {
            if (['PENDING', 'SCHEDULED', 'OPEN'].includes(existing.status)) {
                await db.run('UPDATE match_reservations SET stadium_channel_id = COALESCE(?, stadium_channel_id), fixture_day_number = COALESCE(?, fixture_day_number), reserve_day_number = COALESCE(?, reserve_day_number) WHERE id = ?', fixture.stadium_id || null, reserveDayNumber === null ? fixtureDayKey : null, reserveDayNumber, existing.id);
            }
            else {
                await db.run('UPDATE match_reservations SET status = "OPEN", created_at = ?, scheduled_time = NULL, agreement_time = NULL, stadium_channel_id = COALESCE(?, stadium_channel_id), fixture_day_number = ?, reserve_day_number = ? WHERE id = ?', Math.floor(Date.now()/1000), fixture.stadium_id || null, reserveDayNumber === null ? fixtureDayKey : null, reserveDayNumber, existing.id);
            }
        } else {
            await db.run('INSERT INTO match_reservations (guild_id, season_name, team_a_id, team_b_id, reserved_by_captain_id, created_at, status, stadium_channel_id, fixture_day_number, reserve_day_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', 
                guildId, activeSeason, fixture.team_a_id, fixture.team_b_id, 'SYSTEM', Math.floor(Date.now()/1000), 'OPEN', fixture.stadium_id, reserveDayNumber === null ? fixtureDayKey : null, reserveDayNumber);
        }
        
        const stadium = await guild.channels.fetch(fixture.stadium_id).catch(() => null);
        if (stadium) {
            // Lock for everyone first
            await stadium.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false, ViewChannel: true });

            const t1 = await db.get('SELECT team_name, role_id, owner_discord_id FROM teams WHERE team_id = ?', fixture.team_a_id);
            const t2 = await db.get('SELECT team_name, role_id, owner_discord_id FROM teams WHERE team_id = ?', fixture.team_b_id);
            const cap1 = await db.get(`
                SELECT COALESCE(tc.captain_discord_id, t.owner_discord_id) as captain_discord_id
                FROM teams t
                LEFT JOIN team_captains tc ON tc.guild_id = t.guild_id AND tc.team_id = t.team_id
                WHERE t.team_id = ?
            `, fixture.team_a_id);
            const cap2 = await db.get(`
                SELECT COALESCE(tc.captain_discord_id, t.owner_discord_id) as captain_discord_id
                FROM teams t
                LEFT JOIN team_captains tc ON tc.guild_id = t.guild_id AND tc.team_id = t.team_id
                WHERE t.team_id = ?
            `, fixture.team_b_id);
            
            const vc1 = await db.get('SELECT vice_captain_discord_id FROM team_vice_captains WHERE guild_id = ? AND team_id = ?', guildId, fixture.team_a_id);
            const vc2 = await db.get('SELECT vice_captain_discord_id FROM team_vice_captains WHERE guild_id = ? AND team_id = ?', guildId, fixture.team_b_id);

            const adminRole = guild.roles.cache.find(r => r.name === utils_1.ADMIN_ROLE_NAME);
            const superAdminRole = guild.roles.cache.find(r => r.name === utils_1.SUPER_ADMIN_ROLE_NAME);
            const globalManagers = (0, utils_1.getGlobalManagersList)();

            // Unlock channel for captains specifically if it's locked
            const targets = [
                cap1?.captain_discord_id, cap2?.captain_discord_id,
                vc1?.vice_captain_discord_id, vc2?.vice_captain_discord_id,
                adminRole?.id, superAdminRole?.id,
                ...globalManagers
            ].filter(id => id && id !== 'SYSTEM');

            for (const targetId of targets) {
                try {
                    const target = await guild.members.fetch(targetId).catch(() => null) || 
                                 await guild.roles.fetch(targetId).catch(() => null);
                    if (target) {
                        await stadium.permissionOverwrites.edit(target, { SendMessages: true, ViewChannel: true });
                    }
                } catch (e) { console.error(`Failed to set permissions for target: ${targetId}`, e); }
            }

            const embed = new discord_js_1.EmbedBuilder()
                .setTitle(`Match Opened: Day ${fixture.day_number}`)
                .setDescription(`Captains, please agree on a time for **${t1?.team_name} vs ${t2?.team_name}**.\n\nSimply type the time (e.g., 8:30 PM) or "done" to confirm.`)
                .setColor(0xFFA500)
                .setFooter({ text: `Season: ${activeSeason}` });
            
            await stadium.send({ embeds: [embed] });

            let pingsText = '';
            if (cap1?.captain_discord_id) pingsText += `**${t1.team_name}** Cap: <@${cap1.captain_discord_id}>\n`;
            if (vc1?.vice_captain_discord_id) pingsText += `**${t1.team_name}** VC: <@${vc1.vice_captain_discord_id}>\n`;
            if (cap2?.captain_discord_id) pingsText += `**${t2.team_name}** Cap: <@${cap2.captain_discord_id}>\n`;
            if (vc2?.vice_captain_discord_id) pingsText += `**${t2.team_name}** VC: <@${vc2.vice_captain_discord_id}>\n`;
            
            pingsText += `\n*Note: If the Captain is unavailable, the Vice Captain can also decide the time.*`;
            
            await stadium.send({ content: pingsText });

            this.markStadiumChannelActive(guildId, fixture.stadium_id);
        }
    }

    purgeExpiredStadiumEntries() {
        const now = Date.now();
        for (const [channelId, meta] of this.stadiumCacheByChannel.entries()) {
            if (meta.expiresAt <= now) {
                this.stadiumCacheByChannel.delete(channelId);
            }
        }
    }

    markStadiumChannelActive(guildId, channelId) {
        if (!channelId)
            return;
        this.stadiumCacheByChannel.set(channelId, { guildId, expiresAt: Date.now() + this.STADIUM_CACHE_TTL_MS });
    }

    removeStadiumChannel(channelId) {
        if (!channelId)
            return;
        this.stadiumCacheByChannel.delete(channelId);
    }

    async refreshStadiumCache(guildId) {
        const db = (0, database_1.getDB)();
        for (const [channelId, meta] of this.stadiumCacheByChannel.entries()) {
            if (meta.guildId === guildId) {
                this.stadiumCacheByChannel.delete(channelId);
            }
        }
        const rows = await db.all('SELECT stadium_channel_id FROM match_reservations WHERE guild_id = ? AND stadium_channel_id IS NOT NULL AND status IN ("PENDING", "OPEN", "SCHEDULED")', guildId);
        const expiresAt = Date.now() + this.STADIUM_CACHE_TTL_MS;
        rows.forEach(row => this.stadiumCacheByChannel.set(row.stadium_channel_id, { guildId, expiresAt }));
        this.guildStadiumRefresh.set(guildId, Date.now());
    }

    async channelLikelyNeedsScheduling(guildId, channelId) {
        this.purgeExpiredStadiumEntries();
        const cached = this.stadiumCacheByChannel.get(channelId);
        if (cached && cached.guildId === guildId) {
            this.markStadiumChannelActive(guildId, channelId);
            return true;
        }
        const db = (0, database_1.getDB)();
        const directHit = await db.get('SELECT 1 FROM match_reservations WHERE guild_id = ? AND stadium_channel_id = ? AND status IN ("PENDING", "OPEN") LIMIT 1', guildId, channelId);
        if (directHit) {
            this.markStadiumChannelActive(guildId, channelId);
            return true;
        }
        const lastRefresh = this.guildStadiumRefresh.get(guildId) || 0;
        if (Date.now() - lastRefresh < this.STADIUM_CACHE_TTL_MS) {
            return false;
        }
        await this.refreshStadiumCache(guildId);
        return this.stadiumCacheByChannel.has(channelId);
    }

    invalidateTeamCache(guildId) {
        this.teamCache.delete(guildId);
    }

    async getTeamCacheRecord(guildId) {
        const cached = this.teamCache.get(guildId);
        const now = Date.now();
        if (cached && (now - cached.loadedAt) < this.TEAM_CACHE_TTL_MS) {
            return cached;
        }
        const db = (0, database_1.getDB)();
        const teams = await db.all('SELECT * FROM teams WHERE guild_id = ?', guildId);
        const normalized = new Map();
        for (const team of teams) {
            normalized.set(team.team_name.toLowerCase(), team);
        }
        const record = { loadedAt: now, teams, normalized };
        this.teamCache.set(guildId, record);
        return record;
    }

    async getAllTeams(guildId) {
        return (await this.getTeamCacheRecord(guildId)).teams;
    }

    async resolveTeamByNameCached(guildId, name) {
        if (!name)
            return null;
        const cleaned = name.toLowerCase().replace(/"/g, '').trim();
        if (!cleaned)
            return null;
        const cache = await this.getTeamCacheRecord(guildId);
        if (cache.normalized.has(cleaned))
            return cache.normalized.get(cleaned);
        for (const team of cache.teams) {
            const candidate = team.team_name.toLowerCase();
            if (candidate === cleaned || candidate.includes(cleaned)) {
                return team;
            }
        }
        return null;
    }

    async checkScheduledMatches(client) {
        if (this.matchSchedulerRunning)
            return;
        this.matchSchedulerRunning = true;
        try {
            const db = (0, database_1.getDB)();
            const now = Math.floor(Date.now() / 1000);
            const due = await db.all('SELECT * FROM match_reservations WHERE status = "SCHEDULED" AND scheduled_time <= ?', now);
            
            for (const m of due) {
                const g = client.guilds.cache.get(m.guild_id);
                if (g && m.stadium_channel_id) {
                    const c = await g.channels.fetch(m.stadium_channel_id).catch(()=>null);
                    if (c) {
                        await this.unlockChannel(g, m.stadium_channel_id);
                        const t1 = await db.get('SELECT team_name, role_id FROM teams WHERE team_id = ?', m.team_a_id);
                        const t2 = await db.get('SELECT team_name, role_id FROM teams WHERE team_id = ?', m.team_b_id);

                        // Only ping team roles at match start
                        const ping1 = t1?.role_id ? `<@&${t1.role_id}>` : `**${t1?.team_name}**`;
                        const ping2 = t2?.role_id ? `<@&${t2.role_id}>` : `**${t2?.team_name}**`;

                        await c.send({ 
                            content: `🚀 **Match Starting Now!**\n# ${ping1} vs ${ping2}`, 
                            embeds: [new discord_js_1.EmbedBuilder()
                                .setTitle("Stadium Open")
                                .setDescription(`**${t1.team_name}** vs **${t2.team_name}**\n\nCaptains, please begin your match.`)
                                .setColor(0x00FF00)] 
                        });
                    }
                }
                if (m.stadium_channel_id)
                    this.removeStadiumChannel(m.stadium_channel_id);
                await db.run('UPDATE match_reservations SET status = "COMPLETED" WHERE id = ?', m.id);
            }
        }
        finally {
            this.matchSchedulerRunning = false;
        }
    }
}
exports.matchSystem = new MatchSystem();
