const whisperService = require('../../src/services/whisper-service');

describe('WhisperService - parseWakeWord', () => {
    test('should detect wake word and extract command when wake word is at the start', () => {
        const result = whisperService.parseWakeWord('alfred, tocar metallica');
        expect(result.detected).toBe(true);
        expect(result.command).toBe('tocar metallica');
    });

    test('should detect wake word and extract command when wake word is at the end', () => {
        const result = whisperService.parseWakeWord('qual seu pokémon favorito, alfred?');
        expect(result.detected).toBe(true);
        expect(result.command).toBe('qual seu pokémon favorito');
    });

    test('should detect wake word and extract command when wake word is in the middle', () => {
        const result = whisperService.parseWakeWord('toca metallica, alfred, por favor');
        expect(result.detected).toBe(true);
        expect(result.command).toBe('toca metallica, por favor');
    });

    test('should return empty command if only the wake word was spoken', () => {
        const result = whisperService.parseWakeWord('alfred');
        expect(result.detected).toBe(true);
        expect(result.command).toBe('');
    });

    test('should return detected false if wake word is absent', () => {
        const result = whisperService.parseWakeWord('como está o clima hoje?');
        expect(result.detected).toBe(false);
        expect(result.command).toBe('');
    });

    test('should ignore common Whisper hallucinations', () => {
        const result = whisperService.parseWakeWord('legendas por');
        expect(result.detected).toBe(false);
        expect(result.command).toBe('');
    });
});
