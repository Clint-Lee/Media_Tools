'use strict';
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), os = require('os');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hotpot-tiktok-response-'));
process.env.HOTPOT_DB_FILE = path.join(directory, 'accounts.json');
process.env.HOTPOT_MEDIA_CACHE = path.join(directory, 'media');
process.env.HOTPOT_COLLECTION_DIR = path.join(directory, 'collection');
process.env.HOTPOT_PREWARM = '0';
fs.writeFileSync(process.env.HOTPOT_DB_FILE, JSON.stringify({authVersion:2,users:[],logs:[],sessions:{},reservations:{}}));
const id = '1234567890123456789', observed = Date.now();
let finishDetail;
const gate = new Promise(resolve => { finishDetail = resolve; });
const views = require('../lib/tiktok-views');
const client = views.createClient({now:()=>observed+1000, withPage:async(platform, worker, options) => {
    assert.equal(platform, 'tiktok'); assert.equal(options.anonymous, true);
    return worker({goto:async()=>gate,evaluate:async()=>({'#__UNIVERSAL_DATA_FOR_REHYDRATION__':{
        __DEFAULT_SCOPE__:{'webapp.video-detail':{itemInfo:{itemStruct:{id,stats:{playCount:222,diggCount:12}}}}}
    }})});
}});
Object.assign(views, client);
const sourceList = [{id,title:'isolated cached TikTok',platform:'tiktok',url:'https://www.tiktok.com/@i/video/'+id,
    playRaw:100,likeRaw:4,fetchedAt:observed,viewsFetchedAt:observed,likesFetchedAt:observed}];
const cached = {list:sourceList,source:'tiktok:test-cache',message:'isolated cached source',hasMore:false,metricEnrichment:{pending:0}};
const sources = require('../lib/live-sources');
let calls = 0;
sources.getVideos = async () => { calls++; return cached; };
const collection = require('../lib/collection-index'), saved = [];
collection.record = (platform,list) => { saved.push({platform,list}); return {status:'saved',count:list.length}; };
const jobs = require('../lib/media-jobs'), app = require('../server');
(async()=>{
    const handle = app._router.stack.find(layer=>layer.route?.path==='/api/trends').route.stack[0].handle;
    async function response() {
        let body, status = 200;
        await handle({path:'/api/trends',query:{platform:'tiktok'}}, {
            status(code) { status=code; return this; }, json(value) { body=value; return value; }
        });
        assert.equal(status,200); return body;
    }
    try {
        const first = await response();
        assert.equal(first.list[0].playRaw,100);
        assert.equal(first.metricEnrichment.pending,1,'cached response starts bounded public detail supplement');
        assert.equal(first.refreshing,true);
        finishDetail(); await client.enrich(sourceList);
        const second = await response();
        assert.equal(second.list[0].playRaw,222,'next ordinary request applies completed detail to unchanged source cache');
        assert.equal(second.list[0].viewsFetchedAt,observed+1000);
        assert.equal(second.list[0].fetchedAt,observed,'detail does not refresh source observation time');
        assert.equal(second.metricEnrichment.pending,0); assert.equal(second.refreshing,false);
        assert.equal(second.collection.status,'saved');
        assert.equal(saved.at(-1).platform,'tiktok'); assert.equal(saved.at(-1).list[0].playRaw,222);
        assert.equal(sourceList[0].playRaw,100,'source cache is not mutated');
        assert.equal(calls,2);
        sourceList[0] = {...sourceList[0],playRaw:333,viewsFetchedAt:observed+2000};
        const third = await response();
        assert.equal(third.list[0].playRaw,333,'older detail cannot roll back fresher source metric');
        console.log('Production TikTok response supplement, cache reuse, index propagation and freshness passed');
    } finally {
        finishDetail(); jobs.shutdown(); await sources.closeBrowser();
        fs.rmSync(directory,{recursive:true,force:true});
    }
})().catch(error=>{console.error(error);process.exitCode=1;});
