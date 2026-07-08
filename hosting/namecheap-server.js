/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('node:path');

process.env.NODE_ENV = 'production';

const appDir = path.join(__dirname, 'app');
process.chdir(appDir);

require(path.join(appDir, 'server.js'));
