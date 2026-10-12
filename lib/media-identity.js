'use strict';
function identity(value) {
    const url=new URL(value), host=url.hostname.toLowerCase();
    const match=domain=>host===domain || host.endsWith('.'+domain);
    if(match('youtube.com')) return (url.searchParams.get('v') || url.pathname.match(/\/(?:shorts|embed|live)\/([\w-]{11})/)?.[1]) || null;
    if(match('youtu.be')) return url.pathname.split('/')[1] || null;
    if(match('tiktok.com')) return url.pathname.match(/\/(?:video|v)\/(\d{15,22})/)?.[1] || null;
    if(match('twitter.com') || match('x.com')) return url.pathname.match(/\/status\/(\d+)/)?.[1] || null;
    if(match('kuaishou.com') || match('gifshow.com')) return url.pathname.match(/\/(?:short-video|photo)\/([\w-]+)/)?.[1] || url.searchParams.get('photoId') || null;
    if(match('instagram.com')) return url.pathname.match(/\/(?:p|reel|reels|tv)\/([\w-]+)/)?.[1] || null;
    if(match('xiaohongshu.com')) return url.pathname.match(/\/(?:explore|discovery\/item)\/([a-f\d]{24})/i)?.[1] || null;
    return null;
}
function assertIdentity(url,info) {
    const expected=identity(url), returned=info.webpage_url ? identity(info.webpage_url) : null;
    if(!expected || returned && returned!==expected || !returned && String(info.id)!==expected) throw new Error('媒体编号无法核验或与输入作品不一致，不用其它推荐视频替代');
    return expected;
}
function redNote(state,url) {
    const expected=identity(url); if(!expected)throw new Error('小红书原链接缺少可验证笔记编号');
    const direct=state.note?.noteDetailMap?.[expected]?.note;
    const note=direct || Object.values(state.note?.noteDetailMap || {}).map(v=>v?.note).find(n=>n?.noteId===expected || n?.note_id===expected);
    if(!note || (note.noteId || note.note_id) && (note.noteId || note.note_id)!==expected) throw new Error('未找到与输入编号一致的小红书笔记，不使用详情页推荐笔记');
    return note;
}
module.exports={identity,assertIdentity,redNote};
