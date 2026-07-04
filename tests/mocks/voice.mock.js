const { EventEmitter } = require('events');

const VoiceConnectionStatus = {
  Signalling: 'signalling',
  Connecting: 'connecting',
  Ready: 'ready',
  Disconnected: 'disconnected',
  Destroyed: 'destroyed',
};

class MockVoiceConnection extends EventEmitter {
  constructor(joinConfig) {
    super();
    this.joinConfig = joinConfig;
    this.state = {
      status: VoiceConnectionStatus.Ready,
      subscription: null,
      networking: {
        state: 'ready'
      }
    };
    this.receiver = {
      speaking: new EventEmitter(),
      subscribe: jest.fn().mockImplementation((userId, options) => {
        const { Readable } = require('stream');
        const stream = new Readable({
          read() {
            this.push(null); // EOF
          }
        });
        return stream;
      })
    };
  }

  subscribe(player) {
    this.state.subscription = { player };
    return this.state.subscription;
  }

  rejoin(joinConfig) {
    this.joinConfig = { ...this.joinConfig, ...joinConfig };
  }

  destroy() {
    const oldState = { status: this.state.status };
    this.state.status = VoiceConnectionStatus.Destroyed;
    const newState = { status: VoiceConnectionStatus.Destroyed };
    this.emit('stateChange', oldState, newState);
  }
}

const connections = new Map();

const joinVoiceChannel = jest.fn().mockImplementation((config) => {
  let conn = connections.get(config.guildId);
  if (!conn) {
    conn = new MockVoiceConnection(config);
    connections.set(config.guildId, conn);
  }
  return conn;
});

const getVoiceConnection = jest.fn().mockImplementation((guildId) => {
  return connections.get(guildId);
});

const entersState = jest.fn().mockImplementation(async (connection, status, timeout) => {
  connection.state.status = status;
  return connection;
});

class MockAudioPlayer extends EventEmitter {
  constructor() {
    super();
  }
  play(resource) {
    this.resource = resource;
    return true;
  }
  stop() {
    return true;
  }
  pause() {
    return true;
  }
  unpause() {
    return true;
  }
}

const createAudioPlayer = jest.fn().mockImplementation(() => {
  return new MockAudioPlayer();
});

const createAudioResource = jest.fn().mockImplementation((stream, options) => {
  return {
    stream,
    options,
    volume: {
      setVolume: jest.fn()
    }
  };
});

const StreamType = {
  Arbitrary: 'arbitrary',
  Raw: 'raw',
  OggOpus: 'oggopus',
  WebmOpus: 'webmopus'
};

const EndBehaviorType = {
  AfterSilence: 'afterSilence',
  AfterAnySilence: 'afterAnySilence'
};

const NoSubscriberBehavior = {
  Play: 'play',
  Pause: 'pause',
  Stop: 'stop'
};

module.exports = {
  joinVoiceChannel,
  getVoiceConnection,
  entersState,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  StreamType,
  EndBehaviorType,
  NoSubscriberBehavior,
  _clearConnections: () => connections.clear(),
  _connections: connections
};
