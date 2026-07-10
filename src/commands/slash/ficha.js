const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const charService = require('../../services/character-sheet-service');
const rpgDb = require('../../lib/rpg-db');
const logger = require('../../lib/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ficha')
    .setDescription('Gerencia suas fichas de personagem de RPG (D&D 5e)')
    .addSubcommand(sc =>
      sc.setName('criar')
        .setDescription('Cria uma ficha completa automaticamente a partir de uma descrição (IA)')
        .addStringOption(o => o.setName('descricao').setDescription('Ex: anão guerreiro tanque, veterano de guerra').setRequired(true))
        .addIntegerOption(o => o.setName('nivel').setDescription('Nível do personagem (1-20). Padrão: 1').setMinValue(1).setMaxValue(20).setRequired(false))
        .addStringOption(o => o.setName('nome').setDescription('Nome do personagem (senão a IA inventa)').setRequired(false))
    )
    .addSubcommand(sc =>
      sc.setName('ver')
        .setDescription('Mostra a sua ficha ativa (ou outra pelo nome)')
        .addStringOption(o => o.setName('nome').setDescription('Nome (parcial) de uma ficha específica').setRequired(false))
    )
    .addSubcommand(sc => sc.setName('listar').setDescription('Lista todas as suas fichas neste servidor'))
    .addSubcommand(sc =>
      sc.setName('ativar')
        .setDescription('Define qual ficha fica em foco (usada por /rolar e pela IA)')
        .addStringOption(o => o.setName('nome').setDescription('Nome (parcial) da ficha').setRequired(true))
    )
    .addSubcommand(sc =>
      sc.setName('dano')
        .setDescription('Aplica dano na ficha ativa')
        .addIntegerOption(o => o.setName('valor').setDescription('Quantidade de dano').setRequired(true).setMinValue(0))
    )
    .addSubcommand(sc =>
      sc.setName('curar')
        .setDescription('Cura PV da ficha ativa')
        .addIntegerOption(o => o.setName('valor').setDescription('Quantidade de cura').setRequired(true).setMinValue(0))
    )
    .addSubcommand(sc => sc.setName('descanso').setDescription('Descanso longo: recupera PV, dados de vida e magias'))
    .addSubcommand(sc => sc.setName('levelup').setDescription('Sobe a ficha ativa um nível (recalcula PV)'))
    .addSubcommand(sc =>
      sc.setName('deletar')
        .setDescription('Apaga uma ficha')
        .addStringOption(o => o.setName('nome').setDescription('Nome (parcial) da ficha').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    try {
      switch (sub) {
        case 'criar':   return await handleCriar(interaction, guildId, userId);
        case 'ver':     return await handleVer(interaction, guildId, userId);
        case 'listar':  return await handleListar(interaction, guildId, userId);
        case 'ativar':  return await handleAtivar(interaction, guildId, userId);
        case 'dano':    return await handleDano(interaction, guildId, userId);
        case 'curar':   return await handleCurar(interaction, guildId, userId);
        case 'descanso':return await handleDescanso(interaction, guildId, userId);
        case 'levelup': return await handleLevelUp(interaction, guildId, userId);
        case 'deletar': return await handleDeletar(interaction, guildId, userId);
      }
    } catch (err) {
      logger.error(`[/ficha ${sub}] Erro: ${err.message}`);
      const payload = { content: `❌ Erro ao processar /ficha ${sub}: ${err.message}`, ephemeral: true };
      return interaction.deferred || interaction.replied
        ? interaction.editReply(payload).catch(() => {})
        : interaction.reply(payload).catch(() => {});
    }
  }
};

async function handleCriar(interaction, guildId, userId) {
  const descricao = interaction.options.getString('descricao');
  const nivel = interaction.options.getInteger('nivel') || 1;
  const nome = interaction.options.getString('nome') || null;

  await interaction.deferReply();

  const gen = await charService.generateWithAI(descricao, { level: nivel, name: nome });
  if (!gen.success) {
    return interaction.editReply({ content: `❌ ${gen.message}` });
  }

  const id = charService.saveNew(guildId, userId, gen.sheet);
  const character = rpgDb.getCharacterById(id);

  logger.info(`[Ficha] ${interaction.user.tag} criou "${gen.sheet.name}" (${gen.sheet.class} nv${gen.sheet.level})`);

  return interaction.editReply({
    content: `✅ Ficha de **${gen.sheet.name}** criada e definida como ativa! Use \`/ficha ver\` ou \`/rolar <perícia>\`.`,
    embeds: [charService.renderEmbed(character)]
  });
}

async function handleVer(interaction, guildId, userId) {
  const nome = interaction.options.getString('nome');
  const character = nome
    ? rpgDb.findCharacterByName(guildId, userId, nome)
    : rpgDb.getActiveCharacter(guildId, userId);

  if (!character) {
    return interaction.reply({ content: nome
      ? `❌ Não achei ficha com nome "${nome}".`
      : '❌ Você não tem ficha ativa. Crie uma com `/ficha criar`.', ephemeral: true });
  }
  return interaction.reply({ embeds: [charService.renderEmbed(character)] });
}

