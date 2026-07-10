/**
 * 🎵 Music Handler - Wrapper for Music Player
 * Detects and routes music commands in natural language
 */

const logger = require('../lib/logger');
// 🆕 Relacionamento: atualiza affinityScore quando usuário pede música
const userRelationship = require('../services/user-relationship-service');

// ============================================
// Music Keywords for Quick Detection
// ============================================

const MUSIC_KEYWORDS = [
    'toca', 'toque', 'play', 'música', 'musica', 'tocar',
    'pausa', 'pause', 'pausar',
    'pula', 'skip', 'pular', 'próxima', 'proxima',
    'para', 'stop', 'parar', 'sair',
    'fila', 'queue', 'lista',
    'volume', 'embaralha', 'shuffle',
    'repete', 'loop', 'repetir',
    'tocando', 'playlist',
    'call', 'join', 'entrar', 'vem', 'cola'
];

// ============================================
// Detection Functions
// ============================================

/**
 * Checks if content might be music-related (quick check)
 */
function isMusicRelated(content) {
    const lower = content.toLowerCase();
    return MUSIC_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Detects if this is a music command and extracts details
 */
async function detectMusicCommand(content) {
    const client = require('../lib/discord-client');
    const musicPlayer = client.musicPlayer;

    if (musicPlayer?.detectMusicCommand) {
        return await musicPlayer.detectMusicCommand(content);
    }

    return null;
}

// ============================================
// Execution
// ============================================

/**
 * Handles a music message and executes the command
 */
async function handleMusicMessage(message) {
    const musicPlayer = message.client.musicPlayer;

    if (!musicPlayer || !musicPlayer.initialized) {
        logger.warn('[Music] Player não inicializado');
        return false;
    }

    const command = await musicPlayer.detectMusicCommand(message.content);

    if (!command) {
        return false;
    }

    // Hybrid Mode: 'join' routes to VoiceListener if available
    if (command.action === 'join' && message.client.voiceListener) {
        const voiceChannel = message.member?.voice?.channel;
        if (voiceChannel) {
            message.reply('🎤 Conectando sistema de voz...');
            const success = await message.client.voiceListener.startListening(voiceChannel, message.channel);
            if (success) {
                return true;
            }
            // Fallback to Lavalink if fails
        }
    }

    await musicPlayer.execute(message, command);

    // 🆕 Atualiza relacionamento: pedido de música = +3 affinityScore
    if (command.action === 'play' && message.author?.id && message.guildId) {
        userRelationship.updateAfterInteraction(message.author.id, message.guildId, 'music_request').catch(() => {});

        // Salva gosto musical se identificou a música
        if (command.query) {
            userRelationship.addMusicTaste(message.author.id, message.guildId, command.query).catch(() => {});
        }
    }

    return true;
}

/**
 * Executes a detected music command
 */
async function executeCommand(message, command) {
    const musicPlayer = message.client.musicPlayer;

    if (!musicPlayer || !musicPlayer.initialized) {
        await message.reply('❌ Sistema de música não está disponível.');
        return false;
    }

    try {
        await musicPlayer.execute(message, command);
        return true;
    } catch (error) {
        logger.error('[Music] Erro:', error);
        await message.reply('❌ Erro ao processar comando de música.');
        return false;
    }
}

// ============================================
// Command Handlers for Registry
// ============================================

async function handleToqueCommand(message, args) {
    if (args.length === 0) {
        await message.reply('❌ Especifique o que quer ouvir. Ex: `!toque guns n roses`');
        return;
    }
    await executeCommand(message, { action: 'play', query: args.join(' ') });
}

async function handleFilaCommand(message) {
    await executeCommand(message, { action: 'queue' });
}

async function handlePulaCommand(message) {
    await executeCommand(message, { action: 'skip' });
}

async function handlePausaCommand(message) {
    await executeCommand(message, { action: 'pause' });
}

async function handleDespausaCommand(message) {
    await executeCommand(message, { action: 'resume' });
}

async function handlePararCommand(message) {
    await executeCommand(message, { action: 'stop' });
}

// ============================================
// Exports
// ============================================


async function handlePlaylistCommand(message, args) {
    if (args.length === 0) {
        return message.reply('❌ Use: `!playlist [salvar/tocar/lista] [nome]`');
    }

    const subCommand = args[0].toLowerCase();
    const name = args.slice(1).join(' ');
    const musicPlayer = message.client.musicPlayer;

    if (!musicPlayer) return message.reply('❌ Player não disponível.');

    switch (subCommand) {
        case 'salvar':
        case 'save':
        case 'criar':
            await musicPlayer.saveQueueAsPlaylist(message, name);
            break;

        case 'tocar':
        case 'play':
        case 'load':
        case 'ouvir':
            await musicPlayer.playSavedPlaylist(message, name);
            break;

        case 'lista':
        case 'list':
        case 'minhas':
            await musicPlayer.listPlaylists(message);
            break;

        case 'excluir':
        case 'deletar':
        case 'remover':
        case 'delete':
            await musicPlayer.deletePlaylist(message, name);
            break;

        case 'historico':
        case 'history':
            await musicPlayer.sendPlayHistory(message);
            break;

        default:
            return message.reply('❌ Comando inválido. Use: `salvar`, `tocar`, `lista`, `excluir` ou `historico`.');
    }
    return true;
}

module.exports = {
    isMusicRelated,
    detectMusicCommand,
    handleMusicMessage,
    executeCommand,
    handleToqueCommand,
    handleFilaCommand,
    handlePulaCommand,
    handlePausaCommand,
    handleDespausaCommand,
    handlePararCommand,
    handlePlaylistCommand,
    MUSIC_KEYWORDS
};
