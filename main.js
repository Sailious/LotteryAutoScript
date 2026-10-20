const {
    version: ve,
    env_file,
    config_file,
    log,
    hasEnv,
    delay,
    hasFileOrDir,
    clearLotteryInfo, printIpInfo
} = require('./lib/utils');
const { HttpsProxyAgent } = require('https-proxy-agent');
const request = require('https');
const path = require('path');
const { spawn } = require('child_process');
const metainfo = [
    '  _           _   _                   _____           _       _   ',
    ' | |         | | | |                 / ____|         (_)     | |  ',
    ' | |     ___ | |_| |_ ___ _ __ _   _| (___   ___ _ __ _ _ __ | |_ ',
    ' | |    / _ \\| __| __/ _ \\ \'__| | | |\\___ \\ / __| \'__| | \'_ \\| __|',
    ' | |___| (_) | |_| ||  __/ |  | |_| |____) | (__| |  | | |_) | |_ ',
    ' |______\\___/ \\__|\\__\\___|_|   \\__, |_____/ \\___|_|  |_| .__/ \\__|',
    '                                __/ |                  | |        ',
    '                               |___/                   |_|        ',
    '                                                                  ',
    `    This: v${ve}     Nodejs: ${process.version}     Written By shanmite`,
];
/**多账号存储 */
let multiple_account = [];
/**循环等待时间 */
let loop_wait = 0;
/**账号状态标记 1正常 -1失效 */
// eslint-disable-next-line no-unused-vars
let ck_flag = 0;

/**子进程标识所用的环境变量名：值为此账号在账号列表中的序号(从1开始) */
const CHILD_SEQ_ENV = 'LOTTERY_ACCOUNT_SEQ';

/**
 * 当前是否由父进程派生的「单账号子进程」
 * @returns {boolean}
 */
function is_child_process() {
    return !!process.env[CHILD_SEQ_ENV];
}

/**
 * 取多账号列表：优先env.js中的multiple_account_parm，其次环境变量MULTIPLE_ACCOUNT_PARM中的JSON
 * @returns {Object[]}
 */
function get_multiple_account_list() {
    if (multiple_account.length) {
        return multiple_account;
    }
    try {
        const list = JSON.parse(process.env.MULTIPLE_ACCOUNT_PARM || '[]');
        return Array.isArray(list) ? list : [];
    } catch (_) {
        return [];
    }
}

/**
 * 拼接代理地址
 * @param {Object} acco
 * @returns {string}
 */
function buildProxyUrl(acco) {
    return acco.PROXY_USER
        ? 'http://' + acco.PROXY_USER + ':' + acco.PROXY_PASS + '@' + acco.PROXY_HOST + ':' + acco.PROXY_PORT
        : 'http://' + acco.PROXY_HOST + ':' + acco.PROXY_PORT;
}

/**
 * 子进程专用：把父进程指定的账号写入环境变量
 *
 * 子进程启动时会重新加载env.js，其中account_parm里的单账号配置会覆盖父进程传来的值，
 * 因此必须在 env.init() 之后再覆盖一次，否则所有子进程都会跑成 account_parm 里那个账号。
 */
function apply_child_account_env() {
    if (!is_child_process()) {
        return;
    }
    const acco = get_multiple_account_list()[Number(process.env[CHILD_SEQ_ENV]) - 1];
    if (!acco) {
        log.error('子进程', `未找到序号为${process.env[CHILD_SEQ_ENV]}的账号配置，将按account_parm执行`);
        return;
    }

    process.env.COOKIE = acco.COOKIE;
    process.env.NUMBER = acco.NUMBER;
    process.env.CLEAR = acco.CLEAR;
    process.env.NOTE = acco.NOTE;
    process.env.ACCOUNT_UA = acco.ACCOUNT_UA;

    if (acco.PROXY_HOST) {
        request.globalAgent = new HttpsProxyAgent(buildProxyUrl(acco));
    }
}

/**
 * 多账号是否使用「每账号一个独立子进程」的隔离模式
 * @returns {boolean}
 */
function use_child_process() {
    /**pkg打包成单文件后无法再用自身去执行main.js脚本 */
    if (process.pkg) {
        return false;
    }
    /**留一个开关方便回退到同进程顺序执行 */
    if (String(process.env.MULTI_ACCOUNT_ISOLATE).toLowerCase() === 'false') {
        return false;
    }
    return true;
}

