# Dockerfile para Alfred Bot

FROM node:18-alpine

# Metadados
LABEL description="Alfred Bot - Discord AI Assistant"
LABEL version="1.0"
LABEL license="MIT"

# Definir diretório de trabalho
WORKDIR /app

# Instalar dependências do sistema
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    sqlite \
    && rm -rf /var/cache/apk/*

# Copiar package files
COPY package*.json ./

# Instalar dependências
RUN npm ci --only=production && npm cache clean --force

# Copiar código fonte
COPY . .

# Criar usuário não-root
RUN addgroup -g 1001 -S nodejs && \
    adduser -S alfred -u 1001

# Mudar propriedade dos arquivos
RUN chown -R alfred:nodejs /app
USER alfred

# Expor porta (se necessário para health checks)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node health-check.js

# Comando de inicialização
CMD ["npm", "start"] 