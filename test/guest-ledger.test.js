'use strict';
const assert=require('node:assert/strict'),{createStore,IP_LIMIT}=require('../lib/guest-access');
const realNow=Date.now;let time=Date.parse('2026-10-22T15:59:00Z');Date.now=()=>time;
try {
    const ledger=createStore();
    ledger.connect('running','shared-ip');
    const running=ledger.reserve('running','long-task');
    for(let i=0;i<IP_LIMIT-1;i++) {const owner='old-'+i;ledger.connect(owner,'shared-ip');ledger.settle(ledger.reserve(owner,'old'),true);}
    assert.throws(()=>ledger.reserve('running','exhausted'),error=>error.status===429);
    time+=120000; // Shanghai midnight, while yesterday's task is still active.
    ledger.connect('new','shared-ip');assert.equal(ledger.quota('new').remaining,20);
    const next=ledger.reserve('new','new-day');
    assert.equal(ledger.quota('running').used,0);assert.equal(ledger.quota('running').pending,0);
    ledger.settle(running,true);ledger.settle(running,true);
    assert.equal(ledger.quota('running').used,0,'旧日任务结算不污染同一访客的新日桶');
    ledger.settle(next,true);assert.equal(ledger.quota('new').used,1);
    const sameOwner=ledger.reserve('running','today');ledger.settle(sameOwner,true);assert.equal(ledger.quota('running').used,1);

    const capacity=createStore();capacity.connect('active','attack-ip');const reservation=capacity.reserve('active','protected');
    time+=86400000;capacity.connect('active','attack-ip'); // Old-day work remains protected after rollover.
    capacity.connect('history','attack-ip');capacity.log('history',{title:'private-result'});
    for(let i=0;i<1500;i++)capacity.connect('empty-'+i,'attack-ip');
    assert.doesNotThrow(()=>capacity.connect('unrelated','another-ip'),'单IP空会话不能耗尽全局容量');
    assert.equal(capacity.quota('active').pending,0,'新日额度独立，旧日活动任务所有者仍不能被挤掉');
    assert.equal(capacity.history('history')[0].title,'private-result','已有历史不能被当空会话淘汰');
    capacity.settle(reservation,true);assert.equal(capacity.quota('active').used,0,'旧日任务不记入新日');
    assert.equal(capacity.history('unrelated').length,0);
    console.log('Guest ledger passed: Shanghai day buckets, idempotent old-day settlement, bounded empty sessions and active/history protection');
}finally {Date.now=realNow;}
