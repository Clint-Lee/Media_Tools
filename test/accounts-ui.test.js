'use strict';
const assert=require('node:assert/strict'),crypto=require('crypto'),path=require('path'),fs=require('fs'),puppeteer=require('puppeteer');
(async()=>{
    const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:4000', browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox']});
    const page=await browser.newPage(),errors=[]; page.on('pageerror',e=>errors.push(e.message)); await page.setViewport({width:1440,height:1000});
    const username='ui_'+crypto.randomBytes(5).toString('hex'),password=crypto.randomBytes(18).toString('base64url');
    try {
        await page.goto(base,{waitUntil:'domcontentloaded'});
        await page.waitForSelector('#open-login-btn',{visible:true});
        assert.equal(await page.$('#btn-role-admin'),null,'不能出现演示提权入口');
        await page.click('#open-login-btn'); await page.click('.auth-tab[data-tab="register"]');
        await page.type('#reg-username',username); await page.type('#reg-nickname','真实UI验收'); await page.type('#reg-password',password);
        await page.click('#register-form button[type="submit"]');
        await page.waitForSelector('#auth-modal.hidden');
        await page.waitForFunction(()=>document.querySelector('#user-nickname').textContent==='真实UI验收');
        assert.ok(!(await page.evaluate(()=>document.cookie)).includes('hotpot_session'),'会话不能由脚本读取');
        await page.reload({waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>document.querySelector('#user-nickname').textContent==='真实UI验收');
        await page.click('#user-identity-card'); await page.click('#menu-btn-profile');
        await page.waitForSelector('#profile-modal:not(.hidden)');
        assert.ok((await page.$eval('#profile-quota-display',e=>e.textContent)).includes('剩余 20'));
        assert.ok((await page.$eval('#profile-reg-date',e=>e.textContent))!=='2026-08-30');
        await page.click('#btn-account-edit'); await page.$eval('#profile-edit-nickname',e=>{e.value='修改后的真实昵称'});
        await page.click('#profile-edit-form button'); await page.waitForFunction(()=>document.querySelector('#user-nickname').textContent==='修改后的真实昵称');
        const old=(await page.cookies()).find(c=>c.name==='hotpot_session'); assert.ok(old.httpOnly);
        await page.type('#account-current-password',password); await page.type('#account-new-password',password+'-new'); await page.click('#account-password-form button');
        await page.waitForFunction(()=>document.querySelector('#account-current-password').value==='');
        assert.equal((await fetch(base+'/api/auth/me',{headers:{Cookie:'hotpot_session='+old.value}})).status,401);
        await page.click('#close-account-edit'); await page.click('#user-identity-card'); await page.click('#menu-btn-logout');
        await page.waitForSelector('#user-logged-in-box.hidden');
        assert.equal((await page.evaluate(async()=>fetch('/api/auth/me').then(r=>r.status))),401);
        assert.deepEqual(errors,[]);
        fs.mkdirSync(path.join(__dirname,'..','.cache','verification'),{recursive:true});
        await page.screenshot({path:path.join(__dirname,'..','.cache','verification','real-account-ui.png')});
        console.log('Real registration/login persistence, profile edit, password rotation and logout UI passed');
    } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
