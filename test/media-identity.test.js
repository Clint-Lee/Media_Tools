'use strict';
const assert=require('node:assert/strict');
const {identity,assertIdentity,redNote}=require('../lib/media-identity');
assert.equal(identity('https://www.youtube.com/watch?v=abcdefghijk'),'abcdefghijk');
assert.throws(()=>assertIdentity('https://www.youtube.com/watch?v=abcdefghijk',{id:'abcdefghijk',webpage_url:'https://www.youtube.com/watch?v=wrong-id-xx'}),'不同作品不能混入');
const note='a'.repeat(24),other='b'.repeat(24),url='https://www.xiaohongshu.com/explore/'+note;
const selected=redNote({note:{noteDetailMap:{[other]:{note:{noteId:other,title:'推荐作品'}},[note]:{note:{noteId:note,title:'真实作品'}}}}},url);
assert.equal(selected.title,'真实作品');
assert.throws(()=>redNote({note:{noteDetailMap:{[other]:{note:{noteId:other,title:'推荐作品'}}}}},url));
const sources=require('../lib/live-sources');
sources.withPage=async()=>{throw new Error('valid-id-reached-browser')};
const {sniffDouyinVideo}=require('../lib/douyin-sniffer');
(async()=>{
    await assert.rejects(()=>sniffDouyinVideo('1234567890123456789'),/valid-id-reached-browser/,'真实数字编号必须进入浏览器，不能误用双重转义正则');
    await assert.rejects(()=>sniffDouyinVideo('topic-1'),/无效/);
    console.log('Media identity and Douyin ID validation tests passed');
})().catch(error=>{console.error(error);process.exitCode=1});
