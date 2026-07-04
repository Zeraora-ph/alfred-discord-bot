/**
 * Tool Use Service
 * Permite que o Alfred decida autonomamente quando usar ferramentas
 * (web search, música, clima, filmes, memória) durante uma conversa.
 *
 * Suporta:
 *  - Groq: function calling nativo via API
 *  - Ollama qwen2.5:14b: tool use via /api/chat com tools param
 *
 * Fluxo:
 *  1. Mensagem chega → enviamos com definições de ferramentas
 *  2. Modelo retorna tool_call OU resposta normal
 *  3. Se tool_call → executamos a ferramenta → enviamos resultado → modelo responde
 *  4. Resultado final entregue ao usuário
 *
 * @module services/tool-use-service
 */

const axios  = require('axios');
const logger = require('../lib/logger');
const groqLimiter = require('../lib/groq-limiter');
const openrouter  = require('../lib/openrouter-client');

// ============================================
// Definição das ferramentas
// ============================================

const TOOLS = [
    {
        type: 'function',
        function: {
            name: 'buscar_na_web',
            description: 'Pesquisa informações atualizadas na internet. Use quando o usuário perguntar sobre notícias, eventos recentes, preços, lançamentos ou qualquer coisa que exija informação atual.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'O que pesquisar na web' }
                },
                required: ['query']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'verificar_clima',
            description: 'Verifica o clima e previsão do tempo de uma cidade.',
            parameters: {
                type: 'object',
                properties: {
                    cidade: { type: 'string', description: 'Nome da cidade' }
                },
                required: ['cidade']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'buscar_filme',
            description: 'Busca informações sobre um filme: sinopse, elenco, nota, ano.',
            parameters: {
                type: 'object',
                properties: {
                    titulo: { type: 'string', description: 'Título do filme' }
                },
                required: ['titulo']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'tocar_musica',
            description: 'Toca uma música no canal de voz do Discord. Use quando o usuário pedir para tocar, colocar ou ouvir uma música.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Nome da música, artista ou URL do YouTube' }
                },
                required: ['query']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'entrar_na_call',
            description: 'Conecta ao canal de voz do usuário para ouvi-lo e conversar com ele por voz em tempo real.',
            parameters: {
                type: 'object',
                properties: {}
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'salvar_na_memoria',
            description: 'Salva um fato importante sobre o usuário para lembrar no futuro.',
            parameters: {
                type: 'object',
                properties: {
                    fato: { type: 'string', description: 'O fato a ser salvo' }
                },
                required: ['fato']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'configurar_modo_rpg',
            description: 'Ativa ou desativa o modo silencioso/RPG (onde o bot toca música mas não fala por voz nem manda embeds no chat). Use quando o usuário indicar que vai começar/parar o RPG ou pedir para silenciar o bot.',
            parameters: {
                type: 'object',
                properties: {
                    ativo: { type: 'boolean', description: 'true para ativar o modo silencioso/RPG, false para desativar' }
                },
                required: ['ativo']
            }
        }
    }
];

// ============================================
// Execução das ferramentas
// ============================================

/**
 * Executa a ferramenta chamada pelo modelo.
 *
 * @param {string} toolName
 * @param {Object} args
 * @param {Object} message - Discord message (para contexto)
 * @returns {Promise<string>} Resultado em texto para enviar de volta ao modelo
 */
async function executeTool(toolName, args, message) {
    logger.info(`[ToolUse] Executando: ${toolName}`, args);

    try {
        switch (toolName) {

            case 'buscar_na_web': {
                const webSearch = require('./web-search');
                const results = await webSearch.search(args.query);
                if (!results?.length) return 'Nenhum resultado encontrado na web.';
                return results.slice(0, 3)
                    .map((r, i) => `${i + 1}. **${r.title}**\n${r.snippet}`)
                    .join('\n\n');
            }

            case 'verificar_clima': {
                const utilityHandler = require('../handlers/utility-handler');
                // Retorna uma representação textual do clima
                let climaResult = '';
                const fakeMsg = {
                    ...message,
                    reply: async (text) => { climaResult = typeof text === 'string' ? text : text?.content || JSON.stringify(text); }
                };
                await utilityHandler.handleTempoCommand(fakeMsg, [args.cidade]);
                return climaResult || `Não foi possível obter clima para ${args.cidade}.`;
            }

            case 'buscar_filme': {
                const utilityHandler = require('../handlers/utility-handler');
                let filmeResult = '';
                const fakeMsg = {
                    ...message,
                    reply: async (text) => { filmeResult = typeof text === 'string' ? text : text?.content || JSON.stringify(text); }
                };
                await utilityHandler.handleFilmeCommand(fakeMsg, [args.titulo]);
                return filmeResult || `Não encontrei informações sobre "${args.titulo}".`;
            }

            case 'tocar_musica': {
                const musicPlayer = message.client?.musicPlayer;
                if (!musicPlayer) return 'Sistema de música não disponível.';

                const command = { action: 'play', query: args.query };
                await musicPlayer.execute(message, command);

                // Atualiza relacionamento: pedido de música via tool use
                try {
                    const userRel = require('./user-relationship-service');
                    await userRel.updateAfterInteraction(message.author.id, message.guildId, 'music_request');
                    await userRel.addMusicTaste(message.author.id, message.guildId, args.query);
                } catch {}

                return `Iniciando "${args.query}" no canal de voz.`;
            }

            case 'entrar_na_call': {
                const musicPlayer = message.client?.musicPlayer;
                if (!musicPlayer) return 'Sistema de voz não disponível.';
                const guildId = message.guild?.id || message.guildId;
                const isListening = message.client.voiceListener?.connections.has(guildId);
                if (isListening) {
                    return 'Eu já estou conectado e escutando você neste canal de voz.';
                }
                await musicPlayer.execute(message, { action: 'listen' });
                return 'Conectando ao canal de voz e iniciando escuta.';
            }

            case 'salvar_na_memoria': {
                const memoryHandler = require('../handlers/memory-handler');
                await memoryHandler.saveRawMemory(message, args.fato, true);
                return `Anotei: "${args.fato}"`;
            }

            case 'configurar_modo_rpg': {
                const musicPlayer = message.client?.musicPlayer;
                if (!musicPlayer) return 'Sistema de música não disponível.';

                const guildId = message.guild?.id || message.guildId;
                musicPlayer.silentMode.set(guildId, args.ativo);
                logger.info(`[RPG] Modo silencioso definido via IA para ${args.ativo} na guild ${guildId}`);
                
                return `Modo silencioso (RPG) definido para ${args.ativo ? 'ATIVADO' : 'DESATIVADO'}.`;
            }

            default:
                return `Ferramenta desconhecida: ${toolName}`;
        }
    } catch (err) {
        logger.error(`[ToolUse] Erro ao executar ${toolName}:`, err.message);
        return `Erro ao executar ${toolName}: ${err.message}`;
    }
}

/**
 * Executa uma lista de tool_calls e retorna as mensagens de resultado prontas
 * para reenviar ao modelo. Suporta o shape OpenAI (Groq/OpenRouter: com `id` e
 * `arguments` em JSON string) e o do Ollama (`arguments` já é objeto, sem `id`).
 *
 * @param {Object[]} toolCalls
 * @param {Object} discordMessage
 * @returns {Promise<Object[]>} mensagens { role:'tool', content, [tool_call_id] }
 */
async function executeToolCalls(toolCalls, discordMessage) {
    const toolMessages = [];
    for (const call of toolCalls) {
        const toolName = call.function?.name;
        const rawArgs  = call.function?.arguments;
        let toolArgs = rawArgs || {};
        if (typeof rawArgs === 'string') {
            try { toolArgs = JSON.parse(rawArgs); } catch { toolArgs = {}; }
        }

        const result = await executeTool(toolName, toolArgs, discordMessage);
        logger.info(`[ToolUse] Resultado de ${toolName}: ${result.slice(0, 100)}...`);

        const toolMsg = { role: 'tool', content: result };
        if (call.id) toolMsg.tool_call_id = call.id; // shape OpenAI (Groq/OpenRouter)
        toolMessages.push(toolMsg);
    }
    return toolMessages;
}

// ============================================
// Chat com tool use via Groq
// ============================================

/**
 * Envia mensagens para o Groq com suporte a function calling.
 * Executa ferramentas automaticamente e retorna resposta final.
 *
 * @param {Object[]} messages
 * @param {Object} discordMessage
 * @param {Object} options
 * @returns {Promise<string>} Resposta final em texto
 */
async function chatWithToolsGroq(messages, discordMessage, options = {}) {
    const apiKey  = process.env.GROQ_API_KEY;
    const baseURL = process.env.GROQ_API_URL || 'https://api.groq.com/openai/v1/chat/completions';
    const model   = process.env.GROQ_MODEL   || 'llama-3.3-70b-versatile';

    if (!apiKey) throw new Error('GROQ_API_KEY não configurada');

    const payload = {
        model,
        messages,
        tools: TOOLS,
        tool_choice: 'auto',
        max_tokens:  options.maxTokens || 2000,
        temperature: options.temperature || 0.8
    };

    const response = await axios.post(baseURL, payload, {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 30000
    });

    const choice  = response.data.choices?.[0];
    const msg     = choice?.message;

    // Sem tool call — retorna diretamente
    if (!msg?.tool_calls?.length) {
        return msg?.content || '';
    }

    // Executa cada tool call e adiciona resultados à conversa
    const updatedMessages = [...messages, msg, ...await executeToolCalls(msg.tool_calls, discordMessage)];

    // Segunda chamada: modelo processa os resultados das ferramentas
    const finalPayload = { model, messages: updatedMessages, max_tokens: options.maxTokens || 2000, temperature: options.temperature || 0.8 };
    const finalResponse = await axios.post(baseURL, finalPayload, {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 30000
    });

    return finalResponse.data.choices?.[0]?.message?.content || '';
}

// ============================================
// Chat com tool use via Ollama
// ============================================

/**
 * Envia mensagens para Ollama (qwen2.5:14b) com suporte a tools.
 * qwen2.5 suporta tool use nativamente via /api/chat.
 *
 * @param {Object[]} messages
 * @param {Object} discordMessage
 * @param {Object} options
 * @returns {Promise<string>} Resposta final em texto
 */
async function chatWithToolsOllama(messages, discordMessage, options = {}) {
    const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const model     = process.env.OLLAMA_CHAT_MODEL || 'qwen2.5:14b';

    const payload = {
        model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        tools: TOOLS,
        stream: false,
        keep_alive: process.env.OLLAMA_KEEP_ALIVE || -1,
        options: {
            temperature: options.temperature || 0.8,
            num_predict: options.maxTokens || 2000
        }
    };

    const response = await axios.post(`${ollamaUrl}/api/chat`, payload, { timeout: 60000 });
    const msg = response.data?.message;

    // Sem tool call
    if (!msg?.tool_calls?.length) {
        return msg?.content || '';
    }

    // Executa ferramentas
    const updatedMessages = [
        ...messages,
        { role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls },
        ...await executeToolCalls(msg.tool_calls, discordMessage)
    ];

    // Segunda chamada com resultados
    const finalPayload = { model, messages: updatedMessages.map(m => ({ role: m.role, content: m.content })), stream: false, keep_alive: process.env.OLLAMA_KEEP_ALIVE || -1, options: { temperature: options.temperature || 0.8 } };
    const finalResponse = await axios.post(`${ollamaUrl}/api/chat`, finalPayload, { timeout: 60000 });
    return finalResponse.data?.message?.content || '';
}

// ============================================
// Chat com tool use via OpenRouter (fallback de nuvem gratuito)
// ============================================

/**
 * Envia mensagens ao OpenRouter (modelos free) com function calling.
 * Mesmo fluxo de duas passadas do Groq. A rotação entre modelos é feita
 * pelo próprio OpenRouter via `models: [...]` dentro do openrouter-client.
 *
 * @param {Object[]} messages
 * @param {Object} discordMessage
 * @param {Object} options
 * @returns {Promise<string>} Resposta final em texto
 */
async function chatWithToolsOpenRouter(messages, discordMessage, options = {}) {
    const first = await openrouter.complete(messages, {
        tools: TOOLS,
        toolChoice: 'auto',
        maxTokens: options.maxTokens || 2000,
        temperature: options.temperature || 0.8
    });

    const msg = first.choices?.[0]?.message;

    // Sem tool call — retorna direto
    if (!msg?.tool_calls?.length) {
        return msg?.content || '';
    }

    const updatedMessages = [...messages, msg, ...await executeToolCalls(msg.tool_calls, discordMessage)];

    // Segunda passada: modelo processa os resultados das ferramentas
    const final = await openrouter.complete(updatedMessages, {
        maxTokens: options.maxTokens || 2000,
        temperature: options.temperature || 0.8
    });
    return final.choices?.[0]?.message?.content || '';
}

// ============================================
// API pública: roteamento automático
// ============================================

/**
 * Processa uma mensagem com tool use, roteando automaticamente entre
 * Ollama local e Groq dependendo da complexidade.
 *
 * @param {Object[]} messages - Histórico completo da conversa (system + histórico + user)
 * @param {Object} discordMessage - Mensagem original do Discord
 * @param {Object} options
 * @returns {Promise<string>} Resposta final em texto
 */
async function chat(messages, discordMessage, options = {}) {
    // CADEIA DE PROVIDERS:
    // 1) Groq (rápido, preferencial)
    // 2) OpenRouter free (fallback em nuvem)
    // 3) Ollama local (último recurso, mais lento)

    // 1) Groq
    if (groqLimiter.isAvailable()) {
        try {
            logger.debug('[ToolUse] Usando Groq com function calling...');
            return await chatWithToolsGroq(messages, discordMessage, options);
        } catch (err) {
            if (groqLimiter.isRateLimit(err)) {
                groqLimiter.markRateLimited(err);
                logger.warn('[ToolUse] Groq rate limited — tentando OpenRouter...');
            } else {
                logger.warn(`[ToolUse] Groq falhou (${err.message}) — tentando OpenRouter...`);
            }
        }
    }

    // 2) OpenRouter free
    if (openrouter.isAvailable()) {
        try {
            logger.debug('[ToolUse] Usando OpenRouter com function calling...');
            const result = await chatWithToolsOpenRouter(messages, discordMessage, options);
            if (result) return result;
        } catch (err) {
            logger.warn(`[ToolUse] OpenRouter falhou (${err.message}) — fallback Ollama local.`);
        }
    }

    // 3) Ollama local (último recurso)
    logger.debug('[ToolUse] Fallback final: Ollama local.');
    return await chatWithToolsOllama(messages, discordMessage, options);
}

// ============================================
// Exports
// ============================================

module.exports = {
    chat,
    TOOLS,
    executeTool
};
