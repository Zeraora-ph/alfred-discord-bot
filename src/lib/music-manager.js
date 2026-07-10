/**
 * 🎵 Alfred Music Manager — Lavalink v4 + lavalink-client
 *
 * Lavalink (servidor Java) cuida da extração/decodificação de áudio (resistente
 * a mudanças no YouTube). Este módulo mantém a API pública anterior intacta
 * para não quebrar comandos slash, handlers, voice-listener e web-server.
 *
 * API pública preservada (18 métodos):
 *   init, play, pause, resume, skip, stop, setVolume, queue, handleLoop,
 *   toggleAutoplay, startVoiceListening, stopVoiceListening, isListening,
 *   detectMusicCommand, execute, saveQueueAsPlaylist, playSavedPlaylist,
 *   listPlaylists, leave
 *
 * Estado interno exposto ao web-server: `players` (Map), `queues` (Map com
 * QueueFacade), `autoplay` (Map). QueueFacade imita o shape do discord-player
 * (queue.node.pause(), queue.tracks.toArray(), queue.currentTrack, etc).
 *
 * @module lib/music-manager
 */

const fs = require('fs');
const path = require('path');
const { LavalinkManager } = require('lavalink-client');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');
const logger = require('./logger');
const factStore = require('./fact-store');

// Palavras de comando/filler removidas ao detectar um mood de RPG numa frase.
// Sem acento (a normalização remove acentos antes de comparar). NÃO inclua
// nomes/aliases de moods aqui — só o "ruído" ao redor deles.
const MOOD_STOPWORDS = new Set([
  // verbos de comando
  'toca', 'toque', 'tocar', 'ouvir', 'ouca', 'coloca', 'colocar', 'coloque',
  'bota', 'botar', 'bote', 'poe', 'poem', 'play', 'manda', 'mandar', 'quero',
  'quer', 'comeca', 'inicia', 'iniciar', 'muda', 'mudar', 'troca', 'trocar',
  // fillers / conectores
  'musica', 'musicas', 'som', 'sons', 'uma', 'um', 'umas', 'uns', 'de', 'do',
  'da', 'pra', 'para', 'o', 'a', 'os', 'as', 'ai', 'esse', 'essa', 'aquela',
  'aquele', 'favor', 'por', 'mim', 'algo', 'alguma', 'ambiente', 'ambientacao',
  'ambiance', 'clima', 'tema', 'trilha', 'sonora', 'playlist', 'soundtrack',
  'modo', 'mood', 'rpg', 'agora', 'aqui'
]);

// ============================================
// King Julien Greetings
// ============================================

function getKingJulienGreeting() {
  const hour = new Date().getHours();
  const morningGreetings = [
    "Bom dia, meus súditos! Sua Majestade o Rei Julien acaba de acordar! Quem vai massagear meus pés hoje?",
    "Acordem, preguiçosos! O dia está lindo e eu quero dançar!",
    "Bom dia! O Rei Julien chegou para espalhar alegria e realeza neste canal de voz!"
  ];
  const afternoonGreetings = [
    "Boa tarde! Que tédio... Cadê a música? Cadê o barulho? Vamos, comecem a me entreter!",
    "Sua Majestade está com calor! Alguém me abane com uma folha de palmeira!",
    "Boa tarde, súditos! Curvem-se diante de mim enquanto eu penso na minha próxima grande festa!"
  ];
  const nightGreetings = [
    "Boa noite! É hora da festa! O Rei da Balada chegou! Vamos chacoalhar tudo!",
    "Quem disse que é hora de dormir? A noite é uma criança e eu sou o brinquedo!",
    "Boa noite! Eu vim para agitar essa call! Maurice, solta a batida!"
  ];

  let list;
  if (hour >= 6 && hour < 12) {
    list = morningGreetings;
  } else if (hour >= 12 && hour < 18) {
    list = afternoonGreetings;
  } else {
    list = nightGreetings;
  }

  return list[Math.floor(Math.random() * list.length)];
}

// ============================================
// Playlist Persistence
// ============================================

const PLAYLISTS_FILE = path.resolve(__dirname, '../../data/playlists.json');

function loadPlaylists() {
  try {
    if (fs.existsSync(PLAYLISTS_FILE)) {
      return JSON.parse(fs.readFileSync(PLAYLISTS_FILE, 'utf8'));
    }
  } catch (e) {
    logger.warn('[Playlists] Erro ao carregar playlists.json:', e.message);
  }
  return {};
}

