'use strict';

// TikTok 真实播放量补全：explore/tag 页的 itemList 只有近似计数，
// 视频详情页内嵌的 __UNIVERSAL_DATA_FOR_REHYDRATION__ 提供平台实际的 stats.playCount。
// 只补全已发现的作品，不借详情页推荐视频冒充。
const { metricFields } = require('./metric-evidence');

const DETAIL_SELECTORS = ['#__UNIVERSAL_DATA_FOR_REHYDRATION__', '#SIGI_STATE'];
const TTL = 300000, MAX_ENTRIES = 300, COOLDOWN = 60000;

function parseDetail(payload, id) {
    if (!payload || typeof payload !== 'object') return null;
    const universal = payload['#__UNIVERSAL_DATA_FOR_REHYDRATION__'];
    const struct = universal?.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct;
    if (struct && String(struct.id) === String(id)) return struct;
    const legacy = payload['#SIGI_STATE']?.ItemModule?.[id];
    if (legacy && String(legacy.id) === String(id)) return legacy;
    return null;
}

function createClient({ withPage, now = Date.now } = {}) {
    const cache = new Map(), attempts = new Map();
    let job = null;

    function peek(id) {
        const row = cache.get(id);
        if (!row || now() - row.fetchedAt >= TTL) return null;
        cache.delete(id); cache.set(id, row);
        return row;
    }
    async function fetchDetail(id) {
        return withPage('tiktok', async page => {
            await page.goto('https://www.tiktok.com/@i/video/' + id, { waitUntil: 'domcontentloaded', timeout: 18000 });
            const payload = await page.evaluate(selectors => {
                const result = {};
                for (const selector of selectors) {
                    const element = document.querySelector(selector);
                    if (!element?.textContent) continue;
                    try { result[selector] = JSON.parse(element.textContent); } catch { /* 页面结构变化时保持未知 */ }
                }
                return result;
            }, DETAIL_SELECTORS).catch(() => null);
            const struct = parseDetail(payload, id);
            if (!struct) return null;
            const stats = struct.stats || {};
            return { id, fetchedAt: now(), source: 'tiktok:public-watch',
                play: Number.isFinite(stats.playCount) && stats.playCount >= 0 ? stats.playCount : null,
                digg: stats.diggCount ?? null, comment: stats.commentCount ?? null, share: stats.shareCount ?? null,
                title: struct.desc || '', author: struct.author?.uniqueId || struct.author?.nickname || '',
                createTime: struct.createTime || 0 };
        }, { anonymous: true });
    }
    async function enrich(list) {
        if (job) return { applied: cache.size, pending: 0 };
        const targets = list.filter(video => /^\d{15,22}$/.test(video.id) && !peek(video.id)
            && now() - (attempts.get(video.id) || 0) > COOLDOWN).slice(0, 8);
        if (!targets.length) return { applied: cache.size, pending: 0 };
        const current = { ids: new Set(targets.map(video => video.id)) };
        job = current;
        current.promise = (async () => {
            for (const video of targets) {
                try {
                    const detail = await fetchDetail(video.id);
                    if (detail && detail.play != null) { cache.set(video.id, detail); if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value); }
                    else attempts.set(video.id, now());
                } catch { attempts.set(video.id, now()); }
            }
        })().finally(() => { if (job === current) job = null; });
        await current.promise;
        return { applied: cache.size, pending: 0 };
    }
    function apply(list) {
        return list.map(video => {
            const detail = peek(video.id);
            if (!detail) return video;
            const at = detail.fetchedAt;
            const views = detail.play != null
                ? { ...metricFields('views', detail.play), viewSource: detail.source, viewsFetchedAt: at,
                    viewEvidence: { status: 'verified', source: detail.source, field: 'itemStruct.stats.playCount', observedAt: at } }
                : { ...metricFields('views', null), viewSource: detail.source, viewsFetchedAt: at,
                    viewEvidence: { status: 'not-provided', source: detail.source, field: 'itemStruct.stats.playCount', observedAt: at } };
            return { ...video, ...views, metricRaw: views.playRaw,
                ...(detail.digg != null ? { likeRaw: detail.digg } : {}),
                ...(detail.comment != null ? { commentCount: detail.comment } : {}),
                ...(detail.share != null ? { shareCount: detail.share } : {}),
                ...(detail.title && detail.title.length > video.title.length ? { title: detail.title } : {}),
                ...(detail.author ? { author: detail.author } : {}),
                ...(detail.createTime && !video.pubdate ? { pubdate: detail.createTime } : {}) };
        });
    }
    function status() { return { cached: [...cache.values()].filter(row => now() - row.fetchedAt < TTL).length, pending: job ? job.ids.size : 0, ttlMs: TTL }; }
    return { enrich, apply, status, peek };
}

module.exports = { ...createClient(), createClient, parseDetail, DETAIL_SELECTORS };
