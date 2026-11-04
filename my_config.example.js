module.exports = Object.freeze({
    /** 
     * 默认设置(公用)
     * 修改公用设置可填写到最下方
     * 单独设置区将会覆盖公共设置
     */
    default_config: {
        /**
         * 监视更转的用户uid
         */
        UIDs: [],

        /**
         * 监视的tag
         */
        TAGs: [],

        /**
         * 监视的专栏关键词
         */
        Articles: [],

        /**
         * @typedef {object} LotteryInfo
         * @property {string} lottery_info_type
         * @property {number} create_time
         * @property {boolean} is_liked
         * @property {number[]} uids `[uid,ouid]`
         * @property {string} uname
         * @property {Array<{}>} ctrl
         * @property {string} dyid
         * @property {string} reserve_id
         * @property {string} reserve_lottery_text
         * @property {string} rid
         * @property {string} des
         * @property {number} type
         * @property {boolean} hasOfficialLottery 是否官方
         * @typedef {object} RespondBody
         * @property {string} err_msg 错误信息
         * @property {LotteryInfo[]} lottery_info
         * 
         * - 从API接口中获取抽奖信息
         * 获取抽奖信息的链接字符串
         * @example
         * ["https://github.com/spiritLHL/sync_lottery"]
         * 
         * - 从当前路径下符合要求的文件中获取
         * 文件名
         * @example
         * ["file://lottery_info_1.json"]
         */
        APIs: ['file://lottery_info_1.json'],

        /**
         * lottery_dyids目录下抽奖动态文件名(如dyids.txt)
         * 一行一个dyids(非数字字符分割即可)
         */
        TxT: ['dyids.txt'],

        /**
         * 抽奖参与顺序组合
         * * 0 - UIDs
         * * 1 - TAGs
         * * 2 - Articles
         * * 3 - APIs
         * * 4 - TxT
         * @example
         * [3,2,1,0]
         * [1,2,1,2,1]
         */
        LotteryOrder: [2, 0, 1, 3],

        /**
         * 保存抽奖信息至文件
         */
        save_lottery_info_to_file: false,

        /**
         * API发送数据类型 {LotteryInfo[]}
         * 上传抽奖信息的链接字符串
         */
        set_lottery_info_url: '',

        /**
         * 动态中的关键词(表示须同时满足以下条件)
         * 符合js正则表达式的字符串
         */
        key_words: [
            '[抽奖送揪]|福利',
            '[转关评粉]|参与'
        ],

        /**
         * AI 判断抽奖
         * https://learn.microsoft.com/en-us/azure/ai-foundry/openai/reference#chat-completions
         */
        ai_judge_parm: {
            /**
             * /chat/completions
             */
            url: '',
            body: {},
            prompt: ''
        },

        /**
         * - '00' 关闭自动抽奖
         * - '10' 只转发官方抽奖
         * - '01' 只转发非官方抽奖
         * - '11' 都转
         */
        model: '11',

        /**
         * - '00'关闭自动评论
         * - '10'只评论官抽
         * - '01'只评论非官抽
         * - '11'都评论
         */
        chatmodel: '01',

        /**
         * 不参与预约抽奖
         */
        disable_reserve_lottery: false,

        /**
         * 不转关预约抽奖
         * - 预约抽奖可能与转发抽奖并存
         */
        is_not_relay_reserve_lottery: false,

        /**
         * 检查是否重复转发
         * - 不检查 -1
         * - 通过是否点赞判断(自动点赞) 0
         * - 检索本地dyids文件 1
         * - 通过是否点赞判断(不自动点赞)+检索本地dyids文件 2
         * - 通过是否点赞判断(自动点赞)+检索本地dyids文件 3
         */
        check_if_duplicated: 1,

        /**
         * 偷塔模式不检查是否重复转发
         * * 偷塔模式: 临近开奖时参与抽奖
         */
        sneaktower: true,

        /**
         * 屏蔽动态类型
         * 
         * | 动态类型   | type值 |
         * | :------- |:----- |
         * | 转发       | `1`    |
         * | 含图片     | `2`    |
         * | 无图纯文字  | `4`    |
         * | 视频       | `8`    |
         * | 番剧       | `512`  |
         * | 活动       | `2048` |
         * | 专栏       | `64`   |
         */
        block_dynamic_type: [0],

        /**
         * - 动态创建时间
         * - 多少天前
         */
        max_create_time: 60,

        /**
         * 不加判断的转发所监视的uid转发的动态
         */
        is_imitator: false,

        /**
         * - 在uid里检索的页数
         */
        uid_scan_page: 3,

        /**
         * - 在tag里检索的页数
         */
        tag_scan_page: 3,

        /**
         * - 获取专栏数量
         */
        article_scan_page: 3,

        /**
         * - 专栏创建时间距离现在的最大天数
         */
        article_create_time: 7,

        /**
         * - 不检查专栏是否看过，若选择检查可以提高检测效率
         * - 默认false(检查)
         */
        not_check_article: false,

        /**
         * - 专栏深度解析模式
         * - 开启后会解析专栏中内嵌的每个独立抽奖链接
         * - 进入每个独立抽奖页面进行评论、转发等操作
         * - 而不是在合集文章本身下面操作
         * - 适用于合集类专栏文章，其中包含多个独立抽奖链接的场景
         * - 默认false(关闭)
         */
        article_deep_parse: false,

        /**
         * - 开奖时间距离现在的最大天数
         * - 默认不限制
         */
        maxday: Infinity,

        /**
         *  - 循环等待时间(指所有操作完毕后的休眠时间)
         *  - 单位毫秒
         */
        lottery_loop_wait: 0,
        check_loop_wait: 0,
        clear_loop_wait: 0,

        /**
         * - 转发间隔时间
         * - 单位毫秒
         * - 上下浮动50%
         */
        wait: 30 * 1000,

        /**
         * - 检索动态间隔
         * - 单位毫秒
         */
        search_wait: 2000,

        /**
         * - 读取下一页私信间隔
         * - 单位毫秒
         */
        get_session_wait: 3000,

        /**
         * - 已读私信间隔
         * - 单位毫秒
         */
        update_session_wait: 1000,

        /**
         * - 读取下一页关注列表间隔
         * - 单位毫秒
         */
        get_partition_wait: 2000,

        /**
         * - 获取动态细节间隔
         * - 单位毫秒
         */
        get_dynamic_detail_wait: 2000,

        /**
         * - 过滤间隔(开奖时间/粉丝数)
         * - 单位毫秒
         */
        filter_wait: 1000,

        /**
         * - 随机动态间隔
         * - 单位毫秒
         */
        random_dynamic_wait: 2000,

        /**
         * - 预约抽奖间隔
         * - 单位毫秒
         */
        reserve_lottery_wait: 6000,

        /**
         * - up主粉丝数限制
         */
        minfollower: 1000,

        /**
         * - 只转发已关注的
         */
        only_followed: false,

        /**
         * - 是否发送随机动态(防止被开奖机过滤)
         */
        create_dy: false,

        /**
         * 随机动态类型
         * - 0 自定义文字与图片
         * - 1 推荐视频
         * - -1 混合
         */
        create_dy_type: 0,

        /**
         * - 结束运行时发送随机动态的数量
         */
        create_dy_num: 1,

        /**
         * - 随机动态内容
         * - 类型 `content[]`
         * @typedef Picture
         * @property {string} img_src 站内源
         * @property {number} img_width
         * @property {number} img_height
         * @param { string | Picture[] } content
         */
        dy_contents: ['[doge]', '[doge][doge]'],

        /**
         * - 每转发x条抽奖动态就发送x条随机动态
         * - @example [[10,11,9],[6,8,9]] 每转发9,10,11条抽奖动态就发送6,8,9条随机动态
         */
        create_dy_mode: [[0], [0]],

        /**
         * 转发时[at]的用户
         */
        at_users: [['转发抽奖娘', 294887687], ['你的工具人老公', 100680137]],

        /**
         * - 动态dyid或UID
         * - 英文逗号分隔 如: 1,2,3
         */
        blacklist: '',

        /**
         * 屏蔽词
         */
        blockword: ['脚本', '抽奖号', '钓鱼'],

        /**
         * 转发并评论
         * - 评论内容与转发内容相同
         */
        is_repost_then_chat: false,

        /**
         * 转发评语
         * 支持变量${uname}
         */
        relay: ['转发动态'],

        /**
         * 评论内容
         * 支持变量${uname}
         * @example
         * "祝${uname}早日百大!"
         */
        chat: [
            '[OK]', '[星星眼]', '[歪嘴]', '[喜欢]', '[偷笑]', '[笑]', '[喜极而泣]', '[辣眼睛]', '[吃瓜]', '[奋斗]',
            '永不缺席 永不中奖 永不放弃！', '万一呢', '在', '冲吖~', '来了', '万一', '[保佑][保佑]', '从未中，从未停', '[吃瓜]', '[抠鼻][抠鼻]',
            '来力', '秋梨膏', '[呲牙]', '从不缺席', '分子', '可以', '恰', '不会吧', '1', '好',
            'rush', '来来来', 'ok', '冲', '凑热闹', '我要我要[打call]', '我还能中！让我中！！！', '大家都散了吧，已经抽完了，是我的', '我是天选之子', '给我中一次吧！',
            '坚持不懈，迎难而上，开拓创新！', '[OK][OK]', '我来抽个奖', '中中中中中中', '[doge][doge][doge]', '我我我',
        ],

        /**
         * AI Chat completions参数
         * https://learn.microsoft.com/en-us/azure/ai-foundry/openai/reference#chat-completions
         */
        ai_comments_parm: {
            /**
             * /chat/completions
             */
            url: '',
            body: {},
            prompt: ''
        },

        /**
         * 是否抄热评
         */
        is_copy_chat: false,

        /**
         * 热评屏蔽词
         */
        copy_blockword: ['三不原则'],

        /**
         * - 抽奖UP用户分组id(网页端点击分区后地址栏中的tagid)
         * - 自动获取
         */
        partition_id: 0,

        /**
         * - 是否不为抽奖UP单独设置关注分区
         */
        is_not_create_partition: false,

        /**
         * 是否异常
         */
        is_exception: false,

        /**
         * 是否关注已达上限
         */
        is_outof_maxfollow: false,

        /**
         * - 中奖通知关键词(满足一个就推送)
         * - 符合js正则表达式的字符串
         * - 若以 ~ 开头则表示为黑名单规则
         * - 优先级递增
         */
        notice_key_words: [
            '~预约成功|预约主题',
            '中奖|获得|填写|写上|提供|收货地址|支付宝账号|码|大会员',
            '~你的账号在新设备或平台登录成功',
            '~你预约的直播已开始'
        ],

        /**
         * 是否发送运行状态通知
         */
        notice_running_state: false,

        /**
         * - 获取私信页数
         */
        check_session_pages: 16,

        /**
         * - 清理白名单uid或dyid
         * - 英文逗号分隔 如: 1,2,3
         */
        clear_white_list: '',

        /**
         * - 取关分区
         * - 默认为: 此处存放因抽奖临时关注的up
         * - 可用逗号分割以取关多分区
         */
        clear_partition: '',

        /**
         * 清理多少天之前的动态或关注
         */
        clear_max_day: 30,

        /**
         * - 快速移除关注
         * - 不加判断只去除关注
         */
        clear_quick_remove_attention: false,

        /**
         * - 快速移除关注
         * - 不加判断只去除关注
         * - 移除粉丝数小于指定数量的
         */
        clear_quick_remove_attention_fans_number_smallest: Infinity,

        /**
         * 是否移除动态
         */
        clear_remove_dynamic: true,

        /**
         * 是否移除关注
         */
        clear_remove_attention: true,

        /**
         * 清除延时(毫秒)
         */
        clear_remove_delay: 8000,

        /**
         * 清除动态类型
         * 
         * | 动态类型   | type值 |
         * | :------- |:----- |
         * | 无        | `0`    |
         * | 转发       | `1`    |
         * | 含图片     | `2`    |
         * | 无图纯文字  | `4`    |
         * | 视频       | `8`    |
         * | 番剧       | `512`  |
         * | 活动       | `2048` |
         * | 专栏       | `64`   |
         * 
         * @example
         * 1
         * [1,2,4]
         */
        clear_dynamic_type: [1],
    },

    /**
     * 针对某一账号的特别设置
     * config_[数字] 依次类推
     */
    config_1: {
        /**
         * 手动添加抽奖号UID
         * - 抽奖动态下的二级小号
         * 
         * 帐号1存储抽奖信息至文件
         */
        UIDs: [],

        TAGs: [],

        Articles: [
            '抽奖合集'
        ],

        APIs: [],

        ai_judge_parm: {
            url: 'https://api.deepseek.com/chat/completions',
            body: {
                'model': 'Qwen/Qwen3-32B',
                /* 思考模型可能把推理过程混进正文, 解析侧已能剥离 <think> 标签 */
                'enable_thinking': true,
            },
            prompt: '你是严格的B站动态抽奖分类器，只做二分类。判定为抽奖(true)的条件：动态正文包含奖品或名额，且要求转发、关注、评论、@好友、带话题等参与方式，通常还有开奖时间。判定为非抽奖(false)：普通动态、纯广告资讯、无奖品的活动预告、已开奖的结果公示、求三连但无奖品、纯图片表情无文字。输出规则（必须严格遵守）：1. 只输出一个 JSON 对象，且仅含布尔字段 has_key_words；2. 格式只能是 {"has_key_words":true} 或 {"has_key_words":false}；3. 禁止 Markdown 代码块和三反引号围栏、禁止解释文字、推理过程、前后缀、注释或换行；4. 禁止输出数组、字符串、null 或多个对象；5. 无法判断时输出 {"has_key_words":false}。示例：输入「转发并关注，6月10日抽3位送机械键盘」输出 {"has_key_words":true}；输入「今天天气不错，分享新拍的照片」输出 {"has_key_words":false}。'
        },

        ai_comments_parm: {
            url: 'https://api.deepseek.com/chat/completions',
            body: {
                'model': 'Qwen/Qwen3-32B',
                'enable_thinking': true,
            },
            prompt: '作为B站动态抽奖参与者，为给定动态生成一条可直接发布的评论。第一步：判断动态是否对评论内容提出了明确要求（例如预测胜负并写清战队名称和理由、回答指定问题、写出观点或文案、带指定话题等）。第二步：若有明确要求，必须正面具体地满足它，写清动态所问的信息（预测类要写明具体战队名称和一句理由），内容与该动态强相关、像真人发言，此时不要套用「我想要xxx」；若无明确要求，只输出「我想要xxx」，xxx 为指定奖品的核心简写名称（取主体或型号，省略容量、颜色、版本等），只提一个奖品。通用规则：只输出一条评论正文；不@任何用户；不列举多个奖品；不输出解释、前缀、编号、引号、Markdown 或代码块；不复制动态原文；控制在 60 字以内；除评论本身外不输出任何内容。示例：动态「转发并评论：哪支队伍能夺冠？写清战队名称和理由，抽西昊C300Pro」输出「看好BLG，中野联动和团战处理更稳，应该能夺冠！」；动态「关注转发抽一把机械键盘」输出「我想要机械键盘」。'
        },

        save_lottery_info_to_file: true,
    },
    /**
     * 后续帐号从文件提取抽奖信息转抽
     */
    config_2: {},
    config_3: {}
});
