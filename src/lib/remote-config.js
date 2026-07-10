/**
 * Sistema de Configuração Remota - Alfred Bot
 * ALFRED DISCORD BOT - OPEN SOURCE
 * 
 * Este sistema permite que o cliente rode o bot sem acesso às chaves sensíveis
 * As configurações são gerenciadas remotamente pelo proprietário
 */

const axios = require('axios');
const crypto = require('crypto');

class RemoteConfig {
    constructor() {
        this.configServer = process.env.CONFIG_SERVER_URL || 'https://seu-servidor-config.com';
        this.clientId = process.env.CLIENT_ID; // ID único do cliente
        this.apiKey = process.env.CLIENT_API_KEY; // Chave de acesso do cliente
        this.config = null;
        this.lastUpdate = null;
        this.updateInterval = 5 * 60 * 1000; // 5 minutos
    }

    // Gera hash para autenticação
    generateAuthHash() {
        const timestamp = Date.now();
        const data = `${this.clientId}_${this.apiKey}_${timestamp}`;
        return {
            hash: crypto.createHash('sha256').update(data).digest('hex'),
            timestamp
        };
    }

    // Busca configurações do servidor remoto
    async fetchConfig() {
        try {
            const auth = this.generateAuthHash();
            
            const response = await axios.get(`${this.configServer}/api/config/${this.clientId}`, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'X-Timestamp': auth.timestamp,
                    'X-Hash': auth.hash,
                    'User-Agent': 'AlfredBot/1.0'
                },
                timeout: 10000
            });

            if (response.data.success) {
                this.config = response.data.config;
                this.lastUpdate = Date.now();
                console.log('✅ Configuração remota carregada com sucesso');
                return this.config;
            } else {
                throw new Error(response.data.error || 'Erro ao carregar configuração');
            }
        } catch (error) {
            console.error('❌ Erro ao carregar configuração remota:', error.message);
            
            // Fallback para configuração local (se disponível)
            if (process.env.DISCORD_TOKEN) {
                console.log('⚠️ Usando configuração local como fallback');
                return this.getLocalConfig();
            }
            
            throw new Error('Não foi possível carregar configuração remota ou local');
        }
    }

    // Configuração local como fallback
    getLocalConfig() {
        return {
            DISCORD_TOKEN: process.env.DISCORD_TOKEN,
            DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
            // Outras configurações...
        };
    }

    // Verifica se precisa atualizar configuração
    async checkForUpdates() {
        if (!this.lastUpdate || (Date.now() - this.lastUpdate) > this.updateInterval) {
            await this.fetchConfig();
        }
        return this.config;
    }

    // Obtém configuração atual
    async getConfig() {
        if (!this.config) {
            await this.fetchConfig();
        }
        return this.config;
    }

    // Valida se o cliente tem permissão
    async validateClient() {
        try {
            const auth = this.generateAuthHash();
            
            const response = await axios.post(`${this.configServer}/api/validate`, {
                clientId: this.clientId,
                timestamp: auth.timestamp,
                hash: auth.hash
            }, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'User-Agent': 'AlfredBot/1.0'
                }
            });

            return response.data.valid;
        } catch (error) {
            console.error('❌ Erro ao validar cliente:', error.message);
            return false;
        }
    }

    // Reporta uso para monitoramento
    async reportUsage(stats) {
        try {
            const auth = this.generateAuthHash();
            
            await axios.post(`${this.configServer}/api/usage`, {
                clientId: this.clientId,
                timestamp: Date.now(),
                stats: stats
            }, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'X-Timestamp': auth.timestamp,
                    'X-Hash': auth.hash,
                    'User-Agent': 'AlfredBot/1.0'
                }
            });
        } catch (error) {
            console.error('❌ Erro ao reportar uso:', error.message);
        }
    }
}

module.exports = RemoteConfig; 