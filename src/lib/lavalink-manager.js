/**
 * 🎵 Alfred Lavalink Manager (Shoukaku 4.x)
 * 
 * Gerenciador de música usando Shoukaku 4.x + Lavalink 4.x
 * IMPORTANTE: Shoukaku 4.x não aceita nodes no construtor!
 * - nodes vão em .addNode() após Discord ready
 */

const { Shoukaku, Connectors } = require('shoukaku');
const { EmbedBuilder } = require('discord.js');
const logger = require('./logger');

const { prepareSearchQuery } = require('./music-utils');
const ytFallback = require('./youtube-fallback');

class LavalinkManager {
    constructor() {
        this.shoukaku = null;
        this.client = null;
        this.initialized = false;
        this.queues = new Map(); // guildId -> { tracks: [], current: null }
    }

    /**
     * Inicializa o Shoukaku
     * DEVE ser chamado ANTES de client.login()
     */
    init(client) {
        this.client = client;

        const host = process.env.LAVALINK_HOST || 'localhost';
        const port = process.env.LAVALINK_PORT || '2333';
        const password = process.env.LAVALINK_PASSWORD || 'alfredmusicbot2026';

        logger.info(`[Lavalink] Configurando para ${host}:${port}`);

        const nodeInfo = {
            name: 'Alfred-Node',
            url: `${host}:${port}`,
            auth: password,
            secure: false
        };

        // Função para criar Shoukaku INTEIRO após ready
        const createShoukaku = () => {
            logger.info(`[Lavalink] Criando Shoukaku (userId: ${client.user?.id})...`);

            // Shoukaku 4.x: Connector + Options, depois addNode
            this.shoukaku = new Shoukaku(
                new Connectors.DiscordJS(client),
                {
                    moveOnDisconnect: false,
                    resumable: false,
                    resumableTimeout: 30,
                    reconnectTries: 5,
                    reconnectInterval: 3000,
                    restTimeout: 60000,
                    userAgent: 'Alfred/1.0.0'
                }
            );

            // Event handlers
            this.shoukaku.on('ready', (name) => {
                logger.success(`Lavalink Node "${name}" conectado!`);
                this.initialized = true;
            });

            this.shoukaku.on('error', (name, error) => {
                logger.error(`[Lavalink] ERRO no node "${name}": ${error.message}`);
            });

            this.shoukaku.on('close', (name, code, reason) => {
                logger.warn(`[Lavalink] Node "${name}" fechado - Code: ${code}`);
                this.initialized = false;
            });

            this.shoukaku.on('disconnect', (name, count) => {
                logger.warn(`[Lavalink] Node "${name}" desconectado ${count}x`);
                this.initialized = false;
            });

            this.shoukaku.on('debug', (name, info) => {
                logger.info(`[Lavalink Debug] ${name}: ${info}`);
            });

            // FIX: Manualmente definir manager.id (normalmente setado por Connector.ready())
            // Isso é necessário quando usamos addNode manualmente
            this.shoukaku.id = client.user.id;

            // Agora adiciona o node
            logger.info('[Lavalink] Adicionando node...');
            this.shoukaku.addNode(nodeInfo);
        };

        // Shoukaku E Connector devem ser criados APÓS Discord ready
        if (client.isReady() && client.user) {
            createShoukaku();
        } else {
            client.once('ready', () => {
                // Pequeno delay para garantir que tudo está estável
                setTimeout(() => createShoukaku(), 500);
            });
        }

        logger.info('[Lavalink] Manager inicializado');
        return this;
    }

    // ============================================
    // Helpers
    // ============================================

    async joinVoiceChannel(guildId, channelId, shardId = 0) {
        // Handoff: Se VoiceListener estiver ativo, pare-o para liberar a conexão
        if (this.client.voiceListener) {
            this.client.voiceListener.stopListening(guildId);
        }

        const node = this.shoukaku.getIdealNode();
        if (!node) throw new Error('Nenhum node Lavalink disponível');

        // Shoukaku 4.x: use shoukaku.joinVoiceChannel
        return await this.shoukaku.joinVoiceChannel({
            guildId,
            channelId,
            shardId,
            deaf: true
        });
    }

