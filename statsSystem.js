const { getDB } = require('./database');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage, registerFont } = require('canvas');
const imageCache = new Map();
async function getCachedImage(path) {
    if (!imageCache.has(path)) {
        imageCache.set(path, loadImage(path));
    }
    return imageCache.get(path);
}

// Helper functions for stats calculation
function calculateBattingRating(stats) {
    if (!stats.matches_played) return 45;
    
    // Components
    const inningsForAvg = getBattingDismissals(stats);
    const avg = inningsForAvg > 0 ? stats.runs / inningsForAvg : calculateBattingAverage(stats);
    const avgScore = Math.min((avg / 26) * 70, 70);
    
    const sr = stats.balls_played > 0 ? (stats.runs / stats.balls_played) * 100 : 0;
    const srScore = Math.min((sr / 280) * 24, 24);
    
    const hsScore = Math.min((stats.highscore / 60) * 5, 5);
    
    // Total Batting Rating = 45 + Avg Score + SR Score + HS Score
    const totalBattingRating = 45 + avgScore + srScore + hsScore;

    // Experience Factor = Matches / (Matches + 10)
    const experienceFactor = stats.matches_played / (stats.matches_played + 10);

    // Impact Calculation
    // MatchImpact = (MatchRuns * 0.05) + (MatchSR / 500) + Penalties
    // For season stats, we use total runs and average SR.
    let penalties = (stats.ducks * -4) + (stats.runs_1_5 * -3) + (stats.runs_6_9 * -2) + (stats.low_sr_60 * -1.5) + (stats.low_sr_80 * -1);
    let matchImpact = (stats.runs * 0.05) + (sr / 500) + penalties;

    // Final Batting Rating = 45 + (TotalBattingRating - 45) * ExperienceFactor + MatchImpact
    const finalRating = 45 + (totalBattingRating - 45) * experienceFactor + matchImpact;

    return Math.max(45, Math.min(99, finalRating));
}

function calculateBowlingRating(stats) {
    if (!stats.matches_played) return 45;
    
    // Wicket Score (Max 35): min(((Wickets / Matches) / 2) * 35, 35)
    const wktsPerMatch = stats.wickets / stats.matches_played;
    const wicketScore = Math.min((wktsPerMatch / 2) * 35, 35);
    
    // Avg Score (Max 25): min((18 / BowlAvg) * 25, 25)
    const bowlAvg = stats.wickets > 0 ? stats.runs_conceded / stats.wickets : null;
    const avgScore = bowlAvg !== null ? Math.min((18 / bowlAvg) * 25, 25) : 0;
    
    // Eco Score (Max 20): max(0, min(20, ((26 - Economy) / 10) * 20))
    const eco = stats.balls_bowled > 0 ? (stats.runs_conceded / stats.balls_bowled) * 6 : 0;
    const ecoScore = Math.max(0, Math.min(20, ((26 - eco) / 10) * 20));
    
    // Milestone Score (Max 19): min((ThreeWickets * 4) + (FiveWickets * 8), 19)
    const milestoneScore = Math.min((stats.three_fer * 4) + (stats.five_fer * 8), 19);
    
    // Total Bowling Rating = 45 + Wicket Score + Avg Score + Eco Score + Milestone Score
    const totalBowlingRating = 45 + wicketScore + avgScore + ecoScore + milestoneScore;

    // Experience Factor = Matches / (Matches + 10)
    const experienceFactor = stats.matches_played / (stats.matches_played + 10);

    // Impact Calculation
    // BowlImpact = (MatchWickets * 1.5) - (MatchEconomy / 6) + Penalties
    let penalties = (stats.zero_wkts_2overs * -2) + (stats.high_eco_18 * -3) + (stats.high_eco_16 * -1.5);
    let bowlImpact = (stats.wickets * 1.5) - (eco / 6) + penalties;

    // Final Bowling Rating = 45 + (TotalBowlingRating - 45) * ExperienceFactor + BowlImpact
    const finalRating = 45 + (totalBowlingRating - 45) * experienceFactor + bowlImpact;

    return Math.max(45, Math.min(99, finalRating));
}

