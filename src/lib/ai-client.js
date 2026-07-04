const logger = require('./logger');
const GroqClient = require('./groq-client');
const groqLimiter = require('./groq-limiter');
const openrouter = require('./openrouter-client');
const { getMainSystemPrompt, TASK_PROMPTS, CLASSIFICATION_PROMPTS, buildPrompt } = require('../config/prompts');

// Configuração do sistema de tokens
const TOKEN_USAGE_FILE = 'token-usage.json';
let tokenUsage = {};

// Carrega o uso de tokens do arquivo
try {
    const fs = require('fs');
    if (fs.existsSync(TOKEN_USAGE_FILE)) {
        tokenUsage = JSON.parse(fs.readFileSync(TOKEN_USAGE_FILE, 'utf8'));
    }
} catch (error) {
    logger.error('Erro ao carregar token usage:', error);
}

class AIClient {
    constructor() {
        this.provider = {
            name: 'Groq',
            client: new GroqClient()
        };
    }

    async initialize() {
        logger.info('[AIClient] Cliente AI inicializado');
        // Pré-carrega o modelo local na VRAM em background (não bloqueia o boot).
        // Assim o primeiro fallback pro Ollama não paga o load de ~10GB.
        this.provider.client.warmupOllama().catch(() => {});
    }

    getCurrentProvider() {
        return this.provider.name;
    }

    /**
     * Gets the main system prompt, optionally with server context
     * @param {Object} serverInfo - Guild info { info, persona }
     * @returns {string} Complete system prompt
     */
    getSystemPrompt(serverInfo = null) {
        const systemMessage = getMainSystemPrompt(serverInfo);
        return systemMessage.content;
    }

    /**
     * Gets a task-specific prompt
     * @param {string} promptId - Prompt identifier
     * @param {Object} context - Variables to replace
     * @returns {Object} Complete message object { role, content }
     */
    getTaskPrompt(promptId, context = {}) {
        return buildPrompt(promptId, context);
    }

    estimateTokens(messages) {
        // Estimativa simples: 1 token a cada 4 caracteres
        return messages.reduce((acc, m) => acc + Math.ceil((m.content?.length || 0) / 4), 0);
    }

    logTokenUsage({ functionName, tokens, inputSummary }) {
        // Opcional: logar uso de tokens
        logger.info(`[Tokens] Função: ${functionName}, Tokens: ${tokens}, Input: ${inputSummary}`);
    }

    /** Loga uso de tokens de uma chamada de chat (atalho para logTokenUsage). */
    _logChat(functionName, messages) {
        this.logTokenUsage({
            functionName,
            tokens: this.estimateTokens(messages),
            inputSummary: messages[messages.length - 1]?.content?.slice(0, 100) || 'N/A'
        });
    }

    /**
     * Decide qual modelo usar baseado na complexidade da mensagem.
     *
     * Regras:
     *  - Pergunta complexa (raciocínio, código, comparações) → Groq llama-3.3-70b
     *  - Contexto denso (>10 mensagens) → Groq
     *  - Forçado via options.forceProvider → respeita
     *  - Casual / simples → Ollama qwen2.5:14b local (gratuito, baixa latência)
     *  - Se Ollama offline → fallback automático para Groq
     *
     * @param {Object[]} messages
     * @param {Object} options
     * @returns {Promise<Object>} Resposta no shape { choices: [{ message: { content } }] }
     */
    async chat(messages, options = {}) {
        try {
            // Enriquecer contexto se solicitado
            if (options.enrichContext) {
                messages = await this.enrichContextWithReasoning(messages, options);
            }

            // Forçar provider específico se pedido
            if (options.forceProvider === 'groq') {
                return await this._chatGroq(messages, options);
            }
            if (options.forceProvider === 'ollama') {
                return await this._chatOllamaWithFallback(messages, options);
            }

            // Fluxo padrão: Groq -> OpenRouter -> Local (Ollama)
            if (groqLimiter.isAvailable()) {
                try {
                    logger.debug('[Router] Tentando Groq...');
                    return await this._chatGroq(messages, options);
                } catch (err) {
                    logger.warn(`[Router] Groq falhou (${err.message}) — iniciando fallbacks de nuvem/local.`);
                }
            }

            // Se Groq estiver em rate-limit ou falhar, tenta OpenRouter -> Local
            return await this._chatCloudFallback(messages, options);

        } catch (error) {
            logger.error('Erro no chat:', error);
            throw error;
        }
    }

