const logger = require('./logger');
const Redis = require('ioredis');

// Mock Redis client para funcionar sem Redis instalado
class MockRedis {
  constructor() {
    this.store = new Map();
    this.expirations = new Map();
  }

  async get(key) {
    this._checkExpiration(key);
    return this.store.get(key) || null;
  }

  async set(key, value) {
    this.store.set(key, value);
    return 'OK';
  }

  async setex(key, seconds, value) {
    this.store.set(key, value);
    this.expirations.set(key, Date.now() + seconds * 1000);
    return 'OK';
  }

  async incr(key) {
    const current = parseInt(this.store.get(key) || '0');
    const newValue = current + 1;
    this.store.set(key, newValue.toString());
    return newValue;
  }

  async expire(key, seconds) {
    this.expirations.set(key, Date.now() + seconds * 1000);
    return 1;
  }

  async del(key) {
    this.store.delete(key);
    this.expirations.delete(key);
    return 1;
  }

  _checkExpiration(key) {
    const expiration = this.expirations.get(key);
    if (expiration && Date.now() > expiration) {
      this.store.delete(key);
      this.expirations.delete(key);
    }
  }

  on(event, callback) {
    // Mock event handler
  }
}

class RedisClientWrapper {
  constructor() {
    this.mock = new MockRedis();
    this.useMock = true;
    this.redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
    
    // Se estiver em ambiente de testes, NUNCA instancie o ioredis real
    // para evitar vazamento de sockets e timers abertos no Jest
    if (process.env.NODE_ENV === 'test') {
      logger.info('[Redis] Modo de teste detectado. Utilizando apenas MockRedis em memória.');
      return;
    }

    logger.info(`[Redis] Tentando conectar ao Redis real em ${this.redisUrl}...`);

    try {
      this.real = new Redis(this.redisUrl, {
        connectTimeout: 2000,
        maxRetriesPerRequest: 1, // Não acumular comandos travados se desconectar
        retryStrategy: (times) => {
          // Tentativa de reconexão a cada 5 segundos
          return Math.min(times * 1000, 5000);
        }
      });

      this.real.on('connect', () => {
        this.useMock = false;
        logger.info(`✅ Conectado com sucesso ao Redis real em ${this.redisUrl}`);
      });

      this.real.on('error', (err) => {
        if (!this.useMock) {
          logger.warn(`⚠️ Erro no Redis real: ${err.message}. Degradando temporariamente para Mock em memória.`);
          this.useMock = true;
        }
      });
    } catch (e) {
      logger.error(`❌ Falha ao instanciar ioredis (${e.message}). Usando Mock em memória.`);
      this.useMock = true;
    }
  }

  // Getters para compatibilidade com testes unitários que manipulam o mock diretamente
  get store() {
    return this.mock.store;
  }

  get expirations() {
    return this.mock.expirations;
  }

  async get(key) {
    if (this.useMock) return this.mock.get(key);
    try {
      return await this.real.get(key);
    } catch (e) {
      logger.warn(`[Redis] get falhou no real (${e.message}). Usando mock.`);
      return this.mock.get(key);
    }
  }

  async set(key, value) {
    if (this.useMock) return this.mock.set(key, value);
    try {
      return await this.real.set(key, value);
    } catch (e) {
      logger.warn(`[Redis] set falhou no real (${e.message}). Usando mock.`);
      return this.mock.set(key, value);
    }
  }

  async setex(key, seconds, value) {
    if (this.useMock) return this.mock.setex(key, seconds, value);
    try {
      return await this.real.setex(key, seconds, value);
    } catch (e) {
      logger.warn(`[Redis] setex falhou no real (${e.message}). Usando mock.`);
      return this.mock.setex(key, seconds, value);
    }
  }

  async incr(key) {
    if (this.useMock) return this.mock.incr(key);
    try {
      return await this.real.incr(key);
    } catch (e) {
      logger.warn(`[Redis] incr falhou no real (${e.message}). Usando mock.`);
      return this.mock.incr(key);
    }
  }

  async expire(key, seconds) {
    if (this.useMock) return this.mock.expire(key, seconds);
    try {
      return await this.real.expire(key, seconds);
    } catch (e) {
      logger.warn(`[Redis] expire falhou no real (${e.message}). Usando mock.`);
      return this.mock.expire(key, seconds);
    }
  }

  async del(key) {
    if (this.useMock) return this.mock.del(key);
    try {
      return await this.real.del(key);
    } catch (e) {
      logger.warn(`[Redis] del falhou no real (${e.message}). Usando mock.`);
      return this.mock.del(key);
    }
  }

  on(event, callback) {
    if (this.real) {
      this.real.on(event, callback);
    }
  }
}

const redis = new RedisClientWrapper();

module.exports = redis;