function calculateALR(battingRating, bowlingRating) {
    const baseALR = (battingRating + bowlingRating) / 2;
    const difference = Math.abs(battingRating - bowlingRating);
    const balanceFactor = 1 - (difference / 100);
    const alr = baseALR * (0.95 + (0.10 * balanceFactor));
    // Reward balanced players, but ensure ALR is at least the highest individual rating (safeguard)
    return Math.min(99, Math.max(alr, battingRating, bowlingRating));
}

function calculateMatchMVP(matchData) {
    const runs = matchData.runs;
    const sr = matchData.balls_played > 0 ? (matchData.runs / matchData.balls_played) * 100 : 0;
    const wickets = matchData.wickets;
    const eco = matchData.balls_bowled > 0 ? (matchData.runs_conceded / matchData.balls_bowled) * 6 : 0;
    
    // Penalties
    let batPenalty = 0;
    if (isBattingDuck(matchData)) batPenalty = -6; // Duck

    let bowlPenalty = 0;
    if (wickets === 0 && matchData.balls_bowled >= 12) bowlPenalty = -4; // 0 wkts with 2+ overs

    // Bonuses
    let batBonus = 0;
    if (runs >= 50) batBonus = 20;
    else if (runs >= 30) batBonus = 8;
    
    let bowlBonus = 0;
    if (wickets >= 5) bowlBonus = 35;
    else if (wickets >= 4) bowlBonus = 20;
    else if (wickets >= 3) bowlBonus = 10;
    
    let mvp = (runs * 0.8) + (sr / 40) + (wickets * 18) - (eco * 0.5) + batBonus + bowlBonus + batPenalty + bowlPenalty;
    
    // All-Rounder Multiplier
    if (runs >= 20 && wickets >= 1) mvp *= 1.10;
    
    return Math.max(0, mvp);
}

function didPlayerBat(matchData) {
    const runs = Number(matchData?.runs || 0);
    const ballsPlayed = Number(matchData?.balls_played || 0);
    const notOut = Number(matchData?.not_out || 0) === 1;
    return runs > 0 || ballsPlayed > 0 || (runs === 0 && !notOut);
}

function isBattingNotOut(matchData) {
    return didPlayerBat(matchData) && Number(matchData?.not_out || 0) === 1;
}

function isBattingDuck(matchData) {
    return didPlayerBat(matchData) && Number(matchData?.runs || 0) === 0 && Number(matchData?.not_out || 0) === 0;
}

function getBattingDismissals(stats) {
    return Math.max(0, Number(stats?.innings_bat || 0) - Number(stats?.not_out_count || 0));
}

function calculateBattingAverage(stats) {
    const dismissals = getBattingDismissals(stats);
    if (dismissals > 0) {
        return Number(stats?.runs || 0) / dismissals;
    }
    return Number(stats?.innings_bat || 0) > 0 ? Number(stats?.runs || 0) : 0;
}

async function getActiveSeason(guildId) {
    const db = getDB();
    const season = await db.get('SELECT season_name FROM stats_seasons WHERE guild_id = ? AND is_active = 1', guildId);
    return season ? season.season_name : null;
}

