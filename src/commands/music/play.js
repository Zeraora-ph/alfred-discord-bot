const { SlashCommandBuilder } = require('discord.js');
const { buildMockMessage } = require('../../lib/music-utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Toca uma música')
    .addStringOption(option =>
      option.setName('query')
        .setDescription('Nome ou link da música')
        .setRequired(true)),

  async execute(interaction) {
    const query = interaction.options.getString('query');
    const musicPlayer = interaction.client.musicPlayer;

    if (!musicPlayer) {
      return interaction.reply({ content: '❌ Sistema de música não está disponível!', ephemeral: true });
    }

    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) {
      return interaction.reply({ content: '❌ Você precisa estar em um canal de voz!', ephemeral: true });
    }

    await interaction.deferReply();
    const mockMessage = buildMockMessage(interaction);
    await musicPlayer.play(mockMessage, query);
  }
};
