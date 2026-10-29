'use strict';
const ranking=require('../public/ranking');

function videoDataQuality(list, { stale = false, sortBy='views' } = {}) {
    const rows = Array.isArray(list) ? list : [];
    const withViews = rows.filter(v => ranking.count(v,'views')!==null).length;
    const withLikes = rows.filter(v => ranking.count(v,'likes')!==null).length;
    const withMetrics = rows.filter(v => ranking.count(v,'views')!==null || ranking.count(v,'likes')!==null).length;
    const rankingMetric=sortBy==='likes'?'likes':'views',withRankingMetric=rankingMetric==='likes'?withLikes:withViews;
    return { status: !rows.length ? 'empty' : stale ? 'cached' : !withRankingMetric ? 'metadata-only' : withRankingMetric===rows.length ? 'ready' : 'partial-metrics',
        rankingMetric,withRankingMetric,withoutRankingMetric:rows.length-withRankingMetric,
        videos: rows.length, withViews, withoutViews: rows.length - withViews, withLikes, withMetrics,
        roundedViews: rows.filter(v => v.playRaw != null && v.viewPrecision === 'source-rounded').length,
        roundedLikes: rows.filter(v=>v.likeRaw!=null && v.likePrecision==='source-rounded').length,
        // 旧记录/实验预估只作单独展示，绝不计入真实播放覆盖或名次。
        estimatedViews: rows.filter(v => v.playRaw != null && v.viewPrecision === 'estimated').length,
        boundedViews: rows.filter(v=>v.viewPrecision==='lower-bound').length,
        boundedLikes: rows.filter(v=>v.likePrecision==='lower-bound').length,
        rejectedViewEvidence:{zeroPlaceholders:rows.filter(v=>v.playRaw==null && v.viewEvidence?.status==='placeholder-zero').length,
            interactionAggregates:rows.filter(v=>v.playRaw==null && v.viewEvidence?.status==='aggregate-interactions').length,
            unverifiedSchema:rows.filter(v=>v.playRaw==null && v.viewEvidence?.status==='unverified-schema').length},
        // 图文笔记不是"可疑证据被拒绝"，而是本来就没有视频播放量这个概念，单独统计。
        nonVideoNotes: rows.filter(v=>v.playRaw==null && v.viewEvidence?.status==='note-not-video').length,
        // 只拿到发现流、还没去核验详情记录，与"平台明确不提供"是两件事。
        notCheckedViews: rows.filter(v=>v.playRaw==null && (!v.viewEvidence || v.viewEvidence.status==='not-checked')).length,
        unverifiedPrecision:rows.filter(v=>v[(sortBy==='likes'?'like':'view')+'Precision']==='unverified').length,
        completeMetadata: rows.filter(v => v.id && v.title && v.url && v.cover).length };
}

module.exports = { videoDataQuality };
