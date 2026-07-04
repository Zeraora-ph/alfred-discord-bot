/**
 * Command Router
 * Main message handler that routes commands to appropriate handlers
 * Refactored from the original 1800+ line messageCreate.js
 * 
 * @module handlers/command-router
 */

const { Events } = require('discord.js');
const logger = require('../lib/logger');
const registry = require('../services/command-registry');
const { handleDiscordError } = require('../services/error-handler');
const fastResponse = require('../services/fast-response');

// Import handlers
const aiHandler = require('./ai-handler');
const memoryHandler = require('./memory-handler');
const musicHandler = require('./music-handler');
const utilityHandler = require('./utility-handler');
const ignoredChannels = require('../lib/ignored-channels');
const aiClient = require('../lib/ai-client');

// ============================================
// Deduplication Guard
// ============================================

/** Prevents the same message from being processed twice (e.g. if messageCreate fires twice). */
const _processedIds = new Set();
function _markProcessed(id) {
    if (_processedIds.has(id)) return false;
    _processedIds.add(id);
    setTimeout(() => _processedIds.delete(id), 10000);
    return true;
}

// ============================================
// Bot Detection Helpers
// ============================================

const BOT_NAMES = ['alfred', 'alfredo', 'alf'];

/**
 * Checks if the bot is mentioned by name
 * 
 * @param {Object} message - Discord message
 * @returns {boolean} True if bot is mentioned
 */
function isBotMentioned(message) {
  const content = message.content.toLowerCase().trim();

  // Check for @mention
  if (message.mentions.has(message.client.user)) {
    return true;
  }

  // Check for name mention anywhere in the message (start, middle, or end)
  // Uses word boundary \b to avoid false positives like "alfred" in "talfredo"
  return BOT_NAMES.some(name => {
    const regex = new RegExp(`\\b${name}\\b`, 'i');
    return regex.test(content);
  });
}

/**
 * Extracts the question/command from a message
 * 
 * @param {Object} message - Discord message
 * @returns {string} Cleaned message content
 */
function extractContent(message) {
  let content = message.content;

  // Remove @mention
  content = content.replace(/<@!?\d+>/g, '').trim();

  // Remove bot name from beginning AND end of message
  for (const name of BOT_NAMES) {
    // Remove from start: "alfred, você é gay?" -> "você é gay?"
    const regexStart = new RegExp(`^${name}[,:]?\\s*`, 'i');
    content = content.replace(regexStart, '');

    // Remove from end: "você é gay, alfred?" -> "você é gay?"
    const regexEnd = new RegExp(`[,\\s]+${name}[?!.,]*$`, 'i');
    content = content.replace(regexEnd, '');
  }

  return content.trim();
}

// ============================================
// Command Registration
// ============================================

