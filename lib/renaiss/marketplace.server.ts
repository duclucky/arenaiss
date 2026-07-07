import 'server-only';

// Helper GỌI Marketplace API (api.renaiss.xyz). Public read — KHÔNG cần key.
// Vẫn để sau server để tránh CORS, gom cache, kiểm soát rate-limit một chỗ.
// CHỈ dùng GET. TUYỆT ĐỐI không có đường ghi/ký ví ở đây.

import type { Result } from './index.server';

const BASE = process.env.RENAISS_MARKETPLACE_BASE ?? 'https://api.renaiss.xyz';

// path phải bắt đầu bằng /v0/... (vd '/v0/marketplace?categoryFilter=POKEMON')
export async function marketplaceFetch<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<Result<T>> {
  // Upstream rate-limit khá gắt khi burst → retry nhẹ với backoff. Cache 60s để
  // demo mượt (lần sau lấy từ cache, không chạm upstream).
  let lastErr = 'unknown error';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, { ...init, next: { revalidate: 60 } });
      if (res.ok) return { ok: true, data: (await res.json()) as T };
      lastErr = `Marketplace API ${res.status} ${res.statusText}`;
      if (res.status === 429 || res.status === 403 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        continue;
      }
      return { ok: false, error: lastErr };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : 'unknown error';
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
  return { ok: false, error: lastErr };
}

// Giá từ API là CHUỖI, có thể "NO-ASK-PRICE" / "NO-FMV-PRICE".
// Luôn chuẩn hoá trước khi tính toán.
export function parsePrice(raw: string | null | undefined): number | null {
  if (!raw || raw === 'NO-ASK-PRICE' || raw === 'NO-FMV-PRICE') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
