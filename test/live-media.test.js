'use strict';

// Opt-in integration check. Uses real sources and downloads one short public video.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:4000';
const videoUrl = process.env.TEST_VIDEO_URL || 'https://www.bilibili.com/video/BV1GGaZ6AEzJ';
const artifactDir = path.join(__dirname, '..', '.cache', 'verification');
const python = process.env.MEDIA_PYTHON || path.join(__dirname, '..', '.runtime', 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let cookie='';
async function api(url, body) {
    const response = await fetch(base + url, { headers:{'Content-Type':'application/json',Cookie:cookie},...(body?{method:'POST',body:JSON.stringify(body)}:{}) });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.message || result.error || 'HTTP ' + response.status);
    return result;
}
async function wait(job) {
    let stage;
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
        const current = (await api('/api/media/jobs/' + job.id)).job;
        if (stage !== current.stage) { console.log(job.kind, current.stage, current.message); stage = current.stage; }
        if (current.status === 'complete') return current;
        if (current.status === 'failed') throw new Error(current.error);
        await sleep(1500);
    }
    throw new Error('集成测试超过10分钟');
}
(async () => {
    cookie=(await require('./live-auth').liveAuth(base)).cookie;
    const report = { verifiedAt:new Date().toISOString(), videoUrl, accessMode:process.env.TEST_GUEST==='1'?'anonymous-visitor':'registered-session' };
    const feed = await api('/api/trends?platform=bilibili&category=tech&timeRange=3days&refresh=1');
    const now = Date.now() / 1000;
    assert.ok(feed.list.length >= 30, '科技3天实时样本需至少支持首批30个');
    assert.ok(feed.list.every(v => now-v.pubdate <= 3*86400+5 && v.pubdate <= now+300));
    assert.ok(feed.list.every((v,i) => !i || feed.list[i-1].metricRaw >= v.metricRaw));
    report.bilibili = { count:feed.list.length, source:feed.source, first:feed.list[0] };
    const source = require('../lib/live-sources');
    let official;
    try { official = await source.biliGet('/x/web-interface/view', { bvid:feed.list[0].id }); }
    finally { await source.closeBrowser(); }
    assert.equal(feed.list[0].id, official.bvid);
    assert.equal(feed.list[0].title, official.title, '标题必须属于该作品');
    assert.equal(new URL(feed.list[0].cover).pathname, new URL(official.pic).pathname, '封面必须属于该作品');
    assert.ok(Math.abs(feed.list[0].playRaw-official.stat.view) <= Math.max(1000,official.stat.view*0.02), '播放数须与直接读取的平台详情一致，容许抓取时间差');
    report.bilibili.officialVerification = { bvid:official.bvid, playRaw:official.stat.view, cover:official.pic, title:official.title };
    const coverResponse = await fetch(base+'/api/proxy-image?url='+encodeURIComponent(feed.list[0].cover));
    assert.ok(/^image\/(jpeg|png|webp|avif)/.test(coverResponse.headers.get('content-type') || ''),'封面必须为真正的平台图片而非占位SVG');
    report.bilibili.coverBytes = (await coverResponse.arrayBuffer()).byteLength;
    const topics = await api('/api/topics?platform=douyin&refresh=1');
    assert.ok(topics.list.length > 0);
    assert.ok(topics.list[0].source === 'douyin:hot-search');
    assert.ok(topics.list[0].cover && topics.list[0].heatRaw > 0);
    report.douyin = { count:topics.list.length, first:topics.list[0] };
    console.log('Real sources:', feed.list.length, 'Bili videos;',topics.list.length,'Douyin topics');
    const parsed = (await api('/api/parse', {url:videoUrl})).data;
    assert.ok(parsed.mediaId && parsed.originDownloadVideoUrl);
    const body = {url:parsed.url,mediaId:parsed.mediaId};
    const analyzed = await wait((await api('/api/media/jobs',{...body,kind:'analyze'})).job);
    assert.ok(analyzed.transcript.lineCount > 0);
    assert.ok(analyzed.transcript.srtContent.includes('-->'));
    assert.ok(analyzed.analysis.keyPoints.length > 0);
    assert.ok(analyzed.analysis.keyPoints.every(p=>analyzed.transcript.plainText.includes(p.quote)));
    assert.equal(analyzed.analysis.method, 'local-llm', '必须验证真实本地语义分析，而非摘录兜底');
    report.analysis = analyzed;
    fs.mkdirSync(artifactDir,{recursive:true});
    fs.writeFileSync(path.join(artifactDir,'actual-transcript.srt'),analyzed.transcript.srtContent);
    for (const kind of ['download','audio']) {
        const ready = await wait((await api('/api/media/jobs',{...body,kind})).job);
        assert.ok(ready.downloadUrl);
        if(kind==='download') assert.equal(ready.hasAudio,true);
        const response = await fetch(base+ready.downloadUrl,{headers:{Cookie:cookie}});
        assert.equal(response.status,200);
        const file = path.join(artifactDir,kind==='download'?'actual-video.mp4':'actual-audio.mp3');
        fs.writeFileSync(file,Buffer.from(await response.arrayBuffer()));
        const probe = JSON.parse(execFileSync(python,['-c', 'import av,json,sys; c=av.open(sys.argv[1]); print(json.dumps({"streams":[{"type":s.type,"codec":s.codec_context.name} for s in c.streams]}))',file],{encoding:'utf8',windowsHide:true}));
        assert.ok(probe.streams.some(s=>s.type==='audio'),'下载结果必须有真实音轨');
        if(kind==='download') assert.ok(probe.streams.some(s=>s.type==='video'));
        else assert.ok(probe.streams.some(s=>s.codec.startsWith('mp3')),'MP3必须是真正编码转换而非改扩展名');
        report[kind] = { bytes:fs.statSync(file).size, ...probe };
    }
    fs.writeFileSync(path.join(artifactDir,'live-report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({summary:analyzed.analysis.summary,keyPoints:analyzed.analysis.keyPoints,download:report.download,audio:report.audio}));
    console.log('Live media integration passed. Evidence:',artifactDir);
})().catch(error=>{console.error(error);process.exitCode=1;});
