/**
 * Ignored Channels Manager
 * Gerencia canais/chats onde o Alfred não deve responder
 * 
 * @module lib/ignored-channels
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// Arquivo para persistir os canais ignorados
const DATA_FILE = path.join(__dirname, '../../data/ignored-channels.json');

// Cache em memória
let ignoredChannels = new Set();

/**
 * Carrega canais ignorados do arquivo
 */
function load() {
    try {
        // Garante que o diretório data existe
        const dataDir = path.dirname(DATA_FILE);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        if (fs.existsSync(DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            ignoredChannels = new Set(data.channels || []);
            logger.info(`[IgnoredChannels] Carregados ${ignoredChannels.size} canais ignorados`);
        }
    } catch (error) {
        logger.error('[IgnoredChannels] Erro ao carregar:', error);
        ignoredChannels = new Set();
    }
}

/**
 * Salva canais ignorados no arquivo
 */
function save() {
    try {
        const dataDir = path.dirname(DATA_FILE);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        fs.writeFileSync(DATA_FILE, JSON.stringify({
            channels: Array.from(ignoredChannels),
            updatedAt: new Date().toISOString()
        }, null, 2));
    } catch (error) {
        logger.error('[IgnoredChannels] Erro ao salvar:', error);
    }
}

/**
 * Verifica se um canal está ignorado
 * @param {string} channelId - ID do canal
 * @returns {boolean}
 */
function isIgnored(channelId) {
    return ignoredChannels.has(channelId);
}

/**
 * Adiciona um canal à lista de ignorados
 * @param {string} channelId - ID do canal
 * @returns {boolean} true se foi adicionado, false se já existia
 */
function addChannel(channelId) {
    if (ignoredChannels.has(channelId)) {
        return false;
    }
    ignoredChannels.add(channelId);
    save();
    logger.info(`[IgnoredChannels] Canal adicionado: ${channelId}`);
    return true;
}

/**
 * Remove um canal da lista de ignorados
 * @param {string} channelId - ID do canal
 * @returns {boolean} true se foi removido, false se não existia
 */
function removeChannel(channelId) {
    if (!ignoredChannels.has(channelId)) {
        return false;
    }
    ignoredChannels.delete(channelId);
    save();
    logger.info(`[IgnoredChannels] Canal removido: ${channelId}`);
    return true;
}

/**
 * Lista todos os canais ignorados
 * @returns {string[]}
 */
function listChannels() {
    return Array.from(ignoredChannels);
}

/**
 * Quantidade de canais ignorados
 * @returns {number}
 */
function count() {
    return ignoredChannels.size;
}

// Carrega ao iniciar
load();

module.exports = {
    isIgnored,
    addChannel,
    removeChannel,
    listChannels,
    count,
    load
};
