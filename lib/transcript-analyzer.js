'use strict';

const { buildTranscript, extractiveAnalysis } = require('./transcript-content');

// A title or description is not a transcript. Call /api/media/jobs with the actual URL.
function generateTranscript(segments) {
    if (!Array.isArray(segments)) throw new Error('字幕必须来自真实字幕轨或语音识别，不能根据标题生成');
    return buildTranscript(segments, 'provided-segments');
}
function analyzeVideoScript(transcript) {
    if (!transcript || !Array.isArray(transcript.transcript)) throw new Error('需要真实字幕；请先完成视频语音识别');
    return extractiveAnalysis(transcript);
}
module.exports = { generateTranscript, analyzeVideoScript };