    /**
     * Envia para Groq. Em rate limit (429), segue a cadeia de fallback:
     * Groq → OpenRouter (nuvem grátis) → Ollama local.
     */
    async _chatGroq(messages, options = {}) {
        try {
            const response = await this.provider.client.chat(messages, options);
            this._logChat('chat:groq', messages);
            return response;
        } catch (error) {
            if (!groqLimiter.isRateLimit(error)) throw error;
            groqLimiter.markRateLimited(error);
            return await this._chatCloudFallback(messages, options);
        }
    }

    /** Fallback quando o Groq está indisponível: OpenRouter → Ollama local. */
    async _chatCloudFallback(messages, options = {}) {
        // 1) OpenRouter free
        if (openrouter.isAvailable()) {
            try {
                logger.warn('[Router] Groq indisponível — usando OpenRouter.');
                const response = await openrouter.chat(messages, options);
                this._logChat('chat:openrouter', messages);
                return response;
            } catch (err) {
                logger.warn(`[Router] OpenRouter falhou (${err.message}) — fallback Ollama local.`);
            }
        }
        // 2) Ollama local
        logger.warn('[Router] Fallback final: Ollama local.');
        const response = await this.provider.client.chatOllama(messages, null, options);
        this._logChat('chat:ollama-fallback', messages);
        return response;
    }

    /** Tenta Ollama; se falhar, faz fallback para Groq silenciosamente. */
    async _chatOllamaWithFallback(messages, options = {}) {
        try {
            const response = await this.provider.client.chatOllama(messages, null, options);
            this._logChat('chat:ollama', messages);
            return response;
        } catch (err) {
            // Se o Groq está em cooldown por rate limit, não adianta cair nele.
            if (!groqLimiter.isAvailable()) {
                logger.warn('[Router] Ollama indisponível e Groq em cooldown — sem provider disponível.');
                throw err;
            }
            logger.debug('[Router] Ollama indisponível — fallback para Groq');
            return await this._chatGroq(messages, options);
        }
    }

    // Raciocínio em Cadeia (Chain of Thought)
    async enrichContextWithReasoning(messages, options) {
        const lastUserMessage = messages[messages.length - 1];

        // Detecta se é pergunta complexa que requer raciocínio
        if (this.isComplexQuestion(lastUserMessage.content)) {
            const reasoningPrompt = {
                role: 'system',
                content: 'Antes de responder, pense passo a passo: 1) O que está sendo perguntado? 2) Que informações você tem? 3) Qual a melhor forma de explicar?'
            };
            messages.splice(messages.length - 1, 0, reasoningPrompt);
        }

        // Adiciona memórias relevantes se fornecidas
        if (options.memories && options.memories.length > 0) {
            const memoryContext = {
                role: 'system',
                content: `Informações relevantes da memória do servidor:\n${options.memories.map((m, i) => `${i + 1}. ${m.message}`).join('\n')}`
            };
            messages.splice(1, 0, memoryContext);
        }

        return messages;
    }

    // Detecta perguntas complexas
    isComplexQuestion(text) {
        const complexIndicators = [
            /por que|porque/i,
            /como funciona/i,
            /qual.*diferença/i,
            /explique|explicar/i,
            /compare|comparar/i,
            /analise|analisar/i,
            /vantagens.*desvantagens/i,
            /prós.*contras/i
        ];
        return complexIndicators.some(pattern => pattern.test(text));
    }

