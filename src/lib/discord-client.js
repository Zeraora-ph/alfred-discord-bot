const { Client, GatewayIntentBits } = require('discord.js');
const logger = require('./logger');

class DiscordClientManager {
    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildVoiceStates,
                GatewayIntentBits.GuildMembers
            ]
        });
        
        this.isReady = false;
        this.guildsCache = [];
        this.lastCacheUpdate = 0;
        this.cacheUpdateInterval = 30000; // 30 segundos
        
        this.setupEventHandlers();
    }
    
    setupEventHandlers() {
        this.client.on('ready', () => {
            this.isReady = true;
            logger.info(`🤖 Discord Client conectado como ${this.client.user.tag}`);
            this.updateGuildsCache();
        });
        
        this.client.on('guildCreate', () => {
            this.updateGuildsCache();
        });
        
        this.client.on('guildDelete', () => {
            this.updateGuildsCache();
        });
        
        this.client.on('disconnect', () => {
            this.isReady = false;
            logger.warn('🔌 Discord Client desconectado');
        });
        
        this.client.on('reconnecting', () => {
            logger.info('🔄 Discord Client reconectando...');
        });
    }
    
    updateGuildsCache() {
        if (this.client && this.client.guilds && this.client.guilds.cache) {
            this.guildsCache = this.client.guilds.cache.map(g => ({
                id: g.id,
                name: g.name,
                icon: g.icon
            }));
            this.lastCacheUpdate = Date.now();
            logger.info(`📊 Cache de guilds atualizado: ${this.guildsCache.length} servidores`);
        }
    }
    
    async ensureConnection() {
        if (!this.isReady) {
            logger.info('🔗 Garantindo conexão com Discord...');
            
            if (!this.client.token) {
                throw new Error('Token do Discord não configurado');
            }
            
            try {
                await this.client.login(process.env.DISCORD_TOKEN);
                // Aguarda até estar pronto
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        reject(new Error('Timeout ao conectar com Discord'));
                    }, 10000);
                    
                    if (this.isReady) {
                        clearTimeout(timeout);
                        resolve();
                    } else {
                        this.client.once('ready', () => {
                            clearTimeout(timeout);
                            resolve();
                        });
                    }
                });
            } catch (error) {
                logger.error('❌ Erro ao conectar com Discord:', error);
                throw error;
            }
        }
    }
    
    async getGuilds() {
        // Força atualização do cache se necessário
        if (Date.now() - this.lastCacheUpdate > this.cacheUpdateInterval) {
            this.updateGuildsCache();
        }
        
        // Se o cache estiver vazio, tenta reconectar
        if (this.guildsCache.length === 0) {
            logger.warn('⚠️ Cache de guilds vazio, tentando reconectar...');
            await this.ensureConnection();
            this.updateGuildsCache();
        }
        
        return this.guildsCache;
    }
    
    async getGuildById(guildId) {
        await this.ensureConnection();
        return this.client.guilds.cache.get(guildId);
    }
    
    isConnected() {
        return this.isReady && this.client.ws.status === 0;
    }
    
    getStatus() {
        return {
            isReady: this.isReady,
            wsStatus: this.client.ws.status,
            guildsCount: this.guildsCache.length,
            lastCacheUpdate: this.lastCacheUpdate
        };
    }
}

// Singleton instance
const discordClientManager = new DiscordClientManager();

// Exporta tanto o manager quanto o client para compatibilidade
module.exports = discordClientManager.client;
module.exports.manager = discordClientManager; 