/**
 * 以独立子进程依次执行每个账号
 *
 * 相比同进程顺序执行，好处是：单个账号 OOM / abort / 未捕获异常只影响它自己，
 * 内存随进程退出自动回收，后续账号照常执行。
 *
 * @param {Object[]} muti_acco 账号列表
 * @param {string} mode 运行模式(process.argv[2])
 * @returns {Promise<string>} 全部账号都失败时返回首个错误信息
 */
async function runAccountsAsChildProcess(muti_acco, mode) {
    const main_path = path.join(__dirname, 'main.js');
    let first_err = '';
    let success_count = 0;

    for (let i = 0; i < muti_acco.length; i++) {
        const acco = muti_acco[i];
        const seq = i + 1;

        if (!acco.COOKIE) {
            log.warn('多账号', `第${seq}个账号(NUMBER:${acco.NUMBER})未配置COOKIE，跳过`);
            continue;
        }

        log.info('多账号', `开始执行第${seq}/${muti_acco.length}个账号(NUMBER:${acco.NUMBER})`);

        const child_env = {
            ...process.env,
            /**子进程自身不能再进多账号分支，否则会无限派生 */
            ENABLE_MULTIPLE_ACCOUNT: 'false',
            [CHILD_SEQ_ENV]: String(seq),
            /**子进程不必重复检查脚本更新 */
            LOTTERY_SKIP_UPDATE: '1'
        };

        /**@type {number} 子进程退出码：0成功，134为堆内存溢出，其余见Node文档 */
        const code = await new Promise((resolve) => {
            const child = spawn(process.execPath, [main_path, mode], {
                env: child_env,
                cwd: process.cwd(),
                stdio: 'inherit'
            });
            child.on('error', (err) => {
                log.error('多账号', `第${seq}个账号(NUMBER:${acco.NUMBER})子进程启动失败: ${err && err.message ? err.message : err}`);
                resolve(-1);
            });
            child.on('close', (exit_code) => resolve(exit_code === null ? -1 : exit_code));
        });

        if (code === 0) {
            success_count++;
            log.info('多账号', `第${seq}/${muti_acco.length}个账号(NUMBER:${acco.NUMBER})执行完毕`);
        } else {
            const reason = code === 134
                ? '进程被强制中止(134)：通常是内存溢出(OOM)'
                : code === -1 ? '子进程未能启动' : `退出码${code}`;
            log.error('多账号', `第${seq}/${muti_acco.length}个账号(NUMBER:${acco.NUMBER})执行失败：${reason}`);
            if (!first_err) {
                first_err = `第${seq}个账号(NUMBER:${acco.NUMBER})执行失败：${reason}`;
            }
        }

        if (seq < muti_acco.length) {
            const wait = Number(acco.WAIT) || 60 * 1000;
            await delay(code === 0 ? wait : 3 * 1000);
        }
    }

    log.info('多账号', `所有账号执行完毕(成功${success_count}/${muti_acco.length})`);
    return success_count ? '' : first_err;
}

/**
 * @returns {Promise<string>} 错误信息
 */
