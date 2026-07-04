const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Inicializar cliente secundário JBL se o token estiver configurado
let jblClient = null;
if (process.env.JBL_DISCORD_TOKEN) {
  jblClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  });

  jblClient.once('ready', () => {
    logger.success(`Bot secundário JBL (${jblClient.user.tag}) está online!`);
  });
}

// Importar módulos
const logger = require('./lib/logger');
const webServer = require('./web-server');
const aiClient = require('./lib/ai-client');
const factStore = require('./lib/fact-store');
const MusicManager = require('./lib/music-manager');

// ASCII Art Banner
console.log('\x1b[36m');
console.log('   _____  .__   _____                    .___');
console.log('  /  _  \\ |  |_/ ____\\______   ____    __| _/');
console.log(' /  /_\\  \\|  |\\   __\\_  __ \\_/ __ \\  / __ | ');
console.log('/    |    \\  |_|  |  |  | \\/\\  ___/ / /_/ | ');
console.log('\\____|__  /____/__|  |__|    \\___  >\\____ | ');
console.log('        \\/                       \\/      \\/ ');
console.log('\x1b[0m');

// ━━━ INICIALIZAÇÃO ━━━
logger.section('INICIALIZAÇÃO');

// Configurar cliente Discord
const client = require('./lib/discord-client');
client.commands = new Collection();

// Carregar comandos (silencioso)
const commandsPath = path.join(__dirname, 'commands');
let commandCount = 0;

for (const folder of fs.readdirSync(commandsPath)) {
  const folderPath = path.join(commandsPath, folder);
  for (const file of fs.readdirSync(folderPath).filter(f => f.endsWith('.js'))) {
    const command = require(path.join(folderPath, file));
    if ('data' in command && 'execute' in command) {
      client.commands.set(command.data.name, command);
      commandCount++;
    }
  }
}
logger.success(`${commandCount} comandos carregados`);

// Carregar eventos (silencioso)
const eventsPath = path.join(__dirname, 'events');
let eventCount = 0;

for (const file of fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'))) {
  const event = require(path.join(eventsPath, file));
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
  } else {
    client.on(event.name, (...args) => event.execute(...args));
  }
  eventCount++;
}
logger.success(`${eventCount} eventos registrados`);

// Inicializar LavalinkStarter para iniciar o servidor Java em segundo plano
const LavalinkStarter = require('./lib/lavalink-starter');
client.lavalinkStarter = new LavalinkStarter();
client.lavalinkStarter.start();

// Inicializar WhisperStarter para iniciar o servidor Python em segundo plano
const WhisperStarter = require('./lib/whisper-starter');
client.whisperStarter = new WhisperStarter();
client.whisperStarter.start();

// Sistema de música (Lavalink v4 + lavalink-client — inicializado no evento 'ready')
client.musicPlayer = new MusicManager();
client.musicManager = client.musicPlayer; // alias para backward compat
logger.success('Música: MusicManager (Lavalink v4 + lavalink-client)');

// Sistema de Voz (Listen)
const VoiceListener = require('./lib/voice-listener');
client.voiceListener = new VoiceListener(client);
logger.success('Sistema de Voz: Carregado');

// ━━━ PRONTO ━━━
client.once('ready', async () => {
  // 🎵 Inicializar Lavalink (precisa do client já logado)
  try {
    if (jblClient && !jblClient.readyAt) {
      logger.info('⏳ Aguardando bot JBL ficar pronto antes de inicializar o Lavalink...');
      await new Promise(resolve => jblClient.once('ready', resolve));
    }
    await client.musicPlayer.init(client, jblClient);
    client.musicPlayer.voiceListener = client.voiceListener;
    logger.success('Música: LavalinkManager inicializado');

    // Pré-gerar saudações do Rei Julien via Fish Audio (em background, não bloqueia boot)
    try {
      const ttsManager = require('./lib/tts-manager');
      ttsManager.prefetchGreetings().catch(e => logger.warn(`Prefetch de saudações falhou: ${e.message}`));
    } catch { /* ignore */ }
  } catch (musicErr) {
    logger.error('Música: Falha ao inicializar Lavalink:', musicErr.stack || musicErr.message || musicErr);
  }

  // Inicializar estatísticas diárias
  client.stats = {
    commandsExecuted: 0,
    songsPlayed: 0
  };

  logger.section('ONLINE');
  logger.success(`Bot: ${client.user.tag}`);
  logger.success(`Servidores: ${client.guilds.cache.size}`);
  logger.success(`Web: http://localhost:${process.env.WEB_PORT || 3000}`);
  console.log('');
});

// Evento de interação
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);

  if (!command) {
    logger.error(`Comando ${interaction.commandName} não encontrado.`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    logger.error(`Erro ao executar comando ${interaction.commandName}:`, error);

    const errorMessage = 'Houve um erro ao executar este comando.';

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: errorMessage, ephemeral: true });
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true });
    }
  }
});

// Tratamento de erros
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, '\nReason:', reason, '\nStack:', reason && reason.stack);
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason, 'stack:', reason && reason.stack);
  // Nunca encerre o processo!
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  // Nunca encerre o processo!
});

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('🛑 Recebido SIGINT, encerrando...');

  try {
    // Encerrar Lavalink se estiver rodando
    if (client.lavalinkStarter) {
      client.lavalinkStarter.stop();
      logger.info('✅ Lavalink encerrado');
    }

    // Encerrar Whisper se estiver rodando
    if (client.whisperStarter) {
      client.whisperStarter.stop();
      logger.info('✅ Whisper encerrado');
    }

    // Fechar conexão do Discord
    await client.destroy();
    logger.info('✅ Cliente Discord desconectado');

    // Fechar conexão do bot secundário JBL
    if (jblClient) {
      await jblClient.destroy();
      logger.info('✅ Cliente JBL desconectado');
    }

    // Fechar conexão do banco de dados
    if (factStore.db) {
      factStore.db.close();
      logger.info('✅ Banco de dados fechado');
    }

    process.exit(0);
  } catch (error) {
    logger.error('❌ Erro ao encerrar:', error);
    process.exit(1);
  }
});

// Garantir conexão antes de inicializar
async function initializeBot() {
  try {
    logger.info('🔗 Inicializando conexão com Discord...');
    await client.manager.ensureConnection();
    logger.info('✅ Conexão com Discord estabelecida');

    if (jblClient) {
      logger.info('🔗 Conectando bot secundário JBL...');
      await jblClient.login(process.env.JBL_DISCORD_TOKEN);
    }
  } catch (error) {
    logger.error('❌ Erro ao conectar com Discord:', error);
    process.exit(1);
  }
}

// Inicializar bot
initializeBot();

// O servidor web já está sendo iniciado pelo require('./web-server')
// Ele será executado na porta definida em WEB_PORT ou 3000 por padrão

module.exports = {
  client,
  webServer
}; 