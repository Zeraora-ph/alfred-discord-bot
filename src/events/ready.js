const { Events } = require('discord.js');
const logger = require('../lib/logger');

module.exports = {
	name: Events.ClientReady,
	once: true,
	execute(client) {
		logger.info(`Pronto! Logado como ${client.user.tag}`);
	},
}; 