'use strict';
function timestamp(value) { const parts=value.trim().replace(',','.').split(':').map(Number); return parts.length===3 ? parts[0]*3600+parts[1]*60+parts[2] : parts.length===2 ? parts[0]*60+parts[1] : NaN; }
function segmentsFromTrack(body,ext) {
    if(ext==='json3') {
        const json=typeof body==='string'?JSON.parse(body):body;
        return (json.events || []).filter(event=>event.segs && Number(event.dDurationMs)>0).map(event=>({startSec:event.tStartMs/1000,endSec:(event.tStartMs+event.dDurationMs)/1000,text:event.segs.map(s=>s.utf8 || '').join('').trim()}));
    }
    if(ext==='vtt' || ext==='srt') {
        return String(body).replace(/\r/g,'').split(/\n\s*\n/).flatMap(block=>{
            const lines=block.split('\n'),index=lines.findIndex(line=>line.includes('-->'));
            if(index<0)return [];
            const match=lines[index].match(/([\d:.]+)\s*-->\s*([\d:.]+)/); if(!match)return [];
            const text=lines.slice(index+1).join(' ').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim();
            return [{startSec:timestamp(match[1]),endSec:timestamp(match[2]),text}];
        });
    }
    throw new Error('不支持的真实字幕格式');
}
function chooseTracks(data) {
    const human=Object.keys(data.subtitleTracks || {}).length>0;
    const tracks=human?data.subtitleTracks:data.automaticCaptionTracks || {};
    const languages=Object.keys(tracks).sort((a,b)=>(a.startsWith('zh')?0:a.startsWith('en')?1:2)-(b.startsWith('zh')?0:b.startsWith('en')?1:2));
    return languages.flatMap(language=> (tracks[language] || []).filter(track=>['json3','vtt','srt'].includes(track.ext) && track.url).sort((a,b)=>(a.ext==='json3'?0:1)-(b.ext==='json3'?0:1)).map(track=>({...track,language,automatic:!human}))).slice(0,4);
}
module.exports={timestamp,segmentsFromTrack,chooseTracks};
