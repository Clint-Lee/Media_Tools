'use strict';

// 抖音真实播放量补全：网页端匿名访问的 statistics.play_count 是隐藏计数占位（恒 0）。
// 默认使用独立匿名上下文；个人登录态仅允许显式创建的授权客户端选择，配置不保证返回播放。
const { metricFields } = require('./metric-evidence');
const { douyinViews } = require('./public-view-evidence');

const DETAIL_PATHS = [
    id => '/aweme/v1/web/aweme/detail/?device_platform=webapp&aid=6383&channel=channel_pc_web&aweme_id=' + id + '&request_source=600&version_code=170400&version_name=17.4.0',
    id => '/aweme/v1/web/aweme/detail/?device_platform=webapp&aid=6383&channel=channel_pc_web&aweme_id=' + id + '&version_code=170400&version_name=17.4.0'
];

function collectAwemes(data, out = [], seen = new Set()) {
    if (!data || typeof data !== 'object' || seen.has(data)) return out;
    seen.add(data);
    if (data.aweme_id && data.video && data.author) { out.push(data); return out; }
    for (const value of Object.values(data)) if (value && typeof value === 'object') collectAwemes(value, out, seen);
    return out;
}

function createClient({ withPage = (...args) => require('./live-sources').withPage(...args), sessions = require('./platform-session'), now = Date.now,
    allowPersonalSession = false, budgetMs = 6500 } = {}) {
    const queue = require('./view-detail-queue').createQueue({ fetchDetail, accept: detail => detail.play > 0, now, budgetMs, limit: 12, maxEntries: 200 });
    const { enrich, peek } = queue;
    function configured() { return allowPersonalSession && Boolean(sessions.configured('douyin')); }
    async function fetchDetail(id, { signal, timeoutMs }) {
        return withPage('douyin', async page => {
            await page.goto('https://www.douyin.com/video/' + id, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
            const payloads = await page.evaluate(async ({ paths, timeoutMs }) => {
                const out = [];
                const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
                try {
                    for (const path of paths) {
                        try {
                            const response = await fetch(path, { signal: controller.signal, credentials: 'include', headers: { 'Accept': 'application/json' } });
                            out.push({ status: response.status, text: await response.text() });
                        } catch (error) { out.push({ error: String(error) }); }
                    }
                } finally { clearTimeout(timer); }
                return out;
            }, { paths: DETAIL_PATHS.map(build => build(id)), timeoutMs });
            for (const payload of payloads) {
                if (payload.error || payload.status !== 200 || !payload.text) continue;
                let data;
                try { data = JSON.parse(payload.text); } catch { continue; }
                const aweme = collectAwemes(data).find(item => String(item.aweme_id) === String(id));
                if (!aweme) continue;
                const stats = aweme.statistics || {};
                const play = Number.isFinite(stats.play_count) && stats.play_count >= 0 ? stats.play_count : null;
                return { id, play, digg: stats.digg_count ?? null, fetchedAt: now(), source: configured() ? 'douyin:aweme-detail-authorized' : 'douyin:aweme-detail-public' };
            }
            return null;
        }, { anonymous: !configured(), signal, timeoutMs });
    }
    function apply(list) {
        return list.map(video => {
            const detail = peek(video.id);
            if (!detail) return video;
            const at = detail.fetchedAt;
            const useViews = video.playRaw == null || at >= (video.viewsFetchedAt || video.fetchedAt || 0);
            const useLikes = Number.isFinite(detail.digg) && detail.digg >= 0
                && (video.likeRaw == null || at >= (video.likesFetchedAt || video.fetchedAt || 0));
            const observation = detail.play > 0
                ? { ...metricFields('views', detail.play), viewSource: detail.source, viewsFetchedAt: at,
                    viewEvidence: { status: 'verified', source: detail.source, field: 'statistics.play_count', observedAt: at } }
                : douyinViews({ aweme_id: video.id, statistics: { play_count: detail.play } }, at);
            return { ...video, ...(useViews ? { ...observation, metricRaw: observation.playRaw } : {}),
                ...(useLikes ? { ...metricFields('likes', detail.digg), likeSource: detail.source, likesFetchedAt: at } : {}) };
        });
    }
    function status() { return { ...queue.status(), configured: configured(), mode: configured() ? 'authorized' : 'anonymous' }; }
    return { configured, enrich, apply, status, peek };
}

module.exports = { ...createClient(), createClient, collectAwemes };
