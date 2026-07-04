const winston = require('winston');
const { format } = winston;

// Cores para diferentes níveis de log
const colors = {
  error: '\x1b[31m',   // Vermelho
  warn: '\x1b[33m',    // Amarelo
  info: '\x1b[36m',    // Ciano
  debug: '\x1b[90m',   // Cinza
  reset: '\x1b[0m'     // Reset
};

// Formato limpo para console
const cleanFormat = format.printf(({ level, message }) => {
  const color = colors[level] || colors.reset;
  const icon = level === 'error' ? '✗' : level === 'warn' ? '⚠' : level === 'info' ? '•' : '○';
  return `${color}${icon} ${message}${colors.reset}`;
});

// Formato para arquivo (com timestamp)
const fileFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.printf(({ timestamp, level, message }) => `[${timestamp}] ${level.toUpperCase()}: ${message}`)
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  transports: [
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: fileFormat
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      format: fileFormat
    }),
  ],
});

// Console com formato limpo (apenas em desenvolvimento)
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: cleanFormat,
    level: 'info' // Não mostrar debug no console
  }));
}

// Helper para logs de seção (startup)
logger.section = (title) => {
  console.log(`\n\x1b[1m\x1b[35m━━━ ${title} ━━━\x1b[0m`);
};

// Helper para sucesso
logger.success = (message) => {
  console.log(`\x1b[32m✓ ${message}\x1b[0m`);
};

module.exports = logger;
