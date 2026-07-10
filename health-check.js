require('dotenv').config();
/**
 * Health Check para Alfred Bot
 * Usado para monitoramento de produção
 */

const redis = require('./src/lib/redis-client');
const aiClient = require('./src/lib/ai-client');

async function healthCheck() {
    const checks = {
        redis: false,
        ia: false,
        provider: 'groq',
        timestamp: new Date().toISOString()
    };

    try {
        // Teste Redis
        await redis.ping();
        checks.redis = true;
    } catch (error) {
        console.error('❌ Redis health check failed:', error.message);
    }

    try {
        // Teste Groq
        const response = await aiClient.chat([
            { role: 'user', content: 'test' }
        ]);
        checks.ia = !!response?.choices?.[0]?.message?.content;
    } catch (error) {
        console.error('❌ Groq health check failed:', error.message);
    }

    const allHealthy = checks.redis && checks.ia;
    if (allHealthy) {
        console.log('✅ Health check passed (Provider: Groq)');
        process.exit(0);
    } else {
        console.log('❌ Health check failed:', checks);
        process.exit(1);
    }
}

healthCheck(); 