const { SlashCommandBuilder } = require('discord.js');
const aiClient = require('../../lib/ai-client');
const axios = require('axios');

// Funções para testar cada API
async function testOpenWeatherMap() {
    const apiKey = process.env.OPENWEATHERMAP_API_KEY;
    if (!apiKey) return { configured: false, working: false, error: 'API não configurada' };
    try {
        const url = `https://api.openweathermap.org/data/2.5/weather?q=Sao Paulo&appid=${apiKey}&units=metric`;
        await axios.get(url, { timeout: 5000 });
        return { configured: true, working: true };
    } catch (error) {
        return { configured: true, working: false, error: error.message };
    }
}

async function testGoogleSearch() {
    const apiKey = process.env.GOOGLE_API_KEY;
    const cseId = process.env.GOOGLE_CSE_ID;
    if (!apiKey || !cseId) return { configured: false, working: false, error: 'API não configurada' };
    try {
        const url = `https://www.googleapis.com/customsearch/v1?q=test&key=${apiKey}&cx=${cseId}&num=1`;
        await axios.get(url, { timeout: 5000 });
        return { configured: true, working: true };
    } catch (error) {
        return { configured: true, working: false, error: error.message };
    }
}

async function testLastFM() {
    const apiKey = process.env.LASTFM_API_KEY;
    if (!apiKey) return { configured: false, working: false, error: 'API não configurada' };
    try {
        const url = `http://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=Queen&api_key=${apiKey}&format=json`;
        await axios.get(url, { timeout: 5000 });
        return { configured: true, working: true };
    } catch (error) {
        return { configured: true, working: false, error: error.message };
    }
}

async function testGeoNames() {
    const username = process.env.GEONAMES_USERNAME;
    if (!username) return { configured: false, working: false, error: 'API não configurada' };
    try {
        const url = `http://api.geonames.org/searchJSON?q=London&maxRows=1&username=${username}`;
        await axios.get(url, { timeout: 5000 });
        return { configured: true, working: true };
    } catch (error) {
        return { configured: true, working: false, error: error.message };
    }
}

async function testOMDb() {
    const apiKey = process.env.OMDB_API_KEY;
    if (!apiKey) return { configured: false, working: false, error: 'API não configurada' };
    try {
        const url = `http://www.omdbapi.com/?apikey=${apiKey}&t=Matrix&r=json`;
        await axios.get(url, { timeout: 5000 });
        return { configured: true, working: true };
    } catch (error) {
        return { configured: true, working: false, error: error.message };
    }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Mostra o status de todas as APIs e serviços'),
  
  async execute(interaction) {
    await interaction.deferReply();
    try {
      const currentProvider = aiClient.getCurrentProvider();
      // Testa todas as APIs exceto Ollama
      const [weatherStatus, googleStatus, lastfmStatus, geonamesStatus, omdbStatus] = await Promise.all([
        testOpenWeatherMap(),
        testGoogleSearch(),
        testLastFM(),
        testGeoNames(),
        testOMDb()
      ]);
      let statusMsg = `**🤖 Status Completo do Bot**\n\n`;
      statusMsg += `🧠 **Provedor de IA:** ${currentProvider}\n`;
      statusMsg += `🌤️ **OpenWeatherMap (Tempo):** ${weatherStatus.configured ? (weatherStatus.working ? '✅ Funcionando' : `❌ Erro: ${weatherStatus.error}`) : '⚠️ Não configurado'}\n`;
      statusMsg += `🔍 **Google Search:** ${googleStatus.configured ? (googleStatus.working ? '✅ Funcionando' : `❌ Erro: ${googleStatus.error}`) : '⚠️ Não configurado'}\n`;
      statusMsg += `🎵 **Last.fm (Música):** ${lastfmStatus.configured ? (lastfmStatus.working ? '✅ Funcionando' : `❌ Erro: ${lastfmStatus.error}`) : '⚠️ Não configurado'}\n`;
      statusMsg += `🌍 **GeoNames (Cidade):** ${geonamesStatus.configured ? (geonamesStatus.working ? '✅ Funcionando' : `❌ Erro: ${geonamesStatus.error}`) : '⚠️ Não configurado'}\n`;
      statusMsg += `🎬 **OMDb (Filmes):** ${omdbStatus.configured ? (omdbStatus.working ? '✅ Funcionando' : `❌ Erro: ${omdbStatus.error}`) : '⚠️ Não configurado'}\n`;
      await interaction.editReply(statusMsg);
    } catch (error) {
      await interaction.editReply('❌ Erro ao verificar status das APIs');
    }
  }
}; 