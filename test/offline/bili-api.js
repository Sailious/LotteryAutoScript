const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const querystring = require('querystring');
const nodeHttp = require('http');
const https = require('https');
const { EventEmitter } = require('events');
/* 传输层打桩(须早于加载 http.js): 按队列返回网络错误或响应体, 不发真实请求 */
let transport = [];
let transportCalls = 0;
https.request = (options, callback) => {
    transportCalls++;
    const req = new EventEmitter();
    req.end = () => setImmediate(() => {
        const next = transport.shift();
        if (next instanceof Error) return req.emit('error', next);
        const res = new EventEmitter();
        Object.assign(res, { statusCode: 200, headers: {}, setEncoding: () => res });
        callback(res);
        res.emit('data', next);
        res.emit('end');
    });
    return req;
};
const http = require('../../lib/net/http');
const realSend = http.send;
const requests = [];
let responses = [];
http.send = request => {
    requests.push(request);
    const response = responses.shift();
    assert.notStrictEqual(response, undefined, 'unexpected request');
    if (typeof response === 'string') request.failure(response);
    else request.success({ body: JSON.stringify(response) });
};
const globals = require('../../lib/data/global_var');
const config = require('../../lib/data/config');
config.search_wait = 0;
const bili = require('../../lib/net/bili');
const { Searcher } = require('../../lib/core/searcher');
const { Monitor } = require('../../lib/core/monitor');
const eventBus = require('../../lib/helper/event_bus');
const { log, strToJson } = require('../../lib/utils');
globals.set('cookie', 'SESSDATA=test');
globals.set('csrf', 'csrf-test');
globals.set('myUID', 123);
config.get_partition_wait = 0;

function setup(...values) {
    requests.length = 0;
    responses = values;
}
const page = (ids, total) => ({ code: 0, data: { total, list: ids.map(mid => ({ mid })) } });
const makeTopicDynamic = dyid => ({
    id_str: String(dyid),
    type: 'DYNAMIC_TYPE_WORD',
    basic: { comment_id_str: String(dyid) },
    modules: {
        module_author: { mid: 456, name: '测试话题UP', pub_ts: 1700000000 },
        module_dynamic: {
            desc: { rich_text_nodes: [{ type: 'RICH_TEXT_NODE_TYPE_TEXT', text: '抽奖动态', orig_text: '抽奖动态' }] }
        },
        module_stat: { like: { status: false } }
    }
});

