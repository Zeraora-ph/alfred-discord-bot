/**
 * Dice Service
 * Motor de rolagem de dados para RPG. Suporta a notação padrão usada em D&D e
 * na maioria dos sistemas de mesa.
 *
 * Sintaxe suportada:
 *   - `d20`, `1d20`, `2d6`            → N dados de M lados (N padrão = 1)
 *   - `+5`, `-2`                      → modificadores constantes
 *   - `2d6+1d4+3`                     → múltiplos termos somados
 *   - `4d6kh3`                        → mantém os 3 maiores (keep highest) — ex: rolar atributo
 *   - `4d6kl3`                        → mantém os 3 menores (keep lowest)
 *   - `2d20kh1` / `2d20kl1`           → vantagem / desvantagem
 *   - `3d6!`                          → dados explosivos (rola de novo no valor máximo)
 *   - `vantagem` / `desvantagem`      → atalho para 2d20kh1 / 2d20kl1
 *   - `adv` / `dis`                   → idem, em inglês
 *
 * A rolagem é puramente lógica (sem I/O), então é 100% testável.
 *
 * @module services/dice-service
 */

const MAX_DICE_PER_TERM = 100;   // trava anti-abuso
const MAX_SIDES         = 1000;
const MAX_TERMS         = 50;

/**
 * Rola um único dado de N lados.
 * @param {number} sides
 * @returns {number} valor entre 1 e sides
 */
function rollDie(sides) {
    return 1 + Math.floor(Math.random() * sides);
}

/**
 * Normaliza atalhos em linguagem natural (PT-BR/EN) para notação de dados.
 * @param {string} expr - expressão já sem espaços e em minúsculas
 * @returns {string}
 */
function _normalizeShortcuts(expr) {
    // Ordem importa: "desvantagem" contém "vantagem", então trata a desvantagem primeiro.
    return expr
        .replace(/desvantagem|disadvantage|\bdis\b/g, '2d20kl1')
        .replace(/vantagem|advantage|\badv\b/g, '2d20kh1');
}

/**
 * Rola um termo de dados individual (ex: "4d6kh3", "2d6", "d20!").
 * @param {Object} parsed
 * @param {number} parsed.count
 * @param {number} parsed.sides
 * @param {'kh'|'kl'|null} parsed.keepMode
 * @param {number|null} parsed.keepCount
 * @param {boolean} parsed.explode
 * @returns {{ rolls: number[], kept: number[], dropped: number[], value: number }}
 */
function _rollDiceTerm({ count, sides, keepMode, keepCount, explode }) {
    let rolls = [];

    for (let i = 0; i < count; i++) {
        let r = rollDie(sides);
        rolls.push(r);
        // Dados explosivos: no valor máximo, rola outro dado (limitado para não travar)
        if (explode && sides > 1) {
            let guard = 0;
            while (r === sides && guard < 100) {
                r = rollDie(sides);
                rolls.push(r);
                guard++;
            }
        }
    }

    let kept = rolls;
    let dropped = [];

    if (keepMode && keepCount != null && keepCount < rolls.length) {
        const indexed = rolls.map((v, i) => ({ v, i }));
        indexed.sort((a, b) => keepMode === 'kh' ? b.v - a.v : a.v - b.v);
        const keepIdx = new Set(indexed.slice(0, keepCount).map(x => x.i));
        kept = [];
        dropped = [];
        rolls.forEach((v, i) => (keepIdx.has(i) ? kept : dropped).push(v));
    }

    const value = kept.reduce((a, b) => a + b, 0);
    return { rolls, kept, dropped, value };
}

/**
 * Faz o parse e a rolagem de uma expressão completa de dados.
 *
 * @param {string} expression - ex: "1d20+5", "4d6kh3", "vantagem +3"
 * @returns {{
 *   expression: string,
 *   total: number,
 *   terms: Array<Object>,
 *   isNat20: boolean,
 *   isNat1: boolean,
 *   text: string
 * }}
 * @throws {Error} se a expressão for inválida
 */
