const axios = require('axios');
const logger = require('./logger');
const groqLimiter = require('./groq-limiter');

class GroqClient {
    constructor() {
        // Configurações para chat Groq
        this.apiKey = process.env.GROQ_API_KEY;
        this.baseURL = process.env.GROQ_API_URL || 'https://api.groq.com/openai/v1/chat/completions';
        this.model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

        // Configurações para embeddings Ollama
        this.ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        // Modelos recomendados: mxbai-embed-large (melhor qualidade), nomic-embed-text (mais rápido), bge-m3 (multilíngue)
        // Use tag completo se necessário (ex: mxbai-embed-large:335m)
        this.embeddingModel = process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text:latest';

        // Flag para evitar spam de warnings de embedding
        this._embeddingWarningShown = false;

        // Rate limiting config
        this.maxRetries = 3;
        this.baseDelay = 1000; // 1 second

        logger.info('[Groq] Cliente configurado com modelo:', this.model);
        logger.info('[Ollama] Embedding model:', this.embeddingModel);
    }

    /**
     * Helper to sleep for a given number of milliseconds
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Retry wrapper with exponential backoff for rate limiting
     */
    async withRetry(fn, maxRetries = this.maxRetries) {
        let lastError;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error;
                const status = error.response?.status;

                // Rate limit com espera longa (cota diária/TPD): não adianta
                // retentar com backoff de segundos — falha rápido para o roteador
                // cair no Ollama local imediatamente.
                if (status === 429) {
                    const waitMs = groqLimiter.parseRetryMs(error);
                    if (waitMs && waitMs > 15000) {
                        logger.warn(`[Groq] Rate limit longo (~${Math.ceil(waitMs / 1000)}s). Sem retry — fallback imediato.`);
                        throw error;
                    }
                }

                // Only retry on rate limit (429) or server errors (5xx)
                if (status === 429 || (status >= 500 && status < 600)) {
                    if (attempt < maxRetries) {
                        // Check for Retry-After header
                        const retryAfter = error.response?.headers?.['retry-after'];
                        let delay;

                        if (retryAfter) {
                            delay = parseInt(retryAfter, 10) * 1000;
                        } else {
                            // Exponential backoff: 1s, 2s, 4s
                            delay = this.baseDelay * Math.pow(2, attempt);
                        }

                        logger.warn(`[Groq] Rate limited (429). Aguardando ${delay}ms antes do retry ${attempt + 1}/${maxRetries}...`);
                        await this.sleep(delay);
                        continue;
                    }
                }

                // Don't retry other errors
                throw error;
            }
        }
        throw lastError;
    }

    async chat(messages, options = {}) {
        if (!this.apiKey) {
            throw new Error('GROQ_API_KEY não configurada');
        }
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
        };
        const payload = {
            model: this.model,
            messages: messages,
            max_tokens: options.maxTokens || 2000,
            temperature: options.temperature || 0.9, // Higher for more creative/unfiltered
            top_p: options.topP || 0.98, // Higher diversity
            frequency_penalty: options.frequencyPenalty || 0.2,
            presence_penalty: options.presencePenalty || 0.2
        };

        try {
            // Use retry wrapper for rate limiting
            const response = await this.withRetry(async () => {
                return await axios.post(this.baseURL, payload, { headers });
            });
            return response.data;
        } catch (error) {
            logger.error('[Groq] Erro na requisição de chat:', error.message);
            if (error.response) {
                logger.error('[Groq] Status:', error.response.status);
                logger.error('[Groq] Dados:', error.response.data);
            }
            throw error;
        }
    }

    async getEmbedding(text) {
        if (!text || typeof text !== 'string' || !text.trim()) {
            logger.warn('[Embedding] Texto para embedding está vazio.');
            return null;
        }
        const sanitizedText = text.trim().substring(0, 8192);

        // Try primary model with shorter timeout
        // Note: Ollama model names may need full tag (e.g., "mxbai-embed-large:335m")
        try {
            logger.debug(`[Embedding] Tentando ${this.embeddingModel}...`);
            const response = await axios.post(
                `${this.ollamaBaseUrl}/api/embed`,
                {
                    model: this.embeddingModel,
                    input: sanitizedText,
                    keep_alive: process.env.OLLAMA_KEEP_ALIVE || -1
                },
                { timeout: 10000 }
            );

            if (response.data?.embeddings?.[0]?.length > 0) {
                logger.debug(`[Embedding] OK via ${this.embeddingModel}`);
                this._embeddingWarningShown = false; // Reset on success
                return response.data.embeddings[0];
            }
        } catch (error) {
            // Show warning only once to avoid log spam when Ollama is down
            if (!this._embeddingWarningShown) {
                logger.warn(`[Embedding] Ollama indisponível (embeddings desativados). Erro: ${error.message}`);
                this._embeddingWarningShown = true;
            }
        }

        try {
            const fallbackModel = 'nomic-embed-text:latest';
            logger.debug(`[Embedding] Tentando fallback ${fallbackModel}...`);
            const response = await axios.post(
                `${this.ollamaBaseUrl}/api/embed`,
                {
                    model: fallbackModel,
                    input: sanitizedText
                },
                { timeout: 8000 }
            );

            if (response.data?.embeddings?.[0]?.length > 0) {
                logger.debug(`[Embedding] OK via fallback ${fallbackModel}`);
                this._embeddingWarningShown = false; // Reset on success
                return response.data.embeddings[0];
            }
        } catch (fallbackError) {
            // Already warned above, no need to spam
        }

        return null;
    }

    /**
     * Chat via Ollama local usando /api/chat (suporta multi-turn corretamente).
     * Retorna o mesmo shape que o Groq: { choices: [{ message: { content } }] }
     *
     * @param {Object[]} messages - Array de { role, content }
     * @param {string} model - Modelo Ollama (default: qwen2.5:14b)
     * @param {Object} options - temperature, maxTokens, timeout
     */
    async chatOllama(messages, model = null, options = {}) {
        const chatModel = model || process.env.OLLAMA_CHAT_MODEL || 'qwen2.5:14b';
        const ollamaUrl = this.ollamaBaseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        const timeout   = options.timeout || 45000;

        try {
            const response = await axios.post(
                `${ollamaUrl}/api/chat`,
                {
                    model: chatModel,
                    messages: messages.map(m => ({ role: m.role, content: m.content })),
                    stream: false,
                    // Mantém o modelo residente na VRAM entre mensagens (evita recarregar 10GB a cada chamada)
                    keep_alive: process.env.OLLAMA_KEEP_ALIVE || -1,
                    options: {
                        temperature: options.temperature || 0.8,
                        num_predict: options.maxTokens || 2000
                    }
                },
                { timeout }
            );

            const content = response.data?.message?.content;
            if (content) {
                this._ollamaWarningShown = false;
                return { choices: [{ message: { content } }] };
            } else {
                logger.error('[Ollama Chat] Resposta inesperada:', response.data);
                return { choices: [{ message: { content: '' } }] };
            }
        } catch (error) {
            if (!this._ollamaWarningShown) {
                logger.warn(`[Ollama Chat] Indisponível (modelo: ${chatModel}). Erro: ${error.message}`);
                this._ollamaWarningShown = true;
            }
            throw error;
        }
    }

    /**
     * Pré-carrega o modelo de chat do Ollama na VRAM (fire-and-forget).
     * Chamado no boot para que a primeira resposta local não pague o load de ~10GB.
     */
    async warmupOllama() {
        const chatModel = process.env.OLLAMA_CHAT_MODEL || 'qwen2.5:14b';
        const ollamaUrl = this.ollamaBaseUrl || 'http://localhost:11434';
        try {
            await axios.post(
                `${ollamaUrl}/api/chat`,
                {
                    model: chatModel,
                    messages: [{ role: 'user', content: 'oi' }],
                    stream: false,
                    keep_alive: process.env.OLLAMA_KEEP_ALIVE || -1,
                    options: { num_predict: 1 }
                },
                { timeout: 120000 } // load do modelo pode demorar na primeira vez
            );
            logger.info(`[Ollama] Modelo ${chatModel} pré-carregado na VRAM (keep_alive ativo).`);
        } catch (error) {
            logger.warn(`[Ollama] Warmup falhou (${chatModel}): ${error.message}. Fallback local pode ter latência na 1ª chamada.`);
        }
    }

    async transcribeAudio(audioBuffer, filename = 'audio.ogg') {
        if (!this.apiKey) {
            throw new Error('GROQ_API_KEY não configurada');
        }

        try {
            const FormData = require('form-data');
            const formData = new FormData();

            formData.append('file', audioBuffer, {
                filename: filename,
                contentType: 'audio/ogg'
            });
            formData.append('model', 'whisper-large-v3-turbo');
            formData.append('language', 'pt');
            formData.append('response_format', 'json');

            logger.info('[Groq] Transcrevendo áudio...');

            const response = await axios.post(
                'https://api.groq.com/openai/v1/audio/transcriptions',
                formData,
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        ...formData.getHeaders()
                    },
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity
                }
            );

            logger.info('[Groq] Áudio transcrito com sucesso');
            return response.data.text;
        } catch (error) {
            logger.error('[Groq] Erro ao transcrever áudio:', error.message);
            if (error.response) {
                logger.error('[Groq] Status:', error.response.status);
                logger.error('[Groq] Dados:', error.response.data);
            }
            throw error;
        }
    }
}

module.exports = GroqClient; 