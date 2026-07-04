const { REST, Routes } = require('discord.js');
const dotenv = require('dotenv');
const fs = require('node:fs');
const path = require('node:path');
const logger = require('./src/lib/logger');

dotenv.config();

const commands = [];
const foldersPath = path.join(__dirname, 'src/commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
	const commandsPath = path.join(foldersPath, folder);
	const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
	for (const file of commandFiles) {
		const filePath = path.join(commandsPath, file);
		const command = require(filePath);
        if ('data' in command && 'execute' in command) {
		    commands.push(command.data.toJSON());
        } else {
            logger.warn(`O comando em ${filePath} está faltando a propriedade "data" ou "execute".`);
        }
	}
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
	try {
		logger.info(`Iniciando a atualização de ${commands.length} comandos de aplicativo (/).`);

		const data = await rest.put(
			Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
			{ body: commands },
		);

		logger.info(`Recarregou com sucesso ${data.length} comandos de aplicativo (/).`);
	} catch (error) {
		logger.error(error);
	}
})(); 