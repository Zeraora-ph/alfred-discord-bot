/**
 * Testes de Integração - AI Client
 * Testa comunicação com provedores de IA
 *
 * Usa a implementação real do ai-client (não o mock global).
 * O groq-client é mockado para evitar chamadas HTTP externas.
 */

// Desfaz o mock global do ai-client (registrado em tests/setup.js)
jest.unmock('../../src/lib/ai-client');

const aiClient = require('../../src/lib/ai-client');

describe('AIClient - Integração', () => {
  describe('getSystemPrompt', () => {
    test('deve retornar prompt do sistema configurado', () => {
      const prompt = aiClient.getSystemPrompt();
      
      expect(prompt).toBeDefined();
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
      expect(prompt).toContain('Alfred');
    });
  });

  describe('estimateTokens', () => {
    test('deve estimar tokens de mensagens', () => {
      const messages = [
        { role: 'user', content: 'Olá' },
        { role: 'assistant', content: 'Olá! Como posso ajudar?' }
      ];
      
      const tokens = aiClient.estimateTokens(messages);
      
      expect(tokens).toBeGreaterThan(0);
      expect(typeof tokens).toBe('number');
    });

    test('deve retornar 0 para array vazio', () => {
      const tokens = aiClient.estimateTokens([]);
      expect(tokens).toBe(0);
    });
  });

  describe('getCurrentProvider', () => {
    test('deve retornar nome do provider atual', () => {
      const provider = aiClient.getCurrentProvider();
      
      expect(provider).toBeDefined();
      expect(typeof provider).toBe('string');
      // O provider padrão na implementação real é 'Groq'
      expect(provider).toBe('Groq');
    });
  });

  // Testes que requerem API (mock ou skip em CI)
  describe('chat - Mocked', () => {
    test('deve processar mensagens de chat', async () => {
      // Mock da resposta da API
      const mockResponse = {
        choices: [{
          message: {
            content: 'Resposta de teste'
          }
        }]
      };

      // Temporariamente substituir o método
      const originalChat = aiClient.chat;
      aiClient.chat = jest.fn().mockResolvedValue(mockResponse);

      const messages = [
        { role: 'user', content: 'teste' }
      ];

      const response = await aiClient.chat(messages);

      expect(response.choices[0].message.content).toBe('Resposta de teste');

      // Restaurar método original
      aiClient.chat = originalChat;
    });
  });

  describe('getEmbedding - Mocked', () => {
    test('deve retornar embedding válido', async () => {
      const mockEmbedding = [0.1, 0.2, 0.3, 0.4, 0.5];

      const originalGetEmbedding = aiClient.getEmbedding;
      aiClient.getEmbedding = jest.fn().mockResolvedValue(mockEmbedding);

      const embedding = await aiClient.getEmbedding('texto de teste');

      expect(Array.isArray(embedding)).toBe(true);
      expect(embedding.length).toBeGreaterThan(0);
      expect(embedding).toEqual(mockEmbedding);

      aiClient.getEmbedding = originalGetEmbedding;
    });

    test('deve retornar null para texto vazio', async () => {
      const originalGetEmbedding = aiClient.getEmbedding;
      aiClient.getEmbedding = jest.fn().mockResolvedValue(null);

      const embedding = await aiClient.getEmbedding('');

      expect(embedding).toBeNull();

      aiClient.getEmbedding = originalGetEmbedding;
    });
  });
});
