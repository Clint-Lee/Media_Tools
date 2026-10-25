'use strict';

// TikTok 真实播放量补全：explore/tag 页的 itemList 只有近似计数，
// 视频详情页内嵌的 __UNIVERSAL_DATA_FOR_REHYDRATION__ 提供平台实际的 stats.playCount。
// 只补全已发现的作品，不借详情页推荐视频冒充。
const { metricFields } = require('./metric-evidence');

const DETAIL_SELECTORS = ['#__UNIVERSAL_DATA_FOR_REHYDRATION__', '#SIGI_STATE'];

function parseDetail(payload, id) {
    if (!payload || typeof payload !== 'object') return null;
    const universal = payload['#__UNIVERSAL_DATA_FOR_REHYDRATION__'];
    const struct = universal?.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct;
    if (struct && String(struct.id) === String(id)) return struct;
    const legacy = payload['#SIGI_STATE']?.ItemModule?.[id];
    if (legacy && String(legacy.id) === String(id)) return legacy;
    return null;
}

function createClient({ withPage = (...args) => require('./live-sources').withPage(...args), now = Date.now, budgetMs = 6500 } = {}) {
    const { enrich, peek, status } = require('./view-detail-queue').createQueue({
        fetchDetail, accept: detail => detail.play != null, now, budgetMs, limit: 8, maxEntries: 300
    });
    async function fetchDetail(id, { signal, timeoutMs }) {
        return withPage('tiktok', async page => {
            await page.goto('https://www.tiktok.com/@i/video/' + id, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
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
        }, { anonymous: true, signal, timeoutMs });
    }
    function apply(list) {
        return list.map(video => {
            const detail = peek(video.id);
            if (!detail) return video;
            const at = detail.fetchedAt;
            const useViews = video.playRaw == null && !Number.isFinite(video.viewsFetchedAt)
                || at >= (Number.isFinite(video.viewsFetchedAt) ? video.viewsFetchedAt : video.fetchedAt || 0);
            const useLikes = Number.isFinite(detail.digg) && detail.digg >= 0
                && (video.likeRaw == null && !Number.isFinite(video.likesFetchedAt)
                    || at >= (Number.isFinite(video.likesFetchedAt) ? video.likesFetchedAt : video.fetchedAt || 0));
            const views = detail.play != null
                ? { ...metricFields('views', detail.play), viewSource: detail.source, viewsFetchedAt: at,
                    viewEvidence: { status: 'verified', source: detail.source, field: 'itemStruct.stats.playCount', observedAt: at } }
                : { ...metricFields('views', null), viewSource: detail.source, viewsFetchedAt: at,
                    viewEvidence: { status: 'not-provided', source: detail.source, field: 'itemStruct.stats.playCount', observedAt: at } };
            return { ...video, ...(useViews ? { ...views, metricRaw: views.playRaw } : {}),
                ...(useLikes ? { ...metricFields('likes', detail.digg), likeSource: detail.source, likesFetchedAt: at } : {}),
                ...(detail.comment != null ? { commentCount: detail.comment } : {}),
                ...(detail.share != null ? { shareCount: detail.share } : {}),
                ...(detail.title && detail.title.length > (video.title || '').length ? { title: detail.title } : {}),
                ...(detail.author ? { author: detail.author } : {}),
                ...(detail.createTime && !video.pubdate ? { pubdate: detail.createTime } : {}) };
        });
    }
    return { enrich, apply, status, peek };
}

module.exports = { ...createClient(), createClient, parseDetail, DETAIL_SELECTORS };
