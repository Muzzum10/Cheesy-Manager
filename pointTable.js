const { getDB } = require('./database');
const statsSystem = require('./statsSystem');
const { EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('canvas');
const { isAdmin } = require('./utils');
const pointTableTemplateCache = new Map();
function getGroupLetters(limit = 'A') {
    const letters = [];
    const upper = (limit || 'A').toUpperCase();
    const start = 'A'.charCodeAt(0);
    const end = upper.charCodeAt(0);
    for (let c = start; c <= end; c++) {
        letters.push(String.fromCharCode(c));
    }
    return letters;
}
async function getPointTableTemplate(layoutSize) {
    let effectiveSize = layoutSize;
    if (layoutSize === 7)
        effectiveSize = 8;
    const imagePath = `pointtable${effectiveSize}teams.png`;
    if (!pointTableTemplateCache.has(imagePath)) {
        pointTableTemplateCache.set(imagePath, loadImage(imagePath));
    }
    return pointTableTemplateCache.get(imagePath);
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
            else {
                await message.channel.send(timeoutText);
            }
        }
        catch (_a) {
        }
        return null;
    }
}

async function handleSetSeason(message, args) {
    if (!(0, isAdmin)(message.member)) return;
    const season = parseInt(args[0]);
    if (isNaN(season)) return message.reply("Usage: `?setpointtableseason <number>` (e.g. `?setpointtableseason 10`) ");

    const db = (0, getDB)();
    const guildId = message.guild.id;

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('layout_6').setLabel('6 Teams').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('layout_7').setLabel('7 Teams').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('layout_8').setLabel('8 Teams').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('layout_10').setLabel('10 Teams').setStyle(ButtonStyle.Primary),
        );

    const response = await message.reply({ 
        content: "Please select a point table layout:", 
        components: [row] 
    });

    const filter = i => i.user.id === message.author.id;
    const collector = response.createMessageComponentCollector({ filter, time: 30000, max: 1 });

    collector.on('collect', async i => {
        const layoutSize = parseInt(i.customId.split('_')[1]);
        await db.run('INSERT INTO pt_settings (guild_id, current_season, layout_size) VALUES (?, ?, ?) ON CONFLICT(guild_id) DO UPDATE SET current_season = ?, layout_size = ?',
            guildId, season, layoutSize, season, layoutSize);
        await i.update({ content: `✅ Point table set to Season ${season} with ${layoutSize} teams layout.`, components: [] });
    });
}

async function handleSetAlias(message, args) {
    if (!(0, isAdmin)(message.member)) return;
    
    // Usage: ?setabb "Sunrisers Hyderabad" SRH
    const content = message.content.slice(message.content.indexOf(' ') + 1);
    const match = content.match(/"([^"]+)"\s+(\S+)/) || content.match(/(\S+)\s+(\S+)/);
    
    if (!match) return message.reply('Usage: `?setabb "Full Team Name" ABBV`');

    const fullName = match[1];
    const alias = match[2].toUpperCase();

    const db = (0, getDB)();
    const guildId = message.guild.id;

     const existingAlias = await db.get('SELECT full_name FROM pt_team_aliases WHERE guild_id = ? AND alias = ?', guildId, alias);
     if (existingAlias && existingAlias.full_name !== fullName) {
         return message.reply(`❌ Abbreviation **${alias}** is already used by **${existingAlias.full_name}**. Please choose a different abbreviation.`);
     }

    await db.run('INSERT INTO pt_team_aliases (guild_id, full_name, alias) VALUES (?, ?, ?) ON CONFLICT(guild_id, alias) DO UPDATE SET full_name = ?',
        guildId, fullName, alias, fullName);

    message.reply(`✅ Abbreviation set: **${alias}** -> **${fullName}**`);
}

async function getPtAbbreviationContext(guildId) {
    const db = (0, getDB)();
    let settings = await db.get('SELECT current_season, format_type, group_limit FROM pt_settings WHERE guild_id = ?', guildId);
    if (!settings) {
        settings = { current_season: 1, format_type: 'LEAGUE', group_limit: 'A' };
    }
    const season = settings.current_season || 1;
    const formatType = settings.format_type || 'LEAGUE';
    const allowedGroups = getGroupLetters(formatType === 'GROUPS' ? (settings.group_limit || 'A') : 'A');
    const seasonLabel = await statsSystem.getActiveSeason(guildId) || `S${season}`;
    const rows = await db.all(`SELECT a.alias, a.full_name, tg.group_letter
        FROM pt_team_aliases a
        LEFT JOIN teams t ON t.guild_id = a.guild_id AND t.team_name = a.full_name
        LEFT JOIN team_groups tg ON tg.guild_id = a.guild_id AND tg.team_id = t.team_id AND tg.season_name = ?
        WHERE a.guild_id = ?
        ORDER BY a.alias ASC`, seasonLabel, guildId);
    return {
        season,
        seasonLabel,
        formatType,
        allowedGroups,
        rows
    };
}

function buildAbbreviationDescription(rows) {
    if (!rows.length)
        return 'No abbreviations set for this view yet.';
    return rows.map(row => `**${row.alias}**: ${row.full_name}`).join('\n');
}

function normalizeRequestedGroup(args = []) {
    if (!args.length)
        return null;
    if (args[0]?.toLowerCase() === 'group' && args[1]) {
        return args[1].toUpperCase();
    }
    if (/^[a-h]$/i.test(args[0] || '')) {
        return args[0].toUpperCase();
    }
    return null;
}

async function handleShowAliases(message, args = []) {
    const guildId = message.guild.id;
    const { formatType, allowedGroups, rows } = await getPtAbbreviationContext(guildId);

    if (rows.length === 0)
        return message.reply("No abbreviations set yet.");

    const requestedGroup = normalizeRequestedGroup(args);
    if (requestedGroup && !allowedGroups.includes(requestedGroup)) {
        return message.reply(`Unknown group **${requestedGroup}**. Valid groups: ${allowedGroups.join(', ')}.`);
    }

    if (formatType !== 'GROUPS') {
        const embed = new EmbedBuilder()
            .setTitle("Team Abbreviations")
            .setColor(0x0099ff)
            .setDescription(buildAbbreviationDescription(rows))
            .setFooter({ text: "Use these abbreviations in ?ptmatch" });
        return message.reply({ embeds: [embed] });
    }

    const buildGroupEmbed = (groupLetter, index, total) => {
        const groupRows = rows.filter(row => row.group_letter === groupLetter);
        return new EmbedBuilder()
            .setTitle(`Team Abbreviations - Group ${groupLetter}`)
            .setColor(0x0099ff)
            .setDescription(buildAbbreviationDescription(groupRows))
            .setFooter({ text: `Page ${index + 1} of ${total} | Use these abbreviations in ?ptmatch ${groupLetter}` });
    };

    if (requestedGroup) {
        const pageIndex = Math.max(0, allowedGroups.indexOf(requestedGroup));
        return message.reply({ embeds: [buildGroupEmbed(requestedGroup, pageIndex, allowedGroups.length)] });
    }

    let currentPage = 0;
    const buildRow = (pageIndex) => new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
        .setCustomId('abbr_group_select')
        .setPlaceholder('Jump to group')
        .addOptions(allowedGroups.map((groupLetter, index) => ({
        label: `Group ${groupLetter}`,
        value: groupLetter,
        default: index === pageIndex
    }))));

    const response = await message.reply({
        embeds: [buildGroupEmbed(allowedGroups[currentPage], currentPage, allowedGroups.length)],
        components: [buildRow(currentPage)]
    });

    const collector = response.createMessageComponentCollector({
        filter: i => i.user.id === message.author.id && i.customId === 'abbr_group_select',
        time: 300000
    });

    collector.on('collect', async i => {
        currentPage = Math.max(0, allowedGroups.indexOf(i.values[0]));
        await i.update({
            embeds: [buildGroupEmbed(allowedGroups[currentPage], currentPage, allowedGroups.length)],
            components: [buildRow(currentPage)]
        }).catch(() => { });
    });

    collector.on('end', () => {
        response.edit({ components: [] }).catch(() => { });
    });
}

