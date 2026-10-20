'use strict';

// 公开热榜聚合源：无需登录、无需平台凭证的第三方热榜接口。
// 只采集标题/热度/链接等公开字段，不冒充视频播放量。
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { formatHeatChinese } = require('./video-pipeline');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const SOURCES = Object.freeze({
    // 60s API（开源 github.com/vikiboss/60s），直连可用；带 Cloudflare 限流时自动退避。
    '60s-douyin': { name: '抖音热榜', platform: 'douyin', url: 'https://60s.viki.moe/v2/douyin', kind: '60s' },
    '60s-zhihu': { name: '知乎热榜', platform: 'zhihu', url: 'https://60s.viki.moe/v2/zhihu', kind: '60s' },
    '60s-weibo': { name: '微博热搜', platform: 'weibo', url: 'https://60s.viki.moe/v2/weibo', kind: '60s' },
    '60s-bili': { name: 'B站热榜', platform: 'bilibili', url: 'https://60s.viki.moe/v2/bili', kind: '60s' },
    '60s-toutiao': { name: '头条热榜', platform: 'toutiao', url: 'https://60s.viki.moe/v2/toutiao', kind: '60s' },
    '60s-baidu': { name: '百度热搜', platform: 'baidu', url: 'https://60s.viki.moe/v2/baidu/realtime', kind: '60s' },
    '60s-kuaishou': { name: '快手热榜', platform: 'kuaishou', url: 'https://60s.viki.moe/v2/kuaishou', kind: '60s' },
    '60s-xhs': { name: '小红书热榜', platform: 'xiaohongshu', url: 'https://60s.viki.moe/v2/xhs', kind: '60s' }
});

function network() {
    return { proxy: false, timeout: 12000, maxContentLength: 6 * 1024 * 1024,
        ...(process.env.MEDIA_PROXY ? { httpsAgent: new HttpsProxyAgent(process.env.MEDIA_PROXY) } : {}) };
}

function sixtyTopics(payload, platform, source) {
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    return rows.map((row, index) => ({
        id: platform + ':' + (row.link || row.title || index),
        title: String(row.title || '').trim(),
        rank: index + 1,
        // 第三方只提供平台展示的热度值，不标注为播放量。
        heatRaw: Number(row.hot_value) || null,
        heatDisplay: row.hot_value == null ? '未公开' : formatHeatChinese(row.hot_value),
        worksCount: null, worksCountDisplay: '作品数未公开',
        tag: '热榜', cover: row.cover || '',
        eventTime: row.event_time_at || 0,
        link: row.link || '',
        source: source, sourceUrl: SOURCES[source]?.url || '',
        desc: '公开热榜聚合接口 · 平台热度值，不是视频播放量',
        fetchedAt: Date.now()
    })).filter(topic => topic.title);
}

async function fetchSource(key, { refresh = false } = {}) {
    const config = SOURCES[key];
    if (!config) throw new Error('未知热榜来源');
    const response = await axios.get(config.url, {
        ...network(), headers: { 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'zh-CN,zh;q=0.9' }, validateStatus: null
    });
    if (response.status === 429) throw new Error(config.name + '公开接口正在限流，可稍后重试');
    if (response.status !== 200) throw new Error(config.name + '公开接口返回 ' + response.status);
    const list = sixtyTopics(response.data, config.platform, key);
    if (!list.length) throw new Error(config.name + '公开接口未返回话题');
    return { list, source: key, message: config.name + '：来自公开热榜聚合接口的真实话题与平台热度值；热度不是视频播放量。' };
}

function capabilities() {
    return Object.entries(SOURCES).map(([key, config]) => ({
        platform: config.platform, topics: 'public-aggregator', metric: 'heat',
        label: config.name + ' · 公开聚合接口', source: key, exhaustive: false, requiresUserLogin: false
    }));
}

module.exports = { SOURCES, fetchSource, sixtyTopics, capabilities };
