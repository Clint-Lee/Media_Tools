'use strict';

// 公开页面可能显示“2d ago / 8mo ago”，不能把无法解析的日期补成今天。
function relativeAge(text) {
    const clean = String(text || '').toLowerCase().trim();
    const num = Number(clean.match(/\d+(?:\.\d+)?/)?.[0]);
    if (!Number.isFinite(num)) return null;
    const units = [
        [/\b(?:years?|yrs?|y)\b|年/, 365 * 86400], [/\b(?:months?|mos?|mo)\b|月/, 30 * 86400],
        [/\b(?:weeks?|wks?|w)\b|周|星期/, 7 * 86400], [/\b(?:days?|d)\b|天/, 86400],
        [/\b(?:hours?|hrs?|h)\b|小时/, 3600], [/\b(?:minutes?|mins?|m)\b|分钟/, 60],
        [/\b(?:seconds?|secs?|s)\b|秒/, 1]
    ];
    const normalized = clean.replace(/(\d)([a-z])/g, '$1 $2');
    const unit = units.find(([pattern]) => pattern.test(normalized));
    return unit ? { seconds: num * unit[1], upperSeconds: (num + 1) * unit[1] } : null;
}

function searchFilter(timeRange) {
    // Search URL protobuf：字段1为播放量排序(3)，字段2包含上传日期与视频类型。
    // 3天用平台近一周候选再严格做本地边界校验，半年用近一年候选。
    const upload = { today: 2, '3days': 3, '7days': 3, '1month': 4, '6months': 5 }[timeRange];
    const filters = upload ? [0x08, upload, 0x10, 1] : [0x10, 1];
    return Buffer.from([0x08, 3, 0x12, filters.length, ...filters]).toString('base64');
}

module.exports = { relativeAge, searchFilter };