async function main() {
    const { COOKIE, NUMBER, CLEAR, ENABLE_MULTIPLE_ACCOUNT, MULTIPLE_ACCOUNT_PARM } = process.env;
    /**环境变量一律是字符串，'false' 也是真值，必须显式判断，否则会把多账号模式误开启/误关闭 */
    const multi_enabled = ENABLE_MULTIPLE_ACCOUNT === true
        || String(ENABLE_MULTIPLE_ACCOUNT).toLowerCase() === 'true';
    if (multi_enabled) {
        let muti_acco = [];
        if (multiple_account.length) {
            muti_acco = multiple_account;
        } else {
            try {
                muti_acco = JSON.parse(MULTIPLE_ACCOUNT_PARM);
            } catch (_) {
                return `多账号参数MULTIPLE_ACCOUNT_PARM不是合法的JSON: ${MULTIPLE_ACCOUNT_PARM}`;
            }
        }

        if (!Array.isArray(muti_acco)) {
            return '多账号参数必须是数组，请检查env.js中的multiple_account_parm配置';
        }

        process.env.ENABLE_MULTIPLE_ACCOUNT = '';

        /**多账号执行情况显式打印，便于日志中直接核对是否真的跑到了第2、3个账号 */
        log.info('多账号', `共检测到${muti_acco.length}个账号，将按顺序依次执行`);
        if (!muti_acco.length) {
            log.warn('多账号', '账号列表为空，请检查env.js中的multiple_account_parm配置');
        }

        /**默认每个账号一个独立子进程：单账号崩溃/OOM不会牵连后续账号 */
        if (use_child_process() && muti_acco.length) {
            log.info('多账号', '执行模式: 独立子进程(单账号崩溃不影响后续账号)');
            const err_msg = await runAccountsAsChildProcess(muti_acco, process.env.lottery_mode);
            process.env.ENABLE_MULTIPLE_ACCOUNT = ENABLE_MULTIPLE_ACCOUNT;
            /**周期重跑交给父进程：所有账号跑完一轮后再整体重来 */
            const { lottery_loop_wait } = require('./lib/data/config');
            loop_wait = err_msg ? 0 : (lottery_loop_wait || 0);
            return err_msg;
        }

        log.info('多账号', '执行模式: 同一进程内顺序执行');

        let localhost = request.globalAgent;

        /**记录首个错误与成功账号数：只有全部账号都失败时，才把错误抛给外层 */
        let first_err = '';
        let success_count = 0;

        for (let i = 0; i < muti_acco.length; i++) {
            const acco = muti_acco[i];
            const seq = i + 1;

            if (!acco.COOKIE) {
                log.warn('多账号', `第${seq}个账号(NUMBER:${acco.NUMBER})未配置COOKIE，跳过`);
                continue;
            }

            log.info('多账号', `开始执行第${seq}/${muti_acco.length}个账号(NUMBER:${acco.NUMBER})`);

            process.env.COOKIE = acco.COOKIE;
            process.env.NUMBER = acco.NUMBER;
            process.env.CLEAR = acco.CLEAR;
            process.env.NOTE = acco.NOTE;
            process.env.ACCOUNT_UA = acco.ACCOUNT_UA;
            /**每个账号开始前重置状态标记 */
            ck_flag = 0;
            if (acco.PROXY_HOST) {
                printIpInfo(true);
                //http://ip:port
                //http://user:pwd@ip:port'
                const proxyUrl = acco.PROXY_USER
                    ? 'http://' + acco.PROXY_USER + ':' + acco.PROXY_PASS + '@' + acco.PROXY_HOST + ':' + acco.PROXY_PORT
                    : 'http://' + acco.PROXY_HOST + ':' + acco.PROXY_PORT;
                request.globalAgent = new HttpsProxyAgent(proxyUrl);
                printIpInfo(false);
            }else {
                //未设置还原
                request.globalAgent = localhost;
            }

            let err_msg;
            try {
                err_msg = await main();
            } catch (e) {
                /**单账号异常不能中断整轮运行，否则后面的账号永远不会被执行 */
                log.error('多账号', `第${seq}个账号(NUMBER:${acco.NUMBER})运行异常: ${e && e.stack ? e.stack : e}`);
                err_msg = null;
            }

            request.globalAgent = localhost;

            if (err_msg) {
                log.error('多账号', `第${seq}个账号(NUMBER:${acco.NUMBER})返回错误: ${err_msg}`);
                /**单个账号的错误不应阻塞剩余账号 */
                if (!first_err) first_err = err_msg;
                continue;
            }

            success_count++;
            log.info('多账号', `第${seq}/${muti_acco.length}个账号(NUMBER:${acco.NUMBER})执行完毕`);
            if (seq < muti_acco.length) {
                const wait = Number(acco.WAIT) || 60 * 1000;
                if (ck_flag === 1) {
                    await delay(wait);
                } else {
                    await delay(3 * 1000);
                }
            }
        }
        /**多账号状态还原 */
        process.env.ENABLE_MULTIPLE_ACCOUNT = ENABLE_MULTIPLE_ACCOUNT;
        log.info('多账号', `所有账号执行完毕(成功${success_count}/${muti_acco.length})`);
        if (!success_count && first_err) {
            return first_err;
        }
    } else if (COOKIE) {
        /**配置自检：明明写了多个账号却没开多账号开关，是从日志里最容易误判的一种情况 */
        if (multiple_account.length > 1) {
            log.warn('多账号', `env.js中已配置${multiple_account.length}个账号，但ENABLE_MULTIPLE_ACCOUNT未开启，本次只执行account_parm中的帐号${NUMBER}`);
        }

        const global_var = require('./lib/data/global_var');
        await global_var.init(COOKIE, NUMBER);

        /**引入基础功能 */
        const { start, isMe, clear, account, checkCookie, login } = require('./lib/index');

        log.info('main', '当前为第' + NUMBER + '个账号');
        log._cache.length = 0;

        const mode = process.env.lottery_mode;
        const help_msg = '用法: lottery [OPTIONS]\n\nOPTIONS:\n\tstart  启动抽奖\n\tcheck  中奖检查\n\tacount 查看帐号信息\n\tclear  清理动态和关注\n\tlogin 扫码登录更新CK\n\tupdate 检查更新\n\thelp   帮助信息';
        if (await checkCookie(NUMBER)) {
            const {
                lottery_loop_wait,
                check_loop_wait,
                clear_loop_wait,
                save_lottery_info_to_file
            } = require('./lib/data/config');
            ck_flag = 1;
            switch (mode) {
                case 'start':
                    log.info('抽奖', '开始运行');
                    /**子进程只跑自己这一个账号，周期重跑交给父进程统一调度，否则第2、3个账号永远等不到 */
                    loop_wait = is_child_process() ? 0 : lottery_loop_wait;
                    if (save_lottery_info_to_file) {
                        await clearLotteryInfo();
                    }
                    await start(NUMBER);
                    break;
                case 'check':
                    log.info('中奖检测', '检查是否中奖');
                    loop_wait = check_loop_wait;
                    await isMe(NUMBER);
                    break;
                case 'clear':
                    if (CLEAR) {
                        log.info('清理动态', '开始运行');
                        loop_wait = clear_loop_wait;
                        await clear();
                    }
                    break;
                case 'login':
                    log.info('登录状态', '正常，跳过扫码');
                    break;
                case 'help':
                    return help_msg;
                case 'account':
                    log.info('检查帐号信息', '开始运行');
                    await account();
                    break;
                case undefined:
                    return '未提供以下参数\n\t[OPTIONS]\n\n' + help_msg;
                default:
                    return `提供了错误的[OPTIONS] -> ${mode}\n\n` + help_msg;
            }
        } else {
            log.error('Cookie已失效', '切换账号时不要点击退出账号而应直接删除Cookie退出');
            ck_flag = -1;
            if (mode === 'login') {
                log.info('登陆', '开始扫码');
                await login(NUMBER);
                await delay(1000);
            }
        }
    } else {
        return '请查看README文件, 在env.js指定位置填入cookie';
    }
}

