/**
 * Unit Tests for Conversational UX Features (Subject Resets & Intent Swapping)
 * 
 * @jest-environment node
 */

const aiHandler = require('../../src/handlers/ai-handler');
const redis = require('../../src/lib/redis-client');

// Mock dependencies
jest.mock('../../src/lib/logger');
jest.mock('../../src/lib/ai-client', () => ({
    chat: jest.fn(),
    getSystemPrompt: jest.fn().mockReturnValue('System Prompt')
}));
jest.mock('../../src/services/memory-manager', () => ({
    getUserContext: jest.fn().mockResolvedValue({
        shortTerm: [],
        longTermContext: '',
        episodicContext: '',
        graphContext: ''
    }),
    compressIfNeeded: jest.fn().mockResolvedValue(false)
}));
jest.mock('../../src/services/user-relationship-service', () => ({
    getPersonalityContext: jest.fn().mockResolvedValue(''),
    updateAfterInteraction: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../../src/services/tool-use-service', () => ({
    chat: jest.fn().mockResolvedValue('AI Response')
}));

describe('Conversational UX: Reset de Assunto/Limpeza de Contexto', () => {
    let mockMessage;

    beforeEach(() => {
        jest.clearAllMocks();
        mockMessage = {
            content: 'limpar contexto',
            author: { id: 'user123', username: 'tester' },
            guildId: 'guild123',
            channelId: 'channel123',
            client: {},
            reply: jest.fn().mockResolvedValue(true)
        };
    });

    test('deve limpar as chaves de contexto no Redis quando solicitado', async () => {
        const delSpy = jest.spyOn(redis, 'del');

        // Chamar processQuestion com gatilho de mudança de assunto
        const response = await aiHandler.processQuestion(mockMessage, 'limpar contexto');

        expect(response).toContain('Contexto limpo');
        // Deve deletar a chave de contexto da conversa e a chave de short-term
        expect(delSpy).toHaveBeenCalledWith('context:channel123:user123');
        expect(delSpy).toHaveBeenCalledWith('mem:short:guild123:user123');
    });

    test('deve limpar as chaves de contexto no Redis com outras variantes do gatilho', async () => {
        const delSpy = jest.spyOn(redis, 'del');

        const response = await aiHandler.processQuestion(mockMessage, 'esquece tudo alfred');
        expect(response).toContain('Contexto limpo');
        expect(delSpy).toHaveBeenCalledWith('context:channel123:user123');
    });
});
