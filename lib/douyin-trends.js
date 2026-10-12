'use strict';

// Compatibility entry point: only verified live videos, never hot-search events as video IDs.
async function fetchDouyinLiveTrends(category = 'all', timeRange = 'all') {
    const result = await require('./live-sources').getVideos({ platform: 'douyin', category, timeRange });
    return result.list;
}
module.exports = { fetchDouyinLiveTrends };
