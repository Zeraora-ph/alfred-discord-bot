/**
 * Memory Manager
 * Sistema de memória em camadas para o Alfred.
 *
 * Camadas:
 *  - short_term : Redis List — mensagens recentes da sessão (TTL 24h)
 *  - long_term  : SQLite (fact-store) — fatos extraídos e embedados (persistente)
 *  - episodic   : Redis List — eventos marcantes por usuário (TTL 30 dias)
 *
 * Integra com o fact-store.js existente para não quebrar o fluxo atual.
 * Complementa (não substitui) o memory-handler.js.
 *
 * @module services/memory-manager
 */

const logger = require('../lib/logger');
const redis  = require('../lib/redis-client');
const { embedText, findMostSimilar } = require('./embedding-service');

// ============================================
// Configuração
// ============================================

const SHORT_TERM_TTL     = 24 * 60 * 60;      // 24 horas
const EPISODIC_TTL       = 30 * 24 * 60 * 60; // 30 dias
const SHORT_TERM_MAX     = 50;                 // Máximo de mensagens no short_term
const COMPRESS_THRESHOLD = 40;                 // Comprime quando passar de 40 msgs
const SHORT_TERM_KEEP    = 20;                 // Mantém as últimas 20 após comprimir

// ============================================
// Chaves Redis
// ============================================

const keys = {
    shortTerm: (userId, guildId) => `mem:short:${guildId}:${userId}`,
    episodic:  (userId)          => `mem:episode:${userId}`,
    lastActive:(userId, guildId) => `mem:active:${guildId}:${userId}`
};

// ============================================
// Short-Term Memory (Redis)
// ============================================

/**
 * Salva uma mensagem no short-term memory.
 *
 * @param {string} userId
 * @param {string} guildId
 * @param {'user'|'assistant'} role
 * @param {string} content
 * @returns {Promise<void>}
 */
async function storeMessage(userId, guildId, role, content) {
    const key = keys.shortTerm(userId, guildId);
    try {
        const entry = JSON.stringify({ role, content, ts: Date.now() });
        const stored = await redis.get(key);
        const list = stored ? JSON.parse(stored) : [];

        list.push(JSON.parse(entry));

        // Remove as mais antigas se passou do limite
        while (list.length > SHORT_TERM_MAX) list.shift();

        await redis.setex(key, SHORT_TERM_TTL, JSON.stringify(list));

        // Atualiza timestamp de última atividade
        await redis.setex(keys.lastActive(userId, guildId), SHORT_TERM_TTL, Date.now().toString());
    } catch (err) {
        logger.error(`[MemoryManager] Erro ao salvar short-term para ${userId}:`, err.message);
    }
}

/**
 * Recupera as últimas mensagens do short-term.
 *
 * @param {string} userId
 * @param {string} guildId
 * @param {number} [limit=20]
 * @returns {Promise<{role: string, content: string, ts: number}[]>}
 */
async function getShortTerm(userId, guildId, limit = 20) {
    const key = keys.shortTerm(userId, guildId);
    try {
        const stored = await redis.get(key);
        if (!stored) return [];
        const list = JSON.parse(stored);
        return list.slice(-limit);
    } catch {
        return [];
    }
}

// ============================================
// Long-Term Memory (SQLite via fact-store)
// ============================================

/**
 * Busca contexto relevante no long-term (fatos) usando similaridade semântica.
 * Usa o fact-store existente para manter compatibilidade.
 *
 * @param {string} userId
 * @param {string} guildId
 * @param {string} currentMessage
 * @param {number} [topN=4]
 * @returns {Promise<string>} - Contexto formatado pronto para injetar no prompt
 */
async function retrieveRelevantContext(userId, guildId, currentMessage, topN = 4) {
    try {
        const factStore = require('../lib/fact-store');
        const embedding = await embedText(currentMessage);

        if (embedding) {
            const memories = factStore.getTopSimilarMemories(guildId, userId, embedding, topN);
            if (memories?.length > 0) {
                return memories
                    .map((m, i) => `Fato ${i + 1}: ${m.message}`)
                    .join('\n');
            }
        }

        // Fallback: busca por palavra-chave
        const kwResults = factStore.searchMemoriesByKeywords(guildId, userId, currentMessage, topN);
        if (kwResults?.length > 0) {
            return kwResults.map((m, i) => `Fato ${i + 1}: ${m.message}`).join('\n');
        }

        return '';
    } catch (err) {
        logger.error('[MemoryManager] Erro ao recuperar contexto long-term:', err.message);
        return '';
    }
}

/**
 * Extrai fatos de uma conversa e salva no long-term via LLM.
 * Chamado automaticamente após conversas longas.
 *
 * @param {string} userId
 * @param {string} guildId
 * @param {string} username
 * @param {{ role: string, content: string }[]} messages
 * @returns {Promise<void>}
 */
