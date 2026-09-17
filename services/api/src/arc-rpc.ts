import { fallback, http } from 'viem';

export const ARC_TESTNET_RPC_URL = 'https://rpc.testnet.arc.io';

const ARC_TESTNET_READ_RPCS = [
  ARC_TESTNET_RPC_URL,
  'https://rpc.drpc.testnet.arc.io',
  'https://rpc.blockdaemon.testnet.arc.io',
  'https://rpc.quicknode.testnet.arc.io',
] as const;

export function arcRpcUrl(configured?: string): string {
  const url = configured?.trim() || ARC_TESTNET_RPC_URL;
  if (new URL(url).protocol !== 'https:') throw new Error('invalid Arc RPC URL');
  return url;
}

export function arcReadRpcUrls(configured?: string): string[] {
  return [...new Set([arcRpcUrl(configured), ...ARC_TESTNET_READ_RPCS])];
}

export function arcReadTransport(configured?: string) {
  return fallback(
    arcReadRpcUrls(configured).map((url) => http(url, { retryCount: 1, retryDelay: 250, timeout: 10_000 })),
    { retryCount: 0 },
  );
}

export function arcWriteTransport(configured?: string) {
  return http(arcRpcUrl(configured), { retryCount: 2, retryDelay: 500, timeout: 15_000 });
}
