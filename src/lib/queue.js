const logger = require('./logger');

class RequestQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
        this.maxConcurrent = 3; // Máximo de 3 requisições simultâneas
        this.activeRequests = 0;
    }

    async add(task) {
        return new Promise((resolve, reject) => {
            this.queue.push({
                task,
                resolve,
                reject,
                timestamp: Date.now()
            });
            
            this.process();
        });
    }

    async process() {
        if (this.processing || this.activeRequests >= this.maxConcurrent) {
            return;
        }

        this.processing = true;

        while (this.queue.length > 0 && this.activeRequests < this.maxConcurrent) {
            const request = this.queue.shift();
            this.activeRequests++;

            try {
                const result = await request.task();
                request.resolve(result);
            } catch (error) {
                logger.error('Erro na fila de requisições:', error);
                request.reject(error);
            } finally {
                this.activeRequests--;
            }

            // Pequena pausa entre requisições para evitar rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        this.processing = false;

        // Se ainda há itens na fila, continua processando
        if (this.queue.length > 0) {
            setTimeout(() => this.process(), 100);
        }
    }

    getQueueLength() {
        return this.queue.length;
    }

    getActiveRequests() {
        return this.activeRequests;
    }

    clear() {
        this.queue = [];
        this.processing = false;
        this.activeRequests = 0;
    }
}

module.exports = new RequestQueue(); 