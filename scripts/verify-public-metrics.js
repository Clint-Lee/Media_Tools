'use strict';
// Opt-in live verification. No login, cache clearing, synthetic counters or challenge handling.
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),axios=require('axios'),{HttpsProxyAgent}=require('https-proxy-agent');
const {parseWatch}=require('../lib/youtube-public'),ranking=require('../public/ranking');
const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:4000';
async function feed(platform,sort='views') {
    const response=await fetch(base+'/api/trends?'+new URLSearchParams({platform,sort,final:'1'}),{signal:AbortSignal.timeout(65000)}),data=await response.json();
    assert.equal(response.status,200,data.message);assert.ok(data.list?.length,platform+'没有返回视频');
    assert.ok(data.list.every((v,i)=>!i || ranking.compare(data.list[i-1],v,sort)<=0),platform+'排序不正确');
    return data;
}
function counts(platform,data) {
    const list=data.list;
    return {platform,videos:list.length,views:list.filter(v=>v.playRaw!=null).length,likes:list.filter(v=>v.likeRaw!=null).length,
        roundedViews:list.filter(v=>v.viewPrecision==='source-rounded').length,roundedLikes:list.filter(v=>v.likePrecision==='source-rounded').length,
        boundedLikes:list.filter(v=>v.likePrecision==='lower-bound').length,comments:list.filter(v=>v.commentCount!=null).length,
        collects:list.filter(v=>v.collectCount!=null).length,shares:list.filter(v=>v.shareCount!=null).length,dates:list.filter(v=>v.pubdate>0).length};
}
(async()=>{
    await feed('xiaohongshu');
    const youtube=await feed('youtube','likes'),known=youtube.list.find(v=>v.likeSource==='youtube:public-watch' && v.likeRaw!=null);
    assert.ok(known,'必须实测取得YouTube原站匿名点赞，不以配置存在判成功');
    const settings=await(await fetch(base+'/api/settings')).json(),proxy=process.env.MEDIA_PROXY || settings.proxy;
    const response=await axios.get('https://www.youtube.com/watch',{params:{v:known.id,hl:'en'},proxy:false,timeout:12000,maxContentLength:8*1024*1024,maxRedirects:0,
        headers:{'User-Agent':require('../lib/live-sources').UA,'Accept-Language':'en-US,en;q=0.9'},...(proxy?{httpsAgent:new HttpsProxyAgent(proxy)}:{})});
    const official=parseWatch(String(response.data),known.id);
    assert.ok(Math.abs(known.likeRaw-official.likeRaw)<=Math.max(5,official.likeRaw*0.01),'点赞须与同一作品原站观测一致，容许时间差');
    const red=await feed('xiaohongshu','likes'),details=red.list.filter(v=>v.likeSource==='xiaohongshu:anonymous-note-page');
    assert.ok(details.some(v=>v.pubdate && v.commentCount!=null && v.collectCount!=null && v.shareCount!=null),'必须真正取得匿名笔记日期与互动详情');
    const report={checkedAt:new Date().toISOString(),anonymous:true,cacheState:'normal server cache; no deletion or claim of cold start',
        youtube:{...counts('youtube',youtube),originalId:known.id,sampleLikes:known.likeRaw,officialLikes:official.likeRaw,sampleViews:known.playRaw,officialViews:official.playRaw,source:known.likeSource},
        red:{...counts('xiaohongshu',red),detailCount:details.length,examples:details.slice(0,2).map(v=>({id:v.id,pubdate:v.pubdate,likeRaw:v.likeRaw,likeText:v.likeCountText,likePrecision:v.likePrecision,comments:v.commentCount,collects:v.collectCount,shares:v.shareCount}))},platforms:[]};
    for(const platform of ['bilibili','douyin','youtube','tiktok','twitter','xiaohongshu','kuaishou'])report.platforms.push(counts(platform,await feed(platform)));
    report.allPlatformsHaveViews=report.platforms.every(v=>v.views===v.videos);
    const directory=path.join(__dirname,'..','.cache','verification');fs.mkdirSync(directory,{recursive:true});
    fs.writeFileSync(path.join(directory,'metric-evidence-live.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
