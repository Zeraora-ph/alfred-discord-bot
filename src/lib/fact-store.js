const Database = require('better-sqlite3');
const path = require('path');

// Cria/abre o banco local memory.db
const db = new Database(path.join(__dirname, '../../memory.db'));

db.prepare(`
  CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT,
    user_id TEXT,
    message TEXT,
    embedding TEXT, -- Novo campo para armazenar o embedding em JSON
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS permissions (
    guild_id TEXT PRIMARY KEY,
    role TEXT
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS whitelist (
    guild_id TEXT,
    type TEXT, -- 'user' ou 'role'
    id TEXT
  )
`).run();

// === Whitelist global de servidores ===
db.prepare(`
  CREATE TABLE IF NOT EXISTS guild_whitelist (
    guild_id TEXT PRIMARY KEY
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS guild_info (
    guild_id TEXT PRIMARY KEY,
    info TEXT,
    persona TEXT
  )
`).run();

// Nova tabela para histórico completo de conversas com o bot
db.prepare(`
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT,
    channel_id TEXT,
    user_id TEXT,
    user_message TEXT,
    bot_response TEXT,
    embedding TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

// Índice para busca rápida por guild e usuário
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_conversations_guild_user ON conversations(guild_id, user_id);
  CREATE INDEX IF NOT EXISTS idx_conversations_timestamp ON conversations(timestamp DESC);
`);

// Índices adicionais para performance
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_memories_guild_user ON memories(guild_id, user_id);
  CREATE INDEX IF NOT EXISTS idx_memories_timestamp ON memories(timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_whitelist_guild ON whitelist(guild_id);
  CREATE INDEX IF NOT EXISTS idx_permissions_guild ON permissions(guild_id);
`);

// ============================================
// 🔥 SISTEMA DE RELACIONAMENTO - Notas sobre cada usuário
// ============================================
db.prepare(`
  CREATE TABLE IF NOT EXISTS user_relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    username TEXT,
    note TEXT NOT NULL,
    category TEXT DEFAULT 'geral',
    source_user_id TEXT,
    embedding TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_relationships_user ON user_relationships(guild_id, user_id);
  CREATE INDEX IF NOT EXISTS idx_relationships_timestamp ON user_relationships(timestamp DESC);
`);

// Salva uma mensagem do usuário, agora também por servidor e com embedding opcional
function saveMemory(guildId, userId, message, embedding = null) {
  db.prepare('INSERT INTO memories (guild_id, user_id, message, embedding) VALUES (?, ?, ?, ?)')
    .run(guildId, userId, message, embedding ? JSON.stringify(embedding) : null);
  const logger = require('./logger');
  logger.info(`[MEMÓRIA] Salvo: "${message}" para user ${userId} na guild ${guildId}`);
}

// Busca mensagem semelhante do mesmo usuário e servidor
function getSimilarMemory(guildId, userId, message) {
  // Busca por substring simples (pode ser melhorado para fuzzy)
  const row = db.prepare(
    'SELECT message FROM memories WHERE guild_id = ? AND user_id = ? AND message LIKE ? ORDER BY timestamp DESC LIMIT 1'
  ).get(guildId, userId, `%${message.split(' ')[0]}%`);
  return row ? row.message : null;
}

// 🔥 NOVA: Busca por palavras-chave (fallback quando embedding não disponível)
function searchMemoriesByKeywords(guildId, userId, query, limit = 5) {
  // Extrair palavras significativas (ignorar palavras muito curtas)
  const keywords = query.toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 2)
    .filter(w => !['que', 'qual', 'quem', 'como', 'onde', 'quando', 'para', 'com', 'uma', 'esse', 'essa', 'isso'].includes(w));

  if (keywords.length === 0) return [];

  // Construir query com OR para cada palavra-chave
  const conditions = keywords.map(() => 'LOWER(message) LIKE ?').join(' OR ');
  const params = keywords.map(k => `%${k}%`);

  const rows = db.prepare(`
    SELECT message, timestamp FROM memories 
    WHERE guild_id = ? AND (user_id = ? OR user_id IS NULL)
    AND (${conditions})
    ORDER BY timestamp DESC LIMIT ?
  `).all(guildId, userId, ...params, limit);

  return rows.map(r => ({ message: r.message, score: 0.5 })); // Score fixo para fallback
}

// Permissões por servidor
function setPermission(guildId, role) {
  db.prepare('INSERT OR REPLACE INTO permissions (guild_id, role) VALUES (?, ?)')
    .run(guildId, role);
}

function getPermission(guildId) {
  const row = db.prepare('SELECT role FROM permissions WHERE guild_id = ?').get(guildId);
  return row ? row.role : 'everyone';
}

// Whitelist
function addToWhitelist(guildId, type, id) {
  db.prepare('INSERT INTO whitelist (guild_id, type, id) VALUES (?, ?, ?)')
    .run(guildId, type, id);
}

function removeFromWhitelist(guildId, type, id) {
  db.prepare('DELETE FROM whitelist WHERE guild_id = ? AND type = ? AND id = ?')
    .run(guildId, type, id);
}

function getWhitelist(guildId) {
  return db.prepare('SELECT type, id FROM whitelist WHERE guild_id = ?').all(guildId);
}

function isWhitelisted(guildId, userId, roleIds, isAdmin = false) {
  const items = getWhitelist(guildId);
  if (!items || items.length === 0) return true; // Se whitelist vazia, todos podem
  // Se está bloqueado explicitamente, não pode
  if (items.some(item => item.type === 'block' && item.id === userId)) return false;
  if (isAdmin) return true;
  for (const item of items) {
    if (item.type === 'user' && item.id === userId) return true;
    if (item.type === 'role' && roleIds.includes(item.id)) return true;
  }
  return false;
}

// === Whitelist global de servidores ===
function addGuildToWhitelist(guildId) {
  db.prepare('INSERT OR IGNORE INTO guild_whitelist (guild_id) VALUES (?)').run(guildId);
}

function removeGuildFromWhitelist(guildId) {
  db.prepare('DELETE FROM guild_whitelist WHERE guild_id = ?').run(guildId);
}

function getGuildWhitelist() {
  return db.prepare('SELECT guild_id FROM guild_whitelist').all().map(r => r.guild_id);
}

function isGuildAuthorized(guildId) {
  const row = db.prepare('SELECT guild_id FROM guild_whitelist WHERE guild_id = ?').get(guildId);
  return !!row;
}

function getGuildInfo(guildId) {
  return db.prepare('SELECT info, persona FROM guild_info WHERE guild_id = ?').get(guildId) || { info: '', persona: '' };
}

function setGuildInfo(guildId, info, persona) {
  db.prepare('INSERT OR REPLACE INTO guild_info (guild_id, info, persona) VALUES (?, ?, ?)')
    .run(guildId, info, persona);
}

// Calcula similaridade de cosseno entre dois arrays
function cosineSimilarity(a, b) {
  let dot = 0.0, normA = 0.0, normB = 0.0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Busca as top-N memórias mais próximas por embedding (do usuário OU globais)
function getTopSimilarMemories(guildId, userId, embedding, topN = 3) {
  if (!embedding) return [];
  // Busca todas as memórias do usuário e globais
  const rows = db.prepare(
    'SELECT message, embedding, user_id FROM memories WHERE guild_id = ? AND (user_id = ? OR user_id IS NULL) AND embedding IS NOT NULL'
  ).all(guildId, userId);
  // Calcula similaridade
  const scored = rows.map(row => {
    let memEmbedding;
    try {
      memEmbedding = JSON.parse(row.embedding);
    } catch {
      return null;
    }
    if (!Array.isArray(memEmbedding)) return null;
    return {
      message: row.message,
      score: cosineSimilarity(embedding, memEmbedding) + (row.user_id === userId ? 0.15 : 0), // Boost de 15% para memórias do próprio usuário
      user_id: row.user_id // Inclui o user_id no objeto retornado
    };
  }).filter(Boolean);
  // Ordena por score decrescente
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}

// === NOVAS FUNÇÕES PARA HISTÓRICO DE CONVERSAS ===

// Salva uma conversa completa (pergunta + resposta)
function saveConversation(guildId, channelId, userId, userMessage, botResponse, embedding = null) {
  db.prepare('INSERT INTO conversations (guild_id, channel_id, user_id, user_message, bot_response, embedding) VALUES (?, ?, ?, ?, ?, ?)')
    .run(guildId, channelId, userId, userMessage, botResponse, embedding ? JSON.stringify(embedding) : null);
  const logger = require('./logger');
  logger.info(`[CONVERSA] Salva: "${userMessage}" -> "${botResponse.substring(0, 50)}..." para user ${userId}`);
}

// Busca últimas conversas de um usuário
function getRecentConversations(guildId, userId, limit = 10) {
  return db.prepare(
    'SELECT user_message, bot_response, timestamp FROM conversations WHERE guild_id = ? AND user_id = ? ORDER BY timestamp DESC LIMIT ?'
  ).all(guildId, userId, limit);
}

// Busca conversas similares por embedding
function getSimilarConversations(guildId, userId, embedding, topN = 5) {
  if (!embedding) return [];
  const rows = db.prepare(
    'SELECT user_message, bot_response, embedding FROM conversations WHERE guild_id = ? AND user_id = ? AND embedding IS NOT NULL ORDER BY timestamp DESC LIMIT 100'
  ).all(guildId, userId);

  const scored = rows.map(row => {
    let convEmbedding;
    try {
      convEmbedding = JSON.parse(row.embedding);
    } catch {
      return null;
    }
    if (!Array.isArray(convEmbedding)) return null;
    return {
      user_message: row.user_message,
      bot_response: row.bot_response,
      score: cosineSimilarity(embedding, convEmbedding)
    };
  }).filter(Boolean);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}

// Busca todas as conversas de um canal
function getChannelHistory(guildId, channelId, limit = 50) {
  return db.prepare(
    'SELECT user_id, user_message, bot_response, timestamp FROM conversations WHERE guild_id = ? AND channel_id = ? ORDER BY timestamp DESC LIMIT ?'
  ).all(guildId, channelId, limit);
}

// Estatísticas de conversas
function getConversationStats(guildId, userId = null) {
  if (userId) {
    return db.prepare(
      'SELECT COUNT(*) as total FROM conversations WHERE guild_id = ? AND user_id = ?'
    ).get(guildId, userId);
  } else {
    return db.prepare(
      'SELECT COUNT(*) as total, COUNT(DISTINCT user_id) as unique_users FROM conversations WHERE guild_id = ?'
    ).get(guildId);
  }
}

// ============================================
// 🔥 FUNÇÕES DE RELACIONAMENTO
// ============================================

/**
 * Salva uma nota de relacionamento sobre um usuário
 * @param {string} guildId - ID do servidor
 * @param {string} userId - ID do usuário sobre quem é a nota
 * @param {string} username - Nome do usuário
 * @param {string} note - A observação/nota
 * @param {string} category - Categoria: 'pessoal', 'geral', 'sobre_outro'
 * @param {string} sourceUserId - Quem disse (se for sobre outro)
 * @param {Array} embedding - Embedding para busca semântica
 */
function saveRelationship(guildId, userId, username, note, category = 'geral', sourceUserId = null, embedding = null) {
  const logger = require('./logger');
  db.prepare(`
    INSERT INTO user_relationships (guild_id, user_id, username, note, category, source_user_id, embedding)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(guildId, userId, username, note, category, sourceUserId, embedding ? JSON.stringify(embedding) : null);
  logger.info(`[Relacionamento] Salvo para ${username}: "${note}" (${category})`);
}

/**
 * Busca todas as notas de relacionamento de um usuário
 * @param {string} guildId - ID do servidor
 * @param {string} userId - ID do usuário
 * @param {number} limit - Limite de notas
 */
function getUserRelationship(guildId, userId, limit = 10) {
  return db.prepare(`
    SELECT note, category, timestamp, source_user_id
    FROM user_relationships
    WHERE guild_id = ? AND user_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(guildId, userId, limit);
}

/**
 * Busca notas de relacionamento por texto (fallback)
 */
function searchRelationshipsByKeywords(guildId, userId, keywords) {
  const terms = keywords.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  if (terms.length === 0) return [];

  const conditions = terms.map(() => `LOWER(note) LIKE ?`).join(' OR ');
  const params = terms.map(t => `%${t}%`);

  return db.prepare(`
    SELECT note, category, timestamp
    FROM user_relationships
    WHERE guild_id = ? AND user_id = ? AND (${conditions})
    ORDER BY timestamp DESC
    LIMIT 5
  `).all(guildId, userId, ...params);
}

/**
 * Formata notas de relacionamento para o prompt
 */
function formatRelationshipForPrompt(notes) {
  if (!notes || notes.length === 0) return '';
  return notes.map(n => `- ${n.note} (${new Date(n.timestamp).toLocaleDateString('pt-BR')})`).join('\n');
}

// ============================================
// 🔥 PLAYLISTS E HISTÓRICO DE REPRODUÇÃO
// ============================================

db.prepare(`
  CREATE TABLE IF NOT EXISTS server_playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_by_username TEXT,
    created_by_id TEXT,
    tracks TEXT NOT NULL, -- Array JSON em string
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_playlists_guild_name ON server_playlists(guild_id, name);
`);

db.prepare(`
  CREATE TABLE IF NOT EXISTS play_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    title TEXT NOT NULL,
    author TEXT,
    uri TEXT NOT NULL,
    artwork_url TEXT,
    duration_ms INTEGER,
    requested_by TEXT,
    played_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_play_history_guild ON play_history(guild_id);
  CREATE INDEX IF NOT EXISTS idx_play_history_played_at ON play_history(played_at DESC);
`);

function savePlaylist(guildId, name, username, userId, tracks) {
  const tracksJson = JSON.stringify(tracks);
  db.prepare(`
    INSERT OR REPLACE INTO server_playlists (guild_id, name, created_by_username, created_by_id, tracks)
    VALUES (?, ?, ?, ?, ?)
  `).run(guildId, name.toLowerCase(), username, userId, tracksJson);
}

function getPlaylist(guildId, name) {
  const row = db.prepare(`
    SELECT * FROM server_playlists WHERE guild_id = ? AND name = ?
  `).get(guildId, name.toLowerCase());
  
  if (row) {
    row.tracks = JSON.parse(row.tracks);
  }
  return row;
}

function deletePlaylist(guildId, name) {
  const result = db.prepare(`
    DELETE FROM server_playlists WHERE guild_id = ? AND name = ?
  `).run(guildId, name.toLowerCase());
  return result.changes > 0;
}

function listPlaylists(guildId) {
  const rows = db.prepare(`
    SELECT * FROM server_playlists WHERE guild_id = ? ORDER BY name ASC
  `).all(guildId);
  
  return rows.map(row => {
    row.tracks = JSON.parse(row.tracks);
    return row;
  });
}

function addPlayHistory(guildId, title, author, uri, artworkUrl, durationMs, requestedBy) {
  db.prepare(`
    INSERT INTO play_history (guild_id, title, author, uri, artwork_url, duration_ms, requested_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(guildId, title, author || 'Desconhecido', uri, artworkUrl || null, durationMs || 0, requestedBy || null);
  
  // Limpar histórico antigo, mantendo apenas as últimas 20 por guild
  db.prepare(`
    DELETE FROM play_history 
    WHERE guild_id = ? AND id NOT IN (
      SELECT id FROM play_history WHERE guild_id = ? ORDER BY played_at DESC LIMIT 20
    )
  `).run(guildId, guildId);
}

function getPlayHistory(guildId, limit = 5) {
  return db.prepare(`
    SELECT * FROM play_history WHERE guild_id = ? ORDER BY played_at DESC LIMIT ?
  `).all(guildId, limit);
}

module.exports = {
  saveMemory,
  getSimilarMemory,
  getTopSimilarMemories,
  searchMemoriesByKeywords, // 🔥 NOVO: fallback de busca por texto
  setPermission,
  getPermission,
  addToWhitelist,
  removeFromWhitelist,
  getWhitelist,
  isWhitelisted,
  db, // Exportar o banco de dados para o servidor web
  // Whitelist global de servidores
  addGuildToWhitelist,
  removeGuildFromWhitelist,
  getGuildWhitelist,
  isGuildAuthorized,
  getGuildInfo,
  setGuildInfo,
  // Histórico de conversas
  saveConversation,
  getRecentConversations,
  getSimilarConversations,
  getChannelHistory,
  getConversationStats,
  // 🔥 Sistema de Relacionamento
  saveRelationship,
  getUserRelationship,
  searchRelationshipsByKeywords,
  formatRelationshipForPrompt,
  // 🔥 Playlists & Histórico
  savePlaylist,
  getPlaylist,
  deletePlaylist,
  listPlaylists,
  addPlayHistory,
  getPlayHistory
}; 