/**
 * 🤖 ALFRED BOT - DISCORD AI ASSISTANT
 * 
 * Licença MIT - Open Source
 */

const dotenv = require('dotenv');
dotenv.config();

const client = require('./lib/discord-client');
const discordManager = client.manager;

// Validação crítica de variáveis de ambiente
const requiredEnvVars = ['DISCORD_TOKEN'];
for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        console.error(`❌ CRÍTICO: Variável de ambiente ${envVar} não encontrada!`);
        process.exit(1);
    }
}

// Sistema de proteção e watermarking
const ProtectionSystem = require('./lib/protection');
const protection = new ProtectionSystem();

// Cliente AI (inclui inicialização de documentos)
const aiClient = require('./lib/ai-client');

// Music Manager (Discord Player)
const MusicManager = require('./lib/music-manager');

// Inicializar LavalinkStarter para iniciar o servidor Java em segundo plano
const LavalinkStarter = require('./lib/lavalink-starter');
client.lavalinkStarter = new LavalinkStarter();
client.lavalinkStarter.start();

// Inicializar WhisperStarter para iniciar o servidor Python em segundo plano
const WhisperStarter = require('./lib/whisper-starter');
client.whisperStarter = new WhisperStarter();
client.whisperStarter.start();

// Inicializa sistema de proteção
protection.validateEnvironment();
protection.checkIntegrity();
protection.detectUnauthorizedUse();
const fingerprint = protection.logStartup();

// Log para debug das variáveis de ambiente (SEM EXPOR TOKENS)
console.log('🔍 DEBUG: Verificando variáveis de ambiente...');
console.log('🔍 DEBUG: DISCORD_TOKEN existe:', !!process.env.DISCORD_TOKEN);

const fs = require('node:fs');
const path = require('node:path');
const { Client, GatewayIntentBits } = require('discord.js');
const { spawn } = require('child_process');

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
        console.log(`✅ Bot secundário JBL (${jblClient.user.tag}) está online!`);
    });
}

// Inicializar cliente AI (inclui documentos)
async function initializeAI() {
    try {
        await aiClient.initialize();
        console.log('✅ Cliente AI inicializado com sucesso');
    } catch (error) {
        console.error('❌ Erro ao inicializar cliente AI:', error);
        process.exit(1);
    }
}

// Removido: função startEmbeddingService e chamada relacionada ao microserviço Python de embeddings

// Não carrega mais comandos de barra, apenas eventos
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
	const filePath = path.join(eventsPath, file);
	const event = require(filePath);
	if (event.once) {
		client.once(event.name, (...args) => event.execute(...args));
	} else {
		client.on(event.name, (...args) => event.execute(...args));
	}
}

// Inicializar quando o bot estiver pronto
client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} está online!`);
    console.log(`📊 Servindo ${client.guilds.cache.size} servidores`);
    
    // Inicializar Music Manager (Discord Player)
    try {
        if (jblClient && !jblClient.readyAt) {
            console.log('⏳ Aguardando bot JBL ficar pronto antes de inicializar o Lavalink...');
            await new Promise(resolve => jblClient.once('ready', resolve));
        }
        client.musicPlayer = new MusicManager();
        await client.musicPlayer.init(client, jblClient);
        console.log('🎵 Sistema de música inicializado com sucesso!');
    } catch (error) {
        console.error('⚠️ Erro ao inicializar música:', error.message);
        console.log('🎵 Bot funcionará sem sistema de música');
    }
    
    // Pré-gerar saudações do Rei Julien via Fish Audio (em background, não bloqueia boot)
    try {
        const ttsManager = require('./lib/tts-manager');
        ttsManager.prefetchGreetings().catch(e => console.warn('⚠ Prefetch de saudações falhou:', e.message));
    } catch { /* ignore */ }

    await initializeAI();
});

// Garantir conexão antes de inicializar
async function initializeBot() {
    try {
        console.log('🔗 Inicializando conexão com Discord...');
        await discordManager.ensureConnection();
        console.log('✅ Conexão com Discord estabelecida');
    } catch (error) {
        console.error('❌ Erro ao conectar com Discord:', error);
        process.exit(1);
    }
}

// Inicializar bot
initializeBot();

// Limpeza ao encerrar
process.on('SIGINT', async () => {
    console.log('\n🔄 Encerrando Alfred...');
    await aiClient.cleanup();
    
    // Encerrar sistema de música se estiver rodando
    if (client.musicPlayer?.queues?.cache) {
        // Limpar todas as filas (façade)
        for (const queue of client.musicPlayer.queues.cache.values()) {
            try { queue.delete(); } catch (e) { /* ignore */ }
        }
    }
    
    // Parar o servidor Lavalink local
    if (client.lavalinkStarter) {
        client.lavalinkStarter.stop();
    }
    
    // Parar o servidor Whisper local
    if (client.whisperStarter) {
        client.whisperStarter.stop();
    }
    
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🔄 Encerrando Alfred...');
    await aiClient.cleanup();
    
    // Encerrar sistema de música se estiver rodando
    if (client.musicPlayer?.queues?.cache) {
        // Limpar todas as filas (façade)
        for (const queue of client.musicPlayer.queues.cache.values()) {
            try { queue.delete(); } catch (e) { /* ignore */ }
        }
    }
    
    // Parar o servidor Lavalink local
    if (client.lavalinkStarter) {
        client.lavalinkStarter.stop();
    }
    
    // Parar o servidor Whisper local
    if (client.whisperStarter) {
        client.whisperStarter.stop();
    }
    
    process.exit(0);
});

// Tratamento de erros não capturados
process.on('unhandledRejection', (error) => {
    console.error('❌ Erro não tratado:', error);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Exceção não capturada:', error);
    process.exit(1);
});

// Handler global para exceções não capturadas
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // Nunca encerre o processo!
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Nunca encerre o processo!
});

// Login seguro (SEM LOG DO TOKEN)
client.login(process.env.DISCORD_TOKEN); 
if (jblClient) {
    jblClient.login(process.env.JBL_DISCORD_TOKEN).catch(err => {
        console.error('⚠️ Erro ao fazer login do bot secundário JBL:', err.message);
    });
} 