async function getAliasHelp(guildId, options = {}) {
    const { formatType, allowedGroups, rows } = await getPtAbbreviationContext(guildId);
    const targetGroup = options.groupLetter && allowedGroups.includes(options.groupLetter) ? options.groupLetter : null;
    if (rows.length === 0)
        return "No abbreviations set yet. Use `?setabb` to add some.";
    if (formatType === 'GROUPS' && targetGroup) {
        const groupRows = rows.filter(row => row.group_letter === targetGroup);
        if (!groupRows.length) {
            return `**Group ${targetGroup} Abbreviations:**\n• No abbreviations set in this group yet.`;
        }
        return `**Group ${targetGroup} Abbreviations:**\n` + groupRows.map(row => `• **${row.alias}**: ${row.full_name}`).join('\n');
    }
    return "**Available Team Abbreviations:**\n" + rows.map(row => `• **${row.alias}**: ${row.full_name}`).join('\n');
}

async function getTeamGroupForFullName(guildId, seasonLabel, fullName) {
    const db = (0, getDB)();
    const row = await db.get(`SELECT tg.group_letter
        FROM team_groups tg
        JOIN teams t ON t.team_id = tg.team_id
        WHERE t.guild_id = ? AND tg.season_name = ? AND t.team_name = ?`, guildId, seasonLabel, fullName);
    return row?.group_letter || null;
}

function parsePtMatchInput(rawInput) {
    const tokens = (rawInput || '').trim().split(/\s+/).filter(Boolean);
    let explicitGroup = null;
    if (tokens.length > 0 && tokens[0].length === 1 && /^[A-H]$/i.test(tokens[0])) {
        explicitGroup = tokens.shift().toUpperCase();
    }
    const content = tokens.join(' ');
    const match = content.match(/(\S+)\s+(\d+)\/(\d+)\s+and\s+(\S+)\s+(\d+)\/(\d+)/i);
    if (!match)
        return null;
    return {
        explicitGroup,
        teamAAlias: match[1].toUpperCase(),
        teamARuns: parseInt(match[2]),
        teamAWkts: parseInt(match[3]),
        teamBAlias: match[4].toUpperCase(),
        teamBRuns: parseInt(match[5]),
        teamBWkts: parseInt(match[6])
    };
}

async function resolvePtMatchTeams(guildId, parsedInput, options = {}) {
    const db = (0, getDB)();
    const { fallbackGroup = null } = options;
    const { season, formatType, allowedGroups, seasonLabel: activeSeasonLabel } = await getPtAbbreviationContext(guildId);
    const aliasA = await db.get('SELECT full_name FROM pt_team_aliases WHERE guild_id = ? AND alias = ?', guildId, parsedInput.teamAAlias);
    const aliasB = await db.get('SELECT full_name FROM pt_team_aliases WHERE guild_id = ? AND alias = ?', guildId, parsedInput.teamBAlias);
    const teamAGroup = aliasA ? await getTeamGroupForFullName(guildId, activeSeasonLabel, aliasA.full_name) : null;
    const teamBGroup = aliasB ? await getTeamGroupForFullName(guildId, activeSeasonLabel, aliasB.full_name) : null;
    let groupLetter = formatType === 'GROUPS' ? 'A' : 'LEAGUE';
    if (formatType !== 'GROUPS') {
        groupLetter = 'LEAGUE';
    }
    else if (parsedInput.explicitGroup && allowedGroups.includes(parsedInput.explicitGroup)) {
        groupLetter = parsedInput.explicitGroup;
    }
    else if (fallbackGroup && allowedGroups.includes(fallbackGroup)) {
        groupLetter = fallbackGroup;
    }
    else if (teamAGroup && allowedGroups.includes(teamAGroup)) {
        groupLetter = teamAGroup;
    }
    else if (teamBGroup && allowedGroups.includes(teamBGroup)) {
        groupLetter = teamBGroup;
    }
    else {
        groupLetter = allowedGroups[0];
    }
    if (!aliasA || !aliasB || (formatType === 'GROUPS' && ((teamAGroup && teamAGroup !== groupLetter) || (teamBGroup && teamBGroup !== groupLetter)))) {
        let errorMsg = "";
        if (!aliasA)
            errorMsg += `❌ Unknown abbreviation for Team A: **${parsedInput.teamAAlias}**\n`;
        if (!aliasB)
            errorMsg += `❌ Unknown abbreviation for Team B: **${parsedInput.teamBAlias}**\n`;
        if (formatType === 'GROUPS' && aliasA && teamAGroup && teamAGroup !== groupLetter)
            errorMsg += `❌ Team A abbreviation **${parsedInput.teamAAlias}** belongs to Group **${teamAGroup}**, not Group **${groupLetter}**.\n`;
        if (formatType === 'GROUPS' && aliasB && teamBGroup && teamBGroup !== groupLetter)
            errorMsg += `❌ Team B abbreviation **${parsedInput.teamBAlias}** belongs to Group **${teamBGroup}**, not Group **${groupLetter}**.\n`;
        const aliasHelp = await getAliasHelp(guildId, { groupLetter: formatType === 'GROUPS' ? groupLetter : null });
        return {
            ok: false,
            message: errorMsg + "\n" + aliasHelp + "\n\n*Please ensure you are using the correct abbreviations for this group.*"
        };
    }
    return {
        ok: true,
        season,
        formatType,
        groupLetter,
        teamAName: aliasA.full_name,
        teamBName: aliasB.full_name
    };
}

async function closeLinkedReservationForPtMatch(guildId, season, teamAName, teamBName) {
    const db = (0, getDB)();
    try {
        const teamAObj = await db.get('SELECT team_id FROM teams WHERE guild_id = ? AND team_name = ?', guildId, teamAName);
        const teamBObj = await db.get('SELECT team_id FROM teams WHERE guild_id = ? AND team_name = ?', guildId, teamBName);
        if (!teamAObj || !teamBObj)
            return;
        const formattedSeason = season.toString().startsWith('S') ? season.toString() : `S${season}`;
        await db.run(`UPDATE match_reservations SET status = 'COMPLETED'
            WHERE id = (
                SELECT id
                FROM match_reservations
                WHERE guild_id = ? AND season_name = ?
                  AND ((team_a_id = ? AND team_b_id = ?) OR (team_a_id = ? AND team_b_id = ?))
                  AND status IN ('PENDING', 'SCHEDULED', 'OPEN')
                ORDER BY CASE WHEN fixture_day_number IS NOT NULL AND TRIM(fixture_day_number) <> '' THEN 0 ELSE 1 END,
                         CASE WHEN scheduled_time IS NULL THEN 1 ELSE 0 END,
                         scheduled_time DESC,
                         created_at DESC,
                         id DESC
                LIMIT 1
            )`, guildId, formattedSeason, teamAObj.team_id, teamBObj.team_id, teamBObj.team_id, teamAObj.team_id);
    }
    catch (e) {
        console.error("Failed to link ptmatch to reservation:", e);
    }
}

