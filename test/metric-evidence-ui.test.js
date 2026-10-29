'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),puppeteer=require('puppeteer');
const {prepareVideoList}=require('../lib/video-pipeline'),{metricFields}=require('../lib/metric-evidence'),{videoDataQuality}=require('../lib/data-quality');
const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:4000';
const rows=[
    {id:'exact',...metricFields('views',123456789),...metricFields('likes',42),commentCount:0,collectCount:7,shareCount:8},
    {id:'rounded',...metricFields('views','10.5M'),...metricFields('likes','1.2万')},
    {id:'bound',...metricFields('views','1亿+'),...metricFields('likes','10万+')},
    {id:'unknown',playRaw:null,likeRaw:null},
    {id:'estimated',playRaw:900000000,viewPrecision:'estimated',viewEvidence:{status:'estimated'},likeRaw:1},
    {id:'aggregate',playRaw:null,likeRaw:1047,viewEvidence:{status:'aggregate-interactions',reportedValue:1345}},
    {id:'placeholder',playRaw:null,likeRaw:158229,viewEvidence:{status:'placeholder-zero'}}
].map(v=>({...v,title:'隔离精度验证 '+v.id,platform:'bilibili',url:'https://www.bilibili.com/video/'+v.id,cover:'/cover-placeholder.svg',pubdate:1700000000,fetchedAt:Date.now(),source:'isolated-fixture',viewSource:'isolated-view-origin',viewsFetchedAt:1700000000000}));
(async()=>{
    const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox']});
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.setViewport({width:1440,height:1000});await page.setRequestInterception(true);
    page.on('request',request=>{
        const url=new URL(request.url());
        if(!['/api/trends','/api/search'].includes(url.pathname))return request.continue();
        const sortBy=url.searchParams.get('sort') || 'views',list=prepareVideoList(rows,{sortBy});
        return request.respond({status:200,contentType:'application/json',body:JSON.stringify({success:true,list,hasMore:false,scope:{label:'隔离精度测试',metric:sortBy,exhaustive:false},dataQuality:videoDataQuality(list,{sortBy}),sourceMessage:'非真实源的隔离测试数据'})});
    });
    try {
        await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForSelector('#cards-grid .video-card');
        assert.equal(await page.$eval('#cards-grid .video-card',el=>el.dataset.videoId),'exact');
        assert.ok((await page.$eval('[data-video-id="rounded"] .card-stats',el=>el.textContent)).includes('约 10.5M 播放'));
        assert.ok((await page.$eval('[data-video-id="bound"] .card-stats',el=>el.textContent)).includes('1亿+（仅下界）'));
        assert.equal(await page.$eval('[data-video-id="bound"] .card-rank',el=>el.textContent),'仅下界 · 未排名');
        assert.ok((await page.$eval('[data-video-id="bound"] .card-secondary-metric',el=>el.textContent)).includes('10万+（仅下界）'));
        assert.ok((await page.$eval('[data-video-id="unknown"] .card-stats',el=>el.textContent)).includes('未取得 播放'));
        assert.ok((await page.$eval('[data-video-id="exact"] .card-stats',el=>el.title)).includes('isolated-view-origin'));
        assert.ok((await page.$eval('[data-video-id="exact"] .card-details',el=>el.textContent)).includes('0 评论'));
        assert.equal(await page.$$eval('[data-video-id="unknown"] .card-secondary-metric',els=>els.length),0,'缺少互动不得显示伪造的零值');
        assert.ok((await page.$eval('[data-video-id="aggregate"] .card-stats',el=>el.title)).includes('点赞、收藏与评论合计'));
        assert.equal(await page.$eval('[data-video-id="aggregate"] .card-rank',el=>el.textContent),'未入播放榜');
        assert.equal(await page.$eval('[data-video-id="estimated"] .card-rank',el=>el.textContent),'未入播放榜','旧预估不能获得真实播放名次');
        assert.ok(!(await page.$eval('[data-video-id="estimated"] .card-rank',el=>el.title)).includes('真实播放量排名'));
        assert.ok((await page.$eval('[data-video-id="placeholder"] .card-stats',el=>el.title)).includes('零占位'));
        assert.ok((await page.$eval('#ranking-scope',el=>el.textContent)).includes('排序近似'));
        await page.select('#ranking-metric','likes');
        await page.waitForFunction(()=>document.querySelector('#cards-grid .video-card')?.dataset.videoId==='placeholder');
        assert.ok((await page.$eval('[data-video-id="rounded"] .card-stats',el=>el.textContent)).includes('约 1.2万 点赞'));
        assert.equal(await page.$eval('[data-video-id="bound"] .card-rank',el=>el.textContent),'仅下界 · 未排名');
        assert.ok((await page.$eval('[data-video-id="bound"] .card-stats',el=>el.textContent)).includes('10万+（仅下界） 点赞'));
        assert.ok((await page.$eval('#ranking-scope',el=>el.textContent)).includes('1件仅公开下界，不排名'));
        assert.deepEqual(errors,[]);
        const directory=path.join(__dirname,'..','.cache','verification');fs.mkdirSync(directory,{recursive:true});
        await page.screenshot({path:path.join(directory,'metric-evidence-ui.png')});
        fs.writeFileSync(path.join(directory,'metric-evidence-ui.json'),JSON.stringify({checkedAt:new Date().toISOString(),isolatedFixtures:true,rawAbbreviations:true,lowerBoundsNotRanked:true,unknownsNotZero:true,observedSource:true,explicitMetricToggle:true,errors},null,2));
        console.log('Metric UI passed: raw abbreviations, visible lower bounds, no fake ranks/zeros, actual metric provenance and explicit likes');
    }finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
