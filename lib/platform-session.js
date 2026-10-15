'use strict';

const fs = require('fs');
const path = require('path');
const root = process.env.HOTPOT_SESSION_DIR || path.join(__dirname, '..', '.runtime', 'platform-sessions');
const PLATFORMS = Object.freeze({
    bilibili: { name:'B站', domain:'bilibili.com', url:'https://www.bilibili.com/' },
    douyin: { name:'抖音', domain:'douyin.com', url:'https://www.douyin.com/' },
    tiktok: { name:'TikTok', domain:'tiktok.com', url:'https://www.tiktok.com/login' },
    xiaohongshu: { name:'小红书', domain:'xiaohongshu.com', url:'https://www.xiaohongshu.com/explore' },
    kuaishou: { name:'快手', domain:'kuaishou.com', url:'https://www.kuaishou.com/' },
    youtube: { name:'YouTube', domain:'youtube.com', url:'https://www.youtube.com/' }
});
function files(platform) {
    if (!PLATFORMS[platform]) throw new Error('不支持的登录平台');
    return { json:path.join(root,platform+'.json'), netscape:path.join(root,platform+'.cookies.txt') };
}
function read(platform) {
    if (!PLATFORMS[platform]) return [];
    try {
        const data=JSON.parse(fs.readFileSync(files(platform).json,'utf8'));
        return Array.isArray(data.cookies) ? data.cookies.filter(c=>c.name && c.value && (c.expires==null || c.expires<=0 || c.expires>Date.now()/1000)) : [];
    } catch { return []; }
}
function cookieHeader(platform) {
    return process.env[platform.toUpperCase()+'_COOKIE'] || read(platform).map(c=>c.name+'='+c.value).join('; ');
}
function browserCookies(platform) {
    const explicit=process.env[platform.toUpperCase()+'_COOKIE'];
    if (!explicit) return read(platform);
    return explicit.split(';').map(part=>{
        const index=part.indexOf('=');
        return {name:part.slice(0,index).trim(),value:part.slice(index+1).trim(),domain:'.'+PLATFORMS[platform].domain,path:'/'};
    }).filter(c=>c.name && c.value);
}
function save(platform, cookies) {
    const domain=PLATFORMS[platform]?.domain;
    const valid=cookies.filter(c=>c.domain?.replace(/^\./,'')===domain || c.domain?.endsWith('.'+domain));
    if (!valid.length) throw new Error('当前窗口没有该平台的Cookie，未保存；请先完成登录');
    fs.mkdirSync(root,{recursive:true});
    const target=files(platform), temporary=target.json+'.tmp';
    fs.writeFileSync(temporary,JSON.stringify({savedAt:Date.now(),cookies:valid}),{mode:0o600});
    fs.renameSync(temporary,target.json);
    const lines=valid.map(c=>[(c.httpOnly?'#HttpOnly_':'')+c.domain,c.domain.startsWith('.')?'TRUE':'FALSE',c.path || '/',c.secure?'TRUE':'FALSE',Math.max(0,Math.floor(c.expires || 0)),c.name,c.value].join('\t'));
    fs.writeFileSync(target.netscape,'# Netscape HTTP Cookie File\n'+lines.join('\n')+'\n',{mode:0o600});
    return valid.length;
}
function cookieFile(url) {
    if (process.env.MEDIA_COOKIES_FILE) return process.env.MEDIA_COOKIES_FILE;
    const host=new URL(url).hostname;
    const platform=Object.keys(PLATFORMS).find(p=>host===PLATFORMS[p].domain || host.endsWith('.'+PLATFORMS[p].domain));
    if (!platform || !read(platform).length) return null;
    const filename=files(platform).netscape;
    return fs.existsSync(filename)?filename:null;
}
function configured(platform) { return Boolean(cookieHeader(platform)); }
module.exports={PLATFORMS,read,save,cookieHeader,browserCookies,cookieFile,configured};
