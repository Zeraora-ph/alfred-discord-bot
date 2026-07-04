const { EdgeTTS } = require('node-edge-tts');
const { createAudioResource, StreamType } = require('@discordjs/voice');
const logger = require('./logger');
const path = require('path');
const fs = require('fs');
const os = require('os');
const axios = require('axios');

class TTSManager {
    constructor() {
        this.baseUrl = process.env.VOICEBOX_URL || 'http://localhost:17493';
        
        // Configuração do Edge TTS (voz predefinida)
        this.voice = process.env.EDGETTS_VOICE || 'pt-BR-FranciscaNeural'; 
        this.edgeTts = new EdgeTTS({
            voice: this.voice,
            lang: 'pt-BR',
            outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
        });

        this.cacheDir = path.join(os.tmpdir(), 'alfred_tts_cache');
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }

        // Diretório dedicado para saudações pré-geradas via Fish Audio
        this.greetingCacheDir = path.join(this.cacheDir, 'greetings');
        if (!fs.existsSync(this.greetingCacheDir)) {
            fs.mkdirSync(this.greetingCacheDir, { recursive: true });
        }

        this.voiceboxLock = Promise.resolve();

        // Todas as saudações do Rei Julien, organizadas por período do dia
        this.ALL_GREETINGS = {
            morning: [
                "Bom dia, meus súditos! Sua Majestade o Rei Julien acaba de acordar! Quem vai massagear meus pés hoje?",
                "Acordem, preguiçosos! O dia está lindo e eu quero dançar!",
                "Bom dia! O Rei Julien chegou para espalhar alegria e realeza neste canal de voz!"
            ],
            afternoon: [
                "Boa tarde! Que tédio... Cadê a música? Cadê o barulho? Vamos, comecem a me entreter!",
                "Sua Majestade está com calor! Alguém me abane com uma folha de palmeira!",
                "Boa tarde, súditos! Curvem-se diante de mim enquanto eu penso na minha próxima grande festa!"
            ],
            night: [
                "Boa noite! É hora da festa! O Rei da Balada chegou! Vamos chacoalhar tudo!",
                "Quem disse que é hora de dormir? A noite é uma criança e eu sou o brinquedo!",
                "Boa noite! Eu vim para agitar essa call! Maurice, solta a batida!"
            ]
        };
    }

    /**
     * Gera uma chave de cache determinística para uma frase de saudação
     */
    _greetingCacheKey(text) {
        return Buffer.from(text).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 40);
    }

    /**
     * Pré-gera todas as saudações do Rei Julien via Fish Audio e salva em disco.
     * Chamado uma única vez no boot do bot. Frases já cacheadas são ignoradas.
     */
    async prefetchGreetings() {
        const useFishAudio = process.env.USE_FISH_AUDIO === 'true';
        if (!useFishAudio) {
            logger.info('[TTS] Fish Audio desativado. Saudações não serão pré-geradas.');
            return;
        }

        const allPhrases = [
            ...this.ALL_GREETINGS.morning,
            ...this.ALL_GREETINGS.afternoon,
            ...this.ALL_GREETINGS.night
        ];

        let generated = 0;
        let cached = 0;

        for (const phrase of allPhrases) {
            const key = this._greetingCacheKey(phrase);
            const filePath = path.join(this.greetingCacheDir, `${key}.mp3`);

            if (fs.existsSync(filePath)) {
                cached++;
                continue;
            }

            try {
                logger.info(`[TTS] Pré-gerando saudação Fish Audio: "${phrase.slice(0, 40)}..."`);
                const audioData = await this.generateFishAudio(phrase);
                if (audioData) {
                    fs.writeFileSync(filePath, audioData);
                    generated++;
                    logger.info(`[TTS] ✅ Saudação cacheada: "${phrase.slice(0, 40)}..."`);
                }
            } catch (err) {
                logger.warn(`[TTS] ⚠ Falha ao pré-gerar saudação: ${err.message}`);
            }
        }

        logger.info(`[TTS] Prefetch de saudações concluído: ${generated} geradas, ${cached} já em cache.`);
    }

    /**
     * Retorna um AudioResource de uma saudação pré-cacheada aleatória
     * baseada no horário atual. Se não houver cache, retorna null.
     */
    getGreetingResource() {
        const hour = new Date().getHours();
        let period;
        if (hour >= 6 && hour < 12) period = 'morning';
        else if (hour >= 12 && hour < 18) period = 'afternoon';
        else period = 'night';

        const phrases = this.ALL_GREETINGS[period];
        const randomPhrase = phrases[Math.floor(Math.random() * phrases.length)];
        const key = this._greetingCacheKey(randomPhrase);
        const filePath = path.join(this.greetingCacheDir, `${key}.mp3`);

        if (!fs.existsSync(filePath)) {
            logger.warn(`[TTS] Saudação não encontrada em cache: "${randomPhrase.slice(0, 30)}..."`);
            return null;
        }

        logger.info(`[TTS] Reproduzindo saudação cacheada (${period}): "${randomPhrase.slice(0, 40)}..."`);
        return createAudioResource(fs.createReadStream(filePath), {
            inputType: StreamType.Arbitrary,
            inlineVolume: true
        });
    }

    /**
     * Tries to generate audio via local Voicebox API.
     * Falls back to Edge TTS on failure.
     * @param {string} text 
     */
    async createResource(text, options = {}) {
        try {
            const customVoiceId = options.voiceId;
            let cacheKey = Buffer.from(text).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
            if (customVoiceId) {
                cacheKey += `-${customVoiceId.slice(0, 8)}`;
            }
            
            // Check cache first (using .wav for voicebox, fallback to .mp3)
            const cachedWavPath = path.join(this.cacheDir, `${cacheKey}.wav`);
            const cachedMp3Path = path.join(this.cacheDir, `${cacheKey}.mp3`);

            if (fs.existsSync(cachedWavPath)) {
                logger.debug(`[TTS] Cache HIT (Voicebox): ${text.slice(0, 30)}...`);
                return createAudioResource(fs.createReadStream(cachedWavPath), {
                    inputType: StreamType.Arbitrary,
                    inlineVolume: true
                });
            }

            if (fs.existsSync(cachedMp3Path)) {
                logger.debug(`[TTS] Cache HIT (EdgeTTS): ${text.slice(0, 30)}...`);
                return createAudioResource(fs.createReadStream(cachedMp3Path), {
                    inputType: StreamType.Arbitrary,
                    inlineVolume: true
                });
            }

            // Evitar geração duplicada concorrente (cache stampede / prefetch)
            if (!this.activeGenerations) {
                this.activeGenerations = new Map();
            }

            if (this.activeGenerations.has(cacheKey)) {
                logger.debug(`[TTS] Aguardando geração em andamento para: ${text.slice(0, 30)}...`);
                await this.activeGenerations.get(cacheKey);
                
                if (fs.existsSync(cachedWavPath)) {
                    return createAudioResource(fs.createReadStream(cachedWavPath), {
                        inputType: StreamType.Arbitrary,
                        inlineVolume: true
                    });
                }
                if (fs.existsSync(cachedMp3Path)) {
                    return createAudioResource(fs.createReadStream(cachedMp3Path), {
                        inputType: StreamType.Arbitrary,
                        inlineVolume: true
                    });
                }
            }

            // Criar promessa de geração ativa
            const generationPromise = (async () => {
                const useFishAudio = process.env.USE_FISH_AUDIO === 'true';

                if (useFishAudio) {
                    try {
                        logger.debug(`[TTS] Tentando gerar com Fish Audio: ${text.slice(0, 30)}...`);
                        const audioData = await this.generateFishAudio(text, customVoiceId);
                        if (audioData) {
                            fs.writeFileSync(cachedMp3Path, audioData);
                            logger.info(`[TTS] Áudio gerado com sucesso via Fish Audio para: "${text.slice(0, 30)}..."`);
                            return cachedMp3Path;
                        }
                    } catch (err) {
                        logger.warn(`[TTS] Fish Audio falhou (${err.message}). Usando fallback...`);
                    }
                }

                const useVoicebox = process.env.USE_VOICEBOX !== 'false';

                if (useVoicebox) {
                    // Tentar gerar usando Voicebox local
                    try {
                        logger.debug(`[TTS] Tentando gerar com Voicebox: ${text.slice(0, 30)}...`);
                        const audioData = await this.generateVoicebox(text, customVoiceId);
                        if (audioData) {
                            fs.writeFileSync(cachedWavPath, audioData);
                            logger.info(`[TTS] Áudio gerado com sucesso via Voicebox para: "${text.slice(0, 30)}..."`);
                            return cachedWavPath;
                        }
                    } catch (err) {
                        logger.warn(`[TTS] Voicebox indisponível ou falhou (${err.message}). Usando fallback EdgeTTS...`);
                    }
                }

                // Usar Edge TTS diretamente se desativado ou falhar
                logger.debug(`[TTS] Gerando via EdgeTTS: ${text.slice(0, 30)}...`);
                await this.edgeTts.ttsPromise(text, cachedMp3Path);
                return cachedMp3Path;
            })();

            this.activeGenerations.set(cacheKey, generationPromise);

            let filePath;
            try {
                filePath = await generationPromise;
            } finally {
                this.activeGenerations.delete(cacheKey);
            }

            return createAudioResource(fs.createReadStream(filePath), {
                inputType: StreamType.Arbitrary,
                inlineVolume: true
            });

        } catch (error) {
            logger.error(`[TTS] Erro ao criar resource: ${error.message}`);
            return null;
        }
    }

    /**
     * Synthesize voice using Voicebox local FastAPI backend (serialized via mutex lock)
     * @param {string} text 
     */
    async generateVoicebox(text, customVoiceId = null) {
        const currentLock = this.voiceboxLock;
        let resolveLock;
        this.voiceboxLock = new Promise(resolve => {
            resolveLock = resolve;
        });

        try {
            await currentLock;
            return await this._executeGenerateVoicebox(text, customVoiceId);
        } finally {
            resolveLock();
        }
    }

    /**
     * Efetua a requisição real de síntese de voz no Voicebox
     */
    async _executeGenerateVoicebox(text, customVoiceId = null) {
        // Fetch or default profile
        let profileId = customVoiceId || process.env.VOICEBOX_PROFILE_ID;
        let profile = null;

        try {
            const profilesRes = await axios.get(`${this.baseUrl}/profiles`, { timeout: 2000 });
            if (profilesRes.data && profilesRes.data.length > 0) {
                if (profileId) {
                    profile = profilesRes.data.find(p => p.id === profileId);
                }
                if (!profile) {
                    profile = profilesRes.data[0];
                    profileId = profile.id;
                }
            }
        } catch (e) {
            logger.debug(`[TTS] Erro ao obter perfis do Voicebox: ${e.message}`);
        }

        if (!profileId) {
            profileId = 'default';
        }

        // Configurar o payload de geração com fallbacks inteligentes
        const payload = {
            text: text,
            profile_id: profileId,
            engine: process.env.VOICEBOX_ENGINE || profile?.default_engine || 'chatterbox',
            language: process.env.VOICEBOX_LANGUAGE || profile?.language || 'pt'
        };

        if (process.env.VOICEBOX_MODEL_SIZE) {
            payload.model_size = process.env.VOICEBOX_MODEL_SIZE;
        }

        logger.debug(`[TTS] Enviando payload ao Voicebox: ${JSON.stringify(payload)}`);

        // 1. Enviar requisição POST para iniciar geração
        const genResponse = await axios.post(`${this.baseUrl}/generate`, payload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 5000
        });

        const genId = genResponse.data?.id || genResponse.data?.generation_id;
        if (!genId) {
            throw new Error('ID de geração não recebido do Voicebox');
        }

        logger.debug(`[TTS] Geração Voicebox iniciada (ID: ${genId}), aguardando conclusão...`);

        // 2. Poll status endpoint (/history/{id} ou /generations/{id})
        let completed = false;
        let attempts = 0;
        const maxAttempts = 300; // ~60 segundos de timeout total (essencial para cold starts de modelos grandes)
        
        while (!completed && attempts < maxAttempts) {
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 200)); // Espera 200ms
            
            try {
                // Polling do status
                const statusRes = await axios.get(`${this.baseUrl}/history/${genId}`, { timeout: 1000 });
                const record = statusRes.data;
                const status = record?.status;

                if (status === 'completed' || status === 'success') {
                    completed = true;
                } else if (status === 'failed' || status === 'error') {
                    throw new Error(`Geração falhou no Voicebox (status: ${status})`);
                }
            } catch (pollErr) {
                // Se a rota history não estiver disponível, tentar verificar se a rota de audio já retorna o arquivo ou ignorar erros temporários de polling
                logger.debug(`[TTS] Erro ao pesquisar status da geração: ${pollErr.message}`);
            }
        }

        if (!completed) {
            throw new Error(`Timeout de geração excedido no Voicebox (ID: ${genId})`);
        }

        // 3. Download do arquivo de áudio binário
        const audioResponse = await axios.get(`${this.baseUrl}/audio/${genId}`, {
            responseType: 'arraybuffer',
            timeout: 10000
        });

        return Buffer.from(audioResponse.data);
    }

    async generateFishAudio(text, customVoiceId = null) {
        const apiKey = process.env.FISH_API_KEY;
        const voiceId = customVoiceId || process.env.FISH_VOICE_ID;
        const model = process.env.FISH_MODEL || 's2.1-pro';

        if (!apiKey || !voiceId) {
            throw new Error('FISH_API_KEY ou FISH_VOICE_ID não configurados');
        }

        const response = await axios.post('https://api.fish.audio/v1/tts', {
            text: text,
            reference_id: voiceId,
            format: 'mp3'
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'model': model
            },
            responseType: 'arraybuffer',
            timeout: 10000
        });

        return Buffer.from(response.data);
    }

    clearCache() {
        try {
            const files = fs.readdirSync(this.cacheDir);
            for (const file of files) {
                fs.unlinkSync(path.join(this.cacheDir, file));
            }
            logger.info(`[TTS] Cache limpo: ${files.length} arquivos removidos`);
        } catch (e) {
            logger.warn(`[TTS] Erro ao limpar cache: ${e.message}`);
        }
    }
}

module.exports = new TTSManager();