function registerCommands() {
  // AI Commands
  registry.register({
    name: 'pergunta',
    aliases: ['pergunte', 'ask', 'p'],
    category: 'ai',
    description: 'Faça uma pergunta para a IA',
    execute: aiHandler.handlePerguntaCommand
  });

  registry.register({
    name: 'resumo',
    aliases: ['resumir', 'summarize'],
    category: 'ai',
    description: 'Resume o conteúdo de uma URL',
    execute: (msg, args) => aiHandler.handleResumoCommand(msg, args[0])
  });

  registry.register({
    name: 'traduzir',
    aliases: ['traduz', 'translate', 't'],
    category: 'ai',
    description: 'Traduz texto para outro idioma',
    execute: aiHandler.handleTraduzirCommand
  });

  registry.register({
    name: 'codigo',
    aliases: ['code', 'gerar'],
    category: 'ai',
    description: 'Gera código baseado na descrição',
    execute: aiHandler.handleCodigoCommand
  });

  // Memory Commands
  registry.register({
    name: 'lembrar',
    aliases: ['salvar', 'anote', 'memorizar'],
    category: 'memória',
    description: 'Salva informação na memória',
    execute: memoryHandler.handleLembrarCommand
  });

  registry.register({
    name: 'setmemperm',
    aliases: [],
    category: 'admin',
    description: 'Configura permissões de memória',
    execute: memoryHandler.handleSetMemPermCommand,
    adminOnly: true
  });

  registry.register({
    name: 'addwl',
    aliases: ['addmemwhitelist'],
    category: 'admin',
    description: 'Adiciona à whitelist de memória',
    execute: memoryHandler.handleAddWhitelistCommand,
    adminOnly: true
  });

  registry.register({
    name: 'removewl',
    aliases: ['removememwhitelist'],
    category: 'admin',
    description: 'Remove da whitelist de memória',
    execute: memoryHandler.handleRemoveWhitelistCommand,
    adminOnly: true
  });

  // Utility Commands
  registry.register({
    name: 'tempo',
    aliases: ['weather', 'clima'],
    category: 'utilidades',
    description: 'Mostra previsão do tempo',
    execute: utilityHandler.handleTempoCommand
  });

  registry.register({
    name: 'filme',
    aliases: ['movie', 'filmes'],
    category: 'utilidades',
    description: 'Busca informações de filme',
    execute: utilityHandler.handleFilmeCommand
  });

  registry.register({
    name: 'cidade',
    aliases: ['city'],
    category: 'utilidades',
    description: 'Busca informações de cidade',
    execute: utilityHandler.handleCidadeCommand
  });

  registry.register({
    name: 'pesquisar',
    aliases: ['search', 'google', 'buscar'],
    category: 'utilidades',
    description: 'Pesquisa no Google',
    execute: utilityHandler.handlePesquisarCommand
  });

  registry.register({
    name: 'ajuda',
    aliases: ['help', 'comandos', 'commands'],
    category: 'geral',
    description: 'Mostra lista de comandos',
    execute: utilityHandler.handleAjudaCommand
  });

  registry.register({
    name: 'status',
    aliases: ['info', 'stats'],
    category: 'geral',
    description: 'Mostra status do bot',
    execute: utilityHandler.handleStatusCommand
  });

  // Music Commands
  registry.register({
    name: 'toque',
    aliases: ['play', 'tocar', 'musica'],
    category: 'música',
    description: 'Toca uma música',
    execute: musicHandler.handleToqueCommand
  });

  registry.register({
    name: 'fila',
    aliases: ['queue', 'lista'],
    category: 'música',
    description: 'Mostra fila de músicas',
    execute: musicHandler.handleFilaCommand
  });

  registry.register({
    name: 'pula',
    aliases: ['skip', 'pular', 'next'],
    category: 'música',
    description: 'Pula para próxima música',
    execute: musicHandler.handlePulaCommand
  });

  registry.register({
    name: 'pausa',
    aliases: ['pause', 'pausar'],
    category: 'música',
    description: 'Pausa a música',
    execute: musicHandler.handlePausaCommand
  });

  registry.register({
    name: 'despausa',
    aliases: ['resume', 'continua', 'retome'],
    category: 'música',
    description: 'Retoma a música',
    execute: musicHandler.handleDespausaCommand
  });

  registry.register({
    name: 'parar',
    aliases: ['stop', 'para', 'sair'],
    category: 'música',
    description: 'Para a música e limpa fila',
    execute: musicHandler.handlePararCommand
  });

  registry.register({
    name: 'playlist',
    aliases: ['pl'],
    category: 'música',
    description: 'Gerencia playlists (salvar, tocar, lista)',
    execute: musicHandler.handlePlaylistCommand
  });

  registry.register({
    name: 'historico',
    aliases: ['history', 'histórico'],
    category: 'música',
    description: 'Exibe o histórico de reprodução',
    execute: async (message) => {
      const musicPlayer = message.client.musicPlayer;
      if (musicPlayer) {
        await musicPlayer.execute(message, { action: 'history' });
      }
    }
  });

  registry.register({
    name: 'listen',
    aliases: ['escuta', 'join', 'entra', 'call'],
    category: 'música',
    description: 'Faz o Alfred entrar no canal de voz para escutar',
    execute: async (message) => {
      const musicPlayer = message.client.musicPlayer;
      if (musicPlayer) {
        await musicPlayer.execute(message, { action: 'listen' });
      }
    }
  });

  registry.register({
    name: 'leave',
    aliases: ['sair', 'tchau', 'stoplisten'],
    category: 'música',
    description: 'Faz o Alfred sair do canal de voz e parar de escutar',
    execute: async (message) => {
      const musicPlayer = message.client.musicPlayer;
      if (musicPlayer) {
        await musicPlayer.execute(message, { action: 'stopListen' });
      }
    }
  });

  // RPG Sessions Command
  registry.register({
    name: 'rpg',
    aliases: ['sessao', 'sessaorpg'],
    category: 'música',
    description: 'Gerencia gravação e crônicas de sessões de RPG',
    execute: async (message, args) => {
      const { EmbedBuilder } = require('discord.js');
      const subcommand = args[0]?.toLowerCase();
      const guildId = message.guildId || message.guild?.id;

      if (!subcommand) {
        return message.reply('❌ Use `alfred rpg iniciar`, `alfred rpg parar`, `alfred rpg cronica` ou `alfred rpg resumo`.').catch(() => null);
      }

      const rpgService = require('../services/rpg-session-service');

      if (subcommand === 'iniciar' || subcommand === 'gravar' || subcommand === 'start') {
        const voiceChannel = message.member?.voice?.channel;
        if (!voiceChannel) {
          return message.reply('❌ Você precisa estar em um canal de voz para iniciar a gravação!').catch(() => null);
        }

        const voiceListener = message.client.voiceListener;
        if (voiceListener) {
          const isListening = voiceListener.isListening(guildId);
          if (!isListening) {
            const success = await voiceListener.startListening(voiceChannel, message.channel);
            if (!success) {
              return message.reply('❌ Não consegui me conectar ao canal de voz para escutar.').catch(() => null);
            }
          }
        }

        const result = rpgService.startSession(guildId);
        return message.reply(result.message).catch(() => null);
      }

      if (subcommand === 'parar' || subcommand === 'stop' || subcommand === 'encerrar') {
        const result = rpgService.stopSession(guildId);
        return message.reply(result.message).catch(() => null);
      }

      if (subcommand === 'cronica' || subcommand === 'resumir' || subcommand === 'gerar') {
        const dateInput = args[1]; // Opcional data
        const sentMessage = await message.reply('🧠 **Gerando crônica com IA... Aguarde um momento.**').catch(() => null);
        if (!sentMessage) return;

        const result = await rpgService.generateChronicle(guildId, dateInput);
        if (result.success) {
          const filename = `${guildId}-cronica-${result.date}.md`;
          let fileText = result.chronicle;
          if (fileText.length > 1900) {
            fileText = fileText.substring(0, 1900) + '\n\n*(Conteúdo completo anexado no arquivo acima)*';
          }

          return sentMessage.edit({
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
          }).catch(err => {
             // Fallback se falhar
             message.channel.send({
               content: '📜 **Arquivo da crônica:**',
               files: [{ attachment: result.path, name: filename }]
             }).catch(() => null);
          });
        } else {
          return sentMessage.edit(`❌ ${result.message}`).catch(() => null);
        }
      }

      if (subcommand === 'resumo' || subcommand === 'falar') {
        const voiceChannel = message.member?.voice?.channel;
        if (!voiceChannel) {
          return message.reply('❌ Você precisa estar em um canal de voz para o bot falar o resumo!').catch(() => null);
        }

        const result = await rpgService.getLatestChronicleSummary(guildId);
        if (result.success) {
          const voiceListener = message.client.voiceListener;
          if (voiceListener) {
            const isListening = voiceListener.isListening(guildId);
            if (!isListening) {
              const success = await voiceListener.startListening(voiceChannel, message.channel);
              if (!success) {
                return message.reply('❌ Não consegui me conectar ao canal de voz.').catch(() => null);
              }
            }

            await message.reply(`🎤 **Lendo crônica de encerramento em voz alta:** \n*"${result.summary}"*`).catch(() => null);
            await voiceListener.speak(guildId, result.summary, { voiceId: process.env.FISH_RPG_NARRATOR_VOICE_ID || process.env.FISH_VOICE_ID });
          } else {
            return message.reply('❌ O sistema de voz do Alfred não está ativo.').catch(() => null);
          }
        } else {
          return message.reply(`❌ ${result.message}`).catch(() => null);
        }
      }

      return message.reply('❌ Subcomando inválido. Use `iniciar`, `parar`, `cronica` ou `resumo`.').catch(() => null);
    }
  });

  // Ignore Channel Command (Admin)
  registry.register({
    name: 'ignore',
    aliases: ['ignorar', 'silenciar'],
    category: 'admin',
    description: 'Faz o Alfred ignorar/parar de ignorar canais',
    adminOnly: true,
    execute: async (msg, args) => {
      // Verificar se é admin
      if (!msg.member?.permissions?.has('Administrator')) {
        return msg.reply('❌ Apenas administradores podem usar este comando.');
      }

      const subcommand = args[0]?.toLowerCase();

      // Extrai ID do canal do segundo argumento (pode ser menção <#123> ou ID puro)
      let targetChannelId = args[1]?.replace(/[<#>]/g, '') || msg.channelId;
      const channelMention = `<#${targetChannelId}>`;

      // Validar se o ID parece válido (só números, 17-20 dígitos)
      if (args[1] && !/^\d{17,20}$/.test(targetChannelId)) {
        return msg.reply('❌ ID de canal inválido. Use o ID numérico ou mencione o canal com #.');
      }

      if (!subcommand || subcommand === 'add' || subcommand === 'on') {
        // Ignorar canal
        if (ignoredChannels.addChannel(targetChannelId)) {
          return msg.reply(`🔇 **Canal ignorado!**\n${channelMention} foi adicionado à lista de canais silenciados.\nUse \`!ignore off ${targetChannelId}\` para reverter.`);
        } else {
          return msg.reply(`⚠️ ${channelMention} já está na lista de ignorados.`);
        }
      }

      if (subcommand === 'remove' || subcommand === 'off') {
        // Parar de ignorar canal
        targetChannelId = args[1]?.replace(/[<#>]/g, '') || msg.channelId;
        if (ignoredChannels.removeChannel(targetChannelId)) {
          return msg.reply(`🔊 **Canal ativado!**\n<#${targetChannelId}> foi removido da lista de canais silenciados.`);
        } else {
          return msg.reply(`⚠️ <#${targetChannelId}> não estava sendo ignorado.`);
        }
      }

      if (subcommand === 'list' || subcommand === 'lista') {
        const channels = ignoredChannels.listChannels();
        if (channels.length === 0) {
          return msg.reply('📋 Nenhum canal está sendo ignorado no momento.');
        }
        const list = channels.map(id => `• <#${id}> (\`${id}\`)`).join('\n');
        return msg.reply(`📋 **Canais Ignorados (${channels.length}):**\n${list}`);
      }

      // Ajuda
      return msg.reply(`🔇 **Comando Ignore**

\`!ignore\` - Ignora este canal
\`!ignore <id>\` - Ignora canal pelo ID
\`!ignore off\` - Ativa este canal
\`!ignore off <id>\` - Ativa canal pelo ID
\`!ignore list\` - Lista canais ignorados

**Exemplo:** \`!ignore 1234567890123456789\``);
    }
  });

  logger.info(`[Router] ${registry.getAll().length} comandos registrados`);
}

// Register commands on module load
registerCommands();

// ============================================
// Main Message Handler
// ============================================

/**
 * Main message handler
 * 
 * @param {Object} message - Discord message
 */
async function handleMessage(message) {
  // Ignore bots
  if (message.author.bot) return;

  // ── Deduplication: never process the same message twice ──
  if (!_markProcessed(message.id)) {
    logger.warn(`[Router] Mensagem duplicada ignorada: ${message.id.slice(-6)}`);
    return;
  }

  // Ignore channels that are in the ignore list
  if (ignoredChannels.isIgnored(message.channelId)) {
    return;
  }

  // Check guild authorization
  if (message.guild && !memoryHandler.isGuildAuthorized(message.guildId)) {
    // Só responde se for um comando ou menção explícita para evitar spam
    const content = message.content.trim();
    if (content.startsWith('!') || isBotMentioned(message)) {
      logger.warn(`[Auth] Bloqueado: ${message.guild.name} (${message.guildId})`);
      try {
        await message.reply(`🚫 **Acesso Negado**\nEste servidor não está na whitelist.\nID: \`${message.guildId}\`\nAdmin: Use \`!addwl ${message.guildId}\` para liberar.`);
      } catch (e) { /* Ignore */ }
    }
    return;
  }

  // Store message for context
  await aiHandler.storeMessageForContext(message);

  const content = message.content.trim();

  try {
    // Handle ! prefix commands
    if (content.startsWith('!')) {
      const args = content.slice(1).split(/\s+/);
      const commandName = args.shift().toLowerCase();

      const executed = await registry.execute(commandName, message, args);
      if (executed) {
        if (message.client.stats) message.client.stats.commandsExecuted++;
        return;
      }
    }

    // ── Cache bot-mention check and extracted content (evita chamadas duplicadas) ──
    const mentioned = isBotMentioned(message);
    const cleanContent = mentioned ? extractContent(message) : null;

    // Handle natural language music commands (when bot mentioned)
    if (mentioned) {
      const musicPlayer = message.client.musicPlayer;
      if (musicPlayer?.detectMusicCommand) {
        const musicCommand = musicPlayer.detectMusicCommand(`alfred ${cleanContent}`);
        if (musicCommand) {
          // Detectou comando de música - executa (o handler vai verificar se está pronto)
          await musicPlayer.execute(message, musicCommand);
          if (message.client.stats) message.client.stats.commandsExecuted++;
          return;
        }
      }
    }

    // Handle bot mentions (conversational)
    if (mentioned) {
      const question = cleanContent;

      if (!question) return;

      // FAST PATH: Check for simple greetings first (no AI needed)
      const fastReply = fastResponse.getFastResponse(question);
      if (fastReply) {
        await message.reply(fastReply);
        return;
      }

      // Check for memory save pattern
      const saveMatch = question.match(/(?:anote|salve|lembre|memorize)\s+(?:que\s+)?(.+?)\s*=\s*(.+)/i);
      if (saveMatch) {
        await memoryHandler.saveFact(message, saveMatch[1].trim(), saveMatch[2].trim());
        return;
      }

      // Check for utility shortcuts
      const tempoMatch = question.match(/(?:tempo|clima)\s+(?:em\s+)?(.+)/i);
      if (tempoMatch) {
        await utilityHandler.handleTempoCommand(message, [tempoMatch[1]]);
        if (message.client.stats) message.client.stats.commandsExecuted++;
        return;
      }

      const filmeMatch = question.match(/(?:filme|movie)\s+(.+)/i);
      if (filmeMatch) {
        await utilityHandler.handleFilmeCommand(message, [filmeMatch[1]]);
        if (message.client.stats) message.client.stats.commandsExecuted++;
        return;
      }

      await processAIQuestion(message, question);
      if (message.client.stats) message.client.stats.commandsExecuted++;
      return; // Stop processing here to avoid double response
    }

    // Handle open questions (proactive response even without mention)
    // Check if message is a reply to the bot
    const isReplyToBot = message.reference &&
      message.channel.messages?.cache?.get(message.reference.messageId)?.author?.id === message.client.user.id;

    // Check if previous message was from bot and ended with a question
    // This enables contextual responses like answering "sim" to bot's question
    let isContextualResponse = false;
    try {
      const recentMessages = message.channel.messages?.cache;
      if (recentMessages && recentMessages.size > 1) {
        // Get messages sorted by timestamp (newest first)
        const sorted = [...recentMessages.values()]
          .filter(m => m.id !== message.id)
          .sort((a, b) => b.createdTimestamp - a.createdTimestamp);

        // Find the last message from the bot in recent history (up to last 5 messages)
        // This allows user to send multiple messages and still keep context
        const lastBotMsg = sorted.slice(0, 5).find(m => m.author.id === message.client.user.id);

        // Also get the very last message to check who spoke last
        const previousMsg = sorted[0];

        // Check if bot participated recently
        if (lastBotMsg) {
          // Timeout: 5 minutos (300000ms) desde a ÚLTIMA INTERAÇÃO DO BOT
          const timeDiff = message.createdTimestamp - lastBotMsg.createdTimestamp;
          const maxTime = 300000;

          if (timeDiff < maxTime) {
            const isLastMsgFromBot = previousMsg.author.id === message.client.user.id;
            const isLastMsgFromSameUser = previousMsg.author.id === message.author.id;

            // Check for gratitude - sempre responde
            const isGratitude = /^(valeu|obrigado|obg|brigado|vlw|tmj|tamo junto|thanks|thx|gratidão|agradeço|show de bola|salvou|brabo|mandou bem|boa|god|gênio)/i.test(content.toLowerCase().trim());
            if (isGratitude) {
              isContextualResponse = true;
            }

            // Só analisa se a última msg foi do bot ou do mesmo usuário
            if (!isContextualResponse && (isLastMsgFromBot || isLastMsgFromSameUser)) {
              // Usa Ollama para análise inteligente de contexto
              try {
                const shouldRespond = await aiClient.shouldRespondToContext(content, lastBotMsg.content);
                if (shouldRespond) {
                  isContextualResponse = true;
                  logger.debug(`[Context] Ollama decidiu responder a: "${content}"`);
                }
              } catch (ollamaError) {
                // Se Ollama falhar, usa fallback de regex
                logger.debug(`[Context] Usando fallback regex para: "${content}"`);
                const fallbackMatch = aiClient.shouldRespondToContextFallback(content);
                if (fallbackMatch) {
                  isContextualResponse = true;
                }
              }
            }
          }
        }
      }
    } catch (e) {
      // Silently continue if can't check context
      logger.debug(`[Context] Erro ao verificar contexto:`, e.message);
    }

    if (isContextualResponse || isReplyToBot || fastResponse.shouldRespond(content, isReplyToBot)) {
      await processAIQuestion(message, content);
      if (message.client.stats) message.client.stats.commandsExecuted++;
      return;
    }

  } catch (error) {
    await handleDiscordError(message, error, 'command-router');
  }
}

/**
 * Processes a question with AI, including memory and web search
 * 
 * @param {Object} message - Discord message
 * @param {string} question - The question to process
 */
async function processAIQuestion(message, question) {
  // Get username for pronoun resolution
  const username = message.member?.displayName || message.author.username;

  // Search memories only if likely needed (skip for simple questions)
  let factContext = null;
  if (fastResponse.shouldSearchMemories(question)) {
    try {
      const memories = await memoryHandler.searchMemories(
        message.guildId, message.author.id, question, 3, username
      );
      factContext = memoryHandler.formatMemoriesForContext(memories);
    } catch (e) {
      // Silently continue without memories
    }
  }

  // WEB SEARCH: If no memory context and seems like factual question
  let webContext = null;
  const webSearch = require('../services/web-search');
  if (!factContext && webSearch.needsWebSearch(question)) {
    try {
      const searchQuery = webSearch.extractSearchQuery(question);
      const results = await webSearch.search(searchQuery);
      webContext = webSearch.formatForContext(results);
    } catch (e) {
      // Silently continue without web results
    }
  }

  // Combine contexts
  const combinedContext = [factContext, webContext].filter(Boolean).join('\n\n');

  const response = await aiHandler.processQuestion(message, question, combinedContext || null);
  await message.reply(response);
}

// ============================================
// Export as Discord.js Event
// ============================================

module.exports = {
  name: Events.MessageCreate,
  execute: handleMessage,
  isBotMentioned,
  extractContent,
  registerCommands,
  registry
};
