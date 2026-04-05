"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ADMIN_ROLE_NAME = exports.ADMIN_USER_IDS = void 0;
exports.isAdmin = isAdmin;
exports.isSuperAdmin = isSuperAdmin;
exports.isGlobalAdmin = isGlobalAdmin;
exports.isGlobalManager = isGlobalManager;
exports.loadGlobalManagerCache = loadGlobalManagerCache;
exports.addGlobalManagerToCache = addGlobalManagerToCache;
exports.removeGlobalManagerFromCache = removeGlobalManagerFromCache;
exports.disableGlobalManagerForServer = disableGlobalManagerForServer;
exports.enableGlobalManagerForServer = enableGlobalManagerForServer;
exports.getGlobalManagersList = getGlobalManagersList;
exports.lakhsToDisplay = lakhsToDisplay;
exports.sendAuctionPurchaseDm = sendAuctionPurchaseDm;
exports.parseBidToLakhs = parseBidToLakhs;
exports.askConfirmation = askConfirmation;
exports.buildPagedButtonRow = buildPagedButtonRow;
exports.ADMIN_USER_IDS = ['1007182472401924126', '1429078139350548511'];
exports.ADMIN_ROLE_NAME = 'Auction Admin';
exports.SUPER_ADMIN_ROLE_NAME = 'Auction Super Admin';

let globalManagersCache = new Set();
let disabledGmServersCache = new Set();

async function loadGlobalManagerCache(db) {
    const managers = await db.all('SELECT user_id FROM global_managers');
    const disabled = await db.all('SELECT guild_id FROM disabled_global_manager_servers');
    
    globalManagersCache.clear();
    for (const m of managers) globalManagersCache.add(m.user_id);
    
    disabledGmServersCache.clear();
    for (const d of disabled) disabledGmServersCache.add(d.guild_id);
}

function getGlobalManagersList() {
    return Array.from(globalManagersCache);
}

function addGlobalManagerToCache(userId) {
    globalManagersCache.add(userId);
}

function removeGlobalManagerFromCache(userId) {
    globalManagersCache.delete(userId);
}

function disableGlobalManagerForServer(guildId) {
    disabledGmServersCache.add(guildId);
}

function enableGlobalManagerForServer(guildId) {
    disabledGmServersCache.delete(guildId);
}

function isGlobalAdmin(userId) {
    return exports.ADMIN_USER_IDS.includes(userId);
}

function isGlobalManager(member) {
    if (!member) return false;
    if (isGlobalAdmin(member.id)) return true;
    if (globalManagersCache.has(member.id)) {
        if (member.guild && disabledGmServersCache.has(member.guild.id)) return false;
        return true;
    }
    return false;
}

function isSuperAdmin(member) {
    if (!member) return false;
    if (isGlobalAdmin(member.id)) return true;
    if (isGlobalManager(member)) return true;
    return member.roles.cache.some(r => r.name === exports.SUPER_ADMIN_ROLE_NAME);
}

