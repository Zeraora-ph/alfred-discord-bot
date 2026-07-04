/**
 * Setup de Testes
 * Configurações globais para Jest
 */

const path = require('path');

// Registrar mocks globais para testes de E2E / Integração
jest.mock('discord.js', () => require('./mocks/discord.mock'));
jest.mock('lavalink-client', () => require('./mocks/lavalink.mock'));
jest.mock('@discordjs/voice', () => require('./mocks/voice.mock'));
jest.mock('../src/lib/ai-client', () => require('./mocks/ai-client.mock'));

// Suprime console.log durante testes (opcional)
global.console = {
  ...console,
  // Descomenta para silenciar logs nos testes
  // log: jest.fn(),
  // debug: jest.fn(),
  // info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Timeout padrão para testes assíncronos
jest.setTimeout(10000);

