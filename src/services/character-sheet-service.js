/**
 * Character Sheet Service
 * Modelo de ficha de personagem D&D 5e com cálculos automáticos, persistência,
 * geração assistida por IA e renderização em embed do Discord.
 *
 * Filosofia: a IA escolhe o que é CRIATIVO (raça, classe, antecedente, perícias,
 * magias, equipamento, personalidade). O CÓDIGO recalcula tudo que é MATEMÁTICO
 * (modificadores, bônus de proficiência, CD de magia, testes, PV) — a IA erra
 * conta, então nunca confiamos nos números que ela devolve.
 *
 * @module services/character-sheet-service
 */

const { EmbedBuilder } = require('discord.js');
const logger = require('../lib/logger');
const rpgDb = require('../lib/rpg-db');
const dice = require('./dice-service');
const aiClient = require('../lib/ai-client');

// ============================================
// Constantes D&D 5e
// ============================================

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

const ABILITY_LABEL = {
    str: 'Força', dex: 'Destreza', con: 'Constituição',
    int: 'Inteligência', wis: 'Sabedoria', cha: 'Carisma'
};
const ABILITY_SHORT = { str: 'FOR', dex: 'DES', con: 'CON', int: 'INT', wis: 'SAB', cha: 'CAR' };

// Perícia → { habilidade base, rótulo PT-BR }
const SKILLS = {
    acrobacia:         { ability: 'dex', label: 'Acrobacia' },
    adestrar_animais:  { ability: 'wis', label: 'Adestrar Animais' },
    arcanismo:         { ability: 'int', label: 'Arcanismo' },
    atletismo:         { ability: 'str', label: 'Atletismo' },
    atuacao:           { ability: 'cha', label: 'Atuação' },
    enganacao:         { ability: 'cha', label: 'Enganação' },
    furtividade:       { ability: 'dex', label: 'Furtividade' },
    historia:          { ability: 'int', label: 'História' },
    intimidacao:       { ability: 'cha', label: 'Intimidação' },
    intuicao:          { ability: 'wis', label: 'Intuição' },
    investigacao:      { ability: 'int', label: 'Investigação' },
    medicina:          { ability: 'wis', label: 'Medicina' },
    natureza:          { ability: 'int', label: 'Natureza' },
    percepcao:         { ability: 'wis', label: 'Percepção' },
    persuasao:         { ability: 'cha', label: 'Persuasão' },
    prestidigitacao:   { ability: 'dex', label: 'Prestidigitação' },
    religiao:          { ability: 'int', label: 'Religião' },
    sobrevivencia:     { ability: 'wis', label: 'Sobrevivência' }
};

// Dado de vida por classe (chave normalizada sem acento)
const CLASS_HIT_DIE = {
    barbaro: 12,
    guerreiro: 10, paladino: 10, patrulheiro: 10, ranger: 10,
    bardo: 8, clerigo: 8, druida: 8, monge: 8, ladino: 8, bruxo: 8, warlock: 8,
    mago: 6, feiticeiro: 6, sorcerer: 6
};

// ============================================
// Helpers matemáticos
// ============================================

