const { EventEmitter } = require('events');

// Collection subclass of Map
class Collection extends Map {
  find(fn) {
    for (const [key, val] of this) {
      if (fn(val, key)) return val;
    }
    return undefined;
  }
  filter(fn) {
    const results = new Collection();
    for (const [key, val] of this) {
      if (fn(val, key)) results.set(key, val);
    }
    return results;
  }
}

// EmbedBuilder mock
class EmbedBuilder {
  constructor() {
    this.data = {};
  }
  setColor(color) { this.data.color = color; return this; }
  setDescription(desc) { this.data.description = desc; return this; }
  setTitle(title) { this.data.title = title; return this; }
  setThumbnail(url) { this.data.thumbnail = { url }; return this; }
  setURL(url) { this.data.url = url; return this; }
  setImage(url) { this.data.image = { url }; return this; }
  setAuthor(author) { this.data.author = author; return this; }
  addFields(...fields) { this.data.fields = (this.data.fields || []).concat(fields); return this; }
  setFooter(footer) { this.data.footer = footer; return this; }
  setTimestamp(timestamp) { this.data.timestamp = timestamp; return this; }
}

// ActionRowBuilder mock
class ActionRowBuilder {
  constructor() {
    this.components = [];
  }
  addComponents(...components) {
    this.components.push(...components);
    return this;
  }
}

// ButtonBuilder mock
class ButtonBuilder {
  constructor() {
    this.data = {};
  }
  setCustomId(id) { this.data.custom_id = id; return this; }
  setLabel(label) { this.data.label = label; return this; }
  setStyle(style) { this.data.style = style; return this; }
  setEmoji(emoji) { this.data.emoji = emoji; return this; }
  setDisabled(disabled) { this.data.disabled = disabled; return this; }
  setURL(url) { this.data.url = url; return this; }
}

const ButtonStyle = {
  Primary: 1,
  Secondary: 2,
  Success: 3,
  Danger: 4,
  Link: 5
};

const GatewayIntentBits = {
  Guilds: 1 << 0,
  GuildMembers: 1 << 1,
  GuildVoiceStates: 1 << 7,
  GuildMessages: 1 << 9,
  MessageContent: 1 << 15,
};

const Events = {
  ClientReady: 'ready',
  MessageCreate: 'messageCreate',
  InteractionCreate: 'interactionCreate',
};

const REST = class {
  constructor(options) {
    this.options = options;
  }
  setToken(token) { return this; }
  put(route, options) { return Promise.resolve([]); }
};

const Routes = {
  applicationCommands: (clientId) => `applicationCommands:${clientId}`,
  applicationGuildCommands: (clientId, guildId) => `applicationGuildCommands:${clientId}:${guildId}`,
};

class SlashCommandBuilder {
  constructor() {
    this.name = '';
    this.description = '';
    this.options = [];
  }
  setName(name) { this.name = name; return this; }
  setDescription(description) { this.description = description; return this; }
  addUserOption(option) { this.options.push(option); return this; }
  addStringOption(option) { this.options.push(option); return this; }
  addBooleanOption(option) { this.options.push(option); return this; }
  addIntegerOption(option) { this.options.push(option); return this; }
}

class Client extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.user = {
      id: '123456789',
      username: 'Alfred',
      tag: 'Alfred#0000',
    };
    this.guilds = {
      cache: new Collection()
    };
    this.channels = {
      cache: new Collection()
    };
  }
  login(token) {
    return Promise.resolve(token);
  }
}

// Helper factories to generate message and interaction objects for testing
const createMockUser = (data = {}) => ({
  id: data.id || 'mock-user-id',
  username: data.username || 'mockuser',
  tag: data.tag || 'mockuser#0000',
  ...data
});

const createMockGuild = (data = {}) => {
  const guild = {
    id: data.id || 'mock-guild-id',
    name: data.name || 'Mock Guild',
    shard: {
      send: jest.fn().mockImplementation((payload) => {})
    },
    members: {
      cache: new Collection()
    },
    channels: {
      cache: new Collection()
    },
    ...data
  };
  return guild;
};

const createMockVoiceChannel = (guild, data = {}) => ({
  id: data.id || 'mock-voice-channel-id',
  name: data.name || 'Mock Voice Channel',
  guild: guild,
  ...data
});

const createMockTextChannel = (guild, data = {}) => ({
  id: data.id || 'mock-text-channel-id',
  name: data.name || 'Mock Text Channel',
  guild: guild,
  send: jest.fn().mockImplementation(async (payload) => {
    return createMockMessage(guild, { channel: this, ...payload });
  }),
  ...data
});

const createMockMessage = (guild, data = {}) => {
  const msg = {
    id: data.id || 'mock-message-id',
    content: data.content || '',
    guild: guild,
    channel: data.channel || null,
    author: data.author || createMockUser(),
    member: data.member || null,
    reply: jest.fn().mockImplementation(async (payload) => {
      return msg;
    }),
    delete: jest.fn().mockResolvedValue(true),
    ...data
  };
  if (!msg.member) {
    msg.member = {
      user: msg.author,
      guild: guild,
      voice: { channel: null },
      displayName: msg.author.username
    };
  }
  return msg;
};

const createMockInteraction = (guild, data = {}) => {
  const user = data.user || createMockUser();
  const interaction = {
    id: data.id || 'mock-interaction-id',
    guildId: guild.id,
    guild: guild,
    channelId: data.channelId || 'mock-text-channel-id',
    channel: data.channel || null,
    user: user,
    member: data.member || {
      user: user,
      guild: guild,
      voice: { channel: null },
      displayName: user.username
    },
    reply: jest.fn().mockResolvedValue(true),
    deferReply: jest.fn().mockResolvedValue(true),
    editReply: jest.fn().mockResolvedValue(true),
    followUp: jest.fn().mockResolvedValue(true),
    ...data
  };
  return interaction;
};

module.exports = {
  Collection,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  Client,
  // Factories for E2E testing
  createMockUser,
  createMockGuild,
  createMockVoiceChannel,
  createMockTextChannel,
  createMockMessage,
  createMockInteraction
};
