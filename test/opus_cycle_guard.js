/**
 * 回归测试：Opus 合集互相引用（A↔B）时必须终止递归
 *
 * 复现 2026-10-20 云端日志中的故障：
 *   A(1234186409066102809) ↔ B(1234049163341070357) 互相引用
 *   → "未解析过，递归解析" 在 5 分钟内出现 776,984 次
 *   → Node 堆内存溢出 (4GB)，进程退出码 134，后续账号无法执行
 *
 * 本测试完全离线：bili / d_storage / collection_storage 全部打桩，不发任何网络请求、不写任何文件。
 * 运行：node test/opus_cycle_guard.js
 */
const path = require('path');
const Module = require('module');

/** 打桩：用假的模块替换 require 缓存中的真实模块 */
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

const A = '1234186409066102809';
const B = '1234049163341070357';
/** 普通抽奖动态（非合集） */
const NORMAL = ['1222230469914918914', '1111111111111111111', '2222222222222222222', '3333333333333333333'];

/** 构造一个最简动态卡片，parseDynamicCard 能从中取出 dynamic_id / description */
function makeCard(dyid, text) {
    return {
        item: {
            id_str: dyid,
            type: 'DYNAMIC_TYPE_WORD',
            basic: { comment_id_str: dyid },
            modules: {
                module_author: { mid: 1000, name: '测试UP', pub_ts: 1700000000 },
                module_dynamic: {
                    desc: {
                        rich_text_nodes: [
                            { type: 'RICH_TEXT_NODE_TYPE_TEXT', text, orig_text: text }
                        ]
                    }
                },
                module_stat: { like: { status: false } }
            }
        }
    };
}

/** A 引用 B（A 自身 2 个链接 → 判定为合集） */
const cards = {
    [A]: makeCard(A, `合集A t.bilibili.com/${NORMAL[0]} t.bilibili.com/${B}`),
    /** B 反向引用 A（B 共 5 个链接 → 也判定为合集） */
    [B]: makeCard(B, `合集B t.bilibili.com/${NORMAL[0]} t.bilibili.com/${A} t.bilibili.com/${NORMAL[1]} t.bilibili.com/${NORMAL[2]} t.bilibili.com/${NORMAL[3]}`)
};
for (const id of NORMAL) {
    cards[id] = makeCard(id, '普通动态，无内嵌链接');
}

/** 记录请求次数，用于断言"没有无限请求" */
let requestCount = 0;
const requestOrder = [];

stub('../lib/net/bili', {
    getOneDynamicByDyid: async (dyid) => {
        requestCount++;
        requestOrder.push(dyid);
        return cards[dyid] || null;
    },
    getOneOpusByDyid: async () => ''
});

stub('../lib/helper/d_storage', {
    searchDyid: async () => false,
    updateDyid: async () => { }
});

/** 合集解析状态：内存版 collection.txt */
const parsedCollections = new Set();
stub('../lib/helper/collection_storage', {
    searchCollection: async id => parsedCollections.has(String(id)),
    updateCollection: async id => { parsedCollections.add(String(id)); }
});

/** 配置必须在 require searcher 之前写入（searcher 会在加载时解构） */
const config = require('../lib/data/config');
config.article_deep_parse = true;
config.get_dynamic_detail_wait = 0;
config.check_if_duplicated = 0;

const { Searcher } = require('../lib/core/searcher');
const { log } = require('../lib/utils');
log._level = 0;

(async () => {
    const searcher = new Searcher();
    const started = Date.now();

    const infos = await searcher.handleOpusCollection(
        { dynamic_id: A, description: `合集A t.bilibili.com/${NORMAL[0]} t.bilibili.com/${B}`, type: 4 },
        '测试'
    );

    const cost = Date.now() - started;
    const failed = [];

    /** 1. 必须能返回（无线程挂死） */
    if (cost > 5000) failed.push(`递归耗时过长: ${cost}ms`);
    /** 2. 请求次数必须有界（互相引用只解析一轮） */
    if (requestCount > 10) failed.push(`请求次数异常: ${requestCount} 次，疑似仍在循环递归`);
    /** 3. 两个合集都应被记录为已解析，下次运行可直接跳过 */
    if (!parsedCollections.has(A)) failed.push('合集A未记录为已解析');
    if (!parsedCollections.has(B)) failed.push('合集B未记录为已解析');
    /** 4. 内嵌的普通抽奖动态应被收集到 */
    const dyids = infos.map(it => it.dyid);
    for (const id of NORMAL) {
        if (!dyids.includes(id)) failed.push(`普通抽奖动态${id}未被收集`);
    }

    console.log('耗时(ms):', cost);
    console.log('请求次数:', requestCount, requestOrder.join(' → '));
    console.log('已解析合集:', [...parsedCollections].join(', '));
    console.log('收集抽奖动态数:', infos.length);

    if (failed.length) {
        console.error('\n❌ 测试失败:');
        failed.forEach(it => console.error(' - ' + it));
        process.exit(1);
    }
    console.log('\n✅ 测试通过：A↔B 互相引用已被切断，递归正常终止');
})();
