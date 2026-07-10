/**
 * Testes Unitários - Voice Listener
 * Testa correções de vazamento de memória e tratamento de erros no Voice Listener
 */

const VoiceListener = require('../../src/lib/voice-listener');
const fs = require('fs');

jest.mock('@discordjs/voice', () => ({
    getVoiceConnection: jest.fn(),
    entersState: jest.fn(),
    VoiceConnectionStatus: {
        Ready: 'ready',
        Destroyed: 'destroyed'
    },
    EndBehaviorType: {
        AfterSilence: 'afterSilence'
    }
}));

jest.mock('prism-media', () => ({
    opus: {
        Decoder: jest.fn().mockImplementation(() => {
            return {
                pipe: jest.fn(),
                on: jest.fn()
            };
        })
    }
}));

jest.mock('../../src/services/whisper-service', () => ({
    checkHealth: jest.fn().mockResolvedValue(true),
    detectWakeWord: jest.fn().mockResolvedValue({ detected: false, text: '' })
}));

jest.mock('child_process', () => ({
    exec: jest.fn((cmd, opts, callback) => callback(null))
}));

jest.mock('../../src/lib/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
}));

describe('VoiceListener Fixes', () => {
    let voiceListener;
    let mockClient;

    beforeEach(() => {
        jest.clearAllMocks();
        mockClient = {
            guilds: {
                cache: {
                    get: jest.fn()
                }
            }
        };
        voiceListener = new VoiceListener(mockClient);
    });

    test('setupReceiver prevent duplicate listener accumulation', () => {
        const removeAllListenersSpy = jest.fn();
        const onSpy = jest.fn();
        const connection = {
            receiver: {
                speaking: {
                    removeAllListeners: removeAllListenersSpy,
                    on: onSpy
                }
            }
        };

        voiceListener.setupReceiver('guild123', connection);

        expect(removeAllListenersSpy).toHaveBeenCalledWith('start');
        expect(onSpy).toHaveBeenCalledWith('start', expect.any(Function));
    });

    test('startRecording guards against null/undefined audioStream', () => {
        const subscribeSpy = jest.fn().mockReturnValue(null);
        const connection = {
            receiver: {
                subscribe: subscribeSpy
            }
        };

        expect(() => {
            voiceListener.startRecording('guild123', 'user456', connection.receiver);
        }).not.toThrow();

        expect(subscribeSpy).toHaveBeenCalled();
    });

    test('processAudio cleans up PCM and WAV files using try...finally', async () => {
        const mockExistsSync = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        const mockUnlinkSync = jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
        const mockWriteFileSync = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

        voiceListener.connections.set('guild123', {
            connection: {},
            channel: {},
            textChannel: {}
        });

        // Test normal execution flow
        await voiceListener.processAudio('guild123', 'user456', [Buffer.from('pcm')], 1000);

        expect(mockWriteFileSync).toHaveBeenCalled();
        expect(mockUnlinkSync).toHaveBeenCalledTimes(2); // PCM and WAV
        
        mockExistsSync.mockRestore();
        mockUnlinkSync.mockRestore();
        mockWriteFileSync.mockRestore();
    });

    test('stopListening cleans up start listener if speaking object exists', () => {
        const removeAllListenersSpy = jest.fn();
        const connection = {
            receiver: {
                speaking: {
                    removeAllListeners: removeAllListenersSpy
                }
            }
        };

        voiceListener.connections.set('guild123', { connection });
        voiceListener.stopListening('guild123');

        expect(removeAllListenersSpy).toHaveBeenCalledWith('start');
    });

    test('startRecording skips if isSpeaking or isProcessing is true', () => {
        const subscribeSpy = jest.fn();
        const receiver = { subscribe: subscribeSpy };

        // case 1: isSpeaking is true
        voiceListener.isSpeaking = true;
        voiceListener.isProcessing = false;
        voiceListener.startRecording('guild123', 'user456', receiver);
        expect(subscribeSpy).not.toHaveBeenCalled();

        // case 2: isProcessing is true
        voiceListener.isSpeaking = false;
        voiceListener.isProcessing = true;
        voiceListener.startRecording('guild123', 'user456', receiver);
        expect(subscribeSpy).not.toHaveBeenCalled();
    });

    test('startRecording allows recording when speaking (barge-in) but skips if processing in the active guild', () => {
        const subscribeSpy = jest.fn().mockReturnValue({ on: jest.fn(), pipe: jest.fn() });
        const receiver = { subscribe: subscribeSpy };

        // registrar conexão ativa
        voiceListener.connections.set('guild123', { connection: {} });

        // caso 1: falando mas não processando -> permite gravar (barge-in)
        voiceListener.setSpeaking('guild123', true);
        voiceListener.setProcessing('guild123', false);
        voiceListener.startRecording('guild123', 'user456', receiver);
        expect(subscribeSpy).toHaveBeenCalled();

        // caso 2: processando -> bloqueia gravação
        subscribeSpy.mockClear();
        voiceListener.setSpeaking('guild123', false);
        voiceListener.setProcessing('guild123', true);
        voiceListener.startRecording('guild123', 'user456', receiver);
        expect(subscribeSpy).not.toHaveBeenCalled();
    });
});
