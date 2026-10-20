/**
 * 多账号「独立子进程」模式测试
 *
 * 验证三件事：
 *   1. 父进程按 1 → 2 → 3 依次为每个账号派生独立子进程；
 *   2. 每个子进程都拿到属于自己的账号配置（NUMBER 分别为 1/2/3，而不是全被 env.js 的 account_parm 覆盖成 1）；
 *   3. 第 2 个账号像线上一样「内存溢出中止(134)」，第 3 个账号仍然照常执行 —— 也就是本次修复的核心目标。
 *
 * 全离线：业务模块由 test/hook_child_stub.js 通过 NODE_OPTIONS 注入替换，不发请求、不写记录文件。
 * 运行：node test/multi_account_child_process.js
 */
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

const ACCOUNTS = [
    { NUMBER: 1, COOKIE: 'cookie-1', WAIT: 100 },
    { NUMBER: 2, COOKIE: 'cookie-2', WAIT: 100 },
    { NUMBER: 3, COOKIE: 'cookie-3', WAIT: 100 }
];

const result = spawnSync(process.execPath, ['main.js', 'start'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120 * 1000,
    env: {
        ...process.env,
        NODE_OPTIONS: '--require ./test/hook_child_stub.js',
        LOTTERY_TEST_STUB: '1',
        ENABLE_MULTIPLE_ACCOUNT: 'true',
        MULTIPLE_ACCOUNT_PARM: JSON.stringify(ACCOUNTS),
        LOTTERY_LOG_LEVEL: '3'
    }
});

if (result.error) {
    console.error('❌ 启动失败:', result.error.message);
    process.exit(1);
}

const out = `${result.stdout || ''}${result.stderr || ''}`;
const failed = [];

/** 1. 每个账号都必须真的起来（日志里 帐号N main 当前为第N个账号） */
for (const acco of ACCOUNTS) {
    if (!out.includes(`[帐号${acco.NUMBER} main] [当前为第${acco.NUMBER}个账号]`)) {
        failed.push(`第${acco.NUMBER}个账号没有启动（未出现「当前为第${acco.NUMBER}个账号」）`);
    }
}

/** 2. 顺序必须是 1 → 2 → 3 */
const idx = ACCOUNTS.map(acco => out.indexOf(`[帐号${acco.NUMBER} main]`));
if (idx.some(i => i < 0) || !(idx[0] < idx[1] && idx[1] < idx[2])) {
    failed.push(`账号执行顺序错误，位置: ${idx.join(' / ')}`);
}

/** 3. 必须走子进程模式 */
if (!out.includes('执行模式: 独立子进程')) {
    failed.push('没有走「独立子进程」模式');
}

/** 4. 账号2 的中止必须被父进程识别，且不影响账号3 */
if (!out.includes('进程被强制中止(134)')) {
    failed.push('没有识别出账号2的退出码134（OOM中止）');
}
if (!out.includes('所有账号执行完毕(成功2/3)')) {
    failed.push('成功计数不对，应该是 成功2/3');
}

/** 5. 不应有任何意外账号被派生（NUMER=4） */
if (/帐号4 main/.test(out)) {
    failed.push('出现了第4个账号，账号列表长度判断有误');
}

/** 输出关键行，便于人工核对 */
const key_lines = out.split('\n').filter(it => /多账号|当前为第|stub|执行模式/.test(it));
console.log('关键日志:');
key_lines.forEach(it => console.log('  ' + it.trim()));

if (failed.length) {
    console.error('\n❌ 测试失败:');
    failed.forEach(it => console.error(' - ' + it));
    console.error(`\n完整输出:\n${out}`);
    process.exit(1);
}
console.log('\n✅ 测试通过：3 个账号各自独立子进程执行，账号2 OOM 中止不影响账号3');
