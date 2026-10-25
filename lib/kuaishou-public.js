'use strict';
const {identity}=require('./media-identity');
// 快手视频 CDN 域名随基础设施轮换：2026-10 实测出现 djvod.ndcimgs.com，
// 老白名单(kwaicdn/yximgs)会误拒真实媒体。这里收集 photoUrl 与 manifest 备选流，
// 选第一个落在已知快手 CDN 域内的地址。
const MEDIA_DOMAINS=['kwaicdn.com','yximgs.com','ndcimgs.com','gifshow.com'];
function onKsMediaDomain(url) {
    try { const parsed=new URL(url);
        return parsed.protocol==='https:' && MEDIA_DOMAINS.some(domain=>parsed.hostname===domain || parsed.hostname.endsWith('.'+domain));
    } catch { return false; }
}
function collectCandidates(photo) {
    const urls=[photo?.photoUrl];
    for(const manifest of [photo?.manifest,photo?.manifestH265]) {
        for(const set of Array.isArray(manifest?.adaptationSet)?manifest.adaptationSet:[]) {
            for(const rep of Array.isArray(set?.representation)?set.representation:[]) {
                urls.push(rep.url,...(Array.isArray(rep.backupUrl)?rep.backupUrl:[]));
            }
        }
    }
    return urls.filter(Boolean);
}
function metadataFromDetail(entity,targetUrl) {
    const id=identity(targetUrl),photo=entity?.photo;
    if(!id || String(photo?.id)!==id)throw new Error('快手返回作品编号与输入不一致');
    const url=collectCandidates(photo).find(onKsMediaDomain);
    if(!url)throw new Error('快手没有返回可验证的原站媒体地址');
    return {id,title:photo.caption || photo.originCaption || '快手视频',description:photo.caption || '',thumbnail:photo.coverUrl || '',
        uploader:entity.author?.name || '',duration:Number(photo.duration)/1000 || 0,webpage_url:'https://www.kuaishou.com/short-video/'+id,
        url,vcodec:'unknown',acodec:'unknown',http_headers:{Referer:'https://www2.kuaishou.com/'}};
}
async function extractPublicMetadata(targetUrl) {
    const id=identity(targetUrl);if(!id || !/^[a-zA-Z0-9_-]+$/.test(id))throw new Error('未识别到快手作品编号');
    const attempt=fresh=>require('./live-sources').withPage('kuaishou',async page=>{
        let selected;const captures=[];
        page.on('response',response=>{
            if(!response.url().includes('/graphql'))return;
            captures.push(response.json().then(data=>{
                const match=require('./platform-rankings').walk(data,item=>String(item.photo?.id)===id && item.author)[0];
                if(match)selected=match;
            }).catch(()=>{}));
        });
        await require('./public-browser').lightweightPage(page);
        await page.goto('https://www2.kuaishou.com/short-video/'+id,{waitUntil:'domcontentloaded',timeout:16000});
        // graphql 在页面渲染完成后才发出；服务器忙时可能晚到，给足等待。
        for(let i=0;i<20 && !selected;i++)await new Promise(resolve=>setTimeout(resolve,500));
        await Promise.allSettled(captures);
        const info=metadataFromDetail(selected,targetUrl);
        info.http_headers['User-Agent']=await page.evaluate(()=>navigator.userAgent);
        return info;
    },{anonymous:true,fresh});
    // 共享匿名上下文可能随时间积累风控状态（实测长驻服务里 graphql 停发导致解析失败）。
    // 共享上下文失败后用全新上下文重试两次；这是对"本作品本次读取"的重试，不是验证码绕过。
    let lastError;
    for (const fresh of [false, true, true]) {
        try { return await attempt(fresh); }
        catch (error) { lastError = error; }
    }
    throw lastError;
}
module.exports={metadataFromDetail,extractPublicMetadata};
