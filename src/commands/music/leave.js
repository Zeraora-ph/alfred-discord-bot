const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Sai do canal de voz'),

  async execute(interaction) {
    const musicPlayer = interaction.client.musicPlayer;

    if (!musicPlayer) {
      return interaction.reply({ content: '❌ Sistema de música não está disponível!', ephemeral: true });
    }

    await musicPlayer.leave(interaction);
  }
};
