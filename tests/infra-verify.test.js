const discord = require('discord.js');
const { LavalinkManager } = require('lavalink-client');
const voice = require('@discordjs/voice');
const aiClient = require('../src/lib/ai-client');
const MusicManager = require('../src/lib/music-manager');

describe('Infra Mocks Verification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    voice._clearConnections();
  });

  test('discord.js mock is loaded and works', () => {
    const user = discord.createMockUser({ username: 'TestUser' });
    expect(user.username).toBe('TestUser');

    const embed = new discord.EmbedBuilder().setTitle('Test Embed');
    expect(embed.data.title).toBe('Test Embed');
  });

  test('ai-client mock is loaded and works', async () => {
    expect(jest.isMockFunction(aiClient.chat)).toBe(true);
    const res = await aiClient.chat([{ role: 'user', content: 'vintage 7 fold' }]);
    expect(res.choices[0].message.content).toBe('Avenged Sevenfold');
  });

  test('voice mock is loaded and works', async () => {
    expect(jest.isMockFunction(voice.joinVoiceChannel)).toBe(true);
    const guild = discord.createMockGuild();
    const connection = voice.joinVoiceChannel({ guildId: guild.id, channelId: 'ch123' });
    expect(connection.state.status).toBe(voice.VoiceConnectionStatus.Ready);
  });

  test('lavalink-client mock and MusicManager integration works', async () => {
    const client = new discord.Client();
    const musicManager = new MusicManager();
    
    // Initialize MusicManager
    await musicManager.init(client);
    await new Promise(resolve => setTimeout(resolve, 15));
    expect(musicManager.initialized).toBe(true);
    
    // Set up mock guild, channel, user, and message
    const guild = discord.createMockGuild();
    const voiceChannel = discord.createMockVoiceChannel(guild, { id: 'vc-123' });
    const textChannel = discord.createMockTextChannel(guild, { id: 'tc-123' });
    const user = discord.createMockUser({ username: 'Bob' });
    
    const message = discord.createMockMessage(guild, {
      content: 'alfred toca avenged sevenfold',
      author: user,
      channel: textChannel
    });
    message.member.voice.channel = voiceChannel;
    
    // Run play command
    await musicManager.play(message, 'avenged sevenfold');
    
    // Verify player is created and connected
    const player = musicManager.players.get(guild.id);
    expect(player).toBeDefined();
    expect(player.connected).toBe(true);
    
    // Skip to trigger queueEnd / next track
    const oldTrack = await player.skip();
    expect(oldTrack).toBeDefined();
    expect(oldTrack.info.title).toContain('avenged sevenfold');
  });
});
