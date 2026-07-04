const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tempo')
    .setDescription('Mostra a previsão do tempo para uma cidade')
    .addStringOption(option =>
      option.setName('cidade')
        .setDescription('Nome da cidade (ex: São Paulo)')
        .setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply();
    const cidade = interaction.options.getString('cidade');
    const apiKey = process.env.OPENWEATHERMAP_API_KEY;
    if (!apiKey) {
      await interaction.editReply('❌ API do OpenWeatherMap não configurada.');
      return;
    }
    try {
      const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(cidade)}&appid=${apiKey}&units=metric&lang=pt_br`;
      const response = await axios.get(url);
      const data = response.data;
      const desc = data.weather[0].description;
      const temp = data.main.temp;
      const sens = data.main.feels_like;
      const hum = data.main.humidity;
      const wind = data.wind.speed;
      const city = data.name;
      const country = data.sys.country;
      await interaction.editReply(
        `**Previsão do tempo para ${city}, ${country}:**\n` +
        `> ${desc.charAt(0).toUpperCase() + desc.slice(1)}\n` +
        `> Temperatura: ${temp}°C (sensação: ${sens}°C)\n` +
        `> Umidade: ${hum}%\n` +
        `> Vento: ${wind} m/s`
      );
    } catch (error) {
      await interaction.editReply('❌ Não foi possível obter a previsão do tempo. Verifique o nome da cidade.');
    }
  }
}; 