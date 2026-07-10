const { SlashCommandBuilder } = require('discord.js');
const aiClient = require('../../lib/ai-client');
const logger = require('../../lib/logger');
const axios = require('axios');
const cheerio = require('cheerio');
const PromptProtection = require('../../lib/prompt-protection');

async function getPageContent(url) {
    try {
        const response = await axios.get(url, { timeout: 10000 });
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
    
    // 🛡️ Proteção contra Prompt Injection: Ignora se já estiver bloqueado
    const isBlocked = await PromptProtection.checkUserBlocked(interaction.user.id);
    if (isBlocked) {
        await interaction.editReply('🚫 **Acesso Negado:** Você está silenciado por violações recorrentes de segurança.');
        return;
    }

    if (PromptProtection.isInjection(url)) {
        const blockedNow = await PromptProtection.incrementAttempts(interaction.user.id, interaction.user.username);
        if (blockedNow) {
            await interaction.editReply('🚫 **Bloqueado:** Você foi silenciado por tentar violar minhas diretrizes de segurança de forma recorrente (limite de 3 tentativas excedido).');
        } else {
            await interaction.editReply(PromptProtection.getRejectionResponse());
        }
        return;
    }

    try {
      let pageText = await getPageContent(url);
      if (pageText.length > 15000) {
        pageText = pageText.substring(0, 15000);
      }

      // Se o conteúdo extraído da página parecer suspeito de injection
      if (PromptProtection.isInjection(pageText)) {
          await interaction.editReply('🚫 **Conteúdo bloqueado:** A página indicada contém dados que violam as diretrizes de segurança.');
          return;
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