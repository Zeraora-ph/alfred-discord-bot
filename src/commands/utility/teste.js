const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('teste')
    .setDescription('Testa uma API específica ou todas as APIs')
    .addStringOption(option =>
      option.setName('api')
        .setDescription('Qual API testar')
        .setRequired(false)
        .addChoices(
          { name: 'Todas as APIs', value: 'all' },
          { name: 'OpenWeatherMap (Tempo)', value: 'weather' },
          { name: 'Google Search', value: 'google' },
          { name: 'Last.fm (Música)', value: 'lastfm' },
          { name: 'GeoNames (Cidade)', value: 'geonames' },
          { name: 'OMDb (Filmes)', value: 'omdb' }
        )),

  async execute(interaction) {
    await interaction.deferReply();
    
    const apiToTest = interaction.options.getString('api') || 'all';
    
    try {
      let result = '';
      
      if (apiToTest === 'all' || apiToTest === 'weather') {
        result += await testOpenWeatherMap();
      }
      
      if (apiToTest === 'all' || apiToTest === 'google') {
        result += await testGoogleSearch();
      }
      
      if (apiToTest === 'all' || apiToTest === 'lastfm') {
        result += await testLastFM();
      }
      
      if (apiToTest === 'all' || apiToTest === 'geonames') {
        result += await testGeoNames();
      }
      
      if (apiToTest === 'all' || apiToTest === 'omdb') {
        result += await testOMDb();
      }
      
      await interaction.editReply(result || 'Nenhum teste foi executado.');
      
    } catch (error) {
      await interaction.editReply(`❌ Erro durante o teste: ${error.message}`);
    }
  }
};

async function testOpenWeatherMap() {
  const apiKey = process.env.OPENWEATHERMAP_API_KEY;
  if (!apiKey) {
    return `⚠️ **OpenWeatherMap**: API não configurada\n`;
  }
  
  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?q=Sao Paulo&appid=${apiKey}&units=metric`;
    await axios.get(url, { timeout: 5000 });
    return `✅ **OpenWeatherMap**: Funcionando\n`;
  } catch (error) {
    return `❌ **OpenWeatherMap**: Erro - ${error.message}\n`;
  }
}

async function testGoogleSearch() {
  const apiKey = process.env.GOOGLE_API_KEY;
  const cseId = process.env.GOOGLE_CSE_ID;
  if (!apiKey || !cseId) {
    return `⚠️ **Google Search**: API não configurada\n`;
  }
  
  try {
    const url = `https://www.googleapis.com/customsearch/v1?q=test&key=${apiKey}&cx=${cseId}&num=1`;
    await axios.get(url, { timeout: 5000 });
    return `✅ **Google Search**: Funcionando\n`;
  } catch (error) {
    return `❌ **Google Search**: Erro - ${error.message}\n`;
  }
}

async function testLastFM() {
  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey) {
    return `⚠️ **Last.fm**: API não configurada\n`;
  }
  
  try {
    const url = `http://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=Queen&api_key=${apiKey}&format=json`;
    await axios.get(url, { timeout: 5000 });
    return `✅ **Last.fm**: Funcionando\n`;
  } catch (error) {
    return `❌ **Last.fm**: Erro - ${error.message}\n`;
  }
}

async function testGeoNames() {
  const username = process.env.GEONAMES_USERNAME;
  if (!username) {
    return `⚠️ **GeoNames**: API não configurada\n`;
  }
  
  try {
    const url = `http://api.geonames.org/searchJSON?q=London&maxRows=1&username=${username}`;
    await axios.get(url, { timeout: 5000 });
    return `✅ **GeoNames**: Funcionando\n`;
  } catch (error) {
    return `❌ **GeoNames**: Erro - ${error.message}\n`;
  }
}

async function testOMDb() {
  const apiKey = process.env.OMDB_API_KEY;
  if (!apiKey) {
    return `⚠️ **OMDb**: API não configurada\n`;
  }
  
  try {
    const url = `http://www.omdbapi.com/?apikey=${apiKey}&t=Matrix&r=json`;
    await axios.get(url, { timeout: 5000 });
    return `✅ **OMDb**: Funcionando\n`;
  } catch (error) {
    return `❌ **OMDb**: Erro - ${error.message}\n`;
  }
} 