/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'production';

const bootLogPath = path.join(__dirname, 'boot.log');
function logBoot(message) {
  fs.appendFileSync(bootLogPath, `[${new Date().toISOString()}] ${message}\n`);
}

process.on('uncaughtException', (error) => {
  logBoot(`uncaughtException: ${error && error.stack ? error.stack : error}`);
  throw error;
});

process.on('unhandledRejection', (error) => {
  logBoot(`unhandledRejection: ${error && error.stack ? error.stack : error}`);
});

const appDir = path.join(__dirname, 'app');
logBoot(`starting wrapper node=${process.version} cwd=${process.cwd()} port=${process.env.PORT || 'unset'} hostname=${process.env.HOSTNAME || 'unset'}`);
logBoot(`paths appServer=${fs.existsSync(path.join(appDir, 'server.js'))} nextModule=${fs.existsSync(path.join(appDir, 'node_modules', 'next'))}`);
process.chdir(appDir);

require(path.join(appDir, 'server.js'));
