/**
 * Unit Tests for Command Registry
 */

const { CommandRegistry } = require('../../src/services/command-registry');

describe('CommandRegistry', () => {
    let registry;

    beforeEach(() => {
        registry = new CommandRegistry();
    });

    describe('register', () => {
        it('should register a command', () => {
            registry.register({
                name: 'test',
                aliases: ['t'],
                category: 'testing',
                description: 'Test command',
                execute: jest.fn()
            });

            expect(registry.get('test')).toBeDefined();
            expect(registry.get('test').name).toBe('test');
        });

        it('should register aliases', () => {
            const execute = jest.fn();
            registry.register({
                name: 'test',
                aliases: ['t', 'tst'],
                category: 'testing',
                description: 'Test command',
                execute
            });

            expect(registry.get('t')).toBeDefined();
            expect(registry.get('tst')).toBeDefined();
            expect(registry.get('t').execute).toBe(execute);
        });

        it('should throw if execute is not a function', () => {
            expect(() => {
                registry.register({
                    name: 'test',
                    description: 'Test',
                    execute: 'not a function'
                });
            }).toThrow();
        });
    });

    describe('get', () => {
        it('should return null for unknown command', () => {
            expect(registry.get('unknown')).toBeNull();
        });

        it('should be case insensitive', () => {
            registry.register({
                name: 'Test',
                description: 'Test',
                execute: jest.fn()
            });

            expect(registry.get('test')).toBeDefined();
            expect(registry.get('TEST')).toBeDefined();
        });
    });

    describe('getByCategory', () => {
        it('should return commands in category', () => {
            registry.register({
                name: 'cmd1',
                category: 'cat1',
                description: 'Cmd 1',
                execute: jest.fn()
            });
            registry.register({
                name: 'cmd2',
                category: 'cat1',
                description: 'Cmd 2',
                execute: jest.fn()
            });
            registry.register({
                name: 'cmd3',
                category: 'cat2',
                description: 'Cmd 3',
                execute: jest.fn()
            });

            const cat1Commands = registry.getByCategory('cat1');
            expect(cat1Commands).toHaveLength(2);
            expect(cat1Commands.map(c => c.name)).toContain('cmd1');
            expect(cat1Commands.map(c => c.name)).toContain('cmd2');
        });

        it('should return empty array for unknown category', () => {
            expect(registry.getByCategory('unknown')).toEqual([]);
        });
    });

    describe('getAll', () => {
        it('should return all registered commands', () => {
            registry.register({ name: 'a', description: 'A', execute: jest.fn() });
            registry.register({ name: 'b', description: 'B', execute: jest.fn() });

            expect(registry.getAll()).toHaveLength(2);
        });
    });

    describe('validatePermissions', () => {
        it('should throw for guild-only command in DM', () => {
            registry.register({
                name: 'guildcmd',
                description: 'Guild only',
                guildOnly: true,
                execute: jest.fn()
            });

            const message = { guild: null };
            const command = registry.get('guildcmd');

            expect(() => {
                registry.validatePermissions(message, command);
            }).toThrow();
        });

        it('should throw for admin command without permission', () => {
            registry.register({
                name: 'admincmd',
                description: 'Admin only',
                adminOnly: true,
                execute: jest.fn()
            });

            const message = {
                guild: { id: '123' },
                member: { permissions: { has: () => false } }
            };
            const command = registry.get('admincmd');

            expect(() => {
                registry.validatePermissions(message, command);
            }).toThrow();
        });

        it('should pass for admin command with permission', () => {
            registry.register({
                name: 'admincmd',
                description: 'Admin only',
                adminOnly: true,
                execute: jest.fn()
            });

            const message = {
                guild: { id: '123' },
                member: { permissions: { has: () => true } }
            };
            const command = registry.get('admincmd');

            expect(() => {
                registry.validatePermissions(message, command);
            }).not.toThrow();
        });
    });

    describe('generateHelp', () => {
        it('should generate help text with categories', () => {
            registry.register({
                name: 'cmd1',
                category: 'general',
                description: 'Command 1',
                execute: jest.fn()
            });

            const help = registry.generateHelp();

            expect(help).toContain('cmd1');
            expect(help).toContain('Command 1');
            expect(help).toContain('General');
        });
    });
});
