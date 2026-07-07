import 'server-only';

// Helper GỌI Index API (api.renaissos.com). CHỈ chạy server-side.
// Gắn CẢ HAI header trên mọi request /v1 (theo hướng dẫn trang API key).
// Key đọc từ process.env — KHÔNG bao giờ prefix NEXT_PUBLIC_, KHÔNG lộ ra client.

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const BASE = process.env.RENAISS_INDEX_BASE ?? 'https://api.renaissos.com';
const KEY = process.env.RENAISS_INDEX_API_KEY;
const SECRET = process.env.RENAISS_INDEX_API_SECRET;

// path phải bắt đầu bằng /v1/... (vd '/v1/search?q=charizard')
export async function indexFetch<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<Result<T>> {
  if (!KEY || !SECRET) {
    return { ok: false, error: 'Thiếu RENAISS_INDEX_API_KEY / _SECRET trong .env.local' };
  }
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        'X-Api-Key': KEY,
        'X-Api-Secret': SECRET,
        ...(init?.headers ?? {}),
      },
      next: { revalidate: 60 }, // cache 60s để đỡ chạm quota khi demo
    });
    if (!res.ok) {
      return { ok: false, error: `Index API ${res.status} ${res.statusText}` };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown error' };
  }
}