async function recordPointTableMatchByTeams(guildId, options = {}) {
    const db = (0, getDB)();
    const teamAName = String(options.teamAName || '').trim();
    const teamBName = String(options.teamBName || '').trim();
    const winner = String(options.winner || '').trim();
    const teamARuns = Number.isFinite(options.teamARuns) ? Number(options.teamARuns) : 0;
    const teamAWkts = Number.isFinite(options.teamAWkts) ? Number(options.teamAWkts) : 0;
    const teamBRuns = Number.isFinite(options.teamBRuns) ? Number(options.teamBRuns) : 0;
    const teamBWkts = Number.isFinite(options.teamBWkts) ? Number(options.teamBWkts) : 0;
    const requestedGroup = options.groupLetter ? String(options.groupLetter).trim().toUpperCase() : null;
    if (!teamAName || !teamBName) {
        throw new Error('Both team names are required.');
    }
    if (winner !== teamAName && winner !== teamBName && winner !== 'Draw') {
        throw new Error(`Winner must be "${teamAName}", "${teamBName}", or "Draw".`);
    }
    const { season, formatType, allowedGroups, seasonLabel } = await getPtAbbreviationContext(guildId);
    const teamAGroup = await getTeamGroupForFullName(guildId, seasonLabel, teamAName);
    const teamBGroup = await getTeamGroupForFullName(guildId, seasonLabel, teamBName);
    let groupLetter = 'LEAGUE';
    if (requestedGroup === 'PLAYOFF') {
        groupLetter = 'PLAYOFF';
    }
    else if (formatType === 'GROUPS') {
        if (requestedGroup && allowedGroups.includes(requestedGroup)) {
            groupLetter = requestedGroup;
        }
        else if (teamAGroup && teamBGroup && teamAGroup === teamBGroup && allowedGroups.includes(teamAGroup)) {
            groupLetter = teamAGroup;
        }
        else if (teamAGroup && !teamBGroup && allowedGroups.includes(teamAGroup)) {
            groupLetter = teamAGroup;
        }
        else if (teamBGroup && !teamAGroup && allowedGroups.includes(teamBGroup)) {
            groupLetter = teamBGroup;
        }
        else if (teamAGroup && teamBGroup && teamAGroup !== teamBGroup) {
            groupLetter = 'PLAYOFF';
        }
        else {
            groupLetter = allowedGroups[0] || 'A';
        }
    }
    const lastMatch = await db.get('SELECT MAX(match_number) as maxNum FROM pt_matches WHERE guild_id = ? AND season = ?', guildId, season);
    const matchNumber = (lastMatch?.maxNum || 0) + 1;
    await db.run('INSERT INTO pt_matches (guild_id, season, team_a, score_a_runs, score_a_wickets, team_b, score_b_runs, score_b_wickets, winner, timestamp, match_number, group_letter) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', guildId, season, teamAName, teamARuns, teamAWkts, teamBName, teamBRuns, teamBWkts, winner, options.timestamp || Date.now(), matchNumber, groupLetter);
    await closeLinkedReservationForPtMatch(guildId, season, teamAName, teamBName);
    return {
        season,
        formatType,
        groupLetter,
        matchNumber,
        teamAName,
        teamBName,
        winner,
        teamARuns,
        teamAWkts,
        teamBRuns,
        teamBWkts
    };
}

