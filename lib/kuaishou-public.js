'use strict';
const {identity}=require('./media-identity');
function metadataFromDetail(entity,targetUrl) {
    const id=identity(targetUrl),photo=entity?.photo;
    if(!id || String(photo?.id)!==id)throw new Error('快手返回作品编号与输入不一致');
    const url=photo.photoUrl;
    let parsed;try{parsed=new URL(url);}catch{}
    if(!parsed || parsed.protocol!=='https:' || !['kwaicdn.com','yximgs.com'].some(domain=>parsed.hostname===domain || parsed.hostname.endsWith('.'+domain)))throw new Error('快手没有返回可验证的原站媒体地址');
    return {id,title:photo.caption || photo.originCaption || '快手视频',description:photo.caption || '',thumbnail:photo.coverUrl || '',
        uploader:entity.author?.name || '',duration:Number(photo.duration)/1000 || 0,webpage_url:'https://www.kuaishou.com/short-video/'+id,
        url,vcodec:'unknown',acodec:'unknown',http_headers:{Referer:'https://www2.kuaishou.com/'}};
}
async function extractPublicMetadata(targetUrl) {
    const id=identity(targetUrl);if(!id || !/^[a-zA-Z0-9_-]+$/.test(id))throw new Error('未识别到快手作品编号');
    return require('./live-sources').withPage('kuaishou',async page=>{
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
        for(let i=0;i<8 && !selected;i++)await new Promise(resolve=>setTimeout(resolve,400));
        await Promise.allSettled(captures);
        const info=metadataFromDetail(selected,targetUrl);
        info.http_headers['User-Agent']=await page.evaluate(()=>navigator.userAgent);
        return info;
    },{anonymous:true});
}
module.exports={metadataFromDetail,extractPublicMetadata};
