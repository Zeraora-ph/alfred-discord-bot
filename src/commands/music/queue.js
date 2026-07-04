const { SlashCommandBuilder } = require('discord.js');
const { buildMockMessage } = require('../../lib/music-utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Mostra a fila de músicas'),

  async execute(interaction) {
    const musicPlayer = interaction.client.musicPlayer;
    if (!musicPlayer) {
      return interaction.reply({ content: '❌ Sistema de música não está disponível!', ephemeral: true });
    }

    const mockMessage = buildMockMessage(interaction);
    await musicPlayer.queue(mockMessage);
  }
};
