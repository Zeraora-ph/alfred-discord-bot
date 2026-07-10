/**
 * Unit Tests — Dice Service
 */

const dice = require('../../src/services/dice-service');

describe('DiceService — roll()', () => {
    test('rola constante pura', () => {
        const r = dice.roll('5');
        expect(r.total).toBe(5);
        expect(r.terms).toHaveLength(1);
        expect(r.terms[0].type).toBe('const');
    });

    test('rola 1d20 dentro do intervalo válido', () => {
        for (let i = 0; i < 200; i++) {
            const r = dice.roll('1d20');
            expect(r.total).toBeGreaterThanOrEqual(1);
            expect(r.total).toBeLessThanOrEqual(20);
        }
    });

    test('d20 sem contagem assume 1 dado', () => {
        const r = dice.roll('d20');
        expect(r.terms[0].count).toBe(1);
        expect(r.total).toBeGreaterThanOrEqual(1);
        expect(r.total).toBeLessThanOrEqual(20);
    });

    test('soma dados + modificador', () => {
        for (let i = 0; i < 200; i++) {
            const r = dice.roll('2d6+3');
            expect(r.total).toBeGreaterThanOrEqual(5);   // 2*1 + 3
            expect(r.total).toBeLessThanOrEqual(15);      // 2*6 + 3
        }
    });

    test('modificador negativo', () => {
        for (let i = 0; i < 100; i++) {
            const r = dice.roll('1d4-1');
            expect(r.total).toBeGreaterThanOrEqual(0);
            expect(r.total).toBeLessThanOrEqual(3);
        }
    });

    test('múltiplos termos de dados', () => {
        for (let i = 0; i < 100; i++) {
            const r = dice.roll('1d8+1d6+2');
            expect(r.total).toBeGreaterThanOrEqual(4);    // 1+1+2
            expect(r.total).toBeLessThanOrEqual(16);       // 8+6+2
        }
    });

    test('4d6kh3 mantém os 3 maiores (3..18)', () => {
        for (let i = 0; i < 300; i++) {
            const r = dice.roll('4d6kh3');
            expect(r.terms[0].rolls).toHaveLength(4);
            expect(r.terms[0].kept).toHaveLength(3);
            expect(r.terms[0].dropped).toHaveLength(1);
            // o dado descartado deve ser <= menor mantido
            const minKept = Math.min(...r.terms[0].kept);
            expect(r.terms[0].dropped[0]).toBeLessThanOrEqual(minKept);
            expect(r.total).toBeGreaterThanOrEqual(3);
            expect(r.total).toBeLessThanOrEqual(18);
        }
    });

    test('4d6kl3 mantém os 3 menores', () => {
        const r = dice.roll('4d6kl3');
        const maxKept = Math.max(...r.terms[0].kept);
        expect(r.terms[0].dropped[0]).toBeGreaterThanOrEqual(maxKept);
    });

    test('vantagem = 2d20kh1', () => {
        for (let i = 0; i < 100; i++) {
            const r = dice.roll('vantagem');
            expect(r.terms[0].rolls).toHaveLength(2);
            expect(r.terms[0].kept).toHaveLength(1);
            expect(r.total).toBe(Math.max(...r.terms[0].rolls));
        }
    });

    test('desvantagem = 2d20kl1', () => {
        for (let i = 0; i < 100; i++) {
            const r = dice.roll('desvantagem');
            expect(r.total).toBe(Math.min(...r.terms[0].rolls));
        }
    });

    test('vantagem com modificador', () => {
        const r = dice.roll('vantagem +5');
        expect(r.total).toBe(Math.max(...r.terms[0].rolls) + 5);
    });

    test('detecta crítico natural 20', () => {
        // força o RNG a devolver sempre 20
        const spy = jest.spyOn(Math, 'random').mockReturnValue(0.9999);
        const r = dice.roll('1d20+5');
        expect(r.isNat20).toBe(true);
        expect(r.total).toBe(25);
        spy.mockRestore();
    });

    test('detecta falha crítica natural 1', () => {
        const spy = jest.spyOn(Math, 'random').mockReturnValue(0);
        const r = dice.roll('1d20');
        expect(r.isNat1).toBe(true);
        expect(r.total).toBe(1);
        spy.mockRestore();
    });

    test('dados explosivos rolam de novo no máximo', () => {
        // primeiro d6 = 6 (explode), segundo = 3 (para)
        const spy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.99)   // 6
            .mockReturnValueOnce(0.4);   // 3
        const r = dice.roll('1d6!');
        expect(r.terms[0].rolls).toEqual([6, 3]);
        expect(r.total).toBe(9);
        spy.mockRestore();
    });

    test('rejeita expressão vazia', () => {
        expect(() => dice.roll('')).toThrow();
    });

    test('rejeita lixo', () => {
        expect(() => dice.roll('banana')).toThrow();
    });

    test('rejeita dados demais (anti-abuso)', () => {
        expect(() => dice.roll('999d6')).toThrow();
    });

    test('ignora espaços e caixa', () => {
        const r = dice.roll('  2D6 + 1  ');
        expect(r.total).toBeGreaterThanOrEqual(3);
        expect(r.total).toBeLessThanOrEqual(13);
    });
});

describe('DiceService — rollCheck()', () => {
    test('teste normal soma o bônus', () => {
        const r = dice.rollCheck(3, 'normal');
        expect(r.total).toBeGreaterThanOrEqual(4);
        expect(r.total).toBeLessThanOrEqual(23);
    });

    test('teste com vantagem usa 2 dados', () => {
        const r = dice.rollCheck(2, 'vantagem');
        expect(r.terms[0].rolls).toHaveLength(2);
    });

    test('bônus zero não quebra', () => {
        const r = dice.rollCheck(0, 'normal');
        expect(r.total).toBeGreaterThanOrEqual(1);
        expect(r.total).toBeLessThanOrEqual(20);
    });
});

describe('DiceService — formatResult()', () => {
    test('inclui rótulo e total', () => {
        const r = dice.roll('1d20+5');
        const out = dice.formatResult(r, 'Ataque');
        expect(out).toContain('Ataque');
        expect(out).toContain(String(r.total));
    });
});
