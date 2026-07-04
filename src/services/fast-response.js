/**
 * Fast Response Service
 * Handles simple messages quickly without AI calls
 * 
 * @module services/fast-response
 */

const logger = require('../lib/logger');

// ============================================
// Simple Greeting Patterns
// ============================================

const GREETINGS = {
    // Input patterns -> possible responses
    patterns: [
        {
            match: /^(oi|olá|ola|eae|eai|e aí|e ai|fala|salve|hey|hi|hello)\s*(alfred)?[!.,]?$/i,
            responses: [
                "E aí! Tudo certo?",
                "Oi! Precisando de algo?",
                "Fala! Em que posso ajudar?",
                "Opa! Tô aqui.",
                "Salve! Manda ver."
            ]
        },
        {
            match: /^(tudo bem|tudo certo|td bem|td bom|blz|beleza|suave|tranquilo)\s*(alfred)?[?!.,]?$/i,
            responses: [
                "Tudo ótimo! E você?",
                "Tranquilo demais! Precisando de algo?",
                "Na paz! E aí?",
                "Suave! Manda aí."
            ]
        },
        {
            match: /^(obrigad[oa]|valeu|thanks|tmj|brigadão|vlw)\s*(alfred)?[!.,]?$/i,
            responses: [
                "De nada!",
                "Tmj!",
                "Nada demais!",
                "Qualquer coisa, chama!"
            ]
        },
        {
            match: /^(tchau|até|ate|flw|bye|fui)\s*(alfred)?[!.,]?$/i,
            responses: [
                "Falou!",
                "Até mais!",
                "Flw!",
                "Vlw, até!"
            ]
        },
        {
            match: /^(bom dia|boa tarde|boa noite)\s*(alfred)?[!.,]?$/i,
            responses: (text) => {
                if (/bom dia/i.test(text)) return ["Bom dia!", "Dia!", "Bom dia! Precisando de algo?"];
                if (/boa tarde/i.test(text)) return ["Boa tarde!", "Tarde!", "Boa tarde! Em que posso ajudar?"];
                return ["Boa noite!", "Noite!", "Boa noite! Tô aqui se precisar."];
            }
        },
        {
            match: /^o+i+\s*(alfred)?$/i, // "oiii", "ooooi"
            responses: ["Oii!", "Oi oi!", "Eae!"]
        }
    ]
};

// ============================================
// Fast Detection Functions
// ============================================

/**
 * Checks if a message is a simple greeting that doesn't need AI
 * 
 * @param {string} content - Message content
 * @returns {string|null} Fast response or null if needs AI
 */
function getFastResponse(content) {
    const text = content.trim().toLowerCase();

    // Skip if too long (probably not a simple greeting)
    if (text.length > 50) return null;

    for (const pattern of GREETINGS.patterns) {
        if (pattern.match.test(text)) {
            let responses = pattern.responses;

            // Handle function-based responses
            if (typeof responses === 'function') {
                responses = responses(text);
            }

            // Return random response
            return responses[Math.floor(Math.random() * responses.length)];
        }
    }

    return null;
}

/**
 * Checks if message is too simple to need embedding
 * 
 * @param {string} content - Message content
 * @returns {boolean} True if should skip embedding
 */
function shouldSkipEmbedding(content) {
    const text = content.trim().toLowerCase();

    // Skip embedding for:
    // 1. Very short messages (< 10 chars)
    if (text.length < 10) return true;

    // 2. Simple greetings
    if (getFastResponse(content)) return true;

    // 3. Just the bot name
    if (/^alfred[!.,?]*$/i.test(text)) return true;

    // 4. Just laughter
    if (/^(haha+|kk+|rsrs+|kkk+|lol+)[!.]*$/i.test(text)) return true;

    // 5. Single emoji or emote
    if (/^:[a-z_]+:|^[\p{Emoji}]+$/iu.test(text)) return true;

    return false;
}

/**
 * Checks if message likely needs memory search
 * 
 * @param {string} content - Message content
 * @returns {boolean} True if should search memories
 */
