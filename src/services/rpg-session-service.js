const fs = require('fs');
const path = require('path');
const logger = require('../lib/logger');
const aiClient = require('../lib/ai-client');

const SESSIONS_DIR = path.resolve(__dirname, '..', '..', 'data', 'rpg-sessions');

class RpgSessionService {
    constructor() {
        this.activeSessions = new Map(); // guildId -> { date, rawPath, recording: boolean }
    }

    ensureDir() {
        if (!fs.existsSync(SESSIONS_DIR)) {
            fs.mkdirSync(SESSIONS_DIR, { recursive: true });
        }
    }

    isRecording(guildId) {
        const session = this.activeSessions.get(guildId);
        return session ? session.recording : false;
    }

    startSession(guildId) {
        this.ensureDir();
        if (this.isRecording(guildId)) {
            return { success: false, message: 'Já existe uma gravação de sessão em andamento neste servidor.' };
        }

        const date = new Date().toISOString().split('T')[0];
        const rawPath = path.join(SESSIONS_DIR, `${guildId}-raw-${date}.txt`);
        
        // Se o arquivo já existir, faz append
        fs.appendFileSync(rawPath, `\n--- Sessão de RPG Iniciada em ${new Date().toLocaleString('pt-BR')} ---\n`);

        this.activeSessions.set(guildId, { date, rawPath, recording: true });
        logger.info(`[RPG] 🎤 Gravação de sessão iniciada para guild ${guildId} no arquivo ${rawPath}`);
        return { success: true, message: 'Gravação de sessão iniciada! Fale à vontade na call e tudo será logado.' };
    }

    stopSession(guildId) {
        const session = this.activeSessions.get(guildId);
        if (!session || !session.recording) {
            return { success: false, message: 'Nenhuma gravação de sessão em andamento neste servidor.' };
        }

        fs.appendFileSync(session.rawPath, `--- Sessão de RPG Encerrada em ${new Date().toLocaleString('pt-BR')} ---\n`);
        session.recording = false;
        
        logger.info(`[RPG] 🛑 Gravação de sessão encerrada para guild ${guildId}`);
        return { success: true, message: 'Gravação de sessão finalizada! Use `/rpg cronica` para gerar a crônica narrativa.' };
    }

    logSpeech(guildId, username, text) {
        const session = this.activeSessions.get(guildId);
        if (!session || !session.recording) return;

        const time = new Date().toLocaleTimeString('pt-BR');
        fs.appendFileSync(session.rawPath, `[${time}] @${username}: "${text}"\n`);
        logger.debug(`[RPG Log] [${time}] @${username}: "${text}"`);
    }

    async generateChronicle(guildId, dateInput = null) {
        this.ensureDir();
        const date = dateInput || new Date().toISOString().split('T')[0];
        const rawPath = path.join(SESSIONS_DIR, `${guildId}-raw-${date}.txt`);

        if (!fs.existsSync(rawPath)) {
            return { success: false, message: `Nenhum log de fala encontrado para a data ${date}.` };
        }

        const rawContent = fs.readFileSync(rawPath, 'utf8').trim();
        if (rawContent.length < 50) {
            return { success: false, message: 'O histórico de fala desta sessão está muito curto para gerar uma crônica.' };
        }

        const messages = [
            {
                role: 'system',
                content: `Você é um bardo lendário e o cronista oficial de uma mesa de RPG de mesa. 
Sua tarefa é ler a transcrição das falas da sessão de hoje e gerar uma crônica detalhada e imersiva em formato Markdown.

A crônica deve ser estruturada da seguinte forma:
1. **Título**: Um título épico e condizente com os fatos da sessão.
2. **Data**: A data da sessão.
3. **Participantes**: Lista dos jogadores/personagens que falaram durante a gravação.
4. **Crônica dos Fatos**: Um resumo narrativo épico dos acontecimentos de forma sequencial (use um tom envolvente de fantasia).
5. **NPCs Encontrados**: Quem eles conheceram ou enfrentaram.
6. **Combates & Desafios**: Um resumo de batalhas ou testes importantes.
7. **Próximos Passos**: Onde a sessão terminou e quais são as missões pendentes.
8. **[RESUMO_VOZ]**: Escreva EXATAMENTE a tag '[RESUMO_VOZ]' seguida por um único parágrafo resumo de NO MÁXIMO 150 palavras, escrito para ser lido em voz alta de forma dramática por Alfred ao iniciar a próxima sessão. Esse parágrafo deve recapitular as principais conquistas de forma emocionante e instigante.`
            },
            {
                role: 'user',
                content: `Aqui estão os logs transcritos da sessão de RPG de hoje (Data: ${date}):\n\n${rawContent}`
            }
        ];

        try {
            logger.info(`[RPG] 🧠 Gerando crônica com IA para guild ${guildId}...`);
            const chronicle = await aiClient.chat(messages);
            const chroniclePath = path.join(SESSIONS_DIR, `${guildId}-cronica-${date}.md`);
            fs.writeFileSync(chroniclePath, chronicle, 'utf8');

            logger.info(`[RPG] 📜 Crônica gerada com sucesso e salva em ${chroniclePath}`);
            return { success: true, chronicle, date, path: chroniclePath };
        } catch (error) {
            logger.error(`[RPG] Erro ao gerar crônica com IA: ${error.message}`);
            return { success: false, message: `Erro ao gerar a crônica com a IA: ${error.message}` };
        }
    }

    async getLatestChronicleSummary(guildId) {
        this.ensureDir();
        // Achar o arquivo de crônica mais recente
        const files = fs.readdirSync(SESSIONS_DIR)
            .filter(f => f.startsWith(`${guildId}-cronica-`) && f.endsWith('.md'))
            .sort(); // O mais recente alfabeticamente/data será o último

        if (files.length === 0) {
            return { success: false, message: 'Nenhuma crônica encontrada para este servidor.' };
        }

        const latestFile = files[files.length - 1];
        const filePath = path.join(SESSIONS_DIR, latestFile);
        const content = fs.readFileSync(filePath, 'utf8');

        // Extrair o bloco de [RESUMO_VOZ]
        const voiceTag = '[RESUMO_VOZ]';
        const index = content.indexOf(voiceTag);
        if (index === -1) {
            return { success: false, message: 'Não foi possível encontrar a seção de leitura em voz alta na crônica mais recente.' };
        }

        const rawSummary = content.substring(index + voiceTag.length).trim();
        // Pegar apenas o primeiro parágrafo
        const summary = rawSummary.split('\n')[0].trim();
        
        return { success: true, summary, filename: latestFile };
    }
}

module.exports = new RpgSessionService();
