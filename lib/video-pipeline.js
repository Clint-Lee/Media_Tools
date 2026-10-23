'use strict';
const ranking=require('../public/ranking');
const evidence=require('./metric-evidence');

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

function parseVideoViews(value) {
    return evidence.readMetric(value,'views').value;
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
    const { timeRange = 'all', now = Math.floor(Date.now() / 1000), limit = 100, sortBy='views', attachMeta = null } = options;
    const maxAge = TIME_RANGE_SECONDS[timeRange] || 0;

    // 两阶段：先只为每条算"排序与去重所需的最小信息"，排序后再构造前 limit 条完整对象。
    // 动机：50K 条时完整构造耗时约 3s（CPU profile 显示 63% 在构造自身、22% 在 GC），
    // 而这些对象最终只返回 30 条。
    // 等价性约束（均已核对）：
    //  - ranking.compare 只读 playRaw / likeRaw / pubdate / id
    //  - 所有过滤（含 pubdate 时效）必须在第一阶段完成，否则会选到过期项
    //  - byId 的覆盖规则保持 "fetchedAt >= 已有" 时后者胜出
    //  - fetchedAt 仍用 raw.fetchedAt || Date.now() 的原语义
    const candidates = new Map();   // key -> { raw, normPlatform, id, pubdate, fetchedAt }
    for (const raw of Array.isArray(list) ? list : []) {
        if (!raw?.title || raw.kind === 'topic' || raw.metric === 'heat' || /hot-search/.test(raw.source || '')) continue;
        const normPlatform = normalizePlatform(raw.platform);
        const id = extractCanonicalId(raw, normPlatform);
        if (!id) continue;
        const pubdate = normalizeTimestamp(raw.pubdate || raw.publishedAt);
        if (maxAge && (!pubdate || pubdate > now + 300 || now - pubdate > maxAge)) continue;
        // 第一阶段只归一化排序真正需要的 views/likes。
        // 5 次指标归一化 + 对象展开在 50K 条时占约 730ms，
        // 而 comments/shares/collects 只用于展示，可留到排序后的 30 条再算。
        const viewMetric = evidence.normalizeMetric(raw, 'views');
        const likeMetric = evidence.normalizeMetric(raw, 'likes');
        const playRaw = viewMetric.playRaw, likeRaw = likeMetric.likeRaw;
        const key = normPlatform + ':' + id;
        // 与旧实现一致：保留原 fetchedAt 兜底语义，后者胜出
        const fetchedAt = raw.fetchedAt || Date.now();
        const entry = { raw, normPlatform, id, pubdate, playRaw, likeRaw, fetchedAt };
        // 不按标题合并不同视频；覆盖规则与旧实现相同（>= 时后者胜出）
        const existing = candidates.get(key);
        if (!existing || fetchedAt >= existing.fetchedAt) candidates.set(key, entry);
    }

    // 排序键与原比较器读取的字段完全一致，直接复用 ranking.compare 保证顺序等价
    const sorted = [...candidates.values()].sort((a, b) => ranking.compare(a, b, sortBy));
    const ordered = sorted.slice(0, limit);

    // 只为最终要返回的条目构造完整展示对象（含其余指标归一化）
    const result = ordered.map(({ raw, normPlatform, id, pubdate, playRaw, likeRaw, fetchedAt }) => {
        // 其余指标只在这 limit 条上归一化，用 Object.assign 合并（比多次对象展开快约 2.4 倍）
        const metrics = Object.assign({},
            evidence.normalizeMetric(raw, 'views'),
            evidence.normalizeMetric(raw, 'likes'),
            evidence.normalizeMetric(raw, 'comments'),
            evidence.normalizeMetric(raw, 'shares'),
            evidence.normalizeMetric(raw, 'collects'));
        const metric = 'views';
        const metricRaw = playRaw;

        const known=ranking.count({playRaw,likeRaw},sortBy)!==null;
        const effectiveMetric=known?ranking.metric(sortBy):'unknown';
        const effectiveLabel=known?(sortBy==='likes'?'点赞':'播放'):'未公开';
        const effectiveIcon=known?(sortBy==='likes'?'fa-heart':'fa-play'):'fa-circle-question';
        const effectiveNote=known?'':'本次未取得当前排行指标，不参与名次';

        return {
            ...raw, ...metrics, id, normPlatform, platform: getPlatformDisplayName(normPlatform), pubdate,
            playRaw, playCount: playRaw === null ? '未公开' : formatHeatChinese(playRaw),
            likeRaw, likeDisplay: likeRaw === null ? '未公开' : formatHeatChinese(likeRaw),
            metric, metricRaw, metricLabel: '播放',
            metricDisplay: metricRaw === null ? '未公开' : formatHeatChinese(metricRaw),
            effectiveMetric, effectiveLabel, effectiveIcon, effectiveNote,
            fetchedAt
        };
    });

    // 由调用方按 id 补回缓存标记与采集时间（索引查询需要），
    // 这样索引层就不必为每条候选展开一个新对象（4.8 万条约 281ms）。
    if (typeof attachMeta === 'function') for (const item of result) attachMeta(item);

    // 附带筛选后的真实总数与"其中已知播放量条数"，便于调用方只构造一页时仍能给出准确统计。
    // 这两项都从已过滤的 candidates 直接统计（playRaw 已在第一阶段算好），接近零成本。
    // 不改变原有"返回数组"的契约：数组本身照常可用，附加属性不参与遍历。
    let filteredKnownViews = 0;
    for (const entry of candidates.values()) if (entry.playRaw !== null) filteredKnownViews++;
    Object.defineProperty(result, 'filteredTotal', { value: sorted.length, enumerable: false });
    Object.defineProperty(result, 'filteredKnownViews', { value: filteredKnownViews, enumerable: false });
    return result;
}

module.exports = {
    TIME_RANGE_SECONDS, normalizePlatform, getPlatformDisplayName, normalizeTimestamp,
    computeDynamicPubdate, parseHeat, parseVideoViews, formatHeatChinese, cleanTitleForDeduplication,
    cleanAuthorForDeduplication, prepareVideoList
};
