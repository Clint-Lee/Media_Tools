'use strict';
const {prepareVideoList,parseVideoViews}=require('./video-pipeline');
const {matchesCategory,matchesQuery}=require('./video-categories');
const {lightweightPage,clickCategory,scrollMore}=require('./public-browser');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function redFeedFromHtml(html) {
    const state=require('./red-public').parseInitialState(html);
    const schemas=require('./platform-rankings');
    // The initial document contains an actual SSR feed even when no homefeed XHR fires.
    // Ignore placeholderFeeds, note details and all other stores in the same state object.
    return schemas.walk(state.feed?.feeds,item=>Boolean(item.note_card || item.noteCard))
        .filter(item=>/^[a-f0-9]{24}$/i.test(item.id || item.note_id || ''))
        .map(schemas.redVideo).filter(Boolean);
}

function filterPool(pool,options,name) {
    const list=prepareVideoList(pool.list.filter(v=>matchesCategory(v,options.category) && matchesQuery(v,options.query)),{timeRange:options.timeRange,limit:2000});
    return {...pool,list,scope:{kind:'public-discover-sample',label:name+'公开发现样本'+(options.query?'内检索':''),metric:'views',exhaustive:false,categoryMethod:'semantic-title-tags'},
        coverage:{...pool.coverage,candidates:pool.list.length,unique:list.length},
        message:pool.message+' 分类/关键词在实际发现作品标题与标签内匹配，发布时间严格过滤；未公开播放不入榜，不是全站搜索或历史总榜。'};
}

async function publicFeed(options,{withPage,memo=async(key,worker)=>worker()}) {
    const platform=options.platform;
    const pool=await memo('discover:'+platform+':'+options.page,()=>withPage(platform,async page=>{
        const found=[],captures=[];let hasMore=false;
        page.on('response',response=>{
            const url=response.url();
            if(platform==='kuaishou'?!url.includes('/graphql'):!(/\/homefeed|\/search\/notes/.test(url)))return;
            captures.push(response.json().then(data=>{
                const schemas=require('./platform-rankings');
                if(platform==='kuaishou') {
                    const feed=data.data?.brilliantTypeData;
                    if(!feed || feed.result!==1)return;
                    found.push(...(feed.feeds || []).map(schemas.kuaishouVideo).filter(Boolean));
                    hasMore=Boolean(feed.pcursor && feed.pcursor!=='no_more');
                } else if(data.success!==false && data.code===0) {
                    found.push(...schemas.walk(data.data,item=>Boolean(item.note_card || item.noteCard)).map(schemas.redVideo).filter(Boolean));
                    if(data.data?.has_more!=null)hasMore=Boolean(data.data.has_more);
                }
            }).catch(()=>{}));
        });
        await lightweightPage(page);
        const navigation=await page.goto(platform==='kuaishou'?'https://www2.kuaishou.com/brilliant':'https://www.xiaohongshu.com/explore',{waitUntil:'domcontentloaded',timeout:16000});
        if(platform==='xiaohongshu') {
            if(navigation?.ok() && new URL(navigation.url()).hostname==='www.xiaohongshu.com') {
                try { found.push(...redFeedFromHtml(await navigation.text())); } catch { /* Keep listening for actual feed responses. */ }
            }
            // 官网允许关闭的提示，不输入账号、不操作验证码，也不冒充已登录用户。
            try {await page.waitForSelector('.close-button',{visible:true,timeout:4000});await page.click('.close-button');}catch{}
            await clickCategory(page,['视频']);
        }
        for(let i=0;i<Math.min(16,options.page*6);i++) {
            await wait(500);await scrollMore(page);
            if(new Set(found.map(v=>v.id)).size>=Math.max(60,options.page*30) || !hasMore && found.length)break;
        }
        await Promise.allSettled(captures);
        if(!found.length)throw new Error((platform==='kuaishou'?'快手':'小红书')+'公开发现本次未返回真实视频；不要求用户登录，不使用话题或图文替代视频。');
        const list=prepareVideoList(found,{limit:2000});
        return {list,source:platform+':public-discover',hasMore:options.page<5 && hasMore,
            scope:{kind:'public-discover-sample'},message:'免登录读取'+(platform==='kuaishou'?'快手官网精彩短视频':'小红书官网公开推荐（关闭可关闭的登录提示）')+'。'};
    },{anonymous:true}),options.refresh);
    if(platform==='xiaohongshu') {
        const notes=require('./red-public');
        // 先同步等待一轮核验，再取快照回填。
        // 旧实现只调 prefetch()（不 await）就立刻 map，peek() 永远读到核验前的状态，
        // 前端因此只能看到 not-checked；只在 timeRange!=='all' 时才等，更放大了这个问题。
        // 有界并发实测 18 条仅几百毫秒，这个等待是划算的。
        await notes.enrichPublic(pool.list).catch(()=>{});
        const list=pool.list.map(video=>{
            const observation=notes.peek(video.url),detail=observation?.note;
            if(!detail)return video;
            const info=detail.interactInfo || detail.interact_info || {};
            return {...video,pubdate:detail.time || video.pubdate,description:detail.desc || video.description,
                ...((video.viewsFetchedAt || (video.playRaw!=null?video.fetchedAt:0) || 0)<=observation.fetchedAt?observation.views:{}),
                ...(info.likedCount!=null || info.liked_count!=null?require('./metric-evidence').metricFields('likes',info.likedCount ?? info.liked_count):{}),
                commentCount:info.commentCount ?? info.comment_count ?? null,collectCount:info.collectedCount ?? info.collected_count ?? null,shareCount:info.shareCount ?? info.share_count ?? null,
                likeSource:observation.source,likesFetchedAt:observation.fetchedAt};
        });
        const unknown=list.filter(v=>!v.pubdate).length;
        const updating=notes.pendingCount(pool.list)>0;
        // 小红书不公开视频播放量（站内外与第三方读取方都拿不到）；
        // 按用户要求提供互动推算预估播放（estimated 标注），可 HOTPOT_ESTIMATED_VIEWS=0 关闭。
        const estimatedRows=require('./estimated-views').apply(list),estimated=estimatedRows.estimatedViews;
        return filterPool({...pool,list:estimatedRows,partial:unknown>0,refreshing:updating,
            coverage:{...pool.coverage,datesKnown:list.length-unknown,datesUnknown:unknown,estimatedViews:estimated},
            message:pool.message+(estimated?' 平台不公开播放量，展示按真实点赞推算的预估播放（标"预估"，非平台数据）。':' 未公开播放不入榜。')+(unknown?' 有'+unknown+'件未取得精确发布时间，不会混入时效榜。':'')+(updating?'可用详情正在后台补充，可稍后刷新查看。':'')},options,'小红书');
    }
    return filterPool(pool,options,'快手');
}

