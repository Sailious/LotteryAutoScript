const assert = require('assert');
const nodeHttp = require('http');
const { EventEmitter } = require('events');
const http = require('../../lib/net/http');
const realSend = http.send;
const requests = [];
let responses = [];
let cancelled = 0;
http.send = detail => {
    if (detail.url.startsWith('http://127.0.0.1:')) return realSend(detail);
    requests.push(detail);
    assert(responses.length, 'unexpected AI request');
    const response = responses.shift();
    const req = new EventEmitter();
    req.destroy = () => { cancelled++; };
    if (typeof response === 'function') response(detail, req);
    else setImmediate(() => {
        if (typeof response === 'string') detail.failure(response);
        else detail.success({ body: JSON.stringify(response) });
    });
    return req;
};
const { getAiComment, getCommentPolicy, checkCommentText, validateCommentResult } = require('../../lib/helper/ai_comment');
const utils = require('../../lib/utils');
const config = require('../../lib/data/config');
const globalVar = require('../../lib/data/global_var');
const bili = require('../../lib/net/bili');
const storage = require('../../lib/helper/d_storage');
const { Monitor } = require('../../lib/core/monitor');
const genericSource = '关注转发评论抽一把机械键盘。';
const specificSource = '转发抽键盘，评论：你玩Forza更偏向方向盘、键盘还是手柄？请说明理由。';
const fixedSource = '关注转发，评论：“好运常在”抽机械键盘。';
const genericResult = { mode: 'generic', requirement: '', comment: '我想要机械键盘' };
const specificResult = { mode: 'specific', requirement: '你玩Forza更偏向方向盘、键盘还是手柄？请说明理由。', comment: '我更偏向手柄，操作方便，跑长途也不累。' };
const api = (result, finish = 'stop') => ({ choices: [{ finish_reason: finish, message: { content: JSON.stringify(result) } }] });
const parm = { url: 'https://api.siliconflow.cn/v1/chat/completions', body: { model: 'Qwen/Qwen3.5-4B' }, prompt: '评论最多60字' };
const setup = (...values) => { requests.length = 0; responses = values; };

