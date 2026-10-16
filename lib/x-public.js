'use strict';
const axios=require('axios');
const {HttpsProxyAgent}=require('https-proxy-agent');
const {prepareVideoList}=require('./video-pipeline');
const {matchesQuery}=require('./video-categories');
const {identity}=require('./media-identity');
const accounts={all:['NASA','SpaceX','Reuters','NatGeo','TheDodo','FailArmy'],tech:['NASA','SpaceX','verge','WIRED'],comedy:['FailArmy','TheDailyShow'],ent:['DiscussingFilm','Variety'],fashion:['voguemagazine','gucci'],pets:['TheDodo','dog_rates'],wildlife:['NatGeo','BBCEarth'],animal:['TheDodo','NatGeo'],marketing:['business','Forbes'],kuso:['adultswim','FailArmy']};
async function api(path,params) {
    const response=await axios.get('https://api.fxtwitter.com/2/'+path,{proxy:false,timeout:12000,params,
        ...(process.env.MEDIA_PROXY?{httpsAgent:new HttpsProxyAgent(process.env.MEDIA_PROXY)}:{})});
    if(response.data.code!==200)throw new Error('公开转述源未返回可用作品（'+response.data.code+'）');
    return response.data;
}
function videoFromPost(post) {
    if(post.type!=='status' || !/^\d+$/.test(post.id || ''))return null;
    const video=post.media?.videos?.find(v=>v.type==='video' && /^https:\/\/video\.twimg\.com\//.test(v.url || ''));
    if(!video)return null;
    return {id:post.id,postId:post.id,mediaId:String(video.id || ''),title:post.text || 'X 公开视频',platform:'twitter',author:post.author?.name || post.author?.screen_name || '',
        url:'https://x.com/'+encodeURIComponent(post.author?.screen_name || 'i')+'/status/'+post.id,cover:video.thumbnail_url || '',pubdate:post.created_timestamp || post.created_at,
        // post.views是帖子曝光，绝不填入视频播放。转述源不提供视频播放时保持未知。
        playRaw:video.view_count ?? null,likeRaw:post.likes ?? null,duration:video.duration?Math.round(video.duration)+'秒':'',
        source:'twitter:fxembed-public-accounts',fetchedAt:Date.now()};
}
async function publicVideos(options,{memo=async(key,worker)=>worker(),boundedMap}) {
    async function pool(page) {
        return memo('discover:twitter:'+options.category+':'+page,async()=>{
            const previous=page>1?await pool(page-1):null;
            const handles=accounts[options.category] || accounts.all;
            const sources=await boundedMap(handles,3,async handle=>{
                const cursor=previous?.cursors?.[handle];
                if(page>1 && !cursor)return {handle,list:[],cursor:null};
                const data=await api('profile/'+handle+'/media',{count:30,...(cursor?{cursor}:{} )});
                return {handle,list:(data.results || []).map(videoFromPost).filter(Boolean),cursor:data.cursor?.bottom || null};
            });
            const collected=prepareVideoList(sources.flatMap(row=>row.value?.list || []),{limit:2000});
            const metrics=await require('./x-video-metrics').enrich(collected,boundedMap);
            const list=prepareVideoList(metrics.list,{limit:2000});
            if(!list.length && sources.every(row=>row.error))throw new Error('X匿名公开转述源本次不可达；未要求用户登录，未用其它平台视频替代。');
            const cursors=Object.fromEntries(sources.filter(row=>row.value).map(row=>[row.value.handle,row.value.cursor]));
            return {list,cursors,hasMore:page<4 && Object.values(cursors).some(Boolean),partial:metrics.failed>0,source:'twitter:fxembed-public-accounts',scope:{kind:'public-discover-sample'},
                coverage:{sources:sources.map((row,i)=>({name:handles[i]+'公开媒体',count:row.value?.list.length || 0,status:row.error?'failed':'ok',message:row.error?.message || ''}))},
                message:'来自FxEmbed公开API转述的公开账号视频，非X官方搜索/全网热榜；保留原帖链接、作者与发布时间。视频播放量由X官方匿名视频配置补全并核验媒体编号；未把帖子曝光当视频播放。'+(metrics.failed?'部分作品的官方播放统计本次不可用，保持未知。':'')};
        },options.refresh);
    }
    const result=await pool(options.page);
    const list=prepareVideoList(result.list.filter(v=>matchesQuery(v,options.query)),{timeRange:options.timeRange,limit:2000});
    const {cursors,...publicResult}=result;
    return {...publicResult,list,scope:{kind:'public-discover-sample',label:'公开账号视频样本 · 第三方转述'+(options.query?' · 样本内检索':''),exhaustive:false,metric:'views',categoryMethod:'public-account-topic'},
        coverage:{...result.coverage,candidates:result.list.length,unique:list.length}};
}
async function extractPublicMetadata(url) {
    const id=identity(url);if(!id)throw new Error('缺少可核验的X原帖编号');
    const data=await api('status/'+id),post=data.status;
    if(!post || post.id!==id || !videoFromPost(post))throw new Error('公开源未提供与输入帖子一致的视频');
    const video=post.media.videos.find(v=>v.type==='video' && /^https:\/\/video\.twimg\.com\//.test(v.url || ''));
    return {id,webpage_url:videoFromPost(post).url,title:post.text || 'X 公开视频',description:post.text || '',thumbnail:video.thumbnail_url,
        uploader:post.author?.name || '',duration:video.duration || 0,url:video.url,vcodec:'unknown',acodec:'unknown',http_headers:{Referer:'https://x.com/'}};
}
module.exports={publicVideos,videoFromPost,extractPublicMetadata};
