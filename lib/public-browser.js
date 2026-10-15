'use strict';
async function lightweightPage(page, { navigationDomain } = {}) {
    await page.setRequestInterception(true);
    page.on('request', request => {
        if (navigationDomain && request.isNavigationRequest()) {
            try {
                const url = require('./safe-network').parsePublicUrl(request.url());
                if (url.hostname !== navigationDomain && !url.hostname.endsWith('.' + navigationDomain)) return request.abort();
            } catch { return request.abort(); }
        }
        return ['image','font','media'].includes(request.resourceType()) ? request.abort() : request.continue();
    });
}
async function clickCategory(page, labels) {
    if(!labels?.length)return false;
    const point=await page.evaluate(names=>{
        const nodes=[...document.querySelectorAll('button,[role="tab"],a,span')];
        for(const name of names)for(const node of nodes)if(node.textContent.trim()===name){let r=node.getBoundingClientRect();if(!r.width || !r.height)continue;node.scrollIntoView({block:'nearest',inline:'nearest'});r=node.getBoundingClientRect();if(r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight)return {x:r.x+r.width/2,y:r.y+r.height/2};}
        return null;
    },labels);
    if(!point)return false;await page.mouse.click(point.x,point.y);return true;
}
async function scrollMore(page) {
    await page.evaluate(()=>{
        window.scrollBy(0,1400);
        for(const e of document.querySelectorAll('.jingxuanFeedList,main,[role="main"]'))if(e.scrollHeight>e.clientHeight+100)e.scrollBy(0,1400);
    });
    await page.mouse.move(800,600);await page.mouse.wheel({deltaY:1400});
}
module.exports={lightweightPage,clickCategory,scrollMore};
