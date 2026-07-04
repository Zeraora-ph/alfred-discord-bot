const express = require('express');
const session = require('express-session');
const cors = require('cors');
const bcrypt = require('bcrypt');
const path = require('path');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const fetch = require('node-fetch');

const factStore = require('./lib/fact-store');
const logger = require('./lib/logger');
const discordClient = require('./lib/discord-client');
const discordManager = discordClient.manager;
const {
  validateRequest,
  validateQuery,
  whitelistSchema,
  memorySearchSchema,
  bulkDeleteSchema,
  loginSchema,
  paginationSchema,
  sanitizeLikeInput
} = require('./middleware/validation');

// ========================================
// VALIDAÇÃO DE VARIÁVEIS DE AMBIENTE CRÍTICAS
// ========================================
if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
  logger.error('❌ CRÍTICO: ADMIN_USERNAME e ADMIN_PASSWORD devem ser definidos nas variáveis de ambiente');
  logger.error('💡 Defina essas variáveis no arquivo .env antes de iniciar o servidor');
  process.exit(1);
}

if (process.env.ADMIN_PASSWORD.length < 12) {
  logger.error('❌ CRÍTICO: ADMIN_PASSWORD deve ter no mínimo 12 caracteres');
  logger.error('💡 Use uma senha forte com letras, números e símbolos');
  process.exit(1);
}

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  logger.error('❌ CRÍTICO: SESSION_SECRET deve ter no mínimo 32 caracteres');
  logger.error('💡 Gere um: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

logger.info('✅ Variáveis de ambiente validadas com sucesso');

const app = express();
const PORT = process.env.WEB_PORT || 3000;

// Configuração de sessão (ajustada para ambiente HTTP/IP)
app.set('trust proxy', 1); // Importante para cloud/proxy/docker
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // true apenas em produção com HTTPS
    httpOnly: true, // Previne XSS
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 24 horas
  }
}));

// ========================================
// RATE LIMITING - Proteção contra Força Bruta
// ========================================

// Rate limiter geral para API
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // máximo de 100 requisições por IP
  message: { error: 'Muitas requisições. Tente novamente em 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter estrito para login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // máximo de 5 tentativas de login
  message: { error: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
  skipSuccessfulRequests: true, // Não conta requisições bem-sucedidas
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter para operações de escrita (POST/DELETE)
const writeLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutos
  max: 30, // máximo de 30 operações de escrita
  message: { error: 'Muitas operações. Tente novamente em 5 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ========================================
// CORS CONFIGURATION - Security Hardening
// ========================================
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

// In development, allow all origins for convenience
if (process.env.NODE_ENV !== 'production') {
  corsOptions.origin = true;
}

app.use(cors(corsOptions));

// Response compression for performance
const compression = require('compression');
app.use(compression({
  level: 6, // Balanced compression level
  threshold: 1024, // Only compress responses > 1KB
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  }
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'web')));

// Aplicar rate limiter geral em todas as rotas /api
app.use('/api/', apiLimiter);

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new DiscordStrategy({
  clientID: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  callbackURL: 'http://129.148.31.44:3000/auth/discord/callback',
  scope: ['identify', 'guilds']
}, (accessToken, refreshToken, profile, done) => {
  process.nextTick(() => done(null, profile));
}));

app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback',
  passport.authenticate('discord', { failureRedirect: '/' }),
  (req, res) => res.redirect('/'));

app.get('/logout', (req, res) => {
  req.logout(() => {
    req.session.destroy(() => {
      res.redirect('/');
    });
  });
});

// Middleware de autenticação (aceita admin manual OU Discord)
function requireAuth(req, res, next) {
  if (req.session.authenticated || req.isAuthenticated?.()) {
    next();
  } else {
    res.status(401).json({ error: 'Não autorizado' });
  }
}

