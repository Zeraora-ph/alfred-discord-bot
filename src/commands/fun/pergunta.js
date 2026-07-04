const { SlashCommandBuilder } = require('discord.js');
const aiClient = require('../../lib/ai-client');
const redis = require('../../lib/redis-client');
const logger = require('../../lib/logger');
const factStore = require('../../lib/fact-store');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pergunta')
    .setDescription('Faça uma pergunta para a IA')
    .addStringOption(option => 
      option.setName('texto')
        .setDescription('Sua pergunta')
        .setRequired(true)),
  
  async execute(interaction) {
    await interaction.deferReply();
    
    const userQuestion = interaction.options.getString('texto');
    const contextKey = `context:${interaction.channelId}`;
    
    try {
      const storedContext = await redis.get(contextKey);
      const context = storedContext ? JSON.parse(storedContext) : [];
      // Buscar persona e info do servidor
      let persona = '';
      let info = '';
      if (interaction.guildId) {
        const guildInfo = factStore.getGuildInfo(interaction.guildId);
        persona = guildInfo?.persona || '';
        info = guildInfo?.info || '';
      }
      // Montar system prompt
      let systemPrompt = 'Você é um assistente útil em um servidor Discord. Seja conciso.';
      if (persona && persona.trim()) {
        systemPrompt = persona.trim();
        if (info && info.trim()) {
          systemPrompt += '\n\nInformações do servidor: ' + info.trim();
        }
      } else if (info && info.trim()) {
        systemPrompt += '\n\nInformações do servidor: ' + info.trim();
      }
      const messages = [
        { role: 'system', content: systemPrompt },
        ...context,
        { role: 'user', content: userQuestion }
      ];

      const response = await aiClient.chat(messages);
      const aiResponse = response.choices[0].message.content;
      
      const newContext = [
          ...context,
          { role: 'user', content: userQuestion }, 
          { role: 'assistant', content: aiResponse }
      ];

      // Mantém apenas as últimas 3 interações (user + assistant)
      while (newContext.length > 6) { // 3 pairs of user/assistant messages
        newContext.shift();
      }
      
      await redis.setex(contextKey, 600, JSON.stringify(newContext));
      const providerInfo = aiClient.getCurrentProvider();
      await interaction.editReply(`**${interaction.user.username} perguntou:**\n${userQuestion}\n\n**Resposta (${providerInfo}):**\n\`\`\`markdown\n${aiResponse}\n\`\`\``);
    } catch (error) {
      logger.error('Erro no comando pergunta:', error);
      await interaction.editReply('❌ Ocorreu um erro ao processar sua pergunta. Tente novamente.');
    }
  }
}; 