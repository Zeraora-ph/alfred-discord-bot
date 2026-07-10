/**
 * Testes do combat-service: ordenação de iniciativa, controle de turno/rodada
 * (incluindo pular caídos), dano/cura com clamp e remoção com conserto do
 * ponteiro de turno. Lógica pura — sem banco nem Discord.
 */
const combat = require('../../src/services/combat-service');

function mkState(combatants) {
  return { channelId: 'c1', guildId: 'g1', round: 1, turnIndex: 0, combatants };
}
function mkCombatant(id, name, init, extra = {}) {
  return { id, name, init, initBonus: 0, hp: 10, maxHp: 10, ac: 12, isPC: false, ...extra };
}

describe('sortInitiative', () => {
  test('ordena por iniciativa decrescente', () => {
    const out = combat.sortInitiative([mkCombatant(1, 'A', 10), mkCombatant(2, 'B', 20), mkCombatant(3, 'C', 15)]);
    expect(out.map(c => c.name)).toEqual(['B', 'C', 'A']);
  });

  test('empate: PC vem antes de NPC', () => {
    const out = combat.sortInitiative([
      mkCombatant(1, 'Goblin', 15, { isPC: false }),
      mkCombatant(2, 'Herói', 15, { isPC: true }),
    ]);
    expect(out.map(c => c.name)).toEqual(['Herói', 'Goblin']);
  });

  test('empate: maior bônus desempata antes do nome', () => {
    const out = combat.sortInitiative([
      mkCombatant(1, 'Zed', 15, { initBonus: 1 }),
      mkCombatant(2, 'Ana', 15, { initBonus: 5 }),
    ]);
    expect(out.map(c => c.name)).toEqual(['Ana', 'Zed']);
  });
});

describe('addCombatant', () => {
  test('gera nome único para duplicatas', () => {
    const state = mkState([]);
    combat.addCombatant(state, { name: 'Goblin', init: 10, hp: 7 });
    combat.addCombatant(state, { name: 'Goblin', init: 8, hp: 7 });
    expect(state.combatants.map(c => c.name).sort()).toEqual(['Goblin', 'Goblin 2']);
  });

  test('preserva de quem é o turno ao reordenar', () => {
    const state = mkState([mkCombatant(1, 'A', 20), mkCombatant(2, 'B', 10)]);
    state.turnIndex = 1; // turno do B
    combat.addCombatant(state, { name: 'C', init: 30, hp: 10 }); // entra no topo
    expect(combat.currentActor(state).name).toBe('B'); // ainda é o B
  });

  test('clampa hp e maxHp para inteiros não-negativos', () => {
    const state = mkState([]);
    const c = combat.addCombatant(state, { name: 'X', init: 5, hp: 12.9 });
    expect(c.hp).toBe(12);
    expect(c.maxHp).toBe(12);
  });
});

describe('nextTurn', () => {
  test('avança um turno', () => {
    const state = mkState([mkCombatant(1, 'A', 20), mkCombatant(2, 'B', 10)]);
    const { actor, wrapped } = combat.nextTurn(state);
    expect(actor.name).toBe('B');
    expect(wrapped).toBe(false);
  });

  test('vira a rodada ao passar do último', () => {
    const state = mkState([mkCombatant(1, 'A', 20), mkCombatant(2, 'B', 10)]);
    state.turnIndex = 1;
    const { actor, wrapped } = combat.nextTurn(state);
    expect(actor.name).toBe('A');
    expect(wrapped).toBe(true);
    expect(state.round).toBe(2);
  });

  test('pula combatentes caídos (0 PV)', () => {
    const state = mkState([
      mkCombatant(1, 'A', 30),
      mkCombatant(2, 'B', 20, { hp: 0 }),
      mkCombatant(3, 'C', 10),
    ]);
    const { actor } = combat.nextTurn(state); // de A pula B (caído) → C
    expect(actor.name).toBe('C');
  });

  test('não trava se todos os outros estão caídos', () => {
    const state = mkState([
      mkCombatant(1, 'A', 30),
      mkCombatant(2, 'B', 20, { hp: 0 }),
    ]);
    const { actor } = combat.nextTurn(state);
    expect(actor).toBeTruthy(); // retorna algo, não entra em loop infinito
  });
});

describe('applyDamage / heal', () => {
  test('dano reduz e não passa de 0; marca caído', () => {
    const state = mkState([mkCombatant(1, 'A', 10, { hp: 5, maxHp: 10 })]);
    const res = combat.applyDamage(state, 'A', 8);
    expect(res.combatant.hp).toBe(0);
    expect(res.defeated).toBe(true);
  });

  test('cura não passa do maxHp', () => {
    const state = mkState([mkCombatant(1, 'A', 10, { hp: 5, maxHp: 10 })]);
    const res = combat.heal(state, 'A', 100);
    expect(res.combatant.hp).toBe(10);
  });

  test('alvo inexistente retorna found=false', () => {
    const state = mkState([mkCombatant(1, 'A', 10)]);
    expect(combat.applyDamage(state, 'Ninguém', 5).found).toBe(false);
  });

  test('acha alvo por nome parcial', () => {
    const state = mkState([mkCombatant(1, 'Goblin Arqueiro', 10)]);
    const res = combat.applyDamage(state, 'arqueiro', 3);
    expect(res.found).toBe(true);
    expect(res.combatant.name).toBe('Goblin Arqueiro');
  });
});

describe('removeCombatant', () => {
  test('remove e conserta o ponteiro quando o removido está antes do atual', () => {
    const state = mkState([mkCombatant(1, 'A', 30), mkCombatant(2, 'B', 20), mkCombatant(3, 'C', 10)]);
    state.turnIndex = 2; // atual = C
    combat.removeCombatant(state, 'A');
    expect(combat.currentActor(state).name).toBe('C'); // continua sendo o C
  });

  test('remover o último combatente zera o índice', () => {
    const state = mkState([mkCombatant(1, 'A', 10)]);
    combat.removeCombatant(state, 'A');
    expect(state.combatants).toHaveLength(0);
    expect(state.turnIndex).toBe(0);
  });
});

describe('rollNpcInitiative', () => {
  test('soma o bônus ao 1d20', () => {
    const spy = jest.spyOn(Math, 'random').mockReturnValue(0); // 1d20 → 1
    const r = combat.rollNpcInitiative(3);
    expect(r.init).toBe(4); // 1 + 3
    spy.mockRestore();
  });
});

describe('renderEmbed', () => {
  test('não lança e marca o turno atual', () => {
    const state = mkState([mkCombatant(1, 'A', 20), mkCombatant(2, 'B', 10)]);
    const embed = combat.renderEmbed(state);
    expect(embed.data.title).toContain('Rodada 1');
  });
});