// 旧路径 CreativeCenterGetTopContentsList 已失效（400）；改用 Astra 调研指出的 KnowledgeAPI 话题趋势榜。
// 话题榜只提供热度指数与作品数，不是视频播放量；播放量由 lib/tiktok-views.js 的视频详情页补全。
async function tiktokCreativePool({ withPage, memo = async (key, worker) => worker(), refresh = false } = {}) {
    return memo('discover:tiktok:creative', async () => {
        const result = await require('./tiktok-creative').fetchRanking('hashtag', { timeRange: '7days', region: 'US' });
        return { list: [], topics: result.list, source: result.source, scope: { kind: 'public-topic-ranking' }, hasMore: false,
            coverage: { topics: result.list.length }, pagination: result.pagination, message: result.message };
    }, refresh);
}
async function tiktokTagPool(options,{withPage,memo=async(key,worker)=>worker()}) {
    const tags={all:'viral',comedy:'funny',ent:'entertainment',fashion:'fashion',pets:'pets',wildlife:'wildlife',animal:'animals',tech:'technology',marketing:'marketing',kuso:'meme'};
    const tag=tags[options.category] || 'viral';
    return memo('discover:tiktok:tag:'+tag+':'+options.page,()=>withPage('tiktok',async page=>{
        const found=[],captures=[];let hasMore=true;
        page.on('response',response=>{
            if(!new URL(response.url()).pathname.startsWith('/api/challenge/item_list/'))return;
            captures.push(response.json().then(data=>{found.push(...(data.itemList || []).map(require('./platform-rankings').tiktokVideo).filter(Boolean));hasMore=Boolean(data.hasMore);}).catch(()=>{}));
        });
        await lightweightPage(page);
        await page.goto('https://www.tiktok.com/tag/'+tag,{waitUntil:'domcontentloaded',timeout:16000});
        for(let i=0;i<Math.min(10,options.page*4);i++) {await wait(400);await scrollMore(page);if(found.length>=Math.max(30,options.page*30) || found.length && !hasMore)break;}
        await Promise.allSettled(captures);
        if(!found.length)throw new Error('TikTok公开标签页未返回实际作品');
        return {list:prepareVideoList(found,{limit:2000}),hasMore:options.page<5 && hasMore,source:'tiktok:public-tag',scope:{kind:'public-discover-sample'},message:'公开标签 #'+tag+' 的真实作品，不是热度话题卡片。'};
    },{anonymous:true}),options.refresh);
}
module.exports={publicFeed,filterPool,tiktokCreativePool,tiktokTagPool,redFeedFromHtml};
