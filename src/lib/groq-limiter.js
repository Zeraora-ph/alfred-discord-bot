/**
 * Groq Rate-Limit Circuit Breaker
 *
 * Evita desperdício de requisições ao Groq quando a cota (TPD/RPD/RPM) já
 * estourou. Quando o Groq responde 429, abrimos o "breaker" até o horário de
 * reset informado pela própria API e, nesse período, todo o tráfego é roteado
 * automaticamente para o Ollama local — sem ficar batendo no Groq à toa.
 *
 * Também expõe helpers para o roteador decidir se uma mensagem realmente
 * precisa do modelo grande (Groq) ou se o Ollama local dá conta.
 *
 * @module lib/groq-limiter
 */

const logger = require('./logger');

let cooldownUntil = 0;   // timestamp (ms) até quando o Groq fica indisponível
let lastReason = '';     // motivo do último rate limit (para logs/status)

/**
 * Extrai o tempo de espera (ms) de um erro 429 do Groq.
 * A API envia "Please try again in 18m7.776s" no corpo e, às vezes, o
 * header `retry-after` (em segundos).
 *
 * @param {Error} error - erro do axios
 * @returns {number|null} milissegundos a esperar, ou null se não identificado
 */
function parseRetryMs(error) {
    const headers = error?.response?.headers;
    if (headers) {
        // 1) Header retry-after (segundos)
        const retryAfter = headers['retry-after'];
        if (retryAfter !== undefined && !isNaN(parseFloat(retryAfter))) {
            return parseFloat(retryAfter) * 1000;
        }

        // 2) Headers específicos de rate limit do Groq: x-ratelimit-reset-requests / x-ratelimit-reset-tokens
        const resetRequests = headers['x-ratelimit-reset-requests'];
        const resetTokens = headers['x-ratelimit-reset-tokens'];
        
        const parseHeaderTime = (str) => {
            if (!str) return 0;
            let ms = 0;
            const h = str.match(/(\d+)h/); if (h) ms += parseInt(h[1], 10) * 3600000;
            const m = str.match(/(\d+)m/); if (m) ms += parseInt(m[1], 10) * 60000;
            const s = str.match(/([\d.]+)s/); if (s) ms += parseFloat(s[1]) * 1000;
            if (ms === 0 && !isNaN(parseFloat(str))) {
                ms = parseFloat(str) * 1000;
            }
            return ms;
        };

        const timeReq = parseHeaderTime(resetRequests);
        const timeTok = parseHeaderTime(resetTokens);
        const maxHeaderTime = Math.max(timeReq, timeTok);
        if (maxHeaderTime > 0) {
            return maxHeaderTime;
        }
    }

    // 3) Mensagem do corpo: "try again in 18m7.776s" / "in 42.5s" / "in 2h3m"
    const msg = error?.response?.data?.error?.message || error?.message || '';
    const match = msg.match(/try again in\s+((?:\d+h)?(?:\d+m)?[\d.]+s?)/i);
    if (match) {
        const str = match[1];
        let ms = 0;
        const h = str.match(/(\d+)h/); if (h) ms += parseInt(h[1], 10) * 3600000;
        const m = str.match(/(\d+)m/); if (m) ms += parseInt(m[1], 10) * 60000;
        const s = str.match(/([\d.]+)s/); if (s) ms += parseFloat(s[1]) * 1000;
        if (ms > 0) return ms;
    }

    // 4) Se for erro de créditos / saldo / cota, definir 1 hora de cooldown
    const lowerMsg = msg.toLowerCase();
    const isBillingOrCredit = lowerMsg.includes('insufficient_balance')
        || lowerMsg.includes('insufficient balance')
        || lowerMsg.includes('credit')
        || lowerMsg.includes('billing')
        || lowerMsg.includes('quota')
        || lowerMsg.includes('limit exceeded');
    if (isBillingOrCredit) {
        return 60 * 60 * 1000; // 1 hora de cooldown
    }

    return null;
}

