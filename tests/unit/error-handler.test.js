/**
 * Unit Tests for Error Handler
 */

const {
    AppError,
    ValidationError,
    AuthenticationError,
    AuthorizationError,
    NotFoundError,
    RateLimitError,
    ExternalServiceError,
    DatabaseError,
    logError,
    expressErrorHandler
} = require('../../src/services/error-handler');

describe('Error Classes', () => {
    describe('AppError', () => {
        it('should create error with default values', () => {
            const error = new AppError('Test error');

            expect(error.message).toBe('Test error');
            expect(error.statusCode).toBe(500);
            expect(error.code).toBe('INTERNAL_ERROR');
            expect(error.userMessage).toBeDefined();
            expect(error.timestamp).toBeDefined();
        });

        it('should create error with custom values', () => {
            const error = new AppError('Test', 400, 'User message', 'CUSTOM_CODE');

            expect(error.statusCode).toBe(400);
            expect(error.userMessage).toBe('User message');
            expect(error.code).toBe('CUSTOM_CODE');
        });
    });

    describe('ValidationError', () => {
        it('should have correct status code and details', () => {
            const error = new ValidationError('Invalid input', [
                { field: 'email', message: 'Invalid email' }
            ]);

            expect(error.statusCode).toBe(400);
            expect(error.code).toBe('VALIDATION_ERROR');
            expect(error.details).toHaveLength(1);
        });
    });

    describe('AuthenticationError', () => {
        it('should have 401 status code', () => {
            const error = new AuthenticationError();
            expect(error.statusCode).toBe(401);
            expect(error.code).toBe('AUTH_REQUIRED');
        });
    });

    describe('AuthorizationError', () => {
        it('should have 403 status code', () => {
            const error = new AuthorizationError();
            expect(error.statusCode).toBe(403);
            expect(error.code).toBe('FORBIDDEN');
        });
    });

    describe('NotFoundError', () => {
        it('should have 404 status code', () => {
            const error = new NotFoundError('User');
            expect(error.statusCode).toBe(404);
            expect(error.message).toBe('User not found');
        });
    });

    describe('RateLimitError', () => {
        it('should have 429 status code and retry info', () => {
            const error = new RateLimitError(30);
            expect(error.statusCode).toBe(429);
            expect(error.retryAfter).toBe(30);
            expect(error.userMessage).toContain('30');
        });
    });

    describe('ExternalServiceError', () => {
        it('should have 502 status code and service info', () => {
            const originalError = new Error('Connection failed');
            const error = new ExternalServiceError('OpenAI', originalError);

            expect(error.statusCode).toBe(502);
            expect(error.service).toBe('OpenAI');
            expect(error.originalError).toBe(originalError);
        });
    });

    describe('DatabaseError', () => {
        it('should have 500 status code and operation info', () => {
            const error = new DatabaseError('INSERT');
            expect(error.statusCode).toBe(500);
            expect(error.operation).toBe('INSERT');
        });
    });
});

describe('expressErrorHandler', () => {
    let mockReq, mockRes, mockNext;

    beforeEach(() => {
        mockReq = {
            method: 'GET',
            path: '/test',
            ip: '127.0.0.1',
            session: {}
        };
        mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
            set: jest.fn()
        };
        mockNext = jest.fn();
    });

    it('should handle AppError correctly', () => {
        const handler = expressErrorHandler();
        const error = new ValidationError('Bad input');

        handler(error, mockReq, mockRes, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.json).toHaveBeenCalledWith(
            expect.objectContaining({
                code: 'VALIDATION_ERROR'
            })
        );
    });

    it('should set Retry-After header for RateLimitError', () => {
        const handler = expressErrorHandler();
        const error = new RateLimitError(60);

        handler(error, mockReq, mockRes, mockNext);

        expect(mockRes.set).toHaveBeenCalledWith('Retry-After', 60);
        expect(mockRes.status).toHaveBeenCalledWith(429);
    });

    it('should handle unknown errors with 500', () => {
        const handler = expressErrorHandler();
        const error = new Error('Unknown error');

        handler(error, mockReq, mockRes, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(500);
        expect(mockRes.json).toHaveBeenCalledWith(
            expect.objectContaining({
                code: 'INTERNAL_ERROR'
            })
        );
    });
});
