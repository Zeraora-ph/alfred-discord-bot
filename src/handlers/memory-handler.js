/**
 * Memory Handler
 * Handles fact storage, retrieval, and permission management
 * 
 * @module handlers/memory-handler
 */

const logger = require('../lib/logger');
const aiClient = require('../lib/ai-client');
const factStore = require('../lib/fact-store');
const { AuthorizationError, ExternalServiceError } = require('../services/error-handler');
const pronounResolver = require('../services/pronoun-resolver');

// ============================================
// Permission Helpers
// ============================================

/**
 * Checks if user has permission to save memories
 * 
 * @param {Object} message - Discord message
 * @returns {boolean} True if user can save
 */
function canUserSaveMemory(message) {
    const roleIds = message.member?.roles?.cache?.map(r => r.id) || [];
    const isAdmin = message.member?.permissions?.has('Administrator');
    return factStore.isWhitelisted(message.guildId, message.author.id, roleIds, isAdmin);
}

/**
 * Validates guild authorization
 * 
 * @param {string} guildId - Guild ID
 * @returns {boolean} True if guild is authorized
 */
function isGuildAuthorized(guildId) {
    return factStore.isGuildAuthorized(guildId);
}

// ============================================
// Memory Operations
// ============================================

/**
 * Saves a fact to memory with embedding
 * 
 * @param {Object} message - Discord message
 * @param {string} question - The key/question part
 * @param {string} answer - The value/answer part
 * @param {boolean} [silent=false] - Don't reply to user
 * @returns {Promise<boolean>} True if saved successfully
 */
async function saveFact(message, question, answer, silent = false) {
    // Check permission
    if (!canUserSaveMemory(message)) {
        if (!silent) {
            await message.reply('❌ Você não tem permissão para salvar informações neste servidor.');
        }
        return false;
    }

    // Normalize pronouns: "EU gosto de carros" -> "Username gosta de carros"
    const memoryText = `${question} = ${answer}`;
    const username = message.member?.displayName || message.author.username;
    const memoryData = pronounResolver.prepareForStorage(memoryText, username, message.author.id);
    const normalizedText = memoryData.normalized;

    try {
        // Generate embedding for semantic search
        let embedding = null;
        try {
            embedding = await aiClient.getEmbedding(normalizedText);
        } catch (err) {
            logger.warn('[Memory] Erro ao gerar embedding, salvando sem:', err.message);
        }

        // Save to database with normalized text
        factStore.saveMemory(message.guildId, message.author.id, normalizedText, embedding);

        if (!silent) {
            // Generate contextual confirmation
            const confirmationMessages = [
                { role: 'system', content: 'Você é Alfred, um assistente brasileiro. Confirme de forma breve e natural que a informação foi salva. Use expressões como "anotado", "guardei isso", "beleza", etc.' },
                { role: 'user', content: `Usuário salvou: ${question} = ${answer}` }
            ];

            try {
                const response = await aiClient.chat(confirmationMessages, { maxTokens: 100 });
                const reply = response.choices?.[0]?.message?.content || 'Anotado! ✅';
                await message.reply(reply);
            } catch {
                await message.reply('✅ Anotado!');
            }
        }

        logger.info(`[Memory] Fato salvo por ${message.author.tag} na guild ${message.guildId}`);
        return true;

    } catch (error) {
        logger.error('[Memory] Erro ao salvar fato:', error);
        if (!silent) {
            await message.reply('❌ Erro ao salvar informação. Tente novamente.');
        }
        return false;
    }
}

/**
 * Saves a raw text memory (used by AI auto-extraction)
 * 
 * @param {Object} message - Discord message
 * @param {string} text - The fact text
 * @param {boolean} [silent=true] - Default silent
 * @returns {Promise<boolean>} True if saved
 */
async function saveRawMemory(message, text, silent = true) {
    if (!canUserSaveMemory(message)) return false;

    const username = message.member?.displayName || message.author.username;
    // Store as is, but ensure pronouns are normalized
    const memoryData = pronounResolver.prepareForStorage(text, username, message.author.id);
    const normalizedText = memoryData.normalized;

    try {
        let embedding = null;
        try {
            embedding = await aiClient.getEmbedding(normalizedText);
        } catch (err) {
            logger.warn('[Memory] Erro ao gerar embedding (raw), salvando sem:', err.message);
        }

        if (embedding) {
            // Check for duplicates (Similarity > 90%)
            const similar = factStore.getTopSimilarMemories(message.guildId, message.author.id, embedding, 1);
            if (similar && similar.length > 0 && similar[0].score > 0.90) {
                logger.info(`[Memory] Memória duplicada ignorada (${(similar[0].score * 100).toFixed(1)}%): "${normalizedText}"`);
                return false;
            }
        }

        factStore.saveMemory(message.guildId, message.author.id, normalizedText, embedding);
        logger.info(`[Memory] Memória passiva salva: "${normalizedText}"`);
        return true;
    } catch (error) {
        logger.warn('[Memory] Erro ao salvar memória passiva:', error);
        return false;
    }
}

/**
 * Searches for similar memories
 * 
 * @param {string} guildId - Guild ID
 * @param {string} userId - User ID
 * @param {string} query - Search query
 * @param {number} [limit=3] - Max results
 * @returns {Promise<Object[]>} Matching memories
 */
