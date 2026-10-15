'use strict';
const terms={
    comedy:['搞笑','喜剧','相声','funny','comedy','humor'],ent:['娱乐','影视','明星','综艺','entertainment','celebrity','movie'],
    fashion:['穿搭','时尚','美妆','fashion','beauty','outfit','makeup'],pets:['萌宠','宠物','猫','狗','pets','cat','cats','dog','dogs','kitten','puppy'],
    wildlife:['野生','野外','自然纪录','wildlife','wild animal','safari'],animal:['动物','宠物','猫','狗','animal','animals','wildlife','pets'],
    tech:['科技','数码','人工智能','手机','电脑','芯片','相机','机器人','tech','technology','science','gadget','robot','iphone','ai'],
    marketing:['商业','营销','品牌','创业','business','marketing','brand','startup'],kuso:['鬼畜','音mad','meme','memes','parody','remix']
};
function matchesCategory(video,category) {
    if(!category || category==='all')return true;
    const text=[video.title,video.description,...(video.categoryTags || [])].filter(Boolean).join(' ').toLowerCase();
    return (terms[category] || []).some(term=>/^[a-z ]+$/.test(term)?new RegExp('(^|[^a-z])'+term+'([^a-z]|$)','i').test(text):text.includes(term));
}
function matchesQuery(video,query) {return !query || [video.title,video.description,video.author].filter(Boolean).join(' ').toLowerCase().includes(query.toLowerCase());}
module.exports={matchesCategory,matchesQuery,terms};
