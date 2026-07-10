/**
 * 🎤 Voice Listener
 * Captures audio from Discord voice channels and processes voice commands
 */

const {
    joinVoiceChannel,
    getVoiceConnection, // Added
    VoiceConnectionStatus,
    entersState,
    EndBehaviorType,
    createAudioPlayer,
    NoSubscriberBehavior
} = require('@discordjs/voice');
const prism = require('prism-media');
const { Transform } = require('stream');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const logger = require('./logger');
const whisperService = require('../services/whisper-service');
const aiHandler = require('../handlers/ai-handler');

// ============================================
// Configuration
// ============================================

const SILENCE_THRESHOLD_MS = 1000;   // Silence before processing
const MIN_AUDIO_LENGTH_MS = 500;    // Minimum audio to process
const MAX_AUDIO_LENGTH_MS = 10000;  // Maximum audio length
const TEMP_DIR = path.join(os.tmpdir(), 'alfred-voice');

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// ============================================
// Voice Listener Class
// ============================================

class VoiceListener {
    constructor(client) {
        this.client = client;
        this.connections = new Map();  // guildId -> connection
        this.audioPlayers = new Map(); // guildId -> AudioPlayer
        this.listeners = new Map();    // guildId -> { userId -> streamData }
        this.enabled = false;
        this.isSpeaking = false;
        this.isProcessing = false;
        this.speakingGuilds = new Set();
        this.processingGuilds = new Set();
    }

    isSpeakingForGuild(guildId) {
        return this.speakingGuilds.has(guildId) || (this.isSpeaking && !this.connections.has(guildId));
    }

    isProcessingForGuild(guildId) {
        return this.processingGuilds.has(guildId) || (this.isProcessing && !this.connections.has(guildId));
    }

    setSpeaking(guildId, state) {
        if (state) {
            this.speakingGuilds.add(guildId);
            this.isSpeaking = true;
        } else {
            this.speakingGuilds.delete(guildId);
            this.isSpeaking = this.speakingGuilds.size > 0;
        }
    }

    setProcessing(guildId, state) {
        if (state) {
            this.processingGuilds.add(guildId);
            this.isProcessing = true;
        } else {
            this.processingGuilds.delete(guildId);
            this.isProcessing = this.processingGuilds.size > 0;
        }
    }

