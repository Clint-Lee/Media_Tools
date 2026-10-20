'use strict';

// YouTube 免 API Key 的公开采集：用浏览器页面上下文调用 innertube search 接口。
// sp=CAMSAhAB 是"按播放量排序"的搜索过滤器；播放量文本形如 "58,212,419次观看"。
// 没有 API Key 时，这条路径提供与 Data API 同源的真实计数（同样是平台公开计数）。
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { metricFields } = require('./metric-evidence');
const { prepareVideoList } = require('./video-pipeline');
const { relativeAge } = require('./youtube-search');
const { matchesCategory, matchesQuery } = require('./video-categories');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
// 播放量排序 + 视频类型过滤（sp 是 protobuf：sortBy=viewCount, type=video）
const POPULAR_FILTER = 'CAMSAhAB';
const UPLOAD_FILTERS = { today: 'EgIIAg%3D%3D', '3days': 'EgIIAggB', '7days': 'EgIIAggC', '1month': 'EgIIAggD', '6months': 'EgIIAggI' };

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
    const clean = String(text || '').replace(/[,，]/g, '').trim();
    const match = clean.match(/(\d+(?:\.\d+)?)\s*([kmb亿万千]?)/i);
    if (!match) return { value: null, precision: 'unknown', text: String(text || ''), lowerBound: null };
    const multiplier = { '': 1, k: 1e3, m: 1e6, b: 1e9, 千: 1e3, 万: 1e4, 亿: 1e8 }[match[2].toLowerCase()];
    const numeric = Number(match[1]) * multiplier;
    return { value: Number.isSafeInteger(numeric) ? numeric : null, precision: match[2] ? 'source-rounded' : 'integer', text: String(text || ''), lowerBound: null };
}

function innertubeVideo(renderer, now = Date.now()) {
    const id = renderer.videoId;
    if (!id || !/^[\w-]{11}$/.test(id)) return null;
    const views = parseViewText(textOf(renderer.viewCountText));
    const published = textOf(renderer.publishedTimeText);
    const age = relativeAge(published);
    const lengthText = textOf(renderer.lengthText);
    const duration = formatDuration(textOf(renderer.lengthText));
    return {
        id, platform: 'youtube', title: textOf(renderer.title),
        description: textOf(renderer.detailText) || textOf(renderer.descriptionSnippet),
        author: textOf(renderer.ownerText) || textOf(renderer.shortBylineText) || textOf(renderer.longBylineText),
        cover: renderer.thumbnail?.thumbnails?.slice(-1)?.[0]?.url || '',
        url: 'https://www.youtube.com/watch?v=' + id, duration,
        // 只把平台明确展示的观看计数写进播放量；不把相对时间或描述文本推算成发布日期。
        ...metricFields('views', views.value),
        viewSource: 'youtube:innertube-search', viewsFetchedAt: now,
        viewEvidence: { status: views.value != null ? 'verified' : 'not-provided', source: 'youtube:innertube-search', field: 'videoRenderer.viewCountText', observedAt: now },
        ...(age ? { pubdate: Math.floor((now - age.seconds * 1000) / 1000), datePrecision: 'approximate' } : {}),
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
        const { query = '', category = 'all', timeRange = 'all', page = 1 } = options;
        const params = (timeRange !== 'all' && UPLOAD_FILTERS[timeRange] ? UPLOAD_FILTERS[timeRange] : POPULAR_FILTER);
        const term = [query, category !== 'all' && !query ? '' : ''].filter(Boolean).join(' ');
        const payload = await withPage('youtube', async page => {
            await page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
            return searchInPage(page, { query: term || '热门视频', params });
        }, { anonymous: true });
        if (payload.status !== 200 || !payload.data) throw new Error('YouTube 公开检索接口返回 ' + payload.status);
        const renderers = walk(payload.data, node => Boolean(node.videoRenderer));
        const videos = renderers.map(renderer => innertubeVideo(renderer.videoRenderer, now())).filter(Boolean);
        const unique = [...new Map(videos.map(video => [video.id, video])).values()];
        if (!unique.length) throw new Error('YouTube 公开检索本次未返回可核验作品');
        // 关键词只在平台已返回的检索结果内匹配，不因为标题未含关键词就丢弃平台按播放量排序给出的结果。
        const matched = unique.filter(video => matchesQuery(video, query) && matchesCategory(video, category));
        const list = prepareVideoList(matched.length ? matched : unique, { timeRange, limit: 2000 });
        return { list, hasMore: page < 5, source: 'youtube:innertube-search',
            scope: { kind: 'public-search-sample', label: '公开检索 · 按播放量排序样本', exhaustive: false, metric: 'views' },
            coverage: { candidates: unique.length, unique: list.length },
            message: 'YouTube 公开检索样本（免 API Key，复用浏览器会话调用平台公开接口），播放量为平台展示的观看计数。'
                + '仅对已检索作品排序，不是全站历史总榜；相对发布时间只用于时效筛选，不作为精确发布日期。' };
    }
    return { search };
}

module.exports = { ...createClient(), createClient, innertubeVideo, parseViewText, searchInPage, POPULAR_FILTER, UPLOAD_FILTERS };
