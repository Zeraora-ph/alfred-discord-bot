/**
 * AI Handler
 * Handles AI conversation processing, context management, and memory integration
 * 
 * @module handlers/ai-handler
 */

const logger = require('../lib/logger');
const redis = require('../lib/redis-client');
const aiClient = require('../lib/ai-client');
const factStore = require('../lib/fact-store');
const memoryHandler = require('./memory-handler');
const cacheService = require('../services/cache-service');
const { ExternalServiceError } = require('../services/error-handler');
const { TASK_PROMPTS, buildPrompt } = require('../config/prompts');

// 🆕 Novos serviços de memória, relacionamento e tool use
const memoryManager      = require('../services/memory-manager');
const userRelationship   = require('../services/user-relationship-service');
const toolUseService     = require('../services/tool-use-service');

// ============================================
// Constants
// ============================================

const CONTEXT_TTL = 1800; // 30 minutes
const MAX_CONTEXT_MESSAGES = 50;

// ============================================
// Context Management
// ============================================

/**
 * Monta a chave de contexto por usuário dentro do canal.
 * Evita que conversas paralelas no mesmo canal se misturem.
 *
 * @param {string} channelId
 * @param {string} [userId] - se omitido, usa 'global' como fallback
 * @returns {string}
 */
function contextKey(channelId, userId = 'global') {
    return `context:${channelId}:${userId}`;
}

/**
 * Stores a message in the conversation context
 *
 * @param {Object} message - Discord message
 */
async function storeMessageForContext(message) {
    const key = contextKey(message.channelId, message.author?.id);

    try {
        const storedContext = await redis.get(key);
        const context = storedContext ? JSON.parse(storedContext) : [];

        context.push({
            role: 'user',
            content: message.content,
            author: message.author.username,
            timestamp: Date.now()
        });

        // Mantém apenas as mensagens recentes
        while (context.length > MAX_CONTEXT_MESSAGES) {
            context.shift();
        }

        await redis.setex(key, CONTEXT_TTL, JSON.stringify(context));
    } catch (error) {
        logger.error('[AI Handler] Erro ao armazenar contexto:', error);
    }
}

/**
 * Retrieves conversation context for a specific user in a channel.
 *
 * @param {string} channelId - Channel ID
 * @param {string} [userId] - User ID (opcional, fallback para 'global')
 * @returns {Promise<Object[]>} Conversation context
 */
async function getContext(channelId, userId = 'global') {
    const key = contextKey(channelId, userId);

    try {
        const stored = await redis.get(key);
        return stored ? JSON.parse(stored) : [];
    } catch (error) {
        logger.error('[AI Handler] Erro ao recuperar contexto:', error);
        return [];
    }
}

/**
 * Updates context with AI response
 *
 * @param {string} channelId - Channel ID
 * @param {string} userQuestion - User's question
 * @param {string} aiResponse - AI's response
 * @param {string} username - User's username
 * @param {string} [userId] - User ID
 */
async function updateContext(channelId, userQuestion, aiResponse, username, userId = 'global') {
    const key = contextKey(channelId, userId);

    try {
        const context = await getContext(channelId, userId);

        // ⚠️ NÃO re-armazenar a mensagem do usuário aqui!
        // Ela já foi salva por storeMessageForContext() no command-router.
        // Apenas adicionar a resposta do assistente.
        context.push(
            { role: 'assistant', content: aiResponse, timestamp: Date.now() }
        );

        while (context.length > MAX_CONTEXT_MESSAGES) {
            context.shift();
        }

        await redis.setex(key, CONTEXT_TTL, JSON.stringify(context));
    } catch (error) {
        logger.error('[AI Handler] Erro ao atualizar contexto:', error);
    }
}

// ============================================
// Guild Info
// ============================================

/**
 * Gets guild-specific info for AI context
 * 
 * @param {string} guildId - Guild ID
 * @returns {Promise<Object|null>} Guild info
 */
async function getGuildInfo(guildId) {
    try {
        // Usar factStore para pegar info e persona do SQLite (mesma fonte do painel web)
        const factStore = require('../lib/fact-store');
        const data = factStore.getGuildInfo(guildId);
        return data || { info: '', persona: '' };
    } catch (error) {
        logger.warn('[AI Handler] Erro ao carregar info do servidor:', error.message);
        return null;
    }
}

// ============================================
// Question Processing
// ============================================

/**
 * Processes a question and generates AI response
 * 
 * @param {Object} message - Discord message
 * @param {string} question - User's question
 * @param {string} [factContext] - Pre-fetched relevant memories
 * @returns {Promise<string>} AI response
 */
