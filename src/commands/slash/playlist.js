const { SlashCommandBuilder } = require('discord.js');
const musicHandler = require('../../handlers/music-handler');
const logger = require('../../lib/logger');
const { buildMockMessage } = require('../../lib/music-utils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('playlist')
        .setDescription('Gerencia e toca playlists do servidor')
        .addSubcommand(subcommand =>
            subcommand
                .setName('salvar')
                .setDescription('Salva a fila atual em uma playlist personalizada')
                .addStringOption(option =>
                    option
                        .setName('nome')
                        .setDescription('Nome da playlist')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('tocar')
                .setDescription('Carrega e toca uma playlist salva')
                .addStringOption(option =>
                    option
                        .setName('nome')
                        .setDescription('Nome da playlist')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('listar')
                .setDescription('Lista as playlists salvas neste servidor')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('excluir')
                .setDescription('Exclui uma playlist salva neste servidor')
                .addStringOption(option =>
                    option
                        .setName('nome')
                        .setDescription('Nome da playlist')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('historico')
                .setDescription('Mostra o histórico de reprodução com botões interativos')
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        // Check if user is in voice channel (except for listing)
        if (subcommand !== 'listar' && !interaction.member?.voice?.channel) {
            return interaction.reply({
                content: '❌ Você precisa estar em um canal de voz!',
                ephemeral: true
            });
        }

        await interaction.deferReply();
        const mockMessage = buildMockMessage(interaction);

        try {
            switch (subcommand) {
                case 'salvar': {
                    const name = interaction.options.getString('nome');
                    await musicHandler.executeCommand(mockMessage, { action: 'savePlaylist', name });
                    break;
                }

                case 'tocar': {
                    const name = interaction.options.getString('nome');
                    await musicHandler.executeCommand(mockMessage, { action: 'playPlaylist', name });
                    break;
                }

                case 'listar': {
                    await musicHandler.executeCommand(mockMessage, { action: 'listPlaylists' });
                    break;
                }

                case 'excluir': {
                    const name = interaction.options.getString('nome');
                    await musicHandler.executeCommand(mockMessage, { action: 'deletePlaylist', name });
                    break;
                }

                case 'historico': {
                    await musicHandler.executeCommand(mockMessage, { action: 'history' });
                    break;
                }
            }

            logger.info(`[Slash:playlist] ${subcommand} executado por ${interaction.user.tag}`);

        } catch (error) {
            logger.error(`[Slash:playlist] Erro em ${subcommand}:`, error);
            const errorMessage = '❌ Erro ao processar comando de playlist.';
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(errorMessage);
            } else {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            }
        }
    }
};
