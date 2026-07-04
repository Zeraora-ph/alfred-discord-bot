/**
 * Slash Command: /filme
 * Get movie information from OMDb
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const utilityHandler = require('../../handlers/utility-handler');
const logger = require('../../lib/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('filme')
        .setNameLocalizations({
            'en-US': 'movie',
            'en-GB': 'movie'
        })
        .setDescription('Busca informações sobre um filme')
        .setDescriptionLocalizations({
            'en-US': 'Search for movie information',
            'en-GB': 'Search for movie information'
        })
        .addStringOption(option =>
            option
                .setName('titulo')
                .setNameLocalizations({
                    'en-US': 'title',
                    'en-GB': 'title'
                })
                .setDescription('Nome do filme')
                .setDescriptionLocalizations({
                    'en-US': 'Movie title',
                    'en-GB': 'Movie title'
                })
                .setRequired(true)
                .setMaxLength(200)
        ),

    async execute(interaction) {
        const title = interaction.options.getString('titulo');

        await interaction.deferReply();

        try {
            const movie = await utilityHandler.fetchMovie(title);

            const embed = new EmbedBuilder()
                .setColor(0xE74C3C)
                .setTitle(`🎬 ${movie.Title} (${movie.Year})`)
                .setDescription(movie.Plot)
                .setThumbnail(movie.Poster !== 'N/A' ? movie.Poster : null)
                .addFields(
                    {
                        name: '⭐ Avaliação',
                        value: `${movie.imdbRating}/10 (${movie.imdbVotes} votos)`,
                        inline: true
                    },
                    {
                        name: '🎭 Gênero',
                        value: movie.Genre || 'N/A',
                        inline: true
                    },
                    {
                        name: '⏱️ Duração',
                        value: movie.Runtime || 'N/A',
                        inline: true
                    },
                    {
                        name: '🎬 Diretor',
                        value: movie.Director || 'N/A',
                        inline: true
                    },
                    {
                        name: '👥 Elenco',
                        value: movie.Actors || 'N/A',
                        inline: false
                    },
                    {
                        name: '🏆 Prêmios',
                        value: movie.Awards !== 'N/A' ? movie.Awards : 'Nenhum registrado',
                        inline: false
                    }
                )
                .setTimestamp()
                .setFooter({ text: 'Dados do OMDb' });

            await interaction.editReply({ embeds: [embed] });
            logger.info(`[Slash:filme] Executado por ${interaction.user.tag} para ${title}`);

        } catch (error) {
            logger.error('[Slash:filme] Erro:', error);

            if (error.message?.includes('não encontrado') || error.message?.includes('not found')) {
                await interaction.editReply(`❌ Filme "${title}" não encontrado.`);
            } else if (error.message?.includes('não configurada')) {
                await interaction.editReply('❌ API de filmes não está configurada.');
            } else {
                await interaction.editReply('❌ Erro ao buscar filme. Tente novamente.');
            }
        }
    }
};
