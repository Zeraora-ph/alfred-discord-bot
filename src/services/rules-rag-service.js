/**
 * Rules RAG Service
 * Consulta semântica aos livros de regras de RPG indexados em `rpg_rules_chunks`.
 *
 * A ingestão (scripts/ingest-rulebook.js) já embedou cada trecho UMA vez e guardou
 * o vetor no banco. Aqui só embedamos a PERGUNTA e comparamos por cosseno contra os
 * vetores guardados — nada é reembedado por consulta.
 *
 * Dois modos:
 *   - search()          → retorna os trechos mais relevantes (com página) crus.
 *   - answerQuestion()  → sintetiza uma resposta com a IA, ancorada SÓ nos trechos
 *                         e citando as páginas (usado pelo /regra).
 *
 * @module services/rules-rag-service
 */

const rpgDb = require('../lib/rpg-db');
const embeddingService = require('./embedding-service');
const aiClient = require('../lib/ai-client');
const logger = require('../lib/logger');

// Índice carregado sob demanda e mantido em memória (chunks + vetores).
let _index = null;

const RAG_SYSTEM_PROMPT = `Você é o Alfred respondendo dúvidas de regras de RPG (D&D 5e) em português do Brasil.

REGRAS DA RESPOSTA:
- Responda usando SOMENTE as informações dos trechos do livro fornecidos. Não invente regra.
- Se os trechos não contiverem a resposta, diga com honestidade que não achou essa regra nos trechos e sugira reformular.
- Cite a página entre parênteses ao afirmar algo, ex: "(pág. 195)".
- Seja direto e didático. Use listas ou passos quando ajudar.
- Não repita a pergunta nem faça preâmbulo. Vá direto ao ponto.`;

/**
 * Carrega (ou recarrega) o índice de chunks com embedding em memória.
 * @param {boolean} force
 */
function _loadIndex(force = false) {
  if (_index && !force) return _index;
  const all = rpgDb.getAllRuleChunks();
  const chunks = all.filter(c => Array.isArray(c.embedding) && c.embedding.length);
  _index = { chunks, loadedAt: Date.now() };
  logger.info(`[RulesRAG] Índice carregado: ${chunks.length} chunks com embedding`);
  return _index;
}

/** Invalida o cache em memória (chamar após reingestão). */
function invalidateCache() {
  _index = null;
}

/** Há algum livro indexado? */
function isReady() {
  return rpgDb.countRuleChunks() > 0;
}

/** Estatísticas por fonte, para /regra status e mensagens de ajuda. */
function stats() {
  const rows = rpgDb.getAllRuleChunks();
  const bySource = {};
  for (const r of rows) bySource[r.source] = (bySource[r.source] || 0) + 1;
  return { total: rows.length, bySource };
}

/**
 * Busca os trechos mais relevantes para uma pergunta.
 * @param {string} query
 * @param {{ topK?: number, source?: string|null, minScore?: number }} [opts]
 * @returns {Promise<Array<{ id, source, page, section, content, score }>>}
 */
async function search(query, { topK = 5, source = null, minScore = 0.35 } = {}) {
  const idx = _loadIndex();
  let chunks = idx.chunks;
  if (source) chunks = chunks.filter(c => c.source === source);
  if (!chunks.length) return [];

  const queryVec = await embeddingService.embedText(query);

  // Fallback sem embedding: busca por substring simples.
  if (!queryVec) {
    const q = query.toLowerCase();
    return chunks
      .filter(c => c.content.toLowerCase().includes(q))
      .slice(0, topK)
      .map(c => ({ ...c, score: 0.4 }));
  }

  const scored = [];
  for (const c of chunks) {
    const score = embeddingService.cosineSimilarity(queryVec, c.embedding);
    if (score >= minScore) scored.push({ ...c, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

/** Formata "Fonte — pág. N" únicos, preservando a ordem de relevância. */
function formatSources(hits) {
  const seen = new Set();
  const out = [];
  for (const h of hits) {
    const key = `${h.source}|${h.page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(`${h.source} — pág. ${h.page}`);
  }
  return out;
}

/**
 * Responde uma pergunta de regra sintetizando os trechos recuperados.
 * @param {string} query
 * @param {{ topK?: number, source?: string|null }} [opts]
 * @returns {Promise<{ success: boolean, answer: string|null, sources: string[], message?: string }>}
 */
async function answerQuestion(query, opts = {}) {
  if (!isReady()) {
    return { success: false, answer: null, sources: [], message: 'Nenhum livro de regras foi indexado ainda. Rode `npm run ingest:rules`.' };
  }

  const hits = await search(query, { topK: opts.topK || 5, source: opts.source || null });
  if (!hits.length) {
    return { success: false, answer: null, sources: [], message: 'Não encontrei nada sobre isso nos livros indexados. Tente reformular a pergunta.' };
  }

  const context = hits
    .map((h, i) => `[Trecho ${i + 1} — ${h.source}, pág. ${h.page}]\n${h.content}`)
    .join('\n\n---\n\n');

  const messages = [
    { role: 'system', content: RAG_SYSTEM_PROMPT },
    { role: 'user', content: `PERGUNTA: ${query}\n\nTRECHOS DO LIVRO DE REGRAS:\n${context}` }
  ];

  try {
    const response = await aiClient.chat(messages, { temperature: 0.2, maxTokens: 700 });
    const answer = (response.choices?.[0]?.message?.content || '').trim();
    if (!answer) {
      return { success: false, answer: null, sources: formatSources(hits), message: 'A IA não retornou resposta.' };
    }
    return { success: true, answer, sources: formatSources(hits), hits };
  } catch (err) {
    logger.error(`[RulesRAG] Erro ao sintetizar resposta: ${err.message}`);
    return { success: false, answer: null, sources: formatSources(hits), message: `Erro na IA: ${err.message}` };
  }
}

module.exports = {
  search,
  answerQuestion,
  formatSources,
  invalidateCache,
  isReady,
  stats,
};
