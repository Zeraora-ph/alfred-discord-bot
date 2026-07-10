/**
 * Testes do rules-rag-service: valida o ranking por similaridade de cosseno,
 * filtros (minScore, topK, source) e o fallback por substring — tudo sem
 * depender do Ollama (embedText é mockado; cosineSimilarity é o real).
 */

// Mocks ANTES de requerer o serviço sob teste.
jest.mock('../../src/lib/rpg-db', () => ({
  getAllRuleChunks: jest.fn(),
  countRuleChunks: jest.fn(() => 3),
}));

jest.mock('../../src/services/embedding-service', () => {
  const actual = jest.requireActual('../../src/services/embedding-service');
  return { ...actual, embedText: jest.fn() };
});

const rpgDb = require('../../src/lib/rpg-db');
const embeddingService = require('../../src/services/embedding-service');
const rag = require('../../src/services/rules-rag-service');

const CHUNKS = [
  { id: 1, source: 'Livro do Jogador (D&D 5e)', page: 196, content: 'AGARRÃO quando você quer segurar uma criatura', embedding: [1, 0, 0] },
  { id: 2, source: 'Livro do Jogador (D&D 5e)', page: 290, content: 'APÊNDICE A: CONDIÇÕES alteram capacidades', embedding: [0.6, 0.8, 0] },
  { id: 3, source: 'Guia do Mestre (D&D 5e)',   page: 254, content: 'PERSEGUIÇÃO regras de fuga e caça', embedding: [0, 1, 0] },
];

describe('rules-rag-service.search', () => {
  beforeEach(() => {
    rag.invalidateCache();
    rpgDb.getAllRuleChunks.mockReturnValue(CHUNKS.map(c => ({ ...c })));
    embeddingService.embedText.mockResolvedValue([1, 0, 0]); // query aponta para o chunk 1
  });

  test('ordena por similaridade de cosseno (maior primeiro)', async () => {
    const hits = await rag.search('agarrar inimigo', { minScore: 0 });
    expect(hits[0].id).toBe(1);
    expect(hits[1].id).toBe(2);
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  test('descarta chunks abaixo do minScore', async () => {
    const hits = await rag.search('agarrar', { minScore: 0.35 });
    expect(hits.map(h => h.id)).toEqual([1, 2]); // chunk 3 (cosseno 0) fica de fora
  });

  test('respeita topK', async () => {
    const hits = await rag.search('agarrar', { minScore: 0, topK: 1 });
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe(1);
  });

  test('filtra por fonte (livro)', async () => {
    const hits = await rag.search('perseguição', { minScore: 0, source: 'Guia do Mestre (D&D 5e)' });
    expect(hits.map(h => h.id)).toEqual([3]);
    expect(hits.every(h => h.source === 'Guia do Mestre (D&D 5e)')).toBe(true);
  });

  test('fallback por substring quando a query não gera embedding', async () => {
    embeddingService.embedText.mockResolvedValue(null);
    const hits = await rag.search('AGARRÃO', { minScore: 0 });
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].content).toContain('AGARRÃO');
  });
});

describe('rules-rag-service.formatSources', () => {
  test('deduplica fonte+página preservando a ordem', () => {
    const out = rag.formatSources([
      { source: 'Livro do Jogador (D&D 5e)', page: 196 },
      { source: 'Livro do Jogador (D&D 5e)', page: 196 },
      { source: 'Guia do Mestre (D&D 5e)', page: 254 },
    ]);
    expect(out).toEqual([
      'Livro do Jogador (D&D 5e) — pág. 196',
      'Guia do Mestre (D&D 5e) — pág. 254',
    ]);
  });
});
