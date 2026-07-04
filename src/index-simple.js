const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Importar módulos do bot
const logger = require('./lib/logger');

// Music Manager
const MusicManager = require('./lib/music-manager');

// Criar cliente Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// Inicializar sistema de música
client.musicManager = new MusicManager();

// Evento ready
client.once('ready', async () => {
  logger.info(`🤖 ${client.user.tag} está online!`);
  logger.info('🎵 Sistema de música inicializado com sucesso!');
});

// Evento de mensagem simples para música
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const content = message.content.toLowerCase();

  // Comandos de música com !
  if (content.startsWith('!play ')) {
    const query = message.content.slice(6);
    if (message.client.musicManager) {
      await message.client.musicManager.play(message, query);
    }
    return;
  }

  if (content === '!pause') {
    if (message.client.musicManager) {
      await message.client.musicManager.pause(message);
    }
    return;
  }

  if (content === '!resume') {
    if (message.client.musicManager) {
      await message.client.musicManager.resume(message);
    }
    return;
  }

  if (content === '!stop') {
    if (message.client.musicManager) {
      await message.client.musicManager.stop(message);
    }
    return;
  }

  if (content === '!leave') {
    if (message.client.musicManager) {
      await message.client.musicManager.leave(message);
    }
    return;
  }

  // Comandos naturais do Alfred
  if (content.startsWith('alfred, toque ')) {
    const query = message.content.slice(14);
    if (message.client.musicManager) {
      await message.client.musicManager.play(message, query);
    }
    return;
  }

  if (content === 'alfred, pausa') {
    if (message.client.musicManager) {
      await message.client.musicManager.pause(message);
    }
    return;
  }

  if (content === 'alfred, despausa') {
    if (message.client.musicManager) {
      await message.client.musicManager.resume(message);
    }
    return;
  }

  if (content === 'alfred, para') {
    if (message.client.musicManager) {
      await message.client.musicManager.stop(message);
    }
    return;
  }

  if (content === 'alfred, sair') {
    if (message.client.musicManager) {
      await message.client.musicManager.leave(message);
    }
    return;
  }
});

// Tratamento de erros
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, '\nReason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
});

// Login
client.login(process.env.DISCORD_TOKEN);

module.exports = client;