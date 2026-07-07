const RENAISS_ORIGIN = 'https://www.renaiss.xyz';

export function renaissCardUrl(tokenId: string): string {
  return `${RENAISS_ORIGIN}/card/${encodeURIComponent(tokenId.trim())}`;
}

export function renaissGachaPackUrl(slug: string): string {
  return `${RENAISS_ORIGIN}/gacha/${encodeURIComponent(slug.trim())}`;
}

export function renaissGachaUrl(): string {
  return `${RENAISS_ORIGIN}/gacha`;
}