    // Detecta spam ou mensagens irrelevantes
    isSpamOrIrrelevant(text) {
        const spamPatterns = [
            /^[a-z]$/i, // Uma única letra
            /^[.,!?;:]+$/, // Apenas pontuação
            /^\d+$/, // Apenas números sem contexto
            /^(kkk+|rsrs+|haha+|kaka+)$/i, // Apenas risadas
            /^(oi|hey|eae|fala|salve)\s*$/i, // Cumprimentos isolados sem contexto
            /^[\s\n]+$/ // Apenas espaços
        ];

        // Mensagens muito curtas (menos de 3 caracteres) geralmente são spam
        if (text.trim().length < 3) return true;

        return spamPatterns.some(pattern => pattern.test(text.trim()));
    }

    // Detecta se a mensagem requer resposta elaborada
    requiresDetailedResponse(text) {
        const detailedIndicators = [
            /explique|explain|detalhe|detalhadamente/i,
            /como.*(funciona|fazer|criar|configurar)/i,
            /passo a passo|tutorial|guia/i,
            /quais.*diferenças/i,
            /me ajuda a entender/i,
            /não.*entend(i|o)/i
        ];
        return detailedIndicators.some(pattern => pattern.test(text));
    }

    // Verifica se é uma pergunta que já foi respondida recentemente
    async checkRecentDuplicate(text, userId, channelId, timeWindowMinutes = 5) {
        // Implementação básica - pode ser expandida com Redis
        const key = `recent_${userId}_${channelId}`;
        // TODO: Implementar cache de perguntas recentes
        return false; // Por enquanto, sempre retorna false
    }

    async getEmbedding(text) {
        try {
            const embedding = await this.provider.client.getEmbedding(text);
            if (embedding) {
                this.logTokenUsage({
                    functionName: 'getEmbedding',
                    tokens: Math.ceil((text.length || 0) / 4),
                    inputSummary: text.slice(0, 200)
                });
            }
            // Retorna null silenciosamente se Ollama não estiver disponível
            // O warning já foi mostrado no groq-client (apenas 1x)
            return embedding;
        } catch (error) {
            logger.error(`Erro ao obter embedding:`, error);
            return null;
        }
    }

    async classifyRelevanceOllama(text, contexto = []) {
        // Use centralized classification prompt
        const classificationPrompt = CLASSIFICATION_PROMPTS.relevanceCheck.prompt.content;

        let contextoStr = '';
        if (contexto && contexto.length > 0) {
            contextoStr = '\n\nContexto recente:\n' + contexto.map(m =>
                `${m.role === 'user' ? 'Usuário' : 'Alfred'}: ${m.content}`
            ).join('\n');
        }

        const messages = [
            { role: 'system', content: classificationPrompt },
            { role: 'user', content: `${contextoStr}\n\nFrase a analisar: "${text}"` }
        ];

        // Temperatura baixa para classificação determinística
        const result = await this.provider.client.chatOllama(messages, 'qwen2.5:14b', { temperature: 0.1, maxTokens: 20 });
        return result.choices?.[0]?.message?.content?.trim().toUpperCase();
    }

