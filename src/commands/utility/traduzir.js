const { SlashCommandBuilder } = require('discord.js');
const aiClient = require('../../lib/ai-client');
const logger = require('../../lib/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('traduzir')
    .setDescription('Traduz um texto para o idioma especificado.')
    .addStringOption(option => 
      option.setName('idioma')
        .setDescription('O idioma para o qual traduzir (ex: en, es, fr)')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('texto')
        .setDescription('O texto a ser traduzido')
        .setRequired(true)),
  
  async execute(interaction) {
    await interaction.deferReply();
    
    const targetLanguage = interaction.options.getString('idioma');
    const textToTranslate = interaction.options.getString('texto');
    
    try {
      const messages = [
        { role: 'system', content: `Você é um tradutor. Traduza o texto a seguir para ${targetLanguage}.` },
        { role: 'user', content: textToTranslate }
      ];
      const response = await aiClient.chat(messages);
      const translatedText = response.choices[0].message.content;
      const providerInfo = aiClient.getCurrentProvider();
      await interaction.editReply(`**Texto Original:**\n${textToTranslate}\n\n**Tradução para ${targetLanguage} (${providerInfo}):**\n\`\`\`\n${translatedText}\n\`\`\``);
    } catch (error) {
      logger.error('Erro no comando /traduzir:', error);
      await interaction.editReply('❌ Erro ao processar sua solicitação.');
    }
  }
}; 