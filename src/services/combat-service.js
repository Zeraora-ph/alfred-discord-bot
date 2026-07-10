/**
 * Combat Service
 * Tracker de combate/iniciativa de RPG. Lógica pura sobre um objeto `state`
 * (rodada, índice do turno, lista de combatentes) — a persistência é feita
 * pela camada rpg-db (saveCombat/getCombat/endCombat), então tudo aqui é
 * testável sem banco nem Discord.
 *
 * Formato do state (compatível com rpg_combat):
 *   { channelId, guildId, round, turnIndex, combatants: [ Combatant ] }
 *
 * Combatant:
 *   { id, name, init, initBonus, hp, maxHp, ac, isPC, userId, characterId }
 *
 * @module services/combat-service
 */

const { EmbedBuilder } = require('discord.js');
const dice = require('./dice-service');

// ============================================
// Criação / combatentes
// ============================================

function newCombat(guildId, channelId) {
  return { channelId, guildId, round: 1, turnIndex: 0, combatants: [] };
}

function _nextId(combatants) {
  return combatants.reduce((max, c) => Math.max(max, c.id || 0), 0) + 1;
}

/** Garante nome único (Goblin, Goblin 2, Goblin 3...). */
function _uniqueName(combatants, name) {
  const base = name.trim();
  if (!combatants.some(c => c.name.toLowerCase() === base.toLowerCase())) return base;
  let n = 2;
  while (combatants.some(c => c.name.toLowerCase() === `${base} ${n}`.toLowerCase())) n++;
  return `${base} ${n}`;
}

/**
 * Ordena por iniciativa (desc), desempatando por bônus, depois PC antes de NPC,
 * depois nome. Retorna uma nova lista (não muta a original).
 */
function sortInitiative(combatants) {
  return [...combatants].sort((a, b) =>
    (b.init - a.init) ||
    ((b.initBonus || 0) - (a.initBonus || 0)) ||
    (Number(b.isPC) - Number(a.isPC)) ||
    a.name.localeCompare(b.name)
  );
}

/**
 * Adiciona um combatente e reordena, preservando de quem é o turno atual.
 * @param {object} state
 * @param {object} data - { name, init, initBonus?, hp, maxHp?, ac?, isPC?, userId?, characterId? }
 * @returns {object} o combatente inserido
 */
function addCombatant(state, data) {
  const currentId = state.combatants[state.turnIndex]?.id ?? null;

  const combatant = {
    id: _nextId(state.combatants),
    name: _uniqueName(state.combatants, data.name || 'Combatente'),
    init: Number.isFinite(data.init) ? data.init : 0,
    initBonus: Number(data.initBonus) || 0,
    hp: Math.max(0, Math.floor(Number(data.hp) || 0)),
    maxHp: Math.max(0, Math.floor(Number(data.maxHp ?? data.hp) || 0)),
    ac: data.ac == null ? null : Math.floor(Number(data.ac)),
    isPC: !!data.isPC,
    userId: data.userId || null,
    characterId: data.characterId || null,
  };

  state.combatants.push(combatant);
  state.combatants = sortInitiative(state.combatants);

  // Mantém o ponteiro no mesmo ator (o índice pode ter mudado com a reordenação).
  if (currentId != null) {
    const idx = state.combatants.findIndex(c => c.id === currentId);
    if (idx >= 0) state.turnIndex = idx;
  }
  return combatant;
}

/** Rola a iniciativa de um NPC: 1d20 + bônus. */
function rollNpcInitiative(bonus = 0) {
  const r = dice.rollCheck(bonus, 'normal');
  return { init: r.total, roll: r, bonus };
}

/** Acha um combatente por nome (parcial, case-insensitive). */
function findCombatant(state, name) {
  const q = String(name || '').toLowerCase().trim();
  if (!q) return null;
  return state.combatants.find(c => c.name.toLowerCase() === q)
      || state.combatants.find(c => c.name.toLowerCase().includes(q))
      || null;
}