/**
 * 初始化环境
 * @returns {boolean} 出错true
 */
function initEnv() {
    if (hasFileOrDir(env_file)) {
        const
            env = require('./lib/data/env'),
            multiple_account_parm = env.get_multiple_account();

        if (multiple_account_parm) {
            multiple_account = multiple_account_parm;
        }

        env.init();
        log.init();
        apply_child_account_env();
        log.info('环境变量初始化', '成功加载env.js文件');
    } else if (hasEnv('COOKIE') || hasEnv('MULTIPLE_ACCOUNT_PARM')) {
        log.init();
        apply_child_account_env();
        log.info('环境变量初始化', '成功从环境变量中读取COOKIE设置');
    } else {
        log.init();
        log.error('环境变量初始化', '未在当前目录下找到env.js文件或者在环境变量中设置所需参数');
        return true;
    }

    return false;
}

/**
 * 初始化设置
 * @returns {boolean} 出错true
 */
function initConfig() {
    if (hasFileOrDir(config_file)) {
        const config = require('./lib/data/config');
        config.init();
        log.info('配置文件初始化', '成功加载my_config.js文件');
    } else {
        log.error('配置文件初始化', '未在当前目录下找到my_config.js文件');
        return true;
    }

    return false;
}

(async function () {
    log.rainbow(metainfo);

    if (initEnv() || initConfig()) return;

    /**OPTIONS */
    process.env.lottery_mode = process.argv[2];

    log.info('检查更新', '开始');

    if (process.env.lottery_mode === 'update') {
        await require('./lib/update').update(true);
        return;
    } else if (process.env.LOTTERY_SKIP_UPDATE) {
        log.info('检查更新', '子进程模式，跳过重复的版本检查');
    } else {
        await require('./lib/update').update(false);
    }

    const err_msg = await main();
    if (err_msg) {
        log.error('错误', err_msg);
        log.warn('结束运行', '5秒后自动退出');
        await delay(5 * 1000);
        /**子进程把失败通过退出码反馈给父进程，父进程据此判断后续账号是否继续 */
        process.exit(is_child_process() ? 1 : 0);
    } else {
        while (loop_wait) {
            log.info('程序休眠', `${loop_wait / 1000}秒后再次启动`);
            await delay(loop_wait);
            if (initEnv() || initConfig()) return;
            await main();
        }
        log.info('结束运行', '未在my_config.js中设置休眠时间');
    }

    process.exit(0);
})();