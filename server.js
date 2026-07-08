/* eslint-disable @typescript-eslint/no-require-imports */
const { createServer } = require('node:http');
const next = require('next');

function readPort() {
  const portFromEnv = Number(process.env.PORT);
  if (Number.isFinite(portFromEnv) && portFromEnv > 0) return portFromEnv;
  const portFlagIndex = process.argv.findIndex((arg) => arg === '-p' || arg === '--port');
  const portFromFlag = portFlagIndex >= 0 ? Number(process.argv[portFlagIndex + 1]) : NaN;
  if (Number.isFinite(portFromFlag) && portFromFlag > 0) return portFromFlag;
  return 3000;
}

const port = readPort();
const hostname = process.env.HOSTNAME || '127.0.0.1';
const app = next({ dev: false, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer((req, res) => handle(req, res)).listen(port, hostname, () => {
    console.log(`Arenaiss ready on http://${hostname}:${port}`);
  });
});
