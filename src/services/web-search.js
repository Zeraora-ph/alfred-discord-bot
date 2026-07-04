/**
 * Web Search Service
 * Provides web search capability for factual questions
 * 
 * @module services/web-search
 */

const axios = require('axios');
const logger = require('../lib/logger');

// ============================================
// Configuration
// ============================================

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_CSE_ID = process.env.GOOGLE_CSE_ID;

// Fallback: DuckDuckGo Instant Answer API (no key needed)
const DDGO_API = 'https://api.duckduckgo.com';

// ============================================
// Query Detection
// ============================================

/**
 * Detects if a question likely needs web search
 * 
 * @param {string} text - User's question
 * @returns {boolean} True if web search would help
 */
function needsWebSearch(text) {
    const lower = text.toLowerCase();

    // Date/time/event questions
    const datePatterns = [
        /quando (é|será|foi|começa|termina)/i,
        /que (dia|hora|data)/i,
        /que horas (é|são|começa)/i,
        /(próximo|última|próxima|ultimo) (jogo|partida|evento)/i
    ];

    // Current events/news
    const currentEventPatterns = [
        /quem ganhou/i,
        /resultado (do|da|de)/i,
        /placar (do|da)/i,
        /classificação (do|da)/i,
        /tabela (do|da)/i,
        /notícia|noticia|news/i,
        /aconteceu|acontecendo/i
    ];

    // Factual lookups
    const factualPatterns = [
        /quanto (custa|vale|é)/i,
        /qual (é )?o (preço|valor|resultado|placar)/i,
        /como (está|estão) (o|a|as|os)/i,
        /previsão (do|de)/i,
        /cotação/i,
        /dólar|euro|bitcoin/i
    ];

    // Tutorials/how-to
    const tutorialPatterns = [
        /como (fazer|criar|aprender|configurar|instalar)/i,
        /tutorial (de|para)/i,
        /melhores (maneiras|formas|jeitos)/i,
        /passo a passo/i
    ];

    const allPatterns = [
        ...datePatterns,
        ...currentEventPatterns,
        ...factualPatterns,
        ...tutorialPatterns
    ];

    return allPatterns.some(p => p.test(lower));
}

/**
 * Extracts search terms from a natural language question
 * 
 * @param {string} text - User's question
 * @returns {string} Optimized search query
 */
function extractSearchQuery(text) {
    let query = text
        // Remove bot name
        .replace(/^alfred[\s,:]*/i, '')
        // Remove question starters
        .replace(/^(me (diz|fala|conta)|poderia me (informar|dizer)|você sabe)\s*/i, '')
        .replace(/^(qual é|quais são|quando|onde|como|por que|o que)\s*/i, '')
        // Remove polite endings
        .replace(/\?+$/, '')
        .replace(/por favor/gi, '')
        .trim();

    return query;
}

// ============================================
// Search Providers
// ============================================

/**
 * Search using Google Custom Search API
 * 
 * @param {string} query - Search query
 * @param {number} limit - Max results
 * @returns {Promise<Object[]>} Search results
 */
async function searchGoogle(query, limit = 3) {
    if (!GOOGLE_API_KEY || !GOOGLE_CSE_ID) {
        return null;
    }

    try {
        const response = await axios.get('https://www.googleapis.com/customsearch/v1', {
            params: {
                key: GOOGLE_API_KEY,
                cx: GOOGLE_CSE_ID,
                q: query,
                num: limit,
                hl: 'pt-BR'
            },
            timeout: 5000
        });

        if (response.data?.items?.length > 0) {
            return response.data.items.map(item => ({
                title: item.title,
                link: item.link,
                snippet: item.snippet
            }));
        }
    } catch (error) {
        logger.debug('[WebSearch] Google search failed:', error.message);
    }

    return null;
}

/**
 * Search using DuckDuckGo Instant Answer (fallback, no key)
 * 
 * @param {string} query - Search query
 * @returns {Promise<Object|null>} Instant answer or null
 */
async function searchDuckDuckGo(query) {
    try {
        const response = await axios.get(DDGO_API, {
            params: {
                q: query,
                format: 'json',
                no_html: 1,
                skip_disambig: 1
            },
            timeout: 4000
        });

        const data = response.data;

        // Check for instant answer
        if (data.AbstractText) {
            return {
                type: 'instant',
                answer: data.AbstractText,
                source: data.AbstractSource,
                url: data.AbstractURL
            };
        }

        // Check for related topics
        if (data.RelatedTopics?.length > 0) {
            const topics = data.RelatedTopics
                .filter(t => t.Text)
                .slice(0, 3)
                .map(t => t.Text);

            if (topics.length > 0) {
                return {
                    type: 'related',
                    topics
                };
            }
        }

    } catch (error) {
        logger.debug('[WebSearch] DuckDuckGo failed:', error.message);
    }

    return null;
}

/**
 * Main search function - tries multiple providers
 * 
 * @param {string} query - Search query
 * @returns {Promise<Object|null>} Search results
 */
async function search(query) {
    // Try Google first
    const googleResults = await searchGoogle(query);
    if (googleResults) {
        return {
            provider: 'google',
            results: googleResults
        };
    }

    // Fallback to DuckDuckGo
    const ddgResults = await searchDuckDuckGo(query);
    if (ddgResults) {
        return {
            provider: 'duckduckgo',
            ...ddgResults
        };
    }

    return null;
}

/**
 * Formats search results for AI context
 * 
 * @param {Object} searchData - Search results
 * @returns {string} Formatted context
 */
function formatForContext(searchData) {
    if (!searchData) return null;

    if (searchData.provider === 'google') {
        const results = searchData.results
            .map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet}`)
            .join('\n\n');
        return `Resultados da web:\n${results}`;
    }

    if (searchData.type === 'instant') {
        return `Resposta encontrada (${searchData.source}):\n${searchData.answer}`;
    }

    if (searchData.type === 'related') {
        return `Informações relacionadas:\n${searchData.topics.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;
    }

    return null;
}

// ============================================
// Exports
// ============================================

module.exports = {
    needsWebSearch,
    extractSearchQuery,
    search,
    searchGoogle,
    searchDuckDuckGo,
    formatForContext
};
