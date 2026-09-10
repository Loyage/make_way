'use strict';
const server = require('./src/server/admin-server.js');

if (require.main === module) {
  server.main().catch(error => { console.error(error.message);process.exitCode = 1; });
}

module.exports = server;