async function handlePtMatch(message, args) {
    // Usage: ?ptmatch [Group] TeamA 157/11 and TeamB 150/11
    const content = args.join(' ');
    const guildId = message.guild.id;

    const parsedInput = parsePtMatchInput(content);
    if (!parsedInput) {
        const aliasHelp = await getAliasHelp(guildId, { groupLetter: normalizeRequestedGroup(args) });
        return message.reply({
            content: "❌ **Invalid Format!**\nUsage: `?ptmatch <TeamA> <Runs/Wkts> and <TeamB> <Runs/Wkts>`\nExample: `?ptmatch SRH 157/11 and RCB 150/11` \n\n" + aliasHelp
        });
    }

    const teamARuns = parsedInput.teamARuns;
    const teamAWkts = parsedInput.teamAWkts;
    const teamBRuns = parsedInput.teamBRuns;
    const teamBWkts = parsedInput.teamBWkts;

    const db = (0, getDB)();
    const resolved = await resolvePtMatchTeams(guildId, parsedInput);
    if (!resolved.ok) {
        return message.reply({ content: resolved.message });
    }

    const season = resolved.season;
    const formatType = resolved.formatType;
    const groupLetter = resolved.groupLetter;
    const teamAName = resolved.teamAName;
    const teamBName = resolved.teamBName;

    // Calculate match number for this season
    const lastMatch = await db.get('SELECT MAX(match_number) as maxNum FROM pt_matches WHERE guild_id = ? AND season = ?', guildId, season);
    const matchNumber = (lastMatch?.maxNum || 0) + 1;

    let winner = null;
    if (teamARuns > teamBRuns) winner = teamAName;
    else if (teamBRuns > teamARuns) winner = teamBName;
    else winner = "Draw";

    await db.run('INSERT INTO pt_matches (guild_id, season, team_a, score_a_runs, score_a_wickets, team_b, score_b_runs, score_b_wickets, winner, timestamp, match_number, group_letter) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        guildId, season, teamAName, teamARuns, teamAWkts, teamBName, teamBRuns, teamBWkts, winner, Date.now(), matchNumber, groupLetter);

    await closeLinkedReservationForPtMatch(guildId, season, teamAName, teamBName);

    const groupMsg = formatType === 'GROUPS' ? `\nGroup: **${groupLetter}**` : '';
    message.reply(`✅ Match recorded! (Season ${season} Match ID: ${matchNumber})${groupMsg}\n**${teamAName}** (${teamARuns}/${teamAWkts}) vs **${teamBName}** (${teamBRuns}/${teamBWkts})\nWinner: **${winner}**`);
}

async function handlePtMatchClean(message, args) {
    const content = args.join(' ');
    const guildId = message.guild.id;
    const parsedInput = parsePtMatchInput(content);
    if (!parsedInput) {
        const aliasHelp = await getAliasHelp(guildId, { groupLetter: normalizeRequestedGroup(args) });
        return message.reply({
            content: "Invalid format.\nUsage: `?ptmatch <TeamA> <Runs/Wkts> and <TeamB> <Runs/Wkts>`\nExample: `?ptmatch SRH 157/11 and RCB 150/11`\n\n" + aliasHelp
        });
    }
    const resolved = await resolvePtMatchTeams(guildId, parsedInput);
    if (!resolved.ok) {
        return message.reply({ content: resolved.message });
    }
    const teamARuns = parsedInput.teamARuns;
    const teamAWkts = parsedInput.teamAWkts;
    const teamBRuns = parsedInput.teamBRuns;
    const teamBWkts = parsedInput.teamBWkts;
    let winner = "Draw";
    if (teamARuns > teamBRuns)
        winner = resolved.teamAName;
    else if (teamBRuns > teamARuns)
        winner = resolved.teamBName;
    const recordedMatch = await recordPointTableMatchByTeams(guildId, {
        teamAName: resolved.teamAName,
        teamBName: resolved.teamBName,
        winner,
        teamARuns,
        teamAWkts,
        teamBRuns,
        teamBWkts,
        groupLetter: resolved.groupLetter
    });
    const groupMsg = recordedMatch.formatType === 'GROUPS' ? `\nGroup: **${recordedMatch.groupLetter}**` : '';
    return message.reply(`Done: Match recorded! (Season ${recordedMatch.season} Match ID: ${recordedMatch.matchNumber})${groupMsg}\n**${recordedMatch.teamAName}** (${teamARuns}/${teamAWkts}) vs **${recordedMatch.teamBName}** (${teamBRuns}/${teamBWkts})\nWinner: **${winner}**`);
}

async function handlePtMatchModern(message, args) {
    const content = args.join(' ');
    const guildId = message.guild.id;
    const parsedInput = parsePtMatchInput(content);
    if (!parsedInput) {
        const aliasHelp = await getAliasHelp(guildId, { groupLetter: normalizeRequestedGroup(args) });
        return message.reply({
            content: "âŒ **Invalid Format!**\nUsage: `?ptmatch <TeamA> <Runs/Wkts> and <TeamB> <Runs/Wkts>`\nExample: `?ptmatch SRH 157/11 and RCB 150/11` \n\n" + aliasHelp
        });
    }
    const resolved = await resolvePtMatchTeams(guildId, parsedInput);
    if (!resolved.ok) {
        return message.reply({ content: resolved.message });
    }
    const teamARuns = parsedInput.teamARuns;
    const teamAWkts = parsedInput.teamAWkts;
    const teamBRuns = parsedInput.teamBRuns;
    const teamBWkts = parsedInput.teamBWkts;
    let winner = "Draw";
    if (teamARuns > teamBRuns)
        winner = resolved.teamAName;
    else if (teamBRuns > teamARuns)
        winner = resolved.teamBName;
    const recordedMatch = await recordPointTableMatchByTeams(guildId, {
        teamAName: resolved.teamAName,
        teamBName: resolved.teamBName,
        winner,
        teamARuns,
        teamAWkts,
        teamBRuns,
        teamBWkts,
        groupLetter: resolved.groupLetter
    });
    const groupMsg = recordedMatch.formatType === 'GROUPS' ? `\nGroup: **${recordedMatch.groupLetter}**` : '';
    return message.reply(`âœ… Match recorded! (Season ${recordedMatch.season} Match ID: ${recordedMatch.matchNumber})${groupMsg}\n**${recordedMatch.teamAName}** (${teamARuns}/${teamAWkts}) vs **${recordedMatch.teamBName}** (${teamBRuns}/${teamBWkts})\nWinner: **${winner}**`);
}

async function handleDeleteMatch(message, args) {
    if (!(0, isAdmin)(message.member)) return;
    
    const db = (0, getDB)();
    const guildId = message.guild.id;

    const matches = await db.all('SELECT * FROM pt_matches WHERE guild_id = ? ORDER BY timestamp DESC LIMIT 25', guildId);

    if (matches.length === 0) return message.reply("No matches found to delete.");

    const options = matches.map(m => {
        const label = `S${m.season} Match ${m.match_number}: ${m.team_a} vs ${m.team_b}`.slice(0, 100);
        const desc = `${m.score_a_runs}/${m.score_a_wickets} - ${m.score_b_runs}/${m.score_b_wickets} | Winner: ${m.winner}`.slice(0, 100);
        return {
            label: label,
            description: desc,
            value: String(m.id)
        };
    });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('delete_pt_match_select')
        .setPlaceholder('Select one or more matches to delete')
        .setMinValues(1)
        .setMaxValues(options.length)
        .addOptions(options);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    const response = await message.reply({ 
        content: "Select the matches you want to **DELETE** from the Point Table:", 
        components: [row] 
    });

    try {
        const selectInteraction = await awaitComponent(response, {
            filter: i => i.user.id === message.author.id && i.customId === 'delete_pt_match_select',
            time: 60000
        });
        if (!selectInteraction)
            return;
        await selectInteraction.deferUpdate();

        const selectedIds = selectInteraction.values;
        const selectedMatches = matches.filter(m => selectedIds.includes(String(m.id)));
        const matchNames = selectedMatches.map(m => `**S${m.season} Match #${m.match_number}**`).join(', ');

        if (!await (0, askConfirmation)(message, `Are you sure you want to permanently delete the following matches from the Point Table?\n${matchNames}`)) {
            try { await selectInteraction.editReply({ content: "❌ Deletion cancelled.", components: [] }); } catch(e) {}
            return;
        }

        for (const mid of selectedIds) {
            await db.run('DELETE FROM pt_matches WHERE id = ? AND guild_id = ?', mid, guildId);
        }
        
        const successMsg = `✅ Successfully deleted matches: ${matchNames}.`;
        try {
            await selectInteraction.editReply({ content: successMsg, components: [] });
        } catch (e) {
            await message.channel.send(successMsg);
        }
    } catch (e) {
        if (!message.replied) console.error(e);
    }
}

async function handleShowPointTable(message, args = []) {
    const db = (0, getDB)();
    const guildId = message.guild.id;

    let settings = await db.get('SELECT * FROM pt_settings WHERE guild_id = ?', guildId);
    if (!settings) {
        settings = { current_season: 1, layout_size: 6 };
    }

    const season = settings.current_season;
    const layoutSize = settings.layout_size || 6;
    const formatType = settings.format_type || 'LEAGUE';
    const allowedGroups = getGroupLetters(formatType === 'GROUPS' ? (settings.group_limit || 'A') : 'A');
    let requestedGroup = null;
    if (args && args.length > 0) {
        if (args[0].toLowerCase() === 'group' && args[1]) {
            requestedGroup = args[1].toUpperCase();
        }
        else if (/^[a-h]$/i.test(args[0])) {
            requestedGroup = args[0].toUpperCase();
        }
    }
    if (formatType !== 'GROUPS') {
        requestedGroup = null;
    }
    if (requestedGroup && !allowedGroups.includes(requestedGroup)) {
        requestedGroup = null;
    }

    let matchQuery = 'SELECT * FROM pt_matches WHERE guild_id = ? AND season = ?';
    const params = [guildId, season];
    if (requestedGroup) {
        matchQuery += ' AND group_letter = ?';
        params.push(requestedGroup);
    }
    const matches = await db.all(matchQuery, params);
    const aliases = await db.all('SELECT full_name FROM pt_team_aliases WHERE guild_id = ?', guildId);
    
    const teams = {};
    const titleLabel = requestedGroup ? `S${season} Group ${requestedGroup} Point Table` : (formatType === 'GROUPS' ? `S${season} All Groups Point Table` : `S${season} Point Table`);
    aliases.forEach(a => {
        teams[a.full_name] = { played: 0, won: 0, lost: 0, points: 0 };
    });

    matches.forEach(m => {
        if (!teams[m.team_a]) teams[m.team_a] = { played: 0, won: 0, lost: 0, points: 0 };
        if (!teams[m.team_b]) teams[m.team_b] = { played: 0, won: 0, lost: 0, points: 0 };

        teams[m.team_a].played++;
        teams[m.team_b].played++;

        if (m.winner === m.team_a) {
            teams[m.team_a].won++;
            teams[m.team_a].points += 2;
            teams[m.team_b].lost++;
        } else if (m.winner === m.team_b) {
            teams[m.team_b].won++;
            teams[m.team_b].points += 2;
            teams[m.team_a].lost++;
        } else if (m.winner === "Draw") {
            teams[m.team_a].points += 1;
            teams[m.team_b].points += 1;
        }
    });

    const sortedTeams = Object.entries(teams).map(([name, stats]) => ({ name, ...stats }))
        .sort((a, b) => b.points - a.points || b.won - a.won);

    const tableData = sortedTeams.slice(0, layoutSize);

    let image;
    try {
        image = await getPointTableTemplate(layoutSize);
    } catch (e) {
        const imagePath = `pointtable${layoutSize}teams.png`;
        return message.reply(`❌ Error loading point table template: ${imagePath}`);
    }
    
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);

    ctx.fillStyle = 'white';

    if (layoutSize === 6) {
        const config6 = {
            title: { x: 500, y: 150, size: 56 },
            rows: [
                { teamX: 135, pX: 484, wX: 615, lX: 752, ptsX: 905, y: 370, teamSize: 23, pSize: 23, wSize: 23, lSize: 23, ptsSize: 23 },
                { teamX: 135, pX: 484, wX: 615, lX: 752, ptsX: 905, y: 430, teamSize: 23, pSize: 23, wSize: 23, lSize: 23, ptsSize: 23 },
                { teamX: 135, pX: 484, wX: 615, lX: 752, ptsX: 905, y: 485, teamSize: 23, pSize: 23, wSize: 23, lSize: 23, ptsSize: 23 },
                { teamX: 135, pX: 484, wX: 615, lX: 752, ptsX: 905, y: 535, teamSize: 23, pSize: 23, wSize: 23, lSize: 23, ptsSize: 23 },
                { teamX: 135, pX: 484, wX: 615, lX: 752, ptsX: 905, y: 595, teamSize: 23, pSize: 23, wSize: 23, lSize: 23, ptsSize: 23 },
                { teamX: 135, pX: 484, wX: 615, lX: 752, ptsX: 905, y: 645, teamSize: 23, pSize: 23, wSize: 23, lSize: 23, ptsSize: 23 }
            ]
        };

        // Draw Title
        ctx.font = `bold ${config6.title.size}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(titleLabel, config6.title.x, config6.title.y);

        tableData.forEach((team, index) => {
            if (!config6.rows[index]) return;
            const r = config6.rows[index];
            
            // Team Name
            ctx.font = `bold ${r.teamSize}px sans-serif`;
            ctx.textAlign = 'left';
            ctx.fillText(team.name.length > 20 ? team.name.slice(0, 18) + '..' : team.name, r.teamX, r.y);
            
            // Played
            ctx.font = `bold ${r.pSize}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText(String(team.played), r.pX, r.y);
            
            // Wins
            ctx.font = `bold ${r.wSize}px sans-serif`;
            ctx.fillText(String(team.won), r.wX, r.y);
            
            // Losses
            ctx.font = `bold ${r.lSize}px sans-serif`;
            ctx.fillText(String(team.lost), r.lX, r.y);
            
            // Points
            ctx.font = `bold ${r.ptsSize}px sans-serif`;
            ctx.fillText(String(team.points), r.ptsX, r.y);
        });
    } else if (layoutSize === 8 || layoutSize === 7) {
        const config8 = {
            title: { x: 540, y: 162, size: 60 },
            rows: [
                { teamX: 146, pX: 524, wX: 666, lX: 814, ptsX: 980, y: 401, teamSize: 25, pSize: 25, wSize: 25, lSize: 25, ptsSize: 25 },
                { teamX: 146, pX: 524, wX: 666, lX: 814, ptsX: 980, y: 466, teamSize: 25, pSize: 25, wSize: 25, lSize: 25, ptsSize: 25 },
                { teamX: 146, pX: 524, wX: 666, lX: 814, ptsX: 980, y: 525, teamSize: 25, pSize: 25, wSize: 25, lSize: 25, ptsSize: 25 },
                { teamX: 146, pX: 524, wX: 666, lX: 814, ptsX: 980, y: 580, teamSize: 25, pSize: 25, wSize: 25, lSize: 25, ptsSize: 25 },
                { teamX: 146, pX: 524, wX: 666, lX: 814, ptsX: 980, y: 644, teamSize: 25, pSize: 25, wSize: 25, lSize: 25, ptsSize: 25 },
                { teamX: 146, pX: 524, wX: 666, lX: 814, ptsX: 980, y: 699, teamSize: 25, pSize: 25, wSize: 25, lSize: 25, ptsSize: 25 },
                { teamX: 146, pX: 524, wX: 666, lX: 814, ptsX: 980, y: 759, teamSize: 25, pSize: 25, wSize: 25, lSize: 25, ptsSize: 25 },
                { teamX: 146, pX: 524, wX: 666, lX: 814, ptsX: 980, y: 819, teamSize: 25, pSize: 25, wSize: 25, lSize: 25, ptsSize: 25 }
            ]
        };

        // Draw Title
        ctx.font = `bold ${config8.title.size}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(`S${season} Point Table`, config8.title.x, config8.title.y);

        tableData.forEach((team, index) => {
            if (!config8.rows[index]) return;
            const r = config8.rows[index];
            
            // Team Name
            ctx.font = `bold ${r.teamSize}px sans-serif`;
            ctx.textAlign = 'left';
            ctx.fillText(team.name.length > 20 ? team.name.slice(0, 18) + '..' : team.name, r.teamX, r.y);
            
            // Played
            ctx.font = `bold ${r.pSize}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText(String(team.played), r.pX, r.y);
            
            // Wins
            ctx.font = `bold ${r.wSize}px sans-serif`;
            ctx.fillText(String(team.won), r.wX, r.y);
            
            // Losses
            ctx.font = `bold ${r.lSize}px sans-serif`;
            ctx.fillText(String(team.lost), r.lX, r.y);
            
            // Points
            ctx.font = `bold ${r.ptsSize}px sans-serif`;
            ctx.fillText(String(team.points), r.ptsX, r.y);
        });
    } else if (layoutSize === 10) {
        const config10 = {
            title: { x: 500, y: 150, size: 55 },
            rows: [
                { teamX: 135, pX: 485, wX: 615, lX: 750, ptsX: 905, y: 370, teamSize: 22, pSize: 22, wSize: 22, lSize: 22, ptsSize: 22 },
                { teamX: 135, pX: 485, wX: 615, lX: 750, ptsX: 905, y: 426, teamSize: 22, pSize: 22, wSize: 22, lSize: 22, ptsSize: 22 },
                { teamX: 135, pX: 485, wX: 615, lX: 750, ptsX: 905, y: 483, teamSize: 22, pSize: 22, wSize: 22, lSize: 22, ptsSize: 22 },
                { teamX: 135, pX: 485, wX: 615, lX: 750, ptsX: 905, y: 535, teamSize: 22, pSize: 22, wSize: 22, lSize: 22, ptsSize: 22 },
                { teamX: 135, pX: 485, wX: 615, lX: 750, ptsX: 905, y: 590, teamSize: 22, pSize: 22, wSize: 22, lSize: 22, ptsSize: 22 },
                { teamX: 135, pX: 485, wX: 615, lX: 750, ptsX: 905, y: 644, teamSize: 22, pSize: 22, wSize: 22, lSize: 22, ptsSize: 22 },
                { teamX: 135, pX: 485, wX: 615, lX: 750, ptsX: 905, y: 701, teamSize: 22, pSize: 22, wSize: 22, lSize: 22, ptsSize: 22 },
                { teamX: 135, pX: 485, wX: 615, lX: 750, ptsX: 905, y: 757, teamSize: 22, pSize: 22, wSize: 22, lSize: 22, ptsSize: 22 },
                { teamX: 135, pX: 485, wX: 615, lX: 750, ptsX: 905, y: 812, teamSize: 22, pSize: 22, wSize: 22, lSize: 22, ptsSize: 22 },
                { teamX: 135, pX: 485, wX: 615, lX: 750, ptsX: 905, y: 864, teamSize: 22, pSize: 22, wSize: 22, lSize: 22, ptsSize: 22 }
            ]
        };

        // Draw Title
        ctx.font = `bold ${config10.title.size}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(titleLabel, config10.title.x, config10.title.y);

        tableData.forEach((team, index) => {
            if (!config10.rows[index]) return;
            const r = config10.rows[index];
            
            // Team Name
            ctx.font = `bold ${r.teamSize}px sans-serif`;
            ctx.textAlign = 'left';
            ctx.fillText(team.name.length > 20 ? team.name.slice(0, 18) + '..' : team.name, r.teamX, r.y);
            
            // Played
            ctx.font = `bold ${r.pSize}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText(String(team.played), r.pX, r.y);
            
            // Wins
            ctx.font = `bold ${r.wSize}px sans-serif`;
            ctx.fillText(String(team.won), r.wX, r.y);
            
            // Losses
            ctx.font = `bold ${r.lSize}px sans-serif`;
            ctx.fillText(String(team.lost), r.lX, r.y);
            
            // Points
            ctx.font = `bold ${r.ptsSize}px sans-serif`;
            ctx.fillText(String(team.points), r.ptsX, r.y);
        });
    } else {
        // Fallback or other layouts
        // Draw Title
        ctx.font = 'bold 36px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(titleLabel, image.width / 2, 70);

        let config = {
            startY: 355, rowStep: 64, posX: 90, teamX: 250, pX: 490, wX: 610, lX: 730, ptsX: 890
        };

        ctx.font = 'bold 28px sans-serif';
        tableData.forEach((team, index) => {
            const y = config.startY + (index * config.rowStep);
            ctx.textAlign = 'center';
            ctx.fillText(String(index + 1), config.posX, y);
            ctx.textAlign = 'left';
            ctx.fillText(team.name.length > 18 ? team.name.slice(0, 16) + '..' : team.name, config.teamX, y);
            ctx.textAlign = 'center';
            ctx.fillText(String(team.played), config.pX, y);
            ctx.fillText(String(team.won), config.wX, y);
            ctx.fillText(String(team.lost), config.lX, y);
            ctx.fillText(String(team.points), config.ptsX, y);
        });
    }

    const buffer = canvas.toBuffer();
    const attachment = new AttachmentBuilder(buffer, { name: 'pointtable.png' });
    message.channel.send({ files: [attachment] });
}