function roll(expression) {
    if (expression == null || typeof expression !== 'string') {
        throw new Error('Expressão de dados inválida.');
    }

    const raw = expression.trim();
    let expr = _normalizeShortcuts(raw.toLowerCase().replace(/\s+/g, ''));

    if (!expr) throw new Error('Expressão de dados vazia.');
    if (!/^[0-9d+\-!khl]+$/.test(expr)) {
        throw new Error(`Expressão inválida: "${raw}". Use algo como \`1d20+5\` ou \`4d6kh3\`.`);
    }

    // Quebra em termos com sinal: +2d6, -3, +1d4...
    const termMatches = expr.match(/[+-]?[^+-]+/g) || [];
    if (termMatches.length === 0 || termMatches.length > MAX_TERMS) {
        throw new Error('Expressão de dados com termos demais ou nenhum termo válido.');
    }

    const terms = [];
    let total = 0;
    let singleD20 = null; // rastreia se a rolagem foi um único d20 puro (pra crítico)
    let d20Count = 0;

    for (const rawTerm of termMatches) {
        const sign = rawTerm.startsWith('-') ? -1 : 1;
        const body = rawTerm.replace(/^[+-]/, '');

        // Constante pura
        if (/^\d+$/.test(body)) {
            const value = parseInt(body, 10) * sign;
            total += value;
            terms.push({ type: 'const', sign, value, text: `${sign < 0 ? '-' : '+'}${body}` });
            continue;
        }

        // Termo de dados: NdM[kh|kl|k][N][!]
        const m = body.match(/^(\d*)d(\d+)(kh|kl|k)?(\d+)?(!)?$/);
        if (!m) {
            throw new Error(`Termo de dados inválido: "${rawTerm}".`);
        }

        const count = m[1] ? parseInt(m[1], 10) : 1;
        const sides = parseInt(m[2], 10);
        let keepMode = m[3] || null;
        if (keepMode === 'k') keepMode = 'kh'; // "k" sozinho = keep highest
        const keepCount = m[4] ? parseInt(m[4], 10) : (keepMode ? 1 : null);
        const explode = !!m[5];

        if (count < 1 || count > MAX_DICE_PER_TERM) {
            throw new Error(`Número de dados fora do limite (1-${MAX_DICE_PER_TERM}).`);
        }
        if (sides < 1 || sides > MAX_SIDES) {
            throw new Error(`Número de lados fora do limite (1-${MAX_SIDES}).`);
        }

        const rolled = _rollDiceTerm({ count, sides, keepMode, keepCount, explode });
        const value = rolled.value * sign;
        total += value;

        if (sides === 20) {
            d20Count += count;
            singleD20 = rolled.kept.length === 1 ? rolled.kept[0] : singleD20;
        }

        terms.push({
            type: 'dice',
            sign,
            count,
            sides,
            keepMode,
            keepCount,
            explode,
            rolls: rolled.rolls,
            kept: rolled.kept,
            dropped: rolled.dropped,
            value,
            text: _formatDiceTerm(sign, body, rolled)
        });
    }

    // Crítico só faz sentido num único d20 rolado (com ou sem vantagem/desvantagem resultando em 1 mantido)
    const isNat20 = d20Count > 0 && singleD20 === 20;
    const isNat1  = d20Count > 0 && singleD20 === 1;

    const text = terms.map(t => t.text).join(' ').replace(/^\+\s*/, '').trim();

    return { expression: raw, total, terms, isNat20, isNat1, text };
}

/**
 * Formata a representação textual de um termo de dados para exibição.
 * @private
 */
function _formatDiceTerm(sign, body, rolled) {
    const prefix = sign < 0 ? '- ' : '+ ';
    let dicePart;
    if (rolled.dropped.length > 0) {
        const keptStr = rolled.kept.join(', ');
        const dropStr = rolled.dropped.map(d => `~~${d}~~`).join(', ');
        dicePart = `${body} [${keptStr}${dropStr ? ', ' + dropStr : ''}]`;
    } else {
        dicePart = `${body} [${rolled.rolls.join(', ')}]`;
    }
    return `${prefix}${dicePart}`;
}

/**
 * Monta uma string amigável do resultado para exibir no Discord.
 * @param {ReturnType<roll>} result
 * @param {string} [label] - rótulo opcional (ex: "Ataque de Espada")
 * @returns {string}
 */
function formatResult(result, label = '') {
    const head = label ? `**${label}** — \`${result.expression}\`` : `🎲 \`${result.expression}\``;
    let crit = '';
    if (result.isNat20) crit = '  🌟 **CRÍTICO!**';
    else if (result.isNat1) crit = '  💀 **FALHA CRÍTICA!**';

    // Detalhamento (só mostra se houver dados, não só constante)
    const hasDice = result.terms.some(t => t.type === 'dice');
    const detail = hasDice ? `\n> ${result.text}` : '';

    return `${head}${detail}\n# 🎲 ${result.total}${crit}`;
}

/**
 * Rola um teste com vantagem/desvantagem sobre um bônus fixo.
 * Conveniência usada pelas fichas (ex: teste de perícia).
 *
 * @param {number} bonus - modificador a somar (pode ser negativo)
 * @param {'normal'|'vantagem'|'desvantagem'} mode
 * @returns {ReturnType<roll>}
 */
function rollCheck(bonus = 0, mode = 'normal') {
    const b = bonus >= 0 ? `+${bonus}` : `${bonus}`;
    let dice = '1d20';
    if (mode === 'vantagem') dice = '2d20kh1';
    else if (mode === 'desvantagem') dice = '2d20kl1';
    return roll(`${dice}${bonus ? b : ''}`);
}

module.exports = {
    roll,
    rollCheck,
    formatResult,
    rollDie,
    // exports internos para teste
    _rollDiceTerm,
    _normalizeShortcuts
};