/**
 * Indica se o erro é um rate limit ou erro de cota/crédito do Groq.
 * @param {Error} error
 * @returns {boolean}
 */
function isRateLimit(error) {
    const status = error?.response?.status;
    const msg = error?.response?.data?.error?.message || error?.message || '';
    const lowerMsg = msg.toLowerCase();
    const isBillingOrCredit = lowerMsg.includes('insufficient_balance')
        || lowerMsg.includes('insufficient balance')
        || lowerMsg.includes('credit')
        || lowerMsg.includes('billing')
        || lowerMsg.includes('quota')
        || lowerMsg.includes('limit exceeded');

    return status === 429 || isBillingOrCredit;
}

/**
 * Abre o breaker após um 429. Define o cooldown até o reset informado pela API
 * (com piso de 60s para não martelar, e teto de 24h para limites diários).
 *
 * @param {Error} error
 */
function markRateLimited(error) {
    const retryMs = parseRetryMs(error);
    const waitMs = Math.min(Math.max(retryMs || 15 * 60 * 1000, 60 * 1000), 24 * 60 * 60 * 1000);
    cooldownUntil = Date.now() + waitMs;
    lastReason = error?.response?.data?.error?.message || error?.message || 'rate_limit';

    const mins = Math.ceil(waitMs / 60000);
    logger.warn(`[GroqLimiter] Rate limit atingido. Groq pausado por ~${mins}min; roteando tudo para o Ollama local. Motivo: ${lastReason}`);
}

/**
 * true se o Groq está disponível (breaker fechado). Ao expirar o cooldown,
 * reabre automaticamente.
 * @returns {boolean}
 */
function isAvailable() {
    if (Date.now() < cooldownUntil) return false;
    if (cooldownUntil !== 0) {
        logger.info('[GroqLimiter] Cooldown expirou — Groq reativado.');
        cooldownUntil = 0;
        lastReason = '';
    }
    return true;
}

/**
 * Milissegundos restantes de cooldown (0 se disponível).
 * @returns {number}
 */
function cooldownRemainingMs() {
    return Math.max(0, cooldownUntil - Date.now());
}

/**
 * Estado atual do breaker — útil para comandos de status.
 * @returns {{available: boolean, cooldownRemainingMs: number, reason: string}}
 */
function getStatus() {
    return {
        available: isAvailable(),
        cooldownRemainingMs: cooldownRemainingMs(),
        reason: lastReason
    };
}

/**
 * Heurística de roteamento: a mensagem justifica o modelo grande (Groq)?
 * Perguntas complexas (raciocínio, código, comparações, textos longos)
 * ganham qualidade no Groq; o resto vai pro Ollama local e economiza tokens.
 *
 * @param {string} text - última mensagem do usuário
 * @returns {boolean}
 */
function needsGroq(text) {
    if (!text || typeof text !== 'string') return false;

    // Pedidos longos/detalhados tendem a precisar de mais capacidade
    if (text.length > 320) return true;

    const complexIndicators = [
        /por que|porqu[eê]/i,
        /como funciona/i,
        /qual.*diferen[çc]a/i,
        /explique|explicar|explica[ -]?me/i,
        /compar[ae]|compara[çc][ãa]o|melhor que|vs\.?\s/i,
        /analise|analisar|an[áa]lise/i,
        /vantagens.*desvantagens/i,
        /pr[óo]s.*contras/i,
        /c[óo]digo|programa[rç]|função|algoritmo|script|debug|erro no/i,
        /resuma|resumir|resumo (de|do|da)/i,
        /traduz|tradu[çc][ãa]o/i,
        /passo a passo|tutorial|detalhadamente/i
    ];
    return complexIndicators.some(pattern => pattern.test(text));
}

module.exports = {
    parseRetryMs,
    isRateLimit,
    markRateLimited,
    isAvailable,
    cooldownRemainingMs,
    getStatus,
    needsGroq
};
