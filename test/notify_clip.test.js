const assert = require('assert');
const utils = require('../lib/utils');
const { log } = utils;
const { clipDesp } = require('../lib/helper/notify');

const htmlPage = '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">\n'
    + '<html lang="zh-cn">\n<head>\n<style>\n'
    + 'body { background: #fff; }\n'.repeat(200)
    + '</style>\n</head>\n<body>出错啦! - bilibili.com</body>\n</html>';
const failedResponse = 'SyntaxError: Unexpected token \'响\', "[响应错误]HTTP状"... is not valid JSON\n'
    + '[响应错误]HTTP状态码: 404 响应数据:\n' + htmlPage;
const pageError = '[遇到页面错误]HTTP状态码: 404（响应为HTML页面，响应体已忽略）';

/**HTML 错误页直接变成一句页面错误：保留状态码，丢掉异常栈与响应体 */
const clipped = log._clip(failedResponse);
assert(clipped.includes('遇到页面错误'), '应直接给出页面错误提示');
assert(clipped.includes('404'), '应保留状态码');
assert(!clipped.includes('<html'), '不应保留 HTML 标签');
assert(!clipped.includes('SyntaxError'), '不应再输出 JSON 解析异常');
assert(clipped.length < 100, '页面错误提示应是一句话');

/**普通超长文本限长，短文本与空值不受影响 */
assert(log._clip('x'.repeat(5000)).length <= log._text_limit + 40);
assert.strictEqual(log._clip('正常日志'), '正常日志');
assert.strictEqual(log._clip(undefined), '');
assert.strictEqual(log._clip(null), '');
assert(log._clip('正常HTML页面\n' + htmlPage).includes('HTML页面响应体已省略'), '正常 HTML 响应不应误报为错误');

/**页面错误不再伪装成 json解析，缓存(通知数据源)中只留一句提示 */
const saved_cache = log._cache;
log._cache = [];
log.error('json解析', failedResponse);
utils.strToJson(pageError);
const cached = log._cache.join('\n');
assert(cached.includes('遇到页面错误'), '通知数据源应含页面错误提示');
assert(cached.includes('页面错误'), '应记录页面错误');
assert(!cached.includes('SyntaxError'), '缓存中不应出现 JSON 解析异常');
assert(!cached.includes('<html'), '缓存中不应出现整页 HTML');
assert(cached.length < 1000, '单条缓存日志应被限长');

/**按 lib/lottery.js 的过滤规则拼出的通知正文同样短且可读 */
const notice = `本次运行共参与0个抽奖\n${log._cache.filter(it => /抽奖\]|Error|\s抽奖信息\]/.test(it)).join('\n')}`;
assert(notice.length < 1000, '通知正文不应再出现长串错误');
assert(notice.includes('遇到页面错误'), '通知里直接能看到页面错误');
assert(!notice.includes('<html'), '通知正文不应含 HTML');
log._cache = saved_cache;

/**通知正文兜底：按整行限长、不切断单行、短文本原样返回 */
assert.strictEqual(clipDesp('短通知', 200), '短通知');
const longDesp = Array.from({ length: 100 }, (_, i) => `第${i}行日志`).join('\n');
const limited = clipDesp(longDesp, 200);
assert(limited.length <= 280, '限长后只应多出省略提示');
assert(limited.includes('已省略'), '应标注省略');
assert(limited.split('\n').some(it => /^第\d+行日志$/.test(it)), '应保留完整的日志行');
assert(clipDesp('y'.repeat(1000), 100).length <= 140, '单行超长时按字符截断');

console.log('notify_clip.test.js: 全部通过');