async function handleEditPtMatch(message, args) {
    if (!(0, isAdmin)(message.member)) return;

    const db = (0, getDB)();
    const guildId = message.guild.id;
    const { formatType, allowedGroups } = await getPtAbbreviationContext(guildId);
    const requestedGroup = normalizeRequestedGroup(args);
    const legacyMatchId = parseInt(args[0], 10);

    if (requestedGroup && !allowedGroups.includes(requestedGroup)) {
        return message.reply(`Unknown group **${requestedGroup}**. Valid groups: ${allowedGroups.join(', ')}.`);
    }
    if (formatType === 'GROUPS' && isNaN(legacyMatchId) && !requestedGroup) {
        return message.reply(`Usage: \`?editptmatch <Group>\` in group stage. Example: \`?editptmatch A\`. Valid groups: ${allowedGroups.join(', ')}.`);
    }

    const recentMatchParams = [guildId];
    let recentMatchQuery = 'SELECT * FROM pt_matches WHERE guild_id = ?';
    if (formatType === 'GROUPS' && requestedGroup) {
        recentMatchQuery += ' AND group_letter = ?';
        recentMatchParams.push(requestedGroup);
    }
    recentMatchQuery += ' ORDER BY timestamp DESC LIMIT 25';
    const recentMatches = await db.all(recentMatchQuery, recentMatchParams);

    if (recentMatches.length === 0) {
        if (formatType === 'GROUPS' && requestedGroup) {
            return message.reply(`No matches found to edit in Group **${requestedGroup}**.`);
        }
        return message.reply("No matches found to edit.");
    }

    const buildMatchLabel = (ptMatch) => {
        const groupPart = ptMatch.group_letter && ptMatch.group_letter !== 'LEAGUE' ? ` G${ptMatch.group_letter}` : '';
        return `S${ptMatch.season}${groupPart} M${ptMatch.match_number}: ${ptMatch.team_a} vs ${ptMatch.team_b}`;
    };

    let existingMatch = null;
    let editContent = '';
    if (!isNaN(legacyMatchId)) {
        existingMatch = await db.get('SELECT * FROM pt_matches WHERE id = ? AND guild_id = ?', legacyMatchId, guildId);
        if (!existingMatch) return message.reply(`❌ Match with ID **${legacyMatchId}** not found.`);
        editContent = args.slice(1).join(' ').trim();
    }

    if (!existingMatch) {
        const options = recentMatches.map(ptMatch => ({
            label: buildMatchLabel(ptMatch).slice(0, 100),
            description: `${ptMatch.score_a_runs}/${ptMatch.score_a_wickets} - ${ptMatch.score_b_runs}/${ptMatch.score_b_wickets} | Winner: ${ptMatch.winner}`.slice(0, 100),
            value: String(ptMatch.id)
        }));
        const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
            .setCustomId('edit_pt_match_select')
            .setPlaceholder('Select a match to edit')
            .addOptions(options));
        const response = await message.reply({
            content: formatType === 'GROUPS' && requestedGroup
                ? `Select the Group **${requestedGroup}** point-table match you want to edit:`
                : "Select the point-table match you want to edit:",
            components: [row]
        });
        const selectInteraction = await awaitComponent(response, {
            filter: i => i.user.id === message.author.id && i.customId === 'edit_pt_match_select',
            time: 60000
        });
        if (!selectInteraction) return;

        existingMatch = recentMatches.find(ptMatch => String(ptMatch.id) === selectInteraction.values[0]) || null;
        if (!existingMatch) {
            try {
                await selectInteraction.update({ content: "❌ Selected match could not be found anymore.", components: [] });
            } catch (_a) {
            }
            return;
        }

        await selectInteraction.update({
            content: `Selected **${buildMatchLabel(existingMatch)}**.\nNow send the updated result in this channel.\nFormat: \`[Group] ABBV 100/10 and ABBV 110/9\`\nType \`cancel\` to stop.`,
            components: []
        }).catch(() => { });
    }

    const fallbackGroup = existingMatch.group_letter && existingMatch.group_letter !== 'LEAGUE' ? existingMatch.group_letter : null;
    if (!editContent) {
        await message.channel.send(`Send the updated result for **${buildMatchLabel(existingMatch)}**.\nFormat: \`[Group] ABBV 100/10 and ABBV 110/9\`${fallbackGroup ? `\nIf you omit the group, Group **${fallbackGroup}** will be used.` : ''}\nType \`cancel\` to stop.`);
        const collected = await message.channel.awaitMessages({
            filter: m => m.author.id === message.author.id,
            max: 1,
            time: 120000
        });
        const replyMessage = collected.first();
        if (!replyMessage) return message.reply("❌ Edit timed out.");
        if (replyMessage.content.trim().toLowerCase() === 'cancel') return message.reply("❌ Edit cancelled.");
        editContent = replyMessage.content.trim();
    }

    const parsedInput = parsePtMatchInput(editContent);
    if (!parsedInput) {
        const aliasHelp = await getAliasHelp(guildId, { groupLetter: fallbackGroup });
        return message.reply(`❌ **Invalid Format!**\nUsage: \`?editptmatch <match_id> <TeamA> <Runs/Wkts> and <TeamB> <Runs/Wkts>\`\nExample: \`?editptmatch SRH 157/11 and RCB 150/11\`\n\n${aliasHelp}`);
    }

    const resolved = await resolvePtMatchTeams(guildId, parsedInput, { fallbackGroup });
    if (!resolved.ok) {
        return message.reply({ content: resolved.message });
    }

    let winner = null;
    if (parsedInput.teamARuns > parsedInput.teamBRuns) winner = resolved.teamAName;
    else if (parsedInput.teamBRuns > parsedInput.teamARuns) winner = resolved.teamBName;
    else winner = "Draw";

    await db.run('UPDATE pt_matches SET team_a = ?, score_a_runs = ?, score_a_wickets = ?, team_b = ?, score_b_runs = ?, score_b_wickets = ?, winner = ?, group_letter = ? WHERE id = ? AND guild_id = ?',
        resolved.teamAName, parsedInput.teamARuns, parsedInput.teamAWkts, resolved.teamBName, parsedInput.teamBRuns, parsedInput.teamBWkts, winner, resolved.groupLetter, existingMatch.id, guildId);

    const groupMsg = resolved.formatType === 'GROUPS' ? `\nGroup: **${resolved.groupLetter}**` : '';
    message.reply(`✅ Match **${existingMatch.id}** updated!\n**${resolved.teamAName}** (${parsedInput.teamARuns}/${parsedInput.teamAWkts}) vs **${resolved.teamBName}** (${parsedInput.teamBRuns}/${parsedInput.teamBWkts})\nWinner: **${winner}**${groupMsg}`);
}

