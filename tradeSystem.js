"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tradeSystem = void 0;
const discord_js_1 = require("discord.js");
const database_1 = require("./database");
const utils_1 = require("./utils");

class TradeSystem {
    async proposeTrade(message, args) {
        const db = (0, database_1.getDB)();
        const guildId = message.guild.id;

        // Check if trade window is open
        const settings = await db.get('SELECT * FROM trade_settings WHERE guild_id = ?', guildId);
        if (!settings || !settings.is_open) {
            return message.reply("❌ The Transfer Window is currently **CLOSED**.");
        }

        const mentions = message.mentions.users;
        if (mentions.size < 2) {
            return message.reply("Usage: `?trade @MyPlayer @TheirPlayer` (Tag both players to propose a swap)");
        }

        const playerAUser = mentions.first();
        const playerBUser = mentions.at(1);

        // 1. Identify teams
        const teamA = await db.get('SELECT * FROM teams WHERE guild_id = ? AND owner_discord_id = ?', guildId, message.author.id);
        if (!teamA) return message.reply("❌ You must own a team to propose a trade.");

        const playerA = await db.get('SELECT * FROM auction_players WHERE guild_id = ? AND discord_id = ? AND sold_to_team_id = ?', guildId, playerAUser.id, teamA.team_id);
        if (!playerA) return message.reply(`❌ You do not own **${playerAUser.username}**.`);

        const playerB = await db.get('SELECT * FROM auction_players WHERE guild_id = ? AND discord_id = ? AND sold_to_team_id IS NOT NULL', guildId, playerBUser.id);
        if (!playerB) return message.reply(`❌ **${playerBUser.username}** is not owned by any team.`);
        if (playerB.sold_to_team_id === teamA.team_id) return message.reply("❌ You already own both players!");

        const teamB = await db.get('SELECT * FROM teams WHERE team_id = ?', playerB.sold_to_team_id);

        // 2. Create proposal
        const row = new discord_js_1.ActionRowBuilder().addComponents(
            new discord_js_1.ButtonBuilder().setCustomId(`trade_accept_${playerA.discord_id}_${playerB.discord_id}`).setLabel('Accept Swap').setStyle(discord_js_1.ButtonStyle.Success),
            new discord_js_1.ButtonBuilder().setCustomId(`trade_reject`).setLabel('Reject').setStyle(discord_js_1.ButtonStyle.Danger)
        );

        const embed = new discord_js_1.EmbedBuilder()
            .setTitle("🤝 Trade Proposal")
            .setDescription(`<@${message.author.id}> (Owner of **${teamA.team_name}**) wants to swap players with you!`)
            .addFields(
                { name: `Giving You`, value: `**${playerA.ign}**`, inline: true },
                { name: `Taking From You`, value: `**${playerB.ign}**`, inline: true }
            )
            .setColor(0x00AAFF)
            .setFooter({ text: "Offer expires in 5 minutes." });

        const proposalMsg = await message.channel.send({ 
            content: `<@${teamB.owner_discord_id}>, you have a trade request!`, 
            embeds: [embed], 
            components: [row] 
        });

        // 3. Save to DB
        await db.run('INSERT INTO trades (guild_id, initiator_id, target_owner_id, player_a_id, player_b_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            guildId, message.author.id, teamB.owner_discord_id, playerA.discord_id, playerB.discord_id, 'PENDING', Math.floor(Date.now()/1000));
    }

    async handleInteraction(interaction) {
        const db = (0, database_1.getDB)();
        const guildId = interaction.guildId;

        if (interaction.customId === 'trade_reject') {
            await interaction.update({ content: "❌ Trade Rejected.", embeds: [], components: [] });
            return;
        }

        if (interaction.customId.startsWith('trade_accept_')) {
            await interaction.deferUpdate();
            const parts = interaction.customId.split('_');
            const pAid = parts[2];
            const pBid = parts[3];

            const trade = await db.get('SELECT * FROM trades WHERE guild_id = ? AND player_a_id = ? AND player_b_id = ? AND status = "PENDING"', guildId, pAid, pBid);
            if (!trade) return interaction.editReply({ content: "This trade is no longer valid." });

            if (interaction.user.id !== trade.target_owner_id) {
                return interaction.followUp({ content: "Only the target owner can accept this trade.", flags: discord_js_1.MessageFlags.Ephemeral });
            }

            // Update status to ACCEPTED (Waiting for Admin)
            await db.run('UPDATE trades SET status = "ACCEPTED" WHERE id = ?', trade.id);

            await interaction.editReply({ content: "⏳ Trade accepted by both owners! Waiting for **Admin Approval**.", components: [] });
            // ... (rest of logic)

            // Send to Admin Log
            const settings = await db.get('SELECT log_channel_id FROM trade_settings WHERE guild_id = ?', guildId);
            if (settings && settings.log_channel_id) {
                const logChan = await interaction.guild.channels.fetch(settings.log_channel_id).catch(() => null);
                if (logChan) {
                    const pA = await db.get('SELECT * FROM auction_players WHERE guild_id = ? AND discord_id = ?', guildId, pAid);
                    const pB = await db.get('SELECT * FROM auction_players WHERE guild_id = ? AND discord_id = ?', guildId, pBid);
                    const tA = await db.get('SELECT team_name FROM teams WHERE team_id = ?', pA.sold_to_team_id);
                    const tB = await db.get('SELECT team_name FROM teams WHERE team_id = ?', pB.sold_to_team_id);

                    const adminRow = new discord_js_1.ActionRowBuilder().addComponents(
                        new discord_js_1.ButtonBuilder().setCustomId(`admin_approve_trade_${trade.id}`).setLabel('Approve Trade').setStyle(discord_js_1.ButtonStyle.Success),
                        new discord_js_1.ButtonBuilder().setCustomId(`admin_reject_trade_${trade.id}`).setLabel('Reject').setStyle(discord_js_1.ButtonStyle.Danger)
                    );

                    const adminEmbed = new discord_js_1.EmbedBuilder()
                        .setTitle("⚖️ Admin Approval Required: Trade")
                        .addFields(
                            { name: `Team: ${tA.team_name}`, value: `Giving: **${pA.ign}**`, inline: true },
                            { name: `Team: ${tB.team_name}`, value: `Giving: **${pB.ign}**`, inline: true }
                        )
                        .setColor(0xFFFF00)
                        .setFooter({ text: `Trade ID: ${trade.id}` });

                    await logChan.send({ embeds: [adminEmbed], components: [adminRow] });
                }
            }
        }

        // Admin Actions
        if (interaction.customId.startsWith('admin_approve_trade_') || interaction.customId.startsWith('admin_reject_trade_')) {
            if (!(0, utils_1.isAdmin)(interaction.member)) return interaction.reply({ content: "Admin only.", flags: discord_js_1.MessageFlags.Ephemeral });

            const isApprove = interaction.customId.startsWith('admin_approve_trade_');
            const tradeId = interaction.customId.split('_').pop();
            const trade = await db.get('SELECT * FROM trades WHERE id = ?', tradeId);

            if (!trade || trade.status !== 'ACCEPTED') return interaction.reply({ content: "Trade not found or already processed.", flags: discord_js_1.MessageFlags.Ephemeral });

            if (isApprove) {
                const pA = await db.get('SELECT * FROM auction_players WHERE guild_id = ? AND discord_id = ?', guildId, trade.player_a_id);
                const pB = await db.get('SELECT * FROM auction_players WHERE guild_id = ? AND discord_id = ?', guildId, trade.player_b_id);
                
                const teamAId = pA.sold_to_team_id;
                const teamBId = pB.sold_to_team_id;

                // Execute Swap
                await db.run('UPDATE auction_players SET sold_to_team_id = ? WHERE guild_id = ? AND discord_id = ?', teamBId, guildId, pA.discord_id);
                await db.run('UPDATE auction_players SET sold_to_team_id = ? WHERE guild_id = ? AND discord_id = ?', teamAId, guildId, pB.discord_id);
                
                await db.run('UPDATE trades SET status = "APPROVED" WHERE id = ?', tradeId);
                
                await interaction.update({ content: `✅ Trade #${tradeId} APPROVED and Executed!`, embeds: interaction.message.embeds, components: [] });

                // Public Announcement (to Sales Log)
                const tA = await db.get('SELECT team_name FROM teams WHERE team_id = ?', teamAId);
                const tB = await db.get('SELECT team_name FROM teams WHERE team_id = ?', teamBId);
                
                const announceEmbed = new discord_js_1.EmbedBuilder()
                    .setTitle("🔁 OFFICIAL TRADE COMPLETED")
                    .setDescription(`**${pA.ign}** moves to **${tB.team_name}**\n**${pB.ign}** moves to **${tA.team_name}**`)
                    .setColor(0x00FF00)
                    .setTimestamp();

                // Get Sales Log Channel
                const gSettings = await db.get('SELECT sales_log_channel_id FROM guild_settings WHERE guild_id = ?', guildId);
                if (gSettings && gSettings.sales_log_channel_id) {
                    const announceChan = await interaction.guild.channels.fetch(gSettings.sales_log_channel_id).catch(() => null);
                    if (announceChan) {
                        await announceChan.send({ embeds: [announceEmbed] });
                    } else {
                        await interaction.channel.send({ embeds: [announceEmbed] });
                    }
                } else {
                    await interaction.channel.send({ embeds: [announceEmbed] });
                }
            } else {
                await db.run('UPDATE trades SET status = "REJECTED" WHERE id = ?', tradeId);
                await interaction.update({ content: `❌ Trade #${tradeId} REJECTED by Admin.`, embeds: interaction.message.embeds, components: [] });
            }
        }
    }

    async config(message, args) {
        if (!(0, utils_1.isAdmin)(message.member)) return message.reply("Admin only.");
        const db = (0, database_1.getDB)();
        const guildId = message.guild.id;

        if (args[0] === 'on' || args[0] === 'open') {
            const logChan = message.mentions.channels.first() || message.channel;
            await db.run('INSERT INTO trade_settings (guild_id, is_open, log_channel_id) VALUES (?, 1, ?) ON CONFLICT(guild_id) DO UPDATE SET is_open = 1, log_channel_id = ?', guildId, logChan.id, logChan.id);
            return message.reply(`✅ **Transfer Window is now OPEN!** Log channel set to <#${logChan.id}>.`);
        } else if (args[0] === 'off' || args[0] === 'close') {
            await db.run('UPDATE trade_settings SET is_open = 0 WHERE guild_id = ?', guildId);
            return message.reply("🛑 **Transfer Window is now CLOSED.**");
        } else {
            return message.reply("Usage: `?tradeconfig open [#channel]` or `?tradeconfig close`.");
        }
    }
}

exports.tradeSystem = new TradeSystem();
