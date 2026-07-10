#!/usr/bin/env node
/**
 * Ingestão de livro de regras para RAG (Retrieval-Augmented Generation).
 *
 * Pipeline: PDF → texto por página (pdf-parse) → chunks → embeddings (Ollama
 * nomic-embed-text) → tabela rpg_rules_chunks (memory.db). Cada chunk fica
 * marcado com a página de origem para que o Alfred possa CITAR a página ao
 * responder — em vez de alucinar regra.
 *
 * Idempotente por `source`: limpa os chunks daquela fonte antes de reinserir,
 * então dá para rodar de novo sem duplicar.
 *
 * IMPORTANTE: os PDFs e o memory.db resultante NÃO vão pro git (direito autoral).
 * Rode este script localmente/na VM para popular o índice.
 *
 * Uso:
 *   node scripts/ingest-rulebook.js                       # ingere os 2 livros padrão
 *   node scripts/ingest-rulebook.js <caminho.pdf> "<Fonte>"
 *   npm run ingest:rules
 *
 * @module scripts/ingest-rulebook
 */

const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const rpgDb = require('../src/lib/rpg-db');
const embeddingService = require('../src/services/embedding-service');

const CHUNK_CHARS   = 1500;  // ~430 tokens PT-BR; granularidade boa p/ retrieval
const MIN_CHUNK_LEN = 60;    // descarta migalhas (número de página solto, etc.)
const CONCURRENCY   = 4;     // Ollama serializa na GPU, mas pipeline ajuda um pouco

const DEFAULT_BOOKS = [
  { file: 'docs/rulebooks/(D&D 5e) - Livro do jogador.pdf',            source: 'Livro do Jogador (D&D 5e)' },
  { file: 'docs/rulebooks/dd-5e-guia-do-mestre-biblioteca-elfica.pdf', source: 'Guia do Mestre (D&D 5e)' },
];

// ------------------------------------------------------------------
// Extração de texto por página
// ------------------------------------------------------------------

/**
 * Extrai o texto de um PDF preservando a divisão por página.
 * Usa o pagerender do pdf-parse para capturar cada página separadamente.
 * @returns {Promise<string[]>} texto de cada página (índice 0 = página 1)
 */
async function extractPages(buffer) {
  const pages = [];
  const renderPage = (pageData) => {
    return pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false })
      .then((tc) => {
        let text = '';
        let lastY;
        for (const item of tc.items) {
          if (lastY === item.transform[5] || lastY === undefined) {
            text += item.str;
          } else {
            text += '\n' + item.str;
          }
          lastY = item.transform[5];
        }
        pages.push(text);
        return text; // pdf-parse também concatena isto em data.text (não usamos)
      });
  };
  await pdfParse(buffer, { pagerender: renderPage });
  return pages;
}

/** Normaliza o texto de uma página (form-feed, linhas em branco excessivas). */
function cleanPage(text) {
  return String(text || '')
    .replace(/\f/g, '\n')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Um chunk vale a pena? (tem conteúdo real, não só número/pontuação) */
function isMeaningful(chunk) {
  if (!chunk || chunk.trim().length < MIN_CHUNK_LEN) return false;
  const letters = (chunk.match(/[a-zà-ú]/gi) || []).length;
  return letters >= 30;
}

// ------------------------------------------------------------------
// Embedding com pool de concorrência + retry
// ------------------------------------------------------------------

async function embedWithRetry(text, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const v = await embeddingService.embedText(text);
    if (Array.isArray(v) && v.length) return v;
    await new Promise(r => setTimeout(r, 300 * (i + 1)));
  }
  return null;
}

async function mapPool(items, concurrency, fn) {
  let idx = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (idx < items.length) {
      const i = idx++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

// ------------------------------------------------------------------
// Ingestão de um livro
// ------------------------------------------------------------------

async function ingestBook(filePath, source) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  if (!fs.existsSync(abs)) {
    console.error(`✗ Arquivo não encontrado: ${abs}`);
    return { source, ok: false, inserted: 0 };
  }

  console.log(`\n▶ Ingerindo "${source}"\n  ${abs}`);
  const t0 = Date.now();

  const buffer = fs.readFileSync(abs);
  const pages = await extractPages(buffer);
  console.log(`  ${pages.length} páginas extraídas`);

  // Monta a lista de chunks com a página de origem
  const chunks = [];
  pages.forEach((raw, i) => {
    const clean = cleanPage(raw);
    if (!clean) return;
    for (const c of embeddingService.chunkText(clean, CHUNK_CHARS)) {
      if (isMeaningful(c)) chunks.push({ page: i + 1, content: c.trim() });
    }
  });
  console.log(`  ${chunks.length} chunks a embedar`);

  // Idempotência: zera a fonte antes de reinserir
  const removed = rpgDb.clearRuleChunks(source);
  if (removed) console.log(`  (removidos ${removed} chunks antigos desta fonte)`);

  let inserted = 0;
  let failed = 0;
  await mapPool(chunks, CONCURRENCY, async (chunk) => {
    const embedding = await embedWithRetry(chunk.content);
    if (!embedding) failed++;
    rpgDb.insertRuleChunk({ source, page: chunk.page, content: chunk.content, embedding });
    inserted++;
    if (inserted % 100 === 0) {
      const pct = ((inserted / chunks.length) * 100).toFixed(0);
      console.log(`  ...${inserted}/${chunks.length} (${pct}%)`);
    }
  });

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`✓ "${source}": ${inserted} chunks inseridos${failed ? ` (${failed} sem embedding)` : ''} em ${secs}s`);
  return { source, ok: true, inserted, failed };
}

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  let books;
  if (args[0]) {
    const source = args[1] || path.basename(args[0]).replace(/\.pdf$/i, '');
    books = [{ file: args[0], source }];
  } else {
    books = DEFAULT_BOOKS;
  }

  console.log('=== Ingestão de livros de regras (RAG) ===');
  const results = [];
  for (const b of books) {
    results.push(await ingestBook(b.file, b.source));
  }

  console.log('\n=== Resumo ===');
  for (const r of results) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.source}: ${r.inserted} chunks`);
  }
  console.log(`  Total no índice: ${rpgDb.countRuleChunks()} chunks`);
  process.exit(0);
}

main().catch((err) => {
  console.error('ERRO FATAL na ingestão:', err);
  process.exit(1);
});
