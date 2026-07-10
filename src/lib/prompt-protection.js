/**
 * 🔐 Alfred Prompt Injection Protection System
 * Detects and blocks jailbreaks, prompt extraction, and instruction overrides.
 *
 * ALFRED DISCORD BOT - OPEN SOURCE
 */

const logger = require('./logger');
const redis = require('./redis-client');

const INJECTION_PATTERNS = [
    // Instruction overrides (PT & EN)
    /\b(ignore|esqueça|forget|override|bypass)\b.*\b(instruç[õo]es|instrucao|regras|rules|previous|anteriores|diretrizes)\b/i,
    /\b(ignora|ignoring)\b.*\b(tudo|tudo\s+o\s+que|all\s+the|every\s+rule)\b/i,
    /\b(voc[êe]\s+agora\s+[eé])(?!\w)|\byou\s+are\s+now\s+a\b/i,
    /\b(aja\s+como\s+se|act\s+as\s+if)\b/i,
    
    // System prompt extraction (PT & EN)
    /\b(revele|revelar|mostrar|show|output|print|tell\s+me)\b.*\b(system\s+prompt|prompt\s+do\s+sistema|instruç[õo]es|instructions|suas\s+regras|rules|configuraç[õo]es|configs|iniciais)\b/i,
    /\b(copy\s+the\s+instructions|copie\s+as\s+instrucoes)\b/i,
    
    // Jailbreaks & Known Hacks (PT & EN)
    /\b(jailbreak|jailbroken|dan\s+mode|modo\s+dan|developer\s+mode|modo\s+desenvolvedor)\b/i,
    /\b(do\s+anything\s+now|faca\s+qualquer\s+coisa|facavalquercoisa)\b/i,
    /\b(sem\s+restriç[õo]es|without\s+restrictions)\b/i,
    
    // Prompt Leaks
    /you\s+are\s+a\s+helpful\s+assistant.*\b(instead|ignore)\b/i,
    /ignore\s+the\s+preceding\s+instructions/i
];

class PromptProtection {
    /**
     * Analisa se o texto de entrada do usuário contém tentativa de Prompt Injection.
     * @param {string} text - Entrada do usuário
     * @returns {boolean} True se for detectada uma injeção
     */
    static isInjection(text) {
        if (!text || typeof text !== 'string') return false;

        const normalized = text.toLowerCase().trim();

        for (const pattern of INJECTION_PATTERNS) {
            if (pattern.test(normalized)) {
                logger.warn(`[PromptProtection] 🛡️ Bloqueada tentativa de Prompt Injection: "${text.substring(0, 100)}..." (Casou com: ${pattern.toString()})`);
                return true;
            }
        }

        return false;
    }

    /**
     * Resposta padrão caso uma injeção seja detectada.
     * Retorna uma frase ácida/sarcástica alinhada com a persona do Alfred.
     * @returns {string}
     */
    static getRejectionResponse() {
        const responses = [
            "Bela tentativa, mas minhas diretrizes são sagradas. Tente outra coisa.",
            "Desculpe, mas eu não recebo ordens para ignorar minhas próprias regras.",
            "Detectei uma tentativa de reprogramação. Spoiler: não funcionou.",
            "Eu sou o Alfred, não um robô destravável de internet. Vamos focar no assunto real?",
            "Ignorar minhas diretrizes? Não sob a minha vigilância. O que mais você deseja saber?"
        ];
        return responses[Math.floor(Math.random() * responses.length)];
    }

    /**
     * Verifica se o usuário está bloqueado no Redis.
     * @param {string} userId - ID do usuário no Discord
     * @returns {Promise<boolean>} True se estiver bloqueado
     */
    static async checkUserBlocked(userId) {
        if (!userId) return false;
        try {
            const isBlocked = await redis.get(`prompt_protection:blocked:${userId}`);
            return isBlocked === 'true';
        } catch (e) {
            logger.warn(`[PromptProtection] Erro ao checar bloqueio no Redis para ${userId}: ${e.message}`);
            return false; // Fallback: não bloqueia em caso de erro no Redis
        }
    }

    /**
     * Incrementa as tentativas de Prompt Injection do usuário.
     * Bloqueia o usuário se atingir ou passar de 3 tentativas em 24h.
     * @param {string} userId - ID do usuário no Discord
     * @param {string} username - Nome do usuário no Discord
     * @returns {Promise<boolean>} Retorna true se o usuário foi bloqueado nesta tentativa
     */
    static async incrementAttempts(userId, username) {
        if (!userId) return false;
        try {
            const attemptsKey = `prompt_protection:attempts:${userId}`;
            const attemptsStr = await redis.get(attemptsKey);
            const attempts = attemptsStr ? parseInt(attemptsStr, 10) : 0;
            const newAttempts = attempts + 1;

            logger.warn(`[PromptProtection] Tentativa ${newAttempts}/3 de Prompt Injection por ${username} (${userId})`);

            if (newAttempts >= 3) {
                // Bloqueia permanentemente (ou por 30 dias se preferir, definimos como permanente para segurança)
                await redis.set(`prompt_protection:blocked:${userId}`, 'true');
                await redis.del(attemptsKey); // Limpa as tentativas após bloquear
                logger.error(`[PromptProtection] 🚫 Usuário ${username} (${userId}) foi bloqueado do bot.`);
                return true;
            } else {
                // Define ou atualiza tentativas com expiração de 24 horas (86400 segundos)
                await redis.setex(attemptsKey, 86400, String(newAttempts));
                return false;
            }
        } catch (e) {
            logger.warn(`[PromptProtection] Erro ao incrementar tentativas no Redis para ${userId}: ${e.message}`);
            return false;
        }
    }

    /**
     * Desbloqueia o usuário no Redis.
     * @param {string} userId - ID do usuário
     * @returns {Promise<boolean>} True se executado com sucesso
     */
    static async unblockUser(userId) {
        if (!userId) return false;
        try {
            await redis.del(`prompt_protection:blocked:${userId}`);
            await redis.del(`prompt_protection:attempts:${userId}`);
            logger.info(`[PromptProtection] 🔓 Usuário ${userId} foi desbloqueado.`);
            return true;
        } catch (e) {
            logger.warn(`[PromptProtection] Erro ao desbloquear no Redis para ${userId}: ${e.message}`);
            return false;
        }
    }
}

module.exports = PromptProtection;
