/**
 * Embedding Service
 * Serviço centralizado de embeddings semânticos com cache Redis e similaridade coseno.
 *
 * Usa Ollama (nomic-embed-text) como principal — leve, roda bem na RTX 5060 Ti sem pressionar a GPU.
 * Fallback automático para embeddings do Groq/OpenAI se Ollama offline.
 *
 * @module services/embedding-service
 */

const crypto = require('crypto');
const axios = require('axios');
const logger = require('../lib/logger');
const redis = require('../lib/redis-client');

// ============================================
// Configuração
// ============================================

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const EMBEDDING_MODEL  = process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text:latest';
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 dias
const MAX_CHUNK_CHARS   = 1800;              // ~512 tokens em português

// Flag para evitar log repetido de Ollama offline
let _ollamaOfflineWarned = false;

// ============================================
// Helpers internos
// ============================================

/**
 * Gera uma chave de cache baseada no hash SHA-256 do texto.
 * @param {string} text
 * @returns {string}
 */
function cacheKey(text) {
    const hash = crypto.createHash('sha256').update(text).digest('hex').slice(0, 32);
    return `embed:${hash}`;
}

/**
 * Divide texto longo em chunks para embedar separadamente.
 * Respeita quebras de parágrafo sempre que possível.
 *
 * @param {string} text
 * @param {number} [maxChars]
 * @returns {string[]}
 */
function chunkText(text, maxChars = MAX_CHUNK_CHARS) {
    if (!text || text.length <= maxChars) return [text];

    const chunks = [];
    const paragraphs = text.split(/\n{2,}/);

    let current = '';
    for (const para of paragraphs) {
        if ((current + para).length > maxChars) {
            if (current) chunks.push(current.trim());
            // Parágrafo muito grande: divide por frases
            if (para.length > maxChars) {
                const sentences = para.match(/[^.!?]+[.!?]+/g) || [para];
                let sentBuf = '';
                for (const s of sentences) {
                    if ((sentBuf + s).length > maxChars) {
                        if (sentBuf) chunks.push(sentBuf.trim());
                        sentBuf = s;
                    } else {
                        sentBuf += ' ' + s;
                    }
                }
                if (sentBuf) current = sentBuf;
            } else {
                current = para;
            }
        } else {
            current += (current ? '\n\n' : '') + para;
        }
    }
    if (current) chunks.push(current.trim());
    return chunks.filter(Boolean);
}

/**
 * Calcula similaridade coseno entre dois vetores.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} valor entre -1 e 1
 */
function cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot   += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}

// ============================================
// Geração de embeddings
// ============================================

/**
 * Gera embedding via Ollama (nomic-embed-text).
 * @param {string} text
 * @returns {Promise<number[]|null>}
 */
async function _embedOllama(text) {
    try {
        const res = await axios.post(`${OLLAMA_BASE_URL}/api/embeddings`, {
            model: EMBEDDING_MODEL,
            prompt: text
        }, { timeout: 10000 });

        const embedding = res.data?.embedding;
        if (!Array.isArray(embedding) || embedding.length === 0) {
            throw new Error('Embedding vazio retornado pelo Ollama');
        }
        return embedding;
    } catch (err) {
        if (!_ollamaOfflineWarned) {
            logger.warn(`[EmbeddingService] Ollama offline ou sem o modelo ${EMBEDDING_MODEL}. Rodando: ollama pull ${EMBEDDING_MODEL}`);
            _ollamaOfflineWarned = true;
        }
        return null;
    }
}

/**
 * Tenta gerar embedding via groq-client (usa OpenAI como fallback).
 * @param {string} text
 * @returns {Promise<number[]|null>}
 */
async function _embedFallback(text) {
    try {
        // Reusa a lógica já existente no groq-client
        const groqClient = require('../lib/groq-client');
        const client = new groqClient();
        return await client.getEmbedding(text);
    } catch {
        return null;
    }
}

// ============================================
// API Pública
// ============================================

/**
 * Gera ou recupera (do cache) o embedding de um texto.
 *
 * Fluxo:
 *  1. Verifica cache Redis
 *  2. Tenta Ollama (nomic-embed-text)
 *  3. Fallback para OpenAI/Groq
 *  4. Salva no cache Redis se gerou
 *
 * @param {string} text
 * @returns {Promise<number[]|null>}
 */
async function embedText(text) {
    if (!text || typeof text !== 'string') return null;

    const cleanText = text.trim().slice(0, 8000); // Limite de segurança
    const key = cacheKey(cleanText);

    // 1. Cache Redis
    try {
        const cached = await redis.get(key);
        if (cached) {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed)) return parsed;
        }
    } catch {
        // Cache não crítico — segue sem
    }

    // 2. Ollama
    let embedding = await _embedOllama(cleanText);

    // 3. Fallback
    if (!embedding) {
        embedding = await _embedFallback(cleanText);
    }

    if (!embedding) return null;

    // 4. Salva no cache
    try {
        await redis.setex(key, CACHE_TTL_SECONDS, JSON.stringify(embedding));
    } catch {
        // Cache não crítico
    }

    return embedding;
}

/**
 * Encontra os N candidatos mais similares semanticamente a uma query.
 *
 * @param {string} query - Texto de busca
 * @param {{ text: string, metadata?: any }[]} candidates - Lista de candidatos
 * @param {number} [topN=5]
 * @param {number} [minScore=0.3] - Score mínimo para incluir resultado
 * @returns {Promise<{ text: string, score: number, metadata?: any }[]>}
 */
async function findMostSimilar(query, candidates, topN = 5, minScore = 0.3) {
    if (!query || !candidates?.length) return [];

    const queryVec = await embedText(query);
    if (!queryVec) {
        // Fallback: busca por substring simples
        const q = query.toLowerCase();
        return candidates
            .filter(c => c.text?.toLowerCase().includes(q))
            .slice(0, topN)
            .map(c => ({ ...c, score: 0.4 }));
    }

    // Gera embeddings dos candidatos em paralelo (com limite de concorrência)
    const CONCURRENCY = 5;
    const results = [];
    for (let i = 0; i < candidates.length; i += CONCURRENCY) {
        const batch = candidates.slice(i, i + CONCURRENCY);
        const embeddings = await Promise.all(batch.map(c => embedText(c.text)));
        for (let j = 0; j < batch.length; j++) {
            const vec = embeddings[j];
            if (!vec) continue;
            const score = cosineSimilarity(queryVec, vec);
            if (score >= minScore) {
                results.push({ ...batch[j], score });
            }
        }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topN);
}

/**
 * Gera embeddings para um texto longo dividindo em chunks.
 * Retorna o vetor médio dos chunks (representação do texto completo).
 *
 * @param {string} text
 * @returns {Promise<number[]|null>}
 */
async function embedLongText(text) {
    const chunks = chunkText(text);
    if (chunks.length === 1) return embedText(chunks[0]);

    const embeddings = (await Promise.all(chunks.map(embedText))).filter(Boolean);
    if (embeddings.length === 0) return null;

    // Média dos vetores
    const dim = embeddings[0].length;
    const avg = new Array(dim).fill(0);
    for (const vec of embeddings) {
        for (let i = 0; i < dim; i++) avg[i] += vec[i];
    }
    for (let i = 0; i < dim; i++) avg[i] /= embeddings.length;
    return avg;
}

// ============================================
// Exports
// ============================================

module.exports = {
    embedText,
    embedLongText,
    findMostSimilar,
    chunkText,
    cosineSimilarity
};
