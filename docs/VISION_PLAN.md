# Plano de Implementação — Reconhecimento de Imagens (Alfred Vision)

> **Status:** Planejado — não implementado ainda.
> **GPU:** RTX 5060 Ti 16GB (suporta llava:13b confortavelmente)
> **Criado em:** 2026-05-07

---

## 1. Arquitetura Proposta

### Pipeline principal

```
Discord Attachment (imagem)
        ↓
[image-handler.js] — detecta imagem na mensagem
        ↓
[vision-service.js] — download buffer → base64
        ↓
[Ollama LLaVA 13B] ← modelo local, sem custo de API
        ↓
Resposta contextual integrada com memória do usuário
        ↓
Discord reply
```

### Modelos e fallback

| Prioridade | Modelo                  | Onde roda   | Custo   | Qualidade |
|------------|-------------------------|-------------|---------|-----------|
| 1          | `llava:13b` (via Ollama) | RTX 5060 Ti | Gratuito | ★★★★☆    |
| 2          | `llava:7b` (via Ollama)  | RTX 5060 Ti | Gratuito | ★★★☆☆    |
| 3          | GPT-4o Vision (API)      | Cloud        | Pago     | ★★★★★    |

**Recomendação:** `llava:13b` — cabe em ~9GB de VRAM na quantização Q4, deixando ~7GB livres para outros modelos.

```bash
# Pull do modelo (rodar uma vez)
ollama pull llava:13b
```

### Concorrência
- Máximo **1 request de visão por vez** (análise de imagem é pesada na GPU)
- Fila simples com timeout de 30s por request
- Se a fila estiver cheia: responde "Analisando outra imagem, aguarde um momento"

---

## 2. Features Planejadas

### 2.1 Análise por trigger de voz/texto

**Trigger:** usuário envia uma imagem e diz "Alfred, o que é isso?" / "Alfred, descreve essa imagem"

**Comportamento:**
- Alfred detecta que a última mensagem do canal contém um attachment de imagem
- Envia para LLaVA com o prompt: "Descreva esta imagem em português de forma natural e detalhada"
- Responde como Alfred responderia — com personalidade, não como robô

---

### 2.2 Comando `/analyze`

**Descrição:** Análise completa de uma imagem anexada.

```
/analyze [imagem?]
```

- Se imagem for fornecida: analisa ela
- Se não: analisa a última imagem enviada no canal (últimas 10 mensagens)
- Retorna: descrição, elementos identificados, contexto provável, sentimento

---

### 2.3 OCR — Extração de Texto (`/ocr`)

**Descrição:** Extrai e formata texto de imagens (screenshots, placas, documentos, memes com texto).

```
/ocr [imagem?]
```

**Prompt para LLaVA:**
```
Extraia todo o texto visível nesta imagem. 
Mantenha a formatação original quando possível.
Se não houver texto, responda "Nenhum texto encontrado".
```

---

### 2.4 Identificação de Memes (`/meme`)

**Descrição:** Identifica o meme, explica o contexto e a piada.

```
/meme [imagem?]
```

**Prompt para LLaVA:**
```
Esta imagem é um meme? Se sim:
1. Qual é o nome/template do meme?
2. Qual é o contexto/origem?
3. Qual é a piada ou mensagem?
Responda de forma descontraída, como alguém que entende de memes.
```

---

### 2.5 Moderação Automática

**Descrição:** Verifica imagens antes de serem vistas por todos, detectando conteúdo inapropriado.

**Ativação:** Opcional por servidor (comando `/setmoderation on/off`)

**Fluxo:**
1. Imagem enviada no canal → Alfred analisa silenciosamente (em segundo plano)
2. Se detectar conteúdo problemático → deleta a mensagem e avisa o usuário no privado
3. Log para o canal de moderação configurado

**Categorias verificadas:**
- Conteúdo adulto explícito
- Violência gráfica
- Informações pessoais expostas (CPF, cartão de crédito visível)
- Spam visual

---

### 2.6 Integração com Memória de Usuário

**Comportamento:**
- Alfred pode "lembrar" de imagens marcantes enviadas por um usuário
- Exemplo: usuário envia foto do setup → Alfred guarda "Pedro tem um setup com RTX 5060 Ti"
- Essa memória é injetada nas próximas conversas via `memory-manager.js`

**Implementação:** Após análise, chamar `memoryManager.storeEpisode(userId, descricao)` para imagens marcantes.

---

## 3. Comandos de Voz Novos

Integração com o sistema Whisper já existente:

| Frase dita                       | Ação                                    |
|-----------------------------------|-----------------------------------------|
| "Alfred, o que é isso?"           | Analisa última imagem do canal          |
| "Alfred, descreve essa imagem"    | Análise completa                        |
| "Alfred, lê esse texto"           | OCR da última imagem                   |
| "Alfred, esse meme é sobre o quê?"| Identificação de meme                  |

