/**
 * Slash Commands Deploy Script
 * Registers all slash commands to Discord
 * 
 * Run: node src/deploy-commands.js
 */

require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const logger = require('./lib/logger');

// ============================================
// Configuration
// ============================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID; // Optional: for testing in specific guild

if (!TOKEN || !CLIENT_ID) {
    console.error('❌ DISCORD_TOKEN and DISCORD_CLIENT_ID are required');
    process.exit(1);
}

// ============================================
// Load Commands
// ============================================

const commands = [];
const slashCommandsPath = path.join(__dirname, 'commands', 'slash');

// Check if slash commands directory exists
if (!fs.existsSync(slashCommandsPath)) {
    console.error('❌ Slash commands directory not found:', slashCommandsPath);
    process.exit(1);
}

const commandFiles = fs.readdirSync(slashCommandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    try {
        const command = require(path.join(slashCommandsPath, file));

        if ('data' in command && 'execute' in command) {
            commands.push(command.data.toJSON());
            console.log(`✅ Loaded: ${command.data.name}`);
        } else {
            console.warn(`⚠️ Skipped ${file}: missing "data" or "execute" property`);
        }
    } catch (error) {
        console.error(`❌ Error loading ${file}:`, error.message);
    }
}

console.log(`\n📦 ${commands.length} commands ready to deploy\n`);

// ============================================
// Deploy Commands
// ============================================

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
    try {
        console.log('🚀 Starting slash commands deployment...\n');

        let route;
        let targetDescription;

        if (GUILD_ID) {
            // Deploy to specific guild (instant, for testing)
            route = Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID);
            targetDescription = `guild ${GUILD_ID}`;
        } else {
            // Deploy globally (takes up to 1 hour to propagate)
            route = Routes.applicationCommands(CLIENT_ID);
            targetDescription = 'all guilds (global)';
        }

        const data = await rest.put(route, { body: commands });

        console.log(`✅ Successfully deployed ${data.length} slash commands to ${targetDescription}!\n`);

        console.log('📋 Deployed commands:');
        data.forEach(cmd => {
            console.log(`   - /${cmd.name}`);
        });

        if (!GUILD_ID) {
            console.log('\n⚠️ Global commands may take up to 1 hour to appear in all servers.');
            console.log('💡 For instant testing, set DISCORD_GUILD_ID in .env');
        }

    } catch (error) {
        console.error('❌ Error deploying commands:', error);

        if (error.code === 50001) {
            console.error('💡 Make sure the bot has "applications.commands" scope!');
        }
    }
})();
