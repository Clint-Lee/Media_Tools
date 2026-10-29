'use strict';
const { metricFields } = require('./metric-evidence');

// 接收提取器实际返回的独立计数字段，绝不从点赞、互动合计或曝光量推算播放。
function fromMetadata(info, { platform, source = 'yt-dlp:metadata', at = Date.now() } = {}) {
    const viewsAt = Number.isFinite(info.views_fetched_at) && info.views_fetched_at > 0 ? info.views_fetched_at : at;
    const views = metricFields('views', info.view_count_text ?? info.view_count);
    let status = views.playRaw === null ? 'not-provided' : 'verified';
    let postImpressionRaw;
    // yt-dlp 的 TwitterIE 将帖子 result.views.count 映射为 view_count，非视频播放。
    if (platform === 'twitter' && source === 'yt-dlp:metadata') {
        postImpressionRaw = views.playRaw;
        Object.assign(views, metricFields('views', null)); status = 'post-impressions';
    }
    // 抖音 web detail 的零是隐藏占位，yt-dlp 也不会替调用方识别它。
    if (platform === 'douyin' && views.playRaw === 0) {
        Object.assign(views, metricFields('views', null)); status = 'placeholder-zero';
    }
    return {
        ...views, ...metricFields('likes', info.like_count),
        ...metricFields('comments', info.comment_count), ...metricFields('shares', info.repost_count),
        ...metricFields('collects', info.save_count),
        viewSource: source, viewsFetchedAt: viewsAt, likeSource: source, likesFetchedAt: at,
        ...(postImpressionRaw == null ? {} : { postImpressionRaw }),
        viewEvidence: { status, source, field: info.viewCountField || 'view_count', observedAt: viewsAt }
    };
}
module.exports = { fromMetadata };
