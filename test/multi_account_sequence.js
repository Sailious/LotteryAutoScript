/**
 * 多账号串行执行链路测试（完全离线）
 *
 * 目的：验证 main.js 的多账号循环在「第1个账号正常结束后」确实会依次启动第2、3个账号。
 * 做法：把 utils / env / config / global_var / index / update 全部打桩，
 *       不发任何网络请求，不读写项目的 dyids、lottery_info 目录。
 *
 * 运行：node test/multi_account_sequence.js
 */
const path = require('path');
const Module = require('module');

function stub(module_path, exports) {
    const id = require.resolve(module_path);
    require.cache[id] = {
        id,
        filename: id,
        loaded: true,
        exports,
        children: [],
        paths: Module._nodeModulePaths(path.dirname(id))
    };
    return exports;
}

/** ---------- 记录执行轨迹 ---------- */
const trace = [];
const executed = [];

/** ---------- 打桩：utils ---------- */
const fakeLog = {
    _level: 3,
    _cache: [],
    _push(text) { this._cache.push(text); },
    init() { },
    rainbow() { },
    proPrint(msg) { trace.push('[print] ' + msg); },
    info(ctx, msg) { trace.push(`[Info] [帐号${process.env.NUMBER} ${ctx}] [${msg}]`); },
    notice(ctx, msg) { trace.push(`[Notice] [帐号${process.env.NUMBER} ${ctx}] [${msg}]`); },
    warn(ctx, msg) { trace.push(`[Warn] [帐号${process.env.NUMBER} ${ctx}] [${msg}]`); },
    error(ctx, msg) { trace.push(`[Error] [帐号${process.env.NUMBER} ${ctx}] [${msg}]`); },
    debug() { },
    debug_return(ctx, obj) { return obj; },
    progress_bar() { }
};

stub('../lib/utils', {
    version: '2.11.2',
    env_file: path.join(process.cwd(), 'env.js'),
    config_file: path.join(process.cwd(), 'my_config.js'),
    log: fakeLog,
    hasEnv: name => !!process.env[name],
    delay: async (t) => { trace.push(`[delay] ${t}ms`); },
    hasFileOrDir: () => true,
    clearLotteryInfo: async () => { trace.push('[clearLotteryInfo]'); },
    printIpInfo: () => { }
});

/** ---------- 打桩：env / config / global_var / index / update ---------- */
stub('../lib/data/env', {
    init: () => { },
    get_multiple_account: () => []
});

stub('../lib/data/config', {
    init: () => { },
    lottery_loop_wait: 0,
    check_loop_wait: 0,
    clear_loop_wait: 0,
    save_lottery_info_to_file: false
});

stub('../lib/data/global_var', {
    init: async () => { },
    get: () => '',
    set: () => { }
});

stub('../lib/index', {
    start: async num => { executed.push(String(num)); trace.push(`[start] 帐号${num} 抽奖开始`); },
    isMe: async () => { },
    clear: async () => { },
    account: async () => { },
    checkCookie: async () => true,
    login: async () => { }
});

stub('../lib/update', { update: async () => { } });

/** ---------- 准备环境变量 ---------- */
const ACCOUNTS = [
    { NUMBER: 1, COOKIE: 'cookie-1', WAIT: 5000 },
    { NUMBER: 2, COOKIE: 'cookie-2', WAIT: 5000 },
    { NUMBER: 3, COOKIE: 'cookie-3', WAIT: 5000 }
];

process.env.ENABLE_MULTIPLE_ACCOUNT = 'true';
process.env.MULTIPLE_ACCOUNT_PARM = JSON.stringify(ACCOUNTS);
/** 本测试验证「同一进程内顺序执行」这条回退路径，因此显式关闭子进程隔离 */
process.env.MULTI_ACCOUNT_ISOLATE = 'false';
process.env.COOKIE = 'cookie-1';
process.env.NUMBER = '1';
process.argv[2] = 'start';

/** main.js 结尾会调用 process.exit(0)，这里劫持它来做断言 */
const realExit = process.exit.bind(process);
// eslint-disable-next-line no-unused-vars
process.exit = (code) => {
    const failed = [];

    if (executed.length !== 3) {
        failed.push(`实际只执行了 ${executed.length} 个账号: [${executed.join(', ')}]`);
    }
    if (executed.join(',') !== '1,2,3') {
        failed.push(`账号执行顺序错误: [${executed.join(', ')}]，期望 [1, 2, 3]`);
    }
    /** 账号之间必须有等待，避免同 IP 频繁访问 */
    const waits = trace.filter(it => it === '[delay] 5000ms').length;
    if (waits !== 2) {
        failed.push(`账号间等待次数异常: ${waits} 次，期望 2 次`);
    }
    if (!trace.some(it => it.includes('共检测到3个账号'))) {
        failed.push('缺少「共检测到3个账号」日志');
    }
    if (!trace.some(it => it.includes('执行完毕(成功3/3)'))) {
        failed.push('缺少「执行完毕(成功3/3)」日志');
    }

    console.log('执行轨迹:');
    trace.forEach(it => console.log('  ' + it));
    console.log('\n参与抽奖的账号:', executed.join(', ') || '(无)');

    if (failed.length) {
        console.error('\n❌ 测试失败:');
        failed.forEach(it => console.error(' - ' + it));
        realExit(1);
    }
    console.log('\n✅ 测试通过：3 个账号按 1 → 2 → 3 顺序依次执行');
    realExit(0);
};

require('../main.js');