function shouldSearchMemories(content) {
    const text = content.toLowerCase();

    // Keywords that suggest memory lookup
    const memoryKeywords = [
        'lembra', 'lembre', 'você sabe', 'vc sabe',
        'o que eu disse', 'o que falei', 'anotou',
        'salvou', 'guardou', 'meu', 'minha',
        'do servidor', 'da guild', 'aqui no'
    ];

    // Questions about facts
    const factPatterns = [
        /qual (é|era) (o|a|meu|minha)/i,
        /quem (é|era|são)/i,
        /quando (é|foi|será)/i,
        /onde (fica|é|mora)/i
    ];

    // Check keywords
    if (memoryKeywords.some(kw => text.includes(kw))) return true;

    // Check patterns
    if (factPatterns.some(p => p.test(text))) return true;

    // Questions longer than 20 chars probably warrant memory check
    if (text.endsWith('?') && text.length > 20) return true;

    return false;
}

/**
 * Detects if this is a music-related message
 * More efficient than full regex check
 * 
 * @param {string} content - Message content
 * @returns {boolean} True if likely music command
 */
function isMusicRelated(content) {
    const text = content.toLowerCase();

    // Quick keyword check before regex
    const musicKeywords = ['toque', 'toca', 'play', 'pula', 'skip', 'pausa',
        'pause', 'para', 'stop', 'fila', 'música', 'musica'];

    return text.startsWith('alfred') && musicKeywords.some(kw => text.includes(kw));
}

// ============================================
// Simple Message Classification
// ============================================

/**
 * Quickly classifies message type without AI
 * 
 * @param {string} content - Message content
 * @returns {string} Message type: 'greeting', 'question', 'command', 'statement', 'spam'
 */
function classifyMessageType(content) {
    const text = content.trim().toLowerCase();

    // Greeting
    if (getFastResponse(content)) return 'greeting';

    // Spam/noise
    if (text.length < 3) return 'spam';
    if (/^(kk+|rs+|haha+)$/i.test(text)) return 'spam';
    if (/^[.,!?;:]+$/.test(text)) return 'spam';

    // Question (has ? or question words)
    if (text.endsWith('?')) return 'question';
    if (/\b(qual|quem|quando|onde|como|por que|o que)\b/i.test(text)) return 'question';

    // Command (action words)
    const commands = ['toque', 'pesquise', 'traduza', 'resuma', 'crie', 'faça', 'calcule'];
    if (commands.some(c => text.includes(c))) return 'command';

    return 'statement';
}

// ============================================
// Open Question Detection (Proactive Response)
// ============================================

/**
 * Detects if bot should respond to a message even without being mentioned
 * This enables proactive responses to open questions
 * 
 * @param {string} content - Message content
 * @param {boolean} [isReplyToBot=false] - If message is a reply to bot
 * @returns {boolean} True if bot should respond
 */