async function handleListar(interaction, guildId, userId) {
  const list = rpgDb.listCharacters(guildId, userId);
  if (!list.length) {
    return interaction.reply({ content: '❌ Você ainda não tem fichas. Crie uma com `/ficha criar`.', ephemeral: true });
  }
  const lines = list.map(c => `${c.active ? '⭐' : '▫️'} **${c.name}** — nv ${c.level} (${c.system})`);
  const embed = new EmbedBuilder()
    .setColor('#8b5cf6')
    .setTitle(`📚 Fichas de ${interaction.user.username}`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'A estrela ⭐ é a ficha ativa. Use /ficha ativar <nome> para trocar.' });
  return interaction.reply({ embeds: [embed] });
}

async function handleAtivar(interaction, guildId, userId) {
  const nome = interaction.options.getString('nome');
  const character = rpgDb.findCharacterByName(guildId, userId, nome);
  if (!character) {
    return interaction.reply({ content: `❌ Não achei ficha com nome "${nome}".`, ephemeral: true });
  }
  rpgDb.setActiveCharacter(guildId, userId, character.id);
  return interaction.reply({ content: `⭐ **${character.sheet.name}** agora é sua ficha ativa.` });
}

function requireActive(interaction, guildId, userId) {
  const character = rpgDb.getActiveCharacter(guildId, userId);
  if (!character) {
    interaction.reply({ content: '❌ Você não tem ficha ativa. Crie uma com `/ficha criar`.', ephemeral: true });
    return null;
  }
  return character;
}

async function handleDano(interaction, guildId, userId) {
  const character = requireActive(interaction, guildId, userId);
  if (!character) return;
  const valor = interaction.options.getInteger('valor');
  const res = charService.applyDamage(character, valor);
  const embed = new EmbedBuilder()
    .setColor(res.down ? '#ef4444' : '#f59e0b')
    .setTitle(`💥 ${character.sheet.name} tomou ${valor} de dano`)
    .setDescription(`❤️ **${res.currentHp}/${res.maxHp}** PV\n\`${charService.hpBar(res.currentHp, res.maxHp)}\``);
  if (res.down) embed.addFields({ name: '☠️ Caído!', value: 'PV chegou a 0 — testes de morte ou inconsciência.' });
  return interaction.reply({ embeds: [embed] });
}

async function handleCurar(interaction, guildId, userId) {
  const character = requireActive(interaction, guildId, userId);
  if (!character) return;
  const valor = interaction.options.getInteger('valor');
  const res = charService.heal(character, valor);
  const embed = new EmbedBuilder()
    .setColor('#22c55e')
    .setTitle(`💚 ${character.sheet.name} recuperou ${valor} PV`)
    .setDescription(`❤️ **${res.currentHp}/${res.maxHp}** PV\n\`${charService.hpBar(res.currentHp, res.maxHp)}\``);
  return interaction.reply({ embeds: [embed] });
}

async function handleDescanso(interaction, guildId, userId) {
  const character = requireActive(interaction, guildId, userId);
  if (!character) return;
  const res = charService.longRest(character);
  return interaction.reply({
    embeds: [new EmbedBuilder()
      .setColor('#22c55e')
      .setTitle(`🏕️ ${character.sheet.name} fez um descanso longo`)
      .setDescription(`Recuperado por completo.\n❤️ **${res.currentHp}/${res.maxHp}** PV\n\`${charService.hpBar(res.currentHp, res.maxHp)}\``)]
  });
}

async function handleLevelUp(interaction, guildId, userId) {
  const character = requireActive(interaction, guildId, userId);
  if (!character) return;
  const res = charService.levelUp(character);
  if (!res.success) return interaction.reply({ content: `❌ ${res.message}`, ephemeral: true });
  return interaction.reply({
    embeds: [new EmbedBuilder()
      .setColor('#8b5cf6')
      .setTitle(`⬆️ ${character.sheet.name} subiu para o nível ${res.level}!`)
      .setDescription(`+${res.hpGanho} PV (total: **${res.maxHp}**).\nLembre de escolher novas habilidades/magias da classe.`)]
  });
}

async function handleDeletar(interaction, guildId, userId) {
  const nome = interaction.options.getString('nome');
  const character = rpgDb.findCharacterByName(guildId, userId, nome);
  if (!character) {
    return interaction.reply({ content: `❌ Não achei ficha com nome "${nome}".`, ephemeral: true });
  }
  rpgDb.deleteCharacter(character.id);
  return interaction.reply({ content: `🗑️ Ficha de **${character.sheet.name}** apagada.` });
}
