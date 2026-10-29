'use strict';

// 兼容历史实验的互动推算，默认关闭。没有统计模型校准，不能当作实际播放。
// 仅显式 HOTPOT_ESTIMATED_VIEWS=1 时保留实验展示；任何情况下均不进入真实播放榜。
const { normalizePlatform } = require('./video-pipeline');

const SOURCE = 'hotpot:engagement-estimate';
// 点赞率基准取行业公开量级的中值：抖音约 3%–8%（取 5%），小红书约 2%–5%（取 3.5%）。
// 这不是平台数据；预估值只是排序/展示参考，两条曲线随点赞同序变化。
const MODELS = {
    douyin: { factor: 20, likeRate: 0.05, minLikes: 10 },
    xiaohongshu: { factor: 30, likeRate: 0.035, minLikes: 5 }
};

function enabled() { return process.env.HOTPOT_ESTIMATED_VIEWS === '1'; }

// 保留两位有效数字：预估不该呈现虚假精度（3889×20=77780 → 78000）。
function round2sig(value) {
    if (value <= 0) return 0;
    const magnitude = Math.pow(10, Math.floor(Math.log10(value)) - 1);
    return Math.round(value / magnitude) * magnitude;
}

function estimate(video, at = Date.now()) {
    if (!enabled()) return null;
    const platform = normalizePlatform(video?.normPlatform || video?.platform);
    const model = MODELS[platform];
    if (!model) return null;
    // 已有平台真实（或既有）播放值时绝不覆盖；预估只填充"未知"。
    if (video.playRaw != null) return null;
    const likes = Number.isSafeInteger(video.likeRaw) && video.likeRaw >= 0 ? video.likeRaw : null;
    // 点赞过少时互动率方差过大，推算无意义，保持未知。
    if (likes == null || likes < model.minLikes) return null;
    const value = round2sig(likes * model.factor);
    if (!Number.isSafeInteger(value) || value <= 0) return null;
    const basedOn = { likes };
    for (const [key, field] of [['comments', 'commentCount'], ['shares', 'shareCount'], ['collects', 'collectCount']])
        if (Number.isSafeInteger(video[field]) && video[field] >= 0) basedOn[key] = video[field];
    return {
        playRaw: value, metricRaw: value,
        viewPrecision: 'estimated', viewCountText: '预估',
        viewSource: SOURCE, viewsFetchedAt: at,
        viewEvidence: {
            status: 'estimated', source: SOURCE, field: 'derived:engagement-likes',
            formula: 'likes × ' + model.factor + '（' + platform + ' 互动率基准 ' + (model.likeRate * 100) + '%；预估值，非平台数据）',
            basedOn, observedAt: at
        }
    };
}

function apply(list, at = Date.now()) {
    let estimatedViews = 0;
    const rows = (Array.isArray(list) ? list : []).map(video => {
        const row = estimate(video, at);
        if (!row) return video;
        estimatedViews++;
        return { ...video, ...row };
    });
    return Object.defineProperty(rows, 'estimatedViews', { value: estimatedViews, enumerable: false });
}

function status() {
    return {
        enabled: enabled(),
        models: Object.fromEntries(Object.entries(MODELS).map(([key, model]) =>
            [key, { factor: model.factor, likeRate: model.likeRate, minLikes: model.minLikes }]))
    };
}

module.exports = { estimate, apply, enabled, status, SOURCE };
