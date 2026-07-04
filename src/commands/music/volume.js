const { SlashCommandBuilder } = require('discord.js');
const { buildMockMessage } = require('../../lib/music-utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Define o volume da música')
    .addIntegerOption(option =>
      option.setName('level')
        .setDescription('Volume (0-100)')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(100)),

  async execute(interaction) {
    const volumeLevel = interaction.options.getInteger('level');
    const musicPlayer = interaction.client.musicPlayer;

    if (!musicPlayer) {
      return interaction.reply({ content: '❌ Sistema de música não está disponível!', ephemeral: true });
    }

    const mockMessage = buildMockMessage(interaction);
    await musicPlayer.setVolume(mockMessage, volumeLevel);
  }
};
