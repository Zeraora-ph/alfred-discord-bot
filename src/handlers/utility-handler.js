/**
 * Utility Handler
 * Handles utility commands: weather, movies, cities, search
 * 
 * @module handlers/utility-handler
 */

const logger = require('../lib/logger');
const { ExternalServiceError } = require('../services/error-handler');

// ============================================
// External API Integrations
// ============================================

const redis = require('../lib/redis-client');

/**
 * Fetches weather data from OpenWeatherMap
 * 
 * @param {string} city - City name
 * @returns {Promise<Object>} Weather data
 */
async function fetchWeather(city) {
    const apiKey = process.env.OPENWEATHERMAP_API_KEY;
    if (!apiKey) {
        throw new Error('OPENWEATHERMAP_API_KEY não configurada');
    }

    const key = `cache:weather:${city.toLowerCase().trim()}`;
    try {
        const cached = await redis.get(key);
        if (cached) return JSON.parse(cached);
    } catch (e) {
        logger.warn('[Utility] Erro ao ler cache de tempo:', e);
    }

    const axios = require('axios');
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric&lang=pt_br`;

    const response = await axios.get(url, { timeout: 10000 });
    const data = response.data;

    try {
        await redis.setex(key, 300, JSON.stringify(data)); // 5 min TTL
    } catch (e) {
        logger.warn('[Utility] Erro ao salvar cache de tempo:', e);
    }

    return data;
}

/**
 * Fetches movie data from OMDb
 * 
 * @param {string} title - Movie title
 * @returns {Promise<Object>} Movie data
 */
async function fetchMovie(title) {
    const apiKey = process.env.OMDB_API_KEY;
    if (!apiKey) {
        throw new Error('OMDB_API_KEY não configurada');
    }

    const key = `cache:movie:${title.toLowerCase().trim()}`;
    try {
        const cached = await redis.get(key);
        if (cached) return JSON.parse(cached);
    } catch (e) {
        logger.warn('[Utility] Erro ao ler cache de filme:', e);
    }

    const axios = require('axios');
    const url = `http://www.omdbapi.com/?t=${encodeURIComponent(title)}&apikey=${apiKey}`;

    const response = await axios.get(url, { timeout: 10000 });
    const data = response.data;

    if (data.Response === 'False') {
        throw new Error(data.Error || 'Filme não encontrado');
    }

    try {
        await redis.setex(key, 3600, JSON.stringify(data)); // 1 hora TTL
    } catch (e) {
        logger.warn('[Utility] Erro ao salvar cache de filme:', e);
    }

    return data;
}

/**
 * Fetches city data from GeoNames
 * 
 * @param {string} cityName - City name
 * @returns {Promise<Object>} City data
 */
async function fetchCity(cityName) {
    const username = process.env.GEONAMES_USERNAME;
    if (!username) {
        throw new Error('GEONAMES_USERNAME não configurado');
    }

    const key = `cache:city:${cityName.toLowerCase().trim()}`;
    try {
        const cached = await redis.get(key);
        if (cached) return JSON.parse(cached);
    } catch (e) {
        logger.warn('[Utility] Erro ao ler cache de cidade:', e);
    }

    const axios = require('axios');
    const url = `http://api.geonames.org/searchJSON?q=${encodeURIComponent(cityName)}&maxRows=1&username=${username}&lang=pt`;

    const response = await axios.get(url, { timeout: 10000 });
    const data = response.data;

    if (!data.geonames || data.geonames.length === 0) {
        throw new Error('Cidade não encontrada');
    }

    const city = data.geonames[0];

    try {
        await redis.setex(key, 300, JSON.stringify(city)); // 5 min TTL
    } catch (e) {
        logger.warn('[Utility] Erro ao salvar cache de cidade:', e);
    }

    return city;
}

/**
 * Performs Google search
 * 
 * @param {string} query - Search query
 * @returns {Promise<Object[]>} Search results
 */
