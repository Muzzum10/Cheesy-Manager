"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.auctionManager = exports.AuctionManager = void 0;
const discord_js_1 = require("discord.js");
const database_1 = require("./database");
const utils_1 = require("./utils");
// State for a single guild's auction
class AuctionSession {
    constructor() {
        this.activePlayer = null;
        this.currentBidLakhs = 0;
        this.currentHolderId = null;
        this.minIncrement = 0;
        this.timer = null;
        this.channel = null;
        this.timerMessage = null;
        this.isPaused = false;
        this.currentSetName = null;
        this.interruptedLots = [];
        this.bidHistory = [];
        this.recentGifs = [];
        this.lastWaitTime = 0;
        // Timer State
        this.timeLeft = 0;
        this.timerStage = 'COUNTDOWN';
    }
}
class AuctionManager {
    constructor() {
        this.sessions = new Map();
        this.MOCK_GIFS = [
            "https://tenor.com/view/laughing-cat-catlaughing-laughingcat-point-gif-7577620470218150413",
            "https://tenor.com/view/orange-cat-laughing-gif-13031147940704744720",
            "https://tenor.com/view/laugh-cat-kitty-giggle-chuckle-gif-11715112707478851251",
            "https://tenor.com/view/dance-gif-1401901097955364941",
            "https://tenor.com/view/cat-kitty-kitten-cute-pussy-cat-gif-15745491",
            "https://tenor.com/view/prude-losers-screaming-cat-gif-17397079968323712940",
            "https://tenor.com/view/cat-kung-fu-ai-orange-cat-fight-gif-8725930490492900021",
            "https://tenor.com/view/2-gif-7749019966943875056",
            "https://tenor.com/view/cat-water-gif-18466013",
            "https://tenor.com/view/marmota-cooking-hold-up-gif-5382607284931131048",
            "https://tenor.com/view/cat-tongue-kitty-ai-funny-gif-5179323189128605544",
            "https://tenor.com/view/silly-cat-gif-16653606838521083623"
        ];
    }
    async getTimingConfig(guildId) {
        const db = (0, database_1.getDB)();
        const settings = await db.get('SELECT auction_bid_timer_seconds, auction_call_timer_seconds FROM guild_settings WHERE guild_id = ?', guildId);
        const bidSeconds = Math.max(5, Math.min(120, parseInt(String(settings?.auction_bid_timer_seconds ?? 15), 10) || 15));
        const callSeconds = Math.max(1, Math.min(30, parseInt(String(settings?.auction_call_timer_seconds ?? 2), 10) || 2));
        return { bidSeconds, callSeconds };
    }
    getSession(guildId) {
        if (!this.sessions.has(guildId)) {
            this.sessions.set(guildId, new AuctionSession());
        }
        return this.sessions.get(guildId);
    }
    getRandomMockGif(session) {
        // Filter out recently used GIFs
        const available = this.MOCK_GIFS.filter(g => !session.recentGifs.includes(g));
        // If we ran out (shouldn't happen with 12 items and 3 history), or just safety reset
        if (available.length === 0) {
            session.recentGifs = [];
            return this.MOCK_GIFS[Math.floor(Math.random() * this.MOCK_GIFS.length)];
        }
        const selected = available[Math.floor(Math.random() * available.length)];
        // Update history
        session.recentGifs.push(selected);
        if (session.recentGifs.length > 3) {
            session.recentGifs.shift(); // Remove oldest
        }
        return selected;
    }
    async startAuction(guildId, nameArg, channel, options = {}) {
        const session = this.getSession(guildId);
        if (session.activePlayer) {
            throw new Error('An auction is already in progress in this server.');
        }
        const db = (0, database_1.getDB)();
        let player;
        let isSetStart = false;
        let selectedSetName = null;
        // 1. Check if argument is a Mention (<@ID>)
        const mentionMatch = nameArg.match(/^<@!?(\d+)>$/);
        if (mentionMatch) {
            const discordId = mentionMatch[1];
            player = await db.get('SELECT * FROM auction_players WHERE guild_id = ? AND discord_id = ? AND status IN ("AVAILABLE", "UNSOLD")', guildId, discordId);
        }
            else {
                // 2. Try to find a player by IGN (Case-Insensitive)
                player = await db.get('SELECT * FROM auction_players WHERE guild_id = ? AND ign LIKE ? AND status IN ("AVAILABLE", "UNSOLD")', guildId, `%${nameArg}%`);
                // 3. If not a specific player, try to find a set (Random from Set)
                if (!player) {
                    // Check if set exists first to confirm intent
                    const set = await db.get('SELECT * FROM sets WHERE guild_id = ? AND set_name LIKE ?', guildId, `%${nameArg}%`);
                    if (set) {
                        isSetStart = true;
                        selectedSetName = set.set_name;
                        const countRow = await db.get('SELECT COUNT(*) as count FROM auction_players WHERE guild_id = ? AND set_name = ? AND status = "AVAILABLE"', guildId, set.set_name);
                        const availableCount = countRow?.count || 0;
                        if (availableCount > 0) {
                            const randomOffset = Math.floor(Math.random() * availableCount);
                            player = await db.get('SELECT * FROM auction_players WHERE guild_id = ? AND set_name = ? AND status = "AVAILABLE" LIMIT 1 OFFSET ?', guildId, set.set_name, randomOffset);
                        }
                    }
                }
            }
        if (!player) {
            // Check if it was a valid set but empty
            if (isSetStart) {
                const setExists = await db.get('SELECT * FROM sets WHERE guild_id = ? AND set_name = ?', guildId, nameArg);
                if (setExists) {
                    channel.send(`No available players left in set "${nameArg}".`);
                    return;
                }
            }
            channel.send(`No available player or set found with name "${nameArg}".`);
            return;
        }
        // 2. Fetch Set details for Base Price (Player must belong to a set for rules)
        // If player has no set, we need default rules? For now assume all have sets.
        if (!player.set_name) {
            channel.send(`Player "${player.ign}" is not assigned to any set (No base price).`);
            return;
        }
        const set = await db.get('SELECT * FROM sets WHERE guild_id = ? AND set_name = ?', guildId, player.set_name);
        if (!set) {
            channel.send(`Set data for "${player.set_name}" not found.`);
            return;
        }
        session.activePlayer = player;
        session.currentBidLakhs = set.base_price_lakhs;
        session.minIncrement = set.increment_lakhs;
        session.currentHolderId = null;
        session.channel = channel;
        session.isPaused = false;
        // Only set 'currentSetName' if we started a SET. 
        // If we nominated a player specifically, we probably DON'T want auto-continuation 
        // unless you want to continue that player's set?
        // Let's assume if you pick a player, it's a one-off, UNLESS you want to continue their set?
        // Standard practice: Specific pick = One off. Set start = Auto loop.
        session.currentSetName = options.continueSetName ?? (isSetStart ? (selectedSetName || nameArg) : null);
        session.bidHistory = [];
        // 3. Clear Ledger for this guild
        await db.run('DELETE FROM auction_ledger WHERE guild_id = ?', guildId);
        await db.run('INSERT INTO auction_ledger (guild_id, player_id, current_bid_lakhs, current_holder_team_id) VALUES (?, ?, ?, ?)', guildId, player.discord_id, session.currentBidLakhs, null);
        // 4. Post Lot Embed
        const playerUser = await channel.client.users.fetch(player.discord_id).catch(() => null);
        const avatarUrl = playerUser?.displayAvatarURL({ extension: 'png', size: 256 }) || null;
        const embed = new discord_js_1.EmbedBuilder()
            .setTitle(`🔨 ON AUCTION: ${player.ign}`)
            .setColor(0xFFD700);
        if (avatarUrl)
            embed.setThumbnail(avatarUrl);
        embed.addFields({ name: '💰 Base Price', value: (0, utils_1.lakhsToDisplay)(session.currentBidLakhs), inline: true }, { name: '📈 Min Increment', value: (0, utils_1.lakhsToDisplay)(session.minIncrement), inline: true })
            .setFooter({ text: '🟢 OPEN FOR BIDS | Waiting for opening bid...' });
        
        session.timerMessage = await channel.send({ embeds: [embed] });

        // --- Display Player Stats Card ---
        const statsSystem = require('./statsSystem');
        const settings = await db.get('SELECT auction_stats_season FROM guild_settings WHERE guild_id = ?', guildId);
        const statSeason = settings?.auction_stats_season;

        if (statSeason && playerUser) {
            try {
                let stats;
                if (statSeason === 'OVERALL') {
                    stats = await db.get(`
                        SELECT 
                            SUM(runs) as runs, SUM(balls_played) as balls_played,
                            SUM(runs_conceded) as runs_conceded, SUM(balls_bowled) as balls_bowled,
                            SUM(wickets) as wickets, SUM(not_out_count) as not_out_count,
                            SUM(innings_bat) as innings_bat, SUM(innings_bowl) as innings_bowl,
                            SUM(matches_played) as matches_played, SUM(fifties) as fifties,
                            SUM(hundreds) as hundreds, SUM(ducks) as ducks,
                            MAX(highscore) as highscore, SUM(total_mvp) as total_mvp,
                            SUM(three_fer) as three_fer, SUM(five_fer) as five_fer
                        FROM stats_players 
                        WHERE guild_id = ? AND user_id = ?
                    `, guildId, playerUser.id);

                    if (stats && stats.matches_played) {
                        const bestBowling = await db.get(`
                            SELECT best_bowling_wkts, best_bowling_runs 
                            FROM stats_players 
                            WHERE guild_id = ? AND user_id = ? 
                            ORDER BY best_bowling_wkts DESC, best_bowling_runs ASC 
                            LIMIT 1
                        `, guildId, playerUser.id);
                        stats.best_bowling_wkts = bestBowling?.best_bowling_wkts || 0;
                        stats.best_bowling_runs = bestBowling?.best_bowling_runs || 0;
                    }
                } else {
                    stats = await db.get('SELECT * FROM stats_players WHERE guild_id = ? AND season_name = ? AND user_id = ?', guildId, statSeason, playerUser.id);
                }

                if (stats && (statSeason === 'OVERALL' ? stats.matches_played : true)) {
                    const profile = await statsSystem.createProfileEmbed(guildId, statSeason === 'OVERALL' ? 'All-Time' : statSeason, playerUser, stats);
                    await channel.send({ embeds: profile.embeds, files: profile.files });
                }
            } catch (e) {
                console.error("Failed to show stats during auction:", e);
            }
        }
        // ---------------------------------
    }
    async placeBid(guildId, team, amountLakhs, channel) {
        const session = this.getSession(guildId);
        if (!session.activePlayer)
            return channel.send("No auction in progress.");
        if (session.isPaused)
            return channel.send("Auction is paused.");
        const db = (0, database_1.getDB)();
        let currentBid = session.currentBidLakhs;
        // Determine Bid Amount
        let newBid = 0;
        if (amountLakhs === 'increment') {
            if (session.currentHolderId === null) {
                newBid = currentBid;
            }
            else {
                newBid = currentBid + session.minIncrement;
            }
        }
        else {
            newBid = amountLakhs;
        }
        // Reset/Extend timer on ANY bid attempt (including invalid ones)
        if (session.activePlayer) {
            await this.resetTimer(guildId);
        }
        // Prevent Double Bidding (Outbidding yourself)
        if (session.currentHolderId === team.team_id) {
            return channel.send(`⚠️ You are already the highest bidder!`);
        }
        if (newBid % 5 !== 0) {
            return channel.send(`Invalid bid amount! Bids must end in 0 or 5 Lakhs (e.g., 2.25 CR, 40 L).`);
        }
        // Validation
        if (session.currentHolderId === null) {
            if (newBid < session.currentBidLakhs) {
                return channel.send(`Bid too low! Base price is ${(0, utils_1.lakhsToDisplay)(session.currentBidLakhs)}.`);
            }
        }
        else {
            if (newBid < currentBid + session.minIncrement) {
                return channel.send(`Bid too low! Minimum required: ${(0, utils_1.lakhsToDisplay)(currentBid + session.minIncrement)}.`);
            }
        }
        // Check Wallet
        if (team.purse_lakhs < newBid) {
            return channel.send(`Insufficient funds! Wallet: ${(0, utils_1.lakhsToDisplay)(team.purse_lakhs)}.`);
        }
        // Check Roster Limit
        const rosterCount = await db.get('SELECT COUNT(*) as count FROM auction_players WHERE guild_id = ? AND sold_to_team_id = ?', guildId, team.team_id);
        if (rosterCount && rosterCount.count >= team.max_roster_size) {
            return channel.send(`🚫 Roster Full! Limit: ${team.max_roster_size} players.`);
        }
        // -------------------------
        // ACCEPT BID
        session.bidHistory.push({ teamId: session.currentHolderId, amount: session.currentBidLakhs });
        // Update State
        session.currentBidLakhs = newBid;
        session.currentHolderId = team.team_id;
        // Update Ledger
        await db.run('UPDATE auction_ledger SET current_bid_lakhs = ?, current_holder_team_id = ? WHERE guild_id = ?', newBid, team.team_id, guildId);
        // Visual Feedback
        const playerUser = await channel.client.users.fetch(session.activePlayer.discord_id).catch(() => null);
        const playerAvatarUrl = playerUser?.displayAvatarURL({ extension: 'png', size: 256 }) || null;
        const embed = new discord_js_1.EmbedBuilder()
            .setTitle(`🔥 New Highest Bid!`)
            .setColor(0x00FF00);
        if (playerAvatarUrl)
            embed.setThumbnail(playerAvatarUrl);
        const timing = await this.getTimingConfig(guildId);
        embed.addFields({ name: 'Player', value: session.activePlayer.ign, inline: true }, { name: 'Bid Amount', value: (0, utils_1.lakhsToDisplay)(newBid), inline: true }, { name: 'Held By', value: `${team.team_name} (<@${team.owner_discord_id}>)`, inline: false })
            .setFooter({ text: `⏳ Timer Reset: ${timing.bidSeconds} seconds remaining...` });
        session.timerMessage = await channel.send({ embeds: [embed] });
        // Reset Timer
        await this.resetTimer(guildId);
    }
    async resendEmbed(guildId, newEmbed) {
        const session = this.getSession(guildId);
        if (!session.timerMessage || !session.channel)
            return;
        try {
            const embedToSend = newEmbed || discord_js_1.EmbedBuilder.from(session.timerMessage.embeds[0]);
            await session.timerMessage.delete().catch(() => { });
            session.timerMessage = await session.channel.send({ embeds: [embedToSend] });
        }
        catch (e) {
            console.error("Failed to resend embed:", e);
        }
    }
    async resetTimer(guildId) {
        const session = this.getSession(guildId);
        if (session.timer)
            clearInterval(session.timer);
        session.timer = null;
        const timing = await this.getTimingConfig(guildId);
        session.timeLeft = timing.bidSeconds;
        session.timerStage = 'COUNTDOWN';
        session.timer = setInterval(async () => {
            if (session.isPaused)
                return;
            if (session.timerStage === 'COUNTDOWN') {
                session.timeLeft--;
                if (session.timerMessage) {
                    try {
                        const embed = discord_js_1.EmbedBuilder.from(session.timerMessage.embeds[0])
                            .setFooter({ text: `⏳ Timer: ${session.timeLeft}s remaining...` });
                        await session.timerMessage.edit({ embeds: [embed] });
                    }
                    catch (e) { }
                }
                // Resend Embed at 5s for final visibility
                if (session.timeLeft === 5) {
                    await this.resendEmbed(guildId);
                }
                if (session.timeLeft <= 0) {
                    session.timerStage = 'GOING_ONCE';
                    session.timeLeft = timing.callSeconds;
                    if (session.timerMessage) {
                        const embed = discord_js_1.EmbedBuilder.from(session.timerMessage.embeds[0])
                            .setFooter({ text: `🟡 GOING ONCE...` });
                        // Resend for "Going Once" with the updated embed
                        await this.resendEmbed(guildId, embed);
                    }
                    else {
                        session.channel?.send("Going once...");
                    }
                }
            }
            else if (session.timerStage === 'GOING_ONCE') {
                session.timeLeft--;
                if (session.timeLeft <= 0) {
                    session.timerStage = 'GOING_TWICE';
                    session.timeLeft = timing.callSeconds;
                    if (session.timerMessage) {
                        const embed = discord_js_1.EmbedBuilder.from(session.timerMessage.embeds[0])
                            .setFooter({ text: `🟠 GOING TWICE...` });
                        // Resend for "Going Twice" with the updated embed
                        await this.resendEmbed(guildId, embed);
                    }
                    else {
                        session.channel?.send("Going twice...");
                    }
                }
            }
            else if (session.timerStage === 'GOING_TWICE') {
                session.timeLeft--;
                if (session.timeLeft <= 0) {
                    this.finalizeAuction(guildId);
                }
            }
        }, 1000);
    }
    async wait(guildId) {
        const session = this.getSession(guildId);
        if (!session.activePlayer || !session.timer)
            return;

        const now = Date.now();
        const cooldownMs = 8000; // 8 seconds
        if (now - session.lastWaitTime < cooldownMs) {
            const remaining = Math.ceil((cooldownMs - (now - session.lastWaitTime)) / 1000);
            return session.channel?.send(`⚠️ **.wait** is on cooldown! Try again in **${remaining}s**.`);
        }

        session.lastWaitTime = now;
        session.timeLeft += 30;
        if (session.timerStage !== 'COUNTDOWN') {
            session.timerStage = 'COUNTDOWN';
        }
        session.channel?.send(`🛑 **Timer extended by 30s!** (${session.timeLeft}s remaining)`);
        
        // Resend embed to bottom
        await this.resendEmbed(guildId);

        // Notify when cooldown is over
        setTimeout(() => {
            if (session.activePlayer) {
                session.channel?.send("✅ **.wait** command is now available again.");
            }
        }, cooldownMs);
    }
    async scheduleNextLot(guildId, delayMs = 5000) {
        const session = this.getSession(guildId);
        const nextInterrupted = session.interruptedLots.shift() || null;
        if (nextInterrupted && nextInterrupted.playerDiscordId && nextInterrupted.channel) {
            setTimeout(() => {
                this.startAuction(guildId, `<@${nextInterrupted.playerDiscordId}>`, nextInterrupted.channel, {
                    continueSetName: nextInterrupted.continueSetName || null
                }).catch(console.error);
            }, delayMs);
            return;
        }
        if (session.currentSetName && session.channel) {
            const nextSet = session.currentSetName;
            const nextChan = session.channel;
            setTimeout(() => {
                this.startAuction(guildId, nextSet, nextChan).catch(console.error);
            }, delayMs);
        }
    }
    async interruptForReauction(guildId, playerDiscordId, fallbackChannel) {
        const session = this.getSession(guildId);
        const interruptChannel = session.channel || fallbackChannel || null;
        const db = (0, database_1.getDB)();
        const restartingPlayer = await db.get('SELECT * FROM auction_players WHERE guild_id = ? AND discord_id = ?', guildId, playerDiscordId);
        const canceledPlayer = session.activePlayer ? { ...session.activePlayer } : null;
        const restartDelayMs = 10000;
        if (session.activePlayer && interruptChannel) {
            if (session.timer)
                clearInterval(session.timer);
            session.timer = null;
            session.interruptedLots.unshift({
                playerDiscordId: session.activePlayer.discord_id,
                continueSetName: session.currentSetName || null,
                channel: interruptChannel
            });
            await db.run('DELETE FROM auction_ledger WHERE guild_id = ?', guildId);
            session.activePlayer = null;
            session.currentBidLakhs = 0;
            session.currentHolderId = null;
            session.bidHistory = [];
            session.currentSetName = null;
            session.timeLeft = 0;
            session.timerStage = 'COUNTDOWN';
            await interruptChannel.send(`Warning: Current auction interrupted. The previous sold player will be re-auctioned first, then the interrupted lot will resume.`).catch(() => null);
        }
        const channelToUse = interruptChannel || fallbackChannel;
        if (!channelToUse)
            throw new Error('No auction channel is available to restart the player.');
        const updateLines = [];
        if (canceledPlayer) {
            updateLines.push(`**${canceledPlayer.ign}** auction cancelled.`);
        }
        if (restartingPlayer) {
            updateLines.push(`**${restartingPlayer.ign}** will restart in **10 seconds**.`);
        }
        else {
            updateLines.push('The selected player will restart in **10 seconds**.');
        }
        if (canceledPlayer) {
            updateLines.push('The cancelled lot will return after this re-auction finishes.');
        }
        const updateEmbed = new discord_js_1.EmbedBuilder()
            .setColor(0xF59E0B)
            .setTitle('Auction Update')
            .setDescription(updateLines.join('\n'));
        await channelToUse.send({ embeds: [updateEmbed] }).catch(() => null);
        setTimeout(() => {
            this.startAuction(guildId, `<@${playerDiscordId}>`, channelToUse).catch(console.error);
        }, restartDelayMs);
    }
    async finalizeAuction(guildId) {
        const session = this.getSession(guildId);
        if (session.timer)
            clearInterval(session.timer);
        session.timer = null;
        if (!session.activePlayer || !session.channel)
            return;
        const db = (0, database_1.getDB)();
        if (session.currentHolderId) {
            const team = await db.get('SELECT * FROM teams WHERE team_id = ?', session.currentHolderId);
            if (team) {
                await db.run('UPDATE teams SET purse_lakhs = purse_lakhs - ? WHERE team_id = ?', session.currentBidLakhs, team.team_id);
                await db.run('UPDATE auction_players SET status = "SOLD", sold_to_team_id = ?, sold_for_lakhs = ? WHERE guild_id = ? AND discord_id = ?', team.team_id, session.currentBidLakhs, guildId, session.activePlayer.discord_id);
                const winnerUser = await session.channel.client.users.fetch(team.owner_discord_id).catch(() => null);
                const winnerAvatar = winnerUser?.displayAvatarURL({ extension: 'png', size: 256 });
                const playerUser = await session.channel.client.users.fetch(session.activePlayer.discord_id).catch(() => null);
                const playerAvatar = playerUser?.displayAvatarURL({ extension: 'png', size: 256 });
                // Embed 1: Player Info
                const playerEmbed = new discord_js_1.EmbedBuilder()
                    .setColor(0xFF0000)
                    .setAuthor({ name: '👤 PLAYER SOLD' })
                    .setDescription(`## ${session.activePlayer.ign}`);
                if (playerAvatar)
                    playerEmbed.setThumbnail(playerAvatar);
                // Embed 2: Winner Info
                const winnerEmbed = new discord_js_1.EmbedBuilder()
                    .setColor(0xFF0000)
                    .setAuthor({ name: '🤝 BOUGHT BY' })
                    .setDescription(`## <@${team.owner_discord_id}>`)
                    .addFields({ name: '💰 Final Price', value: `**${(0, utils_1.lakhsToDisplay)(session.currentBidLakhs)}**` })
                    .setFooter({ text: 'Auction Complete' });
                if (winnerAvatar)
                    winnerEmbed.setThumbnail(winnerAvatar);
                session.channel.send({ embeds: [playerEmbed, winnerEmbed] });
                await (0, utils_1.sendAuctionPurchaseDm)(session.channel.client, {
                    guildName: session.channel.guild?.name || '',
                    playerDiscordId: session.activePlayer.discord_id,
                    playerName: session.activePlayer.ign,
                    playerAvatarUrl: playerAvatar || null,
                    teamName: team.team_name,
                    ownerDiscordId: team.owner_discord_id,
                    ownerAvatarUrl: winnerAvatar || null,
                    priceLakhs: session.currentBidLakhs,
                    sourceText: 'Live Auction Purchase'
                });

                // --- Automatic Sales Log ---
                const settings = await db.get('SELECT sales_log_channel_id FROM guild_settings WHERE guild_id = ?', guildId);
                if (settings?.sales_log_channel_id) {
                    try {
                        const logChannel = await session.channel.client.channels.fetch(settings.sales_log_channel_id);
                        if (logChannel) {
                            const logEmbed = new discord_js_1.EmbedBuilder()
                                .setTitle(`✅ SOLD: ${session.activePlayer.ign}`)
                                .setColor(0x00FF00)
                                .addFields(
                                    { name: '👤 Player', value: `<@${session.activePlayer.discord_id}>`, inline: true },
                                    { name: '🤝 Team', value: `**${team.team_name}**`, inline: true },
                                    { name: '💰 Price', value: `**${(0, utils_1.lakhsToDisplay)(session.currentBidLakhs)}**`, inline: true }
                                )
                                .setTimestamp();
                            if (playerAvatar) logEmbed.setThumbnail(playerAvatar);
                            await logChannel.send({ embeds: [logEmbed] });
                        }
                    } catch (e) {
                        console.error("Failed to send to sales log channel:", e);
                    }
                }
                // ---------------------------

                // Find the Loser (Second highest bidder distinct from winner)
                // Iterate backwards through history to find the last bid NOT from the winner
                const winnerId = team.team_id;
                let loserTeamId = null;
                for (let i = session.bidHistory.length - 1; i >= 0; i--) {
                    if (session.bidHistory[i].teamId !== winnerId && session.bidHistory[i].teamId !== null) {
                        loserTeamId = session.bidHistory[i].teamId;
                        break;
                    }
                }
                if (loserTeamId) {
                    const loserTeam = await db.get('SELECT * FROM teams WHERE team_id = ?', loserTeamId);
                    if (loserTeam && session.channel) {
                        const mockGif = this.getRandomMockGif(session);
                        const chan = session.channel;
                        // Send mock message as a reply to the gif
                        setTimeout(async () => {
                            const gifMsg = await chan.send(mockGif);
                            await gifMsg.reply(`Stop crying <@${loserTeam.owner_discord_id}>! Better luck next time! 🤣`);
                        }, 2000); // Small delay for effect
                    }
                }
            }
        }
        else {
            await db.run('UPDATE auction_players SET status = "UNSOLD" WHERE guild_id = ? AND discord_id = ?', guildId, session.activePlayer.discord_id);
            const unsoldEmbed = new discord_js_1.EmbedBuilder()
                .setTitle(`⚪ UNSOLD: ${session.activePlayer.ign}`)
                .setColor(0x808080) // Grey
                .setDescription("No bids were placed.")
                .setFooter({ text: 'Passed' });
            session.channel.send({ embeds: [unsoldEmbed] });
        }
        // Cleanup
        session.activePlayer = null;
        session.currentBidLakhs = 0;
        session.currentHolderId = null;
        await db.run('DELETE FROM auction_ledger WHERE guild_id = ?', guildId);
        // Auto-start next player
        await this.scheduleNextLot(guildId);
    }
    async pause(guildId) {
        const session = this.getSession(guildId);
        session.isPaused = true;
        session.channel?.send("⚠️ Auction PAUSED.");
    }
    async resume(guildId) {
        const session = this.getSession(guildId);
        session.isPaused = false;
        session.channel?.send("▶️ Auction RESUMED.");
        // Resend the embed so it's visible at the bottom
        await this.resendEmbed(guildId);
        if (session.currentHolderId) {
            const timing = await this.getTimingConfig(guildId);
            await this.resetTimer(guildId);
            session.channel?.send(`Timer restarted: ${timing.bidSeconds}s.`);
        }
    }
    async sold(guildId) {
        const session = this.getSession(guildId);
        if (!session.activePlayer) {
            session.channel?.send("No player is currently being auctioned.");
            return;
        }
        if (!session.currentHolderId) {
            session.channel?.send("Cannot finalize sale because there is no leading bid.");
            return;
        }
        await this.finalizeAuction(guildId);
    }
    async pass(guildId) {
        const session = this.getSession(guildId);
        if (!session.activePlayer)
            return;
        if (session.timer)
            clearInterval(session.timer);
        const db = (0, database_1.getDB)();
        await db.run('UPDATE auction_players SET status = "UNSOLD" WHERE guild_id = ? AND discord_id = ?', guildId, session.activePlayer.discord_id);
        session.channel?.send(`Pass! ${session.activePlayer.ign} marked as UNSOLD.`);
        const nextSet = session.currentSetName;
        const nextChan = session.channel;
        session.activePlayer = null;
        await this.scheduleNextLot(guildId);
    }
    async undo(guildId) {
        const session = this.getSession(guildId);
        if (!session.activePlayer)
            return;
        if (session.bidHistory.length === 0) {
            session.channel?.send("No bids to undo (Initial state).");
            return;
        }
        const lastState = session.bidHistory.pop();
        if (!lastState)
            return;
        session.currentBidLakhs = lastState.amount;
        session.currentHolderId = lastState.teamId;
        const db = (0, database_1.getDB)();
        await db.run('UPDATE auction_ledger SET current_bid_lakhs = ?, current_holder_team_id = ? WHERE guild_id = ?', session.currentBidLakhs, session.currentHolderId, guildId);
        let holderName = "None";
        if (session.currentHolderId) {
            const team = await db.get('SELECT * FROM teams WHERE team_id = ?', session.currentHolderId);
            if (team)
                holderName = `${team.team_name} (<@${team.owner_discord_id}>)`;
        }
        const embed = new discord_js_1.EmbedBuilder()
            .setTitle(`↩️ UNDO: Bid Reverted`)
            .setColor(0xFFA500)
            .addFields({ name: 'Player', value: session.activePlayer.ign, inline: true }, { name: 'Current Bid', value: (0, utils_1.lakhsToDisplay)(session.currentBidLakhs), inline: true }, { name: 'Held By', value: holderName, inline: false })
            .setFooter({ text: `⏳ Timer Reset: ${(await this.getTimingConfig(guildId)).bidSeconds} seconds remaining...` });
        if (session.channel) {
            session.timerMessage = await session.channel.send({ embeds: [embed] });
        }
        if (session.currentHolderId) {
            await this.resetTimer(guildId);
        }
        else {
            if (session.timer)
                clearInterval(session.timer);
            session.channel?.send("Waiting for opening bid...");
        }
    }
}
exports.AuctionManager = AuctionManager;
exports.auctionManager = new AuctionManager();
