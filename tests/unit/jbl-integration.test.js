/**
 * Unit Tests for JBL Bot Integration & Status validation
 */

const discord = require('discord.js');
const MusicManager = require('../../src/lib/music-manager');

describe('MusicManager - JBL Status Validation', () => {
  let client;
  let jblClient;
  let musicManager;
  let guild;
  let user;
  let message;
  let originalEnvToken;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JBL_TEST_ACTIVE = 'true';
    originalEnvToken = process.env.JBL_DISCORD_TOKEN;
    delete process.env.JBL_DISCORD_TOKEN;

    client = new discord.Client();
    jblClient = new discord.Client();
    musicManager = new MusicManager();
    
    guild = discord.createMockGuild();
    user = discord.createMockUser({ username: 'Alice' });
    
    message = discord.createMockMessage(guild, {
      content: 'alfred toca metallica',
      author: user
    });
  });

  afterEach(() => {
    delete process.env.JBL_TEST_ACTIVE;
    if (originalEnvToken) {
      process.env.JBL_DISCORD_TOKEN = originalEnvToken;
    } else {
      delete process.env.JBL_DISCORD_TOKEN;
    }
  });

  test('should fail validation with token_missing if JBL_DISCORD_TOKEN is not in env', async () => {
    await musicManager.init(client, null);
    const status = await musicManager.checkJblStatus(message);
    expect(status.ok).toBe(false);
    expect(status.reason).toBe('token_missing');
  });

  test('should fail validation with not_connected if JBL is connected but not ready', async () => {
    process.env.JBL_DISCORD_TOKEN = 'mock-jbl-token';
    jblClient.readyAt = null;
    jblClient.user = null;

    await musicManager.init(client, jblClient);
    
    const status = await musicManager.checkJblStatus(message);
    expect(status.ok).toBe(false);
    expect(status.reason).toBe('not_connected');
  });

  test('should fail validation with not_in_server if JBL is connected but not in the guild', async () => {
    process.env.JBL_DISCORD_TOKEN = 'mock-jbl-token';
    jblClient.readyAt = new Date();
    jblClient.user = { id: 'jbl-bot-id', username: 'JBL' };

    await musicManager.init(client, jblClient);

    // Mock client guilds cache
    client.guilds.cache.set(guild.id, guild);
    
    // Mock guild member fetch returning null (bot not in guild)
    guild.members.fetch = jest.fn().mockRejectedValue(new Error('Member not found'));

    const status = await musicManager.checkJblStatus(message);
    expect(status.ok).toBe(false);
    expect(status.reason).toBe('not_in_server');
    expect(status.jblClientId).toBe('jbl-bot-id');
  });

  test('should succeed validation if JBL is connected and present in the guild', async () => {
    process.env.JBL_DISCORD_TOKEN = 'mock-jbl-token';
    jblClient.readyAt = new Date();
    jblClient.user = { id: 'jbl-bot-id', username: 'JBL' };

    await musicManager.init(client, jblClient);

    client.guilds.cache.set(guild.id, guild);
    
    const mockJblMember = { id: 'jbl-bot-id', user: jblClient.user };
    guild.members.cache.set('jbl-bot-id', mockJblMember);
    guild.members.fetch = jest.fn().mockResolvedValue(mockJblMember);

    const status = await musicManager.checkJblStatus(message);
    expect(status.ok).toBe(true);
  });
});
