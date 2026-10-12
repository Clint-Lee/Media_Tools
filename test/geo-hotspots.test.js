'use strict';

const assert = require('node:assert/strict');
const { attachVideoLocations, inferVideoLocation } = require('../lib/geo-hotspots');

function run() {
    const shanghai = inferVideoLocation({ title: '上海探店：本周最火的新餐厅' });
    assert.equal(shanghai.city, '上海');
    assert.equal(shanghai.country, '中国');

    const newYork = inferVideoLocation({ title: 'A creator guide to New York street videos' });
    assert.equal(newYork.city, '纽约');
    assert.equal(inferVideoLocation({ title: '日本科学新闻' }), null, '国家不能自动归为首都');

    const videos = attachVideoLocations([
        { id: '1', title: '东京街头观察' },
        { id: '2', title: '没有地理信息的视频' }
    ]);
    assert.equal(videos[0].geo.city, '东京');
    assert.equal(videos[1].geo, undefined);
    console.log('geo-hotspots tests passed');
}

run();
