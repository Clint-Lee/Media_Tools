'use strict';

// 抖音真实播放量补全：网页端匿名访问的 statistics.play_count 是隐藏计数占位（恒 0）。
// 若本机已保存抖音登录态（scripts/platform-login.js douyin 或 DOUYIN_COOKIE），
// 则在浏览器页面上下文里用该会话请求 aweme 详情，读取平台实际返回的播放计数。
const { metricFields } = require('./metric-evidence');
const { douyinViews } = require('./public-view-evidence');

const MAX_CONCURRENCY = 2;
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

function createClient({ withPage, sessions = require('./platform-session'), now = Date.now } = {}) {
    const cache = new Map(), attempts = new Map(), pending = new Map();
    let job = null;
    const COOLDOWN = 60000;

    function configured() {
        return Boolean(sessions.configured('douyin'));
    }
    function peek(id) {
        const row = cache.get(id);
        if (!row || now() - row.fetchedAt >= 300000) return null;
        cache.delete(id); cache.set(id, row);
        return row;
    }
    async function fetchDetail(id) {
        return withPage('douyin', async page => {
            const cookies = sessions.browserCookies('douyin');
            if (cookies.length) await page.setCookie(...cookies);
            const payloads = await page.evaluate(async paths => {
                const out = [];
                for (const path of paths) {
                    try {
                        const response = await fetch(path, { credentials: 'include', headers: { 'Accept': 'application/json', 'Referer': 'https://www.douyin.com/video/' } });
                        out.push({ status: response.status, text: await response.text() });
                    } catch (error) { out.push({ error: String(error) }); }
                }
                return out;
            }, DETAIL_PATHS.map(build => build(id)));
            for (const payload of payloads) {
                if (payload.error || payload.status !== 200 || !payload.text) continue;
                let data;
                try { data = JSON.parse(payload.text); } catch { continue; }
                const aweme = collectAwemes(data).find(item => String(item.aweme_id) === String(id));
                if (!aweme) continue;
                const stats = aweme.statistics || {};
                const play = Number.isFinite(stats.play_count) && stats.play_count >= 0 ? stats.play_count : null;
                return { id, play, digg: stats.digg_count ?? null, fetchedAt: now(), source: 'douyin:aweme-detail-login' };
            }
            return null;
        }, { anonymous: false });
    }
    async function enrich(list) {
        if (!configured() || job) return { applied: 0, pending: 0 };
        const targets = list.filter(video => /^\d{15,22}$/.test(video.id) && !peek(video.id)
            && !pending.has(video.id) && now() - (attempts.get(video.id) || 0) > COOLDOWN).slice(0, 12);
        if (!targets.length) return { applied: 0, pending: pending.size };
        const job2 = { ids: new Set(targets.map(video => video.id)) };
        job = job2;
        job2.promise = (async () => {
            await Promise.all([...job2.ids].map(async id => {
                try {
                    const detail = await fetchDetail(id);
                    if (detail && detail.play != null && detail.play > 0) { cache.set(id, detail); if (cache.size > 200) cache.delete(cache.keys().next().value); }
                    else attempts.set(id, now());
                } catch { attempts.set(id, now()); }
            }));
        })().finally(() => { if (job === job2) job = null; });
        await job2.promise;
        return { applied: cache.size, pending: 0 };
    }
    function apply(list) {
        return list.map(video => {
            const detail = peek(video.id);
            if (!detail) return video;
            const at = detail.fetchedAt;
            const observation = detail.play > 0
                ? { ...metricFields('views', detail.play), viewSource: detail.source, viewsFetchedAt: at,
                    viewEvidence: { status: 'verified', source: detail.source, field: 'statistics.play_count', observedAt: at } }
                : douyinViews({ aweme_id: video.id, statistics: { play_count: detail.play } }, at);
            return { ...video, ...observation, ...(detail.digg != null ? { likeRaw: detail.digg } : {}),
                metricRaw: observation.playRaw, source: detail.source, fetchedAt: video.fetchedAt };
        });
    }
    function status() { return { configured: configured(), cached: [...cache.values()].filter(row => now() - row.fetchedAt < 300000).length, pending: pending.size }; }
    return { configured, enrich, apply, status, peek };
}

module.exports = { ...createClient(), createClient, collectAwemes };
