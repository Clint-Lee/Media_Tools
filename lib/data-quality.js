'use strict';

function videoDataQuality(list, { stale = false } = {}) {
    const rows = Array.isArray(list) ? list : [];
    const withViews = rows.filter(v => Number.isFinite(v.playRaw) && v.playRaw >= 0).length;
    return { status: !rows.length ? 'empty' : stale ? 'cached' : !withViews ? 'metadata-only' : withViews === rows.length ? 'ready' : 'partial-metrics',
        videos: rows.length, withViews, withoutViews: rows.length - withViews,
        roundedViews: rows.filter(v => v.playRaw != null && v.viewPrecision === 'source-rounded').length,
        completeMetadata: rows.filter(v => v.id && v.title && v.url && v.cover).length };
}

module.exports = { videoDataQuality };
