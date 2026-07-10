const { SlashCommandBuilder } = require('discord.js');
const aiClient = require('../../lib/ai-client');
const logger = require('../../lib/logger');
const PromptProtection = require('../../lib/prompt-protection');

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
    
    // 🛡️ Proteção contra Prompt Injection: Ignora se já estiver bloqueado
    const isBlocked = await PromptProtection.checkUserBlocked(interaction.user.id);
    if (isBlocked) {
        await interaction.editReply('🚫 **Acesso Negado:** Você está silenciado por violações recorrentes de segurança.');
        return;
    }

    if (PromptProtection.isInjection(textToTranslate) || PromptProtection.isInjection(targetLanguage)) {
        const blockedNow = await PromptProtection.incrementAttempts(interaction.user.id, interaction.user.username);
        if (blockedNow) {
            await interaction.editReply('🚫 **Bloqueado:** Você foi silenciado por tentar violar minhas diretrizes de segurança de forma recorrente (limite de 3 tentativas excedido).');
        } else {
            await interaction.editReply(PromptProtection.getRejectionResponse());
        }
        return;
    }

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