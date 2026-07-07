// Sinh seed cho mỗi lần mở gói. Seed là NGẪU NHIÊN mỗi gói (crypto), nhưng khi
// đã có seed thì kết quả rút TÁI LẬP được (openPack là deterministic theo seed).
export function makePackSeed(index: number): string {
  const buf = new Uint32Array(2);
  (globalThis.crypto ?? crypto).getRandomValues(buf);
  return `pack-${index}-${buf[0].toString(36)}${buf[1].toString(36)}`;
}

// Seed trận đấu: kết hợp deck tokens để tái lập; thêm nonce ngẫu nhiên cho biến thể.
export function makeBattleSeed(playerTokens: string[]): string {
  const buf = new Uint32Array(1);
  (globalThis.crypto ?? crypto).getRandomValues(buf);
  return `battle-${playerTokens.map((t) => t.slice(0, 4)).join('')}-${buf[0].toString(36)}`;
}