async function extractAndStoreFacts(userId, guildId, username, messages) {
    if (!messages?.length) return;

    try {
        const aiClient = require('../lib/ai-client');
        const factStore = require('../lib/fact-store');

        const conversationText = messages
            .map(m => `${m.role === 'user' ? username : 'Alfred'}: ${m.content}`)
            .join('\n');

        const extractionMessages = [
            {
                role: 'system',
                content: `Você é um extrator de fatos. A partir da conversa abaixo, extraia fatos importantes sobre o usuário ${username}.
Retorne APENAS uma lista com um fato por linha, começando com "-".
Se não houver fatos relevantes, retorne "NENHUM".
Fatos relevantes: preferências, dados pessoais mencionados, gostos, opiniões fortes, planos.
NÃO inclua fatos triviais ou temporários.`
            },
            { role: 'user', content: conversationText }
        ];

        const response = await aiClient.chat(extractionMessages, { maxTokens: 500 });
        const factsText = response.choices?.[0]?.message?.content || '';

        if (factsText.includes('NENHUM')) return;

        const facts = factsText
            .split('\n')
            .filter(line => line.trim().startsWith('-'))
            .map(line => line.replace(/^-\s*/, '').trim())
            .filter(f => f.length > 10);

        for (const fact of facts) {
            const normalized = `${username}: ${fact}`;
            const embedding = await embedText(normalized);

            // Verifica duplicata (>90% similaridade)
            if (embedding) {
                const similar = factStore.getTopSimilarMemories(guildId, userId, embedding, 1);
                if (similar?.[0]?.score > 0.90) {
                    logger.debug(`[MemoryManager] Fato duplicado ignorado: "${normalized}"`);
                    continue;
                }
            }

            factStore.saveMemory(guildId, userId, normalized, embedding);
            logger.info(`[MemoryManager] Fato extraído e salvo: "${normalized}"`);
        }
    } catch (err) {
        logger.warn('[MemoryManager] Erro ao extrair fatos:', err.message);
    }
}

// ============================================
// Compressão: short-term → long-term
// ============================================

/**
 * Se o short-term estiver cheio, comprime as mensagens antigas para o long-term.
 *
 * @param {string} userId
 * @param {string} guildId
 * @param {string} username
 * @returns {Promise<boolean>} True se comprimiu
 */
async function compressIfNeeded(userId, guildId, username) {
    const key = keys.shortTerm(userId, guildId);
    try {
        const stored = await redis.get(key);
        if (!stored) return false;

        const list = JSON.parse(stored);
        if (list.length < COMPRESS_THRESHOLD) return false;

        // Mensagens a comprimir: tudo exceto as últimas SHORT_TERM_KEEP
        const toCompress = list.slice(0, list.length - SHORT_TERM_KEEP);
        const toKeep     = list.slice(-SHORT_TERM_KEEP);

        logger.info(`[MemoryManager] Comprimindo ${toCompress.length} msgs do short-term de ${username}`);

        // Extrai fatos das mensagens mais antigas
        await extractAndStoreFacts(userId, guildId, username, toCompress);

        // Atualiza Redis com apenas as recentes
        await redis.setex(key, SHORT_TERM_TTL, JSON.stringify(toKeep));
        return true;
    } catch (err) {
        logger.error('[MemoryManager] Erro ao comprimir memória:', err.message);
        return false;
    }
}

// ============================================
// Episodic Memory (Redis — eventos marcantes)
// ============================================

/**
 * Salva um evento marcante para o usuário.
 *
 * @param {string} userId
 * @param {string} description
 * @returns {Promise<void>}
 */
async function storeEpisode(userId, description) {
    const key = keys.episodic(userId);
    try {
        const stored = await redis.get(key);
        const list = stored ? JSON.parse(stored) : [];
        list.push({ description, ts: Date.now() });
        // Mantém os últimos 30 episódios
        while (list.length > 30) list.shift();
        await redis.setex(key, EPISODIC_TTL, JSON.stringify(list));
    } catch (err) {
        logger.warn('[MemoryManager] Erro ao salvar episódio:', err.message);
    }
}

/**
 * Recupera episódios marcantes do usuário.
 *
 * @param {string} userId
 * @param {number} [limit=5]
 * @returns {Promise<{description: string, ts: number}[]>}
 */
async function getEpisodes(userId, limit = 5) {
    const key = keys.episodic(userId);
    try {
        const stored = await redis.get(key);
        if (!stored) return [];
        const list = JSON.parse(stored);
        return list.slice(-limit);
    } catch {
        return [];
    }
}

// ============================================
// Contexto Completo para Prompt
// ============================================

/**
 * Monta o contexto completo de memória de um usuário para injetar no prompt do Alfred.
 *
 * Retorna um objeto com:
 *  - shortTerm: últimas mensagens formatadas para o histórico de conversa
 *  - longTermContext: string de fatos relevantes
 *  - episodicContext: string de eventos marcantes
 *
 * @param {string} userId
 * @param {string} guildId
 * @param {string} currentMessage
 * @param {string} username
 * @returns {Promise<{shortTerm: object[], longTermContext: string, episodicContext: string}>}
 */
async function getUserContext(userId, guildId, currentMessage, username) {
    const [shortTerm, longTermContext, episodes] = await Promise.all([
        getShortTerm(userId, guildId, 20),
        retrieveRelevantContext(userId, guildId, currentMessage, 4),
        getEpisodes(userId, 3)
    ]);

    const episodicContext = episodes.length > 0
        ? episodes.map(e => `- ${e.description}`).join('\n')
        : '';

    return { shortTerm, longTermContext, episodicContext };
}

// ============================================
// Exports
// ============================================

module.exports = {
    // Short-term
    storeMessage,
    getShortTerm,

    // Long-term
    retrieveRelevantContext,
    extractAndStoreFacts,
    compressIfNeeded,

    // Episódico
    storeEpisode,
    getEpisodes,

    // Contexto completo
    getUserContext
};
