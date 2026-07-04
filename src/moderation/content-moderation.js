const aiClient = require('../lib/ai-client');
const logger = require('../lib/logger');

class ContentModeration {
    constructor() {
        this.sensitiveWords = [
            'spam', 'scam', 'phishing', 'malware', 'virus',
            // Adicione mais palavras sensíveis conforme necessário
        ];
    }

    async moderateMessage(message) {
        try {
            // Verificação básica de palavras sensíveis
            const hasSensitiveWords = this.sensitiveWords.some(word => 
                message.content.toLowerCase().includes(word)
            );

            if (hasSensitiveWords) {
                logger.warn(`Mensagem contém palavras sensíveis: ${message.author.tag}`);
                return { flagged: true, reason: 'Palavras sensíveis detectadas' };
            }

            // Verificação de spam (muitas mensagens em pouco tempo)
            const spamCheck = await this.checkForSpam(message);
            if (spamCheck.flagged) {
                return spamCheck;
            }

            // Análise de sentimento e conteúdo usando IA
            const aiCheck = await this.aiModeration(message);
            if (aiCheck.flagged) {
                return aiCheck;
            }

            return { flagged: false };
        } catch (error) {
            logger.error('Erro na moderação de conteúdo:', error);
            return { flagged: false }; // Em caso de erro, permite a mensagem
        }
    }

    async checkForSpam(message) {
        const redis = require('../lib/redis-client');
        const key = `spam:${message.author.id}`;
        
        try {
            const recentMessages = await redis.get(key);
            const now = Date.now();
            
            if (recentMessages) {
                const messages = JSON.parse(recentMessages);
                const recentMessagesFiltered = messages.filter(timestamp => 
                    now - timestamp < 10000 // 10 segundos
                );
                
                if (recentMessagesFiltered.length >= 5) {
                    logger.warn(`Spam detectado de ${message.author.tag}`);
                    return { flagged: true, reason: 'Spam detectado' };
                }
                
                recentMessagesFiltered.push(now);
                await redis.setex(key, 10, JSON.stringify(recentMessagesFiltered));
            } else {
                await redis.setex(key, 10, JSON.stringify([now]));
            }
            
            return { flagged: false };
        } catch (error) {
            logger.error('Erro na verificação de spam:', error);
            return { flagged: false };
        }
    }

    async aiModeration(message) {
        // Moderação IA desativada
        return { flagged: false };
    }

    async handleFlaggedMessage(message, moderationResult) {
        try {
            // Remove a mensagem
            await message.delete();
            
            // Envia aviso ao usuário
            const warningMessage = `⚠️ **Aviso de Moderação**\n\n` +
                `Sua mensagem foi removida por: **${moderationResult.reason}**\n\n` +
                `**Lembre-se:** Mantenha o respeito e evite conteúdo inadequado.`;
            
            await message.channel.send({
                content: `${message.author}`,
                embeds: [{
                    color: 0xFF6B6B,
                    title: '🚫 Mensagem Removida',
                    description: warningMessage,
                    footer: { text: 'Sistema de Moderação Automática' },
                    timestamp: new Date()
                }]
            });
            
            // Log da ação
            logger.info(`Mensagem de ${message.author.tag} removida: ${moderationResult.reason}`);
            
        } catch (error) {
            logger.error('Erro ao processar mensagem flaggada:', error);
        }
    }
}

module.exports = new ContentModeration(); 