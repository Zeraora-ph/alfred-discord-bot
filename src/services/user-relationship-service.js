/**
 * User Relationship Service
 * Sistema de relacionamento adaptativo — o Alfred conhece cada pessoa,
 * lembra preferências, aprende o tom e personaliza as respostas com o tempo.
 *
 * Complementa o sistema de notas existente no fact-store (user_relationships).
 * Adiciona: affinityScore, preferências musicais, tom preferido, interação count.
 *
 * Persistência: Redis (perfil) + SQLite fact-store (notas de relacionamento)
 *
 * @module services/user-relationship-service
 */

const logger  = require('../lib/logger');
const redis   = require('../lib/redis-client');
const factStore = require('../lib/fact-store');

// ============================================
// Configuração
// ============================================

// Sem TTL no perfil — relacionamento é persistente
const PROFILE_KEY = (userId, guildId) => `rel:profile:${guildId}:${userId}`;

// Incrementos do affinityScore por tipo de interação
const AFFINITY_DELTA = {
    message:           1,
    music_request:     3,
    long_conversation: 5,
    creative_request:  2,
    abrupt_command:   -1,
    insult:           -5
};

// ============================================
// Perfil padrão
// ============================================

function defaultProfile(userId, guildId) {
    return {
        userId,
        guildId,
        nickname:          null,        // Apelido preferido aprendido
        firstSeen:         Date.now(),
        lastSeen:          Date.now(),
        interactionCount:  0,
        affinityScore:     10,          // Começa levemente positivo
        musicTaste:        [],          // Artistas/gêneros pedidos
        topicsOfInterest:  [],          // Tópicos recorrentes
        preferredTone:     'neutro',    // 'formal' | 'casual' | 'sarcastico'
        significantMoments: [],         // Frases marcantes salvas
        lastTopics:        []           // Últimos 5 assuntos discutidos
    };
}

// ============================================
// CRUD do perfil no Redis
// ============================================

/**
 * Carrega o perfil do usuário. Cria se não existir.
 *
 * @param {string} userId
 * @param {string} guildId
 * @returns {Promise<Object>}
 */
async function getProfile(userId, guildId) {
    const key = PROFILE_KEY(userId, guildId);
    try {
        const stored = await redis.get(key);
        if (stored) {
            const profile = JSON.parse(stored);
            // Garante que campos novos existam mesmo em perfis antigos
            return { ...defaultProfile(userId, guildId), ...profile };
        }
    } catch {
        // Sem Redis: retorna padrão em memória
    }
    return defaultProfile(userId, guildId);
}

/**
 * Salva o perfil do usuário no Redis (sem TTL — é persistente).
 *
 * @param {Object} profile
 * @returns {Promise<void>}
 */
async function saveProfile(profile) {
    const key = PROFILE_KEY(profile.userId, profile.guildId);
    try {
        await redis.set(key, JSON.stringify(profile));
    } catch (err) {
        logger.warn('[UserRelationship] Erro ao salvar perfil:', err.message);
    }
}

// ============================================
// Atualização de relacionamento
// ============================================

/**
 * Atualiza o affinityScore e contadores após uma interação.
 *
 * @param {string} userId
 * @param {string} guildId
 * @param {'message'|'music_request'|'long_conversation'|'creative_request'|'abrupt_command'|'insult'} type
 * @returns {Promise<Object>} Perfil atualizado
 */
async function updateAfterInteraction(userId, guildId, type = 'message') {
    const profile = await getProfile(userId, guildId);
    const delta = AFFINITY_DELTA[type] ?? 1;

    profile.affinityScore = Math.max(0, Math.min(100, profile.affinityScore + delta));
    profile.interactionCount++;
    profile.lastSeen = Date.now();

    await saveProfile(profile);
    logger.debug(`[UserRelationship] ${userId} | score: ${profile.affinityScore} | tipo: ${type}`);
    return profile;
}

/**
 * Registra gosto musical do usuário.
 *
 * @param {string} userId
 * @param {string} guildId
 * @param {string} artistOrGenre
 * @returns {Promise<void>}
 */
