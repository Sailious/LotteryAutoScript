const { log, writeCollectionFile, createDir, collections_dir } = require('../utils');
const fs = require('fs');
const path = require('path');

/**内存缓存：按账号 num 缓存合集解析状态集合，避免每次查询全量扫描文件 */
const collectionSets = new Map();

/**
 * 惰性加载指定账号的合集解析状态集合
 * @param {number} num
 * @returns {Set<string>}
 */
function loadCollectionSet(num) {
    let set = collectionSets.get(num);
    if (set) return set;

    set = new Set();
    const fpath = num < 2 ? path.join(collections_dir, 'collection.txt') : path.join(collections_dir, `collection${num}.txt`);
    try {
        const content = fs.readFileSync(fpath, 'utf8');
        for (const id of content.split(',')) {
            if (id) set.add(id);
        }
    } catch (_) {
        /**文件不存在时返回空集合 */
    }
    collectionSets.set(num, set);
    return set;
}

const collection_storage = {
    /**
     * 搜索合集是否已解析
     * 以合集动态ID作为唯一标识
     * @param {string} collectionId 合集动态ID
     * @returns {Promise<boolean>}
     */
    searchCollection: async (collectionId) => {
        const set = loadCollectionSet(Number(process.env.NUMBER));
        return set.has(collectionId);
    },
    /**
     * 记录合集已解析
     * @param {string} collectionId 合集动态ID
     */
    updateCollection: async (collectionId) => {
        log.info('合集状态记录', `标记合集(${collectionId})已解析`);
        const set = loadCollectionSet(Number(process.env.NUMBER));
        set.add(collectionId);
        await createDir(collections_dir);
        return new Promise((resolve) => {
            const ws = writeCollectionFile(Number(process.env.NUMBER));
            ws.write(collectionId + ',', () => {
                ws.destroy();
                resolve();
            });
            ws.on('error', err => {
                log.error('合集状态记录', err);
                resolve();
            });
        });
    }
};


module.exports = collection_storage;