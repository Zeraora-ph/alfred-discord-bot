const logger = require('./logger');

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

const redis = new MockRedis();
logger.info('Using in-memory Redis mock (no Redis server required)');

module.exports = redis;
