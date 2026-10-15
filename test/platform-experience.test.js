'use strict';
const assert=require('node:assert/strict');
const fs=require('fs'),path=require('path');
const puppeteer=require('puppeteer');
(async()=>{
    const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox']});
    const page=await browser.newPage(),base=process.env.TEST_BASE_URL || 'http://127.0.0.1:4000';
    const evidence=path.join(__dirname,'..','.cache','verification'); fs.mkdirSync(evidence,{recursive:true});
    const errors=[],requests=[]; page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
    await page.setViewport({width:1440,height:1000});
    const ready=()=>page.waitForFunction(()=>document.querySelector('#loader')?.classList.contains('hidden'),{timeout:45000});
    try {
        // 独立临时上下文检验登录助手使用的真实CDP Cookie接口，不访问官网或读取用户浏览器。
        const context=await browser.createBrowserContext(),cookiePage=await context.newPage();
        await cookiePage.setCookie({name:'isolated-login-fixture',value:'fixture-only',domain:'.example.com',path:'/',httpOnly:true});
        const client=await cookiePage.target().createCDPSession(),capture=await client.send('Network.getAllCookies');
        assert.ok(capture.cookies.find(cookie=>cookie.name==='isolated-login-fixture')?.httpOnly);
        await context.close();
        const start=performance.now(); await page.goto(base,{waitUntil:'domcontentloaded'});
        await page.waitForSelector('#cards-grid .video-card',{timeout:45000});
        const firstCardsMs=Math.round(performance.now()-start);
        assert.equal(await page.$$eval('#cards-grid .video-card',rows=>rows.length),30);
        assert.ok(!requests.some(url=>url.includes('globe.gl.min.js')),'首屏不可加载地球库');
        assert.ok(!requests.some(url=>url.includes('fonts.googleapis.com')),'远程字体不可阻塞首屏');
        await page.click('.nav-btn[data-platform="douyin"]'); await ready();
        if(await page.$('#cards-grid:not(.hidden) .video-card')) {
            const ids=await page.$$eval('#cards-grid .video-card',els=>els.map(e=>e.dataset.videoId));
            assert.ok(ids.every(id=>/^\d{15,22}$/.test(id)),'只能展示真实抖音作品编号，不能再使用话题卡片');
        }else assert.ok((await page.$eval('#empty-state',el=>el.textContent)).includes('公开'));
        await page.click('#btn-platform-connect');
        await page.waitForSelector('#platform-connect-modal:not(.hidden)');
        assert.ok((await page.$eval('#platform-connect-modal',el=>el.textContent)).includes('无需注册'));
        await page.click('#close-platform-connect');
        await page.click('.view-switch-btn[data-view="globe"]');
        await page.waitForFunction(()=>Number(document.querySelector('#geo-city-count')?.textContent)>0,{timeout:45000});
        await page.waitForSelector('.geo-city-label',{timeout:30000});
        await page.waitForSelector('.geo-city-label.has-samples',{timeout:10000});
        assert.ok((await page.$eval('.geo-city-label.has-samples',el=>el.textContent)).includes('·'),'实际样本必须在地球上绘出数量，不能只有参考城市名');
        assert.ok((await page.$eval('#geo-source-note',el=>el.textContent)).includes('汇总'));
        assert.ok((await page.$eval('#geo-source-note',el=>el.textContent)).includes('哔哩'));
        const cities=Number(await page.$eval('#geo-city-count',el=>el.textContent));
        const labels=await page.$$eval('.geo-city-label',els=>els.map(el=>el.textContent));
        assert.ok(labels.some(text=>text.includes('北京') || text.includes('上海')),'地球需显示中文城市名');
        await page.waitForSelector('.geo-country-label',{timeout:10000});
        const countryFeatures=await page.evaluate(async()=> (await(await fetch('/vendor/countries.geojson')).json()).features.length);
        assert.ok(countryFeatures>150,'国家分色必须来自实际地理面数据，不是少数手绘圆点');
        const opposite=await page.evaluate(()=>{
            const rows=[...document.querySelectorAll('.geo-city-label')].map(e=>{
                const lat=Number(e.dataset.lat),lng=Number(e.dataset.lng),r=Math.PI/180;
                return {lat,lng,city:e.textContent.split(' · ')[0],visibility:getComputedStyle(e).visibility,dot:Math.sin(lat*r)*Math.sin(31.2*r)+Math.cos(lat*r)*Math.cos(31.2*r)*Math.cos((lng-115.5)*r)};
            });return rows.sort((a,b)=>a.dot-b.dot)[0];
        });
        assert.ok(opposite.dot<0);assert.equal(opposite.visibility,'hidden','背面城市名不可透过地球显示');
        await page.evaluate(city=>[...document.querySelectorAll('.geo-city-label')].find(e=>e.textContent.split(' · ')[0]===city).click(),opposite.city);
        await page.waitForFunction(city=>{const e=[...document.querySelectorAll('.geo-city-label')].find(e=>e.textContent.split(' · ')[0]===city);return e && getComputedStyle(e).visibility==='visible';},{timeout:5000},opposite.city);
        await new Promise(resolve=>setTimeout(resolve,1200));
        assert.equal(await page.evaluate(()=>{const e=[...document.querySelectorAll('.geo-city-label')].find(e=>e.textContent.startsWith('北京'));return e && getComputedStyle(e).visibility;}),'hidden','转向另一面后原来的正面标签应被遮挡');
        await page.evaluate(()=>[...document.querySelectorAll('.geo-city-label')].find(e=>e.textContent.startsWith('北京')).click());
        await new Promise(resolve=>setTimeout(resolve,1200));
        await page.click('#geo-countries');
        await page.waitForFunction(()=>document.querySelectorAll('.geo-country-label').length===0);
        assert.equal(Number(await page.$eval('#geo-city-count',el=>el.textContent)),cities,'地理标签开关不能改变真实视频样本数');
        await page.click('#geo-countries');await page.waitForSelector('.geo-country-label');
        await page.waitForFunction(()=>document.querySelector('#globe-empty').classList.contains('hidden'));
        await page.screenshot({path:path.join(evidence,'geo-city-labels.png')});
        await page.select('#geo-basemap','streets');
        await page.waitForFunction(()=>!document.querySelector('#geo-map-status').textContent.includes('正在连接'),{timeout:10000});
        const basemap=await page.$eval('#geo-map-status',el=>el.textContent);
        if(basemap.includes('街道地图')) assert.ok(await page.$('#geo-attribution:not(.hidden)'));
        else assert.ok(basemap.includes('连接失败'),'网络不可达须明确保留原底图，不显示假成功');
        await page.select('#geo-scope','current');
        await page.waitForFunction(()=>document.querySelector('#geo-source-note').textContent.startsWith('当前平台') || document.querySelector('#geo-coverage').textContent==='源不可用',{timeout:30000});
        if((await page.$eval('#geo-coverage',el=>el.textContent))==='源不可用')assert.equal(await page.$eval('#geo-video-count',el=>el.textContent),'0条','失败后不能残留上个平台统计');
        await page.select('#geo-scope','available');
        await page.waitForFunction(()=>Number(document.querySelector('#geo-city-count').textContent)>0,{timeout:10000});
        const mock=await browser.newPage();await mock.setRequestInterception(true);
        mock.on('request',request=>{
            if(new URL(request.url()).pathname!=='/api/trends')return request.continue();
            request.respond({status:200,contentType:'application/json',body:JSON.stringify({success:true,list:[
                {id:'real-play',title:'隔离用例：真实播放',platform:'抖音',normPlatform:'douyin',playRaw:300,playCount:'300',likeRaw:2,likeDisplay:'2',pubdate:0},
                {id:'no-play',title:'隔离用例：播放未公开',platform:'抖音',normPlatform:'douyin',playRaw:null,playCount:'未公开',likeRaw:9999,likeDisplay:'9,999',pubdate:0}
            ],ranking:{ranked:1,unranked:1},scope:{metric:'views',label:'隔离测试'}})});
        });
        await mock.goto(base,{waitUntil:'domcontentloaded'});await mock.waitForSelector('#cards-grid .video-card');
        assert.equal(await mock.$eval('[data-video-id="no-play"] .card-rank',el=>el.textContent),'未入播放榜');
        assert.ok((await mock.$eval('[data-video-id="no-play"] .card-stats',el=>el.textContent)).includes('未公开 播放'));
        assert.ok((await mock.$eval('[data-video-id="no-play"] .card-secondary-metric',el=>el.textContent)).includes('不用于排名'));
        assert.deepEqual(errors,[]);
        const report={checkedAt:new Date().toISOString(),firstCardsMs,initialCards:30,globeLoadedOnDemand:true,cityCount:cities,labels,basemap,countryFeatures,backfaceOcclusion:true,countryLayerToggle:true,errors};
        fs.writeFileSync(path.join(evidence,'platform-experience-report.json'),JSON.stringify(report,null,2));
        console.log(JSON.stringify({firstCardsMs,cities,labelCount:labels.length,basemap,errors}));
        console.log('Anonymous feeds, unknown-view indicators, guest guide, lazy globe and actual geo samples passed');
    } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