async function addMusicTaste(userId, guildId, artistOrGenre) {
    if (!artistOrGenre) return;
    const profile = await getProfile(userId, guildId);

    const normalized = artistOrGenre.trim().toLowerCase();
    if (!profile.musicTaste.includes(normalized)) {
        profile.musicTaste.unshift(normalized);
        profile.musicTaste = profile.musicTaste.slice(0, 20); // Máximo 20
    }

    await saveProfile(profile);
    await updateAfterInteraction(userId, guildId, 'music_request');
}

/**
 * Registra um tópico de interesse.
 *
 * @param {string} userId
 * @param {string} guildId
 * @param {string} topic
 * @returns {Promise<void>}
 */
async function addTopicOfInterest(userId, guildId, topic) {
    if (!topic) return;
    const profile = await getProfile(userId, guildId);

    // Atualiza lastTopics
    profile.lastTopics.unshift(topic);
    profile.lastTopics = profile.lastTopics.slice(0, 5);

    // Atualiza topicsOfInterest (conta frequência implicitamente por posição)
    if (!profile.topicsOfInterest.includes(topic)) {
        profile.topicsOfInterest.unshift(topic);
        profile.topicsOfInterest = profile.topicsOfInterest.slice(0, 15);
    }

    await saveProfile(profile);
}

/**
 * Salva um momento marcante do usuário.
 *
 * @param {string} userId
 * @param {string} guildId
 * @param {string} moment
 * @returns {Promise<void>}
 */
async function addSignificantMoment(userId, guildId, moment) {
    if (!moment) return;
    const profile = await getProfile(userId, guildId);

    profile.significantMoments.unshift({ text: moment, ts: Date.now() });
    profile.significantMoments = profile.significantMoments.slice(0, 10);

    await saveProfile(profile);
}

// ============================================
// Aprendizado via LLM
// ============================================

/**
 * Extrai apelido, tom preferido e interesses de uma conversa.
 * Chamado após conversas longas (>5 trocas).
 *
 * @param {string} userId
 * @param {string} guildId
 * @param {string} username
 * @param {{ role: string, content: string }[]} messages
 * @returns {Promise<void>}
 */
async function learnFromConversation(userId, guildId, username, messages) {
    if (!messages || messages.length < 4) return;

    try {
        const aiClient = require('../lib/ai-client');
        const profile  = await getProfile(userId, guildId);

        const conversationText = messages
            .slice(-10) // Últimas 10 trocas
            .map(m => `${m.role === 'user' ? username : 'Alfred'}: ${m.content}`)
            .join('\n');

        const extractionMessages = [
            {
                role: 'system',
                content: `Você é um analisador de estilo de comunicação. A partir da conversa abaixo, responda em JSON com este formato exato:
{
  "nickname": "apelido usado ou null",
  "preferredTone": "formal | casual | sarcastico | neutro",
  "topics": ["tópico1", "tópico2"],
  "significantMoment": "frase ou evento marcante, ou null"
}
Responda APENAS com o JSON, sem texto extra.`
            },
            { role: 'user', content: conversationText }
        ];

        const response = await aiClient.chat(extractionMessages, { maxTokens: 200 });
        const raw = response.choices?.[0]?.message?.content || '{}';

        let extracted;
        try {
            extracted = JSON.parse(raw.replace(/```json\n?|\n?```/g, '').trim());
        } catch {
            logger.debug('[UserRelationship] JSON de extração inválido — ignorando');
            return;
        }

        let changed = false;

        if (extracted.nickname && !profile.nickname) {
            profile.nickname = extracted.nickname;
            changed = true;
        }

        if (extracted.preferredTone && extracted.preferredTone !== 'neutro') {
            profile.preferredTone = extracted.preferredTone;
            changed = true;
        }

        if (Array.isArray(extracted.topics)) {
            for (const topic of extracted.topics) {
                if (topic && !profile.topicsOfInterest.includes(topic)) {
                    profile.topicsOfInterest.unshift(topic);
                    changed = true;
                }
            }
            profile.topicsOfInterest = profile.topicsOfInterest.slice(0, 15);
        }

        if (extracted.significantMoment) {
            profile.significantMoments.unshift({ text: extracted.significantMoment, ts: Date.now() });
            profile.significantMoments = profile.significantMoments.slice(0, 10);
            changed = true;
        }

        if (changed) {
            await saveProfile(profile);
            logger.info(`[UserRelationship] Perfil atualizado para ${username}: tom=${profile.preferredTone}, nick=${profile.nickname}`);
        }
    } catch (err) {
        logger.warn('[UserRelationship] Erro ao aprender da conversa:', err.message);
    }
}

