'use strict';

function formatTime(sec, srt = false) {
    const ms = Math.round(Number(sec) * 1000);
    const h = Math.floor(ms / 3600000);
    const m = Math.floor(ms / 60000) % 60;
    const s = Math.floor(ms / 1000) % 60;
    const two = n => String(n).padStart(2, '0');
    return srt ? `${two(h)}:${two(m)}:${two(s)},${String(ms % 1000).padStart(3, '0')}` : (h ? two(h) + ':' : '') + `${two(m)}:${two(s)}`;
}

function buildTranscript(segments, source, metadata = {}) {
    const lines = segments.filter(s => s && typeof s.text === 'string' && s.text.trim() && Number.isFinite(Number(s.startSec)) && Number(s.startSec)>=0 && Number.isFinite(Number(s.endSec)) && Number(s.endSec) > Number(s.startSec))
        .sort((a, b) => a.startSec - b.startSec).map((s, i) => ({
            index: i + 1, startSec: Number(s.startSec), endSec: Number(s.endSec),
            start: formatTime(s.startSec), end: formatTime(s.endSec), text: s.text.trim()
        }));
    return { transcript: lines, lineCount: lines.length, source, ...metadata,
        plainText: lines.map(s => s.text).join('\n'), fullText: lines.map(s => `[${s.start}] ${s.text}`).join('\n'),
        srtContent: lines.map(s => `${s.index}\n${formatTime(s.startSec, true)} --> ${formatTime(s.endSec, true)}\n${s.text}\n`).join('\n') };
}

function extractiveAnalysis(transcript) {
    const lines = transcript.transcript;
    if (!lines.length) throw new Error('视频没有可分析的字幕或语音');
    const candidates = lines.map((line, index) => ({ line, index, score: Math.min(line.text.length, 120) + (/因为|所以|首先|关键|注意|总结|功能|步骤|建议|最后|原因/.test(line.text) ? 80 : 0) }));
    const chosen = candidates.sort((a, b) => b.score - a.score).slice(0, 6).sort((a, b) => a.index - b.index);
    return {
        method: 'extractive', category: '字幕关键句摘录', summary: chosen.slice(0, 3).map(s => s.line.text).join(' '),
        keyPoints: chosen.map(s => ({ text: s.line.text, quote: s.line.text, startSec: s.line.startSec, endSec: s.line.endSec })),
        recommendations: '当前使用字幕原句摘录。可按时间戳回看关键段落；没有推断画面、镜头或音乐。'
    };
}

function validateAnalysis(data, lines) {
    if (!data || typeof data.summary !== 'string' || !data.summary.trim() || !Array.isArray(data.keyPoints)) throw new Error('分析模型未返回有效结果');
    const points = data.keyPoints.filter(p => Number.isInteger(p.index) && lines[p.index] && typeof p.text === 'string' && p.text.trim()).slice(0, 8).map(p => ({
        text: p.text.slice(0, 500), quote: lines[p.index].text, startSec: lines[p.index].startSec, endSec: lines[p.index].endSec
    }));
    if (!points.length) throw new Error('分析结果缺少可回溯的字幕依据');
    return { category: String(data.category || '内容总结').slice(0, 100), summary: data.summary.slice(0, 1600), keyPoints: points,
        recommendations: (Array.isArray(data.recommendations) ? data.recommendations.filter(s => typeof s === 'string').join('\n') : String(data.recommendations || '')).slice(0, 1600) };
}

function groupAnalysisLines(lines) {
    const blocks = [];
    let group = [];
    const flush = () => {
        if (!group.length) return;
        blocks.push({ startSec: group[0].startSec, endSec: group.at(-1).endSec, text: group.map(s => s.text).join('\n') });
        group = [];
    };
    for (const line of lines) {
        if (group.length && (group.length >= 3 || line.startSec - group.at(-1).endSec > 3 || line.endSec - group[0].startSec > 25)) flush();
        group.push(line);
    }
    flush();
    return blocks;
}

module.exports = { formatTime, buildTranscript, extractiveAnalysis, validateAnalysis, groupAnalysisLines };
