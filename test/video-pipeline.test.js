'use strict';
const assert = require('node:assert/strict');
const { normalizeTimestamp, parseHeat, prepareVideoList } = require('../lib/video-pipeline');
assert.equal(parseHeat('12.5万'), 125000);
assert.equal(parseHeat('1.2M views'), 1200000);
assert.equal(normalizeTimestamp(1720000000000), 1720000000);
const now = 2_000_000_000;
const input = [
    { id: 'old', title: '旧视频', platform: 'bilibili', pubdate: now - 8 * 86400, playRaw: 9000000 },
    { id: 'fresh', title: '同名视频', platform: 'bilibili', pubdate: now - 86400, playRaw: 125001, fetchedAt: 10 },
    { id: 'second', title: '同名视频', platform: 'bilibili', pubdate: now - 2 * 86400, playRaw: 80000 },
    { id: 'unknown', title: '无日期', platform: 'bilibili', playRaw: 990000 },
    { id: 'future', title: '未来日期', platform: 'bilibili', pubdate: now + 3600, playRaw: 999999 },
    { id: 'fresh', title: '原视频更新', platform: 'bilibili', pubdate: now - 86400, playRaw: 125005, fetchedAt: 20 },
    { id: 'topic', title: '热搜不是视频', platform: 'douyin', kind: 'topic', hotValue: 999999 }
];
const result = prepareVideoList(input, { timeRange: '7days', now });
assert.deepEqual(result.map(x => x.id), ['fresh', 'second']);
assert.equal(result[0].playRaw, 125005, '原始计数不能被格式化后的舍入数覆盖');
assert.equal(result.length, 2, '不同ID的同名视频不能拼接元数据');
const unknown = prepareVideoList([{ id: 'x', title: '无数据', platform: 'bilibili' }], { now })[0];
assert.equal(unknown.playRaw, null);
assert.equal(unknown.playCount, '未公开');
assert.equal(unknown.pubdate, 0, '未知日期不能伪造为今天');
const likes = prepareVideoList([{ id: 'd', title: '作品', platform: 'douyin', metric: 'likes', metricRaw: 123, metricLabel: '点赞', playRaw: null }], { now })[0];
assert.equal(likes.playRaw, null);
assert.equal(likes.metricRaw, 123, '点赞不能当播放量');
assert.equal(prepareVideoList([{title:'无ID'}]).length, 0);
console.log('video-pipeline tests passed');
