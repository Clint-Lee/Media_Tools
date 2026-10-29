(function(root,factory){
    if(typeof module==='object' && module.exports)module.exports=factory();
    else root.VideoRanking=factory();
})(typeof globalThis==='object'?globalThis:this,function(){
    'use strict';
    function metric(value){return value==='likes'?'likes':'views';}
    function count(video,sortBy){
        if(metric(sortBy)==='views' && (video.viewPrecision==='estimated' || video.viewEvidence?.status==='estimated'
            || video.viewSource==='hotpot:engagement-estimate'))return null;
        const value=video[metric(sortBy)==='likes'?'likeRaw':'playRaw'];
        return Number.isSafeInteger(value) && value>=0?value:null;
    }
    function compare(a,b,sortBy){
        const left=count(a,sortBy),right=count(b,sortBy);
        return (left===null)-(right===null) || Number(right)-Number(left)
            || (Number(b.pubdate)||0)-(Number(a.pubdate)||0) || String(a.id).localeCompare(String(b.id));
    }
    function summary(list,sortBy){
        const selected=metric(sortBy),ranked=list.filter(v=>count(v,selected)!==null).length;
        return {metric:selected,label:selected==='likes'?'点赞':'播放量',ranked,unranked:list.length-ranked,exhaustive:false};
    }
    return {metric,count,compare,summary};
});
