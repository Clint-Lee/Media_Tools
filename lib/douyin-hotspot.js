'use strict';

// 抖音热点视频榜：从官网 /hot 页面真实 XHR（/aweme/v1/web/channel/hotspot）采集 aweme 实体。
// 匿名 Web 端 statistics.play_count 恒为 0（平台隐藏计数），这里如实标注为未公开，
// 点赞等独立公开计数保留展示，绝不自动代替所选播放指标。
const { prepareVideoList } = require('./video-pipeline');
const { douyinViews } = require('./public-view-evidence');
const { matchesCategory, matchesQuery } = require('./video-categories');

function collectAwemes(data, out = [], seen = new Set()) {
    if (!data || typeof data !== 'object' || seen.has(data)) return out;
    seen.add(data);
    if (data.aweme_id && data.video && data.author) { out.push(data); return out; }
    for (const value of Object.values(data)) if (value && typeof value === 'object') collectAwemes(value, out, seen);
    return out;
}

function hotspotVideo(aweme, fetchedAt = Date.now()) {
    if (!/^\d{15,22}$/.test(String(aweme.aweme_id)) || !aweme.video || !aweme.author) return null;
    const stats = aweme.statistics || {};
    // 播放量按平台实际返回处理：0 是隐藏计数占位，不是测量值。
    const views = douyinViews(aweme, fetchedAt);
    const digg = Number.isFinite(stats.digg_count) && stats.digg_count >= 0 ? stats.digg_count : null;
    const interact = [digg, stats.comment_count, stats.share_count, stats.collect_count]
        .filter(value => Number.isFinite(value) && value >= 0);
    // 互动总量仅保留为独立信息，不自动参与播放量排名。
    const interactTotal = interact.length ? interact.reduce((sum, value) => sum + value, 0) : null;
    return {
        id: String(aweme.aweme_id), title: aweme.desc || '', description: aweme.desc || '',
        cover: aweme.video.cover?.url_list?.[0] || aweme.video.origin_cover?.url_list?.[0] || '',
        author: aweme.author.nickname || '', authorAvatar: aweme.author.avatar_thumb?.url_list?.[0] || '',
        duration: Math.floor((aweme.video.duration || aweme.duration || 0) / 1000) + '秒',
        pubdate: aweme.create_time || 0, url: 'https://www.douyin.com/video/' + aweme.aweme_id,
        platform: 'douyin', ...views,
        likeRaw: digg, commentCount: stats.comment_count ?? null,
        collectCount: stats.collect_count ?? null, shareCount: stats.share_count ?? null,
        // 独立互动字段，不是播放量或隐式替代指标。
        interactRaw: interactTotal,
        metric: 'views', metricLabel: '播放', metricRaw: views.playRaw,
        source: 'douyin:hotspot-channel', fetchedAt
    };
}

// 页面内抓取：需要先有抖音域下的会话（ttwid 等）才会返回 aweme_list，
// 因此在浏览器页面上下文里直接 fetch 该端点，复用页面 cookie。
const HOTSPOT_PATHS = [
    '/aweme/v1/web/channel/hotspot?device_platform=webapp&aid=6383&channel=channel_pc_web&tag_id=&count=10&Seo-Flag=0&channel_id=99&pc_client_type=1&pc_libra_divert=Windows&support_h265=1&support_dash=0&version_code=170400&version_name=17.4.0'
];

async function fetchHotspotPage(page, { count = 20 } = {}) {
    const paths = HOTSPOT_PATHS.map(path => path.replace('count=10', 'count=' + count));
    const payloads = await page.evaluate(async paths => {
        const results = [];
        for (const path of paths) {
            try {
                const response = await fetch(path, { credentials: 'include', headers: { 'Accept': 'application/json', 'Referer': 'https://www.douyin.com/hot' } });
                results.push({ path, status: response.status, text: await response.text() });
            } catch (error) {
                results.push({ path, error: String(error) });
            }
        }
        return results;
    }, paths);
    const awemes = [];
    for (const payload of payloads) {
        if (payload.error || payload.status !== 200 || !payload.text) continue;
        let data;
        try { data = JSON.parse(payload.text); } catch { continue; }
        if (data.status_code !== 0 && data.status_code != null) continue;
        awemes.push(...collectAwemes(data));
    }
    return awemes;
}

async function hotspotRanking(options = {}, { withPage, memo = async (key, worker) => worker(), refresh = false, now = Date.now } = {}) {
    const { category = 'all', timeRange = 'all', query = '', page = 1 } = options;
    if (page > 1) throw new Error('抖音热点来源尚无可靠继续游标，不支持第2页');
    const batch = await memo('douyin:hotspot:' + category + ':' + page, () => withPage('douyin', async page => {
        await page.goto('https://www.douyin.com/hot', { waitUntil: 'domcontentloaded', timeout: 20000 });
        // 等页面建立匿名会话（ttwid / __ac_nonce）后再请求榜单接口。
        for (let i = 0; i < 10; i++) {
            const ready = await page.evaluate(() => document.cookie.includes('ttwid') || document.cookie.includes('__ac_nonce'));
            if (ready) break;
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        const awemes = await fetchHotspotPage(page, { count: 20 });
        if (!awemes.length) throw new Error('抖音热点视频榜本次未返回可核验作品');
        const unique = [...new Map(awemes.map(aweme => [String(aweme.aweme_id), aweme])).values()];
        return { awemes: unique, fetchedAt: now() };
    }, { anonymous: true }), refresh);

    if (!Number.isFinite(batch.fetchedAt) || batch.fetchedAt <= 0) throw new Error('热点快照缺少原观测时间，请刷新来源后重试');
    const videos = batch.awemes.map(aweme => hotspotVideo(aweme, batch.fetchedAt)).filter(Boolean);
    const filtered = videos.filter(video => matchesQuery(video, query) && matchesCategory(video, category));
    const list = prepareVideoList(filtered, { timeRange, limit: 2000 });
    const hiddenViews = list.filter(video => video.playRaw == null && video.viewEvidence?.status === 'placeholder-zero').length;
    return {
        list,
        source: 'douyin:hotspot-channel',
        hasMore: false,
        scope: {
            kind: 'official-hot-videos', label: '抖音热点视频榜 · 播放量未公开',
            exhaustive: false, metric: 'views', categoryMethod: 'semantic-title'
        },
        coverage: { candidates: videos.length, unique: list.length, hiddenViews },
        partial: true,
        message: '来自抖音官网热点视频榜的真实作品实体（标题、作者、发布时间、点赞/评论/分享/收藏均为平台实际返回）。'
            + '网页端匿名访问不返回播放计数（play_count 恒为 0 是平台的隐藏计数占位，不是零播放），'
            + '未取得播放计数的作品不参与播放量排名，不自动改用互动排序；可显式查看公开点赞。授权配置存在也不保证返回播放量，需逐作品核验。'
    };
}

module.exports = { hotspotRanking, hotspotVideo, collectAwemes, fetchHotspotPage, HOTSPOT_PATHS };
