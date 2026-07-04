const axios = require('axios');
const pdfParse = require('pdf-parse');
const logger = require('./logger');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class DocumentClient {
    constructor() {
        this.supportedFormats = ['.pdf'];
        this.maxFileSize = 25 * 1024 * 1024; // 25MB
        this.tempDir = path.join(os.tmpdir(), 'alfred-docs');
        this.documentCooldowns = new Map();
        this.DOCUMENT_COOLDOWN_TIME = 300000; // 5 minutos
        this.DOCUMENT_COOLDOWN_LIMIT = 1; // 1 documento por 5 minutos
    }

    async initialize() {
        try {
            await fs.mkdir(this.tempDir, { recursive: true });
            logger.info('[Document] Diretório temporário criado:', this.tempDir);
        } catch (error) {
            logger.error('[Document] Erro ao criar diretório temporário:', error);
        }
    }

    async downloadDocument(url) {
        try {
            logger.info('[Document] Baixando documento:', url);
            
            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: 60000, // 60 segundos
                maxContentLength: this.maxFileSize,
                headers: {
                    'User-Agent': 'AlfredBot/1.0'
                }
            });

            const contentType = response.headers['content-type'];
            const contentLength = response.headers['content-length'];

            // Verificar tipo de conteúdo
            if (!contentType.includes('pdf') && !contentType.includes('application/octet-stream')) {
                throw new Error('Formato de arquivo não suportado. Apenas PDFs são aceitos.');
            }

            // Verificar tamanho
            if (contentLength && parseInt(contentLength) > this.maxFileSize) {
                throw new Error(`Arquivo muito grande. Máximo permitido: ${this.maxFileSize / (1024 * 1024)}MB`);
            }

            const buffer = Buffer.from(response.data);
            
            // Verificar se é realmente um PDF
            if (!this.isValidPDF(buffer)) {
                throw new Error('Arquivo não é um PDF válido.');
            }

            // Salvar temporariamente
            const filename = `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.pdf`;
            const filepath = path.join(this.tempDir, filename);
            
            await fs.writeFile(filepath, buffer);
            logger.info('[Document] Documento salvo temporariamente:', filepath);

            return {
                filepath,
                filename,
                size: buffer.length,
                contentType
            };

        } catch (error) {
            logger.error('[Document] Erro ao baixar documento:', error);
            throw new Error(`Erro ao baixar documento: ${error.message}`);
        }
    }

    isValidPDF(buffer) {
        // Verificar assinatura do PDF (PDF magic number)
        const pdfHeader = buffer.toString('ascii', 0, 4);
        return pdfHeader === '%PDF';
    }

    async extractText(filepath) {
        try {
            logger.info('[Document] Extraindo texto do PDF:', filepath);
            
            const dataBuffer = await fs.readFile(filepath);
            const data = await pdfParse(dataBuffer);
            
            const text = data.text;
            const pages = data.numpages;
            const info = data.info;

            logger.info(`[Document] Texto extraído: ${text.length} caracteres, ${pages} páginas`);

            return {
                text,
                pages,
                info,
                metadata: {
                    title: info?.Title || 'Sem título',
                    author: info?.Author || 'Autor desconhecido',
                    subject: info?.Subject || 'Sem assunto',
                    creator: info?.Creator || 'Criador desconhecido',
                    creationDate: info?.CreationDate || 'Data desconhecida'
                }
            };

        } catch (error) {
            logger.error('[Document] Erro ao extrair texto:', error);
            throw new Error(`Erro ao extrair texto do PDF: ${error.message}`);
        }
    }

    async processDocument(url, prompt = null) {
        // Verificar cooldown
        if (!this.checkDocumentCooldown()) {
            throw new Error('Limite de processamento de documentos atingido. Aguarde 5 minutos.');
        }

        let filepath = null;
        
        try {
            // Baixar documento
            const downloadResult = await this.downloadDocument(url);
            filepath = downloadResult.filepath;

            // Extrair texto
            const extractionResult = await this.extractText(filepath);

            // Limitar texto se muito longo (evitar custos altos)
            const maxTextLength = 50000; // 50K caracteres
            let text = extractionResult.text;
            
            if (text.length > maxTextLength) {
                text = text.substring(0, maxTextLength) + '\n\n[Texto truncado devido ao tamanho...]';
                logger.warn(`[Document] Texto truncado de ${extractionResult.text.length} para ${text.length} caracteres`);
            }

            return {
                text,
                pages: extractionResult.pages,
                metadata: extractionResult.metadata,
                originalSize: extractionResult.text.length,
                truncated: extractionResult.text.length > maxTextLength
            };

        } finally {
            // Limpar arquivo temporário
            if (filepath) {
                try {
                    await fs.unlink(filepath);
                    logger.info('[Document] Arquivo temporário removido:', filepath);
                } catch (error) {
                    logger.warn('[Document] Erro ao remover arquivo temporário:', error);
                }
            }
        }
    }

    checkDocumentCooldown() {
        const now = Date.now();
        const recentDocs = this.documentCooldowns.get('global') || [];
        
        // Remove documentos antigos
        const validDocs = recentDocs.filter(timestamp => 
            now - timestamp < this.DOCUMENT_COOLDOWN_TIME
        );
        
        if (validDocs.length >= this.DOCUMENT_COOLDOWN_LIMIT) {
            return false; // Cooldown ativo
        }
        
        // Adiciona novo documento
        validDocs.push(now);
        this.documentCooldowns.set('global', validDocs);
        return true; // Pode processar
    }

    getDocumentCooldownStatus() {
        const now = Date.now();
        const recentDocs = this.documentCooldowns.get('global') || [];
        const validDocs = recentDocs.filter(timestamp => 
            now - timestamp < this.DOCUMENT_COOLDOWN_TIME
        );
        
        return {
            used: validDocs.length,
            limit: this.DOCUMENT_COOLDOWN_LIMIT,
            timeRemaining: this.DOCUMENT_COOLDOWN_TIME - (now - (validDocs[0] || now))
        };
    }

    async cleanup() {
        try {
            const files = await fs.readdir(this.tempDir);
            for (const file of files) {
                const filepath = path.join(this.tempDir, file);
                await fs.unlink(filepath);
            }
            logger.info('[Document] Limpeza de arquivos temporários concluída');
        } catch (error) {
            logger.warn('[Document] Erro na limpeza:', error);
        }
    }

    getSupportedFormats() {
        return this.supportedFormats;
    }

    getMaxFileSize() {
        return this.maxFileSize;
    }
}

module.exports = new DocumentClient(); 