    // ============================================
    // NLP Detection
    // ============================================

    detectMusicCommand(content) {
        const text = content.toLowerCase().trim();
        const originalContent = content.trim();

        const controls = {
            pause: /^(?:alfred[,!]?\s+)?(?:.*\s+)?(?:pausa|pause|pausar)/i,
            resume: /^(?:alfred[,!]?\s+)?(?:.*\s+)?(?:continua|continue|despaus|volte)/i,
            skip: /^(?:alfred[,!]?\s+)?(?:.*\s+)?(?:pula|pular|skip|próxima|next)/i,
            skip: /^(?:alfred[,!]?\s+)?(?:.*\s+)?(?:pula|pular|skip|próxima|next)/i,
            stop: /^(?:alfred[,!]?\s+)?(?:.*\s+)?(?:para|parar|pare|stop|chega|sair|sai)(?:\s+(?:a|de|o)?\s*(?:música|tocar|som))?(?:!|\.)*$/i,
            join: /^(?:alfred[,!]?\s+)?(?:.*\s+)?(?:entra|entrar|join|call|vem|cola)/i,
            queue: /^(?:alfred[,!]?\s+)?(?:fila|queue|lista)/i,
            volume: /^(?:alfred[,!]?\s+)?(?:volume|vol|v)\s*(\d+)?/i,
            nowplaying: /^(?:alfred[,!]?\s+)?(?:tocando|np|nowplaying|musica atual)/i,
        };

        for (const [action, pattern] of Object.entries(controls)) {
            const match = text.match(pattern);
            if (match) {
                // Return query for volume if present
                if (action === 'volume' && match[1]) {
                    return { action, query: match[1] };
                }
                return { action };
            }
        }

        const playPatterns = [
            /^(?:alfred[,!]?\s+)?(?:toca|toque|coloca|bota|põe|poe|play|tocar)\s+(.+)$/i,
            /^(?:alfred[,!]?\s+)?(?:quero (?:ouvir|escutar))\s+(.+)$/i,
        ];

        for (const pattern of playPatterns) {
            const match = originalContent.match(pattern);
            if (match && match[1]) {
                const query = match[1].trim();
                if (query.length > 2) {
                    return { action: 'play', query };
                }
            }
        }

        return null;
    }

    // ============================================
    // Music Commands
    // ============================================

