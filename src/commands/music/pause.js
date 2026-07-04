const { SlashCommandBuilder } = require('discord.js');
const { buildMockMessage } = require('../../lib/music-utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pausa a música atual'),

  async execute(interaction) {
    const musicPlayer = interaction.client.musicPlayer;
    if (!musicPlayer) {
      return interaction.reply({ content: '❌ Sistema de música não está disponível!', ephemeral: true });
    }

    const mockMessage = buildMockMessage(interaction);
    await musicPlayer.pause(mockMessage);
  }
};
