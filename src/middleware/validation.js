/**
 * Validation Middleware with Zod Schemas
 * Centralized input validation for web API endpoints
 * 
 * @module middleware/validation
 */

const { z } = require('zod');
const logger = require('../lib/logger');

// ============================================
// Discord ID Validation Patterns
// ============================================

// Discord Snowflake IDs are 17-19 digit strings
const discordIdSchema = z.string().regex(/^\d{17,19}$/, 'Invalid Discord ID format');

// ============================================
// API Endpoint Schemas
// ============================================

/**
 * Login request validation
 */
const loginSchema = z.object({
    username: z.string()
        .min(1, 'Username is required')
        .max(50, 'Username too long')
        .trim(),
    password: z.string()
        .min(1, 'Password is required')
        .max(128, 'Password too long')
});

/**
 * Memory search validation
 */
const memorySearchSchema = z.object({
    guild_id: discordIdSchema.optional(),
    user_id: discordIdSchema.optional(),
    query: z.string()
        .min(1, 'Search query is required')
        .max(500, 'Search query too long')
        .trim()
});

/**
 * Memory delete validation
 */
const memoryDeleteSchema = z.object({
    id: z.number().int().positive('Invalid memory ID')
});

/**
 * Bulk delete validation
 */
const bulkDeleteSchema = z.object({
    ids: z.array(z.number().int().positive())
        .min(1, 'At least one ID required')
        .max(100, 'Maximum 100 items per batch')
});

/**
 * Permission update validation
 */
const permissionSchema = z.object({
    guild_id: discordIdSchema,
    role: z.enum(['everyone', 'admin', 'helper'], {
        errorMap: () => ({ message: 'Role must be: everyone, admin, or helper' })
    })
});

/**
 * Whitelist modification validation
 */
const whitelistSchema = z.object({
    guild_id: discordIdSchema,
    type: z.enum(['user', 'role'], {
        errorMap: () => ({ message: 'Type must be: user or role' })
    }),
    id: discordIdSchema
});

/**
 * Guild whitelist validation
 */
const guildWhitelistSchema = z.object({
    guildId: discordIdSchema
});

/**
 * Pagination query validation
 */
const paginationSchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    guild_id: discordIdSchema.optional(),
    user_id: discordIdSchema.optional()
});

// ============================================
// Utility Functions
// ============================================

/**
 * Sanitizes input for SQL LIKE queries
 * Escapes special characters that have meaning in LIKE patterns
 * 
 * @param {string} input - Raw input string
 * @returns {string} Sanitized string safe for LIKE queries
 */
function sanitizeLikeInput(input) {
    if (typeof input !== 'string') {
        return '';
    }
    // Escape LIKE wildcards: % and _
    // Also escape backslash since it's the escape character
    return input
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_');
}

/**
 * Validates and sanitizes a Discord message content
 * 
 * @param {string} content - Message content to validate
 * @param {number} maxLength - Maximum allowed length
 * @returns {string} Sanitized content
 */
function sanitizeMessageContent(content, maxLength = 2000) {
    if (typeof content !== 'string') {
        return '';
    }
    return content.substring(0, maxLength).trim();
}

/**
 * Validates URL format for various services
 * 
 * @param {string} url - URL to validate
 * @param {string[]} allowedExtensions - Allowed file extensions
 * @returns {boolean} Whether URL is valid
 */
function isValidUrl(url, allowedExtensions = []) {
    try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return false;
        }
        if (allowedExtensions.length > 0) {
            const ext = parsed.pathname.split('.').pop()?.toLowerCase();
            return allowedExtensions.includes(ext);
        }
        return true;
    } catch {
        return false;
    }
}

/**
 * Image URL validation
 */
const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
const isValidImageUrl = (url) => isValidUrl(url, imageExtensions);

/**
 * PDF URL validation
 */
const isValidPdfUrl = (url) => isValidUrl(url, ['pdf']);

// ============================================
// Express Middleware
// ============================================

/**
 * Creates a validation middleware for request body
 * 
 * @param {z.ZodSchema} schema - Zod schema to validate against
 * @param {string} source - Where to look for data: 'body', 'query', 'params'
 * @returns {Function} Express middleware
 */
function validateRequest(schema, source = 'body') {
    return (req, res, next) => {
        try {
            const dataSource = source === 'body' ? req.body 
                             : source === 'query' ? req.query 
                             : req.params;
            
            const validated = schema.parse(dataSource);
            
            // Store validated data for handler use
            req.validated = validated;
            next();
        } catch (error) {
            if (error instanceof z.ZodError) {
                const errorMessages = error.errors.map(e => ({
                    field: e.path.join('.'),
                    message: e.message
                }));
                
                logger.warn('Validation failed:', { 
                    path: req.path, 
                    errors: errorMessages 
                });
                
                return res.status(400).json({
                    error: 'Validation failed',
                    details: errorMessages
                });
            }
            
            logger.error('Unexpected validation error:', error);
            return res.status(500).json({ error: 'Internal server error' });
        }
    };
}

/**
 * Creates a validation middleware for query parameters
 */
function validateQuery(schema) {
    return validateRequest(schema, 'query');
}

/**
 * Creates a validation middleware for URL parameters
 */
function validateParams(schema) {
    return validateRequest(schema, 'params');
}

// ============================================
// Export All Validation Tools
// ============================================

module.exports = {
    // Schemas
    loginSchema,
    memorySearchSchema,
    memoryDeleteSchema,
    bulkDeleteSchema,
    permissionSchema,
    whitelistSchema,
    guildWhitelistSchema,
    paginationSchema,
    discordIdSchema,
    
    // Utility Functions
    sanitizeLikeInput,
    sanitizeMessageContent,
    isValidUrl,
    isValidImageUrl,
    isValidPdfUrl,
    
    // Middleware
    validateRequest,
    validateQuery,
    validateParams
};
