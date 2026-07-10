const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const dice = require('../../services/dice-service');
const charService = require('../../services/character-sheet-service');
const rpgDb = require('../../lib/rpg-db');
const logger = require('../../lib/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rolar')
    .setDescription('Rola dados (1d20+5, 4d6kh3, vantagem...) ou um teste da sua ficha')
    .addStringOption(option =>
      option
        .setName('expressao')
        .setDescription('Ex: 1d20+5, 2d6, 4d6kh3, vantagem +3 — ou uma perícia (furtividade, atletismo...)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('tipo')
        .setDescription('Vantagem/desvantagem (só se rolar perícia ou salvaguarda)')
        .setRequired(false)
        .addChoices(
          { name: 'Normal', value: 'normal' },
          { name: 'Vantagem', value: 'vantagem' },
          { name: 'Desvantagem', value: 'desvantagem' }
        )
    )
    .addStringOption(option =>
      option
        .setName('rotulo')
        .setDescription('Rótulo da rolagem (ex: "Ataque de Espada")')
        .setRequired(false)
    ),

  async execute(interaction) {
    const expression = interaction.options.getString('expressao').trim();
    const mode = interaction.options.getString('tipo') || 'normal';
    const label = interaction.options.getString('rotulo') || '';
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    // 1) Se a "expressão" bate com uma perícia/salvaguarda/atributo da ficha ativa, rola isso.
    const asSkill = _tryCharacterRoll(guildId, userId, expression, mode);
    if (asSkill) {
      return interaction.reply({ embeds: [asSkill] });
    }

    // 2) Caso contrário, trata como expressão de dados pura.
    try {
      const result = dice.roll(expression);
      const embed = new EmbedBuilder()
        .setColor(result.isNat20 ? '#22c55e' : result.isNat1 ? '#ef4444' : '#8b5cf6')
        .setDescription(dice.formatResult(result, label))
        .setFooter({ text: `🎲 rolado por ${interaction.user.username}` });
      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      logger.debug(`[/rolar] Expressão inválida "${expression}": ${err.message}`);
      return interaction.reply({
        content: `❌ ${err.message}\n\n**Exemplos:** \`1d20+5\`, \`2d6\`, \`4d6kh3\`, \`vantagem +3\`, ou uma perícia como \`furtividade\`.`,
        ephemeral: true
      });
    }
  }
};

/**
 * Tenta interpretar a expressão como um teste da ficha ativa (perícia, salvaguarda
 * ou atributo). Retorna um embed pronto, ou null se não for um teste de ficha.
 */
function _tryCharacterRoll(guildId, userId, expression, mode) {
  const key = charService.normalizeKey(expression).replace(/\s+/g, '_');

  // Atributo? (força, destreza, ...)
  const abilityAliases = {
    forca: 'str', for: 'str', destreza: 'dex', des: 'dex', constituicao: 'con', con: 'con',
    inteligencia: 'int', int: 'int', sabedoria: 'wis', sab: 'wis', carisma: 'cha', car: 'cha'
  };

  const isSkill = !!charService.SKILLS[key];
  const isAbility = !!abilityAliases[key];
  const isSave = key.startsWith('salvaguarda') || key.startsWith('save');

  if (!isSkill && !isAbility && !isSave) return null;

  const character = rpgDb.getActiveCharacter(guildId, userId);
  if (!character) return null;

  let roll;
  let title;
  if (isSkill) {
    roll = charService.rollSkill(character, key, mode);
    title = `${character.sheet.name} — Teste de ${roll.skill}`;
  } else if (isAbility) {
    roll = charService.rollAbility(character, abilityAliases[key], mode);
    title = `${character.sheet.name} — Teste de ${roll.ability}`;
  } else {
    // salvaguarda <atributo> — pega o último token
    const abToken = charService.normalizeKey(expression).split(/\s+/).pop();
    const ab = abilityAliases[abToken];
    if (!ab) return null;
    roll = charService.rollSave(character, ab, mode);
    title = `${character.sheet.name} — Salvaguarda de ${roll.ability}`;
  }

  if (!roll) return null;

  return new EmbedBuilder()
    .setColor(roll.result.isNat20 ? '#22c55e' : roll.result.isNat1 ? '#ef4444' : '#8b5cf6')
    .setTitle(`🎲 ${title}`)
    .setDescription(dice.formatResult(roll.result, `${mode !== 'normal' ? mode + ' • ' : ''}bônus ${charService.fmtMod(roll.bonus)}`));
}