async function updatePlayerStats(guildId, seasonName, userId, matchData) {
    const db = getDB();
    let stats = await db.get('SELECT * FROM stats_players WHERE guild_id = ? AND season_name = ? AND user_id = ?', guildId, seasonName, userId);
    if (!stats) {
        stats = { guild_id: guildId, season_name: seasonName, user_id: userId, runs: 0, balls_played: 0, runs_conceded: 0, balls_bowled: 0, wickets: 0, not_out_count: 0, innings_bat: 0, innings_bowl: 0, matches_played: 0, thirties: 0, fifties: 0, hundreds: 0, ducks: 0, highscore: 0, best_bowling_runs: 0, best_bowling_wkts: 0, three_fer: 0, five_fer: 0, total_mvp: 0, runs_1_5: 0, runs_6_9: 0, low_sr_60: 0, low_sr_80: 0, zero_wkts_2overs: 0, high_eco_18: 0, high_eco_16: 0 };
        await db.run('INSERT INTO stats_players (guild_id, season_name, user_id) VALUES (?, ?, ?)', guildId, seasonName, userId);
    }

    const sr = matchData.balls_played > 0 ? (matchData.runs / matchData.balls_played) * 100 : 0;
    const eco = matchData.balls_bowled > 0 ? (matchData.runs_conceded / matchData.balls_bowled) * 6 : 0;

    stats.runs += matchData.runs; stats.balls_played += matchData.balls_played; stats.runs_conceded += matchData.runs_conceded; stats.balls_bowled += matchData.balls_bowled; stats.wickets += matchData.wickets; stats.matches_played += 1;
    // Count innings if player batted (runs > 0 OR balls > 0 OR it was a duck)
    if (didPlayerBat(matchData)) stats.innings_bat += 1; 
    if (matchData.runs >= 100) stats.hundreds += 1; 
    else if (matchData.runs >= 50) stats.fifties += 1;
    else if (matchData.runs >= 30) stats.thirties += 1;
    
    // Detailed Batting Tracking
    if (isBattingDuck(matchData)) stats.ducks += 1;
    else if (matchData.runs >= 1 && matchData.runs <= 5) stats.runs_1_5 += 1;
    else if (matchData.runs >= 6 && matchData.runs <= 9) stats.runs_6_9 += 1;

    if (matchData.balls_played >= 10) {
        if (sr < 60) stats.low_sr_60 += 1;
        else if (sr < 80) stats.low_sr_80 += 1;
    }

    if (matchData.runs > stats.highscore) {
        stats.highscore = matchData.runs;
        stats.highscore_not_out = matchData.not_out;
    } else if (matchData.runs === stats.highscore && isBattingNotOut(matchData)) {
        // If runs are equal, prefer the not-out status
        stats.highscore_not_out = 1;
    }

    if (isBattingNotOut(matchData)) stats.not_out_count += 1;

    // Detailed Bowling Tracking
    if (matchData.balls_bowled > 0) {
        const isFirstBowling = stats.innings_bowl === 0; stats.innings_bowl += 1;
        if (matchData.wickets >= 5) stats.five_fer += 1; else if (matchData.wickets >= 3) stats.three_fer += 1;
        if (isFirstBowling || matchData.wickets > stats.best_bowling_wkts || (matchData.wickets === stats.best_bowling_wkts && matchData.runs_conceded < stats.best_bowling_runs)) {
            stats.best_bowling_wkts = matchData.wickets; stats.best_bowling_runs = matchData.runs_conceded;
        }

        if (matchData.wickets === 0 && matchData.balls_bowled >= 12) stats.zero_wkts_2overs += 1;
        if (eco > 18) stats.high_eco_18 += 1;
        else if (eco >= 16.5) stats.high_eco_16 += 1;
    }

    const matchMVP = calculateMatchMVP(matchData); stats.total_mvp += matchMVP;
    await db.run(`UPDATE stats_players SET runs = ?, balls_played = ?, runs_conceded = ?, balls_bowled = ?, wickets = ?, not_out_count = ?, innings_bat = ?, innings_bowl = ?, matches_played = ?, thirties = ?, fifties = ?, hundreds = ?, ducks = ?, highscore = ?, highscore_not_out = ?, best_bowling_runs = ?, best_bowling_wkts = ?, three_fer = ?, five_fer = ?, total_mvp = ?, runs_1_5 = ?, runs_6_9 = ?, low_sr_60 = ?, low_sr_80 = ?, zero_wkts_2overs = ?, high_eco_18 = ?, high_eco_16 = ? WHERE guild_id = ? AND season_name = ? AND user_id = ?`,
        [stats.runs, stats.balls_played, stats.runs_conceded, stats.balls_bowled, stats.wickets, stats.not_out_count, stats.innings_bat, stats.innings_bowl, stats.matches_played, stats.thirties, stats.fifties, stats.hundreds, stats.ducks, stats.highscore, stats.highscore_not_out, stats.best_bowling_runs, stats.best_bowling_wkts, stats.three_fer, stats.five_fer, stats.total_mvp, stats.runs_1_5, stats.runs_6_9, stats.low_sr_60, stats.low_sr_80, stats.zero_wkts_2overs, stats.high_eco_18, stats.high_eco_16, guildId, seasonName, userId]);
    return matchMVP;
}

