/**
 * Unit Tests for Music Manager - RPG Mode Transitions, Looping & Mapping
 */

const discord = require('discord.js');
const MusicManager = require('../../src/lib/music-manager');
const { Player } = require('../mocks/lavalink.mock');

describe('MusicManager - RPG Mode Features', () => {
  let client;
  let musicManager;
  let guild;
  let voiceChannel;
  let textChannel;
  let user;
  let message;

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
      content: 'alfred play suspense',
      author: user,
      channel: textChannel
    });
    message.member.voice.channel = voiceChannel;
  });

  test('should detect and route RPG mood queries to playMood', async () => {
    const playMoodSpy = jest.spyOn(musicManager, 'playMood').mockResolvedValue(null);
    await musicManager.play(message, 'toque música de combate');
    expect(playMoodSpy).toHaveBeenLastCalledWith(message, 'combate');

    await musicManager.play(message, 'suspense');
    expect(playMoodSpy).toHaveBeenLastCalledWith(message, 'suspense');

    await musicManager.play(message, 'luta');
    expect(playMoodSpy).toHaveBeenLastCalledWith(message, 'combate');

    playMoodSpy.mockRestore();
  });

  test('should instantly skip and loop the track during RPG mode', async () => {
    const player = musicManager._lavalink.createPlayer({
      guildId: guild.id,
      voiceChannelId: voiceChannel.id,
      textChannelId: textChannel.id
    });
    player.connected = true;

    // Mock player state as playing
    player.playing = true;
    player.queue.add({ info: { title: 'Old Song', author: 'Old Artist' } });

    // Enable silent/RPG mode
    musicManager.silentMode.set(guild.id, true);

    const skipSpy = jest.spyOn(player, 'skip').mockResolvedValue(true);
    const setRepeatModeSpy = jest.spyOn(player, 'setRepeatMode').mockResolvedValue(true);

    // Request new song in RPG mode
    await musicManager.play(message, 'metallica');

    // It should clear the old queue and push the new song
    expect(player.queue.tracks.length).toBe(1);
    expect(player.queue.tracks[0].info.title).toContain('metallica');
    
    // It should instantly skip
    expect(skipSpy).toHaveBeenCalled();

    // It should set repeat mode to track (since it is a single song)
    expect(setRepeatModeSpy).toHaveBeenCalledWith('track');

    skipSpy.mockRestore();
    setRepeatModeSpy.mockRestore();
  });
});
