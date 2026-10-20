'use strict';
require('../lib/env');
const path=require('path');
const readline=require('readline/promises');
const puppeteer=require('puppeteer');
const sessions=require('../lib/platform-session');
const platform=process.argv[2];
if (!sessions.PLATFORMS[platform]) {
    console.log('用法：npm run platform:login -- '+Object.keys(sessions.PLATFORMS).join(' | '));
    console.log('打开独立登录窗口，手动登录后回终端确认保存；不读取主浏览器，不输出Cookie。');
    process.exitCode=platform && platform!=='--help'?1:0;
} else (async()=>{
    const config=sessions.PLATFORMS[platform];
    console.log('将打开'+config.name+'独立窗口。请在官网自行扫码/登录并完成验证，不要把密码或Cookie发给AI。');
    let proxy=process.env.MEDIA_PROXY;
    if(!proxy && ['tiktok','youtube'].includes(platform)) try {
        const settings=await (await fetch('http://127.0.0.1:'+(process.env.PORT || 4000)+'/api/settings',{signal:AbortSignal.timeout(1500)})).json();
        if(settings.proxy && /^https?:\/\//.test(settings.proxy))proxy=settings.proxy;
    } catch { /* 服务未启动时使用浏览器系统网络设置，仍可显式设置MEDIA_PROXY。 */ }
    // 优先使用本机已安装的 Chrome，与 lib/live-sources.js 的解析顺序一致。
    const fs=require('fs');
    const chromeCandidates=[process.env.PUPPETEER_EXECUTABLE_PATH,
        process.env['ProgramFiles'] && process.env['ProgramFiles']+'\\Google\\Chrome\\Application\\chrome.exe',
        process.env['ProgramFiles(x86)'] && process.env['ProgramFiles(x86)']+'\\Google\\Chrome\\Application\\chrome.exe',
        process.env.LOCALAPPDATA && process.env.LOCALAPPDATA+'\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean);
    const executablePath=chromeCandidates.find(candidate=>fs.existsSync(candidate));
    const browser=await puppeteer.launch({headless:false,...(executablePath?{executablePath}:{}),userDataDir:path.join(__dirname,'..','.runtime','platform-logins',platform),
        args:['--disable-setuid-sandbox',...(['tiktok','youtube'].includes(platform) && proxy?['--proxy-server='+proxy]:[])]});
    const prompt=readline.createInterface({input:process.stdin,output:process.stdout});
    try {
        const page=(await browser.pages())[0] || await browser.newPage();
        await page.goto(config.url,{waitUntil:'domcontentloaded',timeout:45000});
        const answer=await prompt.question('确认在官网显示已登录后，回这里输入 save 并回车保存（其它输入取消）：');
        if(answer.trim()!=='save') { console.log('已取消，未导入登录凭证。'); return; }
        const client=await page.target().createCDPSession();
        const {cookies}=await client.send('Network.getAllCookies');
        const count=sessions.save(platform,cookies);
        console.log('已在本机私有目录保存'+count+'条平台Cookie；回HotPot点击刷新即可，无需复制Cookie或修改.env。');
        console.log('注意：这只表示已保存登录窗口状态，不保证搜索权限、地区访问或任意视频播放量可用。');
    } finally { prompt.close(); await browser.close(); }
})().catch(error=>{console.error('登录连接未完成：'+error.message);process.exitCode=1;});
