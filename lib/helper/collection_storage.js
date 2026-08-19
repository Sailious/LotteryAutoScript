const { log, readCollectionFile, writeCollectionFile, createDir, collections_dir } = require('../utils');

const collection_storage = {
    /**
     * 搜索合集是否已解析
     * 以合集动态ID作为唯一标识
     * @param {string} collectionId 合集动态ID
     * @returns {Promise<boolean>}
     */
    searchCollection: async (collectionId) => {
        let buffer = '';
        let found = false;

        try {
            const stream = readCollectionFile(Number(process.env.NUMBER));

            for await (const chunk of stream) {
                buffer += chunk;

                if (buffer.split(',').includes(collectionId)) {
                    found = true;
                    stream.destroy();
                    return found;
                }

                const lastCommaIdx = buffer.lastIndexOf(',');
                if (lastCommaIdx !== -1) {
                    buffer = buffer.slice(lastCommaIdx);
                }
            }

            if (!found && buffer.length > 0) {
                if (buffer.split(',').includes(collectionId)) {
                    found = true;
                }
            }

            stream.destroy();
        } catch (e) {
            log.debug('合集状态查询', `读取合集状态文件失败: ${e.message}`);
        }

        return found;
    },
    /**
     * 记录合集已解析
     * @param {string} collectionId 合集动态ID
     */
    updateCollection: async (collectionId) => {
        log.info('合集状态记录', `标记合集(${collectionId})已解析`);
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
