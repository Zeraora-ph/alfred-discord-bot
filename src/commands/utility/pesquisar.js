const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pesquisar')
    .setDescription('Pesquisa no Google e retorna os principais resultados')
    .addStringOption(option =>
      option.setName('termo')
        .setDescription('O que deseja pesquisar?')
        .setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply();
    const termo = interaction.options.getString('termo');
    const apiKey = process.env.GOOGLE_API_KEY;
    const cseId = process.env.GOOGLE_CSE_ID;
    if (!apiKey || !cseId) {
      await interaction.editReply('❌ Google Custom Search API não configurada.');
      return;
    }
    try {
      const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(termo)}&key=${apiKey}&cx=${cseId}&num=3`;
      const response = await axios.get(url);
      const items = response.data.items;
      if (!items || items.length === 0) {
        await interaction.editReply('Nenhum resultado encontrado.');
        return;
      }
      let msg = `**Resultados para:** \

\`${termo}\``;
      for (const item of items) {
        msg += `\n[${item.title}](${item.link})\n${item.snippet}\n`;
      }
      await interaction.editReply(msg);
    } catch (error) {
      await interaction.editReply('❌ Erro ao pesquisar no Google.');
    }
  }
}; 