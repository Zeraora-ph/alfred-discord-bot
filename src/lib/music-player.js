/**
 * 🎵 Alfred Music Player - Sistema de Música Reconstruído
 * 
 * Features:
 * - Detecção de linguagem natural avançada
 * - Embeds visuais com capa e progresso
 * - Sistema de playlists personalizadas
 * - Busca por gênero e mood
 * - Comandos de voz com Whisper
 * - Correção inteligente de queries com IA
 */

const { Player, QueryType } = require('discord-player');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const logger = require('./logger');
const path = require('path');
const fs = require('fs');

// ============================================
// AI Query Correction
// ============================================

/**
 * Corrige erros de transcrição usando IA
 * Ex: "vintage 7 fold" → "Avenged Sevenfold"
 */
async function correctMusicQuery(query) {
  try {
    const aiClient = require('./ai-client');

    const prompt = `Você é um especialista em música. Corrija erros de transcrição de voz para nomes de bandas/músicas.

ENTRADA: "${query}"

Se parecer um nome de banda/música mal transcrito, corrija para o nome correto.
Se já estiver correto ou não reconhecer, retorne exatamente igual.

Exemplos:
- "vintage 7 fold" → "Avenged Sevenfold"
- "a avenger de sevenfold" → "Avenged Sevenfold"
- "metalica" → "Metallica"
- "guns n roses" → "Guns N Roses" (já correto)
- "nirvana smells like teen spirit" → já correto

RESPONDA APENAS COM O NOME CORRIGIDO, SEM EXPLICAÇÃO:`;

    const response = await aiClient.chat([
      { role: 'user', content: prompt }
    ], { temperature: 0.1, maxTokens: 50 });

    const corrected = response.choices?.[0]?.message?.content?.trim();

    if (corrected && corrected.length > 2 && corrected.length < 100) {
      if (corrected.toLowerCase() !== query.toLowerCase()) {
        logger.info(`[Música] IA corrigiu: "${query}" → "${corrected}"`);
      }
      return corrected;
    }

    return query;
  } catch (error) {
    logger.warn('[Música] Erro na correção IA, usando query original:', error.message);
    return query;
  }
}

// ============================================
// Playlist Storage
// ============================================

const PLAYLISTS_FILE = path.join(__dirname, '../../data/playlists.json');

function loadPlaylists() {
  try {
    if (fs.existsSync(PLAYLISTS_FILE)) {
      return JSON.parse(fs.readFileSync(PLAYLISTS_FILE, 'utf8'));
    }
  } catch (e) {
    logger.warn('[Música] Erro ao carregar playlists:', e.message);
  }
  return {};
}

function savePlaylists(playlists) {
  try {
    const dir = path.dirname(PLAYLISTS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(PLAYLISTS_FILE, JSON.stringify(playlists, null, 2));
  } catch (e) {
    logger.error('[Música] Erro ao salvar playlists:', e.message);
  }
}

// ============================================
// Music Player Class
// ============================================

class AlfredMusicPlayer {
  constructor(client) {
    this.client = client;
    this.player = null;
    this.initialized = false;
    this.playlists = loadPlaylists();
    this.voiceListener = null;
  }

  // ============================================
  // Initialization
  // ============================================

  async initialize() {
    try {
      this.player = new Player(this.client, {
        ytdlOptions: {
          quality: 'highestaudio',
          highWaterMark: 1 << 25
        }
      });

      // Load extractors (nova API do discord-player)
      const { DefaultExtractors } = require('@discord-player/extractor');
      await this.player.extractors.loadMulti(DefaultExtractors);

      // Setup event listeners
      this.setupEvents();

      this.initialized = true;
      logger.info('[Música] 🎵 Sistema de música inicializado!');
    } catch (error) {
      logger.error('[Música] Erro ao inicializar:', error);
      throw error;
    }
  }

  setupEvents() {
    // Track started
    this.player.events.on('playerStart', async (queue, track) => {
      const channel = queue.metadata.channel;
      const embed = this.createNowPlayingEmbed(track, queue);
      await channel.send({ embeds: [embed] });
    });

    // Track added to queue
    this.player.events.on('audioTrackAdd', async (queue, track) => {
      const channel = queue.metadata.channel;
      if (queue.tracks.size > 0) {
        const embed = new EmbedBuilder()
          .setColor('#00ff00')
          .setTitle('➕ Adicionado à Fila')
          .setDescription(`**${track.title}** - ${track.author}`)
          .setThumbnail(track.thumbnail)
          .setFooter({ text: `Posição na fila: ${queue.tracks.size}` });
        await channel.send({ embeds: [embed] });
      }
    });

    // Queue ended
    this.player.events.on('emptyQueue', async (queue) => {
      const channel = queue.metadata.channel;
      const embed = new EmbedBuilder()
        .setColor('#ff9900')
        .setTitle('🎵 Fila Finalizada')
        .setDescription('Acabaram as músicas! Use **alfred toque [música]** para continuar.')
        .setTimestamp();
      await channel.send({ embeds: [embed] });
    });

    // Player error
    this.player.events.on('playerError', async (queue, error) => {
      logger.error('[Música] Erro no player:', error);
      const channel = queue.metadata.channel;
      const embed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('❌ Erro na Reprodução')
        .setDescription('Deu ruim ao tocar essa música. Tentando próxima...')
        .setTimestamp();
      await channel.send({ embeds: [embed] });
    });

    // Stream error (yt-dlp crashes, etc)
    this.player.events.on('playerError', (queue, error) => {
      logger.error(`[Música] Erro no player (Stream): ${error.message}`);
      // Don't crash, just log. Queue usually skips to next.
    });

    // General error
    this.player.events.on('error', (queue, error) => {
      logger.error('[Música] Erro geral:', error);
    });
  }

  // ============================================
  // Embed Builders
  // ============================================

  createNowPlayingEmbed(track, queue) {
    const embed = new EmbedBuilder()
      .setColor('#1DB954') // Spotify green
      .setTitle('🎵 Tocando Agora')
      .setDescription(`**${track.title}**`)
      .addFields(
        { name: '🎤 Artista', value: track.author || 'Desconhecido', inline: true },
        { name: '⏱️ Duração', value: track.duration || 'N/A', inline: true },
        { name: '👤 Pedido por', value: `${track.requestedBy}`, inline: true }
      )
      .setThumbnail(track.thumbnail)
      .setTimestamp();

    // Add progress bar if available
    try {
      const progress = queue.node.createProgressBar();
      if (progress) {
        embed.addFields({ name: '📊 Progresso', value: progress, inline: false });
      }
    } catch (e) {
      // Progress bar may not be available
    }

    // Add queue info
    if (queue.tracks.size > 0) {
      embed.setFooter({ text: `${queue.tracks.size} música(s) na fila` });
    }

    return embed;
  }

  createQueueEmbed(queue) {
    const current = queue.currentTrack;
    const tracks = queue.tracks.toArray();

    const embed = new EmbedBuilder()
      .setColor('#7289DA')
      .setTitle('📋 Fila de Músicas')
      .setTimestamp();

    if (current) {
      embed.addFields({
        name: '🎵 Tocando Agora',
        value: `**${current.title}** - ${current.author}\n⏱️ ${current.duration}`,
        inline: false
      });
    }

    if (tracks.length > 0) {
      const upNext = tracks.slice(0, 10).map((t, i) =>
        `**${i + 1}.** ${t.title.substring(0, 40)}${t.title.length > 40 ? '...' : ''} - ${t.author}`
      ).join('\n');

      embed.addFields({
        name: '📋 Próximas',
        value: upNext,
        inline: false
      });

      if (tracks.length > 10) {
        embed.setFooter({ text: `...e mais ${tracks.length - 10} músicas` });
      }
    } else {
      embed.setDescription('Não tem mais músicas na fila.');
    }

    return embed;
  }

  // ============================================
  // NLP Detection
  // ============================================

  detectMusicCommand(text) {
    const content = text.trim();
    const lower = content.toLowerCase();

    // === PLAY PATTERNS ===
    const playPatterns = [
      // Basic play
      /^(?:alfred[,!]?\s+)?(?:toca|toque|coloca|bota|põe|poe|play|tocar)\s+(.+)$/i,
      /^(?:alfred[,!]?\s+)?(?:música|musica)\s+(.+)$/i,
      /^(?:alfred[,!]?\s+)?(?:quero (?:ouvir|escutar))\s+(.+)$/i,
      /^(?:alfred[,!]?\s+)?(?:manda|solta|mete)\s+(?:um|uma|o|a)?\s*(.+)$/i,
      // Without explicit command - just artist/song mentioned with Alfred
      /^alfred[,!]?\s+(.+?)\s*$/i,
    ];

    for (const pattern of playPatterns) {
      const match = content.match(pattern);
      if (match && match[1]) {
        const query = match[1].trim();
        // Skip if it's a control command (including voice commands)
        if (/^(pausa|pause|para|stop|pula|skip|fila|queue|volume|escuta|escutar|ouvir|listen|call|musica|música|entra|vem|join|sai|sair|leave|para\s+de\s+escutar)/i.test(query)) {
          continue;
        }
        // Skip if too short or just a greeting
        if (query.length < 3 || /^(oi|olá|e aí|tudo bem)/i.test(query)) {
          continue;
        }
        return { action: 'play', query };
      }
    }

    // === GENRE/MOOD PATTERNS ===
    const genrePatterns = [
      /^(?:alfred[,!]?\s+)?(?:toca|coloca|bota)\s+(?:um|uma|algo|alguma(?:coisa)?)\s+(?:de\s+)?(.+?)(?:\s+(?:pra|para)\s+.+)?$/i,
      /^(?:alfred[,!]?\s+)?(?:música|musica)\s+(?:de|pra|para)\s+(.+)$/i,
    ];

    for (const pattern of genrePatterns) {
      const match = content.match(pattern);
      if (match) {
        return { action: 'play', query: match[1].trim(), isGenre: true };
      }
    }

    // === CONTROL PATTERNS ===
    const controls = {
      pause: /^(?:alfred[,!]?\s+)?(?:pausa|pause|pausar)(?:\s+(?:a\s+)?(?:música|musica))?$/i,
      resume: /^(?:alfred[,!]?\s+)?(?:continua|continue|despause?|despausar?|voltar?|retom[ae]r?)(?:\s+(?:a\s+)?(?:música|musica))?$/i,
      skip: /^(?:alfred[,!]?\s+)?(?:pula|pular|skip|próxima|proxima|next|pule)(?:\s+(?:essa)?)?$/i,
      stop: /^(?:alfred[,!]?\s+)?(?:para|parar|stop|desliga|sai|sair|leave)(?:\s+(?:a\s+)?(?:música|musica))?$/i,
      queue: /^(?:alfred[,!]?\s+)?(?:fila|lista|queue)(?:\s+(?:de\s+)?(?:música|musica)?)?$/i,
      shuffle: /^(?:alfred[,!]?\s+)?(?:embaralha|shuffle|mistura)(?:\s+(?:a\s+)?fila)?$/i,
      loop: /^(?:alfred[,!]?\s+)?(?:repete|repetir|loop)(?:\s+(?:essa)?)?$/i,
      nowplaying: /^(?:alfred[,!]?\s+)?(?:(?:o\s+)?que\s+(?:tá|ta|está)\s+tocando|que\s+(?:música|musica)\s+(?:é\s+)?essa|now\s*playing|tocando\s+agora|qual\s+(?:música|musica))(?:\?)?$/i,
      volume: /^(?:alfred[,!]?\s+)?(?:volume)\s+(\d+)(?:%)?$/i,
      listen: /^(?:alfred[,!]?\s+)?(?:escutar?|ouvir?|escuta|ouça|listen|call|musica|música|entra|vem|join|vem\s+(?:ca|aqui|pra\s+c[aá])|entra\s+(?:na\s+)?call)(?:\s+(?:comandos?|voz|aqui))?$/i,
      stopListen: /^(?:alfred[,!]?\s+)?(?:para(?:r)?\s+(?:de\s+)?(?:escutar?|ouvir?)|para\s+(?:a\s+)?escuta|stop\s*listen|sai|sair|leave|tchau|vai\s+embora)$/i,
    };

    for (const [action, pattern] of Object.entries(controls)) {
      const match = content.match(pattern);
      if (match) {
        if (action === 'volume') {
          return { action, value: parseInt(match[1]) };
        }
        return { action };
      }
    }

    // === PLAYLIST PATTERNS ===
    const playlistPatterns = {
      playPlaylist: /^(?:alfred[,!]?\s+)?(?:toca|toque)\s+(?:(?:a\s+)?(?:minha\s+)?playlist\s+(?:de\s+)?)?(.+)$/i,
      savePlaylist: /^(?:alfred[,!]?\s+)?(?:salva?|cria|adiciona)\s+(?:essa\s+)?(?:fila|playlist)\s+(?:como\s+)?["\']?(.+?)["\']?$/i,
      listPlaylists: /^(?:alfred[,!]?\s+)?(?:minhas?\s+)?(?:playlists?|listas?)$/i,
    };

    for (const [action, pattern] of Object.entries(playlistPatterns)) {
      const match = content.match(pattern);
      if (match) {
        if (action === 'listPlaylists') {
          return { action };
        }
        return { action, name: match[1]?.trim() };
      }
    }

    return null;
  }

  // ============================================
  // Player Commands
  // ============================================

  async play(message, query) {
    try {
      const voiceChannel = message.member?.voice?.channel;

      if (!voiceChannel) {
        return message.reply({
          embeds: [new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('❌ Erro')
            .setDescription('Você precisa estar em um canal de voz!')
          ]
        });
      }

      // Show searching message
      const searchEmbed = new EmbedBuilder()
        .setColor('#ffaa00')
        .setTitle('🔍 Procurando...')
        .setDescription(`Buscando: **${query}**`);

      const searchMsg = await message.reply({ embeds: [searchEmbed] });

      // Corrigir erros de transcrição usando IA
      let correctedQuery = await correctMusicQuery(query);

      // Melhorar busca adicionando "official" para evitar covers
      let searchQuery = correctedQuery;
      if (!correctedQuery.toLowerCase().includes('cover') && !correctedQuery.toLowerCase().includes('oficial')) {
        searchQuery = `${correctedQuery} official`;
      }

      // Atualizar embed se query foi corrigida
      if (correctedQuery.toLowerCase() !== query.toLowerCase()) {
        await searchMsg.edit({
          embeds: [new EmbedBuilder()
            .setColor('#ffaa00')
            .setTitle('🔍 Procurando...')
            .setDescription(`Entendi: **${correctedQuery}**\n*(você disse: ${query})*`)]
        });
      }

      // Search for track - primeiro YouTube, depois SoundCloud se falhar
      let searchResult = await this.player.search(searchQuery, {
        requestedBy: message.author,
        searchEngine: QueryType.YOUTUBE
      });

      // Fallback para SoundCloud se não encontrar no YouTube
      if (!searchResult || !searchResult.tracks.length) {
        logger.info('[Música] YouTube sem resultado, tentando SoundCloud...');
        searchResult = await this.player.search(query, {
          requestedBy: message.author,
          searchEngine: QueryType.SOUNDCLOUD
        });
      }

      if (!searchResult || !searchResult.tracks.length) {
        return searchMsg.edit({
          embeds: [new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('❌ Nada Encontrado')
            .setDescription(`Não achei nenhum resultado para: **${query}**\nTenta outro termo!`)
          ]
        });
      }

      // Create or get queue
      const queue = this.player.nodes.create(message.guild, {
        metadata: {
          channel: message.channel,
          client: message.guild.members.me,
          requestedBy: message.author
        },
        selfDeaf: true,
        volume: 50,
        leaveOnEmpty: true,
        leaveOnEmptyCooldown: 300000,
        leaveOnEnd: true,
        leaveOnEndCooldown: 300000,
        connectionTimeout: 60000,  // 60 segundos para conectar
        bufferingTimeout: 30000    // 30 segundos para buffer
      });

      // Connect to voice channel
      try {
        if (!queue.connection) {
          await queue.connect(voiceChannel);
        }
      } catch (error) {
        queue.delete();
        logger.error('[Música] Erro ao conectar:', error);
        return searchMsg.edit({
          embeds: [new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('❌ Erro de Conexão')
            .setDescription('Não consegui entrar no canal de voz. Verifica as permissões!')
          ]
        });
      }

      // Add tracks
      if (searchResult.playlist) {
        queue.addTrack(searchResult.tracks);
        await searchMsg.edit({
          embeds: [new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('📁 Playlist Adicionada')
            .setDescription(`**${searchResult.playlist.title}**\n${searchResult.tracks.length} músicas adicionadas!`)
            .setThumbnail(searchResult.playlist.thumbnail)
          ]
        });
      } else {
        queue.addTrack(searchResult.tracks[0]);
        const track = searchResult.tracks[0];
        await searchMsg.edit({
          embeds: [new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('✅ Música Encontrada')
            .setDescription(`**${track.title}**\n${track.author}`)
            .setThumbnail(track.thumbnail)
          ]
        });
      }

      // Start playing if not already
      if (!queue.isPlaying()) {
        await queue.node.play();
      }

    } catch (error) {
      logger.error('[Música] Erro ao tocar:', error);
      return message.reply({
        embeds: [new EmbedBuilder()
          .setColor('#ff0000')
          .setTitle('❌ Erro')
          .setDescription('Deu um erro ao tentar tocar. Tenta de novo!')
        ]
      });
    }
  }

  async pause(message) {
    const queue = this.player.nodes.get(message.guild.id);

    if (!queue || !queue.isPlaying()) {
      return message.reply({
        embeds: [new EmbedBuilder()
          .setColor('#ff0000')
          .setDescription('❌ Não tem nada tocando!')]
      });
    }

    queue.node.setPaused(true);
    return message.reply({
      embeds: [new EmbedBuilder()
        .setColor('#ffaa00')
        .setTitle('⏸️ Música Pausada')
        .setDescription(`**${queue.currentTrack.title}**\nUse **alfred continua** para voltar.`)]
    });
  }

  async resume(message) {
    const queue = this.player.nodes.get(message.guild.id);

    if (!queue) {
      return message.reply({
        embeds: [new EmbedBuilder()
          .setColor('#ff0000')
          .setDescription('❌ Não tem nada na fila!')]
      });
    }

    if (!queue.node.isPaused()) {
      return message.reply({
        embeds: [new EmbedBuilder()
          .setColor('#ffaa00')
          .setDescription('⚠️ A música já está tocando!')]
      });
    }

    queue.node.setPaused(false);
    return message.reply({
      embeds: [new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('▶️ Continuando')
        .setDescription(`**${queue.currentTrack.title}**`)]
    });
  }

  async skip(message) {
    const queue = this.player.nodes.get(message.guild.id);

    if (!queue || !queue.isPlaying()) {
      return message.reply({
        embeds: [new EmbedBuilder()
          .setColor('#ff0000')
          .setDescription('❌ Não tem nada tocando!')]
      });
    }

    const current = queue.currentTrack;
    queue.node.skip();

    return message.reply({
      embeds: [new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('⏭️ Pulada')
        .setDescription(`Pulei: **${current.title}**`)]
    });
  }

  async stop(message) {
    const queue = this.player.nodes.get(message.guild.id);

    if (!queue) {
      return message.reply({
        embeds: [new EmbedBuilder()
          .setColor('#ff0000')
          .setDescription('❌ Não tem nada tocando!')]
      });
    }

    queue.delete();
    return message.reply({
      embeds: [new EmbedBuilder()
        .setColor('#ff9900')
        .setTitle('⏹️ Música Parada')
        .setDescription('Fila limpa e saí do canal. Até a próxima! 👋')]
    });
  }

  async showQueue(message) {
    const queue = this.player.nodes.get(message.guild.id);

    if (!queue || !queue.currentTrack) {
      return message.reply({
        embeds: [new EmbedBuilder()
          .setColor('#ffaa00')
          .setDescription('📋 A fila está vazia! Use **alfred toque [música]** para adicionar.')]
      });
    }

    return message.reply({ embeds: [this.createQueueEmbed(queue)] });
  }

  async setVolume(message, volume) {
    const queue = this.player.nodes.get(message.guild.id);

    if (!queue) {
      return message.reply({
        embeds: [new EmbedBuilder()
          .setColor('#ff0000')
          .setDescription('❌ Não tem nada tocando!')]
      });
    }

    if (volume < 0 || volume > 100) {
      return message.reply({
        embeds: [new EmbedBuilder()
          .setColor('#ffaa00')
          .setDescription('⚠️ Volume deve ser entre 0 e 100!')]
      });
    }

    queue.node.setVolume(volume);

    const volumeBar = '█'.repeat(Math.floor(volume / 10)) + '░'.repeat(10 - Math.floor(volume / 10));

    return message.reply({
      embeds: [new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('🔊 Volume Ajustado')
        .setDescription(`${volumeBar} **${volume}%**`)]
    });
  }

  async shuffle(message) {
    const queue = this.player.nodes.get(message.guild.id);

    if (!queue || queue.tracks.size < 2) {
      return message.reply({
        embeds: [new EmbedBuilder()
          .setColor('#ff0000')
          .setDescription('❌ Precisa ter pelo menos 2 músicas na fila!')]
      });
    }

    queue.tracks.shuffle();
    return message.reply({
      embeds: [new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('🔀 Fila Embaralhada')
        .setDescription(`${queue.tracks.size} músicas misturadas!`)]
    });
  }

  async toggleLoop(message) {
    const queue = this.player.nodes.get(message.guild.id);

    if (!queue) {
      return message.reply({
        embeds: [new EmbedBuilder()
          .setColor('#ff0000')
          .setDescription('❌ Não tem nada tocando!')]
      });
    }

    const modes = ['Off', 'Track', 'Queue', 'Autoplay'];
    const modeEmojis = ['❌', '🔂', '🔁', '📻'];
    const modeNames = ['Desativado', 'Repetir Música', 'Repetir Fila', 'Autoplay'];

    const currentMode = queue.repeatMode;
    const nextMode = (currentMode + 1) % modes.length;

    queue.setRepeatMode(nextMode);

    return message.reply({
      embeds: [new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle(`${modeEmojis[nextMode]} Modo de Repetição`)
        .setDescription(`**${modeNames[nextMode]}**`)]
    });
  }

  async nowPlaying(message) {
    const queue = this.player.nodes.get(message.guild.id);

    if (!queue || !queue.currentTrack) {
      return message.reply({
        embeds: [new EmbedBuilder()
          .setColor('#ffaa00')
          .setDescription('❌ Não tem nada tocando agora!')]
      });
    }

    return message.reply({ embeds: [this.createNowPlayingEmbed(queue.currentTrack, queue)] });
  }

  // ============================================
  // Playlist Commands
  // ============================================

  async savePlaylist(message, name, userId) {
    const queue = this.player.nodes.get(message.guild.id);

    if (!queue || !queue.currentTrack) {
      return message.reply({
        embeds: [new EmbedBuilder()
          .setColor('#ff0000')
          .setDescription('❌ Não tem nada na fila para salvar!')]
      });
    }

    const tracks = [queue.currentTrack, ...queue.tracks.toArray()];
    const playlistData = tracks.map(t => ({
      title: t.title,
      author: t.author,
      url: t.url,
      duration: t.duration,
      thumbnail: t.thumbnail
    }));

    const key = `${userId}:${name.toLowerCase()}`;
    this.playlists[key] = {
      name,
      userId,
      tracks: playlistData,
      createdAt: new Date().toISOString()
    };

    savePlaylists(this.playlists);

    return message.reply({
      embeds: [new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('💾 Playlist Salva!')
        .setDescription(`**${name}** com ${tracks.length} músicas.\nUse **alfred toca playlist ${name}** para tocar.`)]
    });
  }

  async playUserPlaylist(message, name, userId) {
    const key = `${userId}:${name.toLowerCase()}`;
    const playlist = this.playlists[key];

    if (!playlist) {
      return message.reply({
        embeds: [new EmbedBuilder()
          .setColor('#ff0000')
          .setDescription(`❌ Playlist **${name}** não encontrada!`)]
      });
    }

    // Play the first track
    if (playlist.tracks.length > 0) {
      await this.play(message, playlist.tracks[0].url || playlist.tracks[0].title);

      // Add remaining tracks
      const queue = this.player.nodes.get(message.guild.id);
      if (queue && playlist.tracks.length > 1) {
        for (let i = 1; i < playlist.tracks.length; i++) {
          const track = playlist.tracks[i];
          const result = await this.player.search(track.url || track.title, {
            requestedBy: message.author
          });
          if (result?.tracks[0]) {
            queue.addTrack(result.tracks[0]);
          }
        }
      }
    }

    return message.channel.send({
      embeds: [new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('📁 Playlist Carregada')
        .setDescription(`**${playlist.name}** - ${playlist.tracks.length} músicas`)]
    });
  }

  async listUserPlaylists(message, userId) {
    const userPlaylists = Object.values(this.playlists)
      .filter(p => p.userId === userId);

    if (userPlaylists.length === 0) {
      return message.reply({
        embeds: [new EmbedBuilder()
          .setColor('#ffaa00')
          .setDescription('📋 Você não tem playlists salvas!\nUse **alfred salva playlist [nome]** para criar uma.')]
      });
    }

    const list = userPlaylists.map(p =>
      `**${p.name}** - ${p.tracks.length} música(s)`
    ).join('\n');

    return message.reply({
      embeds: [new EmbedBuilder()
        .setColor('#7289DA')
        .setTitle('📋 Suas Playlists')
        .setDescription(list)]
    });
  }

  // ============================================
  // Execute Command
  // ============================================

  async execute(message, command) {
    try {
      // Voice channel check for most commands
      const needsVoice = !['queue', 'nowplaying', 'listPlaylists'].includes(command.action);

      if (needsVoice && !message.member?.voice?.channel) {
        return message.reply({
          embeds: [new EmbedBuilder()
            .setColor('#ff0000')
            .setDescription('❌ Você precisa estar em um canal de voz!')]
        });
      }

      logger.info(`[Música] Executando: ${command.action} por ${message.author.tag}`);

      switch (command.action) {
        case 'play':
          return await this.play(message, command.query);
        case 'pause':
          return await this.pause(message);
        case 'resume':
          return await this.resume(message);
        case 'skip':
          return await this.skip(message);
        case 'stop':
          return await this.stop(message);
        case 'queue':
          return await this.showQueue(message);
        case 'volume':
          return await this.setVolume(message, command.value);
        case 'shuffle':
          return await this.shuffle(message);
        case 'loop':
          return await this.toggleLoop(message);
        case 'nowplaying':
          return await this.nowPlaying(message);
        case 'savePlaylist':
          return await this.savePlaylist(message, command.name, message.author.id);
        case 'playPlaylist':
          return await this.playUserPlaylist(message, command.name, message.author.id);
        case 'listPlaylists':
          return await this.listUserPlaylists(message, message.author.id);
        case 'listen':
          return await this.startVoiceListening(message);
        case 'stopListen':
          return await this.stopVoiceListening(message);
        default:
          return message.reply('❌ Comando não reconhecido!');
      }
    } catch (error) {
      logger.error('[Música] Erro ao executar:', error);
      return message.reply({
        embeds: [new EmbedBuilder()
          .setColor('#ff0000')
          .setTitle('❌ Erro')
          .setDescription('Algo deu errado, tenta de novo!')]
      });
    }
  }

  // ============================================
  // Voice Listening Methods
  // ============================================

  /**
   * Start listening for voice commands in the user's voice channel
   */
  async startVoiceListening(message) {
    const voiceChannel = message.member?.voice?.channel;

    if (!voiceChannel) {
      return message.reply({
        embeds: [new EmbedBuilder()
          .setColor('#ff0000')
          .setDescription('❌ Você precisa estar em um canal de voz!')]
      });
    }

    try {
      // Lazy load voice listener
      if (!this.voiceListener) {
        const VoiceListener = require('./voice-listener');
        this.voiceListener = new VoiceListener(this.client);
      }

      const success = await this.voiceListener.startListening(voiceChannel, message.channel);

      if (success) {
        return message.reply({
          embeds: [new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('🎤 Escutando Comandos de Voz')
            .setDescription(`Entrei em **${voiceChannel.name}**\n\nAgora você pode falar:\n• *"Alfred, toque Guns N Roses"*\n• *"Alfred, pausa"*\n• *"Alfred, pula"*`)
            .setFooter({ text: 'Diga "alfred parar escutar" para desativar' })]
        });
      } else {
        return message.reply({
          embeds: [new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('❌ Erro')
            .setDescription('Não consegui ativar comandos de voz.\n\n**Verifique:**\n• Servidor Whisper está rodando (`python scripts/whisper-server.py`)\n• FFmpeg instalado')]
        });
      }
    } catch (error) {
      logger.error('[Música] Erro ao iniciar escuta:', error);
      return message.reply({
        embeds: [new EmbedBuilder()
          .setColor('#ff0000')
          .setDescription('❌ Erro ao iniciar escuta de voz.')]
      });
    }
  }

  /**
   * Stop listening for voice commands
   */
  async stopVoiceListening(message) {
    if (!this.voiceListener || !this.voiceListener.isListening(message.guildId)) {
      return message.reply({
        embeds: [new EmbedBuilder()
          .setColor('#ffaa00')
          .setDescription('⚠️ Não estou escutando comandos de voz.')]
      });
    }

    this.voiceListener.stopListening(message.guildId);

    return message.reply({
      embeds: [new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('🔇 Escuta Desativada')
        .setDescription('Parei de escutar comandos de voz.')]
    });
  }
}

module.exports = AlfredMusicPlayer;
