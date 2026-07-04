const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

class WhisperStarter {
  constructor() {
    this.process = null;
  }

  start() {
    const scriptPath = path.resolve(__dirname, '..', '..', 'scripts', 'whisper-server.py');
    
    if (!fs.existsSync(scriptPath)) {
      logger.warn(`[WhisperStarter] Arquivo de inicialização não encontrado: ${scriptPath}`);
      return;
    }

    const logPath = path.resolve(__dirname, '..', '..', 'logs', 'whisper-server.log');
    const logDir = path.dirname(logPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const out = fs.openSync(logPath, 'a');

    logger.info('[WhisperStarter] Iniciando servidor Whisper local...');

    // Executamos o script python em background
    this.process = spawn('python', [scriptPath], {
      cwd: path.dirname(scriptPath),
      detached: true,
      stdio: ['ignore', out, out]
    });

    this.process.unref();
    logger.success('[WhisperStarter] Whisper iniciado em segundo plano (logs em logs/whisper-server.log)');
  }

  stop() {
    if (this.process) {
      logger.info('[WhisperStarter] Parando servidor Whisper...');
      try {
        const { execSync } = require('child_process');
        if (process.platform === 'win32') {
          execSync(`taskkill /pid ${this.process.pid} /t /f`);
        } else {
          this.process.kill();
        }
        logger.success('[WhisperStarter] Servidor Whisper encerrado');
      } catch (e) {
        logger.warn(`[WhisperStarter] Erro ao encerrar processo Whisper: ${e.message}`);
      }
      this.process = null;
    }
  }

  isWhisperRunning() {
    return this.process !== null;
  }
}

module.exports = WhisperStarter;