    async play(message, query) {
        const voiceChannel = message.member?.voice?.channel;
        if (!voiceChannel) {
            return message.reply('❌ Você precisa estar em um canal de voz!');
        }

        if (!this.initialized) {
            return message.reply('❌ Lavalink não conectado. Aguarde ou verifique se o servidor está rodando.');
        }

        const node = this.shoukaku.getIdealNode();
        if (!node) {
            return message.reply('❌ Nenhum node Lavalink disponível.');
        }

        const searchMsg = await message.reply(`🔍 Buscando: **${query}**...`);

        try {
            // Buscar música
            const searchQuery = prepareSearchQuery(query);
            logger.debug(`[Lavalink] Busca Preparada: "${searchQuery}"`);

            let searchResult = await node.rest.resolve(searchQuery);
            logger.debug(`[Lavalink] Busca: "${searchQuery}" | LoadType: ${searchResult?.loadType}`);

            let tracks = [];
            let playlistName = null;

            // Normalização de Resposta Lavalink v4
            switch (searchResult?.loadType) {
                case 'search':
                case 'SEARCH_RESULT': // Compatibilidade
                    tracks = searchResult.data || searchResult.tracks;
                    break;

                case 'track':
                case 'TRACK_LOADED': // Compatibilidade
                    tracks = [searchResult.data || searchResult.tracks[0]];
                    break;

                case 'playlist':
                case 'PLAYLIST_LOADED': // Compatibilidade
                    tracks = searchResult.data?.tracks || searchResult.tracks;
                    playlistName = searchResult.data?.info?.name || searchResult.playlistInfo?.name;
                    break;

                case 'empty':
                case 'NO_MATCHES':
                    tracks = [];
                    break;

                case 'error':
                case 'LOAD_FAILED':
                    // Tratar erro
                    const err = searchResult.data || searchResult.exception;
                    logger.error(`[Lavalink] Erro: ${JSON.stringify(err)}`);
                    return searchMsg.edit(`❌ Erro no Lavalink: ${err?.message || 'Erro desconhecido'}`);
            }

            if (!tracks || tracks.length === 0) {
                logger.warn(`[Lavalink] Nenhum resultado para: ${searchQuery}. Tentando fallback yt-dlp...`);

                try {
                    const ytResults = await ytFallback.search(query, 1);
                    if (ytResults.length > 0) {
                        const firstResult = ytResults[0];
                        logger.info(`[Fallback] Encontrado via yt-dlp: ${firstResult.title}`);

                        // Obter URL direta de stream
                        const streamUrl = await ytFallback.getStreamUrl(firstResult.id);

                        // Resolver URL direta no Lavalink
                        const fallbackResult = await node.rest.resolve(streamUrl);

                        if (fallbackResult && fallbackResult.loadType !== 'empty' && fallbackResult.loadType !== 'error') {
                            // Sucesso no fallback!
                            searchResult = fallbackResult;

                            // Normalizar novamente (igual ao switch acima)
                            if (searchResult.loadType === 'track' || searchResult.loadType === 'TRACK_LOADED') {
                                tracks = [searchResult.data || searchResult.tracks[0]];
                            } else {
                                tracks = searchResult.data || searchResult.tracks;
                            }
                            if (tracks && tracks[0]) {
                                // Injetar metadados corretos (já que o stream direto pode não ter)
                                tracks[0].info.title = firstResult.title;
                                tracks[0].info.author = firstResult.author;
                                tracks[0].info.uri = firstResult.url;
                                tracks[0].info.artworkUrl = firstResult.thumbnail;
                            }
                        }
                    }
                } catch (err) {
                    logger.error(`[Fallback] Falhou: ${err.message}`);
                }

                if (!tracks || tracks.length === 0) {
                    logger.warn(`[Lavalink] Falha total para: ${searchQuery}`);
                    return searchMsg.edit(`❌ Não encontrei nada para: **${query}**`);
                }
            }

            // Obter ou criar player
            let player = this.shoukaku.players.get(message.guild.id);

            if (!player) {
                player = await this.joinVoiceChannel(
                    message.guild.id,
                    voiceChannel.id,
                    message.guild.shardId
                );

                // Eventos do player
                player.on('end', () => {
                    this.playNext(message.guild.id);
                });

                player.on('exception', (data) => {
                    logger.error(`[Lavalink] Erro no player: ${data.message || data}`);
                    this.playNext(message.guild.id);
                });

                player.on('stuck', () => {
                    logger.warn('[Lavalink] Player travou, pulando...');
                    player.stopTrack();
                    this.playNext(message.guild.id);
                });

                // Inicializar fila
                this.queues.set(message.guild.id, {
                    tracks: [],
                    current: null,
                    textChannel: message.channel
                });
            }

            const queue = this.queues.get(message.guild.id);
            queue.textChannel = message.channel;

            // Se for playlist, adiciona todas
            if (result.loadType === 'playlist' || result.loadType === 'PLAYLIST_LOADED') {
                for (const t of tracks) {
                    t.requester = message.author;
                    queue.tracks.push(t);
                }
                await searchMsg.edit(`✅ Playlist **${playlistName}** adicionada (${tracks.length} músicas)`);
            } else {
                // Se for single track/search
                const track = tracks[0];
                track.requester = message.author;
                queue.tracks.push(track);
                await searchMsg.edit(`✅ Adicionado: **${track.info.title}**`);
            }

            // Se não estiver tocando, começar
            if (!queue.current) {
                this.playNext(message.guild.id);
            }

        } catch (error) {
            logger.error(`[Lavalink] Erro ao buscar: ${error.message}`);
            return searchMsg.edit(`❌ Erro: ${error.message}`);
        }
    }