async function generatePlayerCard(user, stats, ratings, seasonName) {
    const template = await getCachedImage('m10.png');
    const canvas = createCanvas(template.width, template.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(template, 0, 0, template.width, template.height);

    // --- Final User-Defined Coordinates ---
    const coords = {
        "innings_bat": { "x": 245, "y": 152 },
        "runs": { "x": 245, "y": 187 },
        "avg_bat": { "x": 245, "y": 218 },
        "sr": { "x": 245, "y": 246 },
        "fifties": { "x": 245, "y": 276 },
        "hundreds": { "x": 245, "y": 307 },
        "ducks": { "x": 245, "y": 335 },
        "hs": { "x": 245, "y": 365 },
        "innings_bowl": { "x": 789, "y": 148 },
        "wickets": { "x": 789, "y": 183 },
        "avg_bowl": { "x": 789, "y": 216 },
        "eco": { "x": 789, "y": 245 },
        "conceded": { "x": 789, "y": 277 },
        "three_fer": { "x": 789, "y": 308 },
        "five_fer": { "x": 789, "y": 337 },
        "bbi": { "x": 789, "y": 368 },
        "title": { "x": 410, "y": 50 },
        "avatar": { "x": 407, "y": 160 },
        "bat_rating": { "x": 69, "y": 100 },
        "bowl_rating": { "x": 599, "y": 108 },
        "mvp": { "x": 407, "y": 350 },
        "matches": { "x": 407, "y": 394 },
        "role_label": { "x": 153, "y": 460 },
        "role_value": { "x": 580, "y": 460 },
        "bottom_rating": { "x": 453, "y": 459 }
    };

    const fontSizes = {
        "title": 35, "mvp": 44, "matches": 18, "role_label": 16, "role_value": 16, "bottom_rating": 24, "bat_stats": 21, "bowl_stats": 23, "bat_rating": 27, "bowl_rating": 25, "avatar_size": 70
    };

    // --- Font Definitions ---
    const VALUE_FONT_BAT = `bold ${fontSizes.bat_stats}px sans-serif`;
    const VALUE_FONT_BOWL = `bold ${fontSizes.bowl_stats}px sans-serif`;
    const BAT_RATING_FONT = `bold ${fontSizes.bat_rating}px sans-serif`;
    const BOWL_RATING_FONT = `bold ${fontSizes.bowl_rating}px sans-serif`;
    const MVP_FONT_FINAL = `bold ${fontSizes.mvp}px sans-serif`;
    const MATCHES_TEXT_FONT = `bold ${fontSizes.matches}px sans-serif`;
    const ROLE_LABEL_FONT = `bold ${fontSizes.role_label}px sans-serif`;
    const ROLE_VALUE_FONT = `bold ${fontSizes.role_value}px sans-serif`;
    const BOTTOM_RATING_FONT = `bold ${fontSizes.bottom_rating}px sans-serif`;
    const TITLE_FONT = `bold ${fontSizes.title}px sans-serif`;
    const GOLD_COLOR = '#e5b357';
    const WHITE_COLOR = '#ffffff';

    // --- Helper for consistent text drawing ---
    const drawText = (text, x, y, font, color, align) => {
        ctx.font = font;
        ctx.fillStyle = color;
        ctx.textAlign = align;
        ctx.fillText(text, x, y);
    };

    // --- Calculations for dynamic text ---
    const inningsBat = stats.innings_bat || 0;
    const avgB = calculateBattingAverage(stats).toFixed(2);
    const sr = stats.balls_played > 0 ? ((stats.runs / stats.balls_played) * 100).toFixed(1) : "0.0";
    const hs = stats.highscore + (stats.highscore_not_out === 1 && stats.highscore > 0 ? "*" : "");
    const bowlAvg = stats.wickets > 0 ? (stats.runs_conceded / stats.wickets).toFixed(2) : stats.runs_conceded.toFixed(2);
    const eco = stats.balls_bowled > 0 ? ((stats.runs_conceded / stats.balls_bowled) * 6).toFixed(2) : "0.00";
    const bbi = stats.matches_played > 0 && (stats.wickets > 0 || stats.runs_conceded > 0) ? `${stats.best_bowling_wkts}/${stats.best_bowling_runs}` : "—";

    const mvpScore = Math.round(stats.total_mvp || 0);
    
    // --- Dynamic Role and Main Rating Logic ---
    let mainRating;
    let role;

    const batR = Math.round(ratings.batting);
    const bowlR = Math.round(ratings.bowling);
    const diff = Math.abs(batR - bowlR);

    if (diff >= 15) {
        // High difference: Pure role
        if (batR > bowlR) {
            role = "BATTER";
            mainRating = batR;
        } else {
            role = "BOWLER";
            mainRating = bowlR;
        }
    } else {
        // Low difference: All-Rounder variants
        mainRating = Math.round(ratings.alr);
        
        // Check if in same 10s range (e.g. 50-59, 60-69)
        if (Math.floor(batR / 10) === Math.floor(bowlR / 10)) {
            role = "ALL-ROUNDER";
        } else {
            role = batR > bowlR ? "BATTING ALR" : "BOWLING ALR";
        }
    }

    // --- Draw Fixed Elements ---
    drawText(user.username.toUpperCase(), coords.title.x, coords.title.y, TITLE_FONT, GOLD_COLOR, 'center');

    try {
        const avatarURL = user.displayAvatarURL({ extension: 'png', size: 256 });
        const avatar = await loadImage(avatarURL);
        const avatarRadius = fontSizes.avatar_size; 
        ctx.save();
        ctx.beginPath();
        ctx.arc(coords.avatar.x, coords.avatar.y, avatarRadius, 0, Math.PI * 2, true);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(avatar, coords.avatar.x - avatarRadius, coords.avatar.y - avatarRadius, avatarRadius * 2, avatarRadius * 2);
        ctx.restore();
        ctx.beginPath();
        ctx.arc(coords.avatar.x, coords.avatar.y, avatarRadius, 0, Math.PI * 2, true);
        ctx.strokeStyle = GOLD_COLOR;
        ctx.lineWidth = 6;
        ctx.stroke();
    } catch (e) { console.error("Avatar load failed.", e); }

    // --- Draw Dynamic Text Elements ---
    drawText(String(Math.round(ratings.batting)), coords.bat_rating.x, coords.bat_rating.y, BAT_RATING_FONT, GOLD_COLOR, 'center');
    drawText(String(Math.round(ratings.bowling)), coords.bowl_rating.x, coords.bowl_rating.y, BOWL_RATING_FONT, GOLD_COLOR, 'center');
    drawText(String(mvpScore), coords.mvp.x, coords.mvp.y, MVP_FONT_FINAL, WHITE_COLOR, 'center');
    drawText(`${stats.matches_played} MATCHES`, coords.matches.x, coords.matches.y, MATCHES_TEXT_FONT, WHITE_COLOR, 'center');
    drawText(`ROLE:`, coords.role_label.x, coords.role_label.y, ROLE_LABEL_FONT, WHITE_COLOR, 'left');
    drawText(role, coords.role_value.x, coords.role_value.y, ROLE_VALUE_FONT, WHITE_COLOR, 'left');
    drawText(String(mainRating), coords.bottom_rating.x, coords.bottom_rating.y, BOTTOM_RATING_FONT, WHITE_COLOR, 'center');

    // --- Draw Batting Stats Panel ---
    ctx.textAlign = 'right';
    drawText(String(inningsBat), coords.innings_bat.x, coords.innings_bat.y, VALUE_FONT_BAT, WHITE_COLOR, 'right');
    drawText(String(stats.runs), coords.runs.x, coords.runs.y, VALUE_FONT_BAT, WHITE_COLOR, 'right');
    drawText(String(avgB), coords.avg_bat.x, coords.avg_bat.y, VALUE_FONT_BAT, WHITE_COLOR, 'right');
    drawText(String(sr), coords.sr.x, coords.sr.y, VALUE_FONT_BAT, WHITE_COLOR, 'right');
    drawText(String(stats.fifties), coords.fifties.x, coords.fifties.y, VALUE_FONT_BAT, WHITE_COLOR, 'right');
    drawText(String(stats.hundreds), coords.hundreds.x, coords.hundreds.y, VALUE_FONT_BAT, WHITE_COLOR, 'right');
    drawText(String(stats.ducks), coords.ducks.x, coords.ducks.y, VALUE_FONT_BAT, WHITE_COLOR, 'right');
    drawText(String(hs), coords.hs.x, coords.hs.y, VALUE_FONT_BAT, WHITE_COLOR, 'right');

    // --- Draw Bowling Stats Panel ---
    drawText(String(stats.innings_bowl || 0), coords.innings_bowl.x, coords.innings_bowl.y, VALUE_FONT_BOWL, WHITE_COLOR, 'right');
    drawText(String(stats.wickets), coords.wickets.x, coords.wickets.y, VALUE_FONT_BOWL, WHITE_COLOR, 'right');
    drawText(String(bowlAvg), coords.avg_bowl.x, coords.avg_bowl.y, VALUE_FONT_BOWL, WHITE_COLOR, 'right');
    drawText(String(eco), coords.eco.x, coords.eco.y, VALUE_FONT_BOWL, WHITE_COLOR, 'right');
    drawText(String(stats.runs_conceded), coords.conceded.x, coords.conceded.y, VALUE_FONT_BOWL, WHITE_COLOR, 'right');
    drawText(String(stats.three_fer), coords.three_fer.x, coords.three_fer.y, VALUE_FONT_BOWL, WHITE_COLOR, 'right');
    drawText(String(stats.five_fer), coords.five_fer.x, coords.five_fer.y, VALUE_FONT_BOWL, WHITE_COLOR, 'right');
    drawText(String(bbi), coords.bbi.x, coords.bbi.y, VALUE_FONT_BOWL, WHITE_COLOR, 'right');

    return canvas.toBuffer();
}


async function createProfileEmbed(guildId, seasonName, user, stats) {
    const battingRating = calculateBattingRating(stats);
    const bowlingRating = calculateBowlingRating(stats);
    const alr = calculateALR(battingRating, bowlingRating);
    const buffer = await generatePlayerCard(user, stats, { batting: battingRating, bowling: bowlingRating, alr: alr }, seasonName);
    const attachment = new AttachmentBuilder(buffer, { name: 'playercard.png' });
    
    // Using a static color that matches the new design.
    const accentColor = '#e5b357'; // Gold

    const embed = new EmbedBuilder()
        .setTitle(`🏏 Player Stats: ${user.username}`)
        .setColor(accentColor)
        .setImage('attachment://playercard.png')
        .setFooter({ text: `Season: ${seasonName}` })
        .setTimestamp();

    return { embeds: [embed], files: [attachment] };
}

async function recalculatePlayerStats(guildId, seasonName, userId) {
    const db = getDB();
    
    // Get all matches for this player in this season
    const matches = await db.all('SELECT * FROM stats_matches WHERE guild_id = ? AND season_name = ? AND user_id = ?', guildId, seasonName, userId);
    
    // Reset stats to zero
    const stats = { 
        runs: 0, balls_played: 0, runs_conceded: 0, balls_bowled: 0, wickets: 0, 
        not_out_count: 0, innings_bat: 0, innings_bowl: 0, matches_played: 0, 
        thirties: 0, fifties: 0, hundreds: 0, ducks: 0, highscore: 0, highscore_not_out: 0,
        best_bowling_runs: 0, best_bowling_wkts: 0, three_fer: 0, five_fer: 0, 
        total_mvp: 0, runs_1_5: 0, runs_6_9: 0, low_sr_60: 0, low_sr_80: 0, 
        zero_wkts_2overs: 0, high_eco_18: 0, high_eco_16: 0 
    };

    if (matches.length > 0) {
        for (const matchData of matches) {
            const sr = matchData.balls_played > 0 ? (matchData.runs / matchData.balls_played) * 100 : 0;
            const eco = matchData.balls_bowled > 0 ? (matchData.runs_conceded / matchData.balls_bowled) * 6 : 0;

            stats.runs += matchData.runs; 
            stats.balls_played += matchData.balls_played; 
            stats.runs_conceded += matchData.runs_conceded; 
            stats.balls_bowled += matchData.balls_bowled; 
            stats.wickets += matchData.wickets; 
            stats.matches_played += 1;

            // Count innings if player batted (runs > 0 OR balls > 0 OR it was a duck)
            if (didPlayerBat(matchData)) stats.innings_bat += 1; 
            if (matchData.runs >= 100) stats.hundreds += 1; 
            else if (matchData.runs >= 50) stats.fifties += 1;
            else if (matchData.runs >= 30) stats.thirties += 1;
            
            // Detailed Batting Tracking
            if (isBattingDuck(matchData)) stats.ducks += 1;
            else if (matchData.runs >= 1 && matchData.runs <= 5) stats.runs_1_5 += 1;
            else if (matchData.runs >= 6 && matchData.runs <= 9) stats.runs_6_9 += 1;

            if (matchData.balls_played >= 10) {
                if (sr < 60) stats.low_sr_60 += 1;
                else if (sr < 80) stats.low_sr_80 += 1;
            }

            if (matchData.runs > stats.highscore) {
                stats.highscore = matchData.runs;
                stats.highscore_not_out = matchData.not_out;
            } else if (matchData.runs === stats.highscore && isBattingNotOut(matchData)) {
                stats.highscore_not_out = 1;
            }

            if (isBattingNotOut(matchData)) stats.not_out_count += 1;

            // Detailed Bowling Tracking
            if (matchData.balls_bowled > 0) {
                const isFirstBowling = stats.innings_bowl === 0; 
                stats.innings_bowl += 1;
                if (matchData.wickets >= 5) stats.five_fer += 1; 
                else if (matchData.wickets >= 3) stats.three_fer += 1;
                
                if (isFirstBowling || matchData.wickets > stats.best_bowling_wkts || (matchData.wickets === stats.best_bowling_wkts && matchData.runs_conceded < stats.best_bowling_runs)) {
                    stats.best_bowling_wkts = matchData.wickets; 
                    stats.best_bowling_runs = matchData.runs_conceded;
                }

                if (matchData.wickets === 0 && matchData.balls_bowled >= 12) stats.zero_wkts_2overs += 1;
                if (eco > 18) stats.high_eco_18 += 1;
                else if (eco >= 16.5) stats.high_eco_16 += 1;
            }

            stats.total_mvp += matchData.match_mvp;
        }
    }

    await db.run(`UPDATE stats_players SET runs = ?, balls_played = ?, runs_conceded = ?, balls_bowled = ?, wickets = ?, not_out_count = ?, innings_bat = ?, innings_bowl = ?, matches_played = ?, thirties = ?, fifties = ?, hundreds = ?, ducks = ?, highscore = ?, highscore_not_out = ?, best_bowling_runs = ?, best_bowling_wkts = ?, three_fer = ?, five_fer = ?, total_mvp = ?, runs_1_5 = ?, runs_6_9 = ?, low_sr_60 = ?, low_sr_80 = ?, zero_wkts_2overs = ?, high_eco_18 = ?, high_eco_16 = ? WHERE guild_id = ? AND season_name = ? AND user_id = ?`,
        [stats.runs, stats.balls_played, stats.runs_conceded, stats.balls_bowled, stats.wickets, stats.not_out_count, stats.innings_bat, stats.innings_bowl, stats.matches_played, stats.thirties, stats.fifties, stats.hundreds, stats.ducks, stats.highscore, stats.highscore_not_out, stats.best_bowling_runs, stats.best_bowling_wkts, stats.three_fer, stats.five_fer, stats.total_mvp, stats.runs_1_5, stats.runs_6_9, stats.low_sr_60, stats.low_sr_80, stats.zero_wkts_2overs, stats.high_eco_18, stats.high_eco_16, guildId, seasonName, userId]);
}

async function recalculateAllSeasonStats(guildId, seasonName) {
    const db = getDB();
    const players = await db.all('SELECT DISTINCT user_id FROM stats_matches WHERE guild_id = ? AND season_name = ?', guildId, seasonName);
    
    for (const player of players) {
        await recalculatePlayerStats(guildId, seasonName, player.user_id);
    }
    return players.length;
}

async function recalculateEntireOverall(guildId) {
    const db = getDB();
    const seasons = await db.all('SELECT DISTINCT season_name FROM stats_seasons WHERE guild_id = ?', guildId);
    let totalPlayers = 0;
    
    for (const s of seasons) {
        const count = await recalculateAllSeasonStats(guildId, s.season_name);
        totalPlayers += count;
    }
    return totalPlayers;
}

module.exports = { calculateBattingRating, calculateBowlingRating, calculateALR, calculateMatchMVP, calculateBattingAverage, didPlayerBat, isBattingNotOut, isBattingDuck, getActiveSeason, updatePlayerStats, createProfileEmbed, recalculatePlayerStats, recalculateAllSeasonStats, recalculateEntireOverall };
