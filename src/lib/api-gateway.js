/**
 * API Gateway - Alfred Bot
 * ALFRED DISCORD BOT - OPEN SOURCE
 * 
 * Este sistema centraliza todas as chamadas para APIs externas
 * As chaves ficam no servidor do proprietário, não no cliente
 */

const axios = require('axios');
const crypto = require('crypto');

class ApiGateway {
    constructor() {
        this.gatewayUrl = process.env.GATEWAY_URL || 'https://seu-gateway.com/api';
        this.clientId = process.env.CLIENT_ID;
        this.clientSecret = process.env.CLIENT_SECRET;
        this.sessionToken = null;
        this.tokenExpiry = null;
    }

    // Autentica com o gateway
    async authenticate() {
        try {
            const response = await axios.post(`${this.gatewayUrl}/auth`, {
                clientId: this.clientId,
                clientSecret: this.clientSecret,
                timestamp: Date.now()
            }, {
                headers: {
                    'User-Agent': 'AlfredBot/1.0'
                }
            });

            if (response.data.success) {
                this.sessionToken = response.data.token;
                this.tokenExpiry = Date.now() + (response.data.expiresIn * 1000);
                console.log('✅ Autenticado com API Gateway');
                return true;
            } else {
                throw new Error(response.data.error);
            }
        } catch (error) {
            console.error('❌ Erro na autenticação:', error.message);
            return false;
        }
    }

    // Verifica se o token ainda é válido
    async ensureValidToken() {
        if (!this.sessionToken || (this.tokenExpiry && Date.now() > this.tokenExpiry)) {
            return await this.authenticate();
        }
        return true;
    }

    // Faz chamada para APIs de pesquisa
    async callSearchAPI(query, type = 'google') {
        await this.ensureValidToken();

        try {
            const response = await axios.get(`${this.gatewayUrl}/search/${type}`, {
                params: { q: query },
                headers: {
                    'Authorization': `Bearer ${this.sessionToken}`,
                    'User-Agent': 'AlfredBot/1.0'
                }
            });

            return response.data;
        } catch (error) {
            console.error(`❌ Erro na pesquisa ${type}:`, error.message);
            throw error;
        }
    }

    // Faz chamada para APIs de tempo
    async callWeatherAPI(city) {
        await this.ensureValidToken();

        try {
            const response = await axios.get(`${this.gatewayUrl}/weather`, {
                params: { city: city },
                headers: {
                    'Authorization': `Bearer ${this.sessionToken}`,
                    'User-Agent': 'AlfredBot/1.0'
                }
            });

            return response.data;
        } catch (error) {
            console.error('❌ Erro na API de tempo:', error.message);
            throw error;
        }
    }

    // Faz chamada para APIs de filmes
    async callMovieAPI(title) {
        await this.ensureValidToken();

        try {
            const response = await axios.get(`${this.gatewayUrl}/movies`, {
                params: { title: title },
                headers: {
                    'Authorization': `Bearer ${this.sessionToken}`,
                    'User-Agent': 'AlfredBot/1.0'
                }
            });

            return response.data;
        } catch (error) {
            console.error('❌ Erro na API de filmes:', error.message);
            throw error;
        }
    }

    // Reporta métricas de uso
    async reportMetrics(metrics) {
        try {
            await axios.post(`${this.gatewayUrl}/metrics`, {
                clientId: this.clientId,
                timestamp: Date.now(),
                metrics: metrics
            }, {
                headers: {
                    'Authorization': `Bearer ${this.sessionToken}`,
                    'User-Agent': 'AlfredBot/1.0'
                }
            });
        } catch (error) {
            console.error('❌ Erro ao reportar métricas:', error.message);
        }
    }
}

module.exports = ApiGateway; 