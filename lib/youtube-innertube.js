'use strict';

// YouTube 免 API Key 的公开采集：用浏览器页面上下文调用 innertube search 接口。
// sp=CAMSAhAB 是"按播放量排序"的搜索过滤器；播放量文本形如 "58,212,419次观看"。
// 没有 API Key 时，这条路径提供与 Data API 同源的真实计数（同样是平台公开计数）。
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { readMetric } = require('./metric-evidence');
const { prepareVideoList, TIME_RANGE_SECONDS } = require('./video-pipeline');
const { relativeAge, searchFilter } = require('./youtube-search');
const { matchesCategory, matchesQuery } = require('./video-categories');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
// 播放量排序 + 视频类型过滤（sp 是 protobuf：sortBy=viewCount, type=video）
const POPULAR_FILTER = searchFilter('all');
const UPLOAD_FILTERS = Object.freeze(Object.fromEntries(['today', '3days', '7days', '1month', '6months'].map(range => [range, searchFilter(range)])));
const CATEGORY_TERMS = { comedy: 'comedy', ent: 'entertainment', fashion: 'fashion', pets: 'pets', wildlife: 'wildlife', animal: 'animals', tech: 'science and technology', marketing: 'business marketing', kuso: 'meme remix' };

function walk(data, predicate, out = [], seen = new Set()) {
    if (!data || typeof data !== 'object' || seen.has(data)) return out;
    seen.add(data);
    if (predicate(data)) { out.push(data); return out; }
    for (const value of Object.values(data)) if (value && typeof value === 'object') walk(value, predicate, out, seen);
    return out;
}

function textOf(node) {
    if (!node) return '';
    if (typeof node === 'string') return node;
    if (node.simpleText) return node.simpleText;
    if (Array.isArray(node.runs)) return node.runs.map(run => run.text || '').join('');
    return '';
}

// lengthText 可能是 "3:45" / "12:05" / ISO8601 "PT3M45S" / 秒数字符串
function formatDuration(text) {
    const clean = String(text || '').trim();
    if (!clean) return '';
    if (/^\d+$/.test(clean)) return Math.floor(Number(clean) / 60) + ':' + String(Number(clean) % 60).padStart(2, '0');
    const iso = clean.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (iso && (iso[1] || iso[2] || iso[3])) {
        const seconds = Number(iso[1] || 0) * 3600 + Number(iso[2] || 0) * 60 + Number(iso[3] || 0);
        return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
    }
    return clean;
}

// 播放量文本 "58,212,419次观看" / "1.2M views" → 精确计数或下界
function parseViewText(text) {
    const original = String(text || '').trim();
    const reading = readMetric(original.replace(/，/g, ','), 'views');
    return reading.precision === 'unknown' ? reading : { ...reading, text: original };
}

function innertubeVideo(renderer, now = Date.now()) {
    const id = renderer.videoId;
    if (!id || !/^[\w-]{11}$/.test(id)) return null;
    const views = parseViewText(textOf(renderer.viewCountText));
    const published = textOf(renderer.publishedTimeText);
    const age = relativeAge(published);
    const duration = formatDuration(textOf(renderer.lengthText));
    return {
        id, platform: 'youtube', title: textOf(renderer.title),
        description: textOf(renderer.detailText) || textOf(renderer.descriptionSnippet),
        author: textOf(renderer.ownerText) || textOf(renderer.shortBylineText) || textOf(renderer.longBylineText),
        cover: renderer.thumbnail?.thumbnails?.slice(-1)?.[0]?.url || '',
        url: 'https://www.youtube.com/watch?v=' + id, duration,
        // 只读取平台明确展示的观看计数；相对日期保留误差边界，不冒充精确时刻。
        playRaw: views.value, viewPrecision: views.precision, viewCountText: views.text, viewLowerBound: views.lowerBound,
        viewSource: 'youtube:innertube-search', viewsFetchedAt: now,
        viewEvidence: { status: views.value != null ? 'verified' : views.precision === 'lower-bound' ? 'lower-bound' : 'not-provided', source: 'youtube:innertube-search', field: 'videoRenderer.viewCountText', observedAt: now },
        ...(age ? { pubdate: Math.floor((now - age.seconds * 1000) / 1000), datePrecision: 'relative' } : {}),
        publishedAgeUpperBound: age?.upperSeconds ?? null,
        publishedDisplay: published, source: 'youtube:innertube-search', fetchedAt: now
    };
}

// 页面内调用 innertube：复用真实浏览器会话，不手工拼签名。
async function searchInPage(page, { query, params, continuation = null }) {
    return page.evaluate(async ({ query, params, continuation }) => {
        const body = {
            context: { client: { clientName: 'WEB', clientVersion: '2.20240101.00.00', hl: 'zh-CN', gl: 'US' } },
            ...(continuation ? { continuation } : { query, params })
        };
        const endpoint = continuation ? 'search' : 'search';
        const response = await fetch('https://www.youtube.com/youtubei/v1/' + endpoint + '?prettyPrint=false', {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        if (!response.ok) return { status: response.status, data: null };
        return { status: response.status, data: await response.json() };
    }, { query, params, continuation });
}

function createClient({ withPage, now = Date.now } = {}) {
    async function search(options, { refresh = false } = {}) {
        const { query = '', category = 'all', timeRange = 'all', page = 1, cursor = '' } = options;
        if (page > 1 || cursor) throw new Error('YouTube 公开检索尚未接通可靠的继续翻页，请配置 YOUTUBE_API_KEY 使用官方翻页。');
        const params = searchFilter(timeRange);
        const term = [query, category !== 'all' ? CATEGORY_TERMS[category] : ''].filter(Boolean).join(' ');
        const payload = await withPage('youtube', async page => {
            await page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
            return searchInPage(page, { query: term || '热门视频', params });
        }, { anonymous: true });
        if (payload.status !== 200 || !payload.data) throw new Error('YouTube 公开检索接口返回 ' + payload.status);
        const renderers = walk(payload.data, node => Boolean(node.videoRenderer));
        const observedAt = now();
        const videos = renderers.map(renderer => innertubeVideo(renderer.videoRenderer, observedAt)).filter(Boolean);
        const unique = [...new Map(videos.map(video => [video.id, video])).values()];
        if (!unique.length) throw new Error('YouTube 公开检索本次未返回可核验作品');
        // 相对日期可能跨越所选窗口，只有上界仍在窗口内的作品才进入时效榜。
        const maxAge = timeRange === 'today' ? 86400 : TIME_RANGE_SECONDS[timeRange] || 0;
        const matched = unique.filter(video => matchesQuery(video, query) && matchesCategory(video, category)
            && (!maxAge || video.publishedAgeUpperBound !== null && video.publishedAgeUpperBound <= maxAge));
        const list = prepareVideoList(matched, { timeRange, now: Math.floor(observedAt / 1000), limit: 2000 });
        return { list, hasMore: false, nextCursor: '', source: 'youtube:innertube-search',
            scope: { kind: 'public-search-sample', label: '公开检索 · 按播放量排序样本', exhaustive: false, metric: 'views' },
            coverage: { candidates: unique.length, unique: list.length },
            message: 'YouTube 公开检索样本（免 API Key，复用浏览器会话调用平台公开接口），播放量为平台展示的观看计数。'
                + '仅对已检索作品排序，不是全站历史总榜；相对发布时间采用保守边界筛选，不作为精确发布日期。当前公开路径仅提供本批样本，不宣称支持继续翻页。' };
    }
    return { search };
}

module.exports = { ...createClient(), createClient, innertubeVideo, parseViewText, searchInPage, POPULAR_FILTER, UPLOAD_FILTERS };
