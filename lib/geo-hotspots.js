'use strict';

const CITY_CATALOG = Object.freeze([
    ['北京', '中国', 39.9042, 116.4074, ['北京', 'beijing', '京城', '帝都']],
    ['上海', '中国', 31.2304, 121.4737, ['上海', 'shanghai', '魔都']],
    ['广州', '中国', 23.1291, 113.2644, ['广州', 'guangzhou', '羊城']],
    ['深圳', '中国', 22.5431, 114.0579, ['深圳', 'shenzhen']],
    ['成都', '中国', 30.5728, 104.0668, ['成都', 'chengdu']],
    ['重庆', '中国', 29.4316, 106.9123, ['重庆', 'chongqing']],
    ['杭州', '中国', 30.2741, 120.1551, ['杭州', 'hangzhou']],
    ['武汉', '中国', 30.5928, 114.3055, ['武汉', 'wuhan']],
    ['西安', '中国', 34.3416, 108.9398, ['西安', "xi'an", 'xian']],
    ['南京', '中国', 32.0603, 118.7969, ['南京', 'nanjing']],
    ['长沙', '中国', 28.2282, 112.9388, ['长沙', 'changsha']],
    ['苏州', '中国', 31.2989, 120.5853, ['苏州', 'suzhou']],
    ['天津', '中国', 39.3434, 117.3616, ['天津', 'tianjin']],
    ['青岛', '中国', 36.0671, 120.3826, ['青岛', 'qingdao']],
    ['厦门', '中国', 24.4798, 118.0894, ['厦门', 'xiamen']],
    ['哈尔滨', '中国', 45.8038, 126.5349, ['哈尔滨', 'harbin']],
    ['沈阳', '中国', 41.8057, 123.4315, ['沈阳', 'shenyang']],
    ['昆明', '中国', 25.0389, 102.7183, ['昆明', 'kunming']],
    ['郑州', '中国', 34.7466, 113.6254, ['郑州', 'zhengzhou']],
    ['济南', '中国', 36.6512, 117.1201, ['济南', 'jinan']],
    ['福州', '中国', 26.0745, 119.2965, ['福州', 'fuzhou']],
    ['香港', '中国', 22.3193, 114.1694, ['香港', 'hong kong', 'hongkong']],
    ['澳门', '中国', 22.1987, 113.5439, ['澳门', 'macao', 'macau']],
    ['台北', '中国', 25.0330, 121.5654, ['台北', 'taipei']],
    ['东京', '日本', 35.6762, 139.6503, ['东京', 'tokyo', '日本']],
    ['大阪', '日本', 34.6937, 135.5023, ['大阪', 'osaka']],
    ['首尔', '韩国', 37.5665, 126.9780, ['首尔', 'seoul', '韩国', 'korea']],
    ['新加坡', '新加坡', 1.3521, 103.8198, ['新加坡', 'singapore']],
    ['曼谷', '泰国', 13.7563, 100.5018, ['曼谷', 'bangkok', '泰国', 'thailand']],
    ['伦敦', '英国', 51.5072, -0.1276, ['伦敦', 'london', '英国', 'britain', 'united kingdom']],
    ['巴黎', '法国', 48.8566, 2.3522, ['巴黎', 'paris', '法国', 'france']],
    ['柏林', '德国', 52.5200, 13.4050, ['柏林', 'berlin', '德国', 'germany']],
    ['莫斯科', '俄罗斯', 55.7558, 37.6173, ['莫斯科', 'moscow', '俄罗斯', 'russia']],
    ['纽约', '美国', 40.7128, -74.0060, ['纽约', 'new york', 'nyc']],
    ['洛杉矶', '美国', 34.0522, -118.2437, ['洛杉矶', 'los angeles']],
    ['旧金山', '美国', 37.7749, -122.4194, ['旧金山', 'san francisco']],
    ['华盛顿', '美国', 38.9072, -77.0369, ['华盛顿', 'washington dc', 'washington d.c.']],
    ['多伦多', '加拿大', 43.6532, -79.3832, ['多伦多', 'toronto']],
    ['温哥华', '加拿大', 49.2827, -123.1207, ['温哥华', 'vancouver']],
    ['悉尼', '澳大利亚', -33.8688, 151.2093, ['悉尼', 'sydney', '澳大利亚', 'australia']],
    ['墨尔本', '澳大利亚', -37.8136, 144.9631, ['墨尔本', 'melbourne']],
    ['迪拜', '阿联酋', 25.2048, 55.2708, ['迪拜', 'dubai', '阿联酋', 'uae']],
    ['孟买', '印度', 19.0760, 72.8777, ['孟买', 'mumbai']],
    ['新德里', '印度', 28.6139, 77.2090, ['新德里', 'new delhi', '印度', 'india']],
    ['雅加达', '印度尼西亚', -6.2088, 106.8456, ['雅加达', 'jakarta', '印度尼西亚', 'indonesia']],
    ['马尼拉', '菲律宾', 14.5995, 120.9842, ['马尼拉', 'manila', '菲律宾', 'philippines']],
    ['墨西哥城', '墨西哥', 19.4326, -99.1332, ['墨西哥城', 'mexico city', '墨西哥', 'mexico']],
    ['圣保罗', '巴西', -23.5505, -46.6333, ['圣保罗', 'são paulo', 'sao paulo', '巴西', 'brazil']],
    ['开罗', '埃及', 30.0444, 31.2357, ['开罗', 'cairo', '埃及', 'egypt']]
].map(([city, country, lat, lng, aliases]) => ({ city, country, lat, lng,
    // A country mention is not evidence for a particular city.
    aliases: aliases.filter(alias => alias === city || ![country, 'korea', 'thailand', 'britain', 'united kingdom', 'france', 'germany', 'russia', 'australia', 'uae', 'india', 'indonesia', 'philippines', 'mexico', 'brazil', 'egypt'].includes(alias))
})));

function findAlias(text, alias) {
    const normalizedAlias = alias.toLowerCase();
    if (/^[a-z0-9 .'-]+$/.test(normalizedAlias)) {
        const escaped = normalizedAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = text.match(new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i'));
        return match ? match.index : -1;
    }
    return text.indexOf(normalizedAlias);
}

function inferVideoLocation(video) {
    const title = String(video?.title || '').toLowerCase();
    const publicLocation = String(video?.pubLocation || video?.pub_location || '').toLowerCase();
    const secondary = String(video?.description || '').toLowerCase();
    let best = null;

    for (const location of CITY_CATALOG) {
        for (const alias of location.aliases) {
            const titleIndex = findAlias(title, alias);
            const publicIndex = findAlias(publicLocation, alias);
            const secondaryIndex = findAlias(secondary, alias);
            const score = publicIndex >= 0
                ? 20000 - publicIndex + alias.length
                : (titleIndex >= 0
                    ? 10000 - titleIndex + alias.length
                    : (secondaryIndex >= 0 ? 1000 - secondaryIndex + alias.length : -1));
            if (score >= 0 && (!best || score > best.score)) {
                best = { location, score, alias, source: publicIndex >= 0 ? 'public_location' : 'content_keyword' };
            }
        }
    }

    if (!best) return null;
    return {
        city: best.location.city,
        country: best.location.country,
        lat: best.location.lat,
        lng: best.location.lng,
        source: best.source,
        matched: best.alias
    };
}

function attachVideoLocations(videos) {
    return (Array.isArray(videos) ? videos : []).map(video => {
        const geo = video.geo || inferVideoLocation(video);
        return geo ? { ...video, geo } : video;
    });
}

module.exports = {
    CITY_CATALOG,
    attachVideoLocations,
    inferVideoLocation
};
