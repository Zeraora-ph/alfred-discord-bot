/**
 * Cache Service
 * Redis-based caching layer for performance optimization
 * 
 * @module services/cache-service
 */

const redis = require('../lib/redis-client');
const logger = require('../lib/logger');

// ============================================
// Cache Configuration
// ============================================

const DEFAULT_TTL = {
    guildInfo: 60,          // 1 minute
    userNames: 300,         // 5 minutes
    embeddings: 3600,       // 1 hour
    memories: 120,          // 2 minutes
    stats: 30               // 30 seconds
};

// ============================================
// Core Cache Operations
// ============================================

/**
 * Gets a value from cache
 * 
 * @param {string} key - Cache key
 * @returns {Promise<any|null>} Cached value or null
 */
async function get(key) {
    try {
        const data = await redis.get(key);
        if (data) {
            return JSON.parse(data);
        }
        return null;
    } catch (error) {
        logger.warn('[Cache] Erro ao ler cache:', error.message);
        return null;
    }
}

/**
 * Sets a value in cache
 * 
 * @param {string} key - Cache key
 * @param {any} value - Value to cache
 * @param {number} [ttl] - Time to live in seconds
 * @returns {Promise<boolean>} Success status
 */
async function set(key, value, ttl = 300) {
    try {
        await redis.setex(key, ttl, JSON.stringify(value));
        return true;
    } catch (error) {
        logger.warn('[Cache] Erro ao gravar cache:', error.message);
        return false;
    }
}

/**
 * Deletes a key from cache
 * 
 * @param {string} key - Cache key
 * @returns {Promise<boolean>} Success status
 */
async function del(key) {
    try {
        await redis.del(key);
        return true;
    } catch (error) {
        logger.warn('[Cache] Erro ao deletar cache:', error.message);
        return false;
    }
}

/**
 * Deletes keys matching a pattern
 * 
 * @param {string} pattern - Key pattern (e.g., "guild:*")
 * @returns {Promise<number>} Number of deleted keys
 */
async function delPattern(pattern) {
    try {
        const keys = await redis.keys(pattern);
        if (keys.length > 0) {
            await redis.del(...keys);
        }
        return keys.length;
    } catch (error) {
        logger.warn('[Cache] Erro ao deletar padrão:', error.message);
        return 0;
    }
}

// ============================================
// Domain-Specific Cache Functions
// ============================================

/**
 * Gets guild info with caching
 * 
 * @param {string} guildId - Guild ID
 * @param {Function} fetchFn - Function to fetch if not cached
 * @returns {Promise<Object|null>} Guild info
 */
async function getGuildInfo(guildId, fetchFn) {
    const key = `guild:${guildId}:info`;

    let data = await get(key);
    if (data) {
        return data;
    }

    if (fetchFn) {
        data = await fetchFn();
        if (data) {
            await set(key, data, DEFAULT_TTL.guildInfo);
        }
    }

    return data;
}

/**
 * Gets user names in batch with caching
 * 
 * @param {string} guildId - Guild ID
 * @param {string[]} userIds - Array of user IDs
 * @param {Function} fetchFn - Function to fetch missing names
 * @returns {Promise<Object>} Map of userId -> username
 */
async function getUserNames(guildId, userIds, fetchFn) {
    const result = {};
    const missingIds = [];

    // Check cache for each user
    for (const userId of userIds) {
        const key = `user:${guildId}:${userId}:name`;
        const cached = await get(key);

        if (cached) {
            result[userId] = cached;
        } else {
            missingIds.push(userId);
        }
    }

    // Fetch missing ones in batch
    if (missingIds.length > 0 && fetchFn) {
        const fetched = await fetchFn(missingIds);

        for (const [userId, name] of Object.entries(fetched)) {
            result[userId] = name;
            const key = `user:${guildId}:${userId}:name`;
            await set(key, name, DEFAULT_TTL.userNames);
        }
    }

    return result;
}

/**
 * Gets embedding with caching
 * 
 * @param {string} text - Text to embed
 * @param {Function} embedFn - Function to generate embedding
 * @returns {Promise<number[]|null>} Embedding vector
 */
async function getEmbedding(text, embedFn) {
    // Create hash of text for key
    const hash = Buffer.from(text.substring(0, 200)).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
    const key = `embedding:${hash}`;

    let embedding = await get(key);
    if (embedding) {
        logger.debug('[Cache] Embedding from cache');
        return embedding;
    }

    if (embedFn) {
        embedding = await embedFn(text);
        if (embedding) {
            await set(key, embedding, DEFAULT_TTL.embeddings);
        }
    }

    return embedding;
}

/**
 * Caches similar memories search result
 * 
 * @param {string} guildId - Guild ID
 * @param {string} query - Search query
 * @param {Object[]} memories - Search results
 */
async function cacheMemories(guildId, query, memories) {
    const hash = Buffer.from(query.substring(0, 100)).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
    const key = `memories:${guildId}:${hash}`;
    await set(key, memories, DEFAULT_TTL.memories);
}

/**
 * Gets cached memories
 * 
 * @param {string} guildId - Guild ID
 * @param {string} query - Search query
 * @returns {Promise<Object[]|null>} Cached memories or null
 */
async function getCachedMemories(guildId, query) {
    const hash = Buffer.from(query.substring(0, 100)).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
    const key = `memories:${guildId}:${hash}`;
    return await get(key);
}

/**
 * Invalidates guild-related cache
 * 
 * @param {string} guildId - Guild ID
 */
async function invalidateGuildCache(guildId) {
    await delPattern(`guild:${guildId}:*`);
    await delPattern(`memories:${guildId}:*`);
    logger.info(`[Cache] Cache invalidado para guild ${guildId}`);
}

// ============================================
// Cache Statistics
// ============================================

/**
 * Gets cache statistics
 * 
 * @returns {Promise<Object>} Cache stats
 */
async function getStats() {
    try {
        const info = await redis.info('stats');
        const keyspace = await redis.info('keyspace');

        return {
            connected: true,
            info: info,
            keyspace: keyspace
        };
    } catch (error) {
        return {
            connected: false,
            error: error.message
        };
    }
}

// ============================================
// Exports
// ============================================

module.exports = {
    // Core operations
    get,
    set,
    del,
    delPattern,

    // Domain-specific
    getGuildInfo,
    getUserNames,
    getEmbedding,
    cacheMemories,
    getCachedMemories,
    invalidateGuildCache,

    // Stats
    getStats,

    // Config
    DEFAULT_TTL
};