async function googleSearch(query) {
    const apiKey = process.env.GOOGLE_API_KEY;
    const cseId = process.env.GOOGLE_CSE_ID;

    if (!apiKey || !cseId) {
        throw new Error('GOOGLE_API_KEY ou GOOGLE_CSE_ID não configurados');
    }

    const key = `cache:search:${query.toLowerCase().trim()}`;
    try {
        const cached = await redis.get(key);
        if (cached) return JSON.parse(cached);
    } catch (e) {
        logger.warn('[Utility] Erro ao ler cache de busca:', e);
    }

    const axios = require('axios');
    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cseId}&q=${encodeURIComponent(query)}&num=5`;

    const response = await axios.get(url, { timeout: 10000 });
    const items = response.data.items || [];

    try {
        await redis.setex(key, 3600, JSON.stringify(items)); // 1 hora TTL
    } catch (e) {
        logger.warn('[Utility] Erro ao salvar cache de busca:', e);
    }

    return items;
}

// ============================================
// Command Handlers
// ============================================

/**
 * Handles the !tempo command
 * 
 * @param {Object} message - Discord message
 * @param {string[]} args - City name
 */
async function handleTempoCommand(message, args) {
    if (args.length === 0) {
        await message.reply('❌ Especifique a cidade. Exemplo: `!tempo São Paulo`');
        return;
    }

    const city = args.join(' ');

    try {
        const weather = await fetchWeather(city);

        const response = `**🌤️ Clima em ${weather.name}, ${weather.sys.country}:**

