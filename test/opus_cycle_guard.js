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
const assert = require('assert');
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
let opusRequestCount = 0;
const opusPages = new Map();

const bili = stub('../lib/net/bili', {
    getOneDynamicByDyid: async (dyid) => {
        requestCount++;
        requestOrder.push(dyid);
        return cards[dyid] || null;
    },
    getOneOpusByDyid: async id => {
        opusRequestCount++;
        const response = opusPages.get(String(id));
        if (response instanceof Error) throw response;
        return response || '';
    }
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
config.get_dynamic_detail_wait = 8000;
config.check_if_duplicated = 0;

const utils = require('../lib/utils');
const delays = [];
utils.delay = async ms => { delays.push(ms); };
const global_var = require('../lib/data/global_var');
global_var.set('opusCollectionCache', new Map());
const { Searcher } = require('../lib/core/searcher');
const { log } = utils;
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
    const PARSED = '4444444444444444444';
    parsedCollections.add(PARSED);
    const knownCollection = { dynamic_id: PARSED, type: 64, description: '' };
    const beforeKnownOpus = opusRequestCount;
    const beforeKnownDelays = delays.length;
    assert.deepStrictEqual(await searcher.handleOpusCollection(knownCollection), []);
    assert.strictEqual(opusRequestCount, beforeKnownOpus, '已解析合集不应重新抓HTML');
    assert.strictEqual(delays.length, beforeKnownDelays, '本地已解析命中不应产生延迟');

    /* 同一账号本次运行跨来源共享检测结果, 只缓存链接而非整页HTML */
    const CACHE = '5555555555555555555';
    const cacheInfo = { dynamic_id: CACHE, type: 64, description: '' };
    const html = `<html>t.bilibili.com/${NORMAL[0]} t.bilibili.com/${NORMAL[1]}</html>`;
    opusPages.set(CACHE, html);
    const beforeCacheOpus = opusRequestCount;
    const beforeCacheDelays = delays.length;
    const firstDetection = await Searcher.isOpusCollectionDynamic(cacheInfo, searcher.opusCollectionCache);
    const otherSource = new Searcher();
    assert.strictEqual(otherSource.opusCollectionCache, searcher.opusCollectionCache);
    assert.deepStrictEqual(await Searcher.isOpusCollectionDynamic(cacheInfo, otherSource.opusCollectionCache), firstDetection);
    assert.strictEqual(firstDetection.isCollection, true);
    assert.strictEqual(opusRequestCount, beforeCacheOpus + 1, '跨来源重复检测只抓一次HTML');
    assert.strictEqual(delays.length, beforeCacheDelays + 1, '缓存命中不产生等待');
    assert.strictEqual(delays[beforeCacheDelays], 8000, '真实请求保留原配置延迟');

    /* 正常非合集也缓存; 网络/页面失败不缓存, 下次来源允许重试 */
    const NEGATIVE = '6666666666666666666';
    opusPages.set(NEGATIVE, '<html>普通专栏，没有内嵌链接</html>');
    const negativeInfo = { dynamic_id: NEGATIVE, type: 64, description: '' };
    const beforeNegative = opusRequestCount;
    await Searcher.isOpusCollectionDynamic(negativeInfo, searcher.opusCollectionCache);
    await Searcher.isOpusCollectionDynamic(negativeInfo, searcher.opusCollectionCache);
    assert.strictEqual(opusRequestCount, beforeNegative + 1);
    assert.deepStrictEqual(searcher.opusCollectionCache.get(NEGATIVE), { isCollection: false });
    const FAILED = '7777777777777777777';
    for (const failure of ['', '[请求失败]: 请求超时', '[响应错误]HTTP状态码: 500', '[遇到页面错误]HTTP状态码: 412', new Error('temporary')]) {
        searcher.opusCollectionCache.delete(FAILED);
        opusPages.set(FAILED, failure);
        const failedInfo = { dynamic_id: FAILED, type: 64, description: '' };
        const beforeFailure = opusRequestCount;
        assert.strictEqual((await Searcher.isOpusCollectionDynamic(failedInfo, searcher.opusCollectionCache)).isCollection, false);
        assert.strictEqual(searcher.opusCollectionCache.has(FAILED), false, '失败检测不能固化到缓存');
        opusPages.set(FAILED, html);
        assert.strictEqual((await Searcher.isOpusCollectionDynamic(failedInfo, searcher.opusCollectionCache)).isCollection, true);
        assert.strictEqual(opusRequestCount, beforeFailure + 2);
    }

    /* 内层先检测、再递归处理同一type=64合集时, HTML只抓一次 */
    const NESTED = '8888888888888888888';
    cards[NESTED] = makeCard(NESTED, '');
    cards[NESTED].item.type = 'DYNAMIC_TYPE_ARTICLE';
    opusPages.set(NESTED, html);
    const beforeNested = opusRequestCount;
    const nested = await searcher.parseInnerLotteryLinksFromText(`t.bilibili.com/${NESTED}`, 'parent', new Map());
    assert.strictEqual(opusRequestCount, beforeNested + 1, '嵌套合集重复判定复用缓存');
    assert(nested.some(info => info.dyid === NORMAL[0]));
    assert(nested.some(info => info.dyid === NORMAL[1]));

    /* 专栏与UID来源在请求详情前跳过已解析合集 */
    bili.searchArticlesByKeyword = async () => [{ id: 123, pub_time: Math.floor(Date.now() / 1000) }];
    bili.getOneArticleByCv = async () => `t.bilibili.com/${PARSED}`;
    bili.shortDynamicIdToDyid = async () => { assert.fail('本用例不应请求短链'); };
    const beforeSourceRequests = requestCount;
    assert.deepStrictEqual(await searcher.getLotteryInfoByArticle('测试'), []);
    const originalCheckAllDynamic = Searcher.checkAllDynamic;
    Searcher.checkAllDynamic = async () => ({ allModifyDynamicResArray: [
        { type: 1, origin: { dynamic_id: PARSED } },
        knownCollection
    ] });
    try {
        assert.deepStrictEqual(await searcher.getLotteryInfoByUID('123'), []);
    } finally {
        Searcher.checkAllDynamic = originalCheckAllDynamic;
    }
    assert.strictEqual(requestCount, beforeSourceRequests, '已解析合集不请求详情');

    /* 专栏同时含普通卡片和内嵌合集时, 每条只转换一次 */
    const ARTICLE_COLLECTION = '9999999999999999999';
    const MALFORMED = '9999999999999999998';
    cards[ARTICLE_COLLECTION] = makeCard(ARTICLE_COLLECTION, '');
    cards[ARTICLE_COLLECTION].item.type = 'DYNAMIC_TYPE_ARTICLE';
    cards[MALFORMED] = {};
    opusPages.set(ARTICLE_COLLECTION, html);
    bili.getOneArticleByCv = async () => `t.bilibili.com/${ARTICLE_COLLECTION} t.bilibili.com/${NORMAL[0]} t.bilibili.com/${MALFORMED}`;
    const articleInfos = await searcher.getLotteryInfoByArticle('测试');
    assert(articleInfos.length >= 2);
    assert(articleInfos.every(utils.isValidLotteryInfo), '合集中的dyid/des/uids/ctrl必须保持交换数据结构');
    const innerInfo = articleInfos.find(info => info.dyid === NORMAL[1]);
    assert(innerInfo, '内嵌动态应保留');
    assert.strictEqual(innerInfo.des, '普通动态，无内嵌链接');
    assert.strictEqual(innerInfo.rid, NORMAL[1]);
    assert.deepStrictEqual(innerInfo.uids, [1000]);
    assert.strictEqual(innerInfo.lottery_info_type, 'article');
    assert(!articleInfos.some(info => info.dyid === MALFORMED));

    /* 下一轮替换缓存, 不把旧轮次检测结果带入新账号/新运行 */
    global_var.set('opusCollectionCache', new Map());
    const nextRun = new Searcher();
    assert.notStrictEqual(nextRun.opusCollectionCache, searcher.opusCollectionCache);
    const beforeNextRun = opusRequestCount;
    await Searcher.isOpusCollectionDynamic(cacheInfo, nextRun.opusCollectionCache);
    assert.strictEqual(opusRequestCount, beforeNextRun + 1);
    console.log('Opus前置跳过、检测缓存、失败重试与运行隔离测试通过');
    console.log('\n✅ 测试通过：A↔B 互相引用已被切断，递归正常终止');
})().catch(error => { console.error(error); process.exitCode = 1; });
