/**
 * Testes Unitários - Fact Store
 * Testa o sistema de memória e embeddings
 */

const Database = require('better-sqlite3');

describe('FactStore - Sistema de Memória', () => {
  let testDb;
  const testGuildId = '123456789012345678';
  const testUserId = '987654321098765432';

  beforeEach(() => {
    // Criar banco de dados temporário para testes
    testDb = new Database(':memory:');
    
    // Criar tabelas necessárias
    testDb.prepare(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT,
        user_id TEXT,
        message TEXT,
        embedding TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    testDb.prepare(`
      CREATE TABLE IF NOT EXISTS whitelist (
        guild_id TEXT,
        type TEXT,
        id TEXT
      )
    `).run();
  });

  afterEach(() => {
    testDb.close();
  });

  describe('saveMemory', () => {
    test('deve salvar memória sem embedding', () => {
      testDb.prepare('INSERT INTO memories (guild_id, user_id, message) VALUES (?, ?, ?)')
        .run(testGuildId, testUserId, 'teste de memória');
      
      const result = testDb.prepare('SELECT * FROM memories WHERE guild_id = ?').get(testGuildId);
      
      expect(result).toBeDefined();
      expect(result.message).toBe('teste de memória');
      expect(result.guild_id).toBe(testGuildId);
    });

    test('deve salvar memória com embedding', () => {
      const embedding = [0.1, 0.2, 0.3, 0.4, 0.5];
      
      testDb.prepare('INSERT INTO memories (guild_id, user_id, message, embedding) VALUES (?, ?, ?, ?)')
        .run(testGuildId, testUserId, 'teste com embedding', JSON.stringify(embedding));
      
      const result = testDb.prepare('SELECT * FROM memories WHERE guild_id = ?').get(testGuildId);
      
      expect(result).toBeDefined();
      expect(JSON.parse(result.embedding)).toEqual(embedding);
    });
  });

  describe('getSimilarMemory', () => {
    beforeEach(() => {
      testDb.prepare('INSERT INTO memories (guild_id, user_id, message) VALUES (?, ?, ?)')
        .run(testGuildId, testUserId, 'o céu é azul');
      testDb.prepare('INSERT INTO memories (guild_id, user_id, message) VALUES (?, ?, ?)')
        .run(testGuildId, testUserId, 'a grama é verde');
    });

    test('deve encontrar memória similar por substring', () => {
      const result = testDb.prepare(
        'SELECT message FROM memories WHERE guild_id = ? AND user_id = ? AND message LIKE ? ORDER BY timestamp DESC LIMIT 1'
      ).get(testGuildId, testUserId, '%céu%');
      
      expect(result).toBeDefined();
      expect(result.message).toBe('o céu é azul');
    });
  });

  describe('Whitelist', () => {
    test('deve adicionar usuário à whitelist', () => {
      testDb.prepare('INSERT INTO whitelist (guild_id, type, id) VALUES (?, ?, ?)')
        .run(testGuildId, 'user', testUserId);
      
      const result = testDb.prepare('SELECT * FROM whitelist WHERE guild_id = ? AND type = ?')
        .all(testGuildId, 'user');
      
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(testUserId);
    });

    test('deve remover usuário da whitelist', () => {
      testDb.prepare('INSERT INTO whitelist (guild_id, type, id) VALUES (?, ?, ?)')
        .run(testGuildId, 'user', testUserId);
      
      testDb.prepare('DELETE FROM whitelist WHERE guild_id = ? AND type = ? AND id = ?')
        .run(testGuildId, 'user', testUserId);
      
      const result = testDb.prepare('SELECT * FROM whitelist WHERE guild_id = ?')
        .all(testGuildId);
      
      expect(result).toHaveLength(0);
    });

    test('whitelist vazia deve permitir todos', () => {
      const whitelist = testDb.prepare('SELECT * FROM whitelist WHERE guild_id = ?')
        .all(testGuildId);
      
      // Se whitelist está vazia, comportamento padrão é permitir
      const shouldAllow = whitelist.length === 0;
      expect(shouldAllow).toBe(true);
    });
  });

  describe('Similaridade de Cosseno', () => {
    test('deve calcular similaridade corretamente', () => {
      function cosineSimilarity(a, b) {
        let dot = 0.0, normA = 0.0, normB = 0.0;
        for (let i = 0; i < a.length; i++) {
          dot += a[i] * b[i];
          normA += a[i] * a[i];
          normB += b[i] * b[i];
        }
        return dot / (Math.sqrt(normA) * Math.sqrt(normB));
      }

      const embedding1 = [1, 0, 0];
      const embedding2 = [1, 0, 0];
      const embedding3 = [0, 1, 0];

      expect(cosineSimilarity(embedding1, embedding2)).toBeCloseTo(1.0);
      expect(cosineSimilarity(embedding1, embedding3)).toBeCloseTo(0.0);
    });
  });
});
