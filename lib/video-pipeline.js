'use strict';

const TIME_RANGE_SECONDS = Object.freeze({
    '3days': 3 * 24 * 60 * 60,
    '7days': 7 * 24 * 60 * 60,
    '1month': 30 * 24 * 60 * 60,
    '6months': 180 * 24 * 60 * 60
});

function normalizePlatform(platform) {
    if (!platform) return 'universal';
    const s = String(platform).trim().toLowerCase();
    if (s.includes('bili') || s.includes('哔哩') || s === 'b站') return 'bilibili';
    if (s.includes('douyin') || s.includes('抖音')) return 'douyin';
    if (s.includes('youtube') || s.includes('油管') || s.includes('yt')) return 'youtube';
    if (s.includes('tiktok')) return 'tiktok';
    if (s.includes('twitter') || s === 'x' || s.includes('推特')) return 'twitter';
    if (s.includes('xiaohongshu') || s.includes('小红书') || s === 'xhs' || s.includes('red')) return 'xiaohongshu';
    if (s.includes('kuaishou') || s.includes('快手') || s === 'ks') return 'kuaishou';
    return s;
}

function getPlatformDisplayName(normPlatform) {
    const map = {
        bilibili: '哔哩哔哩',
        douyin: '抖音',
        youtube: 'YouTube',
        tiktok: 'TikTok',
        twitter: 'Twitter',
        xiaohongshu: '小红书',
        kuaishou: '快手'
    };
    return map[normPlatform] || 'Universal';
}

function parseHeat(value) {
    if (Number.isFinite(value)) return Math.max(0, Number(value));
    if (value === null || value === undefined) return 0;

    const text = String(value).replace(/,/g, '').trim().toLowerCase();
    const match = text.match(/(-?\d+(?:\.\d+)?)\s*([亿万千kmb]?)/i);
    if (!match) return 0;

    const multipliers = {
        '': 1,
        千: 1e3,
        k: 1e3,
        万: 1e4,
        m: 1e6,
        亿: 1e8,
        b: 1e9
    };
    return Math.max(0, Number(match[1]) * (multipliers[match[2].toLowerCase()] || 1));
}

function formatHeatChinese(value) {
    const num = parseHeat(value);
    if (!num || num <= 0) return '0';
    if (num >= 1e8) {
        const yi = num / 1e8;
        return (yi >= 100 ? yi.toFixed(0) : yi.toFixed(1)).replace(/\.0$/, '') + '亿';
    }
    if (num >= 1e4) {
        const wan = num / 1e4;
        return (wan >= 1000 ? wan.toFixed(0) : wan.toFixed(1)).replace(/\.0$/, '') + '万';
    }
    return Math.floor(num).toLocaleString('zh-CN');
}

function normalizeTimestamp(value) {
    if (!value) return 0;
    if (value instanceof Date) return Math.floor(value.getTime() / 1000);

    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
        return Math.floor(numeric > 1e11 ? numeric / 1000 : numeric);
    }

    const parsed = Date.parse(String(value));
    return Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
}

