'use strict';
const assert = require('node:assert/strict');
const { buildTranscript, formatTime, extractiveAnalysis, validateAnalysis, groupAnalysisLines } = require('../lib/transcript-content');
const { generateTranscript } = require('../lib/transcript-analyzer');
const { douyinVideo, collectAwemes, aggregateGeo } = require('../lib/live-sources');
const { extractUrlFromText } = require('../lib/downloader-core');
const {segmentsFromTrack,chooseTracks}=require('../lib/subtitle-tracks');
assert.deepEqual(segmentsFromTrack({events:[{tStartMs:1000,dDurationMs:2000,segs:[{utf8:'真实'},{utf8:'字幕'}]}]},'json3'),[{startSec:1,endSec:3,text:'真实字幕'}]);
assert.deepEqual(segmentsFromTrack('WEBVTT\n\n00:01.200 --> 00:03.400\n真实字幕','vtt'),[{startSec:1.2,endSec:3.4,text:'真实字幕'}]);
assert.equal(chooseTracks({automaticCaptionTracks:{en:[{url:'https://www.youtube.com/api/timedtext',ext:'json3'}]}})[0].automatic,true);
assert.equal(extractUrlFromText('BV1bW411n7fY'), 'https://www.bilibili.com/video/BV1bW411n7fY');
const transcript = buildTranscript([
    { startSec: 2.125, endSec: 3.45, text: '首先连接设备' },
    { startSec: 0, endSec: 1.25, text: '这是传感器演示' },
    { startSec: 4, endSec: 5, text: '' },
    { startSec: 6, endSec: 5, text: '错误时间' }
], 'local-asr');
assert.equal(transcript.lineCount, 2);
assert.ok(transcript.srtContent.includes('00:00:02,125 --> 00:00:03,450'));
assert.equal(formatTime(59.9999,true),'00:01:00,000');
assert.throws(() => generateTranscript('标题不能是字幕'));
const valid = validateAnalysis({summary:'演示传感器的连接步骤',keyPoints:[{index:1,text:'连接设备'}]}, transcript.transcript);
assert.equal(valid.keyPoints[0].quote,'首先连接设备');
assert.equal(valid.keyPoints[0].startSec,2.125);
assert.throws(()=>validateAnalysis({summary:'没有依据',keyPoints:[{index:99,text:'编造'}]},transcript.transcript));
assert.ok(extractiveAnalysis(transcript).keyPoints.every(p=>transcript.plainText.includes(p.quote)));
assert.equal(groupAnalysisLines(transcript.transcript)[0].text, transcript.plainText);
assert.equal(collectAwemes({word_list:[{group_id:'999999',word:'话题'}]}).length,0,'话题ID不能作为视频ID');
const video = douyinVideo({aweme_id:'123',desc:'视频',author:{nickname:'作者'},video:{cover:{url_list:['https://example.com/actual.jpg']}},create_time:100,statistics:{digg_count:456}});
assert.equal(video.metricRaw,456); assert.equal(video.playRaw,null);
assert.equal(video.id,'123'); assert.equal(video.cover,'https://example.com/actual.jpg');
const geo = aggregateGeo([{id:'1',title:'上海技术视频'},{id:'2',title:'无城市'},{id:'3',title:'上海探店'}]);
assert.equal(geo.length,1); assert.equal(geo[0].count,2); assert.equal(geo[0].samples.length,2);
console.log('transcript/source integrity tests passed');
