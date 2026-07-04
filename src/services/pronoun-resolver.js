/**
 * Pronoun Resolution Service
 * Handles first-person pronoun normalization in memories
 * Converts "EU gosto de carros" -> "Zedaobra gosta de carros"
 * 
 * @module services/pronoun-resolver
 */

const logger = require('../lib/logger');

// ============================================
// Pronoun Mappings (Portuguese)
// ============================================

const PRONOUN_MAPPINGS = {
    // Subject pronouns
    'eu': (name) => name,
    'eu sou': (name) => `${name} é`,
    'eu tenho': (name) => `${name} tem`,
    'eu gosto': (name) => `${name} gosta`,
    'eu amo': (name) => `${name} ama`,
    'eu odeio': (name) => `${name} odeia`,
    'eu prefiro': (name) => `${name} prefere`,
    'eu quero': (name) => `${name} quer`,
    'eu preciso': (name) => `${name} precisa`,
    'eu moro': (name) => `${name} mora`,
    'eu trabalho': (name) => `${name} trabalha`,
    'eu estudo': (name) => `${name} estuda`,
    'eu jogo': (name) => `${name} joga`,
    'eu uso': (name) => `${name} usa`,
    'eu fiz': (name) => `${name} fez`,
    'eu faço': (name) => `${name} faz`,
    'eu sei': (name) => `${name} sabe`,
    'eu conheço': (name) => `${name} conhece`,

    // Possessive pronouns
    'meu': (name) => `de ${name}`,
    'minha': (name) => `de ${name}`,
    'meus': (name) => `de ${name}`,
    'minhas': (name) => `de ${name}`
};

// Regex patterns for detection
const FIRST_PERSON_PATTERNS = [
    /\b(eu\s+\w+)/gi,           // "eu sou", "eu gosto"
    /\b(meu|minha|meus|minhas)\b/gi,  // possessives
    /\bme\s+/gi,                // "me chamo", "me considero"
    /\bpra mim\b/gi,            // "pra mim"
    /\bde mim\b/gi              // "de mim"
];

// ============================================
// Resolution Functions
// ============================================

/**
 * Detects if text contains first-person pronouns
 * 
 * @param {string} text - Text to check
 * @returns {boolean} True if contains first-person reference
 */
function hasFirstPersonPronouns(text) {
    return FIRST_PERSON_PATTERNS.some(p => p.test(text));
}

/**
 * Normalizes first-person pronouns to third-person with username
 * 
 * @param {string} text - Original text
 * @param {string} username - User's display name
 * @returns {string} Normalized text
 */
function normalizePronouns(text, username) {
    let normalized = text;

    // Sort by length (longer phrases first) to avoid partial replacements
    const sortedMappings = Object.entries(PRONOUN_MAPPINGS)
        .sort((a, b) => b[0].length - a[0].length);

    for (const [pattern, replacement] of sortedMappings) {
        const regex = new RegExp(`\\b${pattern}\\b`, 'gi');
        normalized = normalized.replace(regex, replacement(username));
    }

    // Handle remaining "me" cases
    normalized = normalized.replace(/\bme chamo\b/gi, `${username} se chama`);
    normalized = normalized.replace(/\bme considero\b/gi, `${username} se considera`);

    // Handle "pra mim" and "de mim"
    normalized = normalized.replace(/\bpra mim\b/gi, `para ${username}`);
    normalized = normalized.replace(/\bde mim\b/gi, `de ${username}`);

    return normalized;
}

/**
 * Converts a memory text for storage (normalizes pronouns)
 * 
 * @param {string} text - Original memory text
 * @param {string} username - User's display name  
 * @param {string} userId - User's Discord ID
 * @returns {Object} { normalized, original, userId, username }
 */
function prepareForStorage(text, username, userId) {
    const hasPronouns = hasFirstPersonPronouns(text);
    const normalized = hasPronouns ? normalizePronouns(text, username) : text;

    logger.debug(`[Pronoun] "${text}" -> "${normalized}"`);

    return {
        normalized,
        original: text,
        userId,
        username,
        hadPronouns: hasPronouns
    };
}

/**
 * Converts a query to search for user-specific memories
 * Handles "meu carro favorito" -> "carro favorito de [username]"
 * 
 * @param {string} query - Search query
 * @param {string} username - User's display name
 * @returns {string} Normalized query
 */
function normalizeQuery(query, username) {
    let normalized = query;

    // "meu/minha" -> "de [username]"
    normalized = normalized.replace(/\b(meu|minha|meus|minhas)\b/gi, `de ${username}`);

    // "eu" queries
    normalized = normalized.replace(/\beu\s+(sou|tenho|gosto|moro|trabalho)/gi, `${username} $1`);

    // "o que eu disse" type queries
    normalized = normalized.replace(/\bque eu (disse|falei|contei)\b/gi, `que ${username} $1`);

    return normalized;
}

/**
 * Contextualizes a memory response with user reference
 * 
 * @param {Object} memory - Memory object with userId
 * @param {string} requestingUserId - ID of user asking
 * @param {Object} client - Discord client (to get usernames)
 * @returns {string} Contextualized memory text
 */
function contextualizeMemory(memory, requestingUserId, client = null) {
    // If it's the same user, can convert back to first person
    if (memory.userId === requestingUserId) {
        return memory.message;
    }

    // Otherwise, keep third person (already normalized)
    return memory.message;
}

// ============================================
// Exports
// ============================================

module.exports = {
    hasFirstPersonPronouns,
    normalizePronouns,
    prepareForStorage,
    normalizeQuery,
    contextualizeMemory,
    PRONOUN_MAPPINGS
};
