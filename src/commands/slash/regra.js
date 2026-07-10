const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const rag = require('../../services/rules-rag-service');
const logger = require('../../lib/logger');

const SRC_JOGADOR = 'Livro do Jogador (D&D 5e)';
const SRC_MESTRE  = 'Guia do Mestre (D&D 5e)';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('regra')
    .setDescription('Tira dúvidas de regras de D&D 5e consultando os livros oficiais (com citação de página)')
    .addStringOption(o =>
      o.setName('pergunta')
        .setDescription('Ex: como funciona ataque de oportunidade? o que a condição agarrado faz?')
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('livro')
        .setDescription('Restringe a busca a um livro específico (padrão: ambos)')
        .setRequired(false)
        .addChoices(
          { name: 'Livro do Jogador', value: SRC_JOGADOR },
          { name: 'Guia do Mestre', value: SRC_MESTRE }
        )
    ),

  async execute(interaction) {
    const pergunta = interaction.options.getString('pergunta').trim();
    const source = interaction.options.getString('livro') || null;

    if (!rag.isReady()) {
      return interaction.reply({
        content: '❌ Nenhum livro de regras foi indexado ainda. O dono precisa rodar `npm run ingest:rules`.',
        ephemeral: true
      });
    }

    await interaction.deferReply();

    try {
      const res = await rag.answerQuestion(pergunta, { source });
      if (!res.success) {
        return interaction.editReply({ content: `❌ ${res.message}` });
      }

      const embed = new EmbedBuilder()
        .setColor('#8b5cf6')
        .setTitle(`📖 ${pergunta.length > 240 ? pergunta.slice(0, 237) + '...' : pergunta}`)
        .setDescription(res.answer.slice(0, 4000));

      if (res.sources?.length) {
        embed.addFields({ name: '📚 Fontes', value: res.sources.slice(0, 6).join('\n') });
      }
      embed.setFooter({ text: 'Resposta ancorada nos livros indexados — confira a página se for uma decisão importante.' });

      logger.info(`[/regra] ${interaction.user.tag}: "${pergunta}" → ${res.sources?.length || 0} fontes`);
      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      logger.error(`[/regra] Erro: ${err.message}`);
      return interaction.editReply({ content: `❌ Erro ao consultar as regras: ${err.message}` });
    }
  }
};