    /**
     * Start listening in a voice channel
     */
    async startListening(channel, textChannel) {
        const guildId = channel.guild.id;

        logger.info(`[Voice] 🔌 Iniciando escuta em: ${channel.name} (guild: ${guildId})`);

        // Quick health check (3 tentativas, 500ms) — não bloquear a conexão de voz por 20s
        const whisperAvailable = await whisperService.checkHealth(3, 500);
        if (!whisperAvailable) {
            logger.warn('[Voice] ⚠️ Whisper server (local) e Groq indisponíveis — comandos de voz desabilitados');
            return false;
        }
        logger.info('[Voice] ✅ Whisper disponível (local ou Groq)');

        try {
            // Check for existing connection
            let connection = getVoiceConnection(guildId);

            if (connection) {
                const status = connection.state.status;

                if (status === VoiceConnectionStatus.Destroyed) {
                    connection = null;
                } else if (status === VoiceConnectionStatus.Ready) {
                    logger.info('[Voice] ✅ Reutilizando conexão existente (Ready)');
                } else {
                    logger.info(`[Voice] Conexão existente em estado ${status} (não-Ready). Destruindo para recriar do zero...`);
                    try {
                        connection.destroy();
                    } catch (e) {
                        logger.warn(`[Voice] Erro ao destruir conexão anterior: ${e.message}`);
                    }
                    connection = null;
                }
            }

            if (!connection) {
                logger.info('[Voice] Criando nova conexão de voz...');
                connection = joinVoiceChannel({
                    channelId: channel.id,
                    guildId: guildId,
                    adapterCreator: channel.guild.voiceAdapterCreator,
                    selfDeaf: false,
                    selfMute: false
                });
            } else {
                logger.info(`[Voice] Reutilizando conexão existente (status: ${connection.state.status})`);
                if (connection.joinConfig.channelId !== channel.id) {
                    logger.info('[Voice] Mudando para canal diferente via rejoin...');
                    connection.rejoin({
                        channelId: channel.id,
                        selfDeaf: false,
                        selfMute: false
                    });
                }
            }

            // Aguarda conexão ficar Ready (apenas para conexões novas; reutilizadas já estão Ready)
            if (connection.state.status !== VoiceConnectionStatus.Ready) {
                try {
                    logger.info('[Voice] Aguardando estado Ready (até 25s)...');
                    logger.info(`[Voice] Estado atual: ${connection.state.status}`);
                    logger.info(`[Voice] Subscription: ${connection.state.subscription ? 'presente' : 'ausente'}`);
                    logger.info(`[Voice] Networking: ${connection.state.networking ? JSON.stringify(connection.state.networking.state) : 'ausente'}`);
                    
                    await entersState(connection, VoiceConnectionStatus.Ready, 25000);
                    logger.info('[Voice] ✅ Conexão pronta!');
                } catch (err) {
                    logger.error(`[Voice] ❌ Conexão não ficou Ready após 25s`);
                    logger.error(`[Voice] Status final: ${connection.state.status}`);
                    logger.error(`[Voice] Erro: ${err.message}`);
                    logger.error(`[Voice] Stack: ${err.stack}`);
                    
                    if (connection.state.status === VoiceConnectionStatus.Signalling) {
                        logger.error('[Voice] DIAGNÓSTICO: Conexão travada em Signalling');
                        logger.error('[Voice] Possíveis causas:');
                        logger.error('[Voice]   1. Bot sem permissão CONNECT no canal');
                        logger.error('[Voice]   2. Canal de voz cheio');
                        logger.error('[Voice]   3. Problema de rede/firewall');
                        logger.error('[Voice]   4. Discord API instável');
                        logger.error(`[Voice] Canal ID: ${channel.id}`);
                        logger.error(`[Voice] Guild ID: ${guildId}`);
                    }
                    
                    return false;
                }
            }

            if (!connection.receiver) {
                logger.error('[Voice] ❌ Receiver indisponível. Abortando escuta.');
                return false;
            }

            this.connections.set(guildId, {
                connection,
                channel,
                textChannel
            });

            // Start receiving audio
            this.setupReceiver(guildId, connection);

            logger.info(`[Voice] 🎤 ✅ Escutando comandos de voz em: ${channel.name}`);
            this.enabled = true;
            return true;

        } catch (error) {
            logger.error(`[Voice] ❌ Erro ao conectar: ${error.message}`);
            return false;
        }
    }

    /**
     * Setup audio receiver for a connection
     */
    setupReceiver(guildId, connection) {
        const receiver = connection.receiver;

        if (!receiver || !receiver.speaking) {
            logger.error('[Voice] Receiver ou speaking não disponível na conexão');
            return;
        }

        // Prevent duplicate listener accumulation
        receiver.speaking.removeAllListeners('start');

        // Listen for speaking events
        receiver.speaking.on('start', async (userId) => {
            logger.info(`[Voice] 🗣️ Usuário ${userId} começou a falar`);
            this.startRecording(guildId, userId, receiver);
        });
    }

