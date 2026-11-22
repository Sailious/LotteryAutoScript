const utils = require('./utils');
const event_bus = require('./helper/event_bus');
const global_var = require('./data/global_var');
const { Searcher } = require('./core/searcher');
const { Monitor } = require('./core/monitor');
const config = require('./data/config');
const { randomDynamic } = require('./helper/randomDynamic');
const { sendNotify } = require('./helper/notify');
const { log } = utils;

async function createRandomDynamic(num) {
    if (config.create_dy) {
        log.info('随机动态', `准备创建${num}条随机动态`);
        const
            { allModifyDynamicResArray } = (await utils.retryfn(
                3,
                [null],
                () => Searcher.checkAllDynamic(global_var.get('myUID'), 1)
            )) || { allModifyDynamicResArray: [] },
            { type, origin_type } = allModifyDynamicResArray[0] || {};
        if (type === 1 && origin_type !== 8) {
            await randomDynamic(num);
        } else {
            log.info('随机动态', '已有非抽奖动态故无需创建');
        }
    }
}

/**
 * 抽奖主函数
 * @param {string} num
 * @returns {Promise<void>}
 */
function start(num) {
    return new Promise(resolve => {
        global_var.set('runStats', undefined);
        global_var.getRunStats();
        global_var.set('tagSourceAttempts', 0);
        global_var.set('tagSourceFailures', 0);
        global_var.set('tagSourceFuzzyMappings', []);
        global_var.set('opusCollectionCache', new Map());
        global_var.set('aiCommentCache', new Map());
        global_var.set('aiCommentAttempts', new Set());
        /* 每次运行重新读取关注列表, 同一次运行内由 Monitor 复用 */
        global_var.set('attentionList', undefined);
        let times = utils.counter();
        /* 注册事件 */
        event_bus.on('Turn_on_the_Monitor', async () => {
            const lotterys = global_var.get('Lottery');
            if (lotterys.length === 0) {
                log.info('抽奖', '抽奖信息为空');
                event_bus.emit('Turn_off_the_Monitor', '抽奖信息为空');
                return;
            }
            if (times.value() === lotterys.length) {
                log.info('抽奖', '所有动态转发完毕');
                times.clear();
                event_bus.emit('Turn_off_the_Monitor', '目前无抽奖信息,过一会儿再来看看吧');
                return;
            }
            const lottery = lotterys[times.next()];

            await (new Monitor(lottery)).init();
        });
        event_bus.on('Turn_off_the_Monitor', async (msg) => {
            log.info('结束抽奖', '原因: ' + msg);
            const stats = global_var.getRunStats();
            const relayed_sum = stats.relayed;
            const summary = `成功转发${stats.relayed} · 规则/业务跳过${stats.skipped} · 操作失败${stats.failed}（网络/接口${stats.request_failed}） · 演练${stats.simulated} · 分区失败${stats.partition_failed} · 准备失败${stats.preflight_failed} · 未处理${stats.unprocessed}`;
            const ai_summary = `AI评论请求${stats.ai_comment_requested}次 · 耗时${stats.ai_comment_ms}ms · 失败${stats.ai_comment_failed}次 · 通用回退${stats.ai_comment_fallback}次 · 跳过${stats.ai_comment_skipped}条`;
            const tag_source_attempts = global_var.get('tagSourceAttempts') || 0;
            const tag_source_failures = global_var.get('tagSourceFailures') || 0;
            const tag_source_fuzzy_mappings = global_var.get('tagSourceFuzzyMappings') || [];
            const tag_source_warnings = [
                tag_source_failures
                    ? `话题来源获取失败: ${tag_source_failures}/${tag_source_attempts} 个，本次未能采集这些话题的动态；请检查 B 站话题接口或网络状态`
                    : '',
                tag_source_fuzzy_mappings.length
                    ? `话题模糊匹配 ${tag_source_fuzzy_mappings.length} 个: ${tag_source_fuzzy_mappings.join('；')}；监控范围已收窄到匹配话题`
                    : ''
            ].filter(Boolean);
            const tag_source_warning = tag_source_warnings.join('\n');
            log.info('统计', `本次运行共参与${relayed_sum}个抽奖`);
            log.info('运行摘要', `处理${stats.processed}条；${summary}`);
            log.info('AI评论统计', ai_summary);
            if (tag_source_warning) {
                log.warn('话题监控', tag_source_warning);
            }
            if (config.notice_running_state) {
                const title_status = [
                    stats.failed || stats.preflight_failed ? `运行异常${stats.failed + stats.preflight_failed}` : '',
                    stats.simulated ? `演练${stats.simulated}` : '',
                    tag_source_failures ? `话题源异常${tag_source_failures}/${tag_source_attempts}` : '',
                    tag_source_fuzzy_mappings.length ? `模糊匹配${tag_source_fuzzy_mappings.length}` : ''
                ].filter(Boolean).join('+');
                const title = title_status
                    ? `动态抽奖-帐号${num}${title_status}-共参与${relayed_sum}个抽奖`
                    : `动态抽奖-帐号${num}结束抽奖-共参与${relayed_sum}个抽奖`;
                try {
                    await sendNotify(
                        title,
                        `处理${stats.processed}条；${summary}\n${ai_summary}\n结束原因: ${msg}\n${stats.last_request_error ? `最近写请求失败: ${stats.last_request_error}\n` : ''}${tag_source_warning ? `${tag_source_warning}\n` : ''}本次运行共参与${relayed_sum}个抽奖\n${log._cache.filter(it => /抽奖\]|Error|\s抽奖信息\]/.test(it)).join('\n')}`
                    );
                } catch (error) {
                    log.error('发送运行通知', error.message);
                }
            }
            await createRandomDynamic(config.create_dy_num);
            event_bus.flush();
            resolve();
        });
        event_bus.emit('Turn_on_the_Monitor');
    });
}


module.exports = { start };