function extractCanonicalId(item, normPlatform) {
    const rawId = String(item.id || '').trim();
    const rawUrl = String(item.url || '').trim();

    if (normPlatform === 'bilibili') {
        const bvMatch = (rawId + ' ' + rawUrl).match(/BV[0-9a-zA-Z]{10}/i);
        if (bvMatch) return bvMatch[0];
        const avMatch = (rawId + ' ' + rawUrl).match(/av\d+/i);
        if (avMatch) return avMatch[0];
    } else if (normPlatform === 'douyin') {
        const dyMatch = (rawId + ' ' + rawUrl).match(/(\d{18,20})/);
        if (dyMatch) return dyMatch[1];
    } else if (normPlatform === 'youtube') {
        const ytMatch = (rawId + ' ' + rawUrl).match(/(?:v=|\/vi?\/|youtu\.be\/|\/shorts\/)([a-zA-Z0-9_-]{11})/);
        if (ytMatch) return ytMatch[1];
    } else if (normPlatform === 'tiktok') {
        const ttMatch = (rawId + ' ' + rawUrl).match(/(?:video\/|\/v\/|\/embed\/)(\d+)/);
        if (ttMatch) return ttMatch[1];
    } else if (normPlatform === 'kuaishou') {
        const ksMatch = (rawId + ' ' + rawUrl).match(/short-video\/([a-zA-Z0-9_-]+)/);
        if (ksMatch) return ksMatch[1];
    }

    if (rawId && !rawId.startsWith('http')) return rawId;
    if (rawUrl) return rawUrl.replace(/[?#].*$/, '');
    return '';
}

function cleanTitleForDeduplication(title) {
    if (!title) return '';
    return String(title)
        .replace(/<[^>]+>/g, '')
        .replace(/#\S+/g, '') // remove hashtags
        .replace(/[【】\[\]\(\)（）「」『』\s\-_:：!！?？,，.。~·/\\|"'`]/g, '')
        .toLowerCase()
        .trim();
}

function cleanAuthorForDeduplication(author) {
    if (!author) return '';
    return String(author)
        .replace(/[【】\[\]\(\)（）\s\-_:：@]/g, '')
        .toLowerCase()
        .trim();
}

function computeDynamicPubdate(relativeDays = 0.5, now = Math.floor(Date.now() / 1000)) {
    return Math.floor(now - (Number(relativeDays) || 0.5) * 86400);
}

function prepareVideoList(list, options = {}) {
    const { timeRange = 'all', now = Math.floor(Date.now() / 1000), limit = 100 } = options;
    const maxAge = TIME_RANGE_SECONDS[timeRange] || 0;
    const byId = new Map();
    for (const raw of Array.isArray(list) ? list : []) {
        if (!raw?.title || raw.kind === 'topic' || raw.metric === 'heat' || /hot-search/.test(raw.source || '')) continue;
        const normPlatform = normalizePlatform(raw.platform);
        const id = extractCanonicalId(raw, normPlatform);
        if (!id) continue;
        const pubdate = normalizeTimestamp(raw.pubdate || raw.publishedAt);
        if (maxAge && (!pubdate || pubdate > now + 300 || now - pubdate > maxAge)) continue;
        const hasPlay = raw.playRaw !== null && raw.playRaw !== undefined
            || raw.playCount !== null && raw.playCount !== undefined && /\d/.test(String(raw.playCount));
        // 原始整数优先，格式化文本存在舍入误差，话题热度/点赞不等于播放量。
        const playRaw = hasPlay ? parseHeat(raw.playRaw ?? raw.playCount) : null;
        const likeValue = raw.likeRaw ?? (raw.metric === 'likes' ? raw.metricRaw : null);
        const likeRaw = likeValue == null ? null : parseHeat(likeValue);
        const metric = 'views';
        const metricRaw = playRaw;
        const item = {
            ...raw, id, normPlatform, platform: getPlatformDisplayName(normPlatform), pubdate,
            playRaw, playCount: playRaw === null ? '未公开' : formatHeatChinese(playRaw),
            likeRaw, likeDisplay: likeRaw === null ? '未公开' : formatHeatChinese(likeRaw),
            metric, metricRaw, metricLabel: '播放',
            metricDisplay: metricRaw === null ? '未公开' : formatHeatChinese(metricRaw),
            fetchedAt: raw.fetchedAt || Date.now()
        };
        const key = normPlatform + ':' + id;
        // 不按标题合并不同视频，否则封面、作者、播放量可能被拼成不存在的作品。
        if (!byId.has(key) || item.fetchedAt >= byId.get(key).fetchedAt) byId.set(key, item);
    }
    return [...byId.values()]
        .sort((a, b) => (a.playRaw === null) - (b.playRaw === null) || (Number(b.playRaw) - Number(a.playRaw)) || b.pubdate - a.pubdate)
        .slice(0, limit);
}

module.exports = {
    TIME_RANGE_SECONDS, normalizePlatform, getPlatformDisplayName, normalizeTimestamp,
    computeDynamicPubdate, parseHeat, formatHeatChinese, cleanTitleForDeduplication,
    cleanAuthorForDeduplication, prepareVideoList
};