🌡️ **Temperatura:** ${Math.round(weather.main.temp)}°C (Sensação: ${Math.round(weather.main.feels_like)}°C)
💧 **Umidade:** ${weather.main.humidity}%
🌬️ **Vento:** ${Math.round(weather.wind.speed * 3.6)} km/h
☁️ **Condição:** ${weather.weather[0].description}
🌅 **Nascer do Sol:** ${new Date(weather.sys.sunrise * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
🌇 **Pôr do Sol:** ${new Date(weather.sys.sunset * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;

        await message.reply(response);

    } catch (error) {
        logger.error('[Utility] Erro ao buscar clima:', error);

        if (error.response?.status === 404) {
            await message.reply(`❌ Cidade "${city}" não encontrada. Verifique o nome.`);
        } else if (error.message.includes('não configurada')) {
            await message.reply('❌ API de clima não está configurada.');
        } else {
            await message.reply('❌ Erro ao buscar informações do clima.');
        }
    }
}

/**
 * Handles the !filme command
 * 
 * @param {Object} message - Discord message
 * @param {string[]} args - Movie title
 */
async function handleFilmeCommand(message, args) {
    if (args.length === 0) {
        await message.reply('❌ Especifique o filme. Exemplo: `!filme Matrix`');
        return;
    }

    const title = args.join(' ');

    try {
        const movie = await fetchMovie(title);

        const response = `**🎬 ${movie.Title} (${movie.Year})**

📊 **Avaliação:** ⭐ ${movie.imdbRating}/10 (${movie.imdbVotes} votos)
🎭 **Gênero:** ${movie.Genre}
⏱️ **Duração:** ${movie.Runtime}
🎬 **Diretor:** ${movie.Director}
👥 **Elenco:** ${movie.Actors}
🌍 **País:** ${movie.Country}
🏆 **Prêmios:** ${movie.Awards}

📝 **Sinopse:** ${movie.Plot}`;

        await message.reply(response);

    } catch (error) {
        logger.error('[Utility] Erro ao buscar filme:', error);

        if (error.message.includes('não encontrado') || error.message.includes('not found')) {
            await message.reply(`❌ Filme "${title}" não encontrado.`);
        } else if (error.message.includes('não configurada')) {
            await message.reply('❌ API de filmes não está configurada.');
        } else {
            await message.reply('❌ Erro ao buscar informações do filme.');
        }
    }
}

/**
 * Handles the !cidade command
 * 
 * @param {Object} message - Discord message
 * @param {string[]} args - City name
 */
async function handleCidadeCommand(message, args) {
    if (args.length === 0) {
        await message.reply('❌ Especifique a cidade. Exemplo: `!cidade Lisboa`');
        return;
    }

    const cityName = args.join(' ');

    try {
        const city = await fetchCity(cityName);

        const response = `**🏙️ ${city.name}, ${city.countryName}**

📍 **Coordenadas:** ${city.lat}, ${city.lng}
👥 **População:** ${city.population ? city.population.toLocaleString('pt-BR') : 'N/A'}
🗺️ **Região:** ${city.adminName1 || 'N/A'}
🌐 **Fuso Horário:** ${city.timezone || 'N/A'}
🏔️ **Elevação:** ${city.elevation ? `${city.elevation}m` : 'N/A'}`;

        await message.reply(response);

    } catch (error) {
        logger.error('[Utility] Erro ao buscar cidade:', error);

        if (error.message.includes('não encontrada')) {
            await message.reply(`❌ Cidade "${cityName}" não encontrada.`);
        } else if (error.message.includes('não configurado')) {
            await message.reply('❌ API de cidades não está configurada.');
        } else {
            await message.reply('❌ Erro ao buscar informações da cidade.');
        }
    }
}

/**
 * Handles the !pesquisar command
 * 
 * @param {Object} message - Discord message
 * @param {string[]} args - Search query
 */
async function handlePesquisarCommand(message, args) {
    if (args.length === 0) {
        await message.reply('❌ Especifique o termo. Exemplo: `!pesquisar inteligência artificial`');
        return;
    }

    const query = args.join(' ');

    try {
        const results = await googleSearch(query);

        if (results.length === 0) {
            await message.reply(`❌ Nenhum resultado encontrado para "${query}".`);
            return;
        }

        let response = `**🔍 Resultados para:** "${query}"\n\n`;

        for (let i = 0; i < Math.min(5, results.length); i++) {
            const item = results[i];
            response += `**${i + 1}. [${item.title}](${item.link})**\n`;
            response += `${item.snippet}\n\n`;
        }

        await message.reply(response);

    } catch (error) {
        logger.error('[Utility] Erro na pesquisa:', error);

        if (error.message.includes('não configurado')) {
            await message.reply('❌ API de pesquisa não está configurada.');
        } else {
            await message.reply('❌ Erro ao realizar pesquisa.');
        }
    }
}

/**
 * Handles the !ajuda command
 * 
 * @param {Object} message - Discord message
 */
async function handleAjudaCommand(message) {
    const helpText1 = `**🤖 Alfred - Comandos Principais:**

**Comandos Básicos:**
• \`!pergunta [sua pergunta]\` — Pergunte qualquer coisa para a IA
• \`!resumo [URL]\` — Resume o conteúdo de uma página
• \`!traduzir [idioma] [texto]\` — Traduz texto para outro idioma
• \`!codigo [descrição]\` — Gera código com explicação

**Comandos Utilitários:**
• \`!tempo [cidade]\` — Previsão do tempo
• \`!filme [nome]\` — Info de filme
• \`!cidade [nome]\` — Info geográfica
• \`!pesquisar [termo]\` — Pesquisa no Google

**Comandos de Música:**
• \`alfred, toque [música]\` — Toca música
• \`alfred, pula\` — Pula para próxima
• \`alfred, pausa/despausa\` — Pausa/retoma
• \`alfred, fila\` — Mostra a fila`;

    const helpText2 = `**🔐 Administração de Memória:**
• \`!lembrar <pergunta> = <resposta>\` — Salva informação
• \`!setmemperm <everyone|admin|helper>\` — Configura permissões
• \`!addwl @user/@role\` — Adiciona à whitelist
• \`!removewl @user/@role\` — Remove da whitelist

**🎯 Menção Inteligente:**
Você pode mencionar o Alfred naturalmente:
• \`alfred qual a previsão do tempo?\`
• \`alfred toque uma música animada\`
• \`alfred anote que eu gosto de pizza\`

**💡 Dica:** Use os comandos acima ou mencione o Alfred!`;

    await message.reply(helpText1);
    await message.reply(helpText2);
}

/**
 * Handles the !status command
 * 
 * @param {Object} message - Discord message
 */
async function handleStatusCommand(message) {
    const aiClient = require('../lib/ai-client');
    const discordClient = require('../lib/discord-client');

    const providerInfo = aiClient.getCurrentProvider();
    const guildCount = discordClient.guilds?.cache?.size || 0;
    const uptime = process.uptime();

    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);

    const response = `**🤖 Status do Alfred:**

📡 **Provedor IA:** ${providerInfo}
🖥️ **Servidores:** ${guildCount}
⏱️ **Uptime:** ${hours}h ${minutes}m
💾 **Memória:** ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB
📦 **Node.js:** ${process.version}`;

    await message.reply(response);
}

// ============================================
// Exports
// ============================================

module.exports = {
    // API Functions
    fetchWeather,
    fetchMovie,
    fetchCity,
    googleSearch,

    // Command Handlers
    handleTempoCommand,
    handleFilmeCommand,
    handleCidadeCommand,
    handlePesquisarCommand,
    handleAjudaCommand,
    handleStatusCommand
};