async function handleRemoveAlias(message, args) {
    if (!(0, isAdmin)(message.member)) return;
    
    const alias = args[0]?.toUpperCase();
    if (!alias) return message.reply('Usage: `?removealias <ABBV>`');

    const db = (0, getDB)();
    const guildId = message.guild.id;

    const existing = await db.get('SELECT * FROM pt_team_aliases WHERE guild_id = ? AND alias = ?', guildId, alias);
    if (!existing) return message.reply(`❌ Abbreviation **${alias}** not found.`);

    await db.run('DELETE FROM pt_team_aliases WHERE guild_id = ? AND alias = ?', guildId, alias);
    message.reply(`✅ Removed abbreviation **${alias}** (was mapping to **${existing.full_name}**).`);
}

async function getStandings(guildId, season, groupLetter = 'LEAGUE') {
    const db = (0, getDB)();
    let matchQuery = 'SELECT * FROM pt_matches WHERE guild_id = ? AND season = ?';
    const params = [guildId, season];
    if (groupLetter && groupLetter !== 'ALL') {
        matchQuery += ' AND group_letter = ?';
        params.push(groupLetter);
    }
    const matches = await db.all(matchQuery, params);
    const aliases = await db.all('SELECT full_name FROM pt_team_aliases WHERE guild_id = ?', guildId);
    
    const teams = {};
    aliases.forEach(a => {
        teams[a.full_name] = { played: 0, won: 0, lost: 0, points: 0 };
    });

    matches.forEach(m => {
        if (!teams[m.team_a]) teams[m.team_a] = { played: 0, won: 0, lost: 0, points: 0 };
        if (!teams[m.team_b]) teams[m.team_b] = { played: 0, won: 0, lost: 0, points: 0 };

        teams[m.team_a].played++;
        teams[m.team_b].played++;

        if (m.winner === m.team_a) {
            teams[m.team_a].won++;
            teams[m.team_a].points += 2;
            teams[m.team_b].lost++;
        } else if (m.winner === m.team_b) {
            teams[m.team_b].won++;
            teams[m.team_b].points += 2;
            teams[m.team_a].lost++;
        } else if (m.winner === "Draw") {
            teams[m.team_a].points += 1;
            teams[m.team_b].points += 1;
        }
    });

    return Object.entries(teams)
        .map(([name, stats]) => ({ name, ...stats }))
        .sort((a, b) => b.points - a.points || b.won - a.won);
}

