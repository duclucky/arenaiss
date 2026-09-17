import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ARC_TESTNET_RPC_URL, arcReadRpcUrls } from '../../services/api/src/arc-rpc.ts';

const root = resolve(import.meta.dirname, '../..');
const canonicalRpc = 'https://rpc.testnet.arc.io';
const retiredRpc = 'https://rpc.testnet.arc.network';

test('production uses the current Arc Testnet RPC endpoint', () => {
  const compose = readFileSync(resolve(root, 'compose.yaml'), 'utf8');
  const caddy = readFileSync(resolve(root, 'deploy/Caddyfile'), 'utf8');

  assert.match(compose, new RegExp(canonicalRpc.replaceAll('.', '\\.')));
  assert.doesNotMatch(compose, new RegExp(retiredRpc.replaceAll('.', '\\.')));
  assert.match(caddy, new RegExp(canonicalRpc.replaceAll('.', '\\.')));
  assert.doesNotMatch(caddy, new RegExp(retiredRpc.replaceAll('.', '\\.')));
});

test('Arc reads retain official failover endpoints without duplicating the primary', () => {
  assert.equal(ARC_TESTNET_RPC_URL, canonicalRpc);
  assert.deepEqual(arcReadRpcUrls(canonicalRpc), [
    canonicalRpc,
    'https://rpc.drpc.testnet.arc.io',
    'https://rpc.blockdaemon.testnet.arc.io',
    'https://rpc.quicknode.testnet.arc.io',
  ]);
  assert.deepEqual(arcReadRpcUrls('https://private.example/rpc').slice(0, 2), [
    'https://private.example/rpc',
    canonicalRpc,
  ]);
});
