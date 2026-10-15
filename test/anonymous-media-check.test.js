'use strict';
// 联网诊断：逐项记录实际结果，失败不会被打印为“全平台通过”。
const fs=require('fs'),path=require('path');
const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:4000';
(async()=>{
    process.env.TEST_GUEST='1';const {cookie}=await require('./live-auth').liveAuth(base);
    const report={checkedAt:new Date().toISOString(),anonymous:true,authStatus:401,checks:[]};
    const api=async(url,body)=>{const r=await fetch(base+url,{signal:AbortSignal.timeout(75000),headers:{Cookie:cookie,'Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok || !data.success)throw new Error(data.message || data.error);return data;};
    const samples=[];
    for(const platform of ['douyin','tiktok','kuaishou','xiaohongshu','twitter'])try{const feed=await api('/api/trends?platform='+platform);if(!feed.list[0])throw new Error('公开列表为空，未完成该平台媒体验收');const video=feed.list.find(v=>parseInt(v.duration)>0 && parseInt(v.duration)<=60) || feed.list[0];samples.push({platform,url:video.url,kind:'download'});}catch(error){report.checks.push({platform,stage:'feed',status:'unavailable',message:error.message});}
    samples.push({platform:'youtube',url:'https://www.youtube.com/watch?v=M7lc1UVf-VE',kind:'transcript'});
    for(const sample of samples){let stage='parse';const start=Date.now();try{
        const parsed=(await api('/api/parse',{url:sample.url})).data;stage=sample.kind;
        let job=(await api('/api/media/jobs',{url:parsed.url,mediaId:parsed.mediaId,kind:sample.kind})).job;
        const deadline=Date.now()+150000;
        while(!['complete','failed'].includes(job.status) && Date.now()<deadline){await new Promise(r=>setTimeout(r,1200));job=(await api('/api/media/jobs/'+job.id)).job;}
        if(job.status!=='complete')throw new Error(job.error || '诊断等待超过150秒，未假报完成');
        const row={...sample,status:'complete',ms:Date.now()-start,subtitleLines:job.transcript?.lineCount,subtitleSource:job.transcript?.source,hasAudio:job.hasAudio};
        if(job.downloadUrl){const response=await fetch(base+job.downloadUrl,{headers:{Cookie:cookie},signal:AbortSignal.timeout(60000)});if(!response.ok)throw new Error('实际文件读取失败');const bytes=Buffer.from(await response.arrayBuffer());if(!bytes.length)throw new Error('返回空文件');const directory=path.join(__dirname,'..','.cache','verification');fs.mkdirSync(directory,{recursive:true});const filename=path.join(directory,'anonymous-'+sample.platform+'.mp4');fs.writeFileSync(filename,bytes);row.bytes=bytes.length;
            const python=process.env.MEDIA_PYTHON || path.join(__dirname,'..','.runtime','venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
            row.streams=JSON.parse(require('child_process').execFileSync(python,['-c','import av,json,sys; c=av.open(sys.argv[1]); print(json.dumps([{"type":s.type,"codec":s.codec_context.name} for s in c.streams]))',filename],{encoding:'utf8',windowsHide:true}));
            if(!row.streams.some(s=>s.type==='video') || !row.streams.some(s=>s.type==='audio'))throw new Error('实际样本没有同时验证视频与音轨，未通过有声MP4验收');
        }
        report.checks.push(row);console.log(JSON.stringify(row));
    }catch(error){const row={...sample,stage,status:'unavailable',ms:Date.now()-start,message:error.message};report.checks.push(row);console.log(JSON.stringify(row));}}
    const filename=path.join(__dirname,'..','.cache','verification','anonymous-media-report.json');fs.mkdirSync(path.dirname(filename),{recursive:true});fs.writeFileSync(filename,JSON.stringify(report,null,2));
    console.log('Recorded actual anonymous media results; unavailable entries remain incomplete.');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
