'use strict';

// TikTok Creative Center 公开榜单（2026-10-20 实测）。
// 旧路径 /CreativeOne/Report/CreativeCenterGetTopContentsList 已返回 400；
// 现用前端 bundle 里的 KnowledgeAPI：GetHashtagList / GetSongList / GetCreatorList。
// 这些是平台公开的趋势榜（话题/音乐/达人），不是视频播放榜；
// 播放量仍由 lib/tiktok-views.js 的视频详情页补全。
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { formatHeatChinese } = require('./video-pipeline');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const ORIGIN = 'https://ads.tiktok.com';
const ENDPOINTS = Object.freeze({
    hashtag: { path: '/CreativeOne/KnowledgeAPI/GetHashtagList', referer: ORIGIN + '/creative/creativeCenter/trends/hashtag' },
    song: { path: '/CreativeOne/KnowledgeAPI/GetSongList', referer: ORIGIN + '/creative/creativeCenter/trends/songs' },
    creator: { path: '/CreativeOne/KnowledgeAPI/GetCreatorList', referer: ORIGIN + '/creative/creativeCenter/trends/creators' }
});
const TIME_RANGES = Object.freeze({ '7days': 7, '1month': 30, '3months': 90 });
const REGIONS = Object.freeze({ all: 'US', us: 'US', global: 'GLOBAL' });

function network() {
    return { proxy: false, timeout: 15000, maxContentLength: 6 * 1024 * 1024,
        ...(process.env.MEDIA_PROXY ? { httpsAgent: new HttpsProxyAgent(process.env.MEDIA_PROXY) } : {}) };
}

function latestValue(curve) {
    if (!Array.isArray(curve) || !curve.length) return null;
    // popularityCurve 是 0-100 的归一化热度指数，不是播放量。
    const last = curve[curve.length - 1];
    return Number.isFinite(last?.value) ? last.value : null;
}

function hashtagTopic(item, index, region, timeRange, fetchedAt) {
    const name = item.hashtagName;
    if (!name) return null;
    const popularity = latestValue(item.popularityCurve);
    return {
        id: 'tiktok:' + name, title: '#' + name,
        rank: Number.isFinite(item.rankIndex) ? item.rankIndex : index + 1,
        tag: '热榜',
        // 热度指数只用于话题榜排序，绝不明写成视频播放量。
        heatRaw: popularity, heatDisplay: popularity == null ? '未公开' : formatHeatChinese(popularity),
        worksCount: Number.isFinite(item.publishCnt) ? item.publishCnt : null,
        worksCountDisplay: item.publishCnt == null ? '作品数未公开' : item.publishCnt + '条作品',
        topCreators: (item.topCreators || []).slice(0, 5).map(creator => ({
            nickname: creator.nickname || '', handle: creator.handleName || '',
            followers: creator.followedCnt ?? null, avatar: creator.avatarURL || ''
        })),
        hashtagId: item.hashtagID || '',
        region, timeRange, source: 'tiktok:creative-center-hashtag',
        sourceUrl: ENDPOINTS.hashtag.referer,
        desc: 'TikTok Creative Center 公开话题趋势榜 · 归一化热度指数与平台作品数，不是视频播放量',
        fetchedAt
    };
}

async function fetchRanking(kind, options = {}) {
    const config = ENDPOINTS[kind];
    if (!config) throw new Error('未知的 TikTok Creative Center 榜单类型');
    const timeRange = TIME_RANGES[options.timeRange] || 7;
    const region = REGIONS[options.region] || 'US';
    const response = await axios.post('https://ads.tiktok.com' + config.path, {
        timeRange, countryCode: region, page: options.page || 1, limit: 20
    }, {
        ...network(),
        headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Origin: ORIGIN, Referer: config.referer,
            'Accept-Language': 'en-US,en;q=0.9' },
        validateStatus: null
    });
    if (response.status !== 200) throw new Error('TikTok Creative Center 公开接口返回 ' + response.status);
    const data = response.data;
    if (data?.BaseResp?.StatusCode !== 0) throw new Error('TikTok Creative Center 拒绝请求（' + (data?.BaseResp?.StatusCode || '未知') + '）');
    const items = data.items || data.list || [];
    if (!items.length) throw new Error('TikTok Creative Center 本次未返回话题');
    const list = items.map((item, index) => hashtagTopic(item, index, region, options.timeRange || '7days', Date.now())).filter(Boolean);
    return { list, source: 'tiktok:creative-center-hashtag',
        pagination: data.pagination || null,
        message: 'TikTok Creative Center 公开话题趋势榜（' + region + ' · ' + timeRange + ' 天）：话题热度为平台归一化指数，'
            + '作品数为平台公开计数；两者都不是视频播放量。' };
}

module.exports = { fetchRanking, hashtagTopic, latestValue, ENDPOINTS, TIME_RANGES, REGIONS };
