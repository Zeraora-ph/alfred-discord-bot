const { Player } = require('discord-player');
const { Client } = require('discord.js');

class MusicManagerDiscordPlayer {
  constructor(client) {
    this.client = client;
    this.player = null;
    this.queues = new Map();
  }

  async initialize() {
    try {
      console.log('[MUSIC] Inicializando discord-player...');
      
      this.player = new Player(this.client, {
        ytdlOptions: {
          quality: 'highestaudio',
          highWaterMark: 1 << 25
        }
      });

      // Eventos do player
      this.player.on('error', (queue, error) => {
        console.error('[MUSIC] Erro no player:', error);
      });

      this.player.on('connectionError', (queue, error) => {
        console.error('[MUSIC] Erro de conexão:', error);
      });

      this.player.on('trackStart', (queue, track) => {
        console.log(`[MUSIC] Tocando: ${track.title}`);
        if (queue.metadata?.channel) {
          queue.metadata.channel.send(`🎵 Tocando agora: **${track.title}**`);
        }
      });

      this.player.on('trackEnd', (queue, track) => {
        console.log(`[MUSIC] Música finalizada: ${track.title}`);
      });

      this.player.on('trackAdd', (queue, track) => {
        console.log(`[MUSIC] Música adicionada: ${track.title}`);
        if (queue.metadata?.channel) {
          queue.metadata.channel.send(`✅ **${track.title}** adicionada à fila!`);
        }
      });

      console.log('[MUSIC] discord-player inicializado com sucesso!');
      return true;
    } catch (error) {
      console.error('[MUSIC] Erro ao inicializar discord-player:', error);
      return false;
    }
  }

  // Método para tocar música
  async play(interaction, query) {
    try {
      const channel = interaction.member.voice.channel;
      if (!channel) {
        await interaction.reply('❌ Você precisa estar em um canal de voz!');
        return;
      }

      const queue = this.player.nodes.create(interaction.guild, {
        metadata: {
          channel: interaction.channel
        }
      });

      try {
        if (!queue.connection) {
          await queue.connect(channel);
        }
      } catch (error) {
        console.error('[MUSIC] Erro ao conectar:', error);
        await interaction.reply('❌ Erro ao conectar ao canal de voz!');
        return;
      }

      const searchResult = await this.player.search(query, {
        requestedBy: interaction.user
      });

      if (!searchResult || !searchResult.tracks.length) {
        await interaction.reply('❌ Nenhuma música encontrada!');
        return;
      }

      const track = searchResult.tracks[0];
      await queue.addTrack(track);

      if (!queue.isPlaying()) {
        await queue.node.play();
      }

      await interaction.reply(`✅ **${track.title}** adicionada à fila!`);
    } catch (error) {
      console.error('[MUSIC] Erro ao tocar música:', error);
      await interaction.reply('❌ Erro ao tocar música!');
    }
  }

  // Método para pausar
  async pause(interaction) {
    try {
      const queue = this.player.nodes.get(interaction.guild);
      if (!queue || !queue.isPlaying()) {
        await interaction.reply('❌ Nenhuma música tocando!');
        return;
      }

      queue.node.pause();
      await interaction.reply('⏸️ Música pausada!');
    } catch (error) {
      console.error('[MUSIC] Erro ao pausar:', error);
      await interaction.reply('❌ Erro ao pausar!');
    }
  }

  // Método para despausar
  async resume(interaction) {
    try {
      const queue = this.player.nodes.get(interaction.guild);
      if (!queue || !queue.isPlaying()) {
        await interaction.reply('❌ Nenhuma música tocando!');
        return;
      }

      queue.node.resume();
      await interaction.reply('▶️ Música despausada!');
    } catch (error) {
      console.error('[MUSIC] Erro ao despausar:', error);
      await interaction.reply('❌ Erro ao despausar!');
    }
  }

  // Método para pular
  async skip(interaction) {
    try {
      const queue = this.player.nodes.get(interaction.guild);
      if (!queue || !queue.isPlaying()) {
        await interaction.reply('❌ Nenhuma música tocando!');
        return;
      }

      queue.node.skip();
      await interaction.reply('⏭️ Música pulada!');
    } catch (error) {
      console.error('[MUSIC] Erro ao pular:', error);
      await interaction.reply('❌ Erro ao pular!');
    }
  }

  // Método para parar
  async stop(interaction) {
    try {
      const queue = this.player.nodes.get(interaction.guild);
      if (!queue) {
        await interaction.reply('❌ Nenhuma música tocando!');
        return;
      }

      queue.delete();
      await interaction.reply('⏹️ Música parada!');
    } catch (error) {
      console.error('[MUSIC] Erro ao parar:', error);
      await interaction.reply('❌ Erro ao parar!');
    }
  }

  // Método para mostrar fila
  async queue(interaction) {
    try {
      const queue = this.player.nodes.get(interaction.guild);
      if (!queue || !queue.tracks.length) {
        await interaction.reply('❌ Nenhuma música na fila!');
        return;
      }

      const tracks = queue.tracks.map((track, i) => 
        `${i + 1}. **${track.title}** - ${track.duration}`
      ).slice(0, 10);

      const embed = {
        title: '🎵 Fila de Músicas',
        description: tracks.join('\n'),
        color: 0x00ff00
      };

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      console.error('[MUSIC] Erro ao mostrar fila:', error);
      await interaction.reply('❌ Erro ao mostrar fila!');
    }
  }
}

module.exports = MusicManagerDiscordPlayer; 