/** Remove acentos e normaliza para chave de lookup. */
function normalizeKey(str) {
    return String(str || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

/** Modificador de habilidade D&D 5e. */
function abilityMod(score) {
    return Math.floor((Number(score) - 10) / 2);
}

/** Bônus de proficiência pelo nível (1-4:+2, 5-8:+3, 9-12:+4, 13-16:+5, 17-20:+6). */
function proficiencyBonus(level) {
    return Math.floor((Math.max(1, Math.min(20, level)) - 1) / 4) + 2;
}

/** Formata modificador com sinal: 3 → "+3", -1 → "-1". */
function fmtMod(n) {
    return n >= 0 ? `+${n}` : `${n}`;
}

/** Dado de vida da classe (padrão d8 se desconhecida). */
function classHitDie(className) {
    return CLASS_HIT_DIE[normalizeKey(className)] || 8;
}

/**
 * Calcula PV máximo padrão do D&D 5e:
 *   Nível 1: dado máximo + mod CON
 *   Níveis seguintes: média do dado (arredondada pra cima) + mod CON
 */
function computeMaxHp(hitDie, level, conMod) {
    const avg = Math.floor(hitDie / 2) + 1; // média fixa da regra
    let hp = hitDie + conMod;               // nível 1
    for (let i = 2; i <= level; i++) hp += avg + conMod;
    return Math.max(1, hp);
}

// ============================================
// Cálculo dos campos derivados
// ============================================

/**
 * Recalcula TODOS os campos matemáticos da ficha a partir dos dados brutos.
 * Idempotente — pode ser chamado sempre que a ficha muda.
 * @param {Object} sheet
 * @returns {Object} a mesma ficha, com `sheet.derived` atualizado
 */
function computeDerived(sheet) {
    const level = Math.max(1, Math.min(20, Number(sheet.level) || 1));
    const attrs = sheet.attributes || {};
    const pb = proficiencyBonus(level);

    const mods = {};
    for (const ab of ABILITIES) mods[ab] = abilityMod(attrs[ab] ?? 10);

    // Salvaguardas
    const profSaves = new Set((sheet.proficientSaves || []).map(normalizeKey));
    const saves = {};
    for (const ab of ABILITIES) {
        const proficient = profSaves.has(ab);
        saves[ab] = { value: mods[ab] + (proficient ? pb : 0), proficient };
    }

    // Perícias
    const skillProfs = new Set((sheet.skillProfs || []).map(normalizeKey));
    const skillExpert = new Set((sheet.skillExpertise || []).map(normalizeKey));
    const skills = {};
    for (const [key, def] of Object.entries(SKILLS)) {
        const proficient = skillProfs.has(key);
        const expertise = skillExpert.has(key);
        const bonus = mods[def.ability] + (proficient ? pb : 0) + (expertise ? pb : 0);
        skills[key] = { value: bonus, proficient, expertise, ability: def.ability, label: def.label };
    }

    const initiative = mods.dex;
    const passivePerception = 10 + skills.percepcao.value;

    // Conjuração
    let spellcasting = sheet.spellcasting || null;
    if (spellcasting && spellcasting.ability) {
        const ab = normalizeKey(spellcasting.ability);
        const abKey = ABILITIES.includes(ab) ? ab : 'int';
        spellcasting.saveDc = 8 + pb + mods[abKey];
        spellcasting.attackBonus = pb + mods[abKey];
        spellcasting.ability = abKey;
    }

    sheet.level = level;
    sheet.derived = { profBonus: pb, mods, saves, skills, initiative, passivePerception };
    sheet.spellcasting = spellcasting;
    return sheet;
}

// ============================================
// Criação
// ============================================

/**
 * Monta uma ficha base a partir de campos crus, preenchendo defaults e derivados.
 * @param {Object} input
 * @returns {Object} sheet completa
 */
function buildSheet(input = {}) {
    const sheet = {
        system: 'dnd5e',
        name: input.name || 'Aventureiro Sem Nome',
        race: input.race || '—',
        class: input.class || input.className || 'Aventureiro',
        subclass: input.subclass || '',
        background: input.background || '—',
        alignment: input.alignment || 'Neutro',
        level: Math.max(1, Math.min(20, Number(input.level) || 1)),
        attributes: {
            str: Number(input.attributes?.str) || 10,
            dex: Number(input.attributes?.dex) || 10,
            con: Number(input.attributes?.con) || 10,
            int: Number(input.attributes?.int) || 10,
            wis: Number(input.attributes?.wis) || 10,
            cha: Number(input.attributes?.cha) || 10
        },
        proficientSaves: input.proficientSaves || [],
        skillProfs: input.skillProfs || [],
        skillExpertise: input.skillExpertise || [],
        armorClass: Number(input.armorClass) || null,
        speed: input.speed || '9m',
        hitDice: null,
        maxHp: Number(input.maxHp) || null,
        currentHp: null,
        tempHp: 0,
        proficiencies: {
            armas: input.proficiencies?.armas || [],
            armaduras: input.proficiencies?.armaduras || [],
            ferramentas: input.proficiencies?.ferramentas || [],
            idiomas: input.proficiencies?.idiomas || []
        },
        features: input.features || [],
        attacks: input.attacks || [],
        spellcasting: input.spellcasting || null,
        inventory: input.inventory || [],
        currency: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0, ...(input.currency || {}) },
        conditions: input.conditions || [],
        personality: input.personality || '',
        notes: input.notes || '',
        imageUrl: input.imageUrl || null
    };

    // Dado de vida e PV (recalcula se IA não deu um valor sensato)
    const hd = classHitDie(sheet.class);
    const conMod = abilityMod(sheet.attributes.con);
    sheet.hitDice = { size: hd, total: sheet.level, remaining: sheet.level };
    if (!sheet.maxHp || sheet.maxHp < 1) {
        sheet.maxHp = computeMaxHp(hd, sheet.level, conMod);
    }
    sheet.currentHp = input.currentHp != null ? Number(input.currentHp) : sheet.maxHp;

    // CA padrão se não informada
    if (!sheet.armorClass) sheet.armorClass = 10 + abilityMod(sheet.attributes.dex);

    return computeDerived(sheet);
}

// ============================================
// Geração por IA
// ============================================

const GEN_SYSTEM_PROMPT = `Você é um assistente especialista em D&D 5ª edição que cria fichas de personagem completas e balanceadas.
A partir da descrição do usuário, escolha raça, classe, subclasse, antecedente, alinhamento, distribuição de atributos, perícias, magias e equipamento iniciais coerentes com o conceito e com o nível pedido.

REGRAS OBRIGATÓRIAS:
- Responda APENAS com um objeto JSON válido, sem texto antes ou depois, sem markdown, sem cercas de código.
- Atributos (attributes) devem ser valores FINAIS entre 3 e 20 já incluindo bônus raciais, usando um array padrão razoável (ex: 15,14,13,12,10,8 distribuídos pela classe) + bônus de raça.
- Nomes de perícias DEVEM usar EXATAMENTE estas chaves: acrobacia, adestrar_animais, arcanismo, atletismo, atuacao, enganacao, furtividade, historia, intimidacao, intuicao, investigacao, medicina, natureza, percepcao, persuasao, prestidigitacao, religiao, sobrevivencia.
- proficientSaves usa chaves: str, dex, con, int, wis, cha.
- Escolha a quantidade de perícias que a classe concede (geralmente 2, ladino 4).
- Se a classe conjura magia, preencha spellcasting.ability (int/wis/cha) e liste cantrips e magias conhecidas por nome. Caso contrário, spellcasting = null.
- NÃO calcule modificadores, CD, bônus de ataque nem PV — o sistema calcula. Você pode omitir esses campos.
- Escreva em português. Nomes de raça/classe em português (ex: "Guerreiro", "Anão da Montanha").

Formato exato do JSON:
{
  "name": "string",
  "race": "string",
  "class": "string",
  "subclass": "string",
  "background": "string",
  "alignment": "string",
  "attributes": { "str": 0, "dex": 0, "con": 0, "int": 0, "wis": 0, "cha": 0 },
  "proficientSaves": ["str","con"],
  "skillProfs": ["atletismo","intimidacao"],
  "proficiencies": { "armas": [], "armaduras": [], "ferramentas": [], "idiomas": [] },
  "features": [{ "name": "string", "desc": "string" }],
  "attacks": [{ "name": "string", "damage": "1d8", "notes": "string" }],
  "spellcasting": null,
  "inventory": [{ "name": "string", "qty": 1 }],
  "currency": { "gp": 0 },
  "personality": "string breve",
  "armorClass": 0,
  "speed": "9m"
}`;

/**
 * Extrai o primeiro objeto JSON de uma resposta de IA (tolerante a cercas/ruído).
 * @param {string} text
 * @returns {Object|null}
 */
function extractJson(text) {
    if (!text) return null;
    let t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/,'').trim();
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    const slice = t.slice(start, end + 1);
    try { return JSON.parse(slice); } catch {
        // tentativa de saneamento: remove vírgulas finais
        try { return JSON.parse(slice.replace(/,(\s*[}\]])/g, '$1')); } catch { return null; }
    }
}

