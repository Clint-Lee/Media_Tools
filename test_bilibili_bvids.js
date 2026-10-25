const axios = require('axios');
const { BILIBILI_CATEGORIES, getCategoryFallbackList, EVENT_TOPIC_TEMPLATES } = require('./archive/category-fallback-pool');

async function checkBvid(bvid) {
    try {
        const res = await axios.get(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            timeout: 4000
        });
        if (res.data?.code === 0 && res.data?.data) {
            return { bvid, valid: true, title: res.data.data.title, cover: res.data.data.pic };
        }
        return { bvid, valid: false, code: res.data?.code, msg: res.data?.message };
    } catch (e) {
        return { bvid, valid: false, error: e.message };
    }
}

async function main() {
    console.log('Validating Bilibili fallback pool BVIDs...');
    const allBvids = new Set();

    // From topics
    for (const t of EVENT_TOPIC_TEMPLATES) {
        for (const sub of (t.subVideos || [])) {
            if (sub.id && sub.id.startsWith('BV')) allBvids.add(sub.id);
        }
    }

    // From fallback pool
    const categories = ['all', 'comedy', 'ent', 'fashion', 'pets', 'wildlife', 'tech', 'marketing', 'kuso', 'animal'];
    for (const cat of categories) {
        const list = getCategoryFallbackList('Bilibili', cat);
        for (const item of list) {
            if (item.id && item.id.startsWith('BV')) allBvids.add(item.id);
        }
    }

    console.log(`Found ${allBvids.size} unique BVIDs to check.`);
    const results = [];
    for (const bvid of allBvids) {
        const res = await checkBvid(bvid);
        results.push(res);
        console.log(`[Bilibili Check] ${bvid}: ${res.valid ? 'VALID - ' + res.title.slice(0, 30) : 'INVALID - ' + (res.msg || res.error)}`);
    }

    const invalid = results.filter(r => !r.valid);
    console.log(`\nSummary: ${results.length - invalid.length} VALID, ${invalid.length} INVALID`);
    if (invalid.length > 0) {
        console.log('Invalid BVIDs:', invalid.map(i => i.bvid));
    }
}

main();
