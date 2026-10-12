'use strict';

// Legacy callers share the same validated parser as the workbench.
const { unifiedParse, extractUrlFromText } = require('./downloader-core');
async function parseUniversalVideo(url) {
    const result = await unifiedParse(url);
    if (!result.success) return result;
    const data = result.data;
    return { ...data, success: true, videoUrl: data.playVideoUrl, originUrl: data.url, description: data.desc };
}
module.exports = { extractUrlFromText, parseUniversalVideo, parseDouyinVideo: parseUniversalVideo,
    parseBilibiliVideo: parseUniversalVideo, parseYouTubeVideo: parseUniversalVideo,
    parseXiaohongshuVideo: parseUniversalVideo, parseKuaishouVideo: parseUniversalVideo };