// ============================================
// Contexto de personalidade para o Prompt
// ============================================

/**
 * Gera uma string de contexto de personalidade para injetar no system prompt do Alfred.
 *
 * O tom muda conforme o affinityScore:
 *  0-30  → neutro/formal
 *  31-70 → casual, usa apelido, referencia conversas
 *  71-100 → muito casual, piadas internas, mais personalidade
 *
 * @param {string} userId
 * @param {string} guildId
 * @param {string} fallbackUsername
 * @returns {Promise<string>}
 */
async function getPersonalityContext(userId, guildId, fallbackUsername = 'usuário') {
    try {
        const profile = await getProfile(userId, guildId);
        const notes   = factStore.getUserRelationship(guildId, userId, 5);
        const score   = profile.affinityScore;
        const name    = profile.nickname || fallbackUsername;

        let lines = [];

        // Nível de afinidade
        if (score <= 30) {
            lines.push(`Você ainda está conhecendo ${name}. Seja educado e neutro, não presuma intimidade.`);
        } else if (score <= 70) {
            lines.push(`Você conhece bem ${name}. Use o nome dele/dela naturalmente, seja mais casual e direto.`);
        } else {
            lines.push(`Você tem alta afinidade com ${name}. Pode ser descontraído, usar humor quando apropriado e referenciar conversas passadas.`);
        }

        // Apelido
        if (profile.nickname && profile.nickname !== fallbackUsername) {
            lines.push(`O apelido preferido é "${profile.nickname}".`);
        }

        // Tom preferido
        if (profile.preferredTone && profile.preferredTone !== 'neutro') {
            const toneDesc = {
                formal:     'Este usuário prefere um tom mais formal.',
                casual:     'Este usuário é casual e descontraído.',
                sarcastico: 'Este usuário aprecia sarcasmo e humor ácido — use com moderação.'
            };
            lines.push(toneDesc[profile.preferredTone] || '');
        }

        // Gostos musicais
        if (profile.musicTaste.length > 0) {
            lines.push(`Gostos musicais conhecidos: ${profile.musicTaste.slice(0, 5).join(', ')}.`);
        }

        // Interesses
        if (profile.topicsOfInterest.length > 0) {
            lines.push(`Tópicos de interesse: ${profile.topicsOfInterest.slice(0, 5).join(', ')}.`);
        }

        // Notas de relacionamento do fact-store
        if (notes?.length > 0) {
            const formattedNotes = notes.map(n => `- ${n.note}`).join('\n');
            lines.push(`\nObservações sobre ${name}:\n${formattedNotes}`);
        }

        // Momentos marcantes
        if (profile.significantMoments.length > 0) {
            const moments = profile.significantMoments.slice(0, 2).map(m => `"${m.text}"`).join(', ');
            lines.push(`Momentos marcantes: ${moments}.`);
        }

        return lines.filter(Boolean).join('\n');
    } catch (err) {
        logger.warn('[UserRelationship] Erro ao gerar contexto de personalidade:', err.message);
        return '';
    }
}

// ============================================
// Stats e utilitários
// ============================================

/**
 * Retorna um resumo legível do relacionamento com um usuário.
 *
 * @param {string} userId
 * @param {string} guildId
 * @returns {Promise<Object>}
 */
async function getRelationshipSummary(userId, guildId) {
    const profile = await getProfile(userId, guildId);
    return {
        score:         profile.affinityScore,
        interactions:  profile.interactionCount,
        nickname:      profile.nickname,
        tone:          profile.preferredTone,
        musicTaste:    profile.musicTaste.slice(0, 5),
        topics:        profile.topicsOfInterest.slice(0, 5),
        firstSeen:     new Date(profile.firstSeen).toLocaleDateString('pt-BR'),
        lastSeen:      new Date(profile.lastSeen).toLocaleDateString('pt-BR')
    };
}

// ============================================
// Exports
// ============================================

module.exports = {
    getProfile,
    updateAfterInteraction,
    addMusicTaste,
    addTopicOfInterest,
    addSignificantMoment,
    learnFromConversation,
    getPersonalityContext,
    getRelationshipSummary
};
