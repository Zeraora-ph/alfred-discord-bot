/**
 * RPG Database
 * Camada de persistência do sistema de RPG. Reusa a MESMA conexão SQLite do
 * fact-store (memory.db) para evitar locks de múltiplas conexões no mesmo processo.
 *
 * Tabelas:
 *   - rpg_characters   → fichas de personagem (JSON flexível + colunas indexadas)
 *   - rpg_campaigns    → campanhas/mesas (agrupa fichas e sessões)
 *   - rpg_combat       → estado de encontro/iniciativa ativo por canal
 *   - rpg_rules_chunks → índice vetorial do livro de regras (RAG)
 *
 * O `sheet`/`data` são guardados como JSON string — dá flexibilidade para
 * evoluir o modelo (e suportar outros sistemas além de D&D 5e) sem migração.
 *
 * @module lib/rpg-db
 */

const { db } = require('./fact-store');
const logger = require('./logger');

// ============================================
// Schema
// ============================================

db.prepare(`
  CREATE TABLE IF NOT EXISTS rpg_campaigns (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id     TEXT NOT NULL,
    name         TEXT NOT NULL,
    system       TEXT DEFAULT 'dnd5e',
    gm_user_id   TEXT,
    description  TEXT,
    active       INTEGER DEFAULT 1,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS rpg_characters (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id     TEXT NOT NULL,
    user_id      TEXT NOT NULL,
    campaign_id  INTEGER,
    name         TEXT NOT NULL,
    system       TEXT DEFAULT 'dnd5e',
    level        INTEGER DEFAULT 1,
    sheet        TEXT NOT NULL,           -- JSON completo da ficha
    active       INTEGER DEFAULT 1,       -- personagem "em foco" do usuário
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS rpg_combat (
    channel_id   TEXT PRIMARY KEY,
    guild_id     TEXT NOT NULL,
    round        INTEGER DEFAULT 1,
    turn_index   INTEGER DEFAULT 0,
    combatants   TEXT NOT NULL,           -- JSON array
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS rpg_rules_chunks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    source       TEXT NOT NULL,           -- nome do livro/documento
    section      TEXT,                    -- capítulo/seção, se detectável
    page         INTEGER,
    content      TEXT NOT NULL,
    embedding    TEXT,                    -- vetor JSON (embedado uma única vez)
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_rpg_chars_user   ON rpg_characters(guild_id, user_id);
  CREATE INDEX IF NOT EXISTS idx_rpg_chars_active ON rpg_characters(guild_id, user_id, active);
  CREATE INDEX IF NOT EXISTS idx_rpg_camps_guild  ON rpg_campaigns(guild_id, active);
  CREATE INDEX IF NOT EXISTS idx_rpg_rules_source ON rpg_rules_chunks(source);
`);

logger.info('[RPG-DB] Tabelas de RPG verificadas/criadas em memory.db');

// ============================================
// Characters
// ============================================

/**
 * Insere uma nova ficha. Marca como ativa e desativa as outras do mesmo usuário.
 * @returns {number} id da ficha criada
 */
