/**
 * OpenRouter Client
 *
 * Segundo provedor de nuvem (gratuito) para o Alfred, usado como fallback do Groq.
 * API compatível com OpenAI — mesmo shape de resposta do Groq: { choices: [...] }.
 *
 * Destaques:
 *  - Limite por REQUISIÇÃO (não por token como o Groq) → prompts grandes não penalizam.
 *  - Parâmetro `models: [...]` rotaciona modelos free automaticamente quando o
 *    provedor de cima está congestionado (429 "rate-limited upstream").
 *  - Circuit breaker próprio: se bater no teto diário (429 longo), pausa e deixa
 *    o roteador cair pro Ollama local sem ficar martelando.
 *
 * @module lib/openrouter-client
 */

const axios = require('axios');
const logger = require('./logger');
const groqLimiter = require('./groq-limiter'); // reaproveita parseRetryMs

const API_URL = process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1/chat/completions';

// Ordem de preferência dos modelos free (o 1º disponível é usado; os demais são
// tentados automaticamente pelo OpenRouter se o de cima estiver congestionado).
// Todos suportam tool/function calling e vão bem em PT-BR. Configurável via env.
// ⚠️ O OpenRouter aceita no máximo 3 itens no array `models`.
const MAX_MODELS = 3;
const DEFAULT_MODELS = [
    'meta-llama/llama-3.3-70b-instruct:free',
    'google/gemini-2.5-flash:free',
    'nvidia/nemotron-4-340b-instruct:free'
].join(',');

let cooldownUntil = 0; // pausa após teto diário (429 longo)

/** Lista de modelos configurada (env OPENROUTER_MODELS, csv) ou o default.
 *  Capada em MAX_MODELS — o OpenRouter recusa arrays com mais de 3 itens. */
function getModels() {
    return (process.env.OPENROUTER_MODELS || DEFAULT_MODELS)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .slice(0, MAX_MODELS);
}

/** Há key configurada? */
function hasKey() {
    return !!process.env.OPENROUTER_API_KEY;
}

/** Disponível = tem key E não está em cooldown por teto diário. */
function isAvailable() {
    if (!hasKey()) return false;
    if (Date.now() < cooldownUntil) return false;
    if (cooldownUntil !== 0) {
        logger.info('[OpenRouter] Cooldown expirou — reativado.');
        cooldownUntil = 0;
    }
    return true;
}

/** Abre o breaker do OpenRouter (teto diário atingido). */
function markRateLimited(error) {
    const retryMs = groqLimiter.parseRetryMs(error);
    // Só pausa de verdade se o retry for longo (teto diário). 429 curto = congestão
    // transitória do pool free, que a rotação de models[] já resolve.
    const waitMs = Math.min(Math.max(retryMs || 0, 0), 24 * 60 * 60 * 1000);
    if (waitMs >= 60 * 1000) {
        cooldownUntil = Date.now() + waitMs;
        logger.warn(`[OpenRouter] Teto diário atingido — pausado por ~${Math.ceil(waitMs / 60000)}min. Roteando para Ollama local.`);
    }
}

/** true se o erro é um 429. */
function isRateLimit(error) {
    return error?.response?.status === 429;
}

/**
 * Requisição base ao OpenRouter (OpenAI-compatible).
 * Aceita `options.tools` para function calling.
 *
 * @param {Object[]} messages
 * @param {Object} options - { maxTokens, temperature, tools, toolChoice, timeout }
 * @returns {Promise<Object>} resposta bruta { choices, model, ... }
 */
async function complete(messages, options = {}) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY não configurada');

    const models = getModels();
    const payload = {
        model: models[0],
        models,                                  // rotação automática entre free
        messages,
        max_tokens:  options.maxTokens  || 2000,
        temperature: options.temperature ?? 0.8,
        ...(options.tools ? { tools: options.tools, tool_choice: options.toolChoice || 'auto' } : {})
    };

    try {
        const res = await axios.post(API_URL, payload, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                // Identificação recomendada pelo OpenRouter (aparece nos rankings)
                'HTTP-Referer': process.env.OPENROUTER_REFERER || 'https://github.com/alfred-bot',
                'X-Title': 'Alfred'
            },
            timeout: options.timeout || 30000
        });
        return res.data;
    } catch (error) {
        if (isRateLimit(error)) markRateLimited(error);
        logger.warn(`[OpenRouter] Erro na requisição: ${error.response?.status || ''} ${error.message}`);
        throw error;
    }
}

/**
 * Chat sem tools. Retorna o mesmo shape do Groq: { choices: [{ message: { content } }] }.
 * @param {Object[]} messages
 * @param {Object} options
 */
async function chat(messages, options = {}) {
    return await complete(messages, options);
}

module.exports = {
    hasKey,
    isAvailable,
    isRateLimit,
    markRateLimited,
    getModels,
    complete,
    chat
};