/**
 * Gera uma ficha completa a partir de uma descrição em linguagem natural.
 * @param {string} description - ex: "anão guerreiro tanque veterano de guerra"
 * @param {Object} [opts]
 * @param {number} [opts.level=1]
 * @param {string} [opts.name] - nome forçado (senão a IA inventa)
 * @returns {Promise<{ success: boolean, sheet?: Object, message?: string }>}
 */
async function generateWithAI(description, opts = {}) {
    const level = Math.max(1, Math.min(20, Number(opts.level) || 1));
    const userMsg = `Descrição do personagem: "${description}"\nNível: ${level}${opts.name ? `\nNome do personagem: ${opts.name}` : ''}\n\nGere a ficha em JSON.`;

    const messages = [
        { role: 'system', content: GEN_SYSTEM_PROMPT },
        { role: 'user', content: userMsg }
    ];

    try {
        const response = await aiClient.chat(messages, { temperature: 0.7, maxTokens: 2000 });
        const content = response.choices?.[0]?.message?.content || '';
        const parsed = extractJson(content);
        if (!parsed) {
            logger.warn(`[CharSheet] IA não retornou JSON válido. Resposta: ${content.slice(0, 200)}`);
            return { success: false, message: 'A IA não conseguiu montar a ficha em formato válido. Tente descrever de novo.' };
        }

        if (opts.name) parsed.name = opts.name;
        parsed.level = level;
        const sheet = buildSheet(parsed);
        return { success: true, sheet };
    } catch (err) {
        logger.error(`[CharSheet] Erro na geração por IA: ${err.message}`);
        return { success: false, message: `Erro ao gerar ficha com IA: ${err.message}` };
    }
}