**Como funciona:**
1. Whisper transcreve o áudio
2. `command-router.js` detecta keywords de visão ("o que é isso", "descreva", "lê esse")
3. Busca a última imagem nos attachments do canal (últimas 5 mensagens)
4. Chama `vision-service.js`

---

## 4. Modelo Detalhado — RTX 5060 Ti 16GB

### Por que `llava:13b`?

| Aspecto          | Detalhe                                              |
|------------------|------------------------------------------------------|
| VRAM necessária  | ~9GB em Q4_K_M                                       |
| VRAM disponível  | 16GB — sobram ~7GB para outros modelos simultâneos   |
| Tempo de resposta| ~3-8s por imagem (aceitável para Discord)            |
| Qualidade        | Muito boa para descrição, OCR e identificação geral  |
| Idioma           | Responde bem em português com instrução no prompt    |

### Config Ollama recomendada

```bash
# Baixar o modelo
ollama pull llava:13b

# Testar
ollama run llava:13b "Descreva esta imagem em português" --image /caminho/imagem.jpg

# Variáveis de ambiente a adicionar no .env
OLLAMA_VISION_MODEL=llava:13b
OLLAMA_VISION_CONCURRENCY=1
OLLAMA_VISION_TIMEOUT=30000
```

---

## 5. Passos de Implementação (em ordem)

### Passo 1 — `src/services/vision-service.js`
- Integração com Ollama LLaVA via API `/api/generate`
- Suporte a imagem por URL e por buffer/base64
- Fallback para GPT-4o Vision
- Controle de concorrência (fila simples)
- Cache de resultados no Redis (TTL 1h) para evitar reprocessar a mesma imagem

### Passo 2 — Handler de attachments no `messageCreate`
- Detectar imagens em `message.attachments`
- Verificar se é trigger de análise (menção ao Alfred + keyword)
- Verificar se moderação automática está ativa
- Chamar `vision-service.js`

### Passo 3 — Comando `/analyze`
- Criar `src/commands/slash/analyze.js`
- Aceitar attachment opcional, buscar última imagem se não fornecida
- Embed com resultado (título, descrição, thumbnail da imagem)

### Passo 4 — Comando `/ocr` e `/meme`
- Criar `src/commands/slash/ocr.js`
- Criar `src/commands/slash/meme.js`
- Prompts específicos para cada caso
- Formatar output adequadamente (bloco de código para OCR)

### Passo 5 — Trigger por voz
- Atualizar `src/lib/voice-listener.js`: após Whisper transcrever, detectar keywords de visão
- Buscar última imagem no histórico do canal
- Executar análise e sintetizar resposta via TTS

### Passo 6 — Moderação automática
- Criar `src/moderation/image-moderation.js`
- Comando `/setmoderation [on|off] [canal-log]`
- Integrar com `messageCreate` (verificação assíncrona, não bloqueia)
- Integrar com `user-relationship-service.js` (nota de relacionamento se moderado)

### Passo 7 — Memória de imagens
- Após análise em qualquer contexto, chamar `memoryManager.storeEpisode()`
- Adicionar campo `lastImageDescription` no perfil do `user-relationship-service.js`

---

## 6. Estrutura de Arquivos Final

```
src/
├── services/
│   └── vision-service.js          ← CRIAR (Passo 1)
├── commands/
│   └── slash/
│       ├── analyze.js             ← CRIAR (Passo 3)
│       ├── ocr.js                 ← CRIAR (Passo 4)
│       └── meme.js                ← CRIAR (Passo 4)
├── moderation/
│   └── image-moderation.js        ← CRIAR (Passo 6)
└── events/
    └── messageCreate.js           ← MODIFICAR (Passo 2 e 5)
```

---

## 7. Estimativa de Esforço

| Passo | Complexidade | Estimativa |
|-------|-------------|------------|
| 1 — vision-service.js            | Média   | ~2h |
| 2 — Handler de attachments       | Baixa   | ~1h |
| 3 — /analyze                     | Baixa   | ~30m |
| 4 — /ocr e /meme                 | Baixa   | ~1h |
| 5 — Trigger por voz              | Média   | ~2h |
| 6 — Moderação automática         | Alta    | ~3h |
| 7 — Integração com memória       | Baixa   | ~30m |
| **Total**                        |         | **~10h** |

---

## 8. Dependências a Instalar

```bash
# Nenhuma dependência nova necessária!
# O projeto já tem: axios (para Ollama), discord.js (attachments)
# O LLaVA roda via Ollama que já está configurado
```

---

*Documento criado automaticamente pelo Alfred Development Assistant.*
*Próximo passo: implementar Passo 1 (vision-service.js) quando Pedro liberar tempo.*