// Rota de login (SEM CREDENCIAIS HARDCODED + VALIDAÇÃO + RATE LIMIT)
app.post('/api/login', loginLimiter, validateRequest(loginSchema), async (req, res) => {
  const { username, password } = req.validated;

  // Verificar credenciais das variáveis de ambiente (validadas na inicialização)
  const adminUser = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (username === adminUser && password === adminPassword) {
    req.session.authenticated = true;
    req.session.user = username;
    logger.info(`✅ Login bem-sucedido: ${username}`);
    res.json({ success: true, message: 'Login realizado com sucesso' });
  } else {
    logger.warn(`⚠️ Tentativa de login falha: ${username}`);
    res.status(401).json({ error: 'Credenciais inválidas' });
  }
});

// Rota de logout
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true, message: 'Logout realizado com sucesso' });
});

// Verificar status de autenticação
app.get('/api/auth/status', (req, res) => {
  console.log('🔍 DEBUG /api/auth/status:');
  console.log('  - req.session.authenticated:', !!req.session.authenticated);
  console.log('  - req.isAuthenticated():', typeof req.isAuthenticated === 'function' ? req.isAuthenticated() : 'não é função');
  console.log('  - req.user:', req.user);
  console.log('  - req.session.user:', req.session.user);

  const isAuthenticated = !!req.session.authenticated || (typeof req.isAuthenticated === 'function' && req.isAuthenticated());
  let user = null;

  if (req.session.authenticated) {
    user = { username: req.session.user, isAdmin: true };
    console.log('  - Usando login manual, user:', user);
  } else if (typeof req.isAuthenticated === 'function' && req.isAuthenticated()) {
    user = req.user?.username || req.user?.displayName || req.user?.id || null;
    console.log('  - Usando login Discord, user:', user);
  }

  console.log('  - Resultado final: authenticated:', isAuthenticated, 'user:', user);

  res.json({ authenticated: isAuthenticated, user });
});