async function searchMemories(guildId, userId, query, limit = 3, username = null) {
    try {
        // Normalize query pronouns if username provided
        let searchQuery = query;
        if (username) {
            searchQuery = pronounResolver.normalizeQuery(query, username);
        }

        // Try semantic search first (requires Ollama/embeddings)
        const embedding = await aiClient.getEmbedding(searchQuery);

        if (embedding) {
            const memories = factStore.getTopSimilarMemories(guildId, userId, embedding, limit);
            if (memories && memories.length > 0) {
                return memories;
            }
        }

        // 🔥 FALLBACK: Busca por palavras-chave (quando embedding não disponível)
        logger.debug('[Memory] Usando fallback de busca por texto');
        const textResults = factStore.searchMemoriesByKeywords(guildId, userId, searchQuery, limit);
        if (textResults && textResults.length > 0) {
            return textResults;
        }

        // Último fallback: busca simples por substring
        const memory = factStore.getSimilarMemory(guildId, userId, searchQuery);
        return memory ? [{ message: memory, score: 0.3 }] : [];

    } catch (error) {
        logger.error('[Memory] Erro na busca de memórias:', error);
        return [];
    }
}

/**
 * Formats memories for AI context
 * 
 * @param {Object[]} memories - Array of memory objects
 * @returns {string} Formatted context string
 */
function formatMemoriesForContext(memories) {
    if (!memories || memories.length === 0) {
        return '';
    }

    return memories
        .map((m, i) => `Fato ${i + 1}: ${m.message}`)
        .join('\n');
}

// ============================================
// Command Handlers
// ============================================

/**
 * Handles the !lembrar command
 * Format: !lembrar <pergunta> = <resposta>
 * 
 * @param {Object} message - Discord message
 * @param {string[]} args - Command arguments
 */
async function handleLembrarCommand(message, args) {
    const content = args.join(' ');

    // Parse question = answer format
    const match = content.match(/(.+?)\s*=\s*(.+)/);

    if (!match) {
        await message.reply('❌ Formato: `!lembrar <pergunta> = <resposta>`\nExemplo: `!lembrar cor favorita = azul`');
        return;
    }

    const [, question, answer] = match;
    await saveFact(message, question.trim(), answer.trim());
}

/**
 * Handles the !setmemperm command (admin only)
 * 
 * @param {Object} message - Discord message
 * @param {string[]} args - [permission level: everyone|admin|helper]
 */
async function handleSetMemPermCommand(message, args) {
    // Check admin permission
    if (!message.member?.permissions?.has('Administrator')) {
        await message.reply('❌ Este comando requer permissão de administrador.');
        return;
    }

    const role = args[0]?.toLowerCase();
    const validRoles = ['everyone', 'admin', 'helper'];

    if (!role || !validRoles.includes(role)) {
        await message.reply(`❌ Uso: \`!setmemperm <${validRoles.join('|')}>\``);
        return;
    }

    try {
        factStore.setPermission(message.guildId, role);
        const roleDescriptions = {
            everyone: 'todos os usuários',
            admin: 'apenas administradores',
            helper: 'administradores e helpers'
        };
        await message.reply(`✅ Permissão de memória alterada para: **${roleDescriptions[role]}**`);
    } catch (error) {
        logger.error('[Memory] Erro ao configurar permissão:', error);
        await message.reply('❌ Erro ao configurar permissão.');
    }
}

/**
 * Handles the !addwl command (add to whitelist)
 * 
 * @param {Object} message - Discord message
 * @param {string[]} args - Mentioned user or role
 */
async function handleAddWhitelistCommand(message, args) {
    if (!message.member?.permissions?.has('Administrator')) {
        await message.reply('❌ Este comando requer permissão de administrador.');
        return;
    }

    // Check for mentioned user
    const user = message.mentions.users.first();
    const role = message.mentions.roles.first();

    if (!user && !role) {
        await message.reply('❌ Mencione um usuário ou cargo para adicionar. Exemplo: `!addwl @usuario`');
        return;
    }

    try {
        if (user) {
            factStore.addToWhitelist(message.guildId, 'user', user.id);
            await message.reply(`✅ Usuário **${user.username}** adicionado à whitelist de memória.`);
        } else if (role) {
            factStore.addToWhitelist(message.guildId, 'role', role.id);
            await message.reply(`✅ Cargo **${role.name}** adicionado à whitelist de memória.`);
        }
    } catch (error) {
        logger.error('[Memory] Erro ao adicionar whitelist:', error);
        await message.reply('❌ Erro ao adicionar à whitelist.');
    }
}

/**
 * Handles the !removewl command (remove from whitelist)
 * 
 * @param {Object} message - Discord message
 * @param {string[]} args - Mentioned user or role
 */
async function handleRemoveWhitelistCommand(message, args) {
    if (!message.member?.permissions?.has('Administrator')) {
        await message.reply('❌ Este comando requer permissão de administrador.');
        return;
    }

    const user = message.mentions.users.first();
    const role = message.mentions.roles.first();

    if (!user && !role) {
        await message.reply('❌ Mencione um usuário ou cargo para remover. Exemplo: `!removewl @usuario`');
        return;
    }

    try {
        if (user) {
            factStore.removeFromWhitelist(message.guildId, 'user', user.id);
            await message.reply(`✅ Usuário **${user.username}** removido da whitelist.`);
        } else if (role) {
            factStore.removeFromWhitelist(message.guildId, 'role', role.id);
            await message.reply(`✅ Cargo **${role.name}** removido da whitelist.`);
        }
    } catch (error) {
        logger.error('[Memory] Erro ao remover whitelist:', error);
        await message.reply('❌ Erro ao remover da whitelist.');
    }
}

// ============================================
// Exports
// ============================================

module.exports = {
    // Permission Helpers
    canUserSaveMemory,
    isGuildAuthorized,

    // Memory Operations
    saveFact,
    saveRawMemory,
    searchMemories,
    formatMemoriesForContext,

    // Command Handlers
    handleLembrarCommand,
    handleSetMemPermCommand,
    handleAddWhitelistCommand,
    handleRemoveWhitelistCommand
};