    /**
     * Analisa se uma mensagem é uma resposta contextual ao diálogo anterior
     * Usa Ollama local para não gastar tokens do Groq
     * 
     * @param {string} userMessage - Mensagem atual do usuário
     * @param {string} botLastMessage - Última mensagem do bot
     * @returns {Promise<boolean>} Se deve responder ou não
     */
    async shouldRespondToContext(userMessage, botLastMessage) {
        try {
            const prompt = `Você é um analisador de diálogos. Analise se a mensagem do usuário é uma RESPOSTA DIRETA à pergunta/mensagem anterior do bot Alfred.

## ÚLTIMA MENSAGEM DO ALFRED:
"${botLastMessage}"

## MENSAGEM DO USUÁRIO:
"${userMessage}"

## REGRAS:
- Responda "SIM" se a mensagem do usuário for uma resposta direta ao que o bot disse
- Responda "SIM" para: confirmações, negações, respostas curtas que fazem sentido no contexto
- Responda "NAO" se a mensagem parecer aleatória ou não relacionada ao diálogo
- Responda "NAO" se for um novo assunto/pergunta não relacionada

## EXEMPLOS:
- Bot: "quer ajuda?" + User: "quero" → SIM
- Bot: "como posso te ajudar?" + User: "nada" → SIM  
- Bot: "qual música?" + User: "metallica" → SIM
- Bot: "tudo bem?" + User: "e você?" → SIM
- Bot: "precisa de algo?" + User: "olha esse meme" → NAO

Responda APENAS "SIM" ou "NAO":`;

            const messages = [
                { role: 'user', content: prompt }
            ];

            // Temperatura baixa para classificação determinística
            const result = await this.provider.client.chatOllama(messages, 'qwen2.5:14b', { temperature: 0.1, maxTokens: 20 });
            const response = result.choices?.[0]?.message?.content?.trim().toUpperCase() || '';

            logger.debug(`[Context] Ollama análise: "${userMessage}" → ${response}`);
            return response.includes('SIM');
        } catch (error) {
            logger.warn(`[Context] Ollama indisponível, usando fallback regex:`, error.message);
            // Fallback para regex se Ollama não estiver disponível
            return this.shouldRespondToContextFallback(userMessage);
        }
    }

    /**
     * Fallback usando regex quando Ollama não está disponível
     */
    shouldRespondToContextFallback(text) {
        const content = text.toLowerCase().trim();
        // Respostas simples comuns
        const simpleResponses = /^(sim|não|nao|ss|sss|n|nn|claro|com certeza|talvez|acho que sim|acho que não|é|eh|isso|exato|de boa|pode ser|bora|vamos|tranquilo|suave|beleza|blz|ok|okay|massa|show|top|demais|muito|pouco|bastante|quero|nao quero|não quero|preciso|nao preciso|aceito|recuso|manda|dale|dá|da|faz|to|tô|estou|nop|yep|yup|siiim|siim|simmm|nãoo|naoo|aham|uhum|mhm|pra mim|pode|claro que|óbvio|lógico|certeza|com ctz|ctz|talvez|sei la|sei lá|depende|tanto faz|foda-se|nada|tudo|muito|pouco)/i;
        return simpleResponses.test(content);
    }

    async transcribeAudio(audioBuffer, filename = 'audio.ogg') {
        try {
            const transcription = await this.provider.client.transcribeAudio(audioBuffer, filename);
            logger.info('[AIClient] Áudio transcrito com sucesso');
            return transcription;
        } catch (error) {
            logger.error('[AIClient] Erro ao transcrever áudio:', error);
            throw error;
        }
    }

    // Detecta tom emocional da mensagem
    detectEmotionalTone(text) {
        const tones = {
            frustrated: /que (merda|droga|saco)|não (funciona|entendo)|bugado|travado|problema/i,
            excited: /massa|legal|demais|show|top|irado|foda|incrível/i,
            urgent: /urgente|rápido|preciso agora|help|ajuda rápido/i,
            casual: /^(fala|oi|eae|salve|beleza)/i,
            grateful: /obrigad[oa]|valeu|thanks|brigadão|tmj/i
        };

        for (const [tone, pattern] of Object.entries(tones)) {
            if (pattern.test(text)) return tone;
        }

        return 'neutral';
    }

    // Ajusta estilo de resposta baseado no tom
    getResponseStyleForTone(tone) {
        const styles = {
            frustrated: 'Seja paciente, empático e ofereça soluções práticas diretas.',
            excited: 'Combine o entusiasmo, seja positivo e engajado.',
            urgent: 'Seja direto, objetivo e eficiente. Vá direto ao ponto.',
            casual: 'Seja descontraído e breve. Uma ou duas frases no máximo.',
            grateful: 'Seja modesto e natural. Apenas confirme ou deseje bem.',
            neutral: 'Mantenha o tom padrão: útil, claro e direto.'
        };

        return styles[tone] || styles.neutral;
    }
}

module.exports = new AIClient(); 