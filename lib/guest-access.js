'use strict';

const crypto=require('crypto');
const COOKIE='hotpot_visitor',TTL=8*3600000,LIMIT=20,IP_LIMIT=60,MAX_EMPTY_PER_IP=20;
const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(Date.now());
const failure=(message,status=429)=>Object.assign(new Error(message),{status});
function createStore() {
    const visitors=new Map(),ips=new Map(),reservations=new Map(),totals=new Map(),activeOwners=new Map();
    function entry(owner) { const value=visitors.get(owner); if(!value)throw failure('访客会话已结束，请刷新页面',409); return value; }
    const empty=(value,owner)=>!activeOwners.has(owner) && !value.pending && !value.used && !value.history.length;
    const ipKey=(ip,date)=>JSON.stringify([ip,date]);
    function connect(owner,ip) {
        const date=day();
        for(const [key,value]of visitors)if(value.expiresAt<Date.now() && !value.pending && !activeOwners.has(key))visitors.delete(key);
        for(const [key,value]of ips)if(value.date!==date && !value.pending)ips.delete(key);
        if(!visitors.has(owner)) {
            // An unused homepage session may be replaced; never evict active work or private history.
            const unused=[...visitors].filter(([key,value])=>empty(value,key));
            const sameIp=unused.filter(([,value])=>value.ip===ip);
            if(sameIp.length>=MAX_EMPTY_PER_IP)visitors.delete(sameIp[0][0]);
            if(visitors.size>=1000 && unused.length)visitors.delete(unused[0][0]);
            if(visitors.size>=1000)throw failure('当前访客会话过多，请稍后重试');
            visitors.set(owner,{ip,date,used:0,pending:0,history:[],expiresAt:Date.now()+TTL});
        }
        let value=entry(owner);
        // Reservations retain their original daily objects, so late settlement cannot charge the new day.
        if(value.date!==date) {value={...value,date,used:0,pending:0};visitors.set(owner,value);}
        if(!ips.has(ipKey(value.ip,date)))ips.set(ipKey(value.ip,date),{date,used:0,pending:0});
        return value;
    }
    function quota(owner) { const previous=entry(owner),e=previous.date===day()?previous:connect(owner,previous.ip);return {date:e.date,timeZone:'Asia/Shanghai',used:e.used,pending:e.pending,limit:LIMIT,remaining:Math.max(0,LIMIT-e.used-e.pending)}; }
    function reserve(owner,action) {
        const previous=entry(owner),e=connect(owner,previous.ip),ip=ips.get(ipKey(e.ip,e.date));
        if(e.used+e.pending>=LIMIT || ip.used+ip.pending>=IP_LIMIT)throw failure('访客处理额度已用完，请稍后重试；不要求扫码或手机登录。');
        const id=crypto.randomUUID(); e.pending++;ip.pending++;activeOwners.set(owner,(activeOwners.get(owner) || 0)+1);reservations.set(id,{e,ip,action,owner});return id;
    }
    function settle(id,success) {const r=reservations.get(id);if(!r)return;r.e.pending--;r.ip.pending--;if(success){r.e.used++;r.ip.used++;}reservations.delete(id);const remaining=activeOwners.get(r.owner)-1;if(remaining)activeOwners.set(r.owner,remaining);else activeOwners.delete(r.owner);}
    function log(owner,event) {
        const e=entry(owner);e.history.unshift({...event,id:crypto.randomUUID(),timestamp:Date.now()});e.history=e.history.slice(0,100);
        if(event.kind==='parse' && event.status==='parsed'){const date=day(),row=totals.get(date) || {totalCount:0,platforms:{}};row.totalCount++;const p=event.platform || 'other';row.platforms[p]=(row.platforms[p] || 0)+1;totals.set(date,row);for(const key of totals.keys())if(key!==date)totals.delete(key);}
    }
    function history(owner) {return entry(owner).history;}
    function clearHistory(owner,id) {const e=entry(owner);e.history=id?e.history.filter(row=>row.id!==id):[];}
    function statistics(){return totals.get(day()) || {totalCount:0,platforms:{}};}
    return {connect,quota,reserve,settle,log,history,clearHistory,statistics};
}
const store=createStore();
function access(optionalUser) {
    return (req,res,next)=>{
        try {
            if(req.headers['sec-fetch-site']==='cross-site')throw failure('拒绝跨站发起媒体处理',403);
            const user=optionalUser(req);
            if(user)req.user=user;
            else {
                let token=String(req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
                const match=token?.match(/^(\d{13})\.([a-f0-9]{64})$/),time=Number(match?.[1]);
                if(!match || time>Date.now()+300000 || Date.now()-time>TTL) {
                    token=Date.now()+'.'+crypto.randomBytes(32).toString('hex');
                    res.cookie(COOKIE,token,{httpOnly:true,sameSite:'strict',secure:req.secure,path:'/'});
                }
                const owner='guest:'+crypto.createHash('sha256').update(token).digest('hex');
                store.connect(owner,req.ip);req.user={username:owner,role:'guest',guest:true,quota:store.quota(owner)};
            }
            res.setHeader('Cache-Control','private, no-store');next();
        }catch(error){res.status(error.status || 503).json({success:false,message:error.message});}
    };
}
module.exports={...store,access,createStore,LIMIT,IP_LIMIT};
