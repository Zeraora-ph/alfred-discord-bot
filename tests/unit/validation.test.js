/**
 * Testes de Validação - Schemas Zod
 * Testa validação de inputs da API
 */

const { 
  discordIdSchema, 
  whitelistSchema, 
  memoryQuerySchema,
  memorySearchSchema,
  bulkDeleteSchema,
  guildInfoSchema,
  loginSchema 
} = require('../../src/config/validation');

describe('Validation Schemas', () => {
  describe('discordIdSchema', () => {
    test('deve aceitar ID Discord válido', () => {
      const validId = '123456789012345678';
      expect(() => discordIdSchema.parse(validId)).not.toThrow();
    });

    test('deve rejeitar ID muito curto', () => {
      const invalidId = '12345';
      expect(() => discordIdSchema.parse(invalidId)).toThrow();
    });

    test('deve rejeitar ID com letras', () => {
      const invalidId = '12345678901234567a';
      expect(() => discordIdSchema.parse(invalidId)).toThrow();
    });
  });

  describe('whitelistSchema', () => {
    test('deve aceitar whitelist válida', () => {
      const validData = {
        guild_id: '123456789012345678',
        type: 'user',
        id: '987654321098765432'
      };
      
      expect(() => whitelistSchema.parse(validData)).not.toThrow();
    });

    test('deve rejeitar tipo inválido', () => {
      const invalidData = {
        guild_id: '123456789012345678',
        type: 'invalid',
        id: '987654321098765432'
      };
      
      expect(() => whitelistSchema.parse(invalidData)).toThrow();
    });
  });

  describe('memorySearchSchema', () => {
    test('deve aceitar query de busca válida', () => {
      const validData = {
        query: 'teste de busca',
        guild_id: '123456789012345678'
      };
      
      expect(() => memorySearchSchema.parse(validData)).not.toThrow();
    });

    test('deve rejeitar query vazia', () => {
      const invalidData = {
        query: '',
        guild_id: '123456789012345678'
      };
      
      expect(() => memorySearchSchema.parse(invalidData)).toThrow();
    });

    test('deve rejeitar query muito longa', () => {
      const invalidData = {
        query: 'a'.repeat(501),
        guild_id: '123456789012345678'
      };
      
      expect(() => memorySearchSchema.parse(invalidData)).toThrow();
    });
  });

  describe('bulkDeleteSchema', () => {
    test('deve aceitar array de IDs válido', () => {
      const validData = {
        ids: [1, 2, 3, 4, 5]
      };
      
      expect(() => bulkDeleteSchema.parse(validData)).not.toThrow();
    });

    test('deve rejeitar array vazio', () => {
      const invalidData = {
        ids: []
      };
      
      expect(() => bulkDeleteSchema.parse(invalidData)).toThrow();
    });

    test('deve rejeitar array com mais de 100 itens', () => {
      const invalidData = {
        ids: Array.from({ length: 101 }, (_, i) => i + 1)
      };
      
      expect(() => bulkDeleteSchema.parse(invalidData)).toThrow();
    });
  });

  describe('loginSchema', () => {
    test('deve aceitar credenciais válidas', () => {
      const validData = {
        username: 'admin',
        password: 'senhaForte123'
      };
      
      expect(() => loginSchema.parse(validData)).not.toThrow();
    });

    test('deve rejeitar username muito curto', () => {
      const invalidData = {
        username: 'ab',
        password: 'senhaForte123'
      };
      
      expect(() => loginSchema.parse(invalidData)).toThrow();
    });

    test('deve rejeitar password muito curto', () => {
      const invalidData = {
        username: 'admin',
        password: 'curta'
      };
      
      expect(() => loginSchema.parse(invalidData)).toThrow();
    });
  });

  describe('guildInfoSchema', () => {
    test('deve aceitar info e persona válidos', () => {
      const validData = {
        info: 'Informações do servidor',
        persona: 'Seja amigável'
      };
      
      expect(() => guildInfoSchema.parse(validData)).not.toThrow();
    });

    test('deve rejeitar info muito longo', () => {
      const invalidData = {
        info: 'a'.repeat(2001)
      };
      
      expect(() => guildInfoSchema.parse(invalidData)).toThrow();
    });
  });
});
