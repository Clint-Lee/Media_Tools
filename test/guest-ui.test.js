'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const puppeteer=require('puppeteer');
(async()=>{
    const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox']}),page=await browser.newPage();
    const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:4000',errors=[];
    page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1440,height:1000});
    try {
        await page.goto(base,{waitUntil:'domcontentloaded'});
        assert.equal(await page.evaluate(async()=> (await fetch('/api/auth/me')).status),401);
        assert.ok((await page.cookies()).some(c=>c.name==='hotpot_visitor' && c.httpOnly));
        await page.click('#btn-nav-mediatools');
        await page.type('#mt-input-url','https://www.bilibili.com/video/BV1GGaZ6AEzJ');await page.click('#mt-extract-btn');
        await page.waitForSelector('#mt-bili-frame',{timeout:45000});
        assert.equal(await page.$eval('#auth-modal',e=>e.classList.contains('hidden')),true,'公开媒体处理不可弹出注册/登录门槛');
        await page.waitForFunction(()=>document.querySelector('#mt-analysis-status').textContent.startsWith('完成'),{timeout:180000});
        assert.ok((await page.$eval('#mt-transcript-timeline',e=>e.textContent)).includes('手机壳'));
        const result=await page.evaluate(()=>({lines:document.querySelectorAll('#mt-transcript-timeline .transcript-line-item').length,status:document.querySelector('#mt-analysis-status').textContent,quota:document.querySelector('#mt-visitor-status').textContent}));
        assert.ok(result.lines>0);assert.ok(result.quota.includes('免登录访客'));
        await page.click('#mt-btn-download-mp4');
        await page.waitForFunction(()=>!document.querySelector('#mt-btn-download-mp4').disabled,{timeout:90000});
        const native=await page.$eval('#mt-native-video',e=>e.src);assert.ok(native.includes('/api/media/jobs/') && native.endsWith('/file'));
        assert.equal(await page.evaluate(async()=> (await fetch('/api/auth/me')).status),401,'全程不能偷偷创建/登录演示账号');
        const history=await page.evaluate(async()=> (await(await fetch('/api/media/history')).json()));
        assert.equal(history.visitor,true);assert.ok(history.list.some(item=>item.kind==='download' && item.status==='prepared'));
        const other=await browser.createBrowserContext(),otherPage=await other.newPage();await otherPage.goto(base,{waitUntil:'domcontentloaded'});
        assert.equal(await otherPage.evaluate(async url=>(await fetch(url)).status,native),404,'另一临时设备不能读取访客结果');await other.close();
        assert.deepEqual(errors,[]);const directory=path.join(__dirname,'..','.cache','verification');fs.mkdirSync(directory,{recursive:true});
        await page.screenshot({path:path.join(directory,'guest-media-ui.png')});fs.writeFileSync(path.join(directory,'guest-ui-report.json'),JSON.stringify({checkedAt:new Date().toISOString(),...result,anonymous:true,authStatus:401,crossVisitorFileStatus:404,errors},null,2));
        console.log(JSON.stringify({anonymous:true,lines:result.lines,analysisComplete:true,mp4Prepared:true,authStatus:401,crossVisitorFileStatus:404,errors}));
    }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
