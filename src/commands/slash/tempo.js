/**
 * Slash Command: /tempo
 * Get weather information for a city
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const utilityHandler = require('../../handlers/utility-handler');
const logger = require('../../lib/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('tempo')
        .setNameLocalizations({
            'en-US': 'weather',
            'en-GB': 'weather'
        })
        .setDescription('Mostra a previsão do tempo para uma cidade')
        .setDescriptionLocalizations({
            'en-US': 'Shows weather forecast for a city',
            'en-GB': 'Shows weather forecast for a city'
        })
        .addStringOption(option =>
            option
                .setName('cidade')
                .setNameLocalizations({
                    'en-US': 'city',
                    'en-GB': 'city'
                })
                .setDescription('Nome da cidade')
                .setDescriptionLocalizations({
                    'en-US': 'City name',
                    'en-GB': 'City name'
                })
                .setRequired(true)
                .setMaxLength(100)
        ),

    async execute(interaction) {
        const city = interaction.options.getString('cidade');

        await interaction.deferReply();

        try {
            const weather = await utilityHandler.fetchWeather(city);

            const embed = new EmbedBuilder()
                .setColor(0x3498DB)
                .setTitle(`🌤️ Clima em ${weather.name}, ${weather.sys.country}`)
                .setThumbnail(`https://openweathermap.org/img/wn/${weather.weather[0].icon}@2x.png`)
                .addFields(
                    {
                        name: '🌡️ Temperatura',
                        value: `${Math.round(weather.main.temp)}°C (Sensação: ${Math.round(weather.main.feels_like)}°C)`,
                        inline: true
                    },
                    {
                        name: '💧 Umidade',
                        value: `${weather.main.humidity}%`,
                        inline: true
                    },
                    {
                        name: '🌬️ Vento',
                        value: `${Math.round(weather.wind.speed * 3.6)} km/h`,
                        inline: true
                    },
                    {
                        name: '☁️ Condição',
                        value: weather.weather[0].description,
                        inline: true
                    },
                    {
                        name: '🌅 Nascer do Sol',
                        value: new Date(weather.sys.sunrise * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                        inline: true
                    },
                    {
                        name: '🌇 Pôr do Sol',
                        value: new Date(weather.sys.sunset * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                        inline: true
                    }
                )
                .setTimestamp()
                .setFooter({ text: 'Dados do OpenWeatherMap' });

            await interaction.editReply({ embeds: [embed] });
            logger.info(`[Slash:tempo] Executado por ${interaction.user.tag} para ${city}`);

        } catch (error) {
            logger.error('[Slash:tempo] Erro:', error);

            if (error.response?.status === 404) {
                await interaction.editReply(`❌ Cidade "${city}" não encontrada.`);
            } else if (error.message?.includes('não configurada')) {
                await interaction.editReply('❌ API de clima não está configurada.');
            } else {
                await interaction.editReply('❌ Erro ao buscar clima. Tente novamente.');
            }
        }
    }
};
