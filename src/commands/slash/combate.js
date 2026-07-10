const { SlashCommandBuilder } = require('discord.js');
const combat = require('../../services/combat-service');
const charService = require('../../services/character-sheet-service');
const rpgDb = require('../../lib/rpg-db');
const dice = require('../../services/dice-service');
const logger = require('../../lib/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('combate')
    .setDescription('Tracker de combate e iniciativa da mesa (D&D 5e)')
    .addSubcommand(sc =>
      sc.setName('iniciar')
        .setDescription('Inicia um combate neste canal (adiciona sua ficha ativa, se houver)'))
    .addSubcommand(sc =>
      sc.setName('entrar')
        .setDescription('Entra no combate com sua ficha ativa (rola iniciativa pela Destreza)')
        .addStringOption(o => o.setName('tipo').setDescription('Vantagem/desvantagem na iniciativa').setRequired(false)
          .addChoices({ name: 'Normal', value: 'normal' }, { name: 'Vantagem', value: 'vantagem' }, { name: 'Desvantagem', value: 'desvantagem' })))
    .addSubcommand(sc =>
      sc.setName('add')
        .setDescription('Adiciona um NPC/monstro ao combate')
        .addStringOption(o => o.setName('nome').setDescription('Nome do NPC/monstro').setRequired(true))
        .addIntegerOption(o => o.setName('pv').setDescription('Pontos de vida').setRequired(true).setMinValue(1))
        .addIntegerOption(o => o.setName('ca').setDescription('Classe de armadura').setRequired(false).setMinValue(1))
        .addIntegerOption(o => o.setName('iniciativa').setDescription('Iniciativa fixa (senão rola 1d20+bônus)').setRequired(false))
        .addIntegerOption(o => o.setName('bonus').setDescription('Bônus de iniciativa pra rolar (padrão 0)').setRequired(false)))
    .addSubcommand(sc => sc.setName('proximo').setDescription('Passa para o próximo turno'))
    .addSubcommand(sc => sc.setName('status').setDescription('Mostra a ordem de iniciativa e o turno atual'))
    .addSubcommand(sc =>
      sc.setName('dano')
        .setDescription('Aplica dano a um combatente')
        .addStringOption(o => o.setName('alvo').setDescription('Nome (parcial) do combatente').setRequired(true))
        .addIntegerOption(o => o.setName('valor').setDescription('Dano').setRequired(true).setMinValue(0)))
    .addSubcommand(sc =>
      sc.setName('cura')
        .setDescription('Cura um combatente')
        .addStringOption(o => o.setName('alvo').setDescription('Nome (parcial) do combatente').setRequired(true))
        .addIntegerOption(o => o.setName('valor').setDescription('Cura').setRequired(true).setMinValue(0)))
    .addSubcommand(sc =>
      sc.setName('remover')
        .setDescription('Remove um combatente da ordem')
        .addStringOption(o => o.setName('alvo').setDescription('Nome (parcial) do combatente').setRequired(true)))
    .addSubcommand(sc => sc.setName('encerrar').setDescription('Encerra o combate deste canal')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const channelId = interaction.channelId;
    const userId = interaction.user.id;

    try {
      switch (sub) {
        case 'iniciar':  return await handleIniciar(interaction, guildId, channelId, userId);
        case 'entrar':   return await handleEntrar(interaction, guildId, channelId, userId);
        case 'add':      return await handleAdd(interaction, guildId, channelId);
        case 'proximo':  return await handleProximo(interaction, channelId);
        case 'status':   return await handleStatus(interaction, channelId);
        case 'dano':     return await handleDanoCura(interaction, channelId, 'dano');
        case 'cura':     return await handleDanoCura(interaction, channelId, 'cura');
        case 'remover':  return await handleRemover(interaction, channelId);
        case 'encerrar': return await handleEncerrar(interaction, channelId);
      }
    } catch (err) {
      logger.error(`[/combate ${sub}] Erro: ${err.message}`);
      const payload = { content: `❌ Erro em /combate ${sub}: ${err.message}`, ephemeral: true };
      return interaction.replied || interaction.deferred
        ? interaction.editReply(payload).catch(() => {})
        : interaction.reply(payload).catch(() => {});
    }
  }
};

function loadState(channelId) {
  return rpgDb.getCombat(channelId);
}
function persist(state) {
  rpgDb.saveCombat(state.channelId, state.guildId, state);
}

async function handleIniciar(interaction, guildId, channelId, userId) {
  if (loadState(channelId)) {
    return interaction.reply({ content: '⚠️ Já existe um combate neste canal. Use `/combate status` ou `/combate encerrar`.', ephemeral: true });
  }
  const state = combat.newCombat(guildId, channelId);
  state.channelId = channelId;
  state.guildId = guildId;

  let msg = '⚔️ **Combate iniciado!**';
  const character = rpgDb.getActiveCharacter(guildId, userId);
  if (character) {
    const ini = charService.rollInitiative(character);
    combat.addCombatant(state, {
      name: character.sheet.name, init: ini.result.total, initBonus: ini.bonus,
      hp: character.sheet.currentHp, maxHp: character.sheet.maxHp, ac: character.sheet.armorClass,
      isPC: true, userId, characterId: character.id,
    });
    msg += `\n🛡️ **${character.sheet.name}** entrou com iniciativa **${ini.result.total}**.`;
  } else {
    msg += '\nUse `/combate entrar` (sua ficha) ou `/combate add` (NPCs) para preencher a ordem.';
  }
  persist(state);
  return interaction.reply({ content: msg, embeds: [combat.renderEmbed(state)] });
}

