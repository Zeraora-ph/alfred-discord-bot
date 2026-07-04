const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('filme')
    .setDescription('Busca informações de um filme (OMDb API)')
    .addStringOption(option =>
      option.setName('titulo')
        .setDescription('Nome do filme')
        .setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply();
    const titulo = interaction.options.getString('titulo');
    const apiKey = process.env.OMDB_API_KEY;
    if (!apiKey) {
      await interaction.editReply('❌ OMDb API não configurada.');
      return;
    }
    try {
      const url = `http://www.omdbapi.com/?apikey=${apiKey}&t=${encodeURIComponent(titulo)}&plot=short&r=json`;
      const response = await axios.get(url);
      const data = response.data;
      if (data.Response === 'False') {
        await interaction.editReply('Filme não encontrado.');
        return;
      }
      let msg = `**${data.Title} (${data.Year})**\n`;
      if (data.Genre) msg += `Gênero: ${data.Genre}\n`;
      if (data.Director) msg += `Diretor: ${data.Director}\n`;
      if (data.Actors) msg += `Atores: ${data.Actors}\n`;
      if (data.Plot) msg += `Sinopse: ${data.Plot}\n`;
      if (data.imdbRating) msg += `Nota IMDb: ${data.imdbRating}\n`;
      if (data.Poster && data.Poster !== 'N/A') msg += data.Poster;
      await interaction.editReply(msg);
    } catch (error) {
      await interaction.editReply('❌ Erro ao buscar informações do filme.');
    }
  }
}; 