function shouldRespond(content, isReplyToBot = false) {
    const text = content.toLowerCase().trim();
    const originalText = content.trim();

    // Always respond to replies to the bot
    if (isReplyToBot) return true;

    // Skip very short messages
    if (text.length < 10) return false;

    // Skip spam patterns
    if (/^(kk+|rs+|haha+|lol+)$/i.test(text)) return false;

    // ============================================
    // FILTERS: When NOT to respond
    // ============================================

    // 1. Skip if message starts with a proper name (capitalized word that's not a question word)
    //    "João sabe..." "Maria, você pode..." "Pedro me ajuda"
    const startsWithProperName = /^[A-ZÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇ][a-záàâãéèêíìîóòôõúùûç]+[\s,:]/.test(originalText);
    const questionWordStart = /^(qual|quem|quando|onde|como|por que|porque|o que|quanto|algu[eé]m)/i.test(text);

    if (startsWithProperName && !questionWordStart) {
        return false;
    }

    // 2. Skip if contains @mention to another user (not the bot)
    if (/<@!?\d+>/.test(content)) {
        return false;
    }

    // 3. Skip if directly addressing someone by name pattern
    //    "ei João", "ô Pedro", "fala aí Maria"
    const directAddressPatterns = [
        /^(ei|ô|oi|fala|e aí|eai)\s+[A-Z][a-z]+/i,
        /^[A-Z][a-z]+\s*[,:]/, // "João," or "Maria:"
        /[A-Z][a-z]+\s+(você|vc|tu)\s+(sabe|pode|consegue)/i // "Pedro você sabe..."
    ];

    if (directAddressPatterns.some(p => p.test(originalText))) {
        return false;
    }

    // 4. Skip if asking about a specific person
    //    "o João sabe disso?", "alguém viu o Pedro?"
    const askingAboutPerson = /\b(o|a|do|da|ao|à)\s+[A-Z][a-záàâãéèêíìîóòôõúùûç]+\s+(sabe|fez|disse|falou|viu)/i;
    if (askingAboutPerson.test(originalText)) {
        return false;
    }

    // 5. Skip if it's a conversation fragment (common chat patterns)
    // Note: Use \b word boundary to avoid blocking "quem" with "que" pattern
    const conversationPatterns = [
        /^(sim|não|n[aã]o|ss|sss|é|eh|isso|exato|verdade|concordo|discordo)\b/i,
        /^(blz|ok|okay|certo|entendi|hmm|uhum|ahh)\b/i,
        /^(que\s|mas\b|porque\b|pq\b|então\b|entao\b|tipo\b|sei\b)/i  // "que " with space to not match "quem"
    ];

    if (conversationPatterns.some(p => p.test(text)) && text.length < 30) {
        return false;
    }

    // ============================================
    // PATTERNS: When to respond
    // ============================================

    // === OPEN QUESTION PATTERNS ===
    // "alguem sabe...", "alguém pode me dizer...", "alguem me ajuda..."
    const openQuestionPatterns = [
        /^algu[eé]m\s+(sabe|pode|consegue|ajuda)/i,
        /^(galera|pessoal|gente|guys)\s*[,:]?\s*.*(sabe|ajud|pode)/i,
        /^quem\s+(sabe|pode|consegue)/i,
        /^(tem algu[eé]m|anyone)/i,
        /^(por favor|pfv|pf)\s+.*(ajud|explic|me dig)/i
    ];

    if (openQuestionPatterns.some(p => p.test(text))) {
        return true;
    }

    // === DIRECT QUESTION INDICATORS ===
    // Questions ending with ? that seem addressed to everyone
    if (text.endsWith('?')) {
        // With question words at start
        const questionWords = /^(qual|quem|quando|onde|como|por que|porque|o que|quanto|quantos|quantas|que dia|que horas)/i;
        if (questionWords.test(text)) {
            return true;
        }
    }

    // === HELP REQUEST PATTERNS ===
    const helpPatterns = [
        /preciso\s+de\s+(ajuda|uma\s+m[aã]o)/i,
        /algu[eé]m\s+(me\s+)?ajuda/i,
        /pode\s+me\s+(ajudar|explicar|dizer)/i,
        /me\s+ajudem/i,
        /help+/i
    ];

    if (helpPatterns.some(p => p.test(text))) {
        return true;
    }

    // === SERVER/BOT STATUS PATTERNS ===
    // Perguntas sobre o servidor/bot que o Alfred deve responder
    const serverPatterns = [
        /\b(server|servidor|serv)\b.*\?+$/i,  // "server voltou?", "servidor tá on?"
        /\b(bot|alfred)\b.*\?+$/i,            // "bot tá funcionando?", "alfred tá on?"
        /\b(discord|dc)\b.*\?+$/i,            // "discord caiu?", "dc voltou?"
        /\b(voltou|caiu|online|offline|funcionando|bugado|travou)\b.*\?+$/i,  // perguntas de status
        /\b(tá|ta|está|esta)\s+(on|off|online|offline|up|down)\b.*\?*/i  // "tá on?", "está online?"
    ];

    if (serverPatterns.some(p => p.test(text))) {
        return true;
    }

    return false;
}

// ============================================
// Exports
// ============================================

module.exports = {
    getFastResponse,
    shouldSkipEmbedding,
    shouldSearchMemories,
    isMusicRelated,
    classifyMessageType,
    shouldRespond,
    GREETINGS
};
