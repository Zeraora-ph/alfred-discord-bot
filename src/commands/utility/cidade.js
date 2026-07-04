const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios');

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
    const username = process.env.GEONAMES_USERNAME;
    if (!username) {
      await interaction.editReply('❌ GeoNames API não configurada.');
      return;
    }
    try {
      const url = `http://api.geonames.org/searchJSON?q=${encodeURIComponent(nome)}&maxRows=1&username=${username}&lang=pt`;
      const response = await axios.get(url);
      const city = response.data.geonames[0];
      if (!city) {
        await interaction.editReply('Cidade não encontrada.');
        return;
      }
      let msg = `**${city.name}, ${city.countryName}**\n`;
      if (city.adminName1) msg += `Estado/Região: ${city.adminName1}\n`;
      if (city.population) msg += `População: ${city.population}\n`;
      if (city.lat && city.lng) msg += `Coordenadas: ${city.lat}, ${city.lng}\n`;
      if (city.timezone) msg += `Fuso horário: ${city.timezone}\n`;
      await interaction.editReply(msg);
    } catch (error) {
      await interaction.editReply('❌ Erro ao buscar informações da cidade.');
    }
  }
}; 