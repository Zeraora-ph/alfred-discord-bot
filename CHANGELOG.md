# Changelog

Todas as alterações notáveis neste projeto serão documentadas neste arquivo.

## [1.0.0] - 2026-07-04
### Adicionado
- **Lançamento Open Source:** Primeira versão pública oficial com código sanitizado e livre de chaves de API/dados pessoais.
- **Sistema de Voz Premium (Fish Audio):** Suporte para geração de áudio de alta qualidade com API baseada em nuvem, controle de cache e pré-carregamento (prefetch) de saudações.
- **Servidor de Voz Local (Voicebox):** Integração com API de TTS local e suporte aos motores de voz Qwen, Kokoro e Chatterbox.
- **Integração Whisper (STT):** Escuta ativa de comandos em tempo real com controle de silêncio adaptativo e otimização de latência.
- **Encadeamento de Fallbacks de IA:** Roteamento dinâmico e inteligente de requisições de chat (Groq -> OpenRouter -> Ollama Local) para otimizar custo, performance e estabilidade.
- **Gerenciador de Limites de API (Groq Limiter):** Limitação preventiva baseada em cota de requisições/tempo restante de redefinição reportado pela própria API.
- **Modo RPG com Som de Fundo:** Sistema de jogo integrado com música ambiente automática baseada em moods do jogo, com suporte a transições e loops.
- **Gravação e Crônicas de Voz:** Geração automática de resumos narrados ao fim de sessões de RPG usando o narrador por voz.
- **Suporte Dual-Bot de Música (Lavalink):** Sistema robusto com bot secundário JBL opcional, gerenciamento de filas de música, modo DJ e autoplay.
- **Painel Administrativo Web:** Interface web baseada em Express com autenticação por Discord OAuth2, logs em tempo real e gerenciamento de configurações do bot.
- **Script de Inicialização Automática:** Scripts `.bat` integrados para Windows que iniciam os serviços locais (Lavalink, Whisper) e o bot em background ao ligar o PC.

## [0.9.0] - 2026-06-07
### Adicionado
- **Gerenciador de Música (Refatoração de Performance):** Migração para Shoukaku/lavalink-client e otimização do buffer de reprodução.
- **Validação de Integridade (Protection System):** Sistema para validar variáveis de ambiente necessárias e integridade de arquivos críticos no boot.

## [0.5.0] - 2026-04-04
### Adicionado
- **Arquitetura Base:** Estrutura inicial do assistente com Discord.js v14, suporte básico a comandos prefixados/slash e cliente OpenAI/Groq para chat.
