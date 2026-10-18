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
        boundedViews: rows.filter(v=>v.viewPrecision==='lower-bound').length,
        boundedLikes: rows.filter(v=>v.likePrecision==='lower-bound').length,
        unverifiedPrecision:rows.filter(v=>v[(sortBy==='likes'?'like':'view')+'Precision']==='unverified').length,
        completeMetadata: rows.filter(v => v.id && v.title && v.url && v.cover).length };
}

module.exports = { videoDataQuality };
