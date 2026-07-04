const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

class LavalinkStarter {
  constructor() {
    this.process = null;
  }

  start() {
    const batPath = path.resolve(__dirname, '..', '..', 'lavalink', 'start-lavalink.bat');
    
    if (!fs.existsSync(batPath)) {
      logger.warn(`[LavalinkStarter] Arquivo de inicialização não encontrado: ${batPath}`);
      return;
    }

    logger.info('[LavalinkStarter] Iniciando servidor Lavalink local...');

    // No Windows, executamos o .bat usando cmd.exe
    this.process = spawn('cmd.exe', ['/c', batPath], {
      cwd: path.dirname(batPath),
      detached: true,
      stdio: 'ignore'
    });

    this.process.unref();
    logger.success('[LavalinkStarter] Lavalink iniciado em segundo plano');
  }

  stop() {
    if (this.process) {
      logger.info('[LavalinkStarter] Parando servidor Lavalink...');
      try {
        const { execSync } = require('child_process');
        execSync(`taskkill /pid ${this.process.pid} /t /f`);
        logger.success('[LavalinkStarter] Servidor Lavalink encerrado');
      } catch (e) {
        logger.warn(`[LavalinkStarter] Erro ao encerrar processo Lavalink: ${e.message}`);
      }
      this.process = null;
    }
  }

  isLavalinkRunning() {
    return this.process !== null;
  }
}

module.exports = LavalinkStarter;
