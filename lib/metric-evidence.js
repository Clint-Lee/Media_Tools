'use strict';
const fields={views:['playRaw','view'],likes:['likeRaw','like'],comments:['commentCount','comment'],shares:['shareCount','share'],collects:['collectCount','collect']};
function readMetric(input,kind='views') {
    const unknown={value:null,precision:'unknown',text:'',lowerBound:null};
    if(typeof input==='number')return Number.isSafeInteger(input) && input>=0?{value:input,precision:'integer',text:String(input),lowerBound:null}:unknown;
    if(typeof input!=='string')return unknown;
    const text=input.trim();
    if(kind==='views' && /^no views$/i.test(text))return {value:0,precision:'integer',text,lowerBound:null};
    const suffix={views:'views?|次播放|播放|次观看|观看',likes:'likes?|点赞|赞',comments:'comments?|评论',shares:'shares?|分享',collects:'收藏'}[kind] || '';
    const match=text.match(new RegExp('^((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?)\\s*([kmb亿万千]?)(\\+)?(?:\\s*(?:'+suffix+'))?$','i'));
    if(!match)return unknown;
    const multiplier={'':1,k:1000,m:1e6,b:1e9,千:1000,万:10000,亿:1e8}[match[2].toLowerCase()];
    const numeric=Number(match[1].replace(/,/g,''))*multiplier,rounded=Math.round(numeric);
    if(!Number.isSafeInteger(rounded) || rounded<0 || Math.abs(numeric-rounded)>1e-6)return unknown;
    return {value:match[3]?null:rounded,precision:match[3]?'lower-bound':match[2]?'source-rounded':'integer',text,lowerBound:match[3]?rounded:null};
}
function metricFields(kind,input) {
    const [key,prefix]=fields[kind],reading=readMetric(input,kind);
    return {[key]:reading.value,[prefix+'Precision']:reading.precision,[prefix+'CountText']:reading.text,[prefix+'LowerBound']:reading.lowerBound};
}
function normalizeMetric(raw,kind) {
    const [key,prefix]=fields[kind];
    let value=raw[key];
    // An explicit null is a new unknown observation, never a reason to revive an old display value.
    if(!Object.hasOwn(raw,key)) {
        if(kind==='views')value=raw.playCount;
        if(kind==='likes' && raw.metric==='likes')value=raw.metricRaw;
    }
    const result=metricFields(kind,value);
    if(result[key]!==null && raw.isCached && !raw[prefix+'Precision'])result[prefix+'Precision']='unverified';
    if(result[key]!==null && ['source-rounded','unverified'].includes(raw[prefix+'Precision'])) {
        result[prefix+'Precision']=raw[prefix+'Precision'];
        result[prefix+'CountText']=raw[prefix+'CountText'] || result[prefix+'CountText'];
    }
    if(value===null && raw[prefix+'Precision']==='lower-bound' && Number.isSafeInteger(raw[prefix+'LowerBound']) && raw[prefix+'LowerBound']>=0) {
        result[prefix+'Precision']='lower-bound';result[prefix+'LowerBound']=raw[prefix+'LowerBound'];result[prefix+'CountText']=raw[prefix+'CountText'] || String(raw[prefix+'LowerBound'])+'+';
    }
    return result;
}
module.exports={readMetric,metricFields,normalizeMetric};