async function processQuestion(message, question, factContext = null, isVoice = false) {
    try {
        // Contexto por usuário — evita mistura com outras conversas no canal
        const context = await getContext(message.channelId, message.author?.id);

        // Get guild-specific info
        const guildInfo = await getGuildInfo(message.guildId);

        // 🆕 MEMÓRIA MULTI-CAMADA: Carrega contexto completo (short-term + long-term + episódico)
        let multiLayerContext = { shortTerm: [], longTermContext: '', episodicContext: '' };
        try {
            multiLayerContext = await memoryManager.getUserContext(
                message.author.id,
                message.guildId,
                question,
                message.author.username
            );
            // Comprime short-term se necessário (assíncrono, não bloqueia)
            memoryManager.compressIfNeeded(
                message.author.id,
                message.guildId,
                message.member?.displayName || message.author.username
            ).catch(() => {});
        } catch (e) {
            logger.debug(`[AI Handler] Falha ao carregar multi-layer memory: ${e.message}`);
        }

        // 🔥 RELACIONAMENTO: Carregar notas sobre o usuário que está perguntando
        let relationshipNotes = [];
        let personalityContext = '';
        try {
            relationshipNotes  = factStore.getUserRelationship(message.guildId, message.author.id, 5);
            personalityContext = await userRelationship.getPersonalityContext(
                message.author.id,
                message.guildId,
                message.member?.displayName || message.author.username
            );
            // Atualiza affinityScore pela interação
            userRelationship.updateAfterInteraction(message.author.id, message.guildId, 'message').catch(() => {});
        } catch (e) {
            logger.debug(`[AI Handler] Falha ao carregar relacionamento: ${e.message}`);
        }

        // Build message chain
        // Clean context messages to only include role and content (Groq doesn't support author/timestamp)
        // ⚠️ Remover a ÚLTIMA entrada do contexto se for a mensagem atual do usuário,
        // pois ela será adicionada explicitamente abaixo (evita duplicação).
        let contextForAI = context;
        if (context.length > 0) {
            const last = context[context.length - 1];
            if (last.role === 'user' && last.content === message.content) {
                contextForAI = context.slice(0, -1);
            }
        }

        const cleanedContext = contextForAI.map(msg => ({
            role: msg.role,
            content: (msg.role === 'user' && msg.author) ? `${msg.author}: ${msg.content}` : msg.content
        }));

        let systemPrompt = aiClient.getSystemPrompt(guildInfo);

        // 🆕 Injetar contexto de PERSONALIDADE e RELACIONAMENTO (novo serviço)
        if (personalityContext) {
            systemPrompt += `\n\n### COMO TRATAR ${message.author.username.toUpperCase()}:\n${personalityContext}`;
        }

        // Inject Memories directly into System Prompt (long-term do memory-manager)
        if (multiLayerContext.longTermContext) {
            systemPrompt += `\n\n### MEMÓRIAS RELEVANTES DO USUÁRIO (${message.author.username}):\n${multiLayerContext.longTermContext}\n\nUse essas informações para responder perguntas pessoais se necessário.`;
        } else if (factContext && typeof factContext === 'string' && factContext.trim().length > 0) {
            // Fallback para o factContext tradicional
            systemPrompt += `\n\n### MEMÓRIAS RELEVANTES DO USUÁRIO (${message.author.username}):\n${factContext}\n\nUse essas informações para responder perguntas pessoais se necessário.`;
        }

        // 🆕 Injetar episódios marcantes
        if (multiLayerContext.episodicContext) {
            systemPrompt += `\n\n### MOMENTOS MARCANTES COM ${message.author.username.toUpperCase()}:\n${multiLayerContext.episodicContext}`;
        }

        // 🔥 RELACIONAMENTO: Injetar notas de relacionamento do fact-store (legado, complementar)
        if (relationshipNotes.length > 0 && !personalityContext) {
            const formattedNotes = factStore.formatRelationshipForPrompt(relationshipNotes);
            systemPrompt += `\n\n### MEU RELACIONAMENTO COM ${message.author.username.toUpperCase()}:\n${formattedNotes}\n\nUse essas observações para personalizar sua resposta e mostrar que você conhece a pessoa.`;
        }

        if (isVoice) {
            systemPrompt += `\n\n### REGRA DE VOZ CRÍTICA E MANDATÓRIA:\nVocê está respondendo via canal de voz no Discord. Mantenha sua resposta EXTREMAMENTE curta, direta ao ponto e conversacional. Responda em no máximo duas frases curtas (idealmente apenas uma). Nunca use listas, marcações (como negrito), blocos de código ou explicações longas. Não seja prolixo.`;
        }

        const messages = [
            { role: 'system', content: systemPrompt },
            ...cleanedContext,
            { role: 'user', content: `${message.author.username}: ${question}` }
        ];

        logger.info(`[AI Handler] Processando pergunta: ${question.substring(0, 100)}...`);

        // 🆕 TOOL USE: Alfred decide autonomamente quando usar ferramentas
        // (web search, clima, filmes, música, memória)
        let aiResponse;
        try {
            aiResponse = await toolUseService.chat(messages, message, {
                temperature: isVoice ? 0.6 : 0.8,
                maxTokens: isVoice ? 150 : 2000
            });
            if (!aiResponse) throw new Error('Resposta vazia do tool use service');
        } catch (toolErr) {
            logger.warn(`[AI Handler] Tool use falhou (${toolErr.message}), usando chat simples`);
            // Fallback para chat simples sem tools
            const response = await aiClient.chat(messages, { 
                enrichContext: true, 
                temperature: isVoice ? 0.6 : 0.8, 
                maxTokens: isVoice ? 150 : 2000 
            });
            aiResponse = response.choices?.[0]?.message?.content || 'Sem resposta da IA.';
        }

        // Remove aspas que a IA pode colocar ao redor da resposta
        aiResponse = aiResponse.replace(/^["']|["']$/g, '').trim();

        // Lógica de Memória Passiva: Verifica se a IA identificou um fato para salvar
        const memoryMatch = aiResponse.match(/\[MEMORY:\s*(.+?)\]/);
        if (memoryMatch) {
            const fact = memoryMatch[1];
            try {
                // Remove a tag da resposta visível
                aiResponse = aiResponse.replace(memoryMatch[0], '').trim();

                // Salva o fato silenciosamente (com embedding gerado pelo handler)
                logger.info(`[AI Handler] Informação detectada: "${fact}"`);
                await memoryHandler.saveRawMemory(message, fact, true);
            } catch (e) {
                logger.warn('[AI Handler] Falha ao salvar memória automática:', e.message);
            }
        }

        // 🔥 RELACIONAMENTO: Verifica se a IA quer salvar uma nota sobre o usuário
        const relationshipMatch = aiResponse.match(/\[RELATIONSHIP:\s*(.+?)\]/);
        if (relationshipMatch) {
            const note = relationshipMatch[1];
            try {
                // Remove a tag da resposta visível
                aiResponse = aiResponse.replace(relationshipMatch[0], '').trim();

                // Salva a nota de relacionamento
                logger.info(`[AI Handler] Relacionamento detectado para ${message.author.username}: "${note}"`);
                factStore.saveRelationship(
                    message.guildId,
                    message.author.id,
                    message.author.username,
                    note,
                    'pessoal',
                    null,
                    null
                );
            } catch (e) {
                logger.warn('[AI Handler] Falha ao salvar relacionamento:', e.message);
            }
        }

        // Atualiza contexto por usuário
        await updateContext(message.channelId, question, aiResponse, message.author.username, message.author?.id);

        // 🆕 Salva no short-term memory (novo sistema em camadas)
        try {
            await memoryManager.storeMessage(message.author.id, message.guildId, 'user', question);
            await memoryManager.storeMessage(message.author.id, message.guildId, 'assistant', aiResponse);
        } catch (e) {
            logger.debug('[AI Handler] Falha ao salvar no short-term:', e.message);
        }

        // Auto-save if creation request
        const criacaoRegex = /\b(crie|criar|desenvolva|desenvolver|gere|gerar|invente|inventar)\b/i;
        if (criacaoRegex.test(question)) {
            try {
                await memoryHandler.saveRawMemory(message, `${question} = ${aiResponse}`, true);
            } catch (e) {
                logger.warn('[AI Handler] Não foi possível auto-salvar:', e.message);
            }
        }

        return aiResponse;

    } catch (error) {
        logger.error('[AI Handler] Erro ao processar pergunta:', error);
        throw new ExternalServiceError('AI', error);
    }
}

/**
 * Handles the !pergunta command
 * 
 * @param {Object} message - Discord message
 * @param {string[]} args - Command arguments
 */
async function handlePerguntaCommand(message, args) {
    if (args.length === 0) {
        await message.reply('❌ Por favor, faça uma pergunta. Exemplo: `!pergunta qual a capital do Brasil?`');
        return;
    }

    const question = args.join(' ');

    // Search for relevant memories
    let factContext = null;
    try {
        const embedding = await aiClient.getEmbedding(question);
        if (embedding) {
            const memories = factStore.getTopSimilarMemories(
                message.guildId,
                message.author.id,
                embedding,
                3
            );
            if (memories && memories.length > 0) {
                factContext = memories.map((m, i) => `Fato ${i + 1}: ${m.message}`).join('\n');
            }
        }
    } catch (e) {
        logger.warn('[AI Handler] Erro ao buscar memórias similares:', e.message);
    }

    const response = await processQuestion(message, question, factContext);
    await message.reply(response);
}

/**
 * Handles web page summarization
 * 
 * @param {Object} message - Discord message
 * @param {string} url - URL to summarize
 */
async function handleResumoCommand(message, url) {
    if (!url || !url.startsWith('http')) {
        await message.reply('❌ Por favor, forneça uma URL válida. Exemplo: `!resumo https://exemplo.com`');
        return;
    }

    try {
        const axios = require('axios');
        const cheerio = require('cheerio');

        const response = await axios.get(url, { timeout: 10000 });
        const $ = cheerio.load(response.data);

        let pageText = '';
        $('p, h1, h2, h3, h4, h5, h6').each((i, elem) => {
            pageText += $(elem).text() + '\n';
        });

        if (pageText.length > 15000) {
            pageText = pageText.substring(0, 15000);
        }

        // Use centralized prompt
        const systemPrompt = buildPrompt('webSummary');
        const messages = [
            systemPrompt,
            { role: 'user', content: pageText }
        ];

        const aiResponse = await aiClient.chat(messages);
        const summary = aiResponse.choices[0].message.content;

        await message.reply(`**📄 Resumo de:** ${url}\n\n${summary}`);

    } catch (error) {
        logger.error('[AI Handler] Erro no resumo:', error);

        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            await message.reply('❌ Não foi possível acessar essa URL. Verifique se está correta.');
        } else {
            await message.reply('❌ Erro ao processar o resumo. Tente novamente.');
        }
    }
}

/**
 * Handles translation requests
 * 
 * @param {Object} message - Discord message
 * @param {string[]} args - [targetLanguage, ...textToTranslate]
 */
async function handleTraduzirCommand(message, args) {
    if (args.length < 2) {
        await message.reply('❌ Uso: `!traduzir [idioma] [texto]`\nExemplo: `!traduzir inglês olá mundo`');
        return;
    }

    const targetLanguage = args[0];
    const textToTranslate = args.slice(1).join(' ');

    try {
        // Use centralized prompt with target language
        const systemPrompt = buildPrompt('translation', { targetLanguage });
        const messages = [
            systemPrompt,
            { role: 'user', content: textToTranslate }
        ];

        const response = await aiClient.chat(messages);
        const translatedText = response.choices[0].message.content;

        await message.reply(`**🌐 Tradução para ${targetLanguage}:**\n\n${translatedText}`);

    } catch (error) {
        logger.error('[AI Handler] Erro na tradução:', error);
        throw new ExternalServiceError('AI Translation', error);
    }
}

/**
 * Handles code generation requests
 * 
 * @param {Object} message - Discord message
 * @param {string[]} args - Description of code to generate
 */
async function handleCodigoCommand(message, args) {
    if (args.length === 0) {
        await message.reply('❌ Descreva o código que você precisa. Exemplo: `!codigo função que soma dois números em Python`');
        return;
    }

    const description = args.join(' ');

    try {
        // Use centralized prompt
        const systemPrompt = buildPrompt('codeGeneration');
        const messages = [
            systemPrompt,
            { role: 'user', content: `Crie o seguinte código: ${description}` }
        ];

        const response = await aiClient.chat(messages, { maxTokens: 3000 });
        const code = response.choices[0].message.content;

        await message.reply(`**💻 Código gerado:**\n\n${code}`);

    } catch (error) {
        logger.error('[AI Handler] Erro na geração de código:', error);
        throw new ExternalServiceError('AI Code Generation', error);
    }
}

// ============================================
// Exports
// ============================================

module.exports = {
    // Context Management
    storeMessageForContext,
    getContext,
    updateContext,
    getGuildInfo,

    // Question Processing
    processQuestion,

    // Command Handlers
    handlePerguntaCommand,
    handleResumoCommand,
    handleTraduzirCommand,
    handleCodigoCommand
};
