'use strict';
function imageFormat(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
    if (buffer.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff]))) return { mime:'image/jpeg', ext:'jpg' };
    if (buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return { mime:'image/png', ext:'png' };
    if (/^GIF8[79]a$/.test(buffer.subarray(0,6).toString())) return { mime:'image/gif', ext:'gif' };
    if (buffer.subarray(0,4).toString()==='RIFF' && buffer.subarray(8,12).toString()==='WEBP') return { mime:'image/webp', ext:'webp' };
    if (buffer.subarray(4,8).toString()==='ftyp' && /avif|avis/.test(buffer.subarray(8,32).toString())) return { mime:'image/avif', ext:'avif' };
    return null;
}
module.exports = { imageFormat };
