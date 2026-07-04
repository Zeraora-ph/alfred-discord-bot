const { EventEmitter } = require('events');

class NodeManager extends EventEmitter {
  constructor(manager) {
    super();
    this.manager = manager;
    this.nodes = new Map();
  }
}

class MockPlayer extends EventEmitter {
  constructor(options, manager) {
    super();
    this.guildId = options.guildId;
    this.voiceChannelId = options.voiceChannelId;
    this.textChannelId = options.textChannelId;
    this.volume = options.volume || 50;
    this.playing = false;
    this.paused = false;
    this.connected = false;
    this.repeatMode = 'off';
    this.manager = manager;
    
    this.queue = {
      current: null,
      tracks: [],
      previous: [],
      add: (tracks) => {
        const trs = Array.isArray(tracks) ? tracks : [tracks];
        this.queue.tracks.push(...trs);
      }
    };
  }

  async connect() {
    this.connected = true;
    process.nextTick(() => {
      this.manager.emit('playerUpdate', {}, this);
    });
    return this;
  }

  async play() {
    if (this.queue.tracks.length > 0 && !this.queue.current) {
      this.queue.current = this.queue.tracks.shift();
    }
    if (this.queue.current) {
      this.playing = true;
      this.paused = false;
      process.nextTick(() => {
        this.manager.emit('trackStart', this, this.queue.current);
      });
    }
    return this;
  }

  async pause() {
    this.paused = true;
    this.playing = false;
    return this;
  }

  async resume() {
    this.paused = false;
    this.playing = true;
    return this;
  }

  async stop() {
    this.playing = false;
    this.queue.current = null;
    process.nextTick(() => {
      this.manager.emit('queueEnd', this);
    });
    return this;
  }

  async stopPlaying(clearQueue = true, executeAutoplay = false) {
    this.playing = false;
    this.queue.current = null;
    if (clearQueue) {
      this.queue.tracks = [];
    }
    process.nextTick(() => {
      this.manager.emit('queueEnd', this);
    });
    return this;
  }

  async skip() {
    const oldTrack = this.queue.current;
    if (oldTrack) {
      this.queue.previous.unshift(oldTrack);
    }
    this.queue.current = null;
    this.playing = false;
    if (this.queue.tracks.length > 0) {
      this.queue.current = this.queue.tracks.shift();
      this.playing = true;
      process.nextTick(() => {
        this.manager.emit('trackStart', this, this.queue.current);
      });
    } else {
      process.nextTick(() => {
        this.manager.emit('queueEnd', this);
      });
    }
    return oldTrack;
  }

  async destroy(reason, disconnect) {
    this.playing = false;
    this.connected = false;
    this.queue.current = null;
    this.queue.tracks = [];
    this.manager.players.delete(this.guildId);
    process.nextTick(() => {
      this.manager.emit('playerDestroy', this);
    });
    return this;
  }

  async setRepeatMode(mode) {
    this.repeatMode = mode;
    return this;
  }

  async setVolume(volume) {
    this.volume = volume;
    return this;
  }

  async search(queryOptions, requester) {
    const query = typeof queryOptions === 'string' ? queryOptions : queryOptions.query;
    if (query.includes('fail') || query.includes('error')) {
      return { loadType: 'error', tracks: [] };
    }
    if (query.includes('empty')) {
      return { loadType: 'empty', tracks: [] };
    }
    
    const isPlaylist = query.includes('playlist');
    const mockTracks = [
      {
        info: {
          title: isPlaylist ? 'Playlist Track 1' : `Mock Track for ${query}`,
          author: 'Mock Artist',
          uri: 'https://youtube.com/watch?v=mock1',
          artworkUrl: 'https://img.youtube.com/mock1.jpg',
          duration: 180000,
          length: 180000
        },
        requester
      }
    ];

    if (isPlaylist) {
      mockTracks.push({
        info: {
          title: 'Playlist Track 2',
          author: 'Mock Artist 2',
          uri: 'https://youtube.com/watch?v=mock2',
          artworkUrl: 'https://img.youtube.com/mock2.jpg',
          duration: 240000,
          length: 240000
        },
        requester
      });
      return {
        loadType: 'playlist',
        playlistInfo: { name: 'Mock Playlist' },
        tracks: mockTracks
      };
    }

    return {
      loadType: 'track',
      tracks: mockTracks
    };
  }
}

class LavalinkManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.nodeManager = new NodeManager(this);
    this.players = new Map();
    const node = { id: 'main', connected: true };
    this.nodeManager.nodes = new Map([['main', node]]);
  }

  async init(clientInfo) {
    this.clientInfo = clientInfo;
    setTimeout(() => {
      const node = this.nodeManager.nodes.get('main');
      this.nodeManager.emit('connect', node);
    }, 5);
    return this;
  }

  sendRawData(data) {
    // Mock sending raw data
  }

  getPlayer(guildId) {
    return this.players.get(guildId);
  }

  createPlayer(options) {
    const player = new MockPlayer(options, this);
    this.players.set(options.guildId, player);
    return player;
  }
}

module.exports = {
  LavalinkManager,
  NodeManager,
  Player: MockPlayer
};
