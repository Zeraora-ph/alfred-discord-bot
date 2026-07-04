const { SlashCommandBuilder } = require('discord.js');
const aiClient = require('../../lib/ai-client');
const logger = require('../../lib/logger');
const axios = require('axios');
const cheerio = require('cheerio');

async function getPageContent(url) {
    try {
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);
        // Extrai o texto de parágrafos e cabeçalhos
        let text = '';
        $('p, h1, h2, h3, h4, h5, h6').each((i, elem) => {
            text += $(elem).text() + '\n';
        });
        return text;
    } catch (error) {
        logger.error(`Erro ao buscar conteúdo da URL ${url}:`, error);
        throw new Error('Não foi possível buscar o conteúdo da URL.');
    }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resumo')
    .setDescription('Resume o conteúdo de uma página da web.')
    .addStringOption(option => 
      option.setName('url')
        .setDescription('A URL da página para resumir')
        .setRequired(true)),
  
  async execute(interaction) {
    await interaction.deferReply();
    
    const url = interaction.options.getString('url');
    
    try {
      let pageText = await getPageContent(url);
      if (pageText.length > 15000) {
        pageText = pageText.substring(0, 15000);
      }
      const messages = [
        { role: 'system', content: 'Você é um especialista em resumir textos. Resuma o seguinte conteúdo de uma página da web.' },
        { role: 'user', content: pageText }
      ];
      const response = await aiClient.chat(messages);
      const summary = response.choices[0].message.content;
      const providerInfo = aiClient.getCurrentProvider();
      await interaction.editReply(`**Resumo da página:** ${url}\n\n**Resumo (${providerInfo}):**\n\`\`\`markdown\n${summary}\n\`\`\``);
    } catch (error) {
      logger.error('Erro no comando /resumo:', error);
      await interaction.editReply(`❌ Erro ao processar sua solicitação: ${error.message}`);
    }
  }
}; 