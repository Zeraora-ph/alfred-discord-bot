const fs = require('fs').promises;
const path = require('path');
const logger = require('../lib/logger');

const VAULT_DIR = path.resolve(__dirname, '..', '..', 'data', 'vault');

class VaultService {
    constructor() {
        this.vaultDir = VAULT_DIR;
        this.usersDir = path.join(VAULT_DIR, 'users');
        this.guildsDir = path.join(VAULT_DIR, 'guilds');
        this.topicsDir = path.join(VAULT_DIR, 'topics');
        this.episodesDir = path.join(VAULT_DIR, 'episodes');
    }

    /**
     * Inicializa os diretórios do Vault do Obsidian
     */
    async init() {
        try {
            await fs.mkdir(this.vaultDir, { recursive: true });
            await fs.mkdir(this.usersDir, { recursive: true });
            await fs.mkdir(this.guildsDir, { recursive: true });
            await fs.mkdir(this.topicsDir, { recursive: true });
            await fs.mkdir(this.episodesDir, { recursive: true });
            logger.info(`[Vault] Obsidian vault inicializado em: ${this.vaultDir}`);
        } catch (err) {
            logger.error('[Vault] Erro ao inicializar diretórios do Vault:', err);
        }
    }

    /**
     * Normaliza nomes de tópicos para nomes de arquivos seguros
     */
    _sanitizeFilename(name) {
        return name
            .replace(/[\\/:*?"<>|]/g, '') // remove caracteres inválidos de arquivos
            .trim();
    }

    /**
     * Identifica termos comuns e adiciona links automáticos para criar o grafo
     */
    autoLinkEntities(text) {
        if (!text) return text;
        const terms = [
            // Games
            'league of legends', 'lol', 'minecraft', 'valorant', 'cs:go', 'csgo', 'gta', 
            'fortnite', 'roblox', 'rpg', 'cyberpunk', 'witcher', 'skyrim', 'elden ring',
            // Tech/Programming
            'javascript', 'typescript', 'python', 'java', 'c++', 'react', 'node', 
            'html', 'css', 'git', 'github', 'programação', 'inteligência artificial', 'ia',
            // Hobbies/General
            'música', 'filme', 'série', 'anime', 'desenho', 'estudo', 'faculdade', 'trabalho',
            'aniversário', 'livro', 'leitura', 'esporte', 'futebol', 'basquete', 'academia',
            'viagem', 'comida', 'café', 'pizza', 'hamburguer'
        ];

        let result = text;
        for (const term of terms) {
            const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // RegEx que evita casar o termo se ele já estiver dentro de um link [[...]] ou se for subparte de um link
            const regex = new RegExp(`(?<!\\[\\[)(?<!\\|)\\b${escapedTerm}\\b(?!\\|)(?!\\]\\])`, 'gi');
            result = result.replace(regex, (match) => {
                const capitalized = match.charAt(0).toUpperCase() + match.slice(1);
                return `[[${capitalized}]]`;
            });
        }
        return result;
    }

    /**
     * Extrai todos os wikilinks [[Tópico]] de um texto
     * @param {string} text
     * @returns {string[]} Lista de tópicos vinculados
     */
    extractWikiLinks(text) {
        if (!text) return [];
        const regex = /\[\[(.*?)\]\]/g;
        const links = [];
        let match;
        while ((match = regex.exec(text)) !== null) {
            const linkName = match[1].trim();
            if (linkName && !links.includes(linkName)) {
                links.push(linkName);
            }
        }
        return links;
    }

    /**
     * Vincula um usuário a uma guilda de forma bidirecional no Vault
     */
    async addUserToGuild(guildId, userId, username) {
        const filepath = path.join(this.guildsDir, `${guildId}.md`);
        let content = '';
        try {
            content = await fs.readFile(filepath, 'utf8');
        } catch {
            // Nota da guilda não existe, criar nova
            content = `# Configurações do Servidor: ${guildId}\n\n`;
            content += `## ℹ️ Informações Gerais\nNenhuma informação configurada.\n\n`;
            content += `## 👥 Membros Registrados\n`;
        }

        // Se a seção de membros não existir, adicionar
        if (!content.includes('## 👥 Membros Registrados')) {
            content = content.trim() + `\n\n## 👥 Membros Registrados\n`;
        }

        const userLink = `- [[users/${userId}|${username}]]`;
        // Evita duplicar o link se já existir no arquivo da guilda
        if (!content.includes(`users/${userId}`)) {
            content = content.trim() + `\n${userLink}\n`;
            try {
                await fs.writeFile(filepath, content, 'utf8');
                logger.info(`[Vault] Usuário [[users/${userId}|${username}]] vinculado ao servidor [[guilds/${guildId}]]`);
            } catch (err) {
                logger.warn(`[Vault] Falha ao atualizar membros da guilda ${guildId}: ${err.message}`);
            }
        }
    }

    /**
     * Salva ou atualiza a nota de um usuário
     * @param {string} userId
     * @param {string} username
     * @param {Object} data - { nickname, preferredTone, affinity, memories: [], relationships: [], guildId }
     */
    async saveUserProfile(userId, username, data = {}) {
        await this.init();
        const filepath = path.join(this.usersDir, `${userId}.md`);
        const nickname = data.nickname || 'Nenhum';
        const tone = data.preferredTone || 'neutro';
        const affinity = data.affinity || 0;

        let content = `# Perfil de ${username} (@${userId})\n\n`;
        content += `- **Apelido:** ${nickname}\n`;
        content += `- **Tom Preferencial:** #${tone}\n`;
        content += `- **Afinidade:** ${affinity}\n`;
        
        if (data.guildId) {
            content += `- **Servidores Associados:** [[guilds/${data.guildId}|Servidor ${data.guildId}]]\n`;
        }
        content += `\n`;

        content += `## 🧠 Memórias\n`;
        if (data.memories && data.memories.length > 0) {
            for (const mem of data.memories) {
                content += `- ${this.autoLinkEntities(mem)}\n`;
            }
        } else {
            content += `- Nenhuma memória registrada ainda.\n`;
        }
        content += `\n`;

        content += `## 🎭 Notas de Relacionamento\n`;
        if (data.relationships && data.relationships.length > 0) {
            for (const rel of data.relationships) {
                content += `- ${this.autoLinkEntities(rel)}\n`;
            }
        } else {
            content += `- Nenhuma nota especial.\n`;
        }

        try {
            await fs.writeFile(filepath, content, 'utf8');
            // Auto-criar notas de tópicos mencionados em wikilinks de memórias
            const links = this.extractWikiLinks(content);
            for (const link of links) {
                // Se o link apontar para uma guilda ou usuário relativo, não cria como tópico
                if (link.startsWith('guilds/') || link.startsWith('users/') || link.startsWith('episodes/')) {
                    continue;
                }
                await this.createTopicPlaceholder(link);
            }
            
            // Vincular guilda de volta se especificada
            if (data.guildId) {
                await this.addUserToGuild(data.guildId, userId, username);
            }
            await this.updateDashboard();
        } catch (err) {
            logger.warn(`[Vault] Erro ao salvar perfil do usuário ${userId}: ${err.message}`);
        }
    }

    /**
     * Cria um placeholder vazio para um tópico vinculado se ele não existir
     */
    async createTopicPlaceholder(topicName) {
        const sanitized = this._sanitizeFilename(topicName);
        if (!sanitized) return;
        const filepath = path.join(this.topicsDir, `${sanitized}.md`);
        try {
            await fs.access(filepath);
        } catch {
            // Arquivo não existe, cria
            const content = `# ${topicName}\n\nNota criada automaticamente a partir do emaranhamento de memórias. Adicione detalhes aqui se necessário.\n`;
            try {
                await fs.writeFile(filepath, content, 'utf8');
                logger.info(`[Vault] Tópico auto-criado: [[${topicName}]]`);
                await this.updateDashboard();
            } catch (err) {
                logger.warn(`[Vault] Erro ao criar placeholder do tópico ${topicName}: ${err.message}`);
            }
        }
    }

    /**
     * Salva ou atualiza uma nota de guilda (servidor)
     */
    async saveGuildPersona(guildId, info, persona) {
        await this.init();
        const filepath = path.join(this.guildsDir, `${guildId}.md`);

        let membersSection = '';
        try {
            const oldContent = await fs.readFile(filepath, 'utf8');
            const match = oldContent.match(/(## 👥 Membros Registrados[\s\S]*)$/);
            if (match) {
                membersSection = '\n\n' + match[1].trim();
            }
        } catch {}

        let content = `# Configurações do Servidor: ${guildId}\n\n`;
        content += `## ℹ️ Informações Gerais\n${info || 'Nenhuma informação configurada.'}\n\n`;
        content += `## 🎭 Persona do Bot\n${persona || 'Nenhuma persona configurada.'}\n`;

        if (membersSection) {
            content += membersSection + '\n';
        }

        try {
            await fs.writeFile(filepath, content, 'utf8');
            await this.updateDashboard();
        } catch (err) {
            logger.warn(`[Vault] Erro ao salvar persona da guilda ${guildId}: ${err.message}`);
        }
    }

    /**
     * Adiciona um episódio/momento marcante
     */
    async saveEpisode(userId, description) {
        await this.init();
        const filepath = path.join(this.episodesDir, `${userId}.md`);
        const dateStr = new Date().toLocaleDateString('pt-BR');
        const line = `- [${dateStr}] ${description}\n`;

        try {
            await fs.appendFile(filepath, line, 'utf8');
            await this.updateDashboard();
        } catch (err) {
            // Se falhar (ex: não existe), tenta recriar
            try {
                const header = `# Episódios Marcantes de @${userId}\n\n` + line;
                await fs.writeFile(filepath, header, 'utf8');
                await this.updateDashboard();
            } catch (e) {
                logger.warn(`[Vault] Erro ao salvar episódio para ${userId}: ${e.message}`);
            }
        }
    }

    /**
     * Varre as pastas de usuários, guilds, tópicos e episódios para manter o Dashboard.md atualizado
     */
    async updateDashboard() {
        await this.init();
        const dashboardPath = path.join(this.vaultDir, 'Dashboard.md');

        const getFilesAndHeadings = async (dir, relativePrefix) => {
            const list = [];
            try {
                const files = await fs.readdir(dir);
                for (const file of files) {
                    if (!file.endsWith('.md')) continue;
                    const filepath = path.join(dir, file);
                    try {
                        const content = await fs.readFile(filepath, 'utf8');
                        const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.basename(file, '.md');
                        const relativeLink = `${relativePrefix}/${path.basename(file, '.md')}`;
                        list.push({ link: relativeLink, title: heading });
                    } catch (e) {
                        list.push({ link: `${relativePrefix}/${path.basename(file, '.md')}`, title: path.basename(file, '.md') });
                    }
                }
            } catch {}
            return list;
        };

        const users = await getFilesAndHeadings(this.usersDir, 'users');
        const guilds = await getFilesAndHeadings(this.guildsDir, 'guilds');
        const topics = await getFilesAndHeadings(this.topicsDir, 'topics');
        const episodes = await getFilesAndHeadings(this.episodesDir, 'episodes');

        let content = `# 🕸️ Alfred - Obsidian Knowledge Graph Dashboard\n\n`;
        content += `Bem-vindo ao Grafo de Conhecimento do Alfred. Este arquivo conecta todos os nós do Obsidian Vault, organizando e estruturando os dados de memórias, servidores e episódios.\n\n`;

        content += `## 👥 Usuários Registrados\n`;
        if (users.length > 0) {
            for (const u of users) {
                content += `- [[${u.link}|${u.title}]]\n`;
            }
        } else {
            content += `- Nenhum usuário registrado no momento.\n`;
        }
        content += `\n`;

        content += `## 🏰 Servidores (Guilds)\n`;
        if (guilds.length > 0) {
            for (const g of guilds) {
                content += `- [[${g.link}|${g.title}]]\n`;
            }
        } else {
            content += `- Nenhuma guilda configurada no momento.\n`;
        }
        content += `\n`;

        content += `## 📚 Tópicos & Interesses Compartilhados\n`;
        if (topics.length > 0) {
            for (const t of topics) {
                content += `- [[${t.link}|${t.title}]]\n`;
            }
        } else {
            content += `- Nenhum tópico de interesse mapeado ainda.\n`;
        }
        content += `\n`;

        content += `## 🎬 Episódios & Crônicas\n`;
        if (episodes.length > 0) {
            for (const e of episodes) {
                content += `- [[${e.link}|${e.title}]]\n`;
            }
        } else {
            content += `- Nenhuma crônica ou momento registrado.\n`;
        }

        try {
            await fs.writeFile(dashboardPath, content, 'utf8');
            logger.info(`[Vault] Dashboard.md do Obsidian gerado e atualizado com sucesso.`);
        } catch (err) {
            logger.warn(`[Vault] Erro ao gravar Dashboard.md: ${err.message}`);
        }
    }

    /**
     * Busca o conteúdo de uma nota de tópico e resolve o emaranhamento de links
     * @param {string} queryText - O texto de consulta original
     * @param {string[]} matchedFacts - Fatos base obtidos na busca do banco
     * @param {number} [maxDepth=1] - Profundidade máxima de travessia do grafo
     * @returns {Promise<string>} Contexto combinado e enriquecido em formato Markdown
     */
    async getEntangledContext(queryText, matchedFacts = [], maxDepth = 1) {
        const visited = new Set();
        const linksToResolve = [];

        // Extrai wikilinks dos fatos que já foram encontrados pelo SQLite
        for (const fact of matchedFacts) {
            const links = this.extractWikiLinks(fact);
            for (const l of links) {
                if (!visited.has(l)) {
                    linksToResolve.push({ name: l, depth: 1 });
                }
            }
        }

        // Também pesquisa no próprio texto de consulta do usuário se ele menciona algum tópico do vault
        const queryLinks = this.extractWikiLinks(queryText);
        for (const l of queryLinks) {
            if (!visited.has(l)) {
                linksToResolve.push({ name: l, depth: 1 });
            }
        }

        const resolvedNotes = [];

        // Loop de travessia do grafo (BFS)
        while (linksToResolve.length > 0) {
            const current = linksToResolve.shift();
            if (visited.has(current.name)) continue;
            visited.add(current.name);

            // Procura arquivo de tópico correspondente
            const sanitized = this._sanitizeFilename(current.name);
            const topicPath = path.join(this.topicsDir, `${sanitized}.md`);

            try {
                const content = await fs.readFile(topicPath, 'utf8');
                resolvedNotes.push(`### Tópico Relacionado: [[${current.name}]]\n${content.trim()}`);

                // Se não excedeu profundidade, extrai e agenda novos links contidos nessa nota
                if (current.depth < maxDepth) {
                    const nestedLinks = this.extractWikiLinks(content);
                    for (const nl of nestedLinks) {
                        if (!visited.has(nl)) {
                            linksToResolve.push({ name: nl, depth: current.depth + 1 });
                        }
                    }
                }
            } catch (err) {
                // Tópico mencionado mas não possui nota física ainda, ignorar
            }
        }

        if (resolvedNotes.length === 0) return '';
        return `\n\n## 🕸️ GRAFO DE CONHECIMENTO ASSOCIADO (OBSIDIAN VAULT):\n` + resolvedNotes.join('\n\n');
    }
}

module.exports = new VaultService();