(async () => {
    const originalInfo = log.info;
    const logs = [];
    log.info = (...args) => { logs.push(args); originalInfo.apply(log, args); };
    setup(page([12, 123], 3), page([456], 3));
    assert.strictEqual(await bili.getAttentionList(123), '12,123,456');
    log.info = originalInfo;
    assert(logs.some(([label, message]) => label === '获取关注列表' && message === '开始分页读取'));
    assert(logs.some(([label, message]) => label === '获取关注列表' && message.includes('第1页') && message.includes('2/3')));
    assert(logs.some(([label, message]) => label === '获取关注列表' && message.includes('第2页') && message.includes('3/3')));
    assert.strictEqual(requests.length, 2);
    assert.deepStrictEqual(requests.map(r => r.query), [
        { vmid: 123, pn: 1, ps: 50 }, { vmid: 123, pn: 2, ps: 50 }
    ]);
    assert.strictEqual(requests[0].headers.referer, 'https://www.bilibili.com/');
    setup(page([], 0));
    assert.strictEqual(await bili.getAttentionList(123), '');
    for (const second of [{ code: -352, message: 'blocked' }, page([], 2), page([1], 2), '[响应错误]HTTP状态码: 404']) {
        setup(page([1], 2), second);
        assert.strictEqual(await bili.getAttentionList(123), null);
    }
    setup({ code: 0, data: {} });
    assert.strictEqual(await bili.getAttentionList(123), null);

    setup({ code: 0, data: { result: 0 } });
    const text = '😀转发@小明 #话题#@好友';
    const ctrl = JSON.stringify([
        { type: 1, location: 4, length: 3, data: '123' },
        { type: 1, location: 12, length: 3, data: '456' }
    ]);
    assert.strictEqual(await bili.autoRelay(123, '1244325070220820481', text, ctrl), 0);
    const r = requests[0];
    assert.strictEqual(r.url, 'https://api.bilibili.com/x/dynamic/feed/create/dyn');
    assert.strictEqual(r.headers['content-type'], 'application/json');
    assert.deepStrictEqual(r.query, { csrf: 'csrf-test', platform: 'web' });
    assert.strictEqual(r.config.retry, false);
    assert.strictEqual(r.contents.web_repost_src.dyn_id_str, '1244325070220820481');
    assert.deepStrictEqual(r.contents.dyn_req.content.contents, [
        { raw_text: '😀转发', type: 1, biz_id: '' },
        { raw_text: '@小明', type: 2, biz_id: '123' },
        { raw_text: ' #话题#', type: 1, biz_id: '' },
        { raw_text: '@好友', type: 2, biz_id: '456' }
    ]);
    setup({ code: 0 });
    assert.strictEqual(await bili.autoRelay(123, '99', 'a'.repeat(230) + '@好友啊', JSON.stringify([{ type: 1, location: 230, length: 4, data: '1' }])), 0);
    assert.strictEqual(requests[0].contents.dyn_req.content.contents[0].raw_text.length, 230);
    setup({ code: 0 });
    assert.strictEqual(await bili.autoRelay(123, '99', 'a'.repeat(232) + '😀', '[]'), 0);
    assert.strictEqual(requests[0].contents.dyn_req.content.contents[0].raw_text.length, 232);
    setup();
    assert.strictEqual(await bili.autoRelay(123, '99', 'hello', '[bad'), 1);
    assert.strictEqual(requests.length, 0);
    for (const [response, expected] of [[{ code: 1101004 }, 2], [{ code: 2201116 }, 3], [{ code: 1101008 }, 4], [{ code: 4126117 }, 5], [{ code: 0, data: { result: 1 } }, 1], ['HTTP 404', 1]]) {
        setup(response);
        assert.strictEqual(await bili.autoRelay(123, '99'), expected);
    }

    setup({ code: 0, data: {} });
    assert.strictEqual(await bili.sendChat('1244325070220820481', '测试', 17), 0);
    assert.strictEqual(requests[0].url, 'https://api.bilibili.com/x/v2/reply/add');
    assert.strictEqual(requests[0].config.retry, false);
    assert.strictEqual(requests[0].contents.oid, '1244325070220820481');
    assert.strictEqual(requests[0].contents.csrf, 'csrf-test');
    assert.match(requests[0].headers['content-type'], /application\/x-www-form-urlencoded/);
    for (const response of [{ code: 12002 }, { code: 12052 }]) {
        setup(response);
        assert.strictEqual(await bili.sendChat('1', '测试', 17), 3);
    }
    setup({ code: 12015 });
    assert.strictEqual(await bili.sendChat('1', '测试', 17), 4);
    setup({ code: 0, data: { need_captcha: true, url: 'https://example.com/captcha' } });
    delete process.env.ENABLE_CHAT_CAPTCHA_OCR;
    assert.strictEqual(await bili.sendChatWithOcr('1', '测试', 17), 4);
    setup('HTTP 404');
    assert.strictEqual(await bili.sendChat('1', '测试', 17), 1);

    /* 关注列表只在存在真实候选时加载；失败仍终止，有效空列表不是失败 */
    const originalGetAttentionList = bili.getAttentionList;
    const originalEmit = eventBus.emit;
    const followSettings = {
        model: '11', chatmodel: '00', is_not_create_partition: true,
        check_if_duplicated: 0, wait: 0, only_followed: false,
        create_dy: false, minfollower: 0, disable_reserve_lottery: false, reserve_lottery_wait: 0,
        save_lottery_info_to_file: false, set_lottery_info_url: ''
    };
    const savedFollowSettings = Object.fromEntries(Object.keys(followSettings).map(key => [key, config[key]]));
    const savedDryRunFlag = process.env.NOT_GO_LOTTERY;
    const savedFollowJudgeFlag = process.env.ENABLE_AI_JUDGE;
    const originalReserveLottery = bili.reserve_lottery;
    const events = [];
    let attentionReads = 0;
    eventBus.emit = (...args) => events.push(args);
    Object.assign(config, followSettings);
    delete process.env.NOT_GO_LOTTERY;
    delete process.env.ENABLE_AI_JUDGE;
    globals.set('attentionList', undefined);
    bili.getAttentionList = async () => { attentionReads++; return null; };
    const followCandidate = {
        lottery_info_type: 'tag', dyid: '9999999999999999990',
        des: '转发抽奖', uids: [123], uname: '测试UP', ctrl: [],
        type: 4, hasOfficialLottery: true, chat_type: 0, reserve_id: 0, reserve_lottery_text: ''
    };
    const monitor = new Monitor(['UIDs', 1]);
    try {
        monitor.LotteryInfoMap.set('UIDs', async () => []);
        await monitor.init();
        for (const filteredPost of [
            { ...followCandidate, is_liked: true },
            { ...followCandidate, des: '' },
            { ...followCandidate, create_time: 1 },
            { ...followCandidate, is_charge_lottery: true },
            { ...followCandidate, des: '今天分享散步的照片', hasOfficialLottery: false }
        ]) {
            monitor.LotteryInfoMap.set('UIDs', async () => [filteredPost]);
            await monitor.init();
        }
        assert.strictEqual(attentionReads, 0, '没有候选或全部被规则过滤时不加载关注列表');
        assert.strictEqual(globals.get('attentionList'), undefined);

        events.length = 0;
        monitor.LotteryInfoMap.set('UIDs', async () => [followCandidate]);
        await monitor.init();
        assert.strictEqual(attentionReads, 1);
        assert.deepStrictEqual(events[0], ['Turn_off_the_Monitor', '关注列表获取失败']);
        assert.strictEqual(globals.get('attentionList'), undefined, '失败结果不能变成空关注缓存');

        bili.getAttentionList = async () => { attentionReads++; return '123,456'; };
        const followed = await monitor.filterLotteryInfo();
        assert.strictEqual(attentionReads, 2);
        assert.deepStrictEqual(followed[0].uid, []);
        assert.strictEqual(monitor.attentionList.has('123'), true);
        assert.strictEqual(monitor.attentionList.has('12'), false);
        assert.strictEqual(globals.get('attentionList'), monitor.attentionList);

        const nextSource = new Monitor(['UIDs', 2]);
        nextSource.LotteryInfoMap.set('UIDs', async () => [{ ...followCandidate, uids: [789] }]);
        assert.deepStrictEqual((await nextSource.filterLotteryInfo())[0].uid, [789]);
        assert.strictEqual(attentionReads, 2, '同一运行跨来源只读一次完整列表');
        assert.strictEqual(nextSource.attentionList, monitor.attentionList);

        /* 同批候选和后续来源共享新关注，成功/已关注才更新 */
        config.check_if_duplicated = -1;
        const option = { uid: [789], dyid: '99', relay_chat: '转发动态', ctrl: '[]' };
        setup({ code: 0 }, { code: 0 });
        assert.strictEqual(await nextSource.go(option), 0);
        assert.strictEqual(requests.length, 2);
        assert.strictEqual(monitor.attentionList.has('789'), true);
        setup({ code: 0 });
        assert.strictEqual(await nextSource.go(option), 0);
        assert.strictEqual(requests.length, 1, '同批后续候选不再重复关注');
        setup({ code: 22014 }, { code: 0 });
        assert.strictEqual(await nextSource.go({ ...option, uid: [111] }), 0);
        assert.strictEqual(monitor.attentionList.has('111'), true);
        setup({ code: 22003 });
        assert.strictEqual(await nextSource.go({ ...option, uid: [222] }), 2003);
        assert.strictEqual(monitor.attentionList.has('222'), false);
        setup({ code: 22009 });
        assert.strictEqual(await nextSource.go({ ...option, uid: [333] }), 2005);
        assert.strictEqual(monitor.attentionList.has('333'), false);

        config.only_followed = true;
        assert.strictEqual((await nextSource.filterLotteryInfo()).length, 1, '新关注在只转已关注筛选中立即生效');
        nextSource.LotteryInfoMap.set('UIDs', async () => [{ ...followCandidate, uids: [222] }]);
        assert.deepStrictEqual(await nextSource.filterLotteryInfo(), []);
        assert.strictEqual(attentionReads, 2);

        globals.set('attentionList', undefined);
        config.only_followed = false;
        bili.getAttentionList = async () => { attentionReads++; return ''; };
        assert.deepStrictEqual((await nextSource.filterLotteryInfo())[0].uid, [222]);
        assert.strictEqual(globals.get('attentionList').size, 0);
        await nextSource.filterLotteryInfo();
        assert.strictEqual(attentionReads, 3, '有效空列表也应复用');

        /* 关注上限后, 已在本批次关注的候选仍需继续, 仍缺关注的候选才跳过 */
        const capped = new Monitor(['UIDs', 3]);
        capped.attentionList = globals.get('attentionList');
        capped.filterLotteryInfo = async () => [
            { uid: [789, 333], dyid: 'partial-follow', drawtime: -1 },
            { uid: [789], dyid: 'now-followed', drawtime: -1 },
            { uid: [333], dyid: 'still-unfollowed', drawtime: -1 }
        ];
        const batchGoCalls = [];
        capped.go = async lottery => {
            batchGoCalls.push(lottery.dyid);
            if (lottery.dyid === 'partial-follow') {
                capped.attentionList.add('789');
                return 2005;
            }
            return 0;
        };
        const storage = require('../../lib/helper/d_storage');
        const originalUpdateDyid = storage.updateDyid;
        const originalRandom = Math.random;
        const batchStored = [];
        storage.updateDyid = async id => { batchStored.push(id); };
        Math.random = () => 0.999;
        try {
            assert.strictEqual(await capped.startLottery(), 2005);
            assert.deepStrictEqual(batchGoCalls, ['partial-follow', 'now-followed']);
            assert(batchStored.includes('now-followed'));
            assert(!batchStored.includes('still-unfollowed'));
        } finally {
            storage.updateDyid = originalUpdateDyid;
            Math.random = originalRandom;
        }

        /* 读取关注列表失败时, 预约POST也不能先执行 */
        globals.set('attentionList', undefined);
        let reserveWrites = 0;
        bili.reserve_lottery = async () => { reserveWrites++; return 0; };
        bili.getAttentionList = async () => { attentionReads++; return null; };
        monitor.LotteryInfoMap.set('UIDs', async () => [{ ...followCandidate, reserve_id: '7' }]);
        events.length = 0;
        await monitor.init();
        assert.strictEqual(attentionReads, 4);
        assert.strictEqual(reserveWrites, 0);
        assert.deepStrictEqual(events[0], ['Turn_off_the_Monitor', '关注列表获取失败']);
        assert.strictEqual(globals.get('attentionList'), undefined);
    } finally {
        bili.getAttentionList = originalGetAttentionList;
        bili.reserve_lottery = originalReserveLottery;
        eventBus.emit = originalEmit;
        Object.assign(config, savedFollowSettings);
        if (savedDryRunFlag === undefined) delete process.env.NOT_GO_LOTTERY;
        else process.env.NOT_GO_LOTTERY = savedDryRunFlag;
        if (savedFollowJudgeFlag === undefined) delete process.env.ENABLE_AI_JUDGE;
        else process.env.ENABLE_AI_JUDGE = savedFollowJudgeFlag;
    }

    /* 保存/读取只使用临时目录, 重复保存同来源dyid覆盖而非累积 */
    const dataUtils = require('../../lib/utils');
    const savedInfoDir = dataUtils.lottery_info_dir;
    const savedNumber = process.env.NUMBER;
    const tempInfoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lottery-info-test-'));
    dataUtils.lottery_info_dir = tempInfoDir;
    process.env.NUMBER = '1';
    const validInfo = {
        ...followCandidate, dyid: '1234567890123456789', is_liked: true
    };
    const otherInfo = { ...validInfo, dyid: '1234567890123456790' };
    const invalidInfos = [
        null, { ...validInfo, dyid: undefined }, { ...validInfo, dyid: '' },
        { ...validInfo, dyid: 'undefined' }, { ...validInfo, dyid: null },
        { ...validInfo, dyid: Number('1234567890123456789') },
        { ...validInfo, uids: undefined }, { ...validInfo, ctrl: null },
        { ...validInfo, type: 1, ctrl: [null] },
        { ...validInfo, type: 1, ctrl: ['bad mention'] },
        { ...validInfo, type: 1, ctrl: [[]] },
        { ...validInfo, type: 1, ctrl: [{ location: '0', length: 3, type: 1, data: '456' }] },
        { ...validInfo, type: 1, ctrl: [{ location: 0, length: 0, type: 1, data: '456' }] },
        { ...validInfo, lottery_info_type: undefined }, { ...validInfo, uname: undefined }
    ];
    assert(invalidInfos.every(info => !dataUtils.isValidLotteryInfo(info)));
    assert(dataUtils.isValidLotteryInfo({ ...validInfo, type: 1, ctrl: [{ location: 0, length: 3, type: 1, data: '456' }] }));
    try {
        const filename = 'lottery_info_1.json';
        assert(dataUtils.isValidLotteryInfo({ ...validInfo, des: '' }), '合法空正文仍由原筛选规则处理');
        await dataUtils.appendLotteryInfoFile('source-a', [validInfo, otherInfo, ...invalidInfos]);
        const updated = { ...validInfo, des: '更新后的抽奖内容' };
        await dataUtils.appendLotteryInfoFile('source-a', [updated, ...invalidInfos]);
        let saved = JSON.parse(fs.readFileSync(path.join(tempInfoDir, filename), 'utf8'));
        assert.strictEqual(saved['source-a'].length, 2);
        assert.strictEqual(saved['source-a'][0].des, updated.des);
        await dataUtils.appendLotteryInfoFile('source-b', [validInfo]);
        await dataUtils.appendLotteryInfoFile('__proto__', [validInfo]);
        saved = JSON.parse(fs.readFileSync(path.join(tempInfoDir, filename), 'utf8'));
        assert.strictEqual(saved['source-a'].length, 2);
        assert.strictEqual(saved['source-b'].length, 1, '保留不同来源的溯源信息');
        assert.strictEqual(saved['__proto__'].length, 1);
        saved.legacy = invalidInfos;
        fs.writeFileSync(path.join(tempInfoDir, filename), JSON.stringify(saved));
        assert((await dataUtils.readLotteryInfoFile(filename)).every(dataUtils.isValidLotteryInfo));
        setup({ lottery_info: [...invalidInfos, validInfo] });
        assert.deepStrictEqual(await new Searcher().getLotteryInfoByAPI('https://api.bilibili.com/x/test'), [validInfo]);
        assert.strictEqual(requests.length, 1, '外部API先校验交换数据, 不处理缺ID或缺字段的记录');

        /* API或旧文件中的无效对象在去重和保存之前整组过滤 */
        const savedSaveSetting = config.save_lottery_info_to_file;
        const savedDupSetting = config.check_if_duplicated;
        config.save_lottery_info_to_file = true;
        config.check_if_duplicated = 0;
        const validateMonitor = new Monitor(['UIDs', 'data-validation']);
        validateMonitor.LotteryInfoMap.set('UIDs', async () => [validInfo, validInfo, ...invalidInfos]);
        const cacheStart = log._cache.length;
        try {
            assert.deepStrictEqual(await validateMonitor.filterLotteryInfo(), []);
            const currentLogs = log._cache.slice(cacheStart).join('\n');
            assert(!currentLogs.includes('t.bilibili.com/undefined'));
            assert(currentLogs.includes('动态数据校验'));
            saved = JSON.parse(fs.readFileSync(path.join(tempInfoDir, filename), 'utf8'));
            assert.deepStrictEqual(saved['data-validation'], [validInfo]);
        } finally {
            config.save_lottery_info_to_file = savedSaveSetting;
            config.check_if_duplicated = savedDupSetting;
        }
        process.env.NUMBER = '2';
        await dataUtils.appendLotteryInfoFile('source-a', [otherInfo]);
        assert.strictEqual((await dataUtils.readLotteryInfoFile('lottery_info_2.json')).length, 1);
        process.env.NUMBER = '1';
        await dataUtils.clearLotteryInfo();
        assert.deepStrictEqual(await dataUtils.readLotteryInfoFile(filename), [], '新轮次按原行为清空, 不存在跨轮追加循环');
    } finally {
        dataUtils.lottery_info_dir = savedInfoDir;
        if (savedNumber === undefined) delete process.env.NUMBER;
        else process.env.NUMBER = savedNumber;
        fs.rmSync(tempInfoDir, { recursive: true, force: true });
    }

    /* 话题解析必须UTF-8编码, 同名优先; 无同名时仅做完整关键词包含匹配 */
    setup({ code: 0, data: { topic_items: [
        { id: 111, name: '原神互动抽奖', view: 9999, discuss: 30 },
        { id: 222, name: '互动抽奖好运来', view: 100, discuss: 20 },
        { id: 333, name: '互动抽奖', view: 99999, discuss: 0 },
        { id: 444, name: '互动抽奖活动', view: 10, discuss: 10 }
    ], page_info: { offset: 200, has_more: false } } });
    const fuzzyTopic = await bili.searchTopicByName('互动抽奖');
    assert.deepStrictEqual(fuzzyTopic, { id: 444, name: '互动抽奖活动', exact: false });
    assert.strictEqual(requests[0].url, 'https://app.bilibili.com/x/topic/pub/search');
    assert.deepStrictEqual(requests[0].query, { keywords: '互动抽奖', page_size: 200, offset: 0 });
    assert(querystring.stringify(requests[0].query).includes(encodeURIComponent('互动抽奖')));

    setup({ code: 0, data: { topic_items: [
        { id: 111, name: '原神互动抽奖', view: 9999, discuss: 30 },
        { id: 333, name: '互动抽奖', discuss: 0 }
    ], page_info: { offset: 200, has_more: true } } }, { code: 0, data: { topic_items: [
        { id: 222, name: '互动抽奖', view: 1, discuss: 1 }
    ], page_info: { offset: 227, has_more: false } } });
    const exactTopic = await bili.searchTopicByName('互动抽奖');
    assert.deepStrictEqual(exactTopic, { id: 222, name: '互动抽奖', exact: true });
    assert.strictEqual(requests.length, 2);
    assert.strictEqual(requests[1].query.offset, 200);
    setup({ code: 0, data: { topic_items: [{ id: 111, name: '原神互动抽奖', discuss: 10 }], page_info: { offset: 200 } } });
    assert.deepStrictEqual(await bili.searchTopicByName('互动抽奖'), { id: 111, name: '原神互动抽奖', exact: false });
    assert.strictEqual(requests.length, 1);
    setup({ code: 0, data: { topic_items: [{ id: 2233, name: '2233', discuss: 1 }] } });
    assert.deepStrictEqual(await bili.searchTopicByName(2233), { id: 2233, name: '2233', exact: true });
    assert.strictEqual(requests[0].query.keywords, '2233');
    setup({ code: 0, data: { topic_items: [{ id: 222, name: '互动抽奖', show_interact_data: false }] } });
    assert.deepStrictEqual(await bili.searchTopicByName('互动抽奖'), { id: 222, name: '互动抽奖', exact: true });
    assert.strictEqual(requests.length, 1);
    for (const response of [
        { code: 0, data: { topic_items: [] } },
        { code: 0, data: { topic_items: null } },
        { code: -352 },
        { code: 0, data: { topic_items: [{ id: 111, name: '原神互动抽奖', discuss: 10 }], page_info: { offset: 0, has_more: true } } },
        { code: 0, data: { topic_items: [{ id: 999, name: '热门话题', discuss: 10 }], page_info: { offset: 0, has_more: true } } }
    ]) {
        setup(response);
        assert.strictEqual(await bili.searchTopicByName('互动抽奖'), null);
        assert.strictEqual(requests.length, 1);
    }
    setup({ code: 0, data: { topic_items: [{ id: 999, name: '热门话题', discuss: 10 }], page_info: { offset: 200, has_more: false } } });
    assert.strictEqual(await bili.searchTopicByName('互动抽奖'), null);
    setup(...Array.from({ length: 5 }, (_, index) => ({ code: 0, data: {
        topic_items: [{ id: 111, name: '原神互动抽奖', discuss: 10 }],
        page_info: { offset: (index + 1) * 200, has_more: true }
    } })));
    assert.strictEqual(await bili.searchTopicByName('互动抽奖'), null);
    assert.strictEqual(requests.length, 5);

    const hot_card = makeTopicDynamic(900);
    setup({ code: 0, data: { topic_card_list: { items: [{ dynamic_card_item: hot_card }], has_more: true, offset: 'hot-offset' } } });
    const topicPage = await bili.getOneDynamicInfoByTopic(444, '', 2);
    assert.deepStrictEqual(topicPage, { items: [hot_card], has_more: true, offset: 'hot-offset' });
    assert.strictEqual(requests[0].url, 'https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/topic');
    assert.deepStrictEqual(requests[0].query, { topic_id: 444, offset: '', sort_by: 2, page_size: 20, source: 'Web', features: 'itemOpusStyle' });
    setup({ code: 0, data: { topic_card_list: { items: [{ dynamic_card_item: hot_card }, { topic_type: 'other' }], has_more: false } } });
    assert.deepStrictEqual(await bili.getOneDynamicInfoByTopic(444), { items: [hot_card], has_more: false, offset: '' });
    for (const response of [
        { code: 4401030 },
        { code: 0, data: {} },
        { code: 0, data: { topic_card_list: { items: [], has_more: true, offset: '' } } },
        { code: 0, data: { topic_card_list: { items: [], has_more: true, offset: 'unchanged' } } },
        '[遇到页面错误]HTTP状态码: 404'
    ]) {
        setup(response);
        assert.strictEqual(await bili.getOneDynamicInfoByTopic(444, 'unchanged'), null);
    }

    /* 话题源同时读取热门和最新; 两套offset独立, 最新has_more=false时保留末页并停止 */
    const originalSearchTopic = bili.searchTopicByName;
    const originalGetTopicPage = bili.getOneDynamicInfoByTopic;
    const utils = require('../../lib/utils');
    const originalDelay = utils.delay;
    const topicFeedCalls = [];
    const topicFeedPages = [
        { items: [makeTopicDynamic(901)], has_more: true, offset: 'hot-offset' },
        { items: [makeTopicDynamic(902)], has_more: true, offset: 'latest-offset' },
        { items: [makeTopicDynamic(903)], has_more: false, offset: '' }
    ];
    bili.searchTopicByName = async name => ({ id: 444, name: `${name}活动`, exact: false });
    bili.getOneDynamicInfoByTopic = async (...args) => { topicFeedCalls.push(args); return topicFeedPages.shift(); };
    utils.delay = async () => { };
    try {
        globals.set('tagSourceFuzzyMappings', []);
        const topicInfos = await new Searcher().getLotteryInfoByTag('互动抽奖');
        assert.deepStrictEqual(topicInfos.map(it => it.dyid), ['901', '902', '903']);
        assert.deepStrictEqual(topicFeedCalls, [[444, '', 2], [444, '', 3], [444, 'latest-offset', 3]]);
        assert.deepStrictEqual(globals.get('tagSourceFuzzyMappings'), ['#互动抽奖# -> #互动抽奖活动# (444)']);
    } finally {
        bili.searchTopicByName = originalSearchTopic;
        bili.getOneDynamicInfoByTopic = originalGetTopicPage;
        utils.delay = originalDelay;
    }

    /* TAG 来源获取失败必须累计；普通来源失败不能污染 TAG 统计 */
    globals.set('tagSourceAttempts', 0);
    globals.set('tagSourceFailures', 0);
    const failedTagMonitor = new Monitor(['TAGs', '互动抽奖']);
    failedTagMonitor.LotteryInfoMap.set('TAGs', async () => null);
    assert.deepStrictEqual(await failedTagMonitor.filterLotteryInfo(), []);
    assert.strictEqual(globals.get('tagSourceAttempts'), 1);
    assert.strictEqual(globals.get('tagSourceFailures'), 1);
    const failedUidMonitor = new Monitor(['UIDs', '123']);
    failedUidMonitor.LotteryInfoMap.set('UIDs', async () => null);
    await failedUidMonitor.filterLotteryInfo();
    assert.strictEqual(globals.get('tagSourceAttempts'), 1);
    assert.strictEqual(globals.get('tagSourceFailures'), 1);
    failedTagMonitor.LotteryInfoMap.set('TAGs', async () => []);
    assert.deepStrictEqual(await failedTagMonitor.filterLotteryInfo(), []);
    assert.strictEqual(globals.get('tagSourceAttempts'), 2);
    assert.strictEqual(globals.get('tagSourceFailures'), 1);

    /* 正常非抽奖信息只打debug明细, 每个来源汇总一次; AI判定逻辑不变 */
    const filterSettings = {
        model: '11', chatmodel: '00', check_if_duplicated: -1,
        key_words: ['抽奖', '转发'], is_imitator: false, only_followed: false,
        save_lottery_info_to_file: false, set_lottery_info_url: ''
    };
    const savedFilterSettings = Object.fromEntries(Object.keys(filterSettings).map(key => [key, config[key]]));
    const savedJudgeFlag = process.env.ENABLE_AI_JUDGE;
    const savedFilterAttentionList = globals.get('attentionList');
    globals.set('attentionList', new Set(['456', '789']));
    const savedLogMethods = { info: log.info, warn: log.warn, debug: log.debug };
    const filterLogs = [];
    for (const level of Object.keys(savedLogMethods)) {
        log[level] = (label, message) => filterLogs.push({ level, label, message });
    }
    Object.assign(config, filterSettings);
    const ordinaryPosts = [1, 2].map(i => ({
        lottery_info_type: 'uid', dyid: `999999999999999999${i}`,
        des: '今天分享散步的照片', uids: [456, 789], uname: '测试UP',
        ctrl: [], type: 4, hasOfficialLottery: false, chat_type: 0,
        reserve_id: 0, reserve_lottery_text: ''
    }));
    const quietMonitor = new Monitor(['UIDs', 123]);
    quietMonitor.LotteryInfoMap.set('UIDs', async () => ordinaryPosts);
    const aiResponse = content => ({ choices: [{ message: { content } }] });
    try {
        delete process.env.ENABLE_AI_JUDGE;
        assert.deepStrictEqual(await quietMonitor.filterLotteryInfo(), []);
        assert.strictEqual(filterLogs.filter(it => it.label === '筛选统计').length, 1);
        assert(filterLogs.some(it => it.level === 'info' && it.message.includes('未命中关键词2条，AI判为非抽奖0条')));
        assert.strictEqual(filterLogs.filter(it => it.level === 'debug' && typeof it.message === 'string' && it.message.startsWith('未命中关键词')).length, 2);
        assert.strictEqual(filterLogs.filter(it => it.level === 'warn').length, 0);

        process.env.ENABLE_AI_JUDGE = 'true';
        filterLogs.length = 0;
        setup(...ordinaryPosts.map(() => aiResponse('{"has_key_words":false}')));
        assert.deepStrictEqual(await quietMonitor.filterLotteryInfo(), []);
        assert(filterLogs.some(it => it.level === 'info' && it.message.includes('未命中关键词0条，AI判为非抽奖2条')));
        assert.strictEqual(filterLogs.filter(it => it.level === 'warn').length, 0);

        filterLogs.length = 0;
        setup(...ordinaryPosts.map(() => aiResponse('not JSON')));
        assert.deepStrictEqual(await quietMonitor.filterLotteryInfo(), []);
        assert(filterLogs.some(it => it.level === 'info' && it.message.includes('未命中关键词2条，AI判为非抽奖0条')));
        assert.strictEqual(filterLogs.filter(it => it.level === 'warn' && it.label === 'ai判断抽奖').length, 2);

        filterLogs.length = 0;
        setup(...ordinaryPosts.map(() => aiResponse('{"has_key_words":true}')));
        assert.strictEqual((await quietMonitor.filterLotteryInfo()).length, 2, 'AI判真仍保留原有入选行为');
        assert.strictEqual(filterLogs.filter(it => it.label === '筛选统计').length, 0);
    } finally {
        Object.assign(config, savedFilterSettings);
        globals.set('attentionList', savedFilterAttentionList);
        Object.assign(log, savedLogMethods);
        if (savedJudgeFlag === undefined) delete process.env.ENABLE_AI_JUDGE;
        else process.env.ENABLE_AI_JUDGE = savedJudgeFlag;
    }

    /* 结束通知显式携带 TAG 来源失败摘要, 不依赖可能被裁剪的日志缓存 */
    const monitorPath = require.resolve('../../lib/core/monitor');
    const notifyPath = require.resolve('../../lib/helper/notify');
    const lotteryPath = require.resolve('../../lib/lottery');
    const monitorCache = require.cache[monitorPath];
    const notifyCache = require.cache[notifyPath];
    const originalMonitorExports = monitorCache.exports;
    const originalNotifyExports = notifyCache.exports;
    const originalLottery = globals.get('Lottery');
    const originalNoticeSetting = config.notice_running_state;
    const originalCreateDynamicSetting = config.create_dy;
    const notifications = [];
    let simulateTagFailure = true;
    let simulateFuzzyMapping = false;
    let simulateNotifyFailure = false;
    let simulatedStats = null;
    let notificationCompleted = false;
    monitorCache.exports = {
        Monitor: class {
            async init() {
                globals.set('tagSourceAttempts', globals.get('tagSourceAttempts') + 1);
                if (simulateTagFailure) {
                    globals.set('tagSourceFailures', globals.get('tagSourceFailures') + 1);
                }
                if (simulateFuzzyMapping) {
                    globals.set('tagSourceFuzzyMappings', ['#互动抽奖# -> #互动抽奖好运来# (1028370)']);
                }
                if (simulatedStats) Object.assign(globals.getRunStats(), simulatedStats);
                eventBus.emit('Turn_off_the_Monitor', '测试结束');
            }
        }
    };
    notifyCache.exports = {
        ...originalNotifyExports,
        sendNotify: async (...args) => {
            notifications.push(args);
            if (simulateNotifyFailure) throw new Error('notification failed');
            await new Promise(resolve => setTimeout(resolve, 5));
            notificationCompleted = true;
        }
    };
    config.notice_running_state = true;
    config.create_dy = false;
    globals.set('Lottery', [['TAGs', '互动抽奖']]);
    delete require.cache[lotteryPath];
    try {
        const lottery = require('../../lib/lottery');
        await lottery.start('1');
        const firstRunOpusCache = globals.get('opusCollectionCache');
        assert(firstRunOpusCache instanceof Map);
        firstRunOpusCache.set('previous-account', { isCollection: false });
        globals.set('attentionList', new Set(['previous-account-follow']));
        globals.get('aiCommentCache').set('previous-dynamic', { action: 'skip' });
        globals.get('aiCommentAttempts').add('previous-dynamic');
        assert.strictEqual(notificationCompleted, true);
        assert.match(notifications[0][0], /话题源异常1\/1/);
        assert.match(notifications[0][1], /话题来源获取失败: 1\/1/);
        simulateTagFailure = false;
        notificationCompleted = false;
        await lottery.start('1');
        assert.notStrictEqual(globals.get('opusCollectionCache'), firstRunOpusCache);
        assert.strictEqual(globals.get('opusCollectionCache').size, 0, '新账号/新轮次不沿用Opus检测缓存');
        assert.strictEqual(globals.get('attentionList'), undefined, '新账号/新轮次重新按需读取完整关注列表');
        assert.strictEqual(globals.get('aiCommentCache').size, 0, 'AI评论生成缓存不串账号或轮次');
        assert.strictEqual(globals.get('aiCommentAttempts').size, 0, '评论尝试记录不串账号或轮次');
        assert.strictEqual(notificationCompleted, true);
        assert.match(notifications[1][0], /结束抽奖-共参与0个抽奖/);
        assert.doesNotMatch(notifications[1][1], /话题来源获取失败/);
        simulateFuzzyMapping = true;
        notificationCompleted = false;
        await lottery.start('1');
        assert.strictEqual(notificationCompleted, true);
        assert.match(notifications[2][0], /模糊匹配1/);
        assert.match(notifications[2][1], /#互动抽奖# -> #互动抽奖好运来# \(1028370\)/);
        simulateNotifyFailure = true;
        await lottery.start('1');
        assert.strictEqual(notifications.length, 4);
        assert.strictEqual(eventBus.ee.listenerCount('Turn_off_the_Monitor'), 0);
        simulateNotifyFailure = false;
        simulateFuzzyMapping = false;
        simulatedStats = { processed: 3, failed: 2, request_failed: 1, simulated: 1, partition_failed: 1, unprocessed: 2,
            last_request_error: '转发动态: [请求失败]: getaddrinfo EAI_AGAIN api.bilibili.com' };
        await lottery.start('1');
        assert.match(notifications[4][0], /运行异常2/);
        assert.match(notifications[4][0], /演练1/);
        assert.match(notifications[4][1], /成功转发0.*操作失败2（网络\/接口1）.*演练1.*分区失败1.*未处理2/);
        assert.match(originalNotifyExports.clipDesp(notifications[4][1], 4000), /结束原因: 测试结束/);
        assert.match(originalNotifyExports.clipDesp(notifications[4][1], 4000), /最近写请求失败:.*EAI_AGAIN/);
        simulatedStats = null;
        await lottery.start('1');
        assert.strictEqual(globals.getRunStats().failed, 0, '新账号/新轮次统计不能串号');
        assert.match(notifications[5][1], /^处理0条；成功转发0/);
    } finally {
        monitorCache.exports = originalMonitorExports;
        notifyCache.exports = originalNotifyExports;
        globals.set('Lottery', originalLottery);
        config.notice_running_state = originalNoticeSetting;
        config.create_dy = originalCreateDynamicSetting;
        delete require.cache[lotteryPath];
    }

    /* DNS解析失败时请求尚未发出: 不可重放的写请求(retry:false)也重试, 其余网络错误仍立即失败 */
    const netError = (message, extra) => Object.assign(new Error(message), extra);
    const dnsError = () => netError('getaddrinfo EAI_AGAIN api.bilibili.com', { code: 'EAI_AGAIN', syscall: 'getaddrinfo' });
    const rawSend = queue => new Promise(resolve => {
        transport = queue;
        transportCalls = 0;
        realSend({
            method: 'POST',
            url: 'https://api.bilibili.com/x/test',
            config: { retry: false, wait: 0 },
            contents: { a: 1 },
            success: ({ body }) => resolve(body),
            failure: resolve
        });
    });
    assert.strictEqual(await rawSend([dnsError(), '{"code":0}']), '{"code":0}');
    assert.strictEqual(transportCalls, 2);
    assert.strictEqual(await rawSend([dnsError(), dnsError(), dnsError(), '{"code":0}']), '[请求失败]: getaddrinfo EAI_AGAIN api.bilibili.com');
    assert.strictEqual(transportCalls, 3);
    assert.strictEqual(await rawSend([netError('socket hang up', { code: 'ECONNRESET' }), '{"code":0}']), '[请求失败]: socket hang up');
    assert.strictEqual(transportCalls, 1);

    /* 跟随重定向时消费 3xx 响应，避免原请求超时后再次请求目标页 */
    const redirectRequests = [];
    const redirectServer = nodeHttp.createServer((req, res) => {
        redirectRequests.push(req.url);
        if (req.url === '/start') {
            res.writeHead(301, { location: '/target' });
            res.end('redirect response');
        } else {
            res.end('target response');
        }
    });
    await new Promise(resolve => redirectServer.listen(0, '127.0.0.1', resolve));
    let redirectSuccesses = 0;
    let redirectFailures = 0;
    const redirectBody = await new Promise(resolve => realSend({
        url: `http://127.0.0.1:${redirectServer.address().port}/start`,
        config: { redirect: true, retry: false, timeout: 100 },
        success: ({ body }) => { redirectSuccesses++; resolve(body); },
        failure: () => { redirectFailures++; resolve(null); }
    }));
    await new Promise(resolve => setTimeout(resolve, 150));
    redirectServer.close();
    assert.strictEqual(redirectBody, 'target response');
    assert.deepStrictEqual(redirectRequests, ['/start', '/target']);
    assert.strictEqual(redirectSuccesses, 1);
    assert.strictEqual(redirectFailures, 0);

    /* 解析层不重复记录HTTP错误，写操作仍保留一条带业务上下文的Error */
    const originalError = log.error;
    const errors = [];
    log.error = (...args) => errors.push(args);
    try {
        for (const text of ['[请求失败]: getaddrinfo EAI_AGAIN api.bilibili.com', '[响应错误]HTTP状态码: 500', '[遇到页面错误]HTTP状态码: 404']) {
            assert.deepStrictEqual(strToJson(text), {});
            assert.strictEqual(errors.length, 0);
            for (const [label, operation] of [
                ['转发动态', () => bili.autoRelay(123, '99')],
                ['自动评论', () => bili.sendChat('99', '测试', 17)],
                ['自动点赞', () => bili.autolike('99')],
                ['自动关注', () => bili.autoAttention(456)]
            ]) {
                setup(text);
                assert.strictEqual(await operation(), 99);
                assert.deepStrictEqual(errors.map(([context]) => context), [label]);
                assert(globals.getRunStats().last_request_error.includes(text));
                errors.length = 0;
                assert.strictEqual(requests.length, 1, '不确定写入结果不应切换线路再次提交');
            }
        }
        setup({ code: 0, data: { follower: 99 } });
        assert.strictEqual(await bili.getUserInfo(456), 99);
        assert.strictEqual(errors.length, 0, '正常粉丝数99不应与关注失败标志混淆');
    } finally {
        log.error = originalError;
    }

    /* 写操作请求失败映射到对应阶段, 不与业务错误共用未知状态 */
    delete process.env.NOT_GO_LOTTERY;
    config.wait = 0;
    config.is_not_create_partition = true;
    const requestFailure = '[请求失败]: getaddrinfo EAI_AGAIN api.bilibili.com';
    const failedOption = { uid: [], dyid: '99', relay_chat: '转发动态', ctrl: '[]' };
    setup(requestFailure);
    assert.strictEqual(await new Monitor(['UIDs', 1]).go({ ...failedOption, rid: '99', chat_type: 17, chat: '测试' }), 1099);
    setup(requestFailure);
    assert.strictEqual(await new Monitor(['UIDs', 1]).go({ ...failedOption, uid: [123] }), 2099);
    config.check_if_duplicated = 3;
    setup(requestFailure);
    assert.strictEqual(await new Monitor(['UIDs', 1]).go(failedOption), 4099);
    config.check_if_duplicated = -1;
    setup(requestFailure);
    assert.strictEqual(await new Monitor(['UIDs', 1]).go(failedOption), 5099);

    /* 运行统计按实际执行结果分类, 不能把请求失败/演练算作成功 */
    const storage = require('../../lib/helper/d_storage');
    const originalStatsUpdate = storage.updateDyid;
    const originalStatsRandom = Math.random;
    const statsSettings = { wait: 0, filter_wait: 0, create_dy: false, minfollower: 0 };
    const savedStatsSettings = Object.fromEntries(Object.keys(statsSettings).map(key => [key, config[key]]));
    const savedStatsDryRun = process.env.NOT_GO_LOTTERY;
    const writtenDyids = [];
    Math.random = () => 0.999;
    storage.updateDyid = async id => { writtenDyids.push(id); };
    Object.assign(config, statsSettings);
    const runBatch = async (statuses, dryRun = false) => {
        globals.set('runStats', undefined);
        writtenDyids.length = 0;
        if (dryRun) process.env.NOT_GO_LOTTERY = 'true';
        else delete process.env.NOT_GO_LOTTERY;
        const runMonitor = new Monitor(['UIDs', 'stats-test']);
        const options = statuses.map((status, i) => ({
            uid: [], dyid: String(9900000000000000000n + BigInt(i)), drawtime: -1, test_status: status
        }));
        runMonitor.filterLotteryInfo = async () => options;
        runMonitor.go = async option => option.test_status;
        const result = await runMonitor.startLottery();
        const stats = globals.getRunStats();
        assert.strictEqual(stats.processed, stats.relayed + stats.skipped + stats.failed + stats.simulated);
        assert.strictEqual(stats.processed + stats.unprocessed, options.length);
        return { result, stats, options };
    };
    try {
        const mixed = await runBatch([0, 5002, 5099, 4001, 0]);
        assert.strictEqual(mixed.result, 0);
        assert.deepStrictEqual(mixed.stats, {
            processed: 5, relayed: 2, skipped: 1, failed: 2, request_failed: 1,
            partition_failed: 0, simulated: 0, unprocessed: 0, preflight_failed: 0, last_request_error: '',
            ai_comment_requested: 0, ai_comment_ms: 0, ai_comment_failed: 0,
            ai_comment_fallback: 0, ai_comment_skipped: 0
        });
        assert.deepStrictEqual(writtenDyids, [mixed.options[0].dyid, mixed.options[1].dyid, mixed.options[4].dyid]);
        for (const status of [1099, 2099, 1010, 1004]) {
            const stopped = await runBatch([status, 0]);
            assert.strictEqual(stopped.result, status);
            assert.strictEqual(stopped.stats.failed, 1);
            assert.strictEqual(stopped.stats.request_failed, status % 1000 === 99 ? 1 : 0);
            assert.strictEqual(stopped.stats.unprocessed, 1);
            assert.strictEqual(writtenDyids.length, 0);
        }
        const streak = await runBatch([5099, 5099, 5099, 0]);
        assert.strictEqual(streak.result, 5099);
        assert.strictEqual(streak.stats.failed, 3);
        assert.strictEqual(streak.stats.request_failed, 3);
        assert.strictEqual(streak.stats.unprocessed, 1);
        assert.strictEqual(writtenDyids.length, 0);
        const dryRun = await runBatch([0, 0], true);
        assert.strictEqual(dryRun.stats.relayed, 0);
        assert.strictEqual(dryRun.stats.simulated, 2);
        assert.strictEqual(writtenDyids.length, 0, '演练不能污染本地已参与记录');
    } finally {
        storage.updateDyid = originalStatsUpdate;
        Math.random = originalStatsRandom;
        Object.assign(config, savedStatsSettings);
        if (savedStatsDryRun === undefined) delete process.env.NOT_GO_LOTTERY;
        else process.env.NOT_GO_LOTTERY = savedStatsDryRun;
    }

    /* 分区移动失败(22105)不再中止点赞与转发, 且单独计入运行摘要 */
    delete process.env.NOT_GO_LOTTERY;
    globals.set('runStats', undefined);
    Object.assign(config, { wait: 0, check_if_duplicated: 3, is_not_create_partition: false });
    setup({ code: 0 }, { code: 22105, message: '请先公开关注后再添加分组', ttl: 1 }, { code: 0 }, { code: 0 });
    assert.strictEqual(await new Monitor(['UIDs', 1]).go({ uid: [456], dyid: '99', relay_chat: '转发动态', ctrl: '[]' }), 0);
    assert.strictEqual(globals.getRunStats().partition_failed, 1);
    assert.deepStrictEqual(requests.map(r => r.url), [
        'https://api.bilibili.com/x/relation/modify',
        'https://api.bilibili.com/x/relation/tags/addUsers',
        'https://api.vc.bilibili.com/dynamic_like/v1/dynamic_like/thumb',
        'https://api.bilibili.com/x/dynamic/feed/create/dyn'
    ]);
    console.log('offline Bilibili API tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