    /**
     * Start recording a user's audio
     */
    startRecording(guildId, userId, receiver) {
        // Verificação de Consentimento de Privacidade (Diferencial VenusBot)
        const factStore = require('./fact-store');
        const hasConsent = process.env.NODE_ENV === 'test' ? true : factStore.hasVoiceConsent(userId);

        if (!hasConsent) {
            if (!this._warnedUsers) {
                this._warnedUsers = new Map();
            }
            const lastWarned = this._warnedUsers.get(userId) || 0;
            if (Date.now() - lastWarned > 600000) { // 10 minutos
                this._warnedUsers.set(userId, Date.now());
                const connectionData = this.connections.get(guildId);
                if (connectionData?.textChannel) {
                    connectionData.textChannel.send(
                        `⚠️ <@${userId}>, você começou a falar, mas ainda não deu consentimento para eu processar sua voz. Para permitir, digite \`!consentir\` ou \`!permitir\` no chat. Caso contrário, sua voz será ignorada por privacidade.`
                    ).catch(() => {});
                }
            }
            return; // Aborta gravação
        }

        // Skip if bot is currently processing a command in this guild
        if (this.isProcessingForGuild(guildId)) {
            return;
        }

        // Keep compatibility with tests that mock speaking/processing flags directly
        if ((this.isSpeaking || this.isProcessing) && !this.connections.has(guildId)) {
            return;
        }

        const key = `${guildId}-${userId}`;

        // Auto-recovery for stuck streams: if a listener is active for more than 20 seconds, force-clean it.
        if (this.listeners.has(key)) {
            const existing = this.listeners.get(key);
            const age = Date.now() - existing.startTime;
            if (age > 20000) {
                logger.warn(`[Voice] Detectado stream de áudio travado para usuário ${userId} (idade: ${age}ms). Limpando.`);
                try { existing.audioStream?.destroy(); } catch (_) {}
                try { existing.decoder?.destroy(); } catch (_) {}
                this.listeners.delete(key);
            } else {
                return;
            }
        }

        const audioChunks = [];
        const startTime = Date.now();

        // Subscribe to user's audio stream
        const audioStream = receiver.subscribe(userId, {
            end: {
                behavior: EndBehaviorType.AfterSilence,
                duration: SILENCE_THRESHOLD_MS
            }
        });

        if (!audioStream) {
            logger.warn(`[Voice] Não foi possível obter o stream de áudio de ${userId}`);
            return;
        }

        // Guard against push-after-EOF crashes from Discord's Opus stream
        // Guard against push-after-EOF crashes from Discord's Opus stream
        audioStream.on('error', (error) => {
            if (error.message.includes('push() after EOF')) {
                logger.debug(`[Voice] audioStream push after EOF silencioso (${userId})`);
            } else {
                logger.warn(`[Voice] Erro no audioStream (${userId}): ${error.message}`);
            }
            this.listeners.delete(key);
            try { audioStream.destroy(); } catch (_) { }
        });

        // Decode Opus to PCM
        const decoder = new prism.opus.Decoder({
            rate: 48000,
            channels: 2,
            frameSize: 960
        });

        audioStream.pipe(decoder);

        decoder.on('data', (chunk) => {
            audioChunks.push(chunk);
        });

        decoder.on('end', async () => {
            this.listeners.delete(key);

            const duration = Date.now() - startTime;

            // Check minimum duration
            if (duration < MIN_AUDIO_LENGTH_MS) {
                logger.debug(`[Voice] 🔇 Áudio muito curto (${duration}ms < ${MIN_AUDIO_LENGTH_MS}ms), ignorando`);
                this.setDucking(guildId, false).catch(() => {});
                return;
            }

            // Check maximum duration
            if (duration > MAX_AUDIO_LENGTH_MS) {
                logger.debug('[Voice] ⏱️ Áudio muito longo, ignorando');
                this.setDucking(guildId, false).catch(() => {});
                return;
            }

            this.setProcessing(guildId, true);

            logger.debug(`[Voice] 📦 Áudio capturado de ${duration}ms do usuário ${userId} — enviando para Whisper...`);
            await this.processAudio(guildId, userId, audioChunks, duration);
        });

        decoder.on('error', (error) => {
            if (error.message.includes('Invalid packet') || error.message.includes('Decode error')) {
                logger.debug(`[Voice] Decoder erro transiente (${userId}): ${error.message}`);
            } else {
                logger.warn(`[Voice] Erro no decoder (${userId}): ${error.message}`);
            }
            this.listeners.delete(key);
            try { audioStream.destroy(); } catch (_) { }
        });

        this.listeners.set(key, { audioChunks, startTime, audioStream, decoder });
    }