// API Routes (protegidas)
app.get('/api/memories', requireAuth, (req, res) => {
  try {
    const { guild_id, user_id, limit = 50, offset = 0 } = req.query;
    let allowedGuilds = null;
    // Se autenticado via Discord, filtra apenas guilds onde o usuário é admin
    if (req.user && Array.isArray(req.user.guilds)) {
      allowedGuilds = req.user.guilds
        .filter(g => (g.permissions & 0x8) === 0x8) // 0x8 = ADMINISTRATOR
        .map(g => String(g.id));
    }
    let query = 'SELECT * FROM memories WHERE 1=1';
    const params = [];
    if (allowedGuilds && allowedGuilds.length > 0) {
      query += ' AND guild_id IN (' + allowedGuilds.map(() => '?').join(',') + ')';
      params.push(...allowedGuilds);
    }
    if (guild_id) {
      query += ' AND guild_id = ?';
      params.push(guild_id);
    }
    if (user_id) {
      query += ' AND user_id = ?';
      params.push(user_id);
    }
    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    const memories = factStore.db.prepare(query).all(...params);
    // Corrigir total para refletir apenas as memórias visíveis
    let total = memories.length;
    if (!allowedGuilds) {
      // Admin manual: mostra total real
      total = factStore.db.prepare('SELECT COUNT(*) as count FROM memories').get().count;
    }
    res.json({
      memories,
      total,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    logger.error('Erro ao buscar memórias:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Buscar memórias por similaridade (COM VALIDAÇÃO + SANITIZAÇÃO)
app.get('/api/memories/search', requireAuth, validateQuery(memorySearchSchema), (req, res) => {
  try {
    const { guild_id, user_id, query: searchQuery } = req.validated;

    // Sanitize input for LIKE query to prevent SQL injection
    const sanitizedQuery = sanitizeLikeInput(searchQuery);

    const query = `
      SELECT * FROM memories 
      WHERE guild_id = ? 
      AND (user_id = ? OR user_id IS NULL)
      AND message LIKE ? ESCAPE '\\'
      ORDER BY timestamp DESC 
      LIMIT 20
    `;

    const memories = factStore.db.prepare(query).all(
      guild_id,
      user_id,
      `%${sanitizedQuery}%`
    );

    res.json({ memories });
  } catch (error) {
    logger.error('Erro ao buscar memórias:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Deletar memória
app.delete('/api/memories/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;

    const result = factStore.db.prepare('DELETE FROM memories WHERE id = ?').run(id);

    if (result.changes > 0) {
      res.json({ success: true, message: 'Memória deletada com sucesso' });
    } else {
      res.status(404).json({ error: 'Memória não encontrada' });
    }
  } catch (error) {
    logger.error('Erro ao deletar memória:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Deletar memórias em massa (COM VALIDAÇÃO + RATE LIMIT)
app.post('/api/memories/bulk-delete', writeLimiter, requireAuth, validateRequest(bulkDeleteSchema), (req, res) => {
  try {
    const { ids } = req.validated;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'IDs são obrigatórios' });
    }

    const placeholders = ids.map(() => '?').join(',');
    const result = factStore.db.prepare(`DELETE FROM memories WHERE id IN (${placeholders})`).run(...ids);

    res.json({
      success: true,
      message: `${result.changes} memórias deletadas com sucesso`
    });
  } catch (error) {
    logger.error('Erro ao deletar memórias:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Limpar memórias por servidor/usuário
app.post('/api/memories/clear', requireAuth, (req, res) => {
  try {
    const { guild_id, user_id } = req.body;

    let query = 'DELETE FROM memories WHERE 1=1';
    const params = [];

    if (guild_id) {
      query += ' AND guild_id = ?';
      params.push(guild_id);
    }

    if (user_id) {
      query += ' AND user_id = ?';
      params.push(user_id);
    }

    const result = factStore.db.prepare(query).run(...params);

    res.json({
      success: true,
      message: `${result.changes} memórias removidas com sucesso`
    });
  } catch (error) {
    logger.error('Erro ao limpar memórias:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Estatísticas
app.get('/api/stats', requireAuth, (req, res) => {
  try {
    const stats = {
      totalMemories: factStore.db.prepare('SELECT COUNT(*) as count FROM memories').get().count,
      totalGuilds: factStore.db.prepare('SELECT COUNT(DISTINCT guild_id) as count FROM memories').get().count,
      totalUsers: factStore.db.prepare('SELECT COUNT(DISTINCT user_id) as count FROM memories').get().count,
      recentMemories: factStore.db.prepare('SELECT COUNT(*) as count FROM memories WHERE timestamp > datetime(\'now\', \'-24 hours\')').get().count,
      topGuilds: factStore.db.prepare(`
        SELECT guild_id, COUNT(*) as count 
        FROM memories 
        GROUP BY guild_id 
        ORDER BY count DESC 
        LIMIT 10
      `).all(),
      topUsers: factStore.db.prepare(`
        SELECT user_id, COUNT(*) as count 
        FROM memories 
        GROUP BY user_id 
        ORDER BY count DESC 
        LIMIT 10
      `).all()
    };

    res.json(stats);
  } catch (error) {
    logger.error('Erro ao buscar estatísticas:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Gerenciar permissões
app.get('/api/permissions', requireAuth, (req, res) => {
  try {
    const permissions = factStore.db.prepare('SELECT * FROM permissions').all();
    res.json(permissions);
  } catch (error) {
    logger.error('Erro ao buscar permissões:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.post('/api/permissions', requireAuth, (req, res) => {
  try {
    const { guild_id, role } = req.body;
    factStore.setPermission(guild_id, role);
    res.json({ success: true, message: 'Permissão configurada com sucesso' });
  } catch (error) {
    logger.error('Erro ao configurar permissão:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Gerenciar whitelist
app.get('/api/whitelist/:guild_id', requireAuth, (req, res) => {
  try {
    const { guild_id } = req.params;
    const whitelist = factStore.getWhitelist(guild_id);
    res.json(whitelist);
  } catch (error) {
    logger.error('Erro ao buscar whitelist:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.post('/api/whitelist', writeLimiter, requireAuth, validateRequest(whitelistSchema), (req, res) => {
  try {
    const { guild_id, type, id } = req.validated;
    factStore.addToWhitelist(guild_id, type, id);
    logger.info(`✅ Whitelist atualizada: ${type}/${id} adicionado à guild ${guild_id}`);
    res.json({ success: true, message: 'Item adicionado à whitelist' });
  } catch (error) {
    logger.error('Erro ao adicionar à whitelist:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.delete('/api/whitelist/:guild_id/:type/:id', requireAuth, (req, res) => {
  try {
    const { guild_id, type, id } = req.params;
    factStore.removeFromWhitelist(guild_id, type, id);
    res.json({ success: true, message: 'Item removido da whitelist' });
  } catch (error) {
    logger.error('Erro ao remover da whitelist:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// === Endpoints de whitelist global de servidores ===
// Listar whitelist global
app.get('/api/guild-whitelist', requireAuth, (req, res) => {
  const list = factStore.getGuildWhitelist();
  res.json({ whitelist: list });
});
// Adicionar guild à whitelist global (apenas admin)
app.post('/api/guild-whitelist', writeLimiter, requireAuth, (req, res) => {
  if (!req.session.authenticated && !(req.user && req.user.isAdmin)) {
    return res.status(403).json({ error: 'Apenas admin pode modificar a whitelist global.' });
  }
  const { guildId } = req.body;
  if (!guildId) return res.status(400).json({ error: 'guildId obrigatório' });
  factStore.addGuildToWhitelist(guildId);
  res.json({ success: true });
});
// Remover guild da whitelist global (apenas admin)
app.delete('/api/guild-whitelist/:guildId', requireAuth, (req, res) => {
  if (!req.session.authenticated && !(req.user && req.user.isAdmin)) {
    return res.status(403).json({ error: 'Apenas admin pode modificar a whitelist global.' });
  }
  const { guildId } = req.params;
  factStore.removeGuildFromWhitelist(guildId);
  res.json({ success: true });
});

// === Endpoints de informações customizadas do servidor ===
app.get('/api/guild-info/:guildId', requireAuth, (req, res) => {
  const { guildId } = req.params;
  const data = factStore.getGuildInfo(guildId);
  res.json(data);
});
app.post('/api/guild-info/:guildId', writeLimiter, requireAuth, (req, res) => {
  const { guildId } = req.params;
  const { info, persona } = req.body;
  factStore.setGuildInfo(guildId, info || '', persona || '');
  res.json({ success: true });
});

// Endpoint para retornar apenas os IDs dos servidores do bot
app.get('/api/bot-guild-ids', requireAuth, async (req, res) => {
  try {
    const guilds = await discordManager.getGuilds();
    const botGuildIds = guilds.map(g => String(g.id));
    res.json({ botGuildIds });
  } catch (error) {
    logger.error('Erro ao buscar guilds do bot:', error);
    res.status(500).json({ error: 'Erro ao buscar servidores do bot' });
  }
});

// Rota para retornar guilds do usuário autenticado via Discord
app.get('/api/guilds', requireAuth, async (req, res) => {
  try {
    // Usa o manager que garante conexão e cache atualizado
    const allBotGuilds = await discordManager.getGuilds();

    let userGuildIds = [];
    if (req.user && Array.isArray(req.user.guilds) && req.user.guilds.length > 0) {
      userGuildIds = req.user.guilds.map(g => String(g.id));
    }
    const userGuildIdSet = new Set(userGuildIds);

    // Marca quais são em comum
    const guilds = allBotGuilds.map(g => ({
      ...g,
      in_common: userGuildIdSet.has(g.id)
    }));

    res.json({
      guilds,
      userGuildIds,
      debug: {
        botGuildIds: allBotGuilds.map(g => g.id),
        userGuildIds,
        commonGuildIds: guilds.filter(g => g.in_common).map(g => g.id)
      }
    });
  } catch (error) {
    logger.error('Erro ao buscar guilds:', error);
    res.status(500).json({ error: 'Erro ao buscar servidores' });
  }
});

// Endpoint para listar membros de um servidor
app.get('/api/guild-members/:guildId', requireAuth, async (req, res) => {
  try {
    const guild = discordClient.guilds.cache.get(req.params.guildId);
    if (!guild) {
      logger.warn(`[API] Guild não encontrada no cache: ${req.params.guildId}`);
      return res.status(404).json({ error: 'Servidor não encontrado ou bot não está nele.' });
    }

    // Use cached members - they're already loaded when bot starts
    // Only fetch if cache is nearly empty (less than 5 members)
    if (guild.members.cache.size < 5) {
      try {
        await Promise.race([
          guild.members.fetch({ time: 8000 }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
        ]);
      } catch (e) {
        logger.warn(`[API] Fetch de membros falhou, usando cache existente`);
      }
    }

    const members = guild.members.cache.map(m => ({
      id: m.id,
      name: m.displayName || m.user.username,
      avatar: m.user.displayAvatarURL({ size: 64 }),
      isAdmin: m.permissions.has('Administrator')
    }));

    logger.info(`[API] Retornando ${members.length} membros do servidor ${guild.name}`);
    res.json(members);
  } catch (e) {
    logger.error(`[API] Erro ao buscar membros: ${e.message}`);
    res.status(500).json({ error: 'Erro ao buscar membros do servidor: ' + e.message });
  }
});

// Rota para buscar nomes de usuários
app.get('/api/usernames', requireAuth, async (req, res) => {
  const { guild_id, user_ids } = req.query;
  if (!guild_id || !user_ids) return res.json({});
  const ids = Array.isArray(user_ids) ? user_ids : user_ids.split(',');
  const result = {};
  
  // Inicializar com o próprio ID como fallback
  for (const id of ids) {
    result[id] = id;
  }

  try {
    const guild = discordClient.guilds.cache.get(guild_id) || await discordClient.guilds.fetch(guild_id);
    if (!guild) return res.json(result);

    const missingIds = [];

    // Tentar obter do cache de membros da guilda primeiro
    for (const id of ids) {
      const cachedMember = guild.members.cache.get(id);
      if (cachedMember) {
        result[id] = cachedMember.user.discriminator && cachedMember.user.discriminator !== '0'
          ? `${cachedMember.user.username}#${cachedMember.user.discriminator}`
          : cachedMember.user.username;
      } else {
        missingIds.push(id);
      }
    }

    // Buscar em lote do Discord apenas os IDs que faltam no cache
    if (missingIds.length > 0) {
      try {
        const fetchedMembers = await guild.members.fetch({ user: missingIds });
        fetchedMembers.forEach(member => {
          result[member.id] = member.user.discriminator && member.user.discriminator !== '0'
            ? `${member.user.username}#${member.user.discriminator}`
            : member.user.username;
        });
      } catch (fetchError) {
        logger.warn(`[API] Erro ao buscar membros em lote para a guilda ${guild_id}: ${fetchError.message}. Tentando individualmente.`);
        // Fallback um por um se falhar a busca em lote
        for (const id of missingIds) {
          try {
            const member = await guild.members.fetch(id);
            result[id] = member.user.discriminator && member.user.discriminator !== '0'
              ? `${member.user.username}#${member.user.discriminator}`
              : member.user.username;
          } catch {
            result[id] = id;
          }
        }
      }
    }

    res.json(result);
  } catch (error) {
    logger.error(`[API] Erro ao buscar usernames para guilda ${guild_id}:`, error);
    res.json(result);
  }
});

// ========================================
// CONTROLE DE MÚSICA (REMOTE CONTROL)
// ========================================

app.post('/api/music/control', requireAuth, async (req, res) => {
  const { action, guildId, value } = req.body;

  if (!guildId) return res.status(400).json({ error: 'guildId é obrigatório' });
  if (!discordClient.musicPlayer) return res.status(503).json({ error: 'Sistema de música não disponível' });

  // Resolver guild usando o cache primeiro
  const guild = discordClient.guilds.cache.get(guildId) || await discordClient.guilds.fetch(guildId).catch(() => null);
  if (!guild) return res.status(404).json({ error: 'Servidor não encontrado' });

  // Mock message to interface with MusicManager
  // Warning: "author" will be the bot itself or a fake user, voice channel checks might fail if not properly mocked
  // Better approach: Call methods directly on musicPlayer if possible, or construct a robust mock.

  const mockMessage = {
    guild: guild,
    guildId: guildId,
    channel: { send: () => { }, id: 'web-control' }, // Mock text channel
    member: {
      voice: { channel: { id: 'voice-id', name: 'Web Control' } } // Mock voice channel (bypass check?)
    },
    author: { username: 'WebUser', id: 'web-user' },
    reply: (content) => {
      // Intercept reply for API response
      return Promise.resolve({ edit: () => { } });
    }
  };

  // We need to bypass "Voice Channel" checks in MusicManager if the user is on Web
  // Actually, MusicManager checks if Member is in voice.
  // The Web User is NOT in voice technically unless we link them to a discord ID.
  // For now, we will try to execute commands directly or mock harder.

  try {
    const player = discordClient.musicPlayer;
    let result = { success: true };

    switch (action) {
      case 'pause':
        // Direct player manipulation is safer than mocking message
        const pPause = player.players.get(guildId);
        if (pPause) await pPause.pause();
        break;
      case 'resume':
        const pResume = player.players.get(guildId);
        if (pResume) await pResume.resume();
        break;
      case 'skip':
        await player.skip(mockMessage); // Recycles skip logic
        break;
      case 'stop':
        await player.stop(mockMessage);
        break;
      case 'volume':
        await player.setVolume(mockMessage, parseInt(value));
        break;
      case 'autoplay':
        // Direct toggle
        const curr = player.autoplay.get(guildId) || false;
        player.autoplay.set(guildId, !curr);
        result.state = !curr;
        break;
      default:
        return res.status(400).json({ error: 'Ação inválida' });
    }

    res.json(result);
  } catch (error) {
    logger.error(`[API] Music Control Error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para estado atual
app.get('/api/music/status/:guildId', requireAuth, async (req, res) => {
  const guildId = req.params.guildId;
  if (!discordClient.musicPlayer) return res.json({ playing: false });

  const player = discordClient.musicPlayer;
  const audioPlayer = player.players.get(guildId);
  const queue = player.queues.get(guildId);
  
  const isPlaying = audioPlayer ? audioPlayer.playing : false;
  const currentTrack = queue ? queue.currentTrack : null;
  
  res.json({
    playing: isPlaying,
    current: currentTrack ? { ...currentTrack, artist: currentTrack.author } : null,
    queueLength: queue ? queue.tracks.size : 0,
    volume: audioPlayer?.volume || 50,
    autoplay: player.autoplay?.get(guildId) || false
  });
});
// Endpoint para retornar todos os servidores do bot (para garantir nomes no Top Servidores)
app.get('/api/bot-guilds', requireAuth, async (req, res) => {
  try {
    const guilds = await discordManager.getGuilds();
    res.json({ guilds });
  } catch (error) {
    logger.error('Erro ao buscar guilds do bot:', error);
    res.status(500).json({ error: 'Erro ao buscar servidores do bot' });
  }
});

// ========================================
// 🔥 SISTEMA DE RELACIONAMENTO
// ========================================

// Listar todos os relacionamentos de um servidor (agrupados por usuário)
app.get('/api/relationships/:guildId', requireAuth, (req, res) => {
  try {
    const { guildId } = req.params;
    const { userId } = req.query;

    let query = `
      SELECT r.*, 
        (SELECT COUNT(*) FROM user_relationships WHERE guild_id = ? AND user_id = r.user_id) as note_count
      FROM user_relationships r
      WHERE r.guild_id = ?
    `;
    const params = [guildId, guildId];

    if (userId) {
      query += ' AND r.user_id = ?';
      params.push(userId);
    }

    query += ' ORDER BY r.timestamp DESC LIMIT 100';

    const relationships = factStore.db.prepare(query).all(...params);

    // Agrupar por usuário
    const grouped = {};
    for (const r of relationships) {
      if (!grouped[r.user_id]) {
        grouped[r.user_id] = {
          user_id: r.user_id,
          username: r.username,
          notes: [],
          note_count: r.note_count
        };
      }
      grouped[r.user_id].notes.push({
        id: r.id,
        note: r.note,
        category: r.category,
        timestamp: r.timestamp
      });
    }

    res.json({
      relationships: Object.values(grouped),
      total: relationships.length
    });
  } catch (error) {
    logger.error('Erro ao buscar relacionamentos:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Buscar notas de um usuário específico
app.get('/api/relationships/:guildId/:userId', requireAuth, (req, res) => {
  try {
    const { guildId, userId } = req.params;

    const notes = factStore.db.prepare(`
      SELECT * FROM user_relationships 
      WHERE guild_id = ? AND user_id = ?
      ORDER BY timestamp DESC
    `).all(guildId, userId);

    res.json({ notes });
  } catch (error) {
    logger.error('Erro ao buscar notas do usuário:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Deletar uma nota de relacionamento
app.delete('/api/relationships/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;

    const result = factStore.db.prepare('DELETE FROM user_relationships WHERE id = ?').run(id);

    if (result.changes > 0) {
      res.json({ success: true, message: 'Nota deletada com sucesso' });
    } else {
      res.status(404).json({ error: 'Nota não encontrada' });
    }
  } catch (error) {
    logger.error('Erro ao deletar nota:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Estatísticas de relacionamentos
app.get('/api/relationships-stats', requireAuth, (req, res) => {
  try {
    const stats = {
      totalNotes: factStore.db.prepare('SELECT COUNT(*) as count FROM user_relationships').get().count,
      totalUsers: factStore.db.prepare('SELECT COUNT(DISTINCT user_id) as count FROM user_relationships').get().count,
      totalGuilds: factStore.db.prepare('SELECT COUNT(DISTINCT guild_id) as count FROM user_relationships').get().count,
      topUsers: factStore.db.prepare(`
        SELECT user_id, username, COUNT(*) as count 
        FROM user_relationships 
        GROUP BY user_id 
        ORDER BY count DESC 
        LIMIT 10
      `).all()
    };

    res.json(stats);
  } catch (error) {
    logger.error('Erro ao buscar estatísticas de relacionamentos:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Endpoint para verificar status da conexão Discord
app.get('/api/discord-status', requireAuth, (req, res) => {
  try {
    const status = discordManager.getStatus();
    res.json({
      success: true,
      status,
      message: status.isReady ? 'Discord conectado' : 'Discord desconectado'
    });
  } catch (error) {
    logger.error('Erro ao verificar status do Discord:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao verificar status do Discord',
      details: error.message
    });
  }
});

// ========================================
// SYSTEM MONITORING APIs
// ========================================
const os = require('os');
const fs = require('fs');

// System Stats
app.get('/api/system/stats', requireAuth, (req, res) => {
  try {
    const cpus = os.cpus();
    const loadAvg = os.loadavg()[0];
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const uptimeSeconds = process.uptime();

    // Calculate CPU percentage (load avg / cores * 100)
    const cpuPercent = Math.min(100, (loadAvg / cpus.length) * 100).toFixed(1);

    // Format uptime
    const hours = Math.floor(uptimeSeconds / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const uptimeFormatted = `${hours}h ${minutes}m`;

    // Get Discord latency if available
    let latency = '-';
    if (discordClient && discordClient.ws && discordClient.ws.ping > 0) {
      latency = discordClient.ws.ping;
    }

    res.json({
      cpu: parseFloat(cpuPercent),
      ram: {
        used: Math.round(usedMem / 1024 / 1024),
        total: Math.round(totalMem / 1024 / 1024),
        percent: ((usedMem / totalMem) * 100).toFixed(1)
      },
      uptime: uptimeFormatted,
      uptimeSeconds: Math.floor(uptimeSeconds),
      latency,
      platform: os.platform(),
      arch: os.arch()
    });
  } catch (error) {
    logger.error('Erro ao buscar stats do sistema:', error);
    res.status(500).json({ error: 'Erro ao buscar estatísticas do sistema' });
  }
});

// System Logs
app.get('/api/system/logs', requireAuth, (req, res) => {
  try {
    const logPath = path.join(__dirname, '..', 'combined.log');
    const limit = parseInt(req.query.limit) || 100;

    if (!fs.existsSync(logPath)) {
      return res.json({ logs: ['Arquivo de log não encontrado.'] });
    }

    const content = fs.readFileSync(logPath, 'utf-8');
    const lines = content.trim().split('\n').slice(-limit);

    // Parse JSON logs if possible
    const parsedLogs = lines.map(line => {
      try {
        const parsed = JSON.parse(line);
        const time = parsed.timestamp ? new Date(parsed.timestamp).toLocaleTimeString('pt-BR') : '';
        return `[${time}] [${parsed.level?.toUpperCase() || 'INFO'}] ${parsed.message}`;
      } catch {
        return line;
      }
    });

    res.json({ logs: parsedLogs });
  } catch (error) {
    logger.error('Erro ao buscar logs:', error);
    res.status(500).json({ error: 'Erro ao buscar logs' });
  }
});

// Daily Stats
app.get('/api/stats/daily', requireAuth, (req, res) => {
  res.json(discordClient.stats || { commandsExecuted: 0, songsPlayed: 0 });
});

// Music Status (all guilds overview)
app.get('/api/music/status', requireAuth, (req, res) => {
  try {
    const musicPlayer = discordClient.musicPlayer;
    if (!musicPlayer) {
      return res.json({ connected: false, players: [] });
    }

    const players = [];

    // Lavalink: iterar sobre queues ativas (façade)
    if (musicPlayer.queues?.cache) {
      for (const queue of musicPlayer.queues.cache.values()) {
        const guildId = queue.guild.id;
        const guild = discordClient.guilds.cache.get(guildId);
        const currentTrack = queue.currentTrack;

        if (currentTrack) {
          players.push({
            guildName: guild ? guild.name : 'Desconhecido',
            guildId: guildId,
            trackTitle: currentTrack.title,
            trackAuthor: currentTrack.author || 'Desconhecido',
            duration: currentTrack.duration,
            isPaused: queue.node.isPaused()
          });
        }
      }
    }

    res.json({
      connected: true,
      activePlayers: players.length,
      players: players
    });

  } catch (error) {
    logger.error('Erro ao buscar status música:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// System Restart
app.post('/api/system/restart', requireAuth, (req, res) => {
  // Only allow admin to restart
  if (!req.session.authenticated) {
    return res.status(403).json({ error: 'Apenas admin pode reiniciar o sistema.' });
  }

  logger.warn('⚠️ Sistema reiniciando via painel admin...');
  res.json({ success: true, message: 'Sistema reiniciando...' });

  // Exit after response is sent (PM2/Docker will restart)
  setTimeout(() => {
    process.exit(0);
  }, 1000);
});

// Rota principal - redireciona para o painel
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'web', 'index.html'));
});

// Iniciar servidor
app.listen(PORT, () => {
  logger.info(`🚀 Painel web iniciado na porta ${PORT}`);
  logger.info(`📊 Acesse: http://localhost:${PORT}`);
});

module.exports = app; 