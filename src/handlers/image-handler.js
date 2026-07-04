/**
 * Image Handler - Análise de Imagens
 * Processa análise de imagens usando IA
 */

const logger = require('../lib/logger');
const axios = require('axios');

class ImageHandler {
  constructor(aiClient) {
    this.aiClient = aiClient;
    this.cooldowns = new Map();
    this.COOLDOWN_TIME = 30000; // 30 segundos
  }

  /**
   * Verifica se usuário está em cooldown
   */
  isInCooldown(userId) {
    const lastUsage = this.cooldowns.get(userId);
    if (!lastUsage) return false;
    
    const now = Date.now();
    return (now - lastUsage) < this.COOLDOWN_TIME;
  }

  /**
   * Define cooldown para usuário
   */
  setCooldown(userId) {
    this.cooldowns.set(userId, Date.now());
  }

  /**
   * Extrai URLs de imagem da mensagem
   */
  extractImageUrls(message) {
    const imageUrls = [];
    
    // Anexos de imagem
    if (message.attachments.size > 0) {
      for (const attachment of message.attachments.values()) {
        if (attachment.contentType && attachment.contentType.startsWith('image/')) {
          imageUrls.push(attachment.url);
        }
      }
    }
    
    // Embeds com imagens
    if (message.embeds.length > 0) {
      for (const embed of message.embeds) {
        if (embed.image && embed.image.url) {
          imageUrls.push(embed.image.url);
        }
        if (embed.thumbnail && embed.thumbnail.url) {
          imageUrls.push(embed.thumbnail.url);
        }
      }
    }
    
    // URLs no texto
    const urlRegex = /https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|bmp)(\?[^\s]*)?/gi;
    const textUrls = message.content.match(urlRegex) || [];
    imageUrls.push(...textUrls);
    
    return [...new Set(imageUrls)]; // Remove duplicatas
  }

  /**
   * Valida tamanho da imagem
   */
  async validateImageSize(imageUrl) {
    try {
      const response = await axios.head(imageUrl);
      const contentLength = response.headers['content-length'];
      const maxSize = 10 * 1024 * 1024; // 10MB
      
      if (contentLength && parseInt(contentLength) > maxSize) {
        return { valid: false, reason: 'Imagem muito grande (máximo 10MB)' };
      }
      
      return { valid: true };
    } catch (error) {
      logger.error('Erro ao validar tamanho da imagem:', error);
      return { valid: false, reason: 'Erro ao acessar imagem' };
    }
  }

  /**
   * Analisa uma imagem
   */
  async analyzeImage(message, imageUrl, userPrompt = null) {
    // Verificar cooldown
    if (this.isInCooldown(message.author.id)) {
      await message.reply('⏰ Aguarde 30 segundos antes de analisar outra imagem.');
      return;
    }

    // Validar tamanho
    const validation = await this.validateImageSize(imageUrl);
    if (!validation.valid) {
      await message.reply(`❌ ${validation.reason}`);
      return;
    }

    try {
      const processingMsg = await message.reply('🖼️ Analisando imagem...');

      // Determinar prompt baseado no contexto
      let prompt = 'Descreva esta imagem brevemente em 2-3 frases.';
      
      if (userPrompt) {
        prompt = `Com base nesta imagem, responda: ${userPrompt}`;
      } else if (this.hasAnalysisKeywords(message.content)) {
        prompt = 'Descreva esta imagem em detalhes, incluindo objetos, pessoas, cenário e contexto.';
      }

      // Analisar com IA
      const messages = [
        { role: 'system', content: this.aiClient.getSystemPrompt() },
        { role: 'user', content: prompt }
      ];

      const analysis = await this.aiClient.chat(messages);
      const result = analysis.choices[0].message.content;

      await processingMsg.edit(`**🖼️ Análise da Imagem:**\n\n${result}`);
      
      // Definir cooldown
      this.setCooldown(message.author.id);
      
      logger.info(`Imagem analisada por ${message.author.tag}: ${imageUrl.substring(0, 50)}...`);
    } catch (error) {
      logger.error('Erro ao analisar imagem:', error);
      await message.reply('❌ Erro ao analisar imagem. Tente novamente.');
    }
  }

  /**
   * Verifica se mensagem contém palavras-chave de análise
   */
  hasAnalysisKeywords(content) {
    const keywords = ['analise', 'descreva', 'o que é', 'que imagem', 'o que tem'];
    const lowerContent = content.toLowerCase();
    return keywords.some(keyword => lowerContent.includes(keyword));
  }

  /**
   * Verifica se mensagem deve acionar análise de imagem
   */
  shouldAnalyze(message) {
    const hasImages = this.extractImageUrls(message).length > 0;
    const isMentioned = message.mentions.users.has(message.client.user.id);
    const hasKeywords = this.hasAnalysisKeywords(message.content);
    
    return hasImages && (isMentioned || hasKeywords);
  }

  /**
   * Handler principal
   */
  async handle(message) {
    if (!this.shouldAnalyze(message)) {
      return false;
    }

    const imageUrls = this.extractImageUrls(message);
    if (imageUrls.length === 0) {
      return false;
    }

    // Extrair prompt do usuário (remover menções)
    let userPrompt = message.content
      .replace(/<@!?\d+>/g, '')
      .trim();
    
    if (!userPrompt) {
      userPrompt = null;
    }

    // Analisar primeira imagem
    await this.analyzeImage(message, imageUrls[0], userPrompt);
    return true;
  }
}

module.exports = ImageHandler;