// ============================================
// Persistência (wrappers sobre rpg-db)
// ============================================

function saveNew(guildId, userId, sheet, campaignId = null) {
    computeDerived(sheet);
    const id = rpgDb.insertCharacter({
        guildId, userId, campaignId,
        name: sheet.name, system: sheet.system || 'dnd5e',
        level: sheet.level, sheet
    });
    return id;
}

function persist(character) {
    computeDerived(character.sheet);
    rpgDb.updateCharacterSheet(character.id, character.sheet, character.sheet.level);
}

function getActive(guildId, userId) {
    return rpgDb.getActiveCharacter(guildId, userId);
}

// ============================================
// Ações de jogo
// ============================================

/** Aplica dano (consome PV temporário primeiro). */
function applyDamage(character, amount) {
    const s = character.sheet;
    let dmg = Math.max(0, Math.floor(amount));
    if (s.tempHp > 0) {
        const absorbed = Math.min(s.tempHp, dmg);
        s.tempHp -= absorbed;
        dmg -= absorbed;
    }
    s.currentHp = Math.max(0, s.currentHp - dmg);
    persist(character);
    return { currentHp: s.currentHp, maxHp: s.maxHp, down: s.currentHp === 0 };
}

/** Cura PV (não passa do máximo). */
function heal(character, amount) {
    const s = character.sheet;
    s.currentHp = Math.min(s.maxHp, s.currentHp + Math.max(0, Math.floor(amount)));
    persist(character);
    return { currentHp: s.currentHp, maxHp: s.maxHp };
}

/** Descanso longo: PV cheio, dados de vida recuperados, remove PV temporário. */
function longRest(character) {
    const s = character.sheet;
    s.currentHp = s.maxHp;
    s.tempHp = 0;
    if (s.hitDice) s.hitDice.remaining = s.hitDice.total;
    // reseta slots de magia usados
    if (s.spellcasting?.slots) {
        for (const lvl of Object.keys(s.spellcasting.slots)) s.spellcasting.slots[lvl].used = 0;
    }
    s.conditions = [];
    persist(character);
    return { currentHp: s.currentHp, maxHp: s.maxHp };
}

/** Sobe um nível: recalcula PV, dados de vida e derivados. */
function levelUp(character) {
    const s = character.sheet;
    if (s.level >= 20) return { success: false, message: 'Já está no nível máximo (20).' };
    s.level += 1;
    const hd = classHitDie(s.class);
    const conMod = abilityMod(s.attributes.con);
    const gained = Math.floor(hd / 2) + 1 + conMod; // média + CON
    s.maxHp += Math.max(1, gained);
    s.currentHp += Math.max(1, gained);
    s.hitDice = { size: hd, total: s.level, remaining: s.level };
    persist(character);
    return { success: true, level: s.level, hpGanho: Math.max(1, gained), maxHp: s.maxHp };
}

/**
 * Rola um teste de perícia da ficha (aplica o modificador correto).
 * @param {Object} character
 * @param {string} skillKey - chave normalizada (ex: 'furtividade')
 * @param {'normal'|'vantagem'|'desvantagem'} mode
 */
function rollSkill(character, skillKey, mode = 'normal') {
    const key = normalizeKey(skillKey).replace(/\s+/g, '_');
    const skill = character.sheet.derived?.skills?.[key];
    if (!skill) return null;
    const result = dice.rollCheck(skill.value, mode);
    return { result, skill: SKILLS[key].label, bonus: skill.value };
}

/** Rola uma salvaguarda de atributo. */
function rollSave(character, abilityKey, mode = 'normal') {
    const ab = normalizeKey(abilityKey);
    const save = character.sheet.derived?.saves?.[ab];
    if (!save) return null;
    const result = dice.rollCheck(save.value, mode);
    return { result, ability: ABILITY_LABEL[ab], bonus: save.value };
}

/** Rola um teste puro de habilidade. */
function rollAbility(character, abilityKey, mode = 'normal') {
    const ab = normalizeKey(abilityKey);
    const mod = character.sheet.derived?.mods?.[ab];
    if (mod == null) return null;
    const result = dice.rollCheck(mod, mode);
    return { result, ability: ABILITY_LABEL[ab], bonus: mod };
}

/** Rola iniciativa (mod de destreza). */
function rollInitiative(character, mode = 'normal') {
    const mod = character.sheet.derived?.initiative ?? 0;
    return { result: dice.rollCheck(mod, mode), bonus: mod };
}

// ============================================
// Renderização
// ============================================

/** Barra de vida em blocos. */
function hpBar(current, max) {
    const ratio = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
    const filled = Math.round(ratio * 10);
    return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

/**
 * Renderiza a ficha como embed do Discord.
 * @param {Object} character - linha do DB ({ id, sheet, ... })
 * @returns {EmbedBuilder}
 */
function renderEmbed(character) {
    const s = character.sheet;
    computeDerived(s);
    const d = s.derived;

    const attrLine = ABILITIES
        .map(ab => `**${ABILITY_SHORT[ab]}** ${s.attributes[ab]} (${fmtMod(d.mods[ab])})`)
        .join(' • ');

    // Perícias proficientes (mostra só as treinadas pra não poluir)
    const trainedSkills = Object.entries(d.skills)
        .filter(([, v]) => v.proficient || v.expertise)
        .map(([, v]) => `${v.label} ${fmtMod(v.value)}${v.expertise ? ' ⭐' : ''}`);

    const saveLine = ABILITIES
        .map(ab => `${ABILITY_SHORT[ab]} ${fmtMod(d.saves[ab].value)}${d.saves[ab].proficient ? '●' : ''}`)
        .join(' • ');

    const embed = new EmbedBuilder()
        .setColor('#8b5cf6')
        .setTitle(`📋 ${s.name}`)
        .setDescription(`*${s.race} • ${s.class}${s.subclass ? ` (${s.subclass})` : ''} • Nível ${s.level}*\n${s.background ? `Antecedente: ${s.background} • ` : ''}${s.alignment}`)
        .addFields(
            {
                name: `❤️ PV  ${s.currentHp}/${s.maxHp}${s.tempHp ? ` (+${s.tempHp} temp)` : ''}`,
                value: `\`${hpBar(s.currentHp, s.maxHp)}\``,
                inline: false
            },
            { name: '🛡️ CA', value: `${s.armorClass}`, inline: true },
            { name: '⚡ Iniciativa', value: fmtMod(d.initiative), inline: true },
            { name: '👁️ Perc. Passiva', value: `${d.passivePerception}`, inline: true },
            { name: '🎯 Bônus Prof.', value: fmtMod(d.profBonus), inline: true },
            { name: '🏃 Deslocamento', value: `${s.speed}`, inline: true },
            { name: '🎲 Dados de Vida', value: `${s.hitDice.remaining}/${s.hitDice.total}d${s.hitDice.size}`, inline: true },
            { name: '📊 Atributos', value: attrLine, inline: false },
            { name: '💪 Salvaguardas', value: saveLine, inline: false }
        );

    if (trainedSkills.length) {
        embed.addFields({ name: '🎓 Perícias Treinadas', value: trainedSkills.join(' • '), inline: false });
    }

    if (s.spellcasting?.ability) {
        const sc = s.spellcasting;
        let spellVal = `Atributo: ${ABILITY_SHORT[sc.ability]} • CD ${sc.saveDc} • Ataque ${fmtMod(sc.attackBonus)}`;
        if (sc.cantrips?.length) spellVal += `\n**Truques:** ${sc.cantrips.join(', ')}`;
        if (sc.known?.length) spellVal += `\n**Magias:** ${sc.known.slice(0, 12).join(', ')}`;
        embed.addFields({ name: '✨ Conjuração', value: spellVal.slice(0, 1024), inline: false });
    }

    if (s.attacks?.length) {
        const atk = s.attacks.slice(0, 6).map(a => {
            const bonus = a.bonus != null ? ` ${fmtMod(a.bonus)}` : '';
            return `**${a.name}**${bonus} — ${a.damage || '?'}${a.notes ? ` (${a.notes})` : ''}`;
        }).join('\n');
        embed.addFields({ name: '⚔️ Ataques', value: atk.slice(0, 1024), inline: false });
    }

    if (s.inventory?.length) {
        const inv = s.inventory.slice(0, 15).map(i =>
            typeof i === 'string' ? i : `${i.name}${i.qty > 1 ? ` x${i.qty}` : ''}`
        ).join(', ');
        embed.addFields({ name: '🎒 Inventário', value: inv.slice(0, 1024), inline: false });
    }

    const coins = s.currency;
    const coinStr = ['pp', 'gp', 'ep', 'sp', 'cp'].filter(c => coins[c]).map(c => `${coins[c]}${c}`).join(' ');
    if (coinStr) embed.addFields({ name: '💰 Moedas', value: coinStr, inline: true });

    if (s.conditions?.length) {
        embed.addFields({ name: '⚠️ Condições', value: s.conditions.join(', '), inline: false });
    }

    if (s.personality) embed.setFooter({ text: s.personality.slice(0, 200) });
    if (s.imageUrl) embed.setThumbnail(s.imageUrl);

    return embed;
}

module.exports = {
    // constantes
    ABILITIES, ABILITY_LABEL, ABILITY_SHORT, SKILLS,
    // matemática
    abilityMod, proficiencyBonus, classHitDie, computeMaxHp, computeDerived, normalizeKey, fmtMod,
    // criação
    buildSheet, generateWithAI, extractJson,
    // persistência
    saveNew, persist, getActive,
    // ações
    applyDamage, heal, longRest, levelUp,
    rollSkill, rollSave, rollAbility, rollInitiative,
    // render
    renderEmbed, hpBar
};