    async join(message) {
        const voiceChannel = message.member?.voice?.channel;
        if (!voiceChannel) {
            return message.reply('❌ Você precisa estar em um canal de voz!');
        }

        if (!this.initialized) {
            return message.reply('❌ Lavalink não conectado.');
        }

        const node = this.shoukaku.getIdealNode();
        if (!node) {
            return message.reply('❌ Nenhum node Lavalink disponível.');
        }

        let player = this.shoukaku.players.get(message.guild.id);

        if (player) {
            return message.reply('✅ Já estou conectado!');
        }

        try {
            player = await this.joinVoiceChannel(
                message.guild.id,
                voiceChannel.id,
                message.guild.shardId
            );

            // Eventos do player (crítico para manter estado consistente)
            player.on('end', () => {
                this.playNext(message.guild.id);
            });

            player.on('exception', (data) => {
                logger.error(`[Lavalink] Erro no player: ${data.message || data}`);
                this.playNext(message.guild.id);
            });

            player.on('stuck', () => {
                logger.warn('[Lavalink] Player travou, pulando...');
                player.stopTrack();
                this.playNext(message.guild.id);
            });

            // Inicializar fila
            if (!this.queues.has(message.guild.id)) {
                this.queues.set(message.guild.id, {
                    tracks: [],
                    current: null,
                    textChannel: message.channel
                });
            }

            return message.reply('✅ Conectado! Peça uma música com `alfred toque` ou fale comigo.');

        } catch (error) {
            logger.error(`[Lavalink] Erro ao conectar: ${error.message}`);
            return message.reply(`❌ Erro ao conectar: ${error.message}`);
        }

    }

    playNext(guildId) {
        const queue = this.queues.get(guildId);
        const player = this.shoukaku.players.get(guildId);

        if (!queue || !player) return;

        if (queue.tracks.length === 0) {
            queue.current = null;
            queue.textChannel?.send({
                embeds: [new EmbedBuilder()
                    .setColor('#ffaa00')
                    .setDescription('📭 **A fila acabou!** Adicione mais músicas com `alfred toque`')]
            }).catch(() => { });
            return;
        }

        queue.current = queue.tracks.shift();
        player.playTrack({ encodedTrack: queue.current.encoded });

        // Stats
        if (this.client.stats) this.client.stats.songsPlayed++;

        // Build ProgressBar
        const duration = queue.current.info.length;
        const barLength = 15;
        const totalChars = '▬'.repeat(barLength);
        const progressBar = `▶️ ${'🔘' + '▬'.repeat(barLength - 1)} [00:00/${this.formatDuration(duration)}]`;

        // Create Up Next List
        const nextSongs = queue.tracks.slice(0, 3).map((t, i) =>
            `\`${i + 1}.\` ${t.info.title.substring(0, 40)}${t.info.title.length > 40 ? '...' : ''} **(${this.formatDuration(t.info.length)})**`
        ).join('\n');

        const requester = queue.current.requester;

        // Embed tocando agora "Premium"
        const embed = new EmbedBuilder()
            .setColor('#2b2d31') // Dark premium color
            .setTitle('🎵 Tocando Agora')
            .setDescription(`**[${queue.current.info.title}](${queue.current.info.uri || ''})**\n\n${progressBar}`)
            .addFields(
                { name: '🎤 Artista', value: queue.current.info.author || 'Desconhecido', inline: true },
                { name: '👤 Pedido por', value: requester ? `${requester.username}` : 'Auto', inline: true }
            )
            .setImage(queue.current.info.artworkUrl || null) // Large Image
            .setFooter({ text: 'Alfred Music System • High Quality Audio', iconURL: 'https://i.imgur.com/5IP8V3q.png' })
            .setTimestamp();

        if (nextSongs) {
            embed.addFields({ name: '📝 Próximas na Fila', value: nextSongs, inline: false });
        }

        queue.textChannel?.send({ embeds: [embed] }).catch(() => { });
    }

    async pause(message) {
        const player = this.shoukaku.players?.get(message.guild.id);
        if (!player) return message.reply('❌ Nada tocando!');
        player.setPaused(true);
        return message.reply('⏸️ Pausado!');
    }

    async resume(message) {
        const player = this.shoukaku.players?.get(message.guild.id);
        if (!player) return message.reply('❌ Nada tocando!');
        player.setPaused(false);
        return message.reply('▶️ Despausado!');
    }

