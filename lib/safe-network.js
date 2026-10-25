'use strict';
const dns = require('dns');
const net = require('net');
const { HttpsProxyAgent } = require('https-proxy-agent');
function publicAddress(address) {
    const version=net.isIP(address);
    if (version===4) {
        const [a,b,c]=address.split('.').map(Number);
        return !(a===0 || a===10 || a===127 || a>=224 || a===169&&b===254 || a===172&&b>=16&&b<=31 || a===192&&(b===168 || b===0 || b===2) || a===100&&b>=64&&b<=127 || a===198&&(b===18 || b===19 || b===51&&c===100) || a===203&&b===0&&c===113);
    }
    if (version===6) {
        const s=address.toLowerCase();
        return /^[23][0-9a-f]{3}:/.test(s) && !/^2001:(?:db8|0|10|20):/.test(s) && !/^2002:/.test(s);
    }
    return false;
}
function parsePublicUrl(value) {
    let url; try { url=new URL(value); } catch { throw new Error('无效URL'); }
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error('仅支持不含认证信息的HTTP/HTTPS链接');
    const host=url.hostname.replace(/^\[|\]$/g,'').replace(/\.$/,'').toLowerCase();
    if (host==='localhost' || host.endsWith('.local') || net.isIP(host)&&!publicAddress(host)) throw new Error('不允许访问本机、内网或保留地址');
    return url;
}
function publicLookup(hostname, options, callback) {
    if (typeof options==='function') { callback=options; options={}; }
    dns.lookup(hostname,{all:true,verbatim:true},(error,addresses)=>{
        if (error) return callback(error);
        if (!addresses.length || addresses.some(item=>!publicAddress(item.address))) return callback(new Error('域名解析到了内网或保留地址，已拒绝请求'));
        const family=typeof options==='number'?options:options?.family;
        const matching=family?addresses.filter(item=>item.family===family):addresses;
        if (!matching.length) return callback(new Error('没有可用的公网地址'));
        return options?.all ? callback(null,matching) : callback(null,matching[0].address,matching[0].family);
    });
}
function beforeRedirect(options) { parsePublicUrl(options.protocol+'//'+options.hostname+options.path); }
const safeOptions = { lookup:publicLookup, beforeRedirect, maxRedirects:5 };
const trustedCdnDomains=['hdslb.com','bilivideo.com','bilivideo.cn','biliimg.com','byteimg.com','douyincdn.com','douyinvod.com','douyinpic.com','douyinstatic.com','ibytedtos.com','byteoversea.com','tiktokcdn.com','tiktokcdn-us.com','xhscdn.com','xhsimg.com','yximgs.com','kwaicdn.com','ndcimgs.com','gifshow.com','googlevideo.com','ytimg.com','twimg.com','cdninstagram.com','fbcdn.net'];
function trustedCdn(host) { return trustedCdnDomains.some(domain=>host===domain || host.endsWith('.'+domain)); }
function mediaOptions(value) {
    const url=parsePublicUrl(value);
    // 本机Clash Fake-IP将合法CDN映射到198.18/15。仅已知平台CDN可以走显式配置的代理；
    // 未知域名仍由publicLookup验证公网地址，代理重定向也不得跳至任意站点。
    if(process.env.MEDIA_PROXY && trustedCdn(url.hostname)) {
        return { maxRedirects:5, httpsAgent:new HttpsProxyAgent(process.env.MEDIA_PROXY), beforeRedirect(options) {
            beforeRedirect(options); if(!trustedCdn(options.hostname))throw new Error('平台CDN重定向至未授权域名，已停止代理请求');
        } };
    }
    return safeOptions;
}
function platformUrl(value) {
    const url=parsePublicUrl(value), host=url.hostname.toLowerCase();
    const platforms=['bilibili.com','b23.tv','douyin.com','iesdouyin.com','youtube.com','youtu.be','tiktok.com','x.com','twitter.com','xiaohongshu.com','xhslink.com','kuaishou.com','gifshow.com','instagram.com','instagr.am','weibo.com','weibo.cn'];
    if (!platforms.some(domain=>host===domain || host.endsWith('.'+domain))) throw new Error('媒体处理只接受已接入平台的原站链接，不接受任意网站或媒体代理地址');
    return url;
}
module.exports={publicAddress,parsePublicUrl,publicLookup,safeOptions,platformUrl,mediaOptions};
