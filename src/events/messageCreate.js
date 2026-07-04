/**
 * Message Create Event Handler
 * Routes messages to the new modular command-router
 * 
 * Note: Original messageCreate.js backed up as messageCreate.js.bak
 */

const commandRouter = require('../handlers/command-router');

module.exports = commandRouter;
