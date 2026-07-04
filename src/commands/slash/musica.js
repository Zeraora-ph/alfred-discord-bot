/**
 * Slash Command: /musica
 * Play music with autocomplete for common actions
 */

const { SlashCommandBuilder } = require('discord.js');
const musicHandler = require('../../handlers/music-handler');
const logger = require('../../lib/logger');
const { buildMockMessage } = require('../../lib/music-utils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('musica')
        .setNameLocalizations({
            'en-US': 'music',
            'en-GB': 'music'
        })
        .setDescription('Controla o player de música')
        .setDescriptionLocalizations({
            'en-US': 'Control the music player',
            'en-GB': 'Control the music player'
        })
        .addSubcommand(subcommand =>
            subcommand
                .setName('tocar')
                .setNameLocalizations({ 'en-US': 'play', 'en-GB': 'play' })
                .setDescription('Toca uma música')
                .setDescriptionLocalizations({ 'en-US': 'Play a song', 'en-GB': 'Play a song' })
                .addStringOption(option =>
                    option
                        .setName('busca')
                        .setNameLocalizations({ 'en-US': 'search', 'en-GB': 'search' })
                        .setDescription('Nome da música ou URL')
                        .setDescriptionLocalizations({ 'en-US': 'Song name or URL', 'en-GB': 'Song name or URL' })
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('pular')
                .setNameLocalizations({ 'en-US': 'skip', 'en-GB': 'skip' })
                .setDescription('Pula para a próxima música')
                .setDescriptionLocalizations({ 'en-US': 'Skip to next song', 'en-GB': 'Skip to next song' })
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('pausar')
                .setNameLocalizations({ 'en-US': 'pause', 'en-GB': 'pause' })
                .setDescription('Pausa a música atual')
                .setDescriptionLocalizations({ 'en-US': 'Pause current song', 'en-GB': 'Pause current song' })
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('continuar')
                .setNameLocalizations({ 'en-US': 'resume', 'en-GB': 'resume' })
                .setDescription('Continua a música pausada')
                .setDescriptionLocalizations({ 'en-US': 'Resume paused song', 'en-GB': 'Resume paused song' })
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('parar')
                .setNameLocalizations({ 'en-US': 'stop', 'en-GB': 'stop' })
                .setDescription('Para a música e limpa a fila')
                .setDescriptionLocalizations({ 'en-US': 'Stop music and clear queue', 'en-GB': 'Stop music and clear queue' })
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('fila')
                .setNameLocalizations({ 'en-US': 'queue', 'en-GB': 'queue' })
                .setDescription('Mostra a fila de músicas')
                .setDescriptionLocalizations({ 'en-US': 'Show music queue', 'en-GB': 'Show music queue' })
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        // Check if user is in voice channel (except for queue)
        if (subcommand !== 'fila' && !interaction.member?.voice?.channel) {
            return interaction.reply({
                content: '❌ Você precisa estar em um canal de voz!',
                ephemeral: true
            });
        }

        // Create message-like object for handlers
        const mockMessage = buildMockMessage(interaction);

        try {
            switch (subcommand) {
                case 'tocar':
                    const query = interaction.options.getString('busca');
                    await interaction.deferReply();
                    await musicHandler.executeCommand(mockMessage, { action: 'play', query });
                    break;

                case 'pular':
                    await musicHandler.executeCommand(mockMessage, { action: 'skip' });
                    break;

                case 'pausar':
                    await musicHandler.executeCommand(mockMessage, { action: 'pause' });
                    break;

                case 'continuar':
                    await musicHandler.executeCommand(mockMessage, { action: 'resume' });
                    break;

                case 'parar':
                    await musicHandler.executeCommand(mockMessage, { action: 'stop' });
                    break;

                case 'fila':
                    await musicHandler.executeCommand(mockMessage, { action: 'queue' });
                    break;
            }

            logger.info(`[Slash:musica] ${subcommand} executado por ${interaction.user.tag}`);

        } catch (error) {
            logger.error(`[Slash:musica] Erro em ${subcommand}:`, error);

            const errorMessage = '❌ Erro ao processar comando de música.';
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(errorMessage);
            } else {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            }
        }
    }
};
