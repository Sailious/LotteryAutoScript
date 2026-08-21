const { log, writeDyidFile, dyids_dir } = require('../utils');
const fs = require('fs');
const path = require('path');

/**内存缓存：按账号 num 缓存 dyid 集合，避免每次查询全量扫描文件 */
const dyidSets = new Map();

/**
 * 惰性加载指定账号的 dyid 集合
 * @param {number} num
 * @returns {Set<string>}
 */
function loadDyidSet(num) {
    let set = dyidSets.get(num);
    if (set) return set;

    set = new Set();
    const fpath = num < 2 ? path.join(dyids_dir, 'dyid.txt') : path.join(dyids_dir, `dyid${num}.txt`);
    try {
        const content = fs.readFileSync(fpath, 'utf8');
        for (const id of content.split(',')) {
            if (id) set.add(id);
        }
    } catch (_) {
        /**文件不存在时返回空集合 */
    }
    dyidSets.set(num, set);
    return set;
}

const d_storage = {
    /**
     * 搜索dyid
     * @param {string} dyid
     * @returns {Promise<boolean>}
     */
    searchDyid: async (dyid) => {
        const set = loadDyidSet(Number(process.env.NUMBER));
        return set.has(dyid);
    },
    /**
     * 更新dyid
     * @param {string} dyid
     */
    updateDyid: (dyid) => {
        log.info('更新dyid', `写入${dyid}`);
        const set = loadDyidSet(Number(process.env.NUMBER));
        set.add(dyid);
        return new Promise((resolve) => {
            const ws = writeDyidFile(Number(process.env.NUMBER));
            ws.write(dyid + ',', () => {
                ws.destroy();
                resolve();
            });
            ws.on('error', err => {
                log.error('更新dyid', err);
                resolve();
            });
        });
    }
};


module.exports = d_storage;