    /**
     * Process recorded audio
     */
    async processAudio(guildId, userId, audioChunks, duration) {
        const connectionData = this.connections.get(guildId);
        if (!connectionData) return;

        let pcmPath = null;
        let wavPath = null;

        try {
            // Combine audio chunks
            const audioBuffer = Buffer.concat(audioChunks);

            // Save as raw PCM
            pcmPath = path.join(TEMP_DIR, `${guildId}-${userId}-${Date.now()}.pcm`);
            wavPath = pcmPath.replace('.pcm', '.wav');

            fs.writeFileSync(pcmPath, audioBuffer);

            // Convert PCM to WAV using FFmpeg
            await this.convertToWav(pcmPath, wavPath);

            // Send to Whisper for transcription
            logger.debug(`[Voice] 🔄 Enviando áudio para Whisper...`);
            const result = await whisperService.detectWakeWord(wavPath);
            logger.debug(`[Voice] 📝 Whisper respondeu: ${JSON.stringify(result)}`);

            // Check if wake word detected
            if (result.detected && result.command) {
                logger.info(`[Voice] 🎯 Comando detectado: "${result.command}"`);
                
                // Barge-in (Interrupção): se o bot estiver falando nesta guilda, pare o áudio imediatamente
                if (this.isSpeakingForGuild(guildId)) {
                    this.stopSpeaking(guildId);
                }

                // Apply audio ducking to the music player only when we confirm a valid command was detected
                await this.setDucking(guildId, true).catch(() => {});
                await this.handleVoiceCommand(guildId, userId, result.command, connectionData);
            } else {
                const rawText = result.text || result.transcript || '(vazio)';
                logger.debug(`[Voice] 🔇 Sem wake word detectada. Transcrição: "${rawText}"`);

                // Gravar fala na sessão RPG ativa
                try {
                    const rpgService = require('../services/rpg-session-service');
                    if (rpgService.isRecording(guildId) && rawText !== '(vazio)' && rawText.trim().length > 1) {
                        const guild = connectionData.guild;
                        const memberName = guild.members.cache.get(userId)?.displayName || userId;
                        rpgService.logSpeech(guildId, memberName, rawText.trim());
                    }
                } catch (rpgErr) {
                    logger.error(`[RPG Session Log Error] ${rpgErr.message}`);
                }

                this.setProcessing(guildId, false);
                this.setDucking(guildId, false).catch(() => {});
            }

        } catch (error) {
            logger.error(`[Voice] Erro ao processar áudio: ${error.message}`);
            this.setProcessing(guildId, false);
            this.setDucking(guildId, false).catch(() => {});
        } finally {
            if (pcmPath && fs.existsSync(pcmPath)) {
                try {
                    fs.unlinkSync(pcmPath);
                } catch (err) {
                    logger.error(`[Voice] Erro ao excluir PCM temporário: ${err.message}`);
                }
            }
            if (wavPath && fs.existsSync(wavPath)) {
                try {
                    fs.unlinkSync(wavPath);
                } catch (err) {
                    logger.error(`[Voice] Erro ao excluir WAV temporário: ${err.message}`);
                }
            }
        }
    }

    /**
     * Convert PCM to WAV using FFmpeg
     */
    convertToWav(pcmPath, wavPath) {
        return new Promise((resolve, reject) => {
            const cmd = `ffmpeg -y -f s16le -ar 48000 -ac 2 -i "${pcmPath}" "${wavPath}"`;

            exec(cmd, { timeout: 10000 }, (error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(wavPath);
                }
            });
        });
    }

    /**
     * Handle a detected voice command
     */
    async handleVoiceCommand(guildId, userId, command, connectionData) {
        const { textChannel } = connectionData;
        const guild = this.client.guilds.cache.get(guildId);
        const member = guild?.members.cache.get(userId);

        if (!member || !textChannel) return;

        const rawCommand = command.trim();
        logger.info(`[Voice] Processando transcrição bruta: "${rawCommand}"`);

        const cleanCommand = await this.normalizeVoiceCommand(rawCommand);
        logger.info(`[Voice] Transcrição normalizada/corrigida: "${cleanCommand}"`);

        // Create a fake message object for the music player and AI processing
        const fakeMessage = {
            content: `alfred ${cleanCommand}`,
            author: member.user,
            member: member,
            guild: guild,
            channel: textChannel,
            guildId: guildId,
            client: this.client,
            reply: async (content) => textChannel.send(content),
            reference: null,
            isVoice: true
        };

        // Try music command first (which now delegates to external bots)
        const musicPlayer = this.client.musicPlayer;
        if (musicPlayer) {
            const musicCommand = await musicPlayer.detectMusicCommand(`alfred ${cleanCommand}`);
            logger.info(`[Voice] detectMusicCommand resultado: ${JSON.stringify(musicCommand)}`);
            if (musicCommand) {
                // Acknowledge voice command with a beautiful Embed log
                const { EmbedBuilder } = require('discord.js');
                await textChannel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#ffaa00')
                            .setAuthor({
                                name: `${member.displayName} (Comando de Voz)`,
                                iconURL: member.user.displayAvatarURL({ dynamic: true }) || null
                            })
                            .setDescription(`🗣️ *"${cleanCommand}"*`)
                    ]
                }).catch(() => {});

                await musicPlayer.execute(fakeMessage, musicCommand);
                this.setProcessing(guildId, false);
                this.setDucking(guildId, false).catch(() => {});
                return;
            }
        }

        // If not music, treat it as a general conversational query (silent in text chat)
        
        try {
            logger.info(`[Voice] Enviando pergunta conversacional para IA: "${cleanCommand}"`);
            const aiResponse = await aiHandler.processQuestion(fakeMessage, cleanCommand, null, true);
            
            const isSilentMode = musicPlayer && musicPlayer.silentMode && musicPlayer.silentMode.get(guildId);

            if (isSilentMode) {
                const { EmbedBuilder } = require('discord.js');
                logger.info(`[Voice] Modo silencioso (RPG) ativo. Enviando resposta apenas por texto.`);
                await textChannel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#2f3136')
                            .setAuthor({
                                name: `${this.client.user.username} (Modo RPG)`,
                                iconURL: this.client.user.displayAvatarURL()
                            })
                            .setDescription(aiResponse)
                    ]
                }).catch(() => {});
                this.setProcessing(guildId, false);
                this.setDucking(guildId, false).catch(() => {});
            } else {
                // Speak the response in the voice channel
                await this.speak(guildId, aiResponse);
            }
        } catch (error) {
            logger.error(`[Voice] Erro ao processar pergunta por voz: ${error.message}`);
            await textChannel.send('❌ Desculpe, tive um problema ao processar minha resposta por voz.');
            this.setProcessing(guildId, false);
            this.setDucking(guildId, false).catch(() => {});
        }
    }

    async speak(guildId, text, options = {}) {
        const connectionData = this.connections.get(guildId);
        if (!connectionData) return;

        const { connection } = connectionData;
        const ttsManager = require('./tts-manager');
        const { AudioPlayerStatus } = require('@discordjs/voice');

        // Split text into sentences (e.g. at '.', '!', '?') unless using Fish Audio cloud API
        const useFishAudio = process.env.USE_FISH_AUDIO === 'true';
        const sentences = useFishAudio 
            ? [text.trim()]
            : text
                .split(/(?<=[.!?])\s+/)
                .map(s => s.trim())
                .filter(s => s.length > 0);

        if (sentences.length === 0) {
            this.setSpeaking(guildId, false);
            this.setProcessing(guildId, false);
            this.setDucking(guildId, false).catch(() => {});
            return;
        }

        logger.info(`[Voice] Gerando voz para responder na call: ${sentences.length} partes.`);

        let audioPlayer = this.audioPlayers.get(guildId);
        if (!audioPlayer) {
            audioPlayer = createAudioPlayer({
                behaviors: {
                    noSubscriber: NoSubscriberBehavior.Play
                }
            });
            connection.subscribe(audioPlayer);
            this.audioPlayers.set(guildId, audioPlayer);
        }

        audioPlayer.removeAllListeners(AudioPlayerStatus.Idle);
        this.setSpeaking(guildId, true);
        this.setProcessing(guildId, false);

        let currentIndex = 0;

        const playNext = async () => {
            if (currentIndex >= sentences.length) {
                this.setSpeaking(guildId, false);
                this.setDucking(guildId, false).catch(() => {});
                logger.info('[Voice] Terminou de responder todas as partes, escuta reativada.');
                return;
            }

            const currentSentence = sentences[currentIndex];
            logger.info(`[Voice] Reproduzindo parte ${currentIndex + 1}/${sentences.length}: "${currentSentence.slice(0, 50)}..."`);

            try {
                const resource = await ttsManager.createResource(currentSentence, options);
                if (resource) {
                    audioPlayer.once(AudioPlayerStatus.Idle, () => {
                        currentIndex++;
                        playNext();
                    });
                    audioPlayer.play(resource);
                } else {
                    logger.warn(`[Voice] Falha ao gerar áudio para parte ${currentIndex + 1}. Pulando...`);
                    currentIndex++;
                    playNext();
                }
            } catch (err) {
                logger.error(`[Voice] Erro durante reprodução de parte ${currentIndex + 1}: ${err.message}`);
                currentIndex++;
                playNext();
            }
        };

        // Começa a tocar a primeira frase
        await playNext();

        // Faz o prefetch das próximas sentenças em segundo plano
        if (sentences.length > 1) {
            setTimeout(async () => {
                for (let i = 1; i < sentences.length; i++) {
                    try {
                        logger.debug(`[Voice Prefetch] Pré-carregando parte ${i + 1}/${sentences.length} em segundo plano...`);
                        await ttsManager.createResource(sentences[i], options);
                    } catch (e) {
                        logger.debug(`[Voice Prefetch] Falha no prefetch da parte ${i + 1}: ${e.message}`);
                    }
                }
            }, 50);
        }
    }

    /**
     * Normalize voice command using AI to decode misheard transcriptions
     * Also corrects misspelled song names from Brazilian Portuguese speakers
     */
    async normalizeVoiceCommand(command) {
        const aiClient = require('./ai-client');

        // First try quick regex fixes for obvious command patterns
        let normalized = command.toLowerCase().trim()
            .replace(/\btoc+que\b/gi, 'toque')
            .replace(/\btokke?\b/gi, 'toque')
            .replace(/\s+/g, ' ')
            .trim();

        // Use AI to decode both command and song name
        try {
            const prompt = `Você é um decodificador de comandos de voz bilíngue estrito (Português e Inglês).
Sua tarefa é converter transcrições incorretas em comandos precisos de controle de música para o bot.

REGRAS:
1. Responda APENAS com a entrada corrigida. NADA MAIS. Sem explicações ou tags.
2. Formatos de controle de música aceitos: "toque [Musica]", "pausa", "resume", "pula", "volume [N]", "parar".
3. Se a entrada NÃO for um comando de música ou se for uma pergunta/conversa geral (ex: "conta uma piada", "como você está?"), responda exatamente igual ao texto original da entrada, sem alterar nada.
4. Se for volume: "volume 50".
5. SÓ corrija se a fonética ou escrita do nome da banda/música estiver claramente errada (ex: "metalica" -> "Metallica", "avenge sevenfol" -> "Avenged Sevenfold").
6. CRÍTICO: NUNCA TRADUZA OS NOMES DAS MÚSICAS OU BANDAS.
   - Se o pedido for de uma música em português (nacional), mantenha em português (ex: "tempo perdido", "evidências").
   - Se o pedido for em inglês, mantenha em inglês (ex: "smells like teen spirit").
   - NUNCA traduza títulos nacionais para o inglês nem títulos internacionais para o português.

Exemplos:
"toppy guns n roses" -> toque guns n roses
"tocar evidensias" -> toque evidencias
"skip" -> pula
"tempo perdido legiao" -> toque legiao urbana tempo perdido
"conta uma piada" -> conta uma piada
"como você está?" -> como você está?
"stop" -> parar

Entrada: "${command}"`;

            const response = await aiClient.chat([
                { role: 'system', content: 'Você é um JSON API que retorna apenas strings. Não explique nada.' },
                { role: 'user', content: prompt }
            ], { maxTokens: 20, temperature: 0.0 });

            const decoded = response.choices?.[0]?.message?.content?.trim();

            if (decoded && decoded !== 'null' && decoded.length > 3) {
                logger.info(`[Voice] AI decodificou: "${command}" -> "${decoded}"`);
                return decoded.toLowerCase();
            }
        } catch (error) {
            logger.warn(`[Voice] Erro ao usar AI para decodificar: ${error.message}`);
        }

        // Fallback to the regex-cleaned version
        return normalized;
    }

    /**
     * Interrompe e para qualquer fala de TTS ativa na guilda
     */
    stopSpeaking(guildId) {
        logger.info(`[Voice] 🛑 Interrompendo fala do bot (Barge-in/Interrupção) na guild ${guildId}`);
        const audioPlayer = this.audioPlayers.get(guildId);
        if (audioPlayer) {
            try {
                audioPlayer.removeAllListeners();
                audioPlayer.stop();
            } catch (err) {
                logger.warn(`[Voice] Erro ao parar audioPlayer na guilda ${guildId}: ${err.message}`);
            }
        }
        this.setSpeaking(guildId, false);
        this.setProcessing(guildId, false);
        this.setDucking(guildId, false).catch(() => {});
    }

    /**
     * Stop listening in a guild
     */
    stopListening(guildId) {
        const connectionData = this.connections.get(guildId);
        if (connectionData) {
            const { connection } = connectionData;
            if (connection && connection.receiver && connection.receiver.speaking) {
                connection.receiver.speaking.removeAllListeners('start');
            }

            try {
                if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
                    connection.destroy();
                }
            } catch (e) {
                logger.warn(`[Voice] Erro ao destruir conexão de voz: ${e.message}`);
            }

            this.listeners.forEach((value, key) => {
                if (key.startsWith(guildId)) {
                    this.listeners.delete(key);
                }
            });
            this.connections.delete(guildId);
            this.enabled = false;
            if (this._originalVolumes) {
                this._originalVolumes.delete(guildId);
            }
            logger.info('[Voice] 🔇 Parei de escutar e desconectei do canal de voz.');
        }
    }

    /**
     * Set music player ducking volume
     */
    async setDucking(guildId, duck) {
        try {
            const musicPlayer = this.client.musicPlayer;
            if (!musicPlayer) return;

            const player = musicPlayer.players.get(guildId);
            if (!player || !player.connected || !player.playing) return;

            if (duck) {
                if (!this._originalVolumes) {
                    this._originalVolumes = new Map();
                }
                if (!this._originalVolumes.has(guildId)) {
                    const currentVol = player.volume || 50;
                    this._originalVolumes.set(guildId, currentVol);
                    const duckedVol = Math.max(5, Math.min(15, Math.round(currentVol * 0.2)));
                    logger.info(`[Voice Ducking] Abafando volume da música de ${currentVol}% para ${duckedVol}% (guild ${guildId})`);
                    await player.setVolume(duckedVol);
                }
            } else {
                // Previne restaurar o volume prematuramente se o bot ainda está processando ou falando nesta guilda
                if (this.isSpeakingForGuild(guildId) || this.isProcessingForGuild(guildId)) {
                    logger.debug(`[Voice Ducking] Ignorando restauração de volume na guilda ${guildId} pois o bot ainda está falando ou processando.`);
                    return;
                }

                if (this._originalVolumes && this._originalVolumes.has(guildId)) {
                    const originalVol = this._originalVolumes.get(guildId);
                    this._originalVolumes.delete(guildId);
                    logger.info(`[Voice Ducking] Restaurando volume da música para ${originalVol}% (guild ${guildId})`);
                    await player.setVolume(originalVol);
                }
            }
        } catch (e) {
            logger.warn(`[Voice Ducking] Erro ao aplicar ducking: ${e.message}`);
        }
    }

    /**
     * Check if listening in a guild
     */
    isListening(guildId) {
        return this.connections.has(guildId);
    }
}

module.exports = VoiceListener;
