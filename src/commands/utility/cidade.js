const { SlashCommandBuilder } = require('discord.js');
const utilityHandler = require('../../handlers/utility-handler');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cidade')
    .setDescription('Busca informações geográficas de uma cidade (GeoNames)')
    .addStringOption(option =>
      option.setName('nome')
        .setDescription('Nome da cidade')
        .setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply();
    const nome = interaction.options.getString('nome');

    try {
      const city = await utilityHandler.fetchCity(nome);
      let msg = `**${city.name}, ${city.countryName}**\n`;
      if (city.adminName1) msg += `Estado/Região: ${city.adminName1}\n`;
      if (city.population) msg += `População: ${city.population.toLocaleString('pt-BR')}\n`;
      if (city.lat && city.lng) msg += `Coordenadas: ${city.lat}, ${city.lng}\n`;
      if (city.timezone) msg += `Fuso horário: ${city.timezone}\n`;
      await interaction.editReply(msg);
    } catch (error) {
      if (error.message?.includes('não configurado')) {
        await interaction.editReply('❌ GeoNames API não configurada.');
      } else if (error.message?.includes('não encontrada') || error.message?.includes('not found')) {
        await interaction.editReply(`❌ Cidade "${nome}" não encontrada.`);
      } else {
        await interaction.editReply('❌ Erro ao buscar informações da cidade.');
      }
    }
  }
}; 