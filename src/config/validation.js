/**
 * Schemas de Validação com Zod
 * Centraliza todas as validações de input do sistema
 */

const { z } = require('zod');

// ========================================
// DISCORD IDs (Snowflakes)
// ========================================
const discordIdSchema = z.string().regex(/^\d{17,19}$/, 'ID do Discord deve ter 17-19 dígitos');

// ========================================
// API Web - Whitelist
// ========================================
const whitelistSchema = z.object({
  guild_id: discordIdSchema,
  type: z.enum(['user', 'role', 'block'], {
    errorMap: () => ({ message: 'Tipo deve ser: user, role ou block' })
  }),
  id: discordIdSchema
});

// ========================================
// API Web - Memórias
// ========================================
const memoryQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().min(1).max(100)).optional(),
  offset: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().min(0)).optional(),
  guild_id: discordIdSchema.optional(),
  user_id: discordIdSchema.optional()
});

const memorySearchSchema = z.object({
  query: z.string().min(1).max(500),
  guild_id: discordIdSchema.optional(),
  user_id: discordIdSchema.optional()
});

const bulkDeleteSchema = z.object({
  ids: z.array(z.number().positive()).min(1).max(100)
});

// ========================================
// API Web - Guild Info
// ========================================
const guildInfoSchema = z.object({
  info: z.string().max(2000).optional(),
  persona: z.string().max(1000).optional()
});

// ========================================
// Login
// ========================================
const loginSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(8).max(100)
});

// ========================================
// Função Helper para Validação
// ========================================
function validateRequest(schema) {
  return (req, res, next) => {
    try {
      const validated = schema.parse(req.body.guild_id ? req.body : req.query);
      req.validated = validated;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Dados inválidos',
          details: error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message
          }))
        });
      }
      next(error);
    }
  };
}

// ========================================
// Validação de Parâmetros de Rota
// ========================================
function validateParams(schema) {
  return (req, res, next) => {
    try {
      const validated = schema.parse(req.params);
      req.validatedParams = validated;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Parâmetros inválidos',
          details: error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message
          }))
        });
      }
      next(error);
    }
  };
}

module.exports = {
  // Schemas
  discordIdSchema,
  whitelistSchema,
  memoryQuerySchema,
  memorySearchSchema,
  bulkDeleteSchema,
  guildInfoSchema,
  loginSchema,
  
  // Helpers
  validateRequest,
  validateParams
};