function isAdmin(member) {
    if (!member) return false;
    if (isGlobalAdmin(member.id)) return true;
    if (isGlobalManager(member)) return true;
    if (member.roles.cache.some(r => r.name === exports.SUPER_ADMIN_ROLE_NAME)) return true;
    return member.roles.cache.some(r => r.name === exports.ADMIN_ROLE_NAME);
}
function lakhsToDisplay(lakhs) {
    if (lakhs >= 100) {
        const cr = lakhs / 100;
        return `${cr.toFixed(2).replace(/\.00$/, '')} CR`;
    }
    else {
        return `${lakhs} L`;
    }
}
function parseBidToLakhs(input) {
    const cleanInput = input.toLowerCase().replace(/\s+/g, '');
    let totalLakhs = 0;
    // Regex for CR and L
    const crMatch = cleanInput.match(/([\d.]+)(cr)/);
    const lMatch = cleanInput.match(/([\d.]+)(l)/);
    // If no unit is specified, strict validation might be tricky.
    // The prompt says "2.5cr -> 250", "40l -> 40". 
    // What about just "40"? Usually assume Lakhs or CR? 
    // The prompt doesn't specify default unit. I will assume valid inputs have units 
    // OR if purely numeric, maybe reject or treat as Lakhs? 
    // Let's stick to units required or handle simple numbers if safe.
    // Spec says: "?bid 2.5cr", "?bid 40l", "?bid 1cr 20l".
    if (!crMatch && !lMatch) {
        // No unit specified. 
        // Logic: Treat as CR by default (e.g., 2 -> 200L, 0.4 -> 40L, 2.2 -> 220L)
        const val = parseFloat(cleanInput);
        if (!isNaN(val)) {
            return Math.round(val * 100);
        }
        return null;
    }
    if (crMatch) {
        totalLakhs += parseFloat(crMatch[1]) * 100;
    }
    if (lMatch) {
        totalLakhs += parseFloat(lMatch[1]);
    }
    // Round to nearest integer to avoid float precision issues (e.g. 2.2 * 100 = 220.00000000000003)
    return Math.round(totalLakhs);
}
const discord_js_1 = require("discord.js");
async function sendAuctionPurchaseDm(client, details) {
    if (!client || !details?.playerDiscordId)
        return false;
    try {
        const user = await client.users.fetch(details.playerDiscordId);
        if (!user)
            return false;
        const ownerUser = details.ownerDiscordId ? await client.users.fetch(details.ownerDiscordId).catch(() => null) : null;
        const buyerAvatarUrl = details.ownerAvatarUrl
            || ownerUser?.displayAvatarURL?.({ extension: 'png', size: 256 })
            || null;
        const embed = new discord_js_1.EmbedBuilder()
            .setColor(0x57F287)
            .setTitle(`You Have Been Bought by ${details.teamName}`)
            .setDescription(`You were added to **${details.teamName}**${details.guildName ? ` in **${details.guildName}**` : ''}.`)
            .addFields({ name: 'Price', value: `**${lakhsToDisplay(details.priceLakhs || 0)}**`, inline: true }, { name: 'Player', value: details.playerName || `<@${details.playerDiscordId}>`, inline: true }, { name: 'Team', value: `**${details.teamName}**`, inline: true })
            .setFooter({ text: details.sourceText || 'Auction Purchase' })
            .setTimestamp();
        if (details.ownerDiscordId) {
            embed.addFields({ name: 'Owner', value: `<@${details.ownerDiscordId}>`, inline: true });
        }
        if (buyerAvatarUrl) {
            embed.setThumbnail(buyerAvatarUrl);
        }
        else if (details.playerAvatarUrl) {
            embed.setThumbnail(details.playerAvatarUrl);
        }
        await user.send({ embeds: [embed] });
        return true;
    }
    catch (_a) {
        return false;
    }
}
async function askConfirmation(message, promptText) {
    const row = new discord_js_1.ActionRowBuilder()
        .addComponents(new discord_js_1.ButtonBuilder()
        .setCustomId('confirm_yes')
        .setLabel('Yes, Do it')
        .setStyle(discord_js_1.ButtonStyle.Danger), new discord_js_1.ButtonBuilder()
        .setCustomId('confirm_no')
        .setLabel('Cancel')
        .setStyle(discord_js_1.ButtonStyle.Secondary));
    const reply = await message.reply({ content: `⚠️ **CONFIRMATION REQUIRED**\n${promptText}`, components: [row] });
    try {
        const confirmation = await reply.awaitMessageComponent({
            componentType: discord_js_1.ComponentType.Button,
            time: 15000,
            filter: (i) => i.user.id === message.author.id
        });
        if (confirmation.customId === 'confirm_yes') {
            await confirmation.update({ content: '✅ Action Confirmed.', components: [] });
            return true;
        }
        else {
            await confirmation.update({ content: '❌ Action Cancelled.', components: [] });
            return false;
        }
    }
    catch (e) {
        await reply.edit({ content: '⏰ Confirmation timed out. Action cancelled.', components: [] });
        return false;
    }
}

function buildPagedButtonRow(prefix, pageIndex, totalPages) {
    return new discord_js_1.ActionRowBuilder().addComponents(
        new discord_js_1.ButtonBuilder()
            .setCustomId(`${prefix}_prev`)
            .setLabel('Previous')
            .setStyle(discord_js_1.ButtonStyle.Secondary)
            .setDisabled(pageIndex === 0),
        new discord_js_1.ButtonBuilder()
            .setCustomId(`${prefix}_next`)
            .setLabel('Next')
            .setStyle(discord_js_1.ButtonStyle.Primary)
            .setDisabled(pageIndex >= totalPages - 1)
    );
}
