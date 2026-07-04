/**
 * Unit Tests for Music Playlist Batch Loading
 */

const discord = require('discord.js');
const MusicManager = require('../../src/lib/music-manager');
const { Player } = require('../mocks/lavalink.mock');

describe('MusicManager - playSavedPlaylist', () => {
  let client;
  let musicManager;
  let guild;
  let voiceChannel;
  let textChannel;
  let user;
  let message;
  let searchSpy;

  beforeEach(async () => {
    jest.clearAllMocks();
    client = new discord.Client();
    musicManager = new MusicManager();
    await musicManager.init(client);
    
    guild = discord.createMockGuild();
    voiceChannel = discord.createMockVoiceChannel(guild, { id: 'vc-123' });
    textChannel = discord.createMockTextChannel(guild, { id: 'tc-123' });
    user = discord.createMockUser({ username: 'Bob' });
    
    message = discord.createMockMessage(guild, {
      content: 'alfred playlist tocar test',
      author: user,
      channel: textChannel
    });
    message.member.voice.channel = voiceChannel;

    searchSpy = jest.spyOn(Player.prototype, 'search');
  });

  afterEach(() => {
    searchSpy.mockRestore();
  });

  test('should load playlist tracks concurrently in batches of 5 and handle fallbacks', async () => {
    const tracks = [];
    for (let i = 0; i < 12; i++) {
      let url = `https://youtube.com/watch?v=track${i}`;
      let title = `Track ${i}`;
      let author = `Artist ${i}`;
      
      if (i === 1) {
        url = `https://youtube.com/watch?v=track${i}-fail`; // trigger fallback
      } else if (i === 2) {
        url = `https://youtube.com/watch?v=track${i}-empty`; // trigger fallback
      } else if (i === 3) {
        url = `https://youtube.com/watch?v=track${i}-fail`;
        title = `Track ${i}-fail`; // trigger complete failure
      }
      
      tracks.push({ url, title, author });
    }

    musicManager.playlists['test'] = {
      name: 'test',
      createdBy: 'Bob',
      createdId: user.id,
      guildId: guild.id,
      tracks,
      createdAt: new Date().toISOString()
    };

    await musicManager.playSavedPlaylist(message, 'test');

    const player = musicManager._lavalink.getPlayer(guild.id);
    expect(player).toBeDefined();
    // 12 tracks: 11 succeeded (9 normal + 2 fallback), 1 completely failed (track 3)
    expect(player.queue.tracks.length + (player.queue.current ? 1 : 0)).toBe(11);
    
    // Check that we performed 12 initial searches + 3 fallback searches = 15 total searches
    expect(searchSpy).toHaveBeenCalledTimes(15);
  });
});
