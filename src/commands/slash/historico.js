const { SlashCommandBuilder } = require('discord.js');
const musicHandler = require('../../handlers/music-handler');
const logger = require('../../lib/logger');
const { buildMockMessage } = require('../../lib/music-utils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('historico')
        .setDescription('Mostra o histórico de reprodução de músicas'),

    async execute(interaction) {
        if (!interaction.member?.voice?.channel) {
            return interaction.reply({
                content: '❌ Você precisa estar em um canal de voz!',
                ephemeral: true
            });
        }

        await interaction.deferReply();
        const mockMessage = buildMockMessage(interaction);

        try {
            await musicHandler.executeCommand(mockMessage, { action: 'history' });
            logger.info(`[Slash:historico] executado por ${interaction.user.tag}`);
        } catch (error) {
            logger.error(`[Slash:historico] Erro:`, error);
            const errorMessage = '❌ Erro ao exibir histórico de reprodução.';
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(errorMessage);
            } else {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            }
        }
    }
};