// ============================================
// Fluxo de turno
// ============================================

/** Combatente do turno atual. */
function currentActor(state) {
  return state.combatants[state.turnIndex] || null;
}

/**
 * Avança para o próximo turno, pulando combatentes caídos (0 PV). Vira a rodada
 * ao passar do último. Retorna { actor, wrapped }.
 */
function nextTurn(state) {
  const n = state.combatants.length;
  if (n === 0) return { actor: null, wrapped: false };

  let wrapped = false;
  for (let step = 0; step < n; step++) {
    state.turnIndex++;
    if (state.turnIndex >= n) {
      state.turnIndex = 0;
      state.round++;
      wrapped = true;
    }
    if ((state.combatants[state.turnIndex]?.hp ?? 0) > 0) break; // pula caídos
  }
  return { actor: currentActor(state), wrapped };
}

// ============================================
// Dano / cura / remoção
// ============================================

function applyDamage(state, name, amount) {
  const c = findCombatant(state, name);
  if (!c) return { found: false };
  const dmg = Math.max(0, Math.floor(Number(amount) || 0));
  c.hp = Math.max(0, c.hp - dmg);
  return { found: true, combatant: c, defeated: c.hp === 0, amount: dmg };
}

function heal(state, name, amount) {
  const c = findCombatant(state, name);
  if (!c) return { found: false };
  const amt = Math.max(0, Math.floor(Number(amount) || 0));
  c.hp = Math.min(c.maxHp || c.hp + amt, c.hp + amt);
  return { found: true, combatant: c, amount: amt };
}

/** Remove um combatente e conserta o ponteiro de turno. */
function removeCombatant(state, name) {
  const idx = state.combatants.findIndex(c => c === findCombatant(state, name));
  if (idx < 0) return { found: false };
  const [removed] = state.combatants.splice(idx, 1);

  if (state.combatants.length === 0) {
    state.turnIndex = 0;
  } else if (idx < state.turnIndex) {
    state.turnIndex--; // o atual "andou" uma posição pra trás
  } else if (state.turnIndex >= state.combatants.length) {
    state.turnIndex = 0; // removeu o último e ele era o atual → volta ao topo
  }
  return { found: true, combatant: removed };
}

// ============================================
// Renderização
// ============================================

function renderEmbed(state) {
  const embed = new EmbedBuilder()
    .setColor('#b91c1c')
    .setTitle(`⚔️ Combate — Rodada ${state.round}`);

  if (!state.combatants.length) {
    embed.setDescription('_Nenhum combatente ainda. Use `/combate entrar` ou `/combate add`._');
    return embed;
  }

  const lines = state.combatants.map((c, i) => {
    const turn = i === state.turnIndex ? '▶️' : '▫️';
    const dead = c.hp <= 0 ? ' ☠️' : '';
    const acTxt = c.ac != null ? ` · CA ${c.ac}` : '';
    const pcTag = c.isPC ? '🛡️ ' : '';
    const hpTxt = c.isPC || c.hp > 0
      ? `${c.hp}/${c.maxHp} PV`
      : 'caído';
    const nameTxt = i === state.turnIndex ? `**${pcTag}${c.name}**` : `${pcTag}${c.name}`;
    return `${turn} \`${String(c.init).padStart(2)}\` ${nameTxt} — ${hpTxt}${acTxt}${dead}`;
  });

  const actor = currentActor(state);
  embed.setDescription(lines.join('\n'));
  if (actor) embed.addFields({ name: 'Vez de', value: `▶️ **${actor.name}**` });
  embed.setFooter({ text: '/combate proximo · /combate dano <nome> <valor> · /combate encerrar' });
  return embed;
}

module.exports = {
  newCombat,
  sortInitiative,
  addCombatant,
  rollNpcInitiative,
  findCombatant,
  currentActor,
  nextTurn,
  applyDamage,
  heal,
  removeCombatant,
  renderEmbed,
};