    async skip(message) {
        const player = this.shoukaku.players?.get(message.guild.id);
        if (!player) return message.reply('❌ Nada tocando!');
        player.stopTrack();
        return message.reply('⏭️ Pulando...');
    }

    async volume(message, args) {
        const player = this.shoukaku.players?.get(message.guild.id);
        if (!player) return message.reply('❌ Nada tocando!');

        if (!args) {
            const currentVol = Math.floor(player.volume * 100);
            return message.reply(`🔊 Volume atual: **${currentVol}%**`);
        }

        const vol = parseInt(args);
        if (isNaN(vol) || vol < 0 || vol > 200) {
            return message.reply('❌ Use um número entre 0 e 200.');
        }

        await player.setGlobalVolume(vol / 100);
        return message.reply(`🔊 Volume ajustado para **${vol}%**`);
    }

    async nowPlaying(message) {
        const player = this.shoukaku.players?.get(message.guild.id);
        const queue = this.queues.get(message.guild.id);

        if (!player || !queue?.current) {
            return message.reply('❌ Nada tocando agora.');
        }

        const track = queue.current;
        const position = player.position;
        const duration = track.info.length;

        // Progress Bar
        const barLength = 20;
        const progress = Math.min(barLength, Math.floor((position / duration) * barLength));
        const bar = '▬'.repeat(progress) + '🔘' + '▬'.repeat(Math.max(0, barLength - progress));

        const embed = new EmbedBuilder()
            .setColor('#2b2d31')
            .setAuthor({ name: 'Tocando Agora', iconURL: 'https://cdn.discordapp.com/emojis/866637037607845929.gif?v=1' })
            .setDescription(`[**${track.info.title}**](${track.info.uri})`)
            .setThumbnail(track.info.artworkUrl || `https://img.youtube.com/vi/${track.info.identifier}/hqdefault.jpg`)
            .addFields(
                { name: '👤 Autor', value: track.info.author, inline: true },
                { name: '🙋 Pedido por', value: track.requester ? `<@${track.requester.id}>` : 'Sistema', inline: true },
                { name: '⏳ Progresso', value: `\`${bar}\`\n[${this.formatDuration(position)} / ${this.formatDuration(duration)}]`, inline: false }
            )
            .setFooter({ text: 'Alfred Music System', iconURL: this.client.user.displayAvatarURL() });

        message.reply({ embeds: [embed] });
    }

    async stop(message) {
        const player = this.shoukaku.players?.get(message.guild.id);
        if (!player) return message.reply('❌ Nada tocando!');

        await this.shoukaku.leaveVoiceChannel(message.guild.id);
        this.queues.delete(message.guild.id);
        return message.reply('⏹️ Parado!');
    }

    async queue(message) {
        const queue = this.queues.get(message.guild.id);
        if (!queue || (queue.tracks.length === 0 && !queue.current)) {
            return message.reply('📭 Fila vazia.');
        }

        let description = queue.current ? `**Tocando:** ${queue.current.info.title}\n\n` : '';
        description += queue.tracks.slice(0, 10).map((t, i) => `${i + 1}. ${t.info.title}`).join('\n');

        return message.reply({
            embeds: [new EmbedBuilder()
                .setTitle(`📜 Fila (${queue.tracks.length + (queue.current ? 1 : 0)} músicas)`)
                .setDescription(description || 'Vazia')]
        });
    }

    // ============================================
    // Execute Command
    // ============================================

    async execute(message, command) {
        switch (command.action) {
            case 'play':
                return this.play(message, command.query);
            case 'join':
                return this.join(message);
            case 'pause':
                return this.pause(message);
            case 'resume':
                return this.resume(message);
            case 'skip':
                return this.skip(message);
            case 'stop':
                return this.stop(message);
            case 'queue':
                return this.queue(message);
            case 'volume':
                return this.volume(message, command.query);
            case 'nowplaying':
                return this.nowPlaying(message);
            default:
                return message.reply('❌ Comando não reconhecido.');
        }
    }

    // ============================================
    // Utilities
    // ============================================

    formatDuration(ms) {
        if (!ms) return '??:??';
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}:${(minutes % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
        }
        return `${minutes}:${(seconds % 60).toString().padStart(2, '0')}`;
    }
}

module.exports = LavalinkManager;