async function handleQualifyInfo(message) {
    const db = (0, getDB)();
    const settings = await db.get('SELECT format_type FROM pt_settings WHERE guild_id = ?', message.guild.id);
    const format = settings?.format_type || 'LEAGUE';

    const embed = new EmbedBuilder().setColor(0x00AAFF).setTitle("🏆 Qualification & Playoff Rules");

    if (format === 'LEAGUE') {
        embed.setDescription("This season follows the **IPL Playoff Format** (Top 4 Qualify):")
            .addFields(
                { name: "1️⃣ Qualifier 1", value: "**1st vs 2nd**. Winner goes straight to the **Final**. Loser goes to Qualifier 2." },
                { name: "2️⃣ Eliminator", value: "**3rd vs 4th**. Winner goes to **Qualifier 2**. Loser is eliminated." },
                { name: "3️⃣ Qualifier 2", value: "**Loser of Q1 vs Winner of Eliminator**. Winner goes to the **Final**." },
                { name: "4️⃣ Grand Final", value: "**Winner of Q1 vs Winner of Q2** to decide the Champion!" }
            );
    } else {
        embed.setDescription("This season follows the **Tournament Knockout Format**:")
            .addFields(
                { name: "📊 Group Stage", value: "Teams compete in groups (A, B, C, etc.). Top teams from each group qualify for the knockouts." },
                { name: "⚔️ Knockout Rounds", value: "Round of 16 ➡️ Quarter Finals ➡️ Semi Finals ➡️ Grand Final." },
                { name: "📜 Specific Rules", value: "Qualification slots (e.g., Top 2 or Top 4 per group) depend on the total number of teams and groups." }
            );
    }
    message.reply({ embeds: [embed] });
}

