/**
 * Centralized Error Handler Service
 * Provides consistent error handling across the application
 * 
 * @module services/error-handler
 */

const logger = require('../lib/logger');

// ============================================
// Custom Error Classes
// ============================================

/**
 * Base application error with user-friendly message support
 */
class AppError extends Error {
    /**
     * @param {string} message - Technical error message for logging
     * @param {number} statusCode - HTTP status code
     * @param {string} userMessage - User-friendly message to display
     * @param {string} code - Error code for programmatic handling
     */
    constructor(message, statusCode = 500, userMessage = null, code = 'INTERNAL_ERROR') {
        super(message);
        this.name = 'AppError';
        this.statusCode = statusCode;
        this.userMessage = userMessage || 'Ocorreu um erro inesperado. Tente novamente.';
        this.code = code;
        this.timestamp = new Date().toISOString();

        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * Validation error for invalid input
 */
class ValidationError extends AppError {
    constructor(message, details = []) {
        super(message, 400, 'Dados inválidos. Verifique sua entrada.', 'VALIDATION_ERROR');
        this.name = 'ValidationError';
        this.details = details;
    }
}

/**
 * Authentication error
 */
class AuthenticationError extends AppError {
    constructor(message = 'Authentication required') {
        super(message, 401, 'Você precisa estar autenticado para acessar este recurso.', 'AUTH_REQUIRED');
        this.name = 'AuthenticationError';
    }
}

/**
 * Authorization error for insufficient permissions
 */
class AuthorizationError extends AppError {
    constructor(message = 'Insufficient permissions') {
        super(message, 403, 'Você não tem permissão para realizar esta ação.', 'FORBIDDEN');
        this.name = 'AuthorizationError';
    }
}

/**
 * Resource not found error
 */
class NotFoundError extends AppError {
    constructor(resource = 'Resource') {
        super(`${resource} not found`, 404, `${resource} não encontrado.`, 'NOT_FOUND');
        this.name = 'NotFoundError';
    }
}

/**
 * Rate limit exceeded error
 */
class RateLimitError extends AppError {
    constructor(retryAfter = 60) {
        super('Rate limit exceeded', 429,
            `Muitas requisições. Tente novamente em ${retryAfter} segundos.`,
            'RATE_LIMITED');
        this.name = 'RateLimitError';
        this.retryAfter = retryAfter;
    }
}

/**
 * External service error (AI, APIs, etc.)
 */
class ExternalServiceError extends AppError {
    constructor(service, originalError = null) {
        super(`External service error: ${service}`, 502,
            'Serviço temporariamente indisponível. Tente novamente em alguns minutos.',
            'EXTERNAL_SERVICE_ERROR');
        this.name = 'ExternalServiceError';
        this.service = service;
        this.originalError = originalError;
    }
}

/**
 * Database error
 */
class DatabaseError extends AppError {
    constructor(operation, originalError = null) {
        super(`Database error during ${operation}`, 500,
            'Erro ao acessar dados. Tente novamente.',
            'DATABASE_ERROR');
        this.name = 'DatabaseError';
        this.operation = operation;
        this.originalError = originalError;
    }
}

// ============================================
// Error Handler Functions
// ============================================

/**
 * Logs error with appropriate level and context
 * 
 * @param {Error} error - Error to log
 * @param {Object} context - Additional context
 */
function logError(error, context = {}) {
    const logData = {
        name: error.name,
        message: error.message,
        code: error.code,
        stack: error.stack,
        ...context
    };

    if (error instanceof ValidationError) {
        logger.warn('Validation error:', logData);
    } else if (error instanceof AuthenticationError || error instanceof AuthorizationError) {
        logger.warn('Auth error:', logData);
    } else if (error instanceof NotFoundError) {
        logger.info('Not found:', logData);
    } else if (error instanceof RateLimitError) {
        logger.info('Rate limited:', logData);
    } else if (error instanceof ExternalServiceError) {
        logger.error('External service error:', {
            ...logData,
            originalError: error.originalError?.message
        });
    } else if (error instanceof DatabaseError) {
        logger.error('Database error:', {
            ...logData,
            originalError: error.originalError?.message
        });
    } else {
        logger.error('Unhandled error:', logData);
    }
}

/**
 * Express error handling middleware
 * 
 * @returns {Function} Express error middleware
 */
function expressErrorHandler() {
    return (error, req, res, next) => {
        logError(error, {
            method: req.method,
            path: req.path,
            ip: req.ip,
            userId: req.session?.userId
        });

        // Handle known application errors
        if (error instanceof AppError) {
            const response = {
                error: error.userMessage,
                code: error.code
            };

            if (error instanceof ValidationError && error.details.length > 0) {
                response.details = error.details;
            }

            if (error instanceof RateLimitError) {
                res.set('Retry-After', error.retryAfter);
            }

            return res.status(error.statusCode).json(response);
        }

        // Handle unexpected errors
        return res.status(500).json({
            error: 'Erro interno do servidor. Por favor, tente novamente.',
            code: 'INTERNAL_ERROR'
        });
    };
}

/**
 * Handles Discord message errors gracefully
 * 
 * @param {Object} message - Discord message object
 * @param {Error} error - Error to handle
 * @param {string} context - Context description
 */
async function handleDiscordError(messageOrInteraction, error, context = 'processing') {
    const isInteraction = messageOrInteraction && (typeof messageOrInteraction.isChatInputCommand === 'function' || !messageOrInteraction.author);
    const userId = isInteraction ? messageOrInteraction?.user?.id : messageOrInteraction?.author?.id;
    const guildId = messageOrInteraction?.guildId;
    const channelId = messageOrInteraction?.channelId;

    logError(error, {
        context,
        guildId,
        channelId,
        userId
    });

    let replyMsg = '❌ Estou passando por instabilidades técnicas. Por favor, tente novamente em alguns instantes.';
    if (error instanceof RateLimitError) {
        replyMsg = `⏳ ${error.userMessage}`;
    } else if (error instanceof AuthorizationError) {
        replyMsg = `🔒 ${error.userMessage}`;
    } else if (error instanceof ExternalServiceError) {
        replyMsg = `⚠️ ${error.userMessage}`;
    } else if (error instanceof ValidationError) {
        replyMsg = `❌ ${error.userMessage}`;
    }

    try {
        if (isInteraction) {
            if (messageOrInteraction.replied || messageOrInteraction.deferred) {
                await messageOrInteraction.followUp({ content: replyMsg, ephemeral: true });
            } else {
                await messageOrInteraction.reply({ content: replyMsg, ephemeral: true });
            }
        } else {
            await messageOrInteraction.reply(replyMsg);
        }
    } catch (replyError) {
        logger.error('Failed to send error reply:', { originalError: error.message, replyError: replyError.message });
    }
}

/**
 * Wraps an async function with error handling
 * 
 * @param {Function} fn - Async function to wrap
 * @returns {Function} Wrapped function
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/**
 * Wraps a Discord command handler with error handling
 * 
 * @param {Function} handler - Command handler function
 * @param {string} commandName - Name of command for logging
 * @returns {Function} Wrapped handler
 */
function wrapCommandHandler(handler, commandName) {
    return async (message, ...args) => {
        try {
            return await handler(message, ...args);
        } catch (error) {
            await handleDiscordError(message, error, `command:${commandName}`);
            return null;
        }
    };
}

// ============================================
// Exports
// ============================================

module.exports = {
    // Error Classes
    AppError,
    ValidationError,
    AuthenticationError,
    AuthorizationError,
    NotFoundError,
    RateLimitError,
    ExternalServiceError,
    DatabaseError,

    // Handler Functions
    logError,
    expressErrorHandler,
    handleDiscordError,
    asyncHandler,
    wrapCommandHandler
};