function insertCharacter({ guildId, userId, campaignId = null, name, system = 'dnd5e', level = 1, sheet }) {
    const sheetJson = typeof sheet === 'string' ? sheet : JSON.stringify(sheet);
    const info = db.prepare(`
        INSERT INTO rpg_characters (guild_id, user_id, campaign_id, name, system, level, sheet, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).run(guildId, userId, campaignId, name, system, level, sheetJson);

    // Torna esta a ficha ativa do usuário
    setActiveCharacter(guildId, userId, info.lastInsertRowid);
    return info.lastInsertRowid;
}

/** Atualiza o JSON da ficha e o nível. */
function updateCharacterSheet(id, sheet, level = null) {
    const sheetJson = typeof sheet === 'string' ? sheet : JSON.stringify(sheet);
    if (level != null) {
        db.prepare(`UPDATE rpg_characters SET sheet = ?, level = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
            .run(sheetJson, level, id);
    } else {
        db.prepare(`UPDATE rpg_characters SET sheet = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
            .run(sheetJson, id);
    }
}

function _parseRow(row) {
    if (!row) return null;
    let sheet = {};
    try { sheet = JSON.parse(row.sheet); } catch { sheet = {}; }
    return { ...row, sheet };
}

/** Busca ficha por id. */
function getCharacterById(id) {
    return _parseRow(db.prepare(`SELECT * FROM rpg_characters WHERE id = ?`).get(id));
}

/** Ficha ativa (em foco) de um usuário no servidor. */
function getActiveCharacter(guildId, userId) {
    const row = db.prepare(`
        SELECT * FROM rpg_characters
        WHERE guild_id = ? AND user_id = ? AND active = 1
        ORDER BY updated_at DESC LIMIT 1
    `).get(guildId, userId);
    return _parseRow(row);
}

/** Todas as fichas de um usuário. */
function listCharacters(guildId, userId) {
    return db.prepare(`
        SELECT id, name, system, level, active FROM rpg_characters
        WHERE guild_id = ? AND user_id = ?
        ORDER BY updated_at DESC
    `).all(guildId, userId);
}

/** Busca ficha por nome (parcial, case-insensitive) do usuário. */
function findCharacterByName(guildId, userId, name) {
    const row = db.prepare(`
        SELECT * FROM rpg_characters
        WHERE guild_id = ? AND user_id = ? AND LOWER(name) LIKE LOWER(?)
        ORDER BY updated_at DESC LIMIT 1
    `).get(guildId, userId, `%${name}%`);
    return _parseRow(row);
}

/** Define qual ficha do usuário está ativa (desativa as demais). */
function setActiveCharacter(guildId, userId, id) {
    const tx = db.transaction(() => {
        db.prepare(`UPDATE rpg_characters SET active = 0 WHERE guild_id = ? AND user_id = ?`).run(guildId, userId);
        db.prepare(`UPDATE rpg_characters SET active = 1 WHERE id = ?`).run(id);
    });
    tx();
}

/** Remove uma ficha. */
function deleteCharacter(id) {
    return db.prepare(`DELETE FROM rpg_characters WHERE id = ?`).run(id).changes > 0;
}

// ============================================
// Campaigns
// ============================================

function insertCampaign({ guildId, name, system = 'dnd5e', gmUserId = null, description = '' }) {
    const info = db.prepare(`
        INSERT INTO rpg_campaigns (guild_id, name, system, gm_user_id, description)
        VALUES (?, ?, ?, ?, ?)
    `).run(guildId, name, system, gmUserId, description);
    return info.lastInsertRowid;
}

function listCampaigns(guildId) {
    return db.prepare(`SELECT * FROM rpg_campaigns WHERE guild_id = ? AND active = 1 ORDER BY created_at DESC`).all(guildId);
}

// ============================================
// Rules chunks (RAG) — usado pela ingestão do livro
// ============================================

function insertRuleChunk({ source, section = null, page = null, content, embedding = null }) {
    const emb = embedding ? JSON.stringify(embedding) : null;
    return db.prepare(`
        INSERT INTO rpg_rules_chunks (source, section, page, content, embedding)
        VALUES (?, ?, ?, ?, ?)
    `).run(source, section, page, content, emb).lastInsertRowid;
}

/** Retorna todos os chunks com embedding (para busca por similaridade em memória). */
function getAllRuleChunks(source = null) {
    const rows = source
        ? db.prepare(`SELECT id, source, section, page, content, embedding FROM rpg_rules_chunks WHERE source = ?`).all(source)
        : db.prepare(`SELECT id, source, section, page, content, embedding FROM rpg_rules_chunks`).all();
    return rows.map(r => ({
        ...r,
        embedding: r.embedding ? JSON.parse(r.embedding) : null
    }));
}

function countRuleChunks(source = null) {
    return source
        ? db.prepare(`SELECT COUNT(*) AS n FROM rpg_rules_chunks WHERE source = ?`).get(source).n
        : db.prepare(`SELECT COUNT(*) AS n FROM rpg_rules_chunks`).get().n;
}

function clearRuleChunks(source) {
    return db.prepare(`DELETE FROM rpg_rules_chunks WHERE source = ?`).run(source).changes;
}

// ============================================
// Combat
// ============================================

function saveCombat(channelId, guildId, state) {
    db.prepare(`
        INSERT INTO rpg_combat (channel_id, guild_id, round, turn_index, combatants, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(channel_id) DO UPDATE SET
            round = excluded.round,
            turn_index = excluded.turn_index,
            combatants = excluded.combatants,
            updated_at = CURRENT_TIMESTAMP
    `).run(channelId, guildId, state.round, state.turnIndex, JSON.stringify(state.combatants));
}

function getCombat(channelId) {
    const row = db.prepare(`SELECT * FROM rpg_combat WHERE channel_id = ?`).get(channelId);
    if (!row) return null;
    let combatants = [];
    try { combatants = JSON.parse(row.combatants); } catch {}
    return { channelId: row.channel_id, guildId: row.guild_id, round: row.round, turnIndex: row.turn_index, combatants };
}

function endCombat(channelId) {
    return db.prepare(`DELETE FROM rpg_combat WHERE channel_id = ?`).run(channelId).changes > 0;
}

module.exports = {
    db,
    // characters
    insertCharacter,
    updateCharacterSheet,
    getCharacterById,
    getActiveCharacter,
    listCharacters,
    findCharacterByName,
    setActiveCharacter,
    deleteCharacter,
    // campaigns
    insertCampaign,
    listCampaigns,
    // rules
    insertRuleChunk,
    getAllRuleChunks,
    countRuleChunks,
    clearRuleChunks,
    // combat
    saveCombat,
    getCombat,
    endCombat
};