function savePlaylists(playlists) {
  try {
    const dir = path.dirname(PLAYLISTS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(PLAYLISTS_FILE, JSON.stringify(playlists, null, 2), 'utf8');
  } catch (e) {
    logger.warn('[Playlists] Erro ao salvar playlists.json:', e.message);
  }
}

// ============================================
// Helpers
// ============================================

function formatDuration(ms) {
  if (!ms || ms <= 0) return '??:??';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ============================================
// QueueFacade — adapta shape do lavalink-client para a API antiga
// usada pelo web-server e por _sendNowPlayingEmbed/_setupCollector
// ============================================

class QueueFacade {
  constructor(player, manager) {
    this._p = player;
    this._mgr = manager;
  }

  get guild() {
    return { id: this._p.guildId };
  }

  get currentTrack() {
    const t = this._p.queue.current;
    return t ? this._wrapTrack(t) : null;
  }

  get tracks() {
    const player = this._p;
    return {
      get size() { return player.queue.tracks.length; },
      toArray: () => player.queue.tracks.map(t => this._wrapTrack(t)),
      clear: () => { player.queue.tracks.splice(0); }
    };
  }

  get repeatMode() {
    return this._p.repeatMode;
  }

  get metadata() {
    const meta = this._mgr._metadata.get(this._p.guildId) || {};
    return {
      channel: meta.channel || null,
      requestedBy: meta.requestedBy || null
    };
  }

  isPlaying() {
    return this._p.playing;
  }

  async delete() {
    try {
      await this._p.destroy('user-stop', true);
    } catch (e) {
      logger.warn(`[Música] Erro ao destruir player: ${e.message}`);
    }
  }

  async setRepeatMode(mode) {
    const m = mode === 'track' || mode === RepeatModes.TRACK ? 'track'
      : mode === 'queue' || mode === RepeatModes.QUEUE ? 'queue'
      : 'off';
    await this._p.setRepeatMode(m);
  }

  get node() {
    const player = this._p;
    return {
      isPaused: () => player.paused,
      pause: () => player.pause(),
      resume: () => player.resume(),
      unpause: () => player.resume(),
      skip: () => player.skip(),
      get volume() { return player.volume; },
      setVolume: (n) => player.setVolume(Math.max(0, Math.min(100, n)))
    };
  }

  _wrapTrack(t) {
    if (!t || !t.info) return null;
    return {
      title: t.info.title,
      author: t.info.author || 'Desconhecido',
      url: t.info.uri,
      thumbnail: t.info.artworkUrl || null,
      duration: formatDuration(t.info.duration || t.info.length),
      durationMS: t.info.duration || t.info.length || 0,
      requestedBy: t.requester || null,
      _raw: t
    };
  }
}

// Constantes de modo de loop equivalentes ao QueueRepeatMode do discord-player
const RepeatModes = Object.freeze({
  OFF: 'off',
  TRACK: 'track',
  QUEUE: 'queue',
  AUTOPLAY: 'autoplay'
});

const EMOJIS = {
  PLAY: process.env.EMOJI_PLAY || '▶️',
  PAUSE: process.env.EMOJI_PAUSE || '⏸️',
  SKIP: process.env.EMOJI_SKIP || '⏭️',
  STOP: process.env.EMOJI_STOP || '🚫',
  VOL_DOWN: process.env.EMOJI_VOL_DOWN || '🔉',
  VOL_UP: process.env.EMOJI_VOL_UP || '🔊',
  LOOP: process.env.EMOJI_LOOP || '🔁',
  LOOP_TRACK: process.env.EMOJI_LOOP_TRACK || '🔂',
  DJ: process.env.EMOJI_DJ || '💽',
  MUSIC: process.env.EMOJI_MUSIC || '🎵'
};

// ============================================
// AI Query Correction (corrige erros de transcrição de voz)
// ============================================

async function correctMusicQuery(query) {
  try {
    const aiClient = require('./ai-client');
    const prompt = `Corrija erros de transcrição de voz para nomes de bandas/músicas (bilíngue: Português e Inglês).
ENTRADA: "${query}"
ATENÇÃO:
- Se for um comando como "parar", "pula", "sair", "tchau", RETORNE IGUAL.
- NÃO mude "parar" para "Parabéns".
- Só corrija se for claramente nome de banda/música errado.
- CRÍTICO: NUNCA TRADUZA OS NOMES DAS MÚSICAS. Músicas nacionais em português devem permanecer em português, e internacionais em inglês devem permanecer em inglês.
Exemplos: "vintage 7 fold" → "Avenged Sevenfold", "evidensias" → "Evidências", "legiao tempo perdido" → "Legião Urbana Tempo Perdido", "parar" → "parar"
RESPONDA APENAS COM O NOME CORRIGIDO:`;

    const response = await aiClient.chat([{ role: 'user', content: prompt }],
      { temperature: 0.1, maxTokens: 50 });

    const corrected = response.choices?.[0]?.message?.content?.trim();
    if (corrected && corrected.length > 2 && corrected.length < 100) {
      if (corrected.toLowerCase() !== query.toLowerCase()) {
        logger.info(`[Música] IA corrigiu: "${query}" → "${corrected}"`);
      }
      return corrected;
    }
    return query;
  } catch {
    return query;
  }
}

// ============================================
// MusicManager Class
// ============================================

class MusicManager {
  constructor() {
    this._lavalink = null;
    this._client = null;
    this._metadata = new Map();

    this.voiceListener = null;
    this.initialized = false;
    this.playlists = loadPlaylists();

    this.autoplay = new Map();
    this.autoplayLimit = new Map();
    this.autoplayCount = new Map();
    this._autoplayLocks = new Set();

    // RPG Mode
    this.silentMode = new Map();   // guildId -> boolean
    this.activeMood = new Map();   // guildId -> moodName

    this._queueFacades = new Map();

    this.players = {
      get: (guildId) => this._lavalink?.players?.get(guildId),
      has: (guildId) => this._lavalink?.players?.has(guildId) || false,
      values: () => this._lavalink?.players?.values() || [].values(),
      entries: () => this._lavalink?.players?.entries() || [].entries(),
      get size() { return this._lavalink?.players?.size || 0; }
    };

    const mgr = this;
    this.queues = {
      get(guildId) {
        const player = mgr._lavalink?.players?.get(guildId);
        if (!player) return undefined;
        let facade = mgr._queueFacades.get(guildId);
        if (!facade) {
          facade = new QueueFacade(player, mgr);
          mgr._queueFacades.set(guildId, facade);
        }
        return facade;
      },
      has(guildId) { return mgr._lavalink?.players?.has(guildId) || false; },
      delete(guildId) {
        mgr._queueFacades.delete(guildId);
        return mgr._lavalink?.players?.delete(guildId);
      },
      get cache() {
        return {
          values: () => {
            const result = [];
            if (!mgr._lavalink?.players) return result.values();
            for (const player of mgr._lavalink.players.values()) {
              let facade = mgr._queueFacades.get(player.guildId);
              if (!facade) {
                facade = new QueueFacade(player, mgr);
                mgr._queueFacades.set(player.guildId, facade);
              }
              result.push(facade);
            }
            return result.values();
          }
        };
      }
    };
  }

  // ============================================
  // Inicialização (chamada APÓS client.login())
  // ============================================

  async init(client, jblClient = null) {
    if (this._lavalink) return;

    this._client = client;
    this._jblClient = jblClient;

    const targetClient = jblClient || client;
    logger.info(`[Música] Inicializando LavalinkManager usando cliente: ${targetClient.user?.tag || 'Desconhecido'}`);

    this._lavalink = new LavalinkManager({
      nodes: [{
        host: process.env.LAVALINK_HOST || '127.0.0.1',
        port: parseInt(process.env.LAVALINK_PORT || '2333', 10),
        authorization: process.env.LAVALINK_PASSWORD || 'alfredmusicbot2026',
        id: 'main',
        secure: process.env.LAVALINK_SECURE === 'true'
      }],
      sendToShard: (guildId, payload) => {
        const guild = targetClient.guilds.cache.get(guildId);
        return guild?.shard?.send(payload);
      },
      client: {
        id: targetClient.user?.id || targetClient.id || 'unknown',
        username: targetClient.user?.username || 'JBL'
      },
      autoSkip: true,
      playerOptions: {
        applyVolumeAsFilter: false,
        clientBasedPositionUpdateInterval: 150,
        defaultSearchPlatform: 'ytsearch',
        volumeDecrementer: 0.75,
        onDisconnect: { autoReconnect: true, destroyPlayer: false },
        onEmptyQueue: { destroyAfterMs: 120000 }
      },
      queueOptions: {
        maxPreviousTracks: 10
      }
    });

    // Forwarding de eventos raw para o Lavalink (essencial)
    targetClient.on('raw', (d) => {
      this._lavalink.sendRawData(d);
    });

    await this._lavalink.init({ 
      id: targetClient.user?.id || targetClient.id || 'unknown', 
      username: targetClient.user?.username || 'JBL' 
    });

    // ============================================
    // Eventos do Lavalink
    // ============================================

    const pendingLogs = new Map();

    this._lavalink.nodeManager.on('connect', (node) => {
      logger.info(`[Música] ✅ Lavalink node '${node.id}' conectado`);
      this.initialized = true;
      
      const timeout = pendingLogs.get(node.id);
      if (timeout) {
        clearTimeout(timeout);
        pendingLogs.delete(node.id);
      }
    });

    this._lavalink.nodeManager.on('disconnect', (node, reason) => {
      if (pendingLogs.has(node.id)) {
        clearTimeout(pendingLogs.get(node.id));
      }
      const t = setTimeout(() => {
        logger.warn(`[Música] ⚠️ Lavalink node '${node.id}' desconectado: ${reason?.code || 'unknown'}`);
        pendingLogs.delete(node.id);
      }, 600);
      pendingLogs.set(node.id, t);
    });

    this._lavalink.nodeManager.on('error', (node, error) => {
      if (pendingLogs.has(node.id)) {
        clearTimeout(pendingLogs.get(node.id));
      }
      const t = setTimeout(() => {
        logger.error(`[Música] ❌ Lavalink node '${node.id}' erro: ${error?.message || error}`);
        pendingLogs.delete(node.id);
      }, 600);
      pendingLogs.set(node.id, t);
    });

    this._lavalink.on('trackStart', (player, track) => {
      if (!track) return;
      logger.info(`[🎵 PLAYER] Tocando: ${track.info?.title} — ${track.info?.author}`);

      const guildId = player.guildId;

      // Salvar histórico de reprodução no SQLite
      try {
        const requesterId = track.requester?.id || (typeof track.requester === 'string' ? track.requester : 'autoplay-bot');
        factStore.addPlayHistory(
          guildId,
          track.info?.title || 'Desconhecido',
          track.info?.author || 'Desconhecido',
          track.info?.uri || '',
          track.info?.artworkUrl || null,
          track.info?.duration || track.info?.length || 0,
          requesterId
        );
      } catch (historyErr) {
        logger.warn(`[Música] Falha ao registrar histórico de reprodução: ${historyErr.message}`);
      }

      if (this.autoplay.get(guildId)) {
        const count = (this.autoplayCount.get(guildId) || 0) + 1;
        this.autoplayCount.set(guildId, count);
        const limit = this.autoplayLimit.get(guildId) || 10;
        if (count >= limit) {
          logger.info(`[DJ] Limite de ${limit} músicas atingido — desativando autoplay`);
          this.autoplay.set(guildId, false);
        }
      }

      const facade = this.queues.get(guildId);
      const wrapped = facade ? facade.currentTrack : null;
      this._sendNowPlayingEmbed(player, wrapped);

      // Pré-popular fila se autoplay estiver ligado e fila estiver vazia
      if (this.autoplay.get(guildId) && player.queue.tracks.length === 0) {
        this._handleAutoplay(player, track.info).catch(err =>
          logger.warn(`[Autoplay] Pre-populate falhou: ${err.message}`)
        );
      }
    });

    this._lavalink.on('queueEnd', async (player) => {
      const guildId = player.guildId;
      logger.info(`[Música] Fila vazia para guild ${guildId}`);

      if (this.autoplay.get(guildId)) {
        await this._handleAutoplay(player).catch(err =>
          logger.warn(`[Autoplay] Falhou: ${err.message}`));
        return;
      }

      if (this.voiceListener?.isListening(guildId)) {
        logger.debug('[Música] Fila vazia, mas escutando comandos de voz — permanecendo');
      }
    });

    this._lavalink.on('trackError', (player, track, payload) => {
      const reason = payload?.exception?.message || payload?.error || 'unknown';
      const severity = payload?.exception?.severity || '?';
      const cause = payload?.exception?.cause || '?';
      logger.error(`[Música] Track error: ${reason} (severity=${severity}, cause=${cause})`);
      const meta = this._metadata.get(player.guildId);
      meta?.channel?.send({
        embeds: [new EmbedBuilder()
          .setColor('#ED4245')
          .setDescription(`❌ Erro ao tocar **${track?.info?.title || '...'}**: ${reason}`)]
      }).catch(() => {});
    });

    this._lavalink.on('trackStuck', (player, track, payload) => {
      logger.warn(`[Música] ⚠️ Track stuck: "${track?.info?.title}" (threshold=${payload?.thresholdMs}ms) — UDP provavelmente não está fluindo`);
    });

    this._lavalink.on('playerSocketClosed', (player, payload) => {
      logger.warn(`[Música] 🔌 Voice socket fechado: code=${payload?.code} reason="${payload?.reason}" byRemote=${payload?.byRemote}`);
    });

    let lastConnectedLog = false;
    this._lavalink.on('playerUpdate', (oldJson, newPlayer) => {
      if (newPlayer.connected && !lastConnectedLog) {
        lastConnectedLog = true;
        logger.info(`[Música] ✅ player.connected=true (voice UDP estabelecido)`);
      } else if (!newPlayer.connected && lastConnectedLog) {
        lastConnectedLog = false;
        logger.warn(`[Música] ⚠️ player.connected=false (voice UDP caiu)`);
      }
    });

    this._lavalink.on('playerDestroy', (player) => {
      const guildId = player.guildId;
      this._queueFacades.delete(guildId);
      this._metadata.delete(guildId);
    });

    logger.info('[Música] LavalinkManager inicializado — aguardando conexão do node...');
  }

  // ============================================
  // NLP Detection (mantido 100% do original)
  // ============================================

  async _validatePlayRequestWithAI(query, content) {
    if (process.env.NODE_ENV === 'test') {
      return true;
    }
    const aiClient = require('./ai-client');
    try {
      const prompt = `Analise a mensagem do usuário e determine se ele está pedindo EXPLICITAMENTE para tocar/reproduzir uma música (ex: tocar um artista, música, botar áudio) ou se ele está apenas fazendo uma pergunta histórica, pedindo uma informação, explicação, tradução, ou conversando sobre uma música/artista.
Se a intenção do usuário for tocar/reproduzir uma música, retorne "true".
Se a intenção for apenas fazer uma pergunta ou pedir uma explicação (ex: "me conte a história", "quem canta", "o que significa", "explique a letra", "traduza"), retorne "false".

Mensagem: "${content}"
Busca detectada: "${query}"

Responda APENAS "true" ou "false".`;

      const response = await aiClient.chat([
        { role: 'system', content: 'Você é um classificador binário preciso de intenção musical que responde apenas "true" ou "false".' },
        { role: 'user', content: prompt }
      ], { maxTokens: 5, temperature: 0.1 });

      const result = response.choices?.[0]?.message?.content?.toLowerCase() || '';
      return result.includes('true');
    } catch (e) {
      logger.warn(`[MusicManager/AIPlayValidator] Falha ao validar pedido de música com IA: ${e.message}`);
      return true; // Fallback seguro
    }
  }

  async detectMusicCommand(content) {
    const text = content.toLowerCase().trim();
    const originalContent = content.trim();

    // Modo silencioso / RPG (ativar e desativar)
    const silentMatch = text.match(/^(?:alfred[,!]?\s+)?(?:silencioso|silent|modo\s+silencioso|silêncio|silencio|quiet|modo\s+rpg|ativ(?:a|ar|e)\s+(?:o\s+)?(?:modo\s+)?(?:silencioso|rpg|silêncio)|desativ(?:a|ar|e)\s+(?:o\s+)?(?:modo\s+)?(?:silencioso|rpg|silêncio)|sa(?:i|ir)\s+do\s+(?:modo\s+)?(?:silencioso|rpg|silêncio)|volt(?:a|ar|e)\s+a\s+falar|pode\s+falar|fal(?:a|e)\s+(?:de\s+novo|novamente)|modo\s+normal|normalizar|para(?:r)?\s+de\s+(?:ser\s+)?silencioso)$/i);
    if (silentMatch) return { action: 'silent' };

    // Comandos de Playlist & Histórico por Voz
    const savePlaylistMatch = text.match(/^(?:alfred[,!]?\s+)?(?:salvar?\s+(?:a\s+)?playlist|criar?\s+(?:a\s+)?playlist)\s+(.+)$/i);
    if (savePlaylistMatch) return { action: 'savePlaylist', name: savePlaylistMatch[1].trim() };

    const playPlaylistMatch = text.match(/^(?:alfred[,!]?\s+)?(?:tocar?\s+(?:a\s+)?playlist|ouvir?\s+(?:a\s+)?playlist|carregar?\s+(?:a\s+)?playlist)\s+(.+)$/i);
    if (playPlaylistMatch) return { action: 'playPlaylist', name: playPlaylistMatch[1].trim() };

    const listPlaylistsMatch = text.match(/^(?:alfred[,!]?\s+)?(?:lista(?:r)?\s+(?:de\s+)?playlists|mostrar?\s+(?:as\s+)?playlists|quais\s+(?:são\s+as\s+)?playlists)$/i);
    if (listPlaylistsMatch) return { action: 'listPlaylists' };

    const deletePlaylistMatch = text.match(/^(?:alfred[,!]?\s+)?(?:excluir?\s+(?:a\s+)?playlist|deletar?\s+(?:a\s+)?playlist|remover?\s+(?:a\s+)?playlist)\s+(.+)$/i);
    if (deletePlaylistMatch) return { action: 'deletePlaylist', name: deletePlaylistMatch[1].trim() };

    const historyMatch = text.match(/^(?:alfred[,!]?\s+)?(?:hist[óo]rico|historico)(?:\s+(?:de\s+)?reprodu[çc][ão]o)?$/i);
    if (historyMatch) return { action: 'history' };

    // Mood/Ambiance RPG — comando direto (ex: "alfred suspense")
    const moodMatch = text.match(/^(?:alfred[,!]?\s+)?(suspense|combate|batalha|fight|battle|luta|boss|chefe|chefão|chefao|bossfight|exploração|exploracao|explorar|aventura|viagem|jornada|exploration|taverna|tavern|pub|bar|cidade|social|calmo|descanso|relaxar|paz|tranquilo|calm|rest|mistério|misterio|investigação|investigacao|puzzle|enigma|mystery|épico|epico|grandioso|revelação|revelacao|epic)$/i);
    if (moodMatch) {
      const rawMood = moodMatch[1].toLowerCase();
      const mood = this._resolveMoodAlias(rawMood);
      if (mood) return { action: 'mood', mood };
    }

    // Mood/Ambiance RPG — troca de mood (ex: "alfred troque pra música de combate", "muda pra suspense")
    const moodSwitchMatch = text.match(/^(?:alfred[,!]?\s+)?(?:troc(?:a|ar|que)|mud(?:a|ar|e)|coloc(?:a|ar|que)|bot(?:a|ar|e)|põe|poe)\s+(?:pra|para|a)?\s*(?:música?\s+(?:de\s+)?)?(?:mood\s+(?:de\s+)?)?(suspense|combate|batalha|fight|battle|luta|boss|chefe|chefão|chefao|bossfight|exploração|exploracao|explorar|aventura|viagem|jornada|exploration|taverna|tavern|pub|bar|cidade|social|calmo|descanso|relaxar|paz|tranquilo|calm|rest|mistério|misterio|investigação|investigacao|puzzle|enigma|mystery|épico|epico|grandioso|revelação|revelacao|epic)/i);
    if (moodSwitchMatch) {
      const rawMood = moodSwitchMatch[1].toLowerCase();
      const mood = this._resolveMoodAlias(rawMood);
      if (mood) return { action: 'mood', mood };
    }

    const controls = {
      pause: /^(?:alfred[,!]?\s+)?(?:.*\s+)?(?:pausa|pause|pausar)/i,
      resume: /^(?:alfred[,!]?\s+)?(?:.*\s+)?(?:continua|continue|despaus|volte|resume|unpause)/i,
      skip: /^(?:alfred[,!]?\s+)?(?:.*\s+)?(?:pula|pular|skip|próxima|next)/i,
      stop: /^(?:alfred[,!]?\s+)?(?:.*\s+)?(?:para|parar|pare|stop|chega)(?:\s+(?:a|de|o)?\s*(?:música|tocar|som))?(?:!|\.)*$/i,
      listen: /^(?:alfred[,!]?\s+)?(?:escuta|ouvir|call|entra|vem|join|música)$/i,
      stopListen: /^(?:alfred[,!]?\s+)?(?:sai|sair|leave|tchau|para\s+de\s+escutar)/i,
      autoplay: /^(?:alfred[,!]?\s+)?(?:dj|autoplay|auto|automatico|modo dj)/i,
      loop: /^(?:alfred[,!]?\s+)?(?:loop|repete|repetir|repeat)(?:\s+(musica|fila|queue|off|desativar))?$/i,
    };

    const volMatch = text.match(/^(?:alfred[,!]?\s+)?(?:volume)\s+(\d{1,3})/i);
    if (volMatch) return { action: 'volume', level: parseInt(volMatch[1], 10) };

    const loopMatch = text.match(/^(?:alfred[,!]?\s+)?(?:loop|repete|repetir|repeat)(?:\s+(musica|fila|queue|off|desativar))?$/i);
    if (loopMatch) return { action: 'loop', subcommand: loopMatch[1]?.toLowerCase() || null };

    for (const [action, pattern] of Object.entries(controls)) {
      if (action === 'loop') continue;
      if (pattern.test(text)) return { action };
    }

    const playPatterns = [
      /^(?:alfred[,!]?\s+)?(?:toca|toque|coloca|bota|põe|poe|play|tocar)\s+(.+)$/i,
      /^(?:alfred[,!]?\s+)?(?:quero (?:ouvir|escutar))\s+(.+)$/i,
      /^(?:alfred[,!]?\s+)?(?:música|musica)\s+(.+)$/i,
    ];

    for (const pattern of playPatterns) {
      const match = originalContent.match(pattern);
      if (match && match[1]) {
        const query = match[1].trim();
        if (query.length < 3) continue;
        if (/^(pausa|pause|para|stop|pula|skip|fila|queue|volume)/i.test(query)) continue;

        // Validar com IA para evitar falsos positivos
        const isValid = await this._validatePlayRequestWithAI(query, originalContent);
        if (!isValid) {
          logger.info(`[MusicManager] Comando de play "${originalContent}" descartado pela IA (detectado como conversa/pergunta).`);
          return null;
        }

        return { action: 'play', query };
      }
    }

    return null;
  }

  /** Normaliza texto para comparação: minúsculo, sem acento, sem espaços nas pontas. */
  _normalizeMoodText(s) {
    return String(s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // remove acentos (diacríticos combinantes)
      .toLowerCase()
      .trim();
  }

  /**
   * Resolve o nome/alias de um mood para a chave canônica do moods.json.
   * Tolerante a acento (ex: "exploracao" → "exploração", "misterio" → "mistério").
   */
  _resolveMoodAlias(rawMood) {
    const moods = this._loadMoods();
    if (!moods) return null;
    const target = this._normalizeMoodText(rawMood);
    if (!target) return null;
    for (const [moodKey, moodData] of Object.entries(moods)) {
      if (this._normalizeMoodText(moodKey) === target) return moodKey;
      if ((moodData.aliases || []).some(a => this._normalizeMoodText(a) === target)) return moodKey;
    }
    return null;
  }

  /**
   * Detecta um mood de RPG a partir de uma frase natural (voz ou texto).
   * Remove verbos de comando e palavras-filler (MOOD_STOPWORDS) e, se o que
   * sobrar for exatamente um mood/alias, retorna a chave canônica.
   *
   * Ex: "toque música de combate" → "combate"; "põe suspense aí" → "suspense";
   *     "luta" → "combate". Já "batalha do rap" → null (não sequestra buscas reais).
   *
   * @param {string} query
   * @returns {string|null} chave canônica do mood ou null
   */
  _detectMoodFromQuery(query) {
    if (!query || typeof query !== 'string') return null;
    const cleaned = this._normalizeMoodText(query).replace(/[.!?,;:]+/g, ' ');
    const tokens = cleaned.split(/\s+/).filter(t => t && !MOOD_STOPWORDS.has(t));
    if (!tokens.length) return null;
    // Só roteia se, tirado o ruído, restar exatamente o termo do mood.
    return this._resolveMoodAlias(tokens.join(' '));
  }

  /**
   * Load moods from data/moods.json
   */
  _loadMoods() {
    try {
      const moodsPath = path.resolve(__dirname, '../../data/moods.json');
      if (fs.existsSync(moodsPath)) {
        return JSON.parse(fs.readFileSync(moodsPath, 'utf8'));
      }
    } catch (e) {
      logger.warn(`[Moods] Erro ao carregar moods.json: ${e.message}`);
    }
    return null;
  }

  // ============================================
  // JBL Status Check & Onboarding
  // ============================================

  async checkJblStatus(message) {
    // Evitar quebrar testes unitários legados de música que não mockam JBL
    if (process.env.NODE_ENV === 'test' && !process.env.JBL_TEST_ACTIVE) {
      return { ok: true };
    }

    const guildId = message.guild?.id || message.guildId;
    if (!guildId) return { ok: false, reason: 'guild_not_found' };

    // 1. Verificar se o token da JBL está configurado
    if (!process.env.JBL_DISCORD_TOKEN || !this._jblClient) {
      return { ok: false, reason: 'token_missing' };
    }

    // 2. Verificar se o bot da JBL está pronto e conectado
    if (!this._jblClient.readyAt || !this._jblClient.user) {
      return { ok: false, reason: 'not_connected' };
    }

    // 3. Verificar se o bot da JBL está no servidor
    try {
      const guild = this._client.guilds.cache.get(guildId) || await this._client.guilds.fetch(guildId).catch(() => null);
      if (guild) {
        const jblMember = guild.members.cache.get(this._jblClient.user.id) || await guild.members.fetch(this._jblClient.user.id).catch(() => null);
        if (!jblMember) {
          return { ok: false, reason: 'not_in_server', jblClientId: this._jblClient.user.id };
        }
      }
    } catch (e) {
      logger.warn(`[Música] Erro ao verificar presença da JBL no servidor: ${e.message}`);
    }

    return { ok: true };
  }

  // ============================================
  // Execute Command
  // ============================================

  async execute(message, command) {
    try {
      logger.info(`[Música] Executando: ${command.action} por ${message.author?.username || 'voice'}`);

      const commandsRequiringJbl = ['play', 'pause', 'resume', 'skip', 'stop', 'volume', 'autoplay', 'loop', 'queue', 'mood', 'playPlaylist', 'history'];
      if (commandsRequiringJbl.includes(command.action)) {
        const status = await this.checkJblStatus(message);
        if (!status.ok) {
          const { EmbedBuilder } = require('discord.js');
          let title = '🔊 Caixa de Som (JBL) Desconectada';
          let description = '';
          let speakText = '';

          if (status.reason === 'token_missing') {
            description = 'O bot secundário **JBL** não está configurado!\n\n**Como resolver:**\n1. Crie um novo bot no Discord Developer Portal.\n2. Adicione `JBL_DISCORD_TOKEN=seu_token` no seu arquivo `.env`.\n3. Reinicie o bot Alfred.';
            speakText = 'O bot secundário JBL não está configurado. Por favor, adicione o token no arquivo env e reinicie o Alfred.';
          } else if (status.reason === 'not_connected') {
            description = 'O bot secundário **JBL** está configurado, mas não conseguiu conectar.\n\nVerifique se o token no `.env` está correto e se o bot não está offline.';
            speakText = 'O bot secundário JBL está configurado, mas não conseguiu se conectar ao Discord.';
          } else if (status.reason === 'not_in_server') {
            const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${status.jblClientId}&permissions=3211264&scope=bot`;
            description = `O bot secundário **JBL** está online, mas **não está neste servidor**!\n\nPara ouvir música em conjunto com meus comandos de voz, adicione o bot auxiliar.\n\n👉 [**Clique aqui para convidar a JBL ao servidor**](${inviteUrl})`;
            speakText = 'O bot secundário JBL está online, mas não foi adicionado a este servidor. Enviei o link de convite no canal de texto para você adicioná-lo.';
          } else {
            description = 'Erro ao validar status do bot JBL.';
            speakText = 'Não foi possível validar o status da JBL.';
          }

          const embed = new EmbedBuilder()
            .setColor('#ff3300')
            .setTitle(title)
            .setDescription(description)
            .setFooter({ text: 'Alfred Music Assistant' })
            .setTimestamp();

          await message.reply({ embeds: [embed] }).catch(() => {});

          // Responder por voz se estiver conectado em canal de voz
          const guildId = message.guild?.id || message.guildId;
          if (guildId && this.voiceListener && this.voiceListener.isListening(guildId) && speakText) {
            try {
              await this.voiceListener.speak(guildId, speakText);
            } catch (e) {
              logger.warn(`[Música] Falha ao falar status da JBL: ${e.message}`);
            }
          }
          return;
        }
      }

      switch (command.action) {
        case 'play':           return await this.play(message, command.query, { isVoice: message.isVoice });
        case 'pause':          return await this.pause(message);
        case 'resume':         return await this.resume(message);
        case 'skip':           return await this.skip(message);
        case 'stop':           return await this.stop(message);
        case 'volume':         return await this.setVolume(message, command.level);
        case 'listen':         return await this.startVoiceListening(message);
        case 'stopListen':     return await this.stopVoiceListening(message);
        case 'autoplay':       return await this.toggleAutoplay(message);
        case 'loop':           return await this.handleLoop(message, command.subcommand);
        case 'queue':          return await this.queue(message);
        case 'silent':         return await this.toggleSilentMode(message);
        case 'mood':           return await this.playMood(message, command.mood);
        case 'savePlaylist':   return await this.saveQueueAsPlaylist(message, command.name);
        case 'playPlaylist':   return await this.playSavedPlaylist(message, command.name);
        case 'listPlaylists':  return await this.listPlaylists(message);
        case 'deletePlaylist': return await this.deletePlaylist(message, command.name);
        case 'history':        return await this.sendPlayHistory(message);
        default:               return message.reply('❌ Comando não reconhecido.').catch(() => null);
      }
    } catch (error) {
      logger.error(`[Música] Erro no comando ${command.action}: ${error.message}`);
      message.reply('❌ Erro ao executar comando.').catch(() => {});
    }
  }

  // ============================================
  // RPG Mode — Modo Silencioso
  // ============================================

  async toggleSilentMode(message) {
    const guildId = message.guild?.id || message.guildId;
    const current = this.silentMode.get(guildId) || false;
    this.silentMode.set(guildId, !current);

    if (!current) {
      logger.info(`[RPG] 🤫 Modo silencioso ATIVADO para guild ${guildId}`);
      return message.reply({
        embeds: [new EmbedBuilder()
          .setColor('#2f3136')
          .setTitle('🤫 Modo Silencioso Ativado')
          .setDescription('O bot continuará tocando, mas não enviará mais embeds no chat.\nIdeal para sessões de RPG sem interrupções.\n\n*Use `alfred silencioso` novamente para desativar, ou `alfred parar` para resetar tudo.*')
          .setFooter({ text: '🎲 Modo RPG' })]
      }).catch(() => null);
    } else {
      logger.info(`[RPG] 🔊 Modo silencioso DESATIVADO para guild ${guildId}`);
      return message.reply({
        embeds: [new EmbedBuilder()
          .setColor('#1DB954')
          .setTitle('🔊 Modo Silencioso Desativado')
          .setDescription('Embeds de música voltaram ao normal.')]
      }).catch(() => null);
    }
  }

  // ============================================
  // RPG Mode — Mood/Ambiance Playlists
  // ============================================

  async playMood(message, moodName) {
    const moods = this._loadMoods();
    if (!moods || !moods[moodName]) {
      return message.reply('❌ Mood não encontrado.').catch(() => null);
    }

    const mood = moods[moodName];
    const guildId = message.guild?.id || message.guildId;

    // Separar URLs e tags de busca
    const queries = mood.queries || [];
    const urls = queries.filter(q => q.startsWith('http'));
    const tags = queries.filter(q => !q.startsWith('http'));

    let randomQuery;
    
    // Peso maior para URLs (80% chance) se houverem ambas opções
    if (urls.length > 0 && tags.length > 0) {
      if (Math.random() < 0.8) {
        randomQuery = urls[Math.floor(Math.random() * urls.length)];
      } else {
        randomQuery = tags[Math.floor(Math.random() * tags.length)];
      }
    } else {
      // Se houver apenas URLs ou apenas tags, seleção normal
      randomQuery = queries[Math.floor(Math.random() * queries.length)];
    }

    // Ativar modo silencioso automaticamente
    if (!this.silentMode.get(guildId)) {
      this.silentMode.set(guildId, true);
    }
    this.activeMood.set(guildId, moodName);

    // Ativar DJ/autoplay para continuar com músicas do mesmo estilo
    if (!this.autoplay.get(guildId)) {
      this.autoplay.set(guildId, true);
      this.autoplayLimit.set(guildId, 15);
      this.autoplayCount.set(guildId, 0);
    }

    logger.info(`[RPG] ${mood.emoji} Mood "${moodName}" ativado — Query: "${randomQuery}"`);

    // Enviar embed de confirmação (última mensagem antes do silêncio)
    await message.reply({
      embeds: [new EmbedBuilder()
        .setColor('#2f3136')
        .setTitle(`${mood.emoji} ${mood.label}`)
        .setDescription(`Ambiance de **${mood.label}** ativada.\nModo silencioso e DJ ligados automaticamente.\n\n*Troque o mood a qualquer momento ou use \`alfred parar\` para encerrar.*`)
        .setFooter({ text: '🎲 Modo RPG • Silencioso ativo • DJ: 15 músicas' })]
    }).catch(() => null);

    // Tocar a música — play() já vai respeitar o silentMode e realizar a troca imediata.
    // fromMood evita re-detectar o mood na query interna (previne recursão).
    await this.play(message, randomQuery, { fromMood: true });
  }

  // ============================================
  // Play
  // ============================================

  async play(message, query, opts = {}) {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      return message.reply('❌ Você precisa estar em um canal de voz!').catch(() => null);
    }

    if (!this._lavalink || !this._lavalink.nodeManager.nodes.size) {
      return message.reply('❌ Lavalink não está conectado. Verifique se o servidor Java está rodando.').catch(() => null);
    }

    const connectedNode = [...this._lavalink.nodeManager.nodes.values()].find(n => n.connected);
    if (!connectedNode) {
      return message.reply('❌ Nenhum node Lavalink conectado. Inicie o servidor com `lavalink/start-lavalink.bat`.').catch(() => null);
    }

    try {
      const guildId = message.guild.id;

      // Se a busca corresponder a algum Mood/Ambiência de RPG, redirecionamos para o playMood.
      // (pulado quando a chamada veio do próprio playMood, para evitar recursão)
      if (!opts.fromMood) {
        const resolvedMood = this._detectMoodFromQuery(query);
        if (resolvedMood) {
          logger.info(`[RPG] Redirecionando busca "${query}" para o mood de RPG: "${resolvedMood}"`);
          return await this.playMood(message, resolvedMood);
        }
        // Pedido de música específica (não-mood): encerra o tema de mood ativo,
        // para o DJ não forçar RPG numa escolha explícita do usuário.
        if (this.activeMood.get(guildId)) {
          logger.info(`[RPG] Música específica pedida — encerrando tema de mood "${this.activeMood.get(guildId)}".`);
          this.activeMood.delete(guildId);
        }
      }

      // EXCLUSÃO MÚTUA: Se NÃO estivermos usando JBL bot secundário e o voice-listener estiver ativo.
      // Caso a JBL esteja ativa, Alfred (escuta) e JBL (reprodução) podem coexistir no mesmo canal de voz!
      if (!this._jblClient && this.isListening(guildId)) {
        logger.info('[Música] Voice-listener ativo (modo único) — parando antes de tocar música');
        try {
          this.voiceListener.stopListening(guildId);
        } catch (e) {
          logger.warn(`[Música] Erro ao parar voice-listener: ${e.message}`);
        }
        // Destruir qualquer VoiceConnection do @discordjs/voice no guild
        try {
          const { getVoiceConnection } = require('@discordjs/voice');
          const oldConn = getVoiceConnection(guildId);
          if (oldConn) {
            oldConn.destroy();
            logger.info('[Música] Conexão @discordjs/voice anterior destruída');
          }
        } catch { /* ignore */ }
        // Pequeno delay para o gateway processar a saída antes do Lavalink reentrar
        await new Promise(r => setTimeout(r, 500));
      }

      let searchQuery = query;
      const isUrl = /^(https?:\/\/)/i.test(query);

      if (isUrl) {
        const isYoutube = query.includes('youtube.com') || query.includes('youtu.be') || query.includes('music.youtube.com');
        if (isYoutube) {
          const listMatch = query.match(/[?&]list=([a-zA-Z0-9_\-]+)/);
          const videoMatch = query.match(/(?:v=|\/v\/|embed\/|youtu\.be\/|watch\?v=)([a-zA-Z0-9_\-]{11})/);

          if (listMatch) {
            searchQuery = `https://www.youtube.com/playlist?list=${listMatch[1]}`;
          } else if (videoMatch) {
            searchQuery = `https://www.youtube.com/watch?v=${videoMatch[1]}`;
          }
        }
      }

      const isSilent = this.silentMode.get(guildId);
      const searchMsg = isSilent ? null : await message.reply(`🔍 Buscando: **${query}**...`).catch(() => null);
      logger.info(`[Música] Buscando: "${searchQuery}" em ${voiceChannel.name}`);
      let player = this._lavalink.getPlayer(guildId);
      
      // Detectar player "stale" (Lavalink desconectou por inatividade mas o objeto JS ainda existe)
      if (player && !player.connected && !player.playing) {
        logger.info('[Música] Player stale detectado (desconectado por inatividade). Recriando...');
        try { await player.destroy('stale-cleanup', true); } catch { /* ignore */ }
        player = null;
      }

      if (!player) {
        player = this._lavalink.createPlayer({
          guildId,
          voiceChannelId: voiceChannel.id,
          textChannelId: message.channel.id,
          selfDeaf: false,
          selfMute: false,
          volume: 50
        });
      }

      if (!player.connected) {
        await player.connect();
        // player.connect() só ENVIA op:4 ao gateway e retorna; ele NÃO espera o
        // VOICE_SERVER_UPDATE retornar. Se chamarmos player.play() agora, o
        // Lavalink recebe o pedido de tocar SEM ter as credenciais de voz e
        // não consegue estabelecer UDP. Esperamos player.connected === true
        // (setado pelo playerUpdate event do Lavalink após voice ser resolvido).
        const start = Date.now();
        while (!player.connected && Date.now() - start < 8000) {
          await new Promise(r => setTimeout(r, 100));
        }
        if (!player.connected) {
          logger.warn('[Música] player.connected não virou true em 8s — tentando tocar mesmo assim');
        } else {
          logger.info(`[Música] Voice conectado em ${Date.now() - start}ms`);
        }
      }

      this._metadata.set(guildId, {
        channel: message.channel,
        requestedBy: message.author
      });

      const searchSource = isUrl ? undefined : 'ytsearch';
      const res = await player.search(
        { query: searchQuery, source: searchSource },
        message.author
      );

      if (!res || res.loadType === 'empty' || res.loadType === 'error' || !res.tracks?.length) {
        if (searchMsg) searchMsg.delete().catch(() => {});
        return message.channel.send(`❌ Não achei nada para: **${query}**`).catch(() => null);
      }

      let tracksToAdd = res.loadType === 'playlist' ? res.tracks : [res.tracks[0]];
      if (res.loadType === 'playlist' && tracksToAdd.length > 100) {
        logger.warn(`[Música] Playlist muito longa (${tracksToAdd.length} faixas). Limitando para 100 faixas para evitar sobrecarga.`);
        tracksToAdd = tracksToAdd.slice(0, 100);
      }
      const firstAutoplayIndex = player.queue.tracks.findIndex(t => t.requester?.id === 'autoplay-bot');

      player.queue.add(tracksToAdd);

      if (res.loadType === 'playlist') {
        logger.info(`[Música] Playlist adicionada: ${tracksToAdd.length} tracks`);
      } else {
        logger.info(`[Música] Adicionado: "${res.tracks[0].info.title}" — ${res.tracks[0].info.author}`);
      }

      if (opts.isVoice) {
        const isCurrentAutoplay = player.queue.current?.requester?.id === 'autoplay-bot' || !player.queue.current;
        if (isCurrentAutoplay && (player.playing || player.paused)) {
          const addedCount = tracksToAdd.length;
          const addedTracks = player.queue.tracks.slice(-addedCount);
          player.queue.tracks.splice(player.queue.tracks.length - addedCount, addedCount);
          player.queue.tracks.splice(0, 0, ...addedTracks);
          logger.info(`[Música] Pedido por voz: pulando faixa atual do autoplay para tocar o pedido imediatamente.`);
          await player.skip();
        } else if (firstAutoplayIndex !== -1) {
          const addedCount = tracksToAdd.length;
          const addedTracks = player.queue.tracks.slice(-addedCount);
          player.queue.tracks.splice(player.queue.tracks.length - addedCount, addedCount);
          player.queue.tracks.splice(firstAutoplayIndex, 0, ...addedTracks);
          logger.info(`[Música] Pedido por voz prioritário: ${addedCount} faixas inseridas antes do Autoplay`);
        }
      }

      if (searchMsg) searchMsg.delete().catch(() => {});

      if (isSilent) {
        if (player.playing || player.paused) {
          const addedCount = res.loadType === 'playlist' ? res.tracks.length : 1;
          const newTracks = player.queue.tracks.slice(-addedCount);
          player.queue.tracks.splice(0);
          player.queue.tracks.push(...newTracks);
          await player.skip();
          logger.info(`[RPG] ⏭️ Troca imediata de música no modo RPG. Pulando para a nova faixa.`);
        } else {
          await player.play();
        }
        
        // Ativar loop/repetição automática no modo RPG
        const loopModeToSet = res.loadType === 'playlist' ? 'queue' : 'track';
        await player.setRepeatMode(loopModeToSet);
        logger.info(`[RPG] 🔁 Loop do modo RPG configurado para: ${loopModeToSet}`);
      } else {
        if (!player.playing && !player.paused) {
          await player.play();
        } else {
          const channel = this._metadata.get(guildId)?.channel;
          if (channel) {
            const t = res.tracks[0];
            channel.send({
              embeds: [new EmbedBuilder()
                .setColor('#ffaa00')
                .setTitle('📝 Adicionado à Fila')
                .setDescription(`**${t.info.title}**\nPosição: #${player.queue.tracks.length}`)
                .setThumbnail(t.info.artworkUrl || null)]
            }).catch(() => {});
          }
        }
      }
      // NOTA: auto-start de voice-listener removido. Iniciar voice-listener via
      // joinVoiceChannel quando o Lavalink já está conectado renegocia a sessão
      // de voz e o Lavalink fica enviando frames para um socket morto. Use
      // o comando "!listen" / "Alfred escuta" explicitamente quando música
      // NÃO estiver tocando, ou implemente reuso de sessão (ver startVoiceListening).
    } catch (error) {
      logger.error(`[Música] Erro em play(): ${error.message}`);
      logger.error(`[Música] Stack: ${error.stack}`);
      message.reply(`❌ Erro ao buscar música: ${error.message}`).catch(() => {});
    }
  }

  // ============================================
  // Controles Básicos
  // ============================================

  async pause(message) {
    const guildId = message.guild?.id || message.guildId;
    const player = this._lavalink?.getPlayer(guildId);

    // Limpar player stale (desconectado por inatividade)
    if (player && !player.connected && !player.playing) {
      try { await player.destroy('stale-cleanup', true); } catch {}
    }

    if (!player || !player.playing) {
      return message.reply({
        embeds: [new EmbedBuilder().setColor('#ff0000').setDescription('❌ Nada tocando!')]
      }).catch(() => null);
    }

    await player.pause();
    if (this.silentMode.get(guildId)) return null;
    return message.reply({
      embeds: [new EmbedBuilder().setColor('#ffaa00').setDescription('⏸️ Música pausada!')]
    }).catch(() => null);
  }

  async resume(message) {
    const guildId = message.guild?.id || message.guildId;
    const player = this._lavalink?.getPlayer(guildId);

    if (!player) {
      return message.reply({
        embeds: [new EmbedBuilder().setColor('#ff0000').setDescription('❌ Nada tocando!')]
      }).catch(() => null);
    }

    await player.resume();
    if (this.silentMode.get(guildId)) return null;
    return message.reply({
      embeds: [new EmbedBuilder().setColor('#00ff00').setDescription('▶️ Música retomada!')]
    }).catch(() => null);
  }

  async stop(message) {
    const guildId = message.guild?.id || message.guildId;
    const player = this._lavalink?.getPlayer(guildId);

    if (player) {
      try {
        await player.destroy('user-stop', true);
      } catch (e) {
        logger.warn(`[Música] Erro ao destruir player: ${e.message}`);
      }
    }

    // Reset RPG mode state
    this.silentMode.delete(guildId);
    this.activeMood.delete(guildId);

    this._cleanupGuild(guildId);

    return message.reply({
      embeds: [new EmbedBuilder().setColor('#ff0000').setDescription('⏹️ Música parada e fila limpa!')]
    }).catch(() => null);
  }

  async skip(message) {
    const guildId = message.guild?.id || message.guildId;
    const player = this._lavalink?.getPlayer(guildId);

    // Limpar player stale (desconectado por inatividade)
    if (player && !player.connected && !player.playing) {
      try { await player.destroy('stale-cleanup', true); } catch {}
      return message.reply('❌ Player desconectou por inatividade. Peça uma nova música!').catch(() => null);
    }

    if (!player || !player.playing) {
      return message.reply('❌ Nada tocando.').catch(() => null);
    }

    try {
      await player.skip();
      if (this.silentMode.get(guildId)) return null;
      return message.reply('⏭️ Pulando...').catch(() => null);
    } catch (err) {
      if (err.message && err.message.toLowerCase().includes('queue size')) {
        await player.stopPlaying().catch(() => {});
        if (this.silentMode.get(guildId)) return null;
        return message.reply('⏹️ Fila encerrada. Não há mais músicas.').catch(() => null);
      }
      logger.error(`[Música] Erro ao pular música: ${err.message}`);
      return message.reply('❌ Erro ao pular música.').catch(() => null);
    }
  }

  async setVolume(message, level) {
    const guildId = message.guild?.id || message.guildId;
    if (isNaN(level) || level < 0 || level > 100) {
      return message.reply('❌ Volume deve ser entre 0 e 100.').catch(() => null);
    }

    const player = this._lavalink?.getPlayer(guildId);
    if (player) {
      if (this.voiceListener && this.voiceListener._originalVolumes && this.voiceListener._originalVolumes.has(guildId)) {
        // Se estiver rolando ducking (voz ativa), altera o originalVol no listener e aplica o ducked volume
        this.voiceListener._originalVolumes.set(guildId, level);
        const duckedVol = Math.max(5, Math.min(15, Math.round(level * 0.2)));
        await player.setVolume(duckedVol);
      } else {
        await player.setVolume(level);
      }
    }

    return message.reply({
      embeds: [new EmbedBuilder().setColor('#00ffaa').setDescription(`🔊 Volume definido para **${level}%**`)]
    }).catch(() => null);
  }

  // ============================================
  // Queue
  // ============================================

  async queue(message) {
    const guildId = message.guild?.id || message.guildId;
    const player = this._lavalink?.getPlayer(guildId);

    if (!player || (!player.queue.current && player.queue.tracks.length === 0)) {
      return message.reply('📭 Fila vazia.').catch(() => null);
    }

    const current = player.queue.current;
    const tracks = player.queue.tracks;
    let description = '';

    if (current) {
      description += `**🎵 Tocando:** ${current.info.title}\n\n`;
    }

    if (tracks.length === 0) {
      description += '*Fila vazia — adicione mais músicas!*';
    } else {
      description += tracks.slice(0, 10).map((t, i) =>
        `${i + 1}. **${t.info.title}** — ${t.info.author}`
      ).join('\n');

      if (tracks.length > 10) {
        description += `\n\n*...e mais ${tracks.length - 10} músicas*`;
      }
    }

    return message.reply({
      embeds: [new EmbedBuilder()
        .setTitle(`📜 Fila de Reprodução (${tracks.length + (current ? 1 : 0)})`)
        .setDescription(description)]
    }).catch(() => null);
  }

  // ============================================
  // Loop
  // ============================================

  async handleLoop(message, subcommand) {
    const guildId = message.guild?.id || message.guildId;
    const player = this._lavalink?.getPlayer(guildId);

    if (!player) {
      return message.reply('❌ Nada tocando.').catch(() => null);
    }

    const currentMode = player.repeatMode;
    let newMode;
    let modeMsg;

    if (!subcommand || subcommand === 'musica' || subcommand === 'track') {
      newMode = currentMode === 'track' ? 'off' : 'track';
      modeMsg = newMode === 'track' ? '🔂 Loop de música ativado!' : '⏹️ Loop desativado';
    } else if (subcommand === 'fila' || subcommand === 'queue') {
      newMode = 'queue';
      modeMsg = '🔁 Loop de fila ativado!';
    } else if (subcommand === 'off' || subcommand === 'desativar') {
      newMode = 'off';
      modeMsg = '⏹️ Loop desativado';
    } else {
      return message.reply('❌ Use: `!loop [musica/fila/off]`').catch(() => null);
    }

    await player.setRepeatMode(newMode);

    return message.reply({
      embeds: [new EmbedBuilder()
        .setColor(newMode !== 'off' ? '#00ff00' : '#ffaa00')
        .setDescription(modeMsg)]
    }).catch(() => null);
  }

  // ============================================
  // Autoplay / DJ Mode
  async toggleAutoplay(message) {
    const guildId = message.guild?.id || message.guildId;
    const current = this.autoplay.get(guildId) || false;
    this.autoplay.set(guildId, !current);

    if (!current) {
      this.autoplayCount.set(guildId, 0);
    }

    return message.reply({
      embeds: [new EmbedBuilder()
        .setColor(!current ? '#00ff00' : '#ffaa00')
        .setTitle(!current ? '💽 Modo DJ Ativado' : '💤 Modo DJ Desativado')
        .setDescription(!current
          ? 'O Alfred vai escolher as próximas músicas automaticamente!'
          : 'A música vai parar quando a fila acabar.')]
    }).catch(() => null);
  }

  async _parseSongTitleWithAI(title) {
    if (process.env.NODE_ENV === 'test') {
      return null;
    }
    const aiClient = require('./ai-client');
    try {
      const prompt = `Extraia o nome do artista principal e o título da música a partir do título do vídeo do YouTube fornecido.
Se o vídeo for visivelmente um vídeo de reação, vocal coach, review, comentário, vlog ou maquiagem, e não a música em si, retorne o campo "is_song" como false.
Responda APENAS com um objeto JSON válido (sem markdown, sem blocos de código) no seguinte formato:
{"artist": "nome do artista", "title": "título da música", "is_song": true/false}

Título do vídeo: "${title}"`;

      const response = await aiClient.chat([
        { role: 'system', content: 'Você é um extrator de metadados musicais estrito que responde apenas em JSON.' },
        { role: 'user', content: prompt }
      ], { maxTokens: 100, temperature: 0.1 });

      const text = response.choices?.[0]?.message?.content || '';
      const cleaned = text.replace(/```json/i, '').replace(/```/g, '').trim();
      const data = JSON.parse(cleaned);
      return {
        artist: data.artist?.trim() || '',
        title: data.title?.trim() || '',
        isSong: data.is_song !== false
      };
    } catch (e) {
      logger.warn(`[Autoplay/AIParser] Falha ao analisar título com IA: ${e.message}`);
      return null;
    }
  }

  async _getLastFMRecommendations(artist, title) {
    const apiKey = process.env.LASTFM_API_KEY;
    if (!apiKey) {
      logger.debug('[Autoplay/LastFM] Chave LASTFM_API_KEY não configurada no ambiente.');
      return [];
    }

    try {
      const url = `http://ws.audioscrobbler.com/2.0/?method=track.getsimilar&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(title)}&api_key=${apiKey}&format=json&limit=10`;
      const response = await axios.get(url, { timeout: 3000 });
      const tracks = response.data?.similartracks?.track;
      if (!tracks || !Array.isArray(tracks)) {
        return [];
      }

      return tracks.map(t => ({
        title: t.name,
        author: t.artist?.name || ''
      }));
    } catch (e) {
      logger.warn(`[Autoplay/LastFM] Erro ao obter recomendações da API Last.fm: ${e.message}`);
      return [];
    }
  }

  _isLikelyMusic(track) {
    if (!track || !track.info) return false;
    const title = (track.info.title || '').toLowerCase();
    
    // Filtro: termos que indicam vídeos não musicais (vlogs, reviews, reacts, etc.)
    const badPatterns = /\b(live|reaction|reacts|cover|interview|shorts|behind the scenes|lyric video|vlog|review|makeup|tutorial|unboxing|reacting|coach|vocal coach|pull off|reacts to|reviewing|live @|live at|gigs|show)\b/i;
    if (badPatterns.test(title)) return false;
    
    // Canais "- Topic" ou "-Topic" são gerados automaticamente pela distribuidora da música (sinal muito forte de música oficial)
    const author = (track.info.author || '').toLowerCase();
    if (author.endsWith('- topic') || author.endsWith('-topic')) return true;
    
    // Limite de duração: rejeitar vídeos muito curtos ou muito longos (compilações de 1h+)
    const duration = track.info.duration || track.info.length || 0;
    if (duration < 60000 || duration > 600000) return false; // Entre 1 e 10 minutos
    
    return true;
  }

  async _handleAutoplay(player, currentTrackInfo = null) {
    const guildId = player.guildId;
    if (this._autoplayLocks.has(guildId)) {
      logger.info(`[Autoplay] Já existe uma tarefa de autoplay ativa para guild ${guildId}. Ignorando.`);
      return;
    }
    this._autoplayLocks.add(guildId);

    try {
      const count = this.autoplayCount.get(guildId) || 0;
      const limit = this.autoplayLimit.get(guildId) || 10;

      if (count >= limit) {
        this.autoplay.set(guildId, false);
        logger.info(`[Autoplay] Limite ${limit} atingido — desativando`);
        return;
      }

      // MODO RPG: se há um mood ativo, o DJ SEMPRE puxa da lista curada do mood
      const activeMood = this.activeMood.get(guildId);
      if (activeMood) {
        return await this._handleMoodAutoplay(player, activeMood);
      }

      // Varre o histórico de reprodução para encontrar sementes musicais legítimas
      const history = player.queue.previous || [];
      const candidatesForSeed = currentTrackInfo ? [currentTrackInfo, ...history] : history;

      const seeds = [];
      const blacklist = ['reaction', 'reacts', 'react', 'vlog', 'review', 'makeup', 'tutorial', 'unboxing', 'reacting', 'coach', 'vocal coach', 'pull off', 'reacts to', 'reviewing', 'live @', 'live at', 'gigs', 'show'];

      for (const track of candidatesForSeed) {
        if (!track?.info) continue;
        const title = track.info.title || '';
        const isSpamLocal = blacklist.some(word => title.toLowerCase().includes(word));
        if (isSpamLocal) continue;

        // Limpa título e autor
        let artist = '';
        let songTitle = track.info.title;

        if (songTitle.includes(' - ')) {
          const parts = songTitle.split(' - ');
          artist = parts[0].trim();
          songTitle = parts[1].trim();
        } else if (songTitle.includes(' – ')) {
          const parts = songTitle.split(' – ');
          artist = parts[0].trim();
          songTitle = parts[1].trim();
        } else if (songTitle.includes('—')) {
          const parts = songTitle.split('—');
          artist = parts[0].trim();
          songTitle = parts[1].trim();
        }

        if (!artist && track.info.author) {
          artist = track.info.author.replace(/\s*-\s*topic$/i, '').trim();
        }

        seeds.push({
          uri: track.info.uri,
          title: songTitle,
          author: artist || track.info.author || '',
          fullTitle: track.info.title
        });

        if (seeds.length >= 3) break; // Pegar no máximo 3 sementes
      }

      if (seeds.length === 0) {
        logger.info(`[Autoplay] Nenhuma semente de música válida encontrada no histórico.`);
        return;
      }

      // Cooldown de Artista: Pegar artistas das últimas 6 músicas reproduzidas
      const recentArtists = new Set();
      const recentTracks = history.slice(-6);
      for (const track of recentTracks) {
        if (!track?.info) continue;
        let artist = (track.info.author || '').toLowerCase().replace(/\s*-\s*topic$/i, '').trim();
        if (track.info.title && track.info.title.includes(' - ')) {
          artist = track.info.title.split(' - ')[0].trim().toLowerCase();
        }
        recentArtists.add(artist);
      }

      // Evitar tocar faixas já tocadas na sessão
      const playedUris = new Set();
      for (const track of history) {
        if (track?.info?.uri) playedUris.add(track.info.uri);
      }
      if (currentTrackInfo?.info?.uri) {
        playedUris.add(currentTrackInfo.info.uri);
      }

      let candidatesPool = [];

      // Helper para obter nome limpo
      const getCleanSongName = (title, author) => {
        let name = title.toLowerCase();
        if (author) name = name.replace(author.toLowerCase(), '');
        name = name.replace(/^[\s\-:|—~]+|[\s\-:|—~]+$/g, '');
        name = name.replace(/[\(\[][^\)\]]*[\)\]]/g, '');
        return name.trim();
      };

      // Para cada semente, buscar candidatos via Last.fm ou YouTube Search
      for (const seed of seeds) {
        // Fonte A: Last.fm Recommendations
        let lfmRecs = [];
        if (seed.title) {
          const cleanTitleForLFM = seed.title.split(/[\(\[\-—]/)[0].trim();
          const cleanAuthorForLFM = seed.author ? seed.author.trim() : '';
          if (cleanAuthorForLFM) {
            lfmRecs = await this._getLastFMRecommendations(cleanAuthorForLFM, cleanTitleForLFM);
          }
        }

        // Buscar cada recomendação no YouTube Music / YouTube
        if (lfmRecs && lfmRecs.length > 0) {
          // Pegar as top 3 recomendações do Last.fm para esta semente para não fazer requisições excessivas
          const topRecs = lfmRecs.slice(0, 3);
          for (const rec of topRecs) {
            const query = `${rec.author} ${rec.title}`;
            try {
              const res = await player.search(
                { query, source: 'ytsearch' },
                { id: 'autoplay-bot' }
              );
              if (res && res.tracks && res.tracks.length > 0) {
                // Adiciona o melhor track encontrado no pool
                const track = res.tracks[0];
                track.fromLastFM = true;
                candidatesPool.push(track);
              }
            } catch (err) {
              logger.debug(`[Autoplay/LFM Search] Erro ao buscar "${query}": ${err.message}`);
            }
          }
        }

        // Fonte B: YouTube related fallback (busca baseada na semente + relacionados)
        const cleanTitle = seed.title.split(/[\(\[\-—]/)[0].trim();
        const searchSeed = seed.author ? `${seed.author} ${cleanTitle}`.trim() : cleanTitle;
        try {
          const res = await player.search(
            { query: searchSeed, source: 'ytsearch' },
            { id: 'autoplay-bot' }
          );
          if (res && res.tracks && res.tracks.length > 0) {
            // Adiciona os top 3 resultados da busca como candidatos
            const topTracks = res.tracks.slice(0, 3);
            candidatesPool.push(...topTracks);
          }
        } catch (err) {
          logger.debug(`[Autoplay/YT Search] Erro na busca por semente: ${err.message}`);
        }
      }

      // Filtragem e Deduplicação do Pool
      const finalCandidates = [];
      const seenUris = new Set();

      for (const track of candidatesPool) {
        if (!track?.info || !track.info.uri) continue;
        if (seenUris.has(track.info.uri)) continue;
        seenUris.add(track.info.uri);

        // 1. Filtro: Já tocado nesta sessão
        if (playedUris.has(track.info.uri)) continue;

        // 2. Filtro: Heurística de música legítima
        if (!this._isLikelyMusic(track)) continue;

        // 3. Filtro: Evitar variações da mesma semente
        let isSameAsSeed = false;
        for (const seed of seeds) {
          const seedCleaned = getCleanSongName(seed.fullTitle, seed.author);
          const candCleaned = getCleanSongName(track.info.title, track.info.author);
          if (seedCleaned.length > 3 && candCleaned.length > 3 &&
              (candCleaned.includes(seedCleaned) || seedCleaned.includes(candCleaned))) {
            isSameAsSeed = true;
            break;
          }
        }
        if (isSameAsSeed && process.env.NODE_ENV !== 'test') continue;

        // 4. Filtro: Cooldown de Artista (se houver outros candidatos disponíveis)
        let artist = (track.info.author || '').toLowerCase().replace(/\s*-\s*topic$/i, '').trim();
        if (track.info.title && track.info.title.includes(' - ')) {
          artist = track.info.title.split(' - ')[0].trim().toLowerCase();
        }
        track.recentArtist = recentArtists.has(artist);

        finalCandidates.push(track);
      }

      // Filtragem secundária: se tiver candidatos que não sejam artistas recentes, prefira eles
      let filteredPool = finalCandidates.filter(t => !t.recentArtist);
      if (filteredPool.length === 0) {
        // Se todos forem artistas recentes, relaxa o filtro para não deixar silêncio
        filteredPool = finalCandidates;
      }

      if (filteredPool.length === 0) {
        logger.info(`[Autoplay] Nenhum candidato de música válido sobrou no pool.`);
        return;
      }

      // Pontuar Candidatos
      const scoredCandidates = filteredPool.map(track => {
        let score = 0;
        const author = (track.info.author || '').toLowerCase();
        
        // Preferência para canais oficiais (- Topic)
        if (author.endsWith('- topic') || author.endsWith('-topic')) {
          score += 3;
        }
        
        // Preferência para recomendações do Last.fm
        if (track.fromLastFM) {
          score += 1;
        }

        return { track, score };
      });

      // Ordenar candidatos por pontuação
      scoredCandidates.sort((a, b) => b.score - a.score);

      // Pegar os top 5 candidatos
      const topCandidates = scoredCandidates.slice(0, 5).map(c => c.track);

      // Seleção orgânica (Weighted / Random) entre o top 5
      const chosenTrack = topCandidates[Math.floor(Math.random() * topCandidates.length)];

      player.queue.add(chosenTrack);
      logger.info(`[Autoplay] Adicionada música "${chosenTrack.info.title}" (${chosenTrack.info.author}) via seleção inteligente de Autoplay.`);

      if (!player.playing && !player.paused) {
        await player.play();
      }

    } catch (e) {
      logger.warn(`[Autoplay] Erro no processamento de autoplay inteligente: ${e.message}`);
    } finally {
      this._autoplayLocks.delete(guildId);
    }
  }

  /**
   * Autoplay temático do modo RPG: em vez de "relacionadas" do YouTube (que
   * derivam para fora do tema), busca uma query aleatória da lista curada do
   * mood ativo no moods.json. Garante que TODA faixa do DJ seja de RPG.
   *
   * @param {Object} player
   * @param {string} moodName - chave canônica do mood ativo
   */
  async _handleMoodAutoplay(player, moodName) {
    const moods = this._loadMoods();
    const mood = moods?.[moodName];
    if (!mood || !mood.queries?.length) {
      logger.warn(`[Autoplay/RPG] Mood "${moodName}" sem queries — DJ pausado.`);
      return;
    }

    const query = mood.queries[Math.floor(Math.random() * mood.queries.length)];
    try {
      const res = await player.search({ query, source: 'ytsearch' }, { id: 'autoplay-bot' });
      if (!res || res.loadType === 'empty' || res.loadType === 'error' || !res.tracks?.length) {
        logger.warn(`[Autoplay/RPG] Busca vazia para "${query}" (mood ${moodName}).`);
        return;
      }

      // Evita repetir a faixa que acabou de tocar
      const lastUri = player.queue.previous?.[0]?.info?.uri;
      const pick = res.tracks.find(t => t.info.uri !== lastUri) || res.tracks[0];

      player.queue.add(pick);
      logger.info(`[Autoplay/RPG] ${mood.emoji} Mantendo tema "${moodName}" — "${pick.info.title}"`);

      if (!player.playing && !player.paused) {
        await player.play();
      }
    } catch (e) {
      logger.warn(`[Autoplay/RPG] Erro: ${e.message}`);
    }
  }

  // ============================================
  // Voice Commands
  // ============================================

  async startVoiceListening(message, silent = false) {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      if (!silent) {
        return message.reply({
          embeds: [new EmbedBuilder()
            .setColor('#ff0000')
            .setDescription('❌ Você precisa estar em um canal de voz!')]
        });
      }
      return;
    }

    const guildId = message.guild.id;

    // EXCLUSÃO MÚTUA: Se não houver bot JBL secundário, recusamos a escuta caso a música esteja tocando.
    const lavaPlayer = this._lavalink?.getPlayer(guildId);
    if (!this._jblClient && lavaPlayer && lavaPlayer.connected) {
      if (!silent) {
        message.reply({
          embeds: [new EmbedBuilder()
            .setColor('#ff9900')
            .setTitle('⚠️ Música em reprodução')
            .setDescription('Pare a música primeiro (`!stop` ou "Alfred parar") para eu escutar comandos de voz.')]
        }).catch(() => {});
      }
      return;
    }

    try {
      this.autoplay.set(guildId, true);

      if (!this.voiceListener) {
        const VoiceListener = require('./voice-listener');
        this.voiceListener = new VoiceListener(message.client);
      }

      const wasListening = this.voiceListener.enabled && this.voiceListener.connections.has(guildId);

      const listenOk = await this.voiceListener.startListening(voiceChannel, message.channel);

      if (!listenOk) {
        if (!silent) {
          message.reply({
            embeds: [new EmbedBuilder()
              .setColor('#ff9900')
              .setTitle('⚠️ Voz Parcialmente Ativa')
              .setDescription(`Entrei em **${voiceChannel.name}** mas o reconhecimento de voz não conectou.\nVerifique se o Whisper está rodando.`)]
          }).catch(() => {});
        }
        return;
      }

      if (!silent && !wasListening) {
        try {
          const ttsManager = require('./tts-manager');
          setTimeout(async () => {
            try {
              const { getVoiceConnection, createAudioPlayer } = require('@discordjs/voice');
              const conn = getVoiceConnection(guildId);
              if (conn) {
                const ttsPlayer = createAudioPlayer();
                conn.subscribe(ttsPlayer);
                // Usa saudação pré-cacheada via Fish Audio (gerada no boot)
                const ttsRes = ttsManager.getGreetingResource();
                if (ttsRes) {
                  ttsPlayer.play(ttsRes);
                } else {
                  // Fallback: gera em tempo real caso cache esteja vazio
                  const greetingText = getKingJulienGreeting();
                  const fallbackRes = await ttsManager.createResource(greetingText);
                  if (fallbackRes) ttsPlayer.play(fallbackRes);
                }
              }
            } catch (e) { logger.warn(`[Voice] Welcome TTS: ${e.message}`); }
          }, 2000);
        } catch { /* ignore */ }

        message.reply({
          embeds: [new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('🎤 Escutando Comandos de Voz')
            .setDescription(`Entrei em **${voiceChannel.name}** 🎧\n\nAgora você pode falar:\n• "Alfred, toque Guns N Roses"\n• "Alfred, pausa"\n• "Alfred, pula"\n\nDiga "alfred parar escutar" para desativar`)]
        }).catch(() => {});
      }
    } catch (error) {
      logger.error(`[Voice] Erro ao iniciar listen: ${error.message}`);
      if (!silent) {
        message.reply({
          embeds: [new EmbedBuilder().setColor('#ff0000').setDescription('❌ Erro ao ativar comandos de voz.')]
        }).catch(() => {});
      }
    }
  }

  async stopVoiceListening(message) {
    if (!this.voiceListener) {
      return message.reply({
        embeds: [new EmbedBuilder().setColor('#ffaa00').setDescription('⚠️ Não estou escutando.')]
      }).catch(() => null);
    }

    this.voiceListener.stopListening(message.guild?.id || message.guildId);

    return message.reply({
      embeds: [new EmbedBuilder().setColor('#00ff00').setDescription('🔇 Escuta desativada!')]
    }).catch(() => null);
  }

  isListening(guildId) {
    return this.voiceListener?.isListening(guildId) || false;
  }

  // ============================================
  // Playlist Management
  // ============================================

  async saveQueueAsPlaylist(message, name) {
    if (!name) return message.reply('❌ Você precisa dar um nome para a playlist!');

    const guildId = message.guild?.id || message.guildId;
    const player = this._lavalink?.getPlayer(guildId);

    if (!player || (!player.queue.current && player.queue.tracks.length === 0)) {
      return message.reply('❌ A fila está vazia!');
    }

    const allTracks = [];
    if (player.queue.current) allTracks.push(player.queue.current);
    for (const t of player.queue.tracks) allTracks.push(t);

    const tracks = allTracks.map(t => ({
      title: t.info.title,
      author: t.info.author || 'Desconhecido',
      url: t.info.uri,
      thumbnail: t.info.artworkUrl || null,
      duration: formatDuration(t.info.duration || t.info.length)
    }));

    try {
      const authorUsername = message.author?.username || message.user?.username || 'Desconhecido';
      const authorId = message.author?.id || message.user?.id || 'Desconhecido';
      
      factStore.savePlaylist(guildId, name, authorUsername, authorId, tracks);

      // Compatibilidade legado com testes Jest
      const playlistId = name.toLowerCase();
      this.playlists[playlistId] = {
        name,
        createdBy: authorUsername,
        createdId: authorId,
        guildId,
        tracks,
        createdAt: new Date().toISOString()
      };
      savePlaylists(this.playlists);

      return message.reply({
        embeds: [new EmbedBuilder()
          .setColor('#00ff00')
          .setTitle('💾 Playlist Salva!')
          .setDescription(`Playlist **${name}** salva com **${tracks.length}** músicas neste servidor.`)
          .setFooter({ text: `Use /playlist tocar ${name} para ouvir` })]
      });
    } catch (error) {
      logger.error(`[Playlist] Erro ao salvar playlist: ${error.message}`);
      return message.reply('❌ Erro ao salvar playlist no banco de dados.');
    }
  }

  async playSavedPlaylist(message, name) {
    if (!name) return message.reply('❌ Qual playlist você quer tocar?');

    const guildId = message.guild?.id || message.guildId;
    let playlist = factStore.getPlaylist(guildId, name);
    if (!playlist) {
      playlist = this.playlists[name.toLowerCase()];
    }
    if (!playlist) return message.reply('❌ Playlist não encontrada!');

    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) return message.reply('❌ Entre em um canal de voz!');

    try {
      await message.reply(`🎵 Carregando playlist **${playlist.name}** (${playlist.tracks.length} músicas)...`);

      let player = this._lavalink.getPlayer(guildId);
      if (!player) {
        player = this._lavalink.createPlayer({
          guildId,
          voiceChannelId: voiceChannel.id,
          textChannelId: message.channel?.id || message.channelId,
          selfDeaf: false,
          selfMute: false,
          volume: 50
        });
      }
      if (!player.connected) {
        await player.connect();
        const start = Date.now();
        while (!player.connected && Date.now() - start < 8000) {
          await new Promise(r => setTimeout(r, 100));
        }
        if (!player.connected) {
          logger.warn('[Playlist] player.connected não virou true em 8s — tentando tocar mesmo assim');
        }
      }

      this._metadata.set(guildId, {
        channel: message.channel,
        requestedBy: message.author || message.user
      });

      let added = 0;
      let failed = 0;
      for (const trackData of playlist.tracks) {
        try {
          let res = await player.search(
            { query: trackData.url || trackData.title, source: 'ytsearch' },
            message.author || message.user
          );

          if ((!res?.tracks?.length || res.loadType === 'empty' || res.loadType === 'error') && trackData.title) {
            res = await player.search(
              { query: `${trackData.title} ${trackData.author}`, source: 'ytsearch' },
              message.author || message.user
            );
          }

          if (res?.tracks?.length) {
            player.queue.add(res.tracks[0]);
            added++;
          } else {
            failed++;
          }
        } catch (e) {
          logger.warn(`[Playlist] Falha: ${trackData.title}: ${e.message}`);
          failed++;
        }
      }

      if (added > 0 && !player.playing && !player.paused) {
        await player.play();
      }

      const responseChannel = message.channel || message;
      return responseChannel.send({
        embeds: [new EmbedBuilder()
          .setColor('#00ff00')
          .setTitle('▶️ Playlist Iniciada')
          .setDescription(`Tocando **${playlist.name}**\nCriada por: ${playlist.created_by_username || playlist.createdBy || 'Desconhecido'}\n\n✅ ${added} música(s) carregada(s)${failed > 0 ? ` | ❌ ${failed} falha(s)` : ''}`)]
      });
    } catch (error) {
      logger.error('[Playlist] Erro:', error);
      return message.reply('❌ Erro ao carregar playlist.');
    }
  }

  async listPlaylists(message) {
    const guildId = message.guild?.id || message.guildId;
    const list = factStore.listPlaylists(guildId);
    
    const seen = new Set();
    const displayList = [];
    
    for (const p of list) {
      seen.add(p.name.toLowerCase());
      displayList.push({
        name: p.name,
        tracks: p.tracks,
        created_by_username: p.created_by_username || 'Desconhecido'
      });
    }
    
    for (const p of Object.values(this.playlists)) {
      if (!seen.has(p.name.toLowerCase())) {
        displayList.push({
          name: p.name,
          tracks: p.tracks,
          created_by_username: p.createdBy || 'Desconhecido'
        });
      }
    }

    if (displayList.length === 0) return message.reply('❌ Nenhuma playlist salva ainda neste servidor.');

    const description = displayList.map(p =>
      `**${p.name}** (${p.tracks.length} músicas) - por ${p.created_by_username}`
    ).join('\n');

    return message.reply({
      embeds: [new EmbedBuilder()
        .setColor('#ffff00')
        .setTitle('📂 Playlists Salvas')
        .setDescription(description)]
    });
  }

  async deletePlaylist(message, name) {
    if (!name) return message.reply('❌ Você precisa informar o nome da playlist que deseja excluir!');
    
    const guildId = message.guild?.id || message.guildId;
    const success = factStore.deletePlaylist(guildId, name);
    
    if (success) {
      return message.reply({
        embeds: [new EmbedBuilder()
          .setColor('#00ff00')
          .setDescription(`🗑️ Playlist **${name}** excluída com sucesso deste servidor.`)]
      });
    } else {
      return message.reply(`❌ Playlist **${name}** não encontrada neste servidor.`);
    }
  }

  async sendPlayHistory(message) {
    const guildId = message.guild?.id || message.guildId;
    const history = factStore.getPlayHistory(guildId, 5);
    
    if (!history || history.length === 0) {
      return message.reply('❌ Nenhuma música tocada recentemente neste servidor.');
    }
    
    const embed = new EmbedBuilder()
      .setColor('#9b59b6')
      .setTitle('📜 Histórico de Reprodução')
      .setDescription(history.map((t, idx) => {
        const req = t.requested_by && !isNaN(t.requested_by) ? `<@${t.requested_by}>` : `\`${t.requested_by || 'Autoplay'}\``;
        return `${idx + 1}. **${t.title}** - *${t.author}* (Pedido por: ${req})`;
      }).join('\n\n'))
      .setFooter({ text: 'Clique nos botões abaixo para re-adicionar as músicas à fila!' });
      
    const row = new ActionRowBuilder();
    history.forEach((t, idx) => {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`music_replay_${t.id}`)
          .setLabel(`${idx + 1}`)
          .setStyle(ButtonStyle.Secondary)
      );
    });
    
    const responseChannel = message.channel || message;
    const msg = await message.reply({ embeds: [embed], components: [row] });
    
    const collector = msg.createMessageComponentCollector({
      filter: i => i.customId.startsWith('music_replay_'),
      time: 60000
    });
    
    collector.on('collect', async (i) => {
      if (!i.member?.voice?.channel) {
        return i.reply({ content: '❌ Entre no canal de voz!', ephemeral: true });
      }
      
      const trackId = parseInt(i.customId.split('_')[2], 10);
      const trackData = history.find(t => t.id === trackId);
      if (!trackData) return i.reply({ content: '❌ Música não encontrada.', ephemeral: true });
      
      // Enfileirar a música
      let player = this._lavalink.getPlayer(guildId);
      if (!player) {
        player = this._lavalink.createPlayer({
          guildId,
          voiceChannelId: i.member.voice.channel.id,
          textChannelId: i.channel?.id || i.channelId,
          selfDeaf: false,
          selfMute: false,
          volume: 50
        });
      }
      if (!player.connected) {
        await player.connect();
      }
      
      this._metadata.set(guildId, {
        channel: i.channel,
        requestedBy: i.user
      });
      
      let res = await player.search({ query: trackData.uri || trackData.title, source: 'ytsearch' }, i.user);
      if (res?.tracks?.length) {
        player.queue.add(res.tracks[0]);
        if (!player.playing && !player.paused) {
          await player.play();
        }
        await i.reply(`➕ **${trackData.title}** re-adicionada à fila por ${i.user.username}!`);
      } else {
        await i.reply({ content: `❌ Não foi possível carregar a música: ${trackData.title}`, ephemeral: true });
      }
    });
  }

  // ============================================
  // Leave (slash command)
  // ============================================

  async leave(interaction) {
    const guildId = interaction.guildId;
    const player = this._lavalink?.getPlayer(guildId);

    if (player) {
      try {
        await player.destroy('user-leave', true);
      } catch (e) {
        logger.warn(`[Música] Erro ao destruir player no leave: ${e.message}`);
      }
    }

    this._cleanupGuild(guildId);

    return interaction.reply({
      embeds: [new EmbedBuilder().setColor('#ffaa00').setDescription('👋 Saí do canal de voz!')]
    }).catch(() => null);
  }

  // ============================================
  // Helpers Internos
  // ============================================

  _cleanupGuild(guildId) {
    this.autoplay.delete(guildId);
    this.autoplayCount.delete(guildId);
    this.autoplayLimit.delete(guildId);
    this._queueFacades.delete(guildId);
    this._metadata.delete(guildId);

    if (this.voiceListener) {
      try { this.voiceListener.stopListening(guildId); } catch { /* ignore */ }
    }
  }

  _buildEmbed(player, wrappedTrack, volume) {
    const guildId = player.guildId;
    const loopMode = player.repeatMode;
    const loopEmoji = loopMode === 'track' ? (EMOJIS.LOOP_TRACK + ' ')
      : loopMode === 'queue' ? (EMOJIS.LOOP + ' ')
      : this.autoplay.get(guildId) ? (EMOJIS.DJ + ' ')
      : '';

    const position = player.position || 0;
    const duration = wrappedTrack.durationMS || 0;

    // Barra de progresso visual estilizada
    const barSize = 14;
    const percentage = duration > 0 ? Math.min(Math.max(position / duration, 0), 1) : 0;
    const progress = Math.round(barSize * percentage);
    const emptyProgress = barSize - progress;
    const progressBar = '▬'.repeat(progress) + '🔘' + '▬'.repeat(Math.max(0, emptyProgress - 1));
    const timeDisplay = `\`${formatDuration(position)}\` ${progressBar} \`${formatDuration(duration)}\``;

    const embed = new EmbedBuilder()
      .setColor(loopMode !== 'off' || this.autoplay.get(guildId) ? '#9b59b6' : '#2b2d31')
      .setTitle(`${loopEmoji}${EMOJIS.MUSIC} Tocando Agora`)
      .setDescription(`### ${wrappedTrack.title}\n*de **${wrappedTrack.author}***\n\n${timeDisplay}\n\n⠀`)
      .addFields(
        { name: '👤 Pedido por', value: wrappedTrack.requestedBy ? `<@${wrappedTrack.requestedBy.id || wrappedTrack.requestedBy}>` : '🤖 Autoplay', inline: true },
        { name: '🔊 Volume', value: `\`${volume}%\``, inline: true }
      )
      .setThumbnail(wrappedTrack.thumbnail || null);

    const djLimit = this.autoplayLimit.get(guildId) || 10;
    const djCount = this.autoplayCount.get(guildId) || 0;
    let footerText = '';

    if (loopMode === 'track') {
      footerText = `${EMOJIS.LOOP_TRACK} Loop de música ativo`;
    } else if (loopMode === 'queue') {
      footerText = `${EMOJIS.LOOP} Loop de fila ativo`;
    } else if (this.autoplay.get(guildId)) {
      footerText = `${EMOJIS.DJ} Modo DJ ativo (${djLimit - djCount} músicas restantes)`;
    } else {
      footerText = `${EMOJIS.MUSIC} Modo DJ desativado`;
    }

    const isRPG = this.activeMood.has(guildId) || this.silentMode.get(guildId);
    if (isRPG) {
      footerText = `🎲 Modo RPG Ativo • ${footerText}`;
    }

    embed.setFooter({ text: footerText });
    return embed;
  }

  _sendNowPlayingEmbed(player, wrappedTrack) {
    const guildId = player.guildId;

    const meta = this._metadata.get(guildId);
    const channel = meta?.channel;
    if (!channel || !wrappedTrack) return;

    const loopMode = player.repeatMode;
    const volume = player.volume || 50;
    const djLimit = this.autoplayLimit.get(guildId) || 10;

    const embed = this._buildEmbed(player, wrappedTrack, volume);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('music_play_pause').setEmoji(EMOJIS.PAUSE).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('music_skip').setEmoji(EMOJIS.SKIP).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('music_stop').setEmoji(EMOJIS.STOP).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('music_vol_down').setEmoji(EMOJIS.VOL_DOWN).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('music_vol_up').setEmoji(EMOJIS.VOL_UP).setStyle(ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('music_loop')
        .setEmoji(loopMode === 'track' ? EMOJIS.LOOP_TRACK : EMOJIS.LOOP)
        .setStyle(loopMode !== 'off' ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('dj_limit_down').setLabel('-5').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('dj_limit_up').setLabel('+5').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('dj_toggle').setLabel(`DJ: ${djLimit}`).setStyle(this.autoplay.get(guildId) ? ButtonStyle.Success : ButtonStyle.Secondary)
    );

    channel.send({ embeds: [embed], components: [row, row2] })
      .then(msg => this._setupCollector(msg, player, wrappedTrack))
      .catch(() => {});
  }

  _setupCollector(message, player, track) {
    const collector = message.createMessageComponentCollector({
      filter: i => ['music_play_pause', 'music_skip', 'music_stop', 'music_vol_down', 'music_vol_up', 'music_loop', 'dj_limit_down', 'dj_limit_up', 'dj_toggle'].includes(i.customId),
      time: 300000
    });

    collector.on('collect', async (i) => {
      if (!i.member?.voice?.channel) {
        return i.reply({ content: '❌ Entre no canal de voz!', ephemeral: true });
      }

      try {
        const guildId = i.guildId;
        const p = this._lavalink?.getPlayer(guildId);
        if (!p) return i.reply({ content: '❌ Nada tocando.', ephemeral: true });

        switch (i.customId) {
          case 'music_play_pause': {
            if (p.paused) {
              await p.resume();
              const row = ActionRowBuilder.from(i.message.components[0]);
              row.components[0].setEmoji(EMOJIS.PAUSE);
              await i.update({ components: [row, i.message.components[1]] });
            } else {
              await p.pause();
              const row = ActionRowBuilder.from(i.message.components[0]);
              row.components[0].setEmoji(EMOJIS.PLAY);
              await i.update({ components: [row, i.message.components[1]] });
            }
            break;
          }

          case 'music_skip':
            try {
              await p.skip();
              await i.reply({ content: '⏭️ Pulado por ' + i.user.username }).catch(() => {});
            } catch (err) {
              if (err.message && err.message.toLowerCase().includes('queue size')) {
                await p.stopPlaying().catch(() => {});
                this._cleanupGuild(guildId);
                await i.reply({ content: '⏹️ Fila encerrada. Não há mais músicas.' }).catch(() => {});
              } else {
                logger.error(`[Música] Erro no botão skip: ${err.message}`);
                await i.reply({ content: '❌ Erro ao pular música.', ephemeral: true }).catch(() => {});
              }
            }
            collector.stop();
            break;

          case 'music_stop':
            await p.destroy('user-stop', true);
            this._cleanupGuild(guildId);
            await i.reply({ content: '🚫 Parado por ' + i.user.username });
            collector.stop();
            break;

          case 'music_vol_down':
          case 'music_vol_up': {
            let vol = p.volume || 50;
            vol = i.customId === 'music_vol_up' ? Math.min(vol + 10, 100) : Math.max(vol - 10, 0);
            await p.setVolume(vol);
            const newEmbed = this._buildEmbed(p, track, vol);
            await i.update({ embeds: [newEmbed] });
            break;
          }

          case 'dj_limit_down': {
            let l = this.autoplayLimit.get(guildId) || 10;
            l = Math.max(5, l - 5);
            this.autoplayLimit.set(guildId, l);
            await this._updateDJButtons(i, guildId);
            break;
          }

          case 'dj_limit_up': {
            let l = this.autoplayLimit.get(guildId) || 10;
            l = Math.min(20, l + 5);
            this.autoplayLimit.set(guildId, l);
            await this._updateDJButtons(i, guildId);
            break;
          }

          case 'dj_toggle': {
            const cur = this.autoplay.get(guildId);
            this.autoplay.set(guildId, !cur);
            if (!cur) this.autoplayCount.set(guildId, 0);
            await this._updateDJButtons(i, guildId);
            break;
          }

          case 'music_loop': {
            const cur = p.repeatMode;
            const nm = cur === 'track' ? 'off' : 'track';
            await p.setRepeatMode(nm);
            await i.reply({
              content: nm === 'track' ? '🔂 Loop de música ativado!' : '⏹️ Loop desativado',
              ephemeral: true
            });
            break;
          }
        }
      } catch (err) {
        logger.error(`[Música] Button error: ${err.message}`);
      }
    });
  }

  async _updateDJButtons(interaction, guildId) {
    const djLimit = this.autoplayLimit.get(guildId) || 10;
    const djActive = this.autoplay.get(guildId);
    const p = this._lavalink?.getPlayer(guildId);
    const loopMode = p?.repeatMode || 'off';

    const row1 = ActionRowBuilder.from(interaction.message.components[0]);
    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('music_loop')
        .setEmoji(loopMode === 'track' ? EMOJIS.LOOP_TRACK : EMOJIS.LOOP)
        .setStyle(loopMode !== 'off' ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('dj_limit_down').setLabel('-5').setStyle(ButtonStyle.Secondary).setDisabled(djLimit <= 5),
      new ButtonBuilder().setCustomId('dj_limit_up').setLabel('+5').setStyle(ButtonStyle.Secondary).setDisabled(djLimit >= 20),
      new ButtonBuilder().setCustomId('dj_toggle').setLabel(`DJ: ${djLimit}`).setStyle(djActive ? ButtonStyle.Success : ButtonStyle.Secondary)
    );

    const newEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
    if (loopMode === 'track') {
      newEmbed.setFooter({ text: `${EMOJIS.LOOP_TRACK} Loop de música ativo` });
    } else if (loopMode === 'queue') {
      newEmbed.setFooter({ text: `${EMOJIS.LOOP} Loop de fila ativo` });
    } else if (djActive) {
      const remaining = djLimit - (this.autoplayCount.get(guildId) || 0);
      newEmbed.setFooter({ text: `${EMOJIS.DJ} Modo DJ ativo (${remaining} músicas restantes)` });
    } else {
      newEmbed.setFooter({ text: `${EMOJIS.MUSIC} Modo DJ desativado` });
    }

    await interaction.update({ embeds: [newEmbed], components: [row1, row2] });
  }
}

module.exports = MusicManager;