async function handlePlayoffFixture(message, args) {
    const db = (0, getDB)();
    const guildId = message.guild.id;
    const settings = await db.get('SELECT current_season, format_type, group_limit FROM pt_settings WHERE guild_id = ?', guildId);
    if (!settings) return message.reply("Point table not setup.");
    
    const season = settings.current_season;
    const format = settings.format_type;

    if (format === 'LEAGUE') {
        const stage = parseInt(args[0]);
        if (isNaN(stage) || stage < 1 || stage > 4) {
            return message.reply("Usage: `?fixture playoff [1-4]`\n1: Qualifier 1 (1st vs 2nd)\n2: Eliminator (3rd vs 4th)\n3: Qualifier 2\n4: Grand Final");
        }

        const standings = await getStandings(guildId, season);
        if (standings.length < 4) return message.reply("Not enough teams in standings for playoffs (need at least 4).");

        const getPlayoffResults = async (season) => {
            return await db.all('SELECT * FROM pt_matches WHERE guild_id = ? AND season = ? AND group_letter = "PLAYOFF" ORDER BY match_number ASC', guildId, season);
        };

        const playoffs = await getPlayoffResults(season);

        let teamA, teamB, stageName, matchNum;

        if (stage === 1) {
            teamA = standings[0].name;
            teamB = standings[1].name;
            stageName = "Qualifier 1";
            matchNum = 101;
        } else if (stage === 2) {
            teamA = standings[2].name;
            teamB = standings[3].name;
            stageName = "Eliminator";
            matchNum = 102;
        } else if (stage === 3) {
            const q1 = playoffs.find(m => m.match_number === 101);
            const elim = playoffs.find(m => m.match_number === 102);
            if (!q1 || !elim) return message.reply("Qualifier 1 and Eliminator results must be recorded first.");
            
            teamA = q1.winner === q1.team_a ? q1.team_b : q1.team_a; // Loser of Q1
            teamB = elim.winner; // Winner of Eliminator
            if (teamB === "Draw") return message.reply("Eliminator cannot be a draw. Please edit the result.");
            stageName = "Qualifier 2";
            matchNum = 103;
        } else if (stage === 4) {
            const q1 = playoffs.find(m => m.match_number === 101);
            const q2 = playoffs.find(m => m.match_number === 103);
            if (!q1 || !q2) return message.reply("Qualifier 1 and Qualifier 2 results must be recorded first.");
            
            teamA = q1.winner;
            teamB = q2.winner;
            if (teamA === "Draw" || teamB === "Draw") return message.reply("Playoff matches cannot be a draw. Please edit results.");
            stageName = "Grand Final";
            matchNum = 104;
        }

        const embed = new EmbedBuilder()
            .setTitle(`🏆 Playoff Fixture: ${stageName}`)
            .setDescription(`**${teamA}** vs **${teamB}**\n\nSeason: **${season}**`)
            .setColor(0xFFD700)
            .setFooter({ text: `Recording: ?ptmatch PLAYOFF ${teamA} [Score] and ${teamB} [Score]` });

        return message.reply({ embeds: [embed] });
    } else {
        // GROUP STAGE KNOCKOUTS (FIFA Style)
        const groups = getGroupLetters(settings.group_limit);
        const stage = args[0]?.toLowerCase();
        const index = parseInt(args[1]) || 1;

        if (!['r16', 'qf', 'sf', 'final'].includes(stage)) {
            return message.reply("Usage: `?fixture playoff <stage> [number]`\nStages: `r16`, `qf`, `sf`, `final`\nExample: `?fixture playoff sf 1` (Semi Final 1)");
        }

        const getPlayoffResults = async (season) => {
            return await db.all('SELECT * FROM pt_matches WHERE guild_id = ? AND season = ? AND group_letter = "PLAYOFF" ORDER BY match_number ASC', guildId, season);
        };
        const playoffs = await getPlayoffResults(season);

        // helper to get top 2 from a group
        const getTopTwo = async (letter) => {
            const std = await getStandings(guildId, season, letter);
            return { first: std[0]?.name, second: std[1]?.name };
        };

        let teamA, teamB, stageName;

        if (stage === 'r16') {
            if (groups.length < 8) return message.reply("Round of 16 requires at least 8 groups.");
            if (index < 1 || index > 8) return message.reply("R16 index must be 1-8.");
            
            const pairs = [['A', 'B'], ['C', 'D'], ['E', 'F'], ['G', 'H'], ['B', 'A'], ['D', 'C'], ['F', 'E'], ['H', 'G']];
            const pair = pairs[index - 1];
            const topA = await getTopTwo(pair[0]);
            const topB = await getTopTwo(pair[1]);
            teamA = index <= 4 ? topA.first : topA.second;
            teamB = index <= 4 ? topB.second : topB.first;
            stageName = `Round of 16 #${index}`;
        } else if (stage === 'qf') {
            if (groups.length === 4) {
                // Direct QF from 4 groups (A1vB2, C1vD2, B1vA2, D1vC2)
                if (index < 1 || index > 4) return message.reply("QF index must be 1-4.");
                const pairs = [['A', 'B'], ['C', 'D'], ['B', 'A'], ['D', 'C']];
                const pair = pairs[index - 1];
                const topA = await getTopTwo(pair[0]);
                const topB = await getTopTwo(pair[1]);
                teamA = index <= 2 ? topA.first : topA.second;
                teamB = index <= 2 ? topB.second : topB.first;
            } else if (groups.length === 8) {
                // From R16 Winners (1v2, 3v4, 5v6, 7v8)
                const w1 = playoffs.find(m => m.match_number === 200 + (index * 2 - 1))?.winner;
                const w2 = playoffs.find(m => m.match_number === 200 + (index * 2))?.winner;
                if (!w1 || !w2) return message.reply(`Results for R16 #${index * 2 - 1} and #${index * 2} must be recorded first.`);
                teamA = w1; teamB = w2;
            } else {
                return message.reply("Quarter Finals automated support requires 4 or 8 groups.");
            }
            stageName = `Quarter Final #${index}`;
        } else if (stage === 'sf') {
            if (groups.length === 2) {
                // Direct SF from 2 groups (A1vB2, B1vA2)
                if (index < 1 || index > 2) return message.reply("SF index must be 1-2.");
                const topA = await getTopTwo('A');
                const topB = await getTopTwo('B');
                teamA = index === 1 ? topA.first : topB.first;
                teamB = index === 1 ? topB.second : topA.second;
            } else {
                // From QF Winners (1v2, 3v4)
                const w1 = playoffs.find(m => m.match_number === 300 + (index * 2 - 1))?.winner;
                const w2 = playoffs.find(m => m.match_number === 300 + (index * 2))?.winner;
                if (!w1 || !w2) return message.reply(`Results for Quarter Final #${index * 2 - 1} and #${index * 2} must be recorded first.`);
                teamA = w1; teamB = w2;
            }
            stageName = `Semi Final #${index}`;
        } else if (stage === 'final') {
            // From SF Winners (1v2)
            const w1 = playoffs.find(m => m.match_number === 401)?.winner;
            const w2 = playoffs.find(m => m.match_number === 402)?.winner;
            if (!w1 || !w2) return message.reply("Results for both Semi Finals must be recorded first.");
            teamA = w1; teamB = w2;
            stageName = "Grand Final";
        }

        if (!teamA || !teamB || teamA === "Draw" || teamB === "Draw") {
            return message.reply("Could not determine teams. Ensure previous results are recorded and not draws.");
        }

        const matchNumMap = { 'r16': 200 + index, 'qf': 300 + index, 'sf': 400 + index, 'final': 500 };
        const matchNum = matchNumMap[stage];

        const embed = new EmbedBuilder()
            .setTitle(`🏆 Playoff Fixture: ${stageName}`)
            .setDescription(`**${teamA}** vs **${teamB}**\n\nSeason: **${season}**`)
            .setColor(0xFFD700)
            .setFooter({ text: `Recording: ?ptmatch PLAYOFF ${teamA} [Score] and ${teamB} [Score]` });

        return message.reply({ embeds: [embed] });
    }
}

module.exports = {
    handleSetSeason,
    handleSetAlias,
    handleShowAliases,
    handlePtMatch: handlePtMatchClean,
    recordPointTableMatchByTeams,
    handleDeleteMatch,
    handleShowPointTable,
    handleEditPtMatch,
    handleRemoveAlias,
    handlePlayoffFixture,
    handleQualifyInfo
};
