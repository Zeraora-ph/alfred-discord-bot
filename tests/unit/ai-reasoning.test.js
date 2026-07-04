/**
 * Testes para o sistema de raciocínio avançado da IA
 *
 * Usa a implementação real do ai-client (não o mock global).
 * @jest-environment node
 */

/* eslint-disable */

// Desfaz o mock global do ai-client (registrado em tests/setup.js)
jest.unmock('../../src/lib/ai-client');

const aiClient = require('../../src/lib/ai-client');

describe('Sistema de Raciocínio Avançado', () => {
  describe('isComplexQuestion()', () => {
    test('deve detectar perguntas complexas com "por que"', () => {
      expect(aiClient.isComplexQuestion('Por que o céu é azul?')).toBe(true);
      expect(aiClient.isComplexQuestion('Porque isso funciona assim?')).toBe(true);
    });

    test('deve detectar perguntas com "como funciona"', () => {
      expect(aiClient.isComplexQuestion('Como funciona a inteligência artificial?')).toBe(true);
    });

    test('deve detectar perguntas comparativas', () => {
      expect(aiClient.isComplexQuestion('Qual a diferença entre Python e JavaScript?')).toBe(true);
      expect(aiClient.isComplexQuestion('Compare React e Vue')).toBe(true);
    });

    test('deve detectar pedidos de explicação', () => {
      expect(aiClient.isComplexQuestion('Explique machine learning')).toBe(true);
      expect(aiClient.isComplexQuestion('Analise essa situação')).toBe(true);
    });

    test('deve detectar prós e contras', () => {
      expect(aiClient.isComplexQuestion('Quais as vantagens e desvantagens?')).toBe(true);
      expect(aiClient.isComplexQuestion('Me dê os prós e contras')).toBe(true);
    });

    test('NÃO deve detectar perguntas simples', () => {
      expect(aiClient.isComplexQuestion('Qual seu nome?')).toBe(false);
      expect(aiClient.isComplexQuestion('Você está online?')).toBe(false);
      expect(aiClient.isComplexQuestion('Oi, tudo bem?')).toBe(false);
    });
  });

    describe('enrichContextWithReasoning()', () => {
        test('deve adicionar prompt de raciocínio para perguntas complexas', async () => {
            const messages = [
                { role: 'system', content: 'Você é Alfred' },
                { role: 'user', content: 'Por que o céu é azul?' }
            ];
            const originalLength = messages.length;

            const enriched = await aiClient.enrichContextWithReasoning(messages, {});

            // Deve ter adicionado o prompt de raciocínio
            expect(enriched.length).toBeGreaterThan(originalLength);
            const reasoningPrompt = enriched.find(m => 
                m.role === 'system' && m.content.includes('passo a passo')
            );
            expect(reasoningPrompt).toBeDefined();
        });

        test('NÃO deve adicionar raciocínio para perguntas simples', async () => {
            const messages = [
                { role: 'system', content: 'Você é Alfred' },
                { role: 'user', content: 'Qual seu nome?' }
            ];

            const enriched = await aiClient.enrichContextWithReasoning(messages, {});

            // Não deve ter alterado o tamanho
            expect(enriched.length).toBe(messages.length);
        });

        test('deve adicionar memórias ao contexto', async () => {
            const messages = [
                { role: 'system', content: 'Você é Alfred' },
                { role: 'user', content: 'O que você sabe sobre mim?' }
            ];

            const memories = [
                { message: 'Usuário é programador Python' },
                { message: 'Usuário gosta de música eletrônica' }
            ];

            const enriched = await aiClient.enrichContextWithReasoning(messages, { memories });

            // Deve ter adicionado contexto de memórias
            const memoryContext = enriched.find(m => 
                m.role === 'system' && m.content.includes('Informações relevantes')
            );
            expect(memoryContext).toBeDefined();
            expect(memoryContext.content).toContain('programador Python');
        });
    });

    describe('getSystemPrompt()', () => {
        test('deve retornar prompt avançado com capacidades cognitivas', () => {
            const prompt = aiClient.getSystemPrompt();
            
            expect(prompt).toContain('IDENTIDADE');
            expect(prompt).toContain('Música');
            expect(prompt).toContain('Memória');
        });

        test('deve incluir personalidade brasileira', () => {
            const prompt = aiClient.getSystemPrompt();
            
            expect(prompt).toContain('TOM E COMUNICAÇÃO');
            expect(prompt).toContain('brasileiro');
        });

        test('deve incluir diretrizes de raciocínio', () => {
            const prompt = aiClient.getSystemPrompt();
            
            expect(prompt).toContain('MEMÓRIA E CONTEXTO');
            expect(prompt).toContain('histórico da conversa');
        });

        test('deve incluir informações customizadas do servidor', () => {
            const guildInfo = {
                info: 'Este servidor é sobre programação',
                persona: 'Seja técnico e use exemplos de código'
            };

            const prompt = aiClient.getSystemPrompt(guildInfo);
            
            expect(prompt).toContain('CONTEXTO DO SERVIDOR');
            expect(prompt).toContain('programação');
            expect(prompt).toContain('Seja técnico');
        });

        test('deve incluir proibições/limites', () => {
            const prompt = aiClient.getSystemPrompt();
            
            expect(prompt).toContain('HONESTIDADE E LIMITES');
            expect(prompt).toContain('Não invente informações');
            expect(prompt).toContain('escolhas pessoais');
        });
    });

    describe('chat() com opções avançadas', () => {
        test('deve aceitar options.enrichContext', async () => {
            const messages = [
                { role: 'system', content: 'Você é Alfred' },
                { role: 'user', content: 'Por que o céu é azul?' }
            ];
            const originalLength = messages.length;

            // Mock da função chat do provider
            const mockChat = jest.fn().mockResolvedValue({
                choices: [{ message: { content: 'Resposta teste' } }]
            });
            aiClient.provider.client.chat = mockChat;

            await aiClient.chat(messages, { enrichContext: true, forceProvider: 'groq' });

            // Deve ter chamado o chat do provider
            expect(mockChat).toHaveBeenCalled();
            
            // Deve ter passado mensagens enriquecidas
            const calledMessages = mockChat.mock.calls[0][0];
            expect(calledMessages.length).toBeGreaterThan(originalLength);
        });

        test('deve aceitar options.memories', async () => {
            const messages = [
                { role: 'system', content: 'Você é Alfred' },
                { role: 'user', content: 'O que você sabe sobre mim baseando-se no meu perfil?' }
            ];

            const memories = [
                { message: 'Fato 1' },
                { message: 'Fato 2' }
            ];

            const mockChat = jest.fn().mockResolvedValue({
                choices: [{ message: { content: 'Resposta teste' } }]
            });
            aiClient.provider.client.chat = mockChat;

            await aiClient.chat(messages, { enrichContext: true, memories, forceProvider: 'groq' });

            const calledMessages = mockChat.mock.calls[0][0];
            const memoryMsg = calledMessages.find(m => m.content?.includes('Fato 1'));
            expect(memoryMsg).toBeDefined();
        });

        test('deve passar options para o provider', async () => {
            const messages = [
                { role: 'user', content: 'Teste' }
            ];

            const mockChat = jest.fn().mockResolvedValue({
                choices: [{ message: { content: 'OK' } }]
            });
            aiClient.provider.client.chat = mockChat;

            await aiClient.chat(messages, { 
                temperature: 0.9,
                maxTokens: 3000,
                forceProvider: 'groq'
            });

            // Deve ter passado as options
            expect(mockChat).toHaveBeenCalledWith(messages, expect.objectContaining({
                temperature: 0.9,
                maxTokens: 3000
            }));
        });
    });
});

describe('Parâmetros do Modelo (GroqClient)', () => {
    test('deve ter parâmetros otimizados implementados', () => {
        // Teste simplificado: verifica se os parâmetros existem no código
        const GroqClient = require('../../src/lib/groq-client');
        const groqClientCode = GroqClient.toString();
        
        // Verifica se os novos parâmetros estão no código
        expect(groqClientCode.includes('top_p') || groqClientCode.includes('topP')).toBe(true);
        expect(groqClientCode.includes('frequency_penalty') || groqClientCode.includes('frequencyPenalty')).toBe(true);
        expect(groqClientCode.includes('presence_penalty') || groqClientCode.includes('presencePenalty')).toBe(true);
    });
});
