const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const rpgService = require('../../services/rpg-session-service');
const logger = require('../../lib/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rpg')
    .setDescription('Gerencia sessões, gravações e crônicas de RPG')
    .addSubcommand(subcommand =>
      subcommand
        .setName('iniciar')
        .setDescription('Inicia a gravação contínua do áudio da mesa (Modo RPG)')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('parar')
        .setDescription('Encerra a gravação da sessão atual')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('cronica')
        .setDescription('Gera uma crônica épica em Markdown com IA da sessão')
        .addStringOption(option =>
          option
            .setName('data')
            .setDescription('Data da sessão a compilar (formato AAAA-MM-DD). Padrão: hoje')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('resumo')
        .setDescription('Faz o Alfred entrar no canal e ler a crônica mais recente em voz alta')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (subcommand === 'iniciar') {
      // Validar canal de voz
      const voiceChannel = interaction.member?.voice?.channel;
      if (!voiceChannel) {
        return interaction.reply({ content: '❌ Você precisa estar em um canal de voz para gravar!', ephemeral: true });
      }

      await interaction.deferReply();

      // Garantir que o bot está escutando na call
      const voiceListener = interaction.client.voiceListener;
      if (voiceListener) {
        const isListening = voiceListener.isListening(guildId);
        if (!isListening) {
          const success = await voiceListener.startListening(voiceChannel, interaction.channel);
          if (!success) {
            return interaction.editReply({ content: '❌ Não consegui entrar no canal de voz para escutar.' });
          }
        }
      }

      const result = rpgService.startSession(guildId);
      if (result.success) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor('#8b5cf6')
              .setTitle('🎲 Modo RPG: Gravação Iniciada')
              .setDescription('O Alfred agora está gravando a conversa para a crônica da sessão.\nUse `/rpg parar` para finalizar.')
              .setFooter({ text: '🎲 Alfred RPG System' })
          ]
        });
      } else {
        return interaction.editReply({ content: `❌ ${result.message}` });
      }
    }

    if (subcommand === 'parar') {
      const result = rpgService.stopSession(guildId);
      if (result.success) {
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor('#ef4444')
              .setTitle('🎲 Modo RPG: Gravação Encerrada')
              .setDescription(result.message)
              .setFooter({ text: '🎲 Alfred RPG System' })
          ]
        });
      } else {
        return interaction.reply({ content: `❌ ${result.message}`, ephemeral: true });
      }
    }

    if (subcommand === 'cronica') {
      const dateOption = interaction.options.getString('data');
      await interaction.deferReply();

      const result = await rpgService.generateChronicle(guildId, dateOption);
      if (result.success) {
        const filename = `${guildId}-cronica-${result.date}.md`;
        
        let fileText = result.chronicle;
        if (fileText.length > 1900) {
          fileText = fileText.substring(0, 1900) + '\n\n*(Conteúdo completo anexado no arquivo acima)*';
        }

        return interaction.editReply({
          content: '📜 **Aqui está a crônica épica gerada para a sessão!**',
          embeds: [
            new EmbedBuilder()
              .setColor('#8b5cf6')
              .setTitle(`Crônica da Sessão - ${result.date}`)
              .setDescription(fileText)
          ],
          files: [{
            attachment: result.path,
            name: filename
          }]
        });
      } else {
        return interaction.editReply({ content: `❌ ${result.message}` });
      }
    }

    if (subcommand === 'resumo') {
      const voiceChannel = interaction.member?.voice?.channel;
      if (!voiceChannel) {
        return interaction.reply({ content: '❌ Você precisa estar em um canal de voz para o bot falar o resumo!', ephemeral: true });
      }

      await interaction.deferReply();

      const result = await rpgService.getLatestChronicleSummary(guildId);
      if (result.success) {
        // Conectar se necessário
        const voiceListener = interaction.client.voiceListener;
        if (voiceListener) {
          const isListening = voiceListener.isListening(guildId);
          if (!isListening) {
            const success = await voiceListener.startListening(voiceChannel, interaction.channel);
            if (!success) {
              return interaction.editReply({ content: '❌ Não consegui me conectar ao canal de voz.' });
            }
          }

          // Falar resumo
          await interaction.editReply({ content: `🎤 **Lendo crônica de encerramento em voz alta:** \n*"${result.summary}"*` });
          await voiceListener.speak(guildId, result.summary, { voiceId: process.env.FISH_RPG_NARRATOR_VOICE_ID || process.env.FISH_VOICE_ID });
        } else {
          return interaction.editReply({ content: '❌ O sistema de voz do Alfred não está ativo.' });
        }
      } else {
        return interaction.editReply({ content: `❌ ${result.message}` });
      }
    }
  }
};
