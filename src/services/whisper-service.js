/**
 * 🎤 Whisper Service
 * Primary: Local Whisper server (faster-whisper via Python)
 * Secondary: Local Voicebox API (FastAPI)
 * Fallback: Groq Whisper API (with rate limiting)
 */

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const logger = require('../lib/logger');

// Configuration
const LOCAL_WHISPER_URL = process.env.WHISPER_URL || 'http://localhost:5000';
const VOICEBOX_URL = process.env.VOICEBOX_URL || 'http://localhost:17493';
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_WHISPER_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

// Rate limiting para Groq
const GROQ_RATE_LIMIT = {
    maxRequests: 18, // Limite conservador (Groq permite 20/min)
    windowMs: 60000, // 1 minuto
    requests: [],
    lastWarning: 0
};

// ============================================
// Service Class
// ============================================

class WhisperService {
    constructor() {
        this.localAvailable = null; // null = não verificado ainda
        this.voiceboxAvailable = null;
        this.groqAvailable = !!GROQ_API_KEY;
        this._checkingHealth = false;
    }

    /**
     * Check if local Whisper server or Voicebox is available
     */
    async checkHealth(retries = 10, delayMs = 2000) {
        if (this._checkingHealth) return this.localAvailable || this.voiceboxAvailable || this.groqAvailable;

        // Short-circuits
        if (this.localAvailable === true || this.voiceboxAvailable === true) {
            return true;
        }

        this._checkingHealth = true;

        for (let attempt = 1; attempt <= retries; attempt++) {
            let oneAvailable = false;

            // 1. Verificar faster-whisper local (porta 5000)
            if (this.localAvailable !== true) {
                try {
                    const response = await axios.get(`${LOCAL_WHISPER_URL}/health`, { timeout: 1500 });
                    this.localAvailable = response.data?.status === 'ok';
                    if (this.localAvailable) {
                        logger.info(`[Whisper] ✅ Servidor faster-whisper local disponível (modelo: ${response.data.model})`);
                        oneAvailable = true;
                    }
                } catch (_) {
                    this.localAvailable = false;
                }
            } else {
                oneAvailable = true;
            }

            // 2. Verificar Voicebox local (porta 17493)
            if (this.voiceboxAvailable !== true) {
                try {
                    // Chamada rápida para a raiz ou profiles para verificar se está respondendo
                    const response = await axios.get(`${VOICEBOX_URL}/profiles`, { timeout: 1500 });
                    this.voiceboxAvailable = Array.isArray(response.data);
                    if (this.voiceboxAvailable) {
                        logger.info(`[Whisper] ✅ Servidor Voicebox local disponível para transcrição`);
                        oneAvailable = true;
                    }
                } catch (_) {
                    this.voiceboxAvailable = false;
                }
            } else {
                oneAvailable = true;
            }

            if (oneAvailable) {
                this._checkingHealth = false;
                return true;
            }

            if (attempt < retries) {
                logger.info(`[Whisper] ⏳ Serviços de transcrição locais ainda não responderam (tentativa ${attempt}/${retries}), aguardando ${delayMs/1000}s...`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }

        this._checkingHealth = false;
        
        if (this.groqAvailable) {
            logger.info('[Whisper] ⚠️ Servidores locais indisponíveis, usando Groq como fallback');
        } else {
            logger.warn('[Whisper] ⚠️ Nenhum serviço de transcrição local e Groq não configurado');
        }

        return this.localAvailable || this.voiceboxAvailable || this.groqAvailable;
    }

    /**
     * Check Groq rate limit
     */
    _checkGroqRateLimit() {
        const now = Date.now();
        GROQ_RATE_LIMIT.requests = GROQ_RATE_LIMIT.requests.filter(
            t => now - t < GROQ_RATE_LIMIT.windowMs
        );
        return GROQ_RATE_LIMIT.requests.length < GROQ_RATE_LIMIT.maxRequests;
    }

    _recordGroqRequest() {
        GROQ_RATE_LIMIT.requests.push(Date.now());
    }

    /**
     * Transcribe using LOCAL Whisper server (faster-whisper)
     */
    async transcribeLocal(audio, language = 'pt') {
        const form = new FormData();

        if (Buffer.isBuffer(audio)) {
            form.append('audio', audio, {
                filename: 'audio.wav',
                contentType: 'audio/wav'
            });
        } else if (typeof audio === 'string') {
            form.append('audio', fs.createReadStream(audio));
        }

        form.append('language', language);

        const response = await axios.post(`${LOCAL_WHISPER_URL}/transcribe`, form, {
            headers: form.getHeaders(),
            timeout: 120000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

        return response.data;
    }

    /**
     * Transcribe using local Voicebox API
     */
    async transcribeVoicebox(audio, language = 'pt') {
        const form = new FormData();

        // Enviar os dois parâmetros comuns (file e audio) para compatibilidade garantida
        if (Buffer.isBuffer(audio)) {
            form.append('file', audio, {
                filename: 'audio.wav',
                contentType: 'audio/wav'
            });
            form.append('audio', audio, {
                filename: 'audio.wav',
                contentType: 'audio/wav'
            });
        } else if (typeof audio === 'string') {
            const stream1 = fs.createReadStream(audio);
            const stream2 = fs.createReadStream(audio);
            form.append('file', stream1);
            form.append('audio', stream2);
        }

        form.append('language', language);

        const response = await axios.post(`${VOICEBOX_URL}/transcribe`, form, {
            headers: form.getHeaders(),
            timeout: 60000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

        return {
            text: response.data.text || response.data.transcript || "",
            language: language,
            segments: []
        };
    }

    /**
     * Transcribe using Groq Whisper API
     */
    async transcribeGroq(audio, language = 'pt') {
        if (!this._checkGroqRateLimit()) {
            throw new Error('Groq rate limit atingido, aguarde 1 minuto');
        }

        const form = new FormData();

        if (Buffer.isBuffer(audio)) {
            form.append('file', audio, {
                filename: 'audio.wav',
                contentType: 'audio/wav'
            });
        } else if (typeof audio === 'string') {
            form.append('file', fs.createReadStream(audio));
        }

        form.append('model', 'whisper-large-v3-turbo');
        form.append('language', language);
        form.append('response_format', 'json');

        this._recordGroqRequest();

        const response = await axios.post(GROQ_WHISPER_URL, form, {
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                ...form.getHeaders()
            },
            timeout: 30000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

        return {
            text: response.data.text,
            language: language,
            segments: []
        };
    }

    /**
     * Transcribe audio file (tries faster-whisper first, then Voicebox, then Groq)
     */
    async transcribe(audio, language = 'pt') {
        if (this.localAvailable === null || this.voiceboxAvailable === null) {
            await this.checkHealth();
        }

        // 1. Tentar faster-whisper local
        if (this.localAvailable) {
            try {
                return await this.transcribeLocal(audio, language);
            } catch (error) {
                logger.warn(`[Whisper] Local faster-whisper falhou: ${error.message}, tentando outros...`);
                this.localAvailable = false;
            }
        }

        // 2. Tentar Voicebox local
        if (this.voiceboxAvailable) {
            try {
                return await this.transcribeVoicebox(audio, language);
            } catch (error) {
                logger.warn(`[Whisper] Local Voicebox falhou: ${error.message}, tentando Groq...`);
                this.voiceboxAvailable = false;
            }
        }

        // 3. Fallback para Groq
        if (this.groqAvailable) {
            try {
                return await this.transcribeGroq(audio, language);
            } catch (error) {
                const msg = error.response?.data?.error?.message || error.message;
                throw new Error(`Whisper Error: ${msg}`);
            }
        }

        throw new Error('Nenhum serviço de transcrição disponível');
    }

    /**
     * Detect wake word and extract command (LOCAL faster-whisper)
     */
    async detectWakeWordLocal(audio) {
        const form = new FormData();

        if (Buffer.isBuffer(audio)) {
            form.append('audio', audio, {
                filename: 'audio.wav',
                contentType: 'audio/wav'
            });
        } else if (typeof audio === 'string') {
            form.append('audio', fs.createReadStream(audio));
        }

        const response = await axios.post(`${LOCAL_WHISPER_URL}/detect-wake-word`, form, {
            headers: form.getHeaders(),
            timeout: 120000
        });

        return response.data;
    }

    /**
     * Detect wake word using Voicebox (parsed locally)
     */
    async detectWakeWordVoicebox(audio) {
        const result = await this.transcribeVoicebox(audio, 'pt');
        return this.parseWakeWord(result.text);
    }

    /**
     * Detect wake word using Groq (parsed locally)
     */
    async detectWakeWordGroq(audio) {
        const result = await this.transcribeGroq(audio, 'pt');
        return this.parseWakeWord(result.text);
    }

    /**
     * Helper to detect and extract command from transcribed text
     */
    parseWakeWord(transcriptText) {
        const fullText = transcriptText.toLowerCase().trim();
        logger.debug(`[Whisper] Texto transcrevido: "${fullText}"`);

        const wakeWordRegex = /\b(alfred[o]?|álfred[o]?|alfret|alferd|al\s+fred[o]?|afred|aufred|alfréd)\b/i;
        const match = fullText.match(wakeWordRegex);
        const detected = match !== null;

        let command = "";
        if (detected) {
            const matchedWord = match[0];
            command = fullText.replace(matchedWord, '').trim();
            command = command.replace(/,\s*,/g, ',');
            command = command.replace(/\s+/g, ' ');
            command = command.replace(/^[,!?.\s\-]+|[,!?.\s\-]+$/g, '').trim();
        }

        return { detected, text: fullText, command };
    }

    /**
     * Detect wake word and extract command (tries faster-whisper -> Voicebox -> Groq)
     */
    async detectWakeWord(audio) {
        if (this.localAvailable === null || this.voiceboxAvailable === null) {
            await this.checkHealth();
        }

        // 1. Tentar local faster-whisper primeiro
        if (this.localAvailable) {
            try {
                return await this.detectWakeWordLocal(audio);
            } catch (error) {
                logger.warn(`[Whisper] Local faster-whisper wake-word falhou: ${error.message}`);
                this.localAvailable = false;
            }
        }

        // 2. Tentar Voicebox local
        if (this.voiceboxAvailable) {
            try {
                return await this.detectWakeWordVoicebox(audio);
            } catch (error) {
                logger.warn(`[Whisper] Voicebox local wake-word falhou: ${error.message}`);
                this.voiceboxAvailable = false;
            }
        }

        // 3. Fallback para Groq
        if (this.groqAvailable && this._checkGroqRateLimit()) {
            try {
                return await this.detectWakeWordGroq(audio);
            } catch (error) {
                logger.error(`[Whisper] Groq wake-word falhou: ${error.message}`);
                throw error;
            }
        }

        throw new Error('Nenhum serviço de transcrição disponível');
    }
}

// Singleton instance
const whisperService = new WhisperService();

module.exports = whisperService;