async function handleEntrar(interaction, guildId, channelId, userId) {
  const state = loadState(channelId);
  if (!state) return interaction.reply({ content: '❌ Não há combate neste canal. Use `/combate iniciar`.', ephemeral: true });

  const character = rpgDb.getActiveCharacter(guildId, userId);
  if (!character) return interaction.reply({ content: '❌ Você não tem ficha ativa. Crie com `/ficha criar`.', ephemeral: true });

  if (state.combatants.some(c => c.characterId === character.id)) {
    return interaction.reply({ content: `⚠️ **${character.sheet.name}** já está no combate.`, ephemeral: true });
  }

  const mode = interaction.options.getString('tipo') || 'normal';
  const ini = charService.rollInitiative(character, mode);
  combat.addCombatant(state, {
    name: character.sheet.name, init: ini.result.total, initBonus: ini.bonus,
    hp: character.sheet.currentHp, maxHp: character.sheet.maxHp, ac: character.sheet.armorClass,
    isPC: true, userId, characterId: character.id,
  });
  persist(state);
  return interaction.reply({
    content: `🛡️ **${character.sheet.name}** entrou no combate com iniciativa **${ini.result.total}** (${dice.formatResult(ini.result, `Iniciativa ${charService.fmtMod(ini.bonus)}`)}).`,
    embeds: [combat.renderEmbed(state)]
  });
}

async function handleAdd(interaction, guildId, channelId) {
  const state = loadState(channelId);
  if (!state) return interaction.reply({ content: '❌ Não há combate neste canal. Use `/combate iniciar`.', ephemeral: true });

  const nome = interaction.options.getString('nome');
  const pv = interaction.options.getInteger('pv');
  const ca = interaction.options.getInteger('ca');
  const iniFixa = interaction.options.getInteger('iniciativa');
  const bonus = interaction.options.getInteger('bonus') || 0;

  let init = iniFixa;
  let rollTxt = '';
  if (init == null) {
    const r = combat.rollNpcInitiative(bonus);
    init = r.init;
    rollTxt = ` (rolou ${r.roll.text}${bonus ? ` ${charService.fmtMod(bonus)}` : ''} = ${init})`;
  }

  const c = combat.addCombatant(state, { name: nome, init, initBonus: bonus, hp: pv, maxHp: pv, ac, isPC: false });
  persist(state);
  return interaction.reply({
    content: `➕ **${c.name}** adicionado com iniciativa **${init}**${rollTxt}.`,
    embeds: [combat.renderEmbed(state)]
  });
}

async function handleProximo(interaction, channelId) {
  const state = loadState(channelId);
  if (!state) return interaction.reply({ content: '❌ Não há combate neste canal. Use `/combate iniciar`.', ephemeral: true });
  if (!state.combatants.length) return interaction.reply({ content: '❌ Não há combatentes. Adicione com `/combate entrar` ou `/combate add`.', ephemeral: true });

  const { actor, wrapped } = combat.nextTurn(state);
  persist(state);
  const header = wrapped ? `🔄 **Rodada ${state.round}!** ` : '';
  return interaction.reply({
    content: `${header}▶️ Vez de **${actor ? actor.name : '—'}**.`,
    embeds: [combat.renderEmbed(state)]
  });
}

async function handleStatus(interaction, channelId) {
  const state = loadState(channelId);
  if (!state) return interaction.reply({ content: '❌ Não há combate neste canal. Use `/combate iniciar`.', ephemeral: true });
  return interaction.reply({ embeds: [combat.renderEmbed(state)] });
}

async function handleDanoCura(interaction, channelId, tipo) {
  const state = loadState(channelId);
  if (!state) return interaction.reply({ content: '❌ Não há combate neste canal.', ephemeral: true });

  const alvo = interaction.options.getString('alvo');
  const valor = interaction.options.getInteger('valor');
  const res = tipo === 'dano' ? combat.applyDamage(state, alvo, valor) : combat.heal(state, alvo, valor);
  if (!res.found) return interaction.reply({ content: `❌ Não achei "${alvo}" no combate.`, ephemeral: true });

  persist(state);
  const c = res.combatant;
  const emoji = tipo === 'dano' ? '💥' : '💚';
  const verbo = tipo === 'dano' ? `tomou ${res.amount} de dano` : `recuperou ${res.amount} PV`;
  const extra = tipo === 'dano' && res.defeated ? ' — **CAÍDO** ☠️' : '';
  return interaction.reply({
    content: `${emoji} **${c.name}** ${verbo}: agora **${c.hp}/${c.maxHp}** PV${extra}.`,
    embeds: [combat.renderEmbed(state)]
  });
}

async function handleRemover(interaction, channelId) {
  const state = loadState(channelId);
  if (!state) return interaction.reply({ content: '❌ Não há combate neste canal.', ephemeral: true });
  const alvo = interaction.options.getString('alvo');
  const res = combat.removeCombatant(state, alvo);
  if (!res.found) return interaction.reply({ content: `❌ Não achei "${alvo}" no combate.`, ephemeral: true });
  persist(state);
  return interaction.reply({ content: `🗑️ **${res.combatant.name}** saiu do combate.`, embeds: [combat.renderEmbed(state)] });
}

async function handleEncerrar(interaction, channelId) {
  const state = loadState(channelId);
  if (!state) return interaction.reply({ content: '❌ Não há combate neste canal.', ephemeral: true });
  rpgDb.endCombat(channelId);
  return interaction.reply({ content: `🏁 Combate encerrado após **${state.round}** rodada(s).` });
}
