"use strict";

const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("canvas");

const DEFAULT_TOTS_CONFIG = {
    subtitle: {
        x: 768,
        y: 195,
        size: 32,
        maxWidth: 900,
        color: "#ffd86b",
        stroke: "#14397d",
        lineWidth: 6
    },
    slots: [
        { avatar: { x: 123, y: 338, size: 82 }, name: { x: 123, y: 459, size: 20, maxWidth: 180 } },
        { avatar: { x: 362, y: 338, size: 82 }, name: { x: 362, y: 459, size: 20, maxWidth: 180 } },
        { avatar: { x: 601, y: 338, size: 82 }, name: { x: 601, y: 459, size: 20, maxWidth: 180 } },
        { avatar: { x: 842, y: 338, size: 82 }, name: { x: 842, y: 459, size: 20, maxWidth: 180 } },
        { avatar: { x: 1081, y: 338, size: 82 }, name: { x: 1081, y: 459, size: 20, maxWidth: 180 } },
        { avatar: { x: 1319, y: 338, size: 82 }, name: { x: 1319, y: 459, size: 20, maxWidth: 180 } },
        { avatar: { x: 239, y: 614, size: 82 }, name: { x: 239, y: 735, size: 20, maxWidth: 180 } },
        { avatar: { x: 478, y: 614, size: 82 }, name: { x: 478, y: 735, size: 20, maxWidth: 180 } },
        { avatar: { x: 718, y: 614, size: 82 }, name: { x: 718, y: 735, size: 20, maxWidth: 180 } },
        { avatar: { x: 957, y: 614, size: 82 }, name: { x: 957, y: 735, size: 20, maxWidth: 180 } },
        { avatar: { x: 1197, y: 614, size: 82 }, name: { x: 1197, y: 735, size: 20, maxWidth: 180 } }
    ]
};

const DEFAULT_TOTS_PREVIEW_PLAYERS = [
    { username: "IceVeins", mvp: 342.55, color: "#ef4444" },
    { username: "SpinLord", mvp: 334.80, color: "#22c55e" },
    { username: "Muzzu", mvp: 329.35, color: "#3b82f6" },
    { username: "PowerEdge", mvp: 322.10, color: "#f59e0b" },
    { username: "ClutchBat", mvp: 316.72, color: "#8b5cf6" },
    { username: "YorkerPro", mvp: 311.48, color: "#06b6d4" },
    { username: "GhostPace", mvp: 305.99, color: "#ec4899" },
    { username: "FinisherX", mvp: 299.61, color: "#84cc16" },
    { username: "FieldBoss", mvp: 294.24, color: "#f97316" },
    { username: "NightWatch", mvp: 288.33, color: "#0ea5e9" },
    { username: "SwingKing", mvp: 281.09, color: "#14b8a6" }
];

function cloneTotsConfig(config = DEFAULT_TOTS_CONFIG) {
    return JSON.parse(JSON.stringify(config));
}

const TOTS_LAYOUT_PATH = path.join(__dirname, "totsLayout.json");

function loadStoredTotsConfig() {
    if (!fs.existsSync(TOTS_LAYOUT_PATH)) {
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(TOTS_LAYOUT_PATH, "utf8"));
    } catch (_error) {
        return null;
    }
}

function getDefaultTotsConfig() {
    return cloneTotsConfig(loadStoredTotsConfig() || DEFAULT_TOTS_CONFIG);
}

function getInitials(name) {
    const cleaned = (name || "P")
        .replace(/[^a-z0-9\s]/gi, " ")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    if (cleaned.length === 0) {
        return "P";
    }
    if (cleaned.length === 1) {
        return cleaned[0].slice(0, 2).toUpperCase();
    }
    return `${cleaned[0][0]}${cleaned[1][0]}`.toUpperCase();
}

function fitFontSize(ctx, text, initialSize, maxWidth, family = "sans-serif", minSize = 10) {
    let size = initialSize;
    while (size > minSize) {
        ctx.font = `bold ${size}px ${family}`;
        if (!maxWidth || ctx.measureText(text).width <= maxWidth) {
            break;
        }
        size -= 1;
    }
    return size;
}

function formatTotsUsername(name) {
    const value = String(name || "").trim();
    if (value.length <= 12) {
        return value;
    }
    return `${value.slice(0, 10)}..`;
}

function drawFittedCenteredText(ctx, text, config, family = "sans-serif") {
    const content = String(text || "").trim();
    if (!content) {
        return;
    }

    const size = fitFontSize(ctx, content, config.size, config.maxWidth, family);
    ctx.font = `bold ${size}px ${family}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.strokeStyle = config.stroke || "#0e2f70";
    ctx.lineWidth = config.lineWidth || 5;
    ctx.fillStyle = config.color || "#ffffff";
    ctx.strokeText(content, config.x, config.y);
    ctx.fillText(content, config.x, config.y);
}

async function tryLoadImage(source) {
    if (!source) {
        return null;
    }
    try {
        return await loadImage(source);
    } catch (_error) {
        return null;
    }
}

function drawFallbackAvatar(ctx, player, x, y, radius) {
    const color = player.color || "#2563eb";
    const gradient = ctx.createLinearGradient(x - radius, y - radius, x + radius, y + radius);
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(1, color);

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.restore();

    const initials = getInitials(player.username || player.name || "P");
    const fontSize = Math.max(20, Math.round(radius * 0.7));
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
    ctx.lineWidth = 4;
    ctx.fillStyle = "#ffffff";
    ctx.strokeText(initials, x, y + 2);
    ctx.fillText(initials, x, y + 2);
}

async function drawAvatar(ctx, player, avatarConfig) {
    const radius = avatarConfig.size;
    const image = await tryLoadImage(player.avatarUrl || player.avatarPath || null);

    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarConfig.x, avatarConfig.y, radius, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.clip();

    if (image) {
        ctx.drawImage(image, avatarConfig.x - radius, avatarConfig.y - radius, radius * 2, radius * 2);
    } else {
        drawFallbackAvatar(ctx, player, avatarConfig.x, avatarConfig.y, radius);
    }

    ctx.restore();
}

async function renderTotsImage(players, options = {}) {
    const config = cloneTotsConfig(options.config || getDefaultTotsConfig());
    const templatePath = options.templatePath || path.join(__dirname, "tots.png");
    const subtitle = options.subtitle || "";

    const template = await loadImage(templatePath);
    const canvas = createCanvas(template.width, template.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(template, 0, 0, template.width, template.height);

    if (subtitle) {
        drawFittedCenteredText(ctx, subtitle.toUpperCase(), config.subtitle);
    }

    const slots = config.slots || [];
    for (let index = 0; index < slots.length; index++) {
        const slot = slots[index];
        const player = players[index];
        if (!slot || !player) {
            continue;
        }

        await drawAvatar(ctx, player, slot.avatar);
        drawFittedCenteredText(
            ctx,
            formatTotsUsername(player.username || player.displayName || player.name || `PLAYER ${index + 1}`).toUpperCase(),
            slot.name
        );
    }

    return canvas.toBuffer("image/png");
}

module.exports = {
    DEFAULT_TOTS_CONFIG,
    DEFAULT_TOTS_PREVIEW_PLAYERS,
    TOTS_LAYOUT_PATH,
    cloneTotsConfig,
    getDefaultTotsConfig,
    renderTotsImage
};
