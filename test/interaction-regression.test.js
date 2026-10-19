'use strict';
const assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),puppeteer=require('puppeteer');
const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:4000';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
    const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox']});
    const page=await browser.newPage(),errors=[],pages=[],tileLevels=[];
    let firstCalls=0,failStreets=false;
    const video=i=>({id:'fixture-'+i,title:'隔离交互用例 '+i,platform:'哔哩哔哩',normPlatform:'bilibili',playRaw:i===40?5000:1000-i,playCount:String(i===40?5000:1000-i),likeRaw:i*10,likeDisplay:String(i*10),cover:'/cover-placeholder.svg',url:'https://www.bilibili.com/video/BV1xx411c7mD',pubdate:1700000000});
    await page.setViewport({width:1440,height:1000});
    page.on('pageerror',error=>errors.push(error.message));
    // Retain the real renderer instance for assertions without exposing application internals in production.
    await page.evaluateOnNewDocument(()=>{
        let wrapped;
        Object.defineProperty(window,'Globe',{configurable:true,get:()=>wrapped,set:Constructor=>{
            wrapped=new Proxy(Constructor,{construct(target,args){const globe=Reflect.construct(target,args);window.__testGlobe=globe;return globe;}});
        }});
    });
    await page.setRequestInterception(true);
    await page.setCacheEnabled(false);
    page.on('request',request=>{
        const url=new URL(request.url());
        if(url.hostname==='tile.openstreetmap.org' || url.hostname==='server.arcgisonline.com') {
            // Never pan/zoom against the public OSM service from a test bot.
            if(url.hostname==='tile.openstreetmap.org')tileLevels.push(Number(url.pathname.split('/')[1]));
            return request.respond({status:failStreets && url.hostname==='tile.openstreetmap.org'?503:200,contentType:'image/png',headers:{'Access-Control-Allow-Origin':'*'},body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=','base64')});
        }
        if(url.pathname==='/api/trends') {
            const remote=Number(url.searchParams.get('page') || 1);pages.push(remote);
            if(remote===1)firstCalls++;
            const count=remote===1?40:30,offset=remote===1?0:40+(remote-2)*30;
            const sortBy=url.searchParams.get('sort') || 'views';
            const list=Array.from({length:count},(_,i)=>video(offset+i)).map(v=>sortBy==='likes'?{...v,playRaw:null,playCount:'未公开'}:v).sort((a,b)=>require('../public/ranking').compare(a,b,sortBy));
            return request.respond({status:200,contentType:'application/json',body:JSON.stringify({success:true,list,refreshing:remote===1 && firstCalls===1,hasMore:true,nextCursor:'page-'+(remote+1),sourceMessage:'隔离测试',scope:{metric:sortBy,exhaustive:false,label:'隔离交互测试'}})});
        }
        if(url.pathname==='/api/geo-hotspots')return request.respond({status:200,contentType:'application/json',body:JSON.stringify({success:true,list:[{city:'上海',country:'中国',lat:31.23,lng:121.47,count:3,tier:'high',radius:0.5}],cityCatalog:[],platforms:['bilibili'],scope:'available',sampleSize:40,totalSignals:3})});
        return request.continue();
    });
    try {
        const channel=await browser.newPage();
        await channel.setContent('<style>.tabs{width:180px;display:flex;overflow:auto;scroll-behavior:smooth}.tabs button{min-width:140px}</style><div class="tabs"><button>全部</button><button>娱乐</button><button onclick="window.clickedTech=true">科技</button></div>');
        let beforeClick=false;
        assert.equal(await require('../lib/public-browser').clickCategory(channel,['科技'],()=>{beforeClick=true;}),true);
        assert.equal(beforeClick,true);
        assert.equal(await channel.evaluate(()=>window.clickedTech),true,'屏幕外的分区需正常滚动到可见位置再点击，不能默默退回全部分类');
        await channel.close();
        await page.goto(base,{waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>document.querySelectorAll('#cards-grid .video-card').length===30);
        await page.evaluate(()=>{window.keptCard=document.querySelector('[data-video-id="fixture-0"]');});
        assert.ok(await page.$$eval('#cards-grid .card-thumbnail',rows=>rows.every(e=>e.loading==='lazy')));
        // Scrolling an offscreen button into view already triggers the product's infinite scroll.
        // Drive that path directly instead of chasing a button moved by the newly loaded cards.
        await page.$eval('#grid-scroll-area',el=>{el.scrollTop=el.scrollHeight;});
        await page.waitForFunction(()=>document.querySelectorAll('#cards-grid .video-card').length===40);
        await page.$eval('#grid-scroll-area',el=>{el.scrollTop=el.scrollHeight;});
        await page.waitForFunction(()=>document.querySelectorAll('#cards-grid .video-card').length===70);
        assert.equal(await page.$eval('#cards-grid .video-card',e=>e.dataset.videoId),'fixture-40','后续批次高播放必须进入正确位置，不能只追加伪装排序');
        assert.equal(await page.evaluate(()=>window.keptCard===document.querySelector('[data-video-id="fixture-0"]')),true,'重排复用已有卡片，不应清空重建封面');
        assert.equal(await page.$$eval('#cards-grid .video-card',rows=>new Set(rows.map(e=>e.dataset.videoId)).size),70,'重排不能产生重复卡片');
        await pause(500);
        assert.equal(await page.$$eval('#cards-grid .video-card',rows=>rows.length),70,'加载更多后保持已加载的第二页且不发生意外二次闪烁');
        await page.$eval('#grid-scroll-area',el=>{el.scrollTop=el.scrollHeight;});
        await page.waitForFunction(()=>document.querySelectorAll('#cards-grid .video-card').length===100);
        assert.ok(pages.includes(3),'继续加载必须从第三批读取，不能重置游标');
        await page.select('#ranking-metric','likes');
        await page.waitForFunction(()=>document.querySelector('#ranking-scope').textContent.includes('不是播放榜') && document.querySelectorAll('#cards-grid .video-card').length===30);
        assert.ok((await page.$eval('#cards-grid .card-stats',e=>e.textContent)).includes('点赞'));
        await page.$eval('#grid-scroll-area',el=>{el.scrollTop=el.scrollHeight;});
        await page.waitForFunction(()=>document.querySelectorAll('#cards-grid .video-card').length===40);
        assert.ok((await page.$eval('[data-video-id="fixture-0"] .card-rank',e=>e.textContent)).includes('#40'),'零点赞是已公开零值，不是缺指标');
        await page.click('.view-switch-btn[data-view="globe"]');
        await page.waitForFunction(()=>window.__testGlobe && document.querySelectorAll('.geo-country-label').length>0,{timeout:30000});
        assert.ok(await page.evaluate(()=>[...document.querySelectorAll('.geo-country-label')].some(e=>{
            const r=Math.PI/180,lat=Number(e.dataset.lat)*r,lng=Number(e.dataset.lng)*r;
            return Math.sin(lat)*Math.sin(31.2*r)+Math.cos(lat)*Math.cos(31.2*r)*Math.cos(lng-115.5*r)<-0.2 && getComputedStyle(e).visibility==='hidden';
        })),'背面的国家名称不得透过球体显示');
        await page.select('#geo-basemap','streets');
        await page.waitForFunction(()=>document.querySelector('#geo-map-status').textContent.includes('最高19级'));
        const requested=page.waitForRequest(request=>new URL(request.url()).hostname==='tile.openstreetmap.org' && new URL(request.url()).pathname.startsWith('/19/'),{timeout:10000});
        await page.evaluate(()=>{
            const globe=window.__testGlobe;
            globe.pointOfView({lat:31.23,lng:121.47,altitude:0.00002});
            // An instantaneous test camera jump must orient OrbitControls before frustum selection.
            globe.controls().update();globe.pointOfView(globe.pointOfView());
        });
        await requested;
        await page.waitForFunction(()=>window.__testGlobe.polygonsData().length===0);
        assert.equal(await page.evaluate(()=>{const radius=window.__testGlobe.pointRadius();return radius({radius:1})/radius({radius:0.5});}),2,'近景缩小热点时仍须保留数量半径比例');
        assert.ok(tileLevels.includes(19),'真实渲染器必须请求19级，而不是只修改提示文字');
        assert.equal(await page.$$eval('.geo-country-label',rows=>rows.length),0,'街道近景不可显示悬空的粗粒度国家层');
        await page.click('#geo-reset-view');
        await page.waitForFunction(()=>window.__testGlobe.pointOfView().altitude>2 && document.querySelectorAll('.geo-country-label').length>0);
        failStreets=true;await page.select('#geo-basemap','satellite');
        await page.evaluate(()=>window.__testGlobe.pointOfView({lat:-55,lng:-60,altitude:0.2}));
        await page.select('#geo-basemap','streets');
        await page.waitForFunction(()=>document.querySelector('#geo-map-status').textContent.includes('连接失败'));
        assert.equal(await page.$eval('#geo-basemap',e=>e.value),'satellite');
        await page.evaluate(()=>window.__testGlobe.pointOfView({lat:31.23,lng:121.47,altitude:0.06}));await pause(300);
        assert.equal(await page.$eval('#geo-basemap',e=>e.value),'satellite','回退本地底图后放大不应又偷偷切到外部影像');
        await page.waitForFunction(()=>window.__testGlobe.pointOfView().altitude>=0.39);
        assert.deepEqual(errors,[]);
        const directory=path.join(__dirname,'..','.cache','verification');fs.mkdirSync(directory,{recursive:true});
        fs.writeFileSync(path.join(directory,'interaction-regression.json'),JSON.stringify({checkedAt:new Date().toISOString(),isolatedFixtures:true,initialCards:30,loadedPagesPreserved:true,nextPageAfterRefresh:3,higherMetricReordered:true,stableCardNodes:true,explicitMetricToggle:true,zeroLikesRanked:true,tileFailureFallback:true,noAutoUpgrade:true,maxTileZoom:Math.max(...tileLevels),tilesIntercepted:true,errors},null,2));
        await page.screenshot({path:path.join(directory,'globe-oct16-overview.png')});
        console.log('Interaction regressions passed: 30-card lazy batches, page preservation, real renderer z19 requests, country detail visibility and reset (all tiles intercepted)');
    } catch(error) {
        const button=await page.$eval('#btn-load-more',el=>({html:el.outerHTML,rect:el.getBoundingClientRect().toJSON(),parents:[el,...(function*(node){while(node=node.parentElement)yield node;})(el)].map(node=>({tag:node.tagName,classes:node.className,display:getComputedStyle(node).display,height:node.clientHeight}))})).catch(()=>null);
        console.error('Pagination button',button);
        const directory=path.join(__dirname,'..','.cache','verification');fs.mkdirSync(directory,{recursive:true});
        await page.screenshot({path:path.join(directory,'interaction-regression-failure.png')}).catch(()=>{});
        console.error('UI state',await page.evaluate(()=>({cards:document.querySelectorAll('#cards-grid .video-card').length,scope:document.querySelector('#ranking-scope')?.textContent,map:document.querySelector('#geo-map-status')?.textContent,selection:document.querySelector('#geo-basemap')?.value,pov:window.__testGlobe?.pointOfView(),minDistance:window.__testGlobe?.controls().minDistance,empty:document.querySelector('#empty-state')?.textContent})).catch(()=>null),{errors,tileLevels});
        throw error;
    } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