(async () => {
    assert.strictEqual(getCommentPolicy(genericSource).mode, 'generic');
    assert.strictEqual(getCommentPolicy(specificSource).mode, 'specific');
    assert.strictEqual(getCommentPolicy('关注转发，评论你最喜欢的配色，抽机械键盘。').mode, 'specific');
    assert.strictEqual(getCommentPolicy('关注转发，评论区输入好运常在即可参与抽奖。').fixed, '好运常在');
    assert.strictEqual(getCommentPolicy('评论：“祝你好运”抽机械键盘。').fixed, '祝你好运');
    assert.strictEqual(getCommentPolicy('评论区留言：“你最喜欢哪个角色？”抽手办。').fixed, undefined);
    assert.strictEqual(getCommentPolicy('评论区写下你最喜欢的角色即可参与，抽手办。').fixed, undefined);
    assert.strictEqual(getCommentPolicy('评论区输入你的真实经历即可参与，抽键盘。').mode, 'manual');
    assert.strictEqual(getCommentPolicy('关注转发评论，抽奖时间：1月1日，送机械键盘。').mode, 'generic');
    assert.strictEqual(getCommentPolicy('【转发+评论+赞】本动态，小嘿将随机抽4个欧皇送出以下福利：机械键盘。').mode, 'generic');
    assert.strictEqual(getCommentPolicy('结合视频回答评论区问题，抽键盘。').mode, 'manual');
    assert.strictEqual(getCommentPolicy('分享你的亲身经历，抽一把键盘。').mode, 'manual');
    assert.strictEqual(validateCommentResult(JSON.stringify(genericResult), genericSource, 'stop').action, 'publish');
    assert.strictEqual(validateCommentResult(JSON.stringify(specificResult), specificSource, 'stop').action, 'publish');
    const roleQuestion = '评论区留言：“你最喜欢哪个角色？”抽手办。';
    assert.strictEqual(validateCommentResult(JSON.stringify({ mode: 'specific', requirement: '你最喜欢哪个角色？', comment: '你最喜欢哪个角色？' }), roleQuestion, 'stop').action, 'skip');
    assert.strictEqual(validateCommentResult(JSON.stringify({ mode: 'specific', requirement: '你最喜欢哪个角色？', comment: '我最喜欢初音未来。' }), roleQuestion, 'stop').action, 'publish');
    assert.strictEqual(validateCommentResult(JSON.stringify(genericResult), specificSource, 'stop').action, 'skip');
    assert.strictEqual(validateCommentResult(JSON.stringify(genericResult), '动态只有奖品信息但没有明确的参与规则', 'stop').action, 'skip', '本地不能确认通用要求时不接受模型自报generic');
    assert.strictEqual(validateCommentResult(JSON.stringify({ ...specificResult, comment: specificResult.requirement }), specificSource, 'stop').action, 'skip');
    assert.strictEqual(validateCommentResult(JSON.stringify({ mode: 'specific', requirement: '请预测世界杯冠军', comment: '我看好某战队夺冠。' }), specificSource, 'stop').action, 'skip');
    for (const raw of [
        `解释一下：${JSON.stringify(genericResult)}`,
        `${JSON.stringify(genericResult)}\n${JSON.stringify(genericResult)}`,
        '<think>尚未结束' + JSON.stringify(genericResult),
        '{"mode":"generic","comment":"我想要键盘"}',
        JSON.stringify({ ...genericResult, comment: '好'.repeat(61) }),
        JSON.stringify({ ...genericResult, comment: '```js\n解释\n```' })
    ]) {
        assert.strictEqual(validateCommentResult(raw, genericSource, 'stop').action, 'skip');
    }
    assert.strictEqual(validateCommentResult(JSON.stringify(genericResult), genericSource, 'length').action, 'skip');
    assert.strictEqual(validateCommentResult('```json\n' + JSON.stringify(genericResult) + '\n```', genericSource, 'stop').action, 'publish');
    assert.strictEqual(validateCommentResult(JSON.stringify({ mode: 'specific', requirement: '评论：“好运常在”', comment: '好运常在' }), fixedSource, 'stop').action, 'publish');
    assert(checkCommentText('好运常在[doge]', fixedSource), '固定口令不能为去重而改写');
    for (const text of [
        '!!!', '我想要。', '作为一个AI，我无法参与抽奖。',
        '关注@华硕天选官方UP，我会随机抽3位送出天选周边！',
        '聊聊你是玩Forza时更偏向方向盘、键盘还是手柄党？',
        '我已购买了键盘，已经加入购物车。',
        '我在深圳打卡，为新品助力！',
        '我在深圳为 MOOD B 上新助力，打卡作业由我们开始！',
        '我想拥有 DUKA MOOD B 智能 AI 桌搭子，助力深圳新客打卡作业！',
        '我的秋冬故事：零下五度晨跑，配速没变，脚步更稳了！',
        '我每天给室友留饭，这就是我的守护故事。',
        '我想分享身边守护的故事，例如每天给我留饭的室友。',
        '关注东方补者和味知香食品官方，已把#东方补者双11黑养清单#加入购物车。'
    ]) assert(checkCommentText(text, genericSource), `应拒绝：${text}`);
    assert.strictEqual(checkCommentText('我想要有兽焉官方美术原画集：天卷典藏重制版', '关注转发抽有兽焉官方美术原画集：天卷典藏重制版'), '', '长奖品名重叠本身不是拒绝理由');
    assert.strictEqual(checkCommentText('我更偏向手柄，操作方便。', specificSource), '');
    assert(checkCommentText('我想要机械键盘', '评论带上#键盘日记#，抽机械键盘。'));
    assert.strictEqual(checkCommentText('我最喜欢青轴的声音。#键盘日记#', '评论带上#键盘日记#，抽机械键盘。'), '');
    assert(checkCommentText('期待好运。#桌搭#', '评论带上#键盘日记#和#桌搭#，抽机械键盘。'));
    assert.strictEqual(checkCommentText('期待好运。#键盘日记# #桌搭#', '评论带上#键盘日记#和#桌搭#，抽机械键盘。'), '');

    /* 样本实测回归：标点噪音、简写、复合口令和外部活动路径 */
    const noiseSource = '[伊藤润二动态表情包_？]【转发+关注】抽5人，每人一张卡牌。https://www.bilibili.com/h5/mall?act_id=1 [伊藤润二_没事吧？]';
    const rhetoricalSource = '不会你还没玩上吧？什么？你没有主机？参与方式：关注并转发评论本条抽奖动态，抽1位送PS5。';
    const winnerSource = '转发➕留言➕关注，抽两名幸运儿送手办。中奖后会艾特➕私信，中奖后没有回复地址联系方式视为放弃。';
    for (const text of [noiseSource, rhetoricalSource, winnerSource, '转关评给6位送上同款甜品兔蛋糕装扮']) {
        assert.strictEqual(getCommentPolicy(text).mode, 'generic');
        assert.strictEqual(validateCommentResult(JSON.stringify(genericResult), text, 'stop').action, 'publish');
    }
    const externalVideo = '关注转发抽轴体，有效评论抽奖视频，评论加了表情包的一律不算。抽奖视频在这里：https://www.bilibili.com/video/BV1test/?spm_id=1';
    assert.strictEqual(getCommentPolicy(externalVideo).mode, 'manual', '修复URL问号不代表可评论错误目标');
    assert.strictEqual(getCommentPolicy('关注品牌，点赞评论本期视频，随机掉落散热器。', { chat_type: 1 }).mode, 'generic');
    assert.strictEqual(getCommentPolicy('关注品牌，点赞评论本期视频，随机掉落散热器。', { chat_type: 17 }).mode, 'manual');
    assert.strictEqual(getCommentPolicy('本条视频点赞、评论、转发，抽送散热器。', { chat_type: 17 }).mode, 'manual');
    assert.strictEqual(getCommentPolicy('本条视频点赞、评论、转发，抽送散热器。', { chat_type: 1 }).mode, 'generic');

    const proposeQuestion = '关注转发抽信号源，同时可在评论区留言：\n你最想解决的射频相关问题';
    const proposedResult = { mode: 'specific', requirement: '你最想解决的射频相关问题', comment: '如何降低毫米波测试中线缆与夹具带来的误差？' };
    assert.strictEqual(getCommentPolicy(proposeQuestion).allow_question, true);
    assert.strictEqual(validateCommentResult(JSON.stringify(proposedResult), proposeQuestion, 'stop').action, 'publish');
    assert.strictEqual(validateCommentResult(JSON.stringify({ ...proposedResult, comment: proposedResult.requirement }), proposeQuestion, 'stop').action, 'skip', '允许提出问题不代表允许照抄任务');
    assert.strictEqual(validateCommentResult(JSON.stringify({ ...specificResult, comment: specificResult.requirement }), specificSource, 'stop').action, 'skip');

    const compoundSource = '关注我，评论区留言“我想要AKKO一人之下键盘”并且夸夸我们宝儿姐即可。抽三位送键盘。';
    const compoundResult = { mode: 'specific', requirement: '评论区留言“我想要AKKO一人之下键盘”并且夸夸我们宝儿姐即可。', comment: '我想要AKKO一人之下键盘，宝儿姐又飒又机灵！' };
    assert.strictEqual(validateCommentResult(JSON.stringify(compoundResult), compoundSource, 'stop').action, 'publish');
    for (const text of ['我想要AKKO一人之下键盘', '我想要AKKO一人之下键盘[doge]', '宝儿姐又飒又机灵！', '我想要AKKO一人之下键盘，宝儿姐', '我想要AKKO一人之下键盘，宝儿姐是谁？']) {
        assert(checkCommentText(text, compoundSource), '复合要求的每一部分必须保留');
    }
    assert(checkCommentText('好运常在，加油！', fixedSource), '纯固定口令仍要求完全一致');
    const fixedTopicSource = '关注转发，评论区留言“好运常在”并带上#键盘日记#，抽机械键盘。';
    assert.strictEqual(checkCommentText('好运常在#键盘日记#', fixedTopicSource), '');
    assert(checkCommentText('好运常在', fixedTopicSource));
    const noEmojiSource = '关注转发抽机械键盘，评论加了表情包的一律不算。';
    assert(checkCommentText('我想要机械键盘[doge]', noEmojiSource));
    assert(checkCommentText('我想要机械键盘😀', noEmojiSource));
    assert.strictEqual(checkCommentText('我想要机械键盘', noEmojiSource), '');
    for (const text of ['评论区带图评论', '拍张照片发在评论区', '评论配图']) {
        assert.strictEqual(getCommentPolicy(`关注转发抽键盘，${text}即可参与`).mode, 'manual');
    }
    for (const text of ['规则见置顶评论', '完整版规则见置顶评论', '详细参与条件见长图']) {
        assert.strictEqual(getCommentPolicy(`关注转发抽充电器，${text}`).mode, 'manual');
    }
    for (const text of ['评论这条视频即可', '在本视频评论区留言', '前往视频评论区留言', '去视频评论区评论']) {
        assert.strictEqual(getCommentPolicy(`关注转发抽键盘，${text}`, { chat_type: 17 }).mode, 'manual');
    }
    assert.strictEqual(getCommentPolicy('关注品牌，点赞评论本期视频，随机掉落散热器。', { chat_type: '1' }).mode, 'generic');
    assert.strictEqual(getCommentPolicy('关注并转发，去这条抽奖动态评论参与 https://t.bilibili.com/123456789').mode, 'manual');
    const externalDynamics = [
        '关注转发抽键盘，评论在另一条动态：https://t.bilibili.com/123456789 即可。',
        '关注转发抽键盘，留言请到指定动态 https://t.bilibili.com/123456789',
        '关注转发抽键盘，回复在那条动态 https://t.bilibili.com/123456789'
    ];
    assert.strictEqual(getCommentPolicy('关注转发评论本条动态抽键盘，奖品详情 https://t.bilibili.com/123456789').mode, 'generic');

    const twoEvents = '关注品牌，转评赞本动态！抓一名鲨粉送散热器。\n如何打卡？拍照合影上传小红书并艾特官方，有机会赢ChinaJoy门票。';
    assert.strictEqual(getCommentPolicy(twoEvents).mode, 'generic', '独立线上抽奖不混入另一线下活动的问号');
    const blockedSources = [
        '关注我https://space.bilibili.com/9005111，抽奖不迷路。收集不易，记得三连！本期19个活动 https://t.bilibili.com/1268910644116062226',
        '快说想我了！明天回来直播。满777贡献送壁纸，上舰送吧唧。',
        '今天吃什么好呢？发起一个投票。',
        '关注转发评论抽充电器，完整规则见置顶评论。',
        '转发关注抽零食，具体活动详情可看下方长图。',
        '评论区留言“交友扩列信息”抽礼物，仅提供交友平台。',
        ...externalDynamics
    ];
    for (const text of blockedSources) {
        assert.strictEqual(getCommentPolicy(text).mode, 'manual');
        assert.strictEqual(validateCommentResult(JSON.stringify(genericResult), text, 'stop').action, 'skip');
        setup();
        const result = await getAiComment(parm, text);
        assert.strictEqual(result.action, 'skip');
        assert.strictEqual(result.requested, false);
        assert.strictEqual(requests.length, 0, '不为已知不安全输入请求AI, 不随机降级');
    }

    /* 交友信息附带抽奖仅表达奖品意愿，不编造资料、不取其他活动的奖品 */
    const socialLottery = '1️⃣预约直播送3份史诗皮肤红包！\n2️⃣评论区留言“交友扩列信息”抽五位小伙伴送出道理特别准备的七夕礼物！（仅提供交友平台）\n3️⃣情侣上麦分享故事可获100元红包。';
    assert.deepStrictEqual(getCommentPolicy(socialLottery), { mode: 'generic', prize_wish: '我想要七夕礼物' });
    setup();
    const socialComment = await getAiComment(parm, socialLottery);
    assert.strictEqual(socialComment.action, 'publish');
    assert.strictEqual(socialComment.comment, '我想要七夕礼物');
    assert.strictEqual(socialComment.requested, false, '可直接从正文奖品构造意愿，不消耗模型请求');
    assert(socialComment.reason.includes('资格不保证'));
    assert.strictEqual(requests.length, 0);
    assert.strictEqual(checkCommentText(socialComment.comment, socialLottery), '');
    assert(checkCommentText('交友扩列信息', socialLottery));
    assert.strictEqual(getCommentPolicy('评论区留言“交友扩列信息”，仅提供交友平台。').mode, 'manual', '没有抽奖不回复');
    assert.strictEqual(getCommentPolicy('评论区留言“交友扩列信息”抽五人，奖品待定。').mode, 'manual', '奖品不明确不编造');
    assert.strictEqual(getCommentPolicy('评论区留言“交友扩列信息”抽五人送礼物，规则见置顶评论。').mode, 'manual');
    assert.strictEqual(getCommentPolicy('评论区留言“交友扩列信息”并附上照片，抽五人送礼物。').mode, 'manual');

    setup(api(genericResult));
    const generated = await getAiComment({ ...parm, body: { ...parm.body, max_tokens: 8192, enable_thinking: true } }, genericSource);
    assert.strictEqual(generated.action, 'publish');
    assert.strictEqual(generated.comment, genericResult.comment);
    assert.strictEqual(requests.length, 1);
    assert.deepStrictEqual(requests[0].config, { timeout: 30000, retry: false, retry_times: 0, redirect: false });
    assert.strictEqual(requests[0].contents.max_tokens, 512);
    assert.strictEqual(requests[0].contents.temperature, 0.4);
    assert.strictEqual(requests[0].contents.enable_thinking, false);
    assert.strictEqual(requests[0].contents.model, parm.body.model);
    assert.strictEqual(requests[0].contents.messages[1].content, JSON.stringify({ dynamic_text: genericSource }));
    assert(requests[0].contents.messages[0].content.includes('未经信任'));
    assert.deepStrictEqual(requests[0].contents.response_format, { type: 'text' }, '不强制未经验证的JSON模式');
    for (const requestedTokens of [undefined, 512, 4096, 8192]) {
        setup(api(genericResult));
        await getAiComment({ ...parm, body: { ...parm.body, model: 'group/free', ...(requestedTokens ? { max_tokens: requestedTokens } : {}) } }, genericSource);
        assert.strictEqual(requests[0].contents.model, 'group/free');
        assert.strictEqual(requests[0].contents.max_tokens, 4096, '仅路由group/free使用思考兼容预算');
        assert.deepStrictEqual(requests[0].config, { timeout: 30000, retry: false, retry_times: 0, redirect: false });
    }
    setup(api(genericResult));
    await getAiComment({ ...parm, body: { ...parm.body, model: 'group/other', max_tokens: 8192 } }, genericSource);
    assert.strictEqual(requests[0].contents.max_tokens, 512, '其他模型不因group/free放宽输出限制');

    setup('[请求失败]: timeout');
    assert.strictEqual((await getAiComment(parm, genericSource)).action, 'fallback');
    setup('[请求失败]: timeout');
    assert.strictEqual((await getAiComment(parm, specificSource)).action, 'skip');
    setup('[请求失败]: timeout');
    assert.strictEqual((await getAiComment(parm, '关注转发，评论你最喜欢的配色，抽机械键盘。')).action, 'skip');
    setup('[请求失败]: timeout');
    assert.strictEqual((await getAiComment(parm, '一段无法明确参与规则的正文')).action, 'skip', '未知要求不能随机回退');
    setup(api({ mode: 'manual', requirement: '', comment: '' }));
    assert.strictEqual((await getAiComment(parm, genericSource)).action, 'skip');
    setup(api({ mode: 'specific', requirement: '正文未说明的购买要求', comment: '我已购买' }));
    assert.strictEqual((await getAiComment(parm, genericSource)).action, 'skip', '模型识别到指定要求但校验失败时不应通用回退');
    setup(api({ ...genericResult, requirement: specificResult.requirement }));
    assert.strictEqual((await getAiComment(parm, genericSource)).action, 'skip', 'generic附非空要求不能被finish重新降级成随机回退');
    setup();
    assert.strictEqual((await getAiComment(parm, '根据视频回答问题后抽键盘')).requested, false);
    assert.strictEqual(requests.length, 0);

    /* 超时后既要返回, 也要取消底层请求; 迟到回调不能改变结果 */
    let lateResponse;
    setup(detail => { lateResponse = detail; });
    const beforeCancelled = cancelled;
    const timedOut = await getAiComment({ ...parm, timeout_ms: 20 }, specificSource);
    assert.strictEqual(timedOut.action, 'skip');
    assert(timedOut.reason.includes('总耗时'));
    assert.strictEqual(cancelled, beforeCancelled + 1);
    lateResponse.success({ body: JSON.stringify(api(specificResult)) });
    assert.strictEqual(timedOut.action, 'skip');

    /* 本地持续滴流响应验证总截止, 不是只测socket不活跃超时 */
    let closed = false;
    const server = nodeHttp.createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        const interval = setInterval(() => res.write(' '), 5);
        res.on('close', () => { closed = true; clearInterval(interval); });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const wallStarted = Date.now();
        const streamed = await getAiComment({ ...parm, url: `http://127.0.0.1:${server.address().port}/ai`, timeout_ms: 60 }, specificSource);
        assert.strictEqual(streamed.action, 'skip');
        assert(streamed.reason.includes('总耗时'));
        assert(Date.now() - wallStarted < 1500);
        await new Promise(resolve => setTimeout(resolve, 30));
        assert.strictEqual(closed, true);
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }

    /* 抽奖分类请求使用原函数、原参数，不受评论预算/协议影响 */
    setup(api({ has_key_words: true }));
    const classified = await utils.getAiContent(parm.url, { model: 'classifier-model', max_tokens: 1024 }, '分类prompt', '分类正文');
    assert.strictEqual(classified, '{"has_key_words":true}');
    assert.deepStrictEqual(requests[0].config, { timeout: 120000 });
    assert.strictEqual(requests[0].contents.max_tokens, 1024);
    assert.strictEqual(requests[0].contents.messages[0].content, '分类prompt');

    /* Monitor集成: 先筛选, 实际参与时才生成; 同账号同动态不重复发布 */
    Object.assign(config, {
        model: '11', chatmodel: '11', check_if_duplicated: -1, wait: 0, filter_wait: 0,
        search_wait: 0, minfollower: 0, maxday: Infinity, only_followed: false,
        is_not_create_partition: true, create_dy: false, save_lottery_info_to_file: false,
        set_lottery_info_url: '', is_copy_chat: false, is_repost_then_chat: false,
        ai_comments_parm: parm, chat: ['我已购买了产品', '期待好运。']
    });
    process.env.ENABLE_AI_COMMENTS = 'true';
    delete process.env.ENABLE_AI_JUDGE;
    delete process.env.NOT_GO_LOTTERY;
    globalVar.set('attentionList', new Set(['123']));
    globalVar.set('runStats', undefined);
    globalVar.set('aiCommentCache', new Map());
    globalVar.set('aiCommentAttempts', new Set());
    const writes = [];
    bili.sendChatWithOcr = async (rid, chat) => { writes.push(['comment', rid, chat]); return 0; };
    bili.autoRelay = async (...args) => { writes.push(['relay', ...args]); return 0; };
    bili.getLotteryNotice = async () => ({ ts: Date.now() / 1000 + 86400 });
    storage.updateDyid = async id => writes.push(['stored', id]);
    const sourceInfo = { lottery_info_type: 'tag', dyid: '1234567890123456789', uids: [123], uname: '测试UP',
        ctrl: [], type: 4, des: genericSource, rid: '1234567890123456789', chat_type: 17,
        hasOfficialLottery: true, reserve_id: 0, reserve_lottery_text: '' };
    const monitor = new Monitor(['UIDs', 123]);
    monitor.LotteryInfoMap.set('UIDs', async () => [sourceInfo]);
    setup();
    const options = await monitor.filterLotteryInfo();
    assert.strictEqual(requests.length, 0, '批量筛选阶段不能生成评论');
    assert.strictEqual(options[0].aiCommentSource, genericSource);
    setup(api(genericResult));
    assert.strictEqual(await monitor.go(options[0]), 0);
    assert.strictEqual(requests.length, 1);
    assert.deepStrictEqual(writes.filter(w => w[0] === 'comment').map(w => w[2]), [genericResult.comment]);
    const nextSource = new Monitor(['UIDs', 456]);
    assert.strictEqual(await nextSource.go({ ...options[0] }), 1013);
    assert.strictEqual(requests.length, 1);
    assert.strictEqual(writes.filter(w => w[0] === 'comment').length, 1);
    assert.strictEqual(globalVar.getRunStats().ai_comment_requested, 1);
    const beforeBlockedWrites = writes.length;
    setup();
    for (const [index, source] of blockedSources.entries()) {
        assert.strictEqual(await monitor.go({ ...options[0], dyid: `blocked-${index}`, aiCommentSource: source }), 1013);
    }
    assert.strictEqual(writes.length, beforeBlockedWrites, '非抽奖/缺规则输入不应继续评论、关注或转发');
    assert.strictEqual(requests.length, 0);

    /* 交友类附带抽奖执行指定奖品意愿，真实API仍用桩，不编写资料 */
    setup();
    const socialOption = { ...options[0], dyid: 'social-lottery', rid: 'social-lottery', aiCommentSource: socialLottery };
    assert.strictEqual(await monitor.go(socialOption), 0);
    assert.strictEqual(socialOption.chat, '我想要七夕礼物');
    assert.strictEqual(socialOption.isAiChat, false);
    assert.strictEqual(requests.length, 0);
    assert.strictEqual(writes.filter(w => w[0] === 'comment').at(-1)[2], '我想要七夕礼物');

    /* 原生视频目标由Monitor传递, 不能被误当成未解析的外链目标 */
    setup(api(genericResult));
    const nativeVideo = { ...options[0], dyid: '2234567890123456780', chat_type: 1,
        aiCommentSource: '关注品牌，点赞评论本期视频，随机掉落机械键盘。' };
    assert.strictEqual(await monitor.go(nativeVideo), 0);
    assert.strictEqual(requests.length, 1);

    const fixedOption = id => ({ uid: [], dyid: id, rid: id, chat_type: 17, ctrl: '[]', relay_chat: '转发动态',
        chat: '旧随机评论', aiCommentSource: fixedSource, commentUname: '测试UP' });
    const fixedResult = { mode: 'specific', requirement: '评论：“好运常在”', comment: '好运常在' };
    setup(api(fixedResult), api(fixedResult));
    assert.strictEqual(await monitor.go(fixedOption('2234567890123456789')), 0);
    assert.strictEqual(await monitor.go(fixedOption('3234567890123456789')), 0);
    assert.strictEqual(writes.filter(w => w[0] === 'comment' && w[2] === '好运常在').length, 2, '不同动态固定口令允许相同');

    const unsafe = { ...fixedOption('4234567890123456789'), aiCommentSource: specificSource };
    setup(api({ ...specificResult, comment: specificResult.requirement }));
    const beforeUnsafeWrites = writes.length;
    assert.strictEqual(await monitor.go(unsafe), 1013);
    assert.strictEqual(writes.length, beforeUnsafeWrites, '校验失败不执行评论/点赞/转发');

    setup('[请求失败]: timeout');
    const fallback = { ...fixedOption('5234567890123456789'), aiCommentSource: genericSource };
    assert.strictEqual(await monitor.go(fallback), 0);
    assert.strictEqual(fallback.chat, '期待好运。', '只从安全通用评论中选回退');
    assert.strictEqual(globalVar.getRunStats().ai_comment_fallback, 1);

    config.is_repost_then_chat = true;
    const required = { ...fixedOption('6234567890123456789'), requiredRelayElements: true, relay_chat: '转发动态#指定话题#' };
    setup(api(fixedResult));
    assert.strictEqual(await monitor.go(required), 0);
    assert.strictEqual(writes.filter(w => w[0] === 'relay').at(-1)[3], '转发动态#指定话题#', '不丢失转发必需的话题');
    config.is_repost_then_chat = false;

    /* 评论成功但转发请求失败后, 另一来源不再生成或再次评论 */
    bili.autoRelay = async (...args) => { writes.push(['relay', ...args]); return 99; };
    const partial = fixedOption('6234567890123456788');
    const partialCommentCount = writes.filter(w => w[0] === 'comment').length;
    setup(api(fixedResult));
    assert.strictEqual(await monitor.go(partial), 5099);
    assert.strictEqual(await new Monitor(['APIs', 'later-source']).go({ ...partial }), 1013);
    assert.strictEqual(requests.length, 1);
    assert.strictEqual(writes.filter(w => w[0] === 'comment').length, partialCommentCount + 1);
    bili.autoRelay = async (...args) => { writes.push(['relay', ...args]); return 0; };

    /* 显式抄热评保持原配置优先级, 不浪费AI请求 */
    config.is_copy_chat = true;
    config.copy_blockword = ['不允许'];
    bili.getChat = async () => [['他人', '配置选择的热评']];
    setup();
    const copiedOptions = await monitor.filterLotteryInfo();
    assert.strictEqual(copiedOptions[0].aiCommentSource, undefined);
    assert.strictEqual(await monitor.go({ ...copiedOptions[0], dyid: '6234567890123456787' }), 0);
    assert.strictEqual(requests.length, 0);
    config.is_copy_chat = false;

    const beforeRejected = writes.length;
    bili.sendChatWithOcr = async (rid, text) => { writes.push(['comment', rid, text]); return 9; };
    setup(api(fixedResult));
    assert.strictEqual(await monitor.go(fixedOption('7234567890123456789')), 1009);
    assert.strictEqual(writes.length, beforeRejected + 1, '重复/敏感评论不改成表情再次提交');

    setup();
    process.env.NOT_GO_LOTTERY = 'true';
    const dryWrites = writes.length;
    assert.strictEqual(await monitor.go(fixedOption('8234567890123456789')), 0);
    assert.strictEqual(requests.length, 0, '演练不烧AI请求');
    assert.strictEqual(writes.length, dryWrites);
    delete process.env.NOT_GO_LOTTERY;

    /* 已过期/粉丝数不满足/未处理的动态不生成AI评论 */
    const expired = new Monitor(['UIDs', 'expired']);
    expired.filterLotteryInfo = async () => [{ ...fixedOption('9234567890123456789'), isOfficialLottery: true, drawtime: -1 }];
    bili.getLotteryNotice = async () => ({ ts: 1 });
    setup();
    await expired.startLottery();
    assert.strictEqual(requests.length, 0);
    config.minfollower = 1000;
    const fewFollowers = new Monitor(['UIDs', 'fans']);
    fewFollowers.filterLotteryInfo = async () => [{ ...fixedOption('9234567890123456788'), uid: [999], drawtime: -1 }];
    bili.getUserInfo = async () => 10;
    await fewFollowers.startLottery();
    assert.strictEqual(requests.length, 0);
    config.minfollower = 0;

    /* 人工/质量跳过正确计入skipped, 不写已参与; 不影响P2统计恒等式 */
    globalVar.set('runStats', undefined);
    const manual = new Monitor(['UIDs', 'manual']);
    manual.filterLotteryInfo = async () => [{ ...fixedOption('9234567890123456787'), aiCommentSource: '根据图片回答评论问题，抽键盘。', drawtime: -1 }];
    const beforeManualStored = writes.filter(w => w[0] === 'stored').length;
    await manual.startLottery();
    const stats = globalVar.getRunStats();
    assert.strictEqual(stats.processed, 1);
    assert.strictEqual(stats.skipped, 1);
    assert.strictEqual(stats.relayed, 0);
    assert.strictEqual(stats.ai_comment_skipped, 1);
    assert.strictEqual(stats.ai_comment_requested, 0);
    assert.strictEqual(writes.filter(w => w[0] === 'stored').length, beforeManualStored);
    assert.strictEqual(stats.processed, stats.relayed + stats.skipped + stats.failed + stats.simulated);
    console.log('offline AI comment deadline, validation and deferred publishing tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
