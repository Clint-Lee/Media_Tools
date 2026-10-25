'use strict';
// T01 全局禁网守卫：npm test 串起的离线套件默认不得发出任何未声明的出站请求。
// 此前"通过"不等于严格离线——被 catch 吞掉的意外外访不会让测试失败（REVIEW_2026-10-21 T01）。
// 只放行本机回环（127.0.0.1 / ::1 / localhost / *.localhost）与保留测试顶级域（*.test）；
// 其余域名解析与直连 IP 一律拒绝。需要真实网络的验收套件
// （test:live / test:platform-data / test:rankings 等独立 script）不挂载本守卫。
// 调试逃生口：HOTPOT_ALLOW_TEST_NET=1 临时停用；不得用于"凑通过"。
const dns = require('dns');
const net = require('net');

const GUARD_MESSAGE = '测试禁网守卫：该请求未声明为离线路径的一部分。请在测试中显式 mock 该来源（参见 docs/RELIABILITY.md），而不是访问真实网络。';

function isLocalHost(value) {
    const host = String(value || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '::ffff:127.0.0.1'
        || host.endsWith('.localhost') || host.endsWith('.test');
}

if (process.env.HOTPOT_ALLOW_TEST_NET === '1') {
    console.warn('[net-guard] 已通过 HOTPOT_ALLOW_TEST_NET=1 停用禁网守卫（仅限调试，不用于验收）');
} else {
    const originalLookup = dns.lookup;
    dns.lookup = function (hostname, options, callback) {
        if (typeof options === 'function') { callback = options; options = {}; }
        if (isLocalHost(hostname)) return originalLookup.call(dns, hostname, options, callback);
        process.nextTick(() => callback(new Error(GUARD_MESSAGE)));
    };
    const originalPromisesLookup = dns.promises.lookup;
    dns.promises.lookup = function (hostname, options) {
        if (isLocalHost(hostname)) return originalPromisesLookup.call(dns.promises, hostname, options);
        return Promise.reject(new Error(GUARD_MESSAGE));
    };
    // resolve* 家族永远走真实 DNS 服务器，离线套件一律拒绝
    for (const method of ['resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCaa', 'resolveCname',
        'resolveMx', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt']) {
        dns[method] = (...args) => {
            const callback = args[args.length - 1];
            if (typeof callback === 'function') process.nextTick(() => callback(new Error(GUARD_MESSAGE)));
        };
    }
    // 直连 IP 绕过 DNS，必须单独拦（hostname 会经由上面的 dns.lookup 拒绝）
    const originalCreateConnection = net.createConnection;
    net.createConnection = function (...args) {
        const options = typeof args[0] === 'object' && args[0] !== null ? args[0] : {};
        if (options.host && net.isIP(options.host) && !isLocalHost(options.host)) throw new Error(GUARD_MESSAGE);
        return originalCreateConnection.apply(net, args);
    };
}

module.exports = { isLocalHost, GUARD_MESSAGE };
