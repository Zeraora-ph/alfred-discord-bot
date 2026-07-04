/**
 * Command Registry Service
 * Provides centralized command registration, routing, and cooldown management
 * 
 * @module services/command-registry
 */

const logger = require('../lib/logger');
const redis = require('../lib/redis-client');
const { RateLimitError, AuthorizationError } = require('./error-handler');

// ============================================
// Constants
// ============================================

const COOLDOWN_LIMIT = 5; // Commands per minute per user
const COOLDOWN_TIME = 60; // Seconds

// ============================================
// Command Registry Class
// ============================================

class CommandRegistry {
    constructor() {
        this.commands = new Map();
        this.aliases = new Map();
        this.categories = new Map();
    }

    /**
     * Registers a command handler
     * 
     * @param {Object} config - Command configuration
     * @param {string} config.name - Primary command name
     * @param {string[]} [config.aliases] - Alternative command names
     * @param {string} [config.category] - Command category for grouping
     * @param {string} config.description - Command description
     * @param {Function} config.execute - Command handler function
     * @param {boolean} [config.adminOnly] - Requires admin permission
     * @param {boolean} [config.guildOnly] - Only works in guilds (not DMs)
     * @param {number} [config.cooldown] - Custom cooldown in seconds
     */
    register({ name, aliases = [], category = 'general', description, execute, adminOnly = false, guildOnly = true, cooldown = null }) {
        if (typeof execute !== 'function') {
            throw new Error(`Command ${name} must have an execute function`);
        }

        const command = {
            name,
            aliases,
            category,
            description,
            execute,
            adminOnly,
            guildOnly,
            cooldown
        };

        this.commands.set(name.toLowerCase(), command);

        // Register aliases
        for (const alias of aliases) {
            this.aliases.set(alias.toLowerCase(), name.toLowerCase());
        }

        // Add to category
        if (!this.categories.has(category)) {
            this.categories.set(category, []);
        }
        this.categories.get(category).push(name);

        logger.info(`[Registry] Comando registrado: ${name} (${category})`);
    }

    /**
     * Gets a command by name or alias
     * 
     * @param {string} nameOrAlias - Command name or alias
     * @returns {Object|null} Command object or null
     */
    get(nameOrAlias) {
        const normalized = nameOrAlias.toLowerCase();

        // Try direct match
        if (this.commands.has(normalized)) {
            return this.commands.get(normalized);
        }

        // Try alias
        if (this.aliases.has(normalized)) {
            const primaryName = this.aliases.get(normalized);
            return this.commands.get(primaryName);
        }

        return null;
    }

    /**
     * Gets all commands in a category
     * 
     * @param {string} category - Category name
     * @returns {Object[]} Array of commands
     */
    getByCategory(category) {
        const names = this.categories.get(category) || [];
        return names.map(name => this.commands.get(name)).filter(Boolean);
    }

    /**
     * Gets all registered commands
     * 
     * @returns {Object[]} Array of all commands
     */
    getAll() {
        return Array.from(this.commands.values());
    }

    /**
     * Gets command categories
     * 
     * @returns {string[]} Array of category names
     */
    getCategories() {
        return Array.from(this.categories.keys());
    }

    /**
     * Checks user cooldown
     * 
     * @param {string} userId - User ID
     * @param {Object} [command] - Command to check custom cooldown
     * @returns {Promise<boolean>} True if user can execute
     */
    async checkCooldown(userId, command = null) {
        const cooldownTime = command?.cooldown || COOLDOWN_TIME;
        const key = `cooldown:${userId}`;

        try {
            const count = await redis.incr(key);

            if (count === 1) {
                await redis.expire(key, cooldownTime);
            }

            if (count > COOLDOWN_LIMIT) {
                const ttl = await redis.ttl(key);
                throw new RateLimitError(ttl > 0 ? ttl : cooldownTime);
            }

            return true;
        } catch (error) {
            if (error instanceof RateLimitError) {
                throw error;
            }
            // On Redis error, allow execution to avoid blocking users
            logger.error('[Registry] Erro ao verificar cooldown:', error);
            return true;
        }
    }

    /**
     * Validates command permissions
     * 
     * @param {Object} message - Discord message
     * @param {Object} command - Command to validate
     * @throws {AuthorizationError} If user lacks permission
     */
    validatePermissions(message, command) {
        // Check guild-only commands
        if (command.guildOnly && !message.guild) {
            throw new AuthorizationError('Este comando só pode ser usado em servidores.');
        }

        // Check admin-only commands
        if (command.adminOnly) {
            const isAdmin = message.member?.permissions?.has('Administrator');
            if (!isAdmin) {
                throw new AuthorizationError('Este comando requer permissão de administrador.');
            }
        }
    }

    /**
     * Executes a command with all checks
     * 
     * @param {string} commandName - Command name or alias
     * @param {Object} message - Discord message
     * @param {string[]} args - Command arguments
     * @returns {Promise<boolean>} True if command was executed
     */
    async execute(commandName, message, args = []) {
        const command = this.get(commandName);

        if (!command) {
            return false;
        }

        // Permission validation
        this.validatePermissions(message, command);

        // Cooldown check
        await this.checkCooldown(message.author.id, command);

        // Execute command
        try {
            await command.execute(message, args);
            logger.info(`[Registry] Comando executado: ${command.name} por ${message.author.tag}`);
            return true;
        } catch (error) {
            logger.error(`[Registry] Erro ao executar ${command.name}:`, error);
            throw error;
        }
    }

    /**
     * Generates help text for all commands
     * 
     * @returns {string} Formatted help text
     */
    generateHelp() {
        let help = '**🤖 Comandos Disponíveis:**\n\n';

        for (const category of this.getCategories()) {
            const commands = this.getByCategory(category);
            if (commands.length === 0) continue;

            help += `**${category.charAt(0).toUpperCase() + category.slice(1)}:**\n`;

            for (const cmd of commands) {
                const aliasText = cmd.aliases.length > 0
                    ? ` (${cmd.aliases.join(', ')})`
                    : '';
                help += `• \`${cmd.name}\`${aliasText} - ${cmd.description}\n`;
            }
            help += '\n';
        }

        return help;
    }
}

// ============================================
// Singleton Export
// ============================================

const registry = new CommandRegistry();

module.exports = registry;
module.exports.CommandRegistry = CommandRegistry;
