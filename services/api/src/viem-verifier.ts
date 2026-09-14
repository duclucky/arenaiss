import type { SignatureVerifier } from './http.ts';
import { getAddress, verifyMessage } from 'viem';

export const viemSignatureVerifier: SignatureVerifier = async ({ address, message, signature }) => {
  try {
    return await verifyMessage({ address: getAddress(address), message, signature: signature as `0x${string}` });
  } catch {
    return false;
  }
};
