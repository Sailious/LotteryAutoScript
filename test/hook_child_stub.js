/**
 * 测试桩注入钩子
 *
 * 通过 `NODE_OPTIONS=--require ./test/hook_child_stub.js` 注入（子进程会自动继承 NODE_OPTIONS，
 * 因此父进程派生出来的每个账号子进程也会加载本钩子）。
 *
 * 仅在 LOTTERY_TEST_STUB=1 时生效，正常运行时完全不介入。
 *
 * 需求：运行目录必须是仓库根目录（main.js 所在目录）。
 */
const path = require('path');
const Module = require('module');

const root = process.cwd();

/**
 * 用假模块替换 require 缓存中的真实模块
 * @param {string} relative_path 相对仓库根目录的路径
 * @param {object} exports 假模块导出的内容
 */
function stub(relative_path, exports) {
    const id = path.join(root, relative_path);
    require.cache[id] = {
        id,
        filename: id,
        loaded: true,
        exports,
        children: [],
        paths: Module._nodeModulePaths(path.dirname(id))
    };
}

if (process.env.LOTTERY_TEST_STUB === '1') {
    /**
     * 模拟 env.js 里 account_parm 的覆盖行为：
     * 真实 env.init() 会用 account_parm 里的 COOKIE/NUMBER 覆盖 process.env，
     * 子进程如果不靠 LOTTERY_ACCOUNT_SEQ 再覆盖一次，就会全部跑成账号1。
     */
    stub('lib/data/env.js', {
        init: () => {
            process.env.COOKIE = 'PARM_COOKIE';
            process.env.NUMBER = '1';
        },
        get_multiple_account: () => []
    });

    /** 避免读写项目里的 dyids/ 目录 */
    stub('lib/data/global_var.js', {
        init: async () => { },
        get: () => '',
        set: () => { }
    });

    /** 跳过脚本更新检查，避免联网 */
    stub('lib/update.js', { update: async () => { } });

    /** 核心业务桩：不发任何请求；账号2 直接模拟堆内存溢出(退出码134)中止 */
    stub('lib/index.js', {
        start: async (num) => {
            if (String(num) === '2') {
                console.log('[stub] 模拟账号2 内存溢出，进程中止(134)');
                process.exit(134);
            }
            await new Promise(resolve => setTimeout(resolve, 10));
        },
        isMe: async () => { },
        clear: async () => { },
        account: async () => { },
        checkCookie: async () => true,
        login: async () => { }
    });

    /** 保留真实日志输出，但去掉会写文件的动作 */
    const utils = require(path.join(root, 'lib/utils.js'));
    utils.clearLotteryInfo = async () => { };
    utils.printIpInfo = () => { };
}
