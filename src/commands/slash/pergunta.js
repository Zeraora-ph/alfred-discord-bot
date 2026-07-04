/**
 * Slash Command: /pergunta
 * Ask a question to the AI
 */

const { SlashCommandBuilder } = require('discord.js');
const aiHandler = require('../../handlers/ai-handler');
const memoryHandler = require('../../handlers/memory-handler');
const logger = require('../../lib/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pergunta')
        .setNameLocalizations({
            'en-US': 'ask',
            'en-GB': 'ask'
        })
        .setDescription('Faça uma pergunta para a IA')
        .setDescriptionLocalizations({
            'en-US': 'Ask a question to the AI',
            'en-GB': 'Ask a question to the AI'
        })
        .addStringOption(option =>
            option
                .setName('questao')
                .setNameLocalizations({
                    'en-US': 'question',
                    'en-GB': 'question'
                })
                .setDescription('Sua pergunta')
                .setDescriptionLocalizations({
                    'en-US': 'Your question',
                    'en-GB': 'Your question'
                })
                .setRequired(true)
                .setMaxLength(2000)
        ),

    async execute(interaction) {
        const question = interaction.options.getString('questao');

        // Defer reply for potentially long AI processing
        await interaction.deferReply();

        try {
            // Search for relevant memories
            let factContext = null;
            try {
                const memories = await memoryHandler.searchMemories(
                    interaction.guildId,
                    interaction.user.id,
                    question,
                    3
                );
                factContext = memoryHandler.formatMemoriesForContext(memories);
            } catch (e) {
                logger.warn('[Slash:pergunta] Erro ao buscar memórias:', e.message);
            }

            // Create a message-like object for the handler
            const mockMessage = {
                guildId: interaction.guildId,
                channelId: interaction.channelId,
                author: {
                    id: interaction.user.id,
                    username: interaction.user.username,
                    tag: interaction.user.tag
                },
                content: question
            };

            const response = await aiHandler.processQuestion(mockMessage, question, factContext);

            // Split response if too long
            if (response.length > 2000) {
                await interaction.editReply(response.substring(0, 2000));
                // Send continuation as follow-up
                const remaining = response.substring(2000);
                for (let i = 0; i < remaining.length; i += 2000) {
                    await interaction.followUp(remaining.substring(i, i + 2000));
                }
            } else {
                await interaction.editReply(response);
            }

            logger.info(`[Slash:pergunta] Executado por ${interaction.user.tag}`);

        } catch (error) {
            logger.error('[Slash:pergunta] Erro:', error);
            await interaction.editReply('❌ Erro ao processar sua pergunta. Tente novamente.');
        }
    }
};
