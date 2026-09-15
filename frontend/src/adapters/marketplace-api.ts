import type { MarketplaceApiAdapter, MarketplaceCertificate, MarketplaceListing } from './interfaces';

type Fetcher = typeof fetch;
export class HttpMarketplaceAdapter implements MarketplaceApiAdapter {
  constructor(private readonly baseUrl: string, private readonly fetcher: Fetcher = fetch) {}
  listListings() { return this.request<MarketplaceListing[]>('/api/marketplace/listings'); }
  listCertificates() { return this.request<MarketplaceCertificate[]>('/api/marketplace/certificates'); }
  createEligibility(input: Parameters<MarketplaceApiAdapter['createEligibility']>[0]) { return this.request<MarketplaceCertificate>('/api/marketplace/eligibility', { method: 'POST', body: JSON.stringify(input) }); }
  createListing(input: Parameters<MarketplaceApiAdapter['createListing']>[0]) { return this.request<MarketplaceListing>('/api/marketplace/listings', { method: 'POST', body: JSON.stringify(input) }); }
  buy(listingId: string, approvalIdempotencyKey: string, buyIdempotencyKey: string) { return this.request<MarketplaceListing>(`/api/marketplace/listings/${listingId}/buy`, { method: 'POST', body: JSON.stringify({ approvalIdempotencyKey, buyIdempotencyKey }) }); }
  getDelivery(listingId: string) { return this.request<{ agentId: string; agentVersionId: string; agentsCommitment: string; agentsMd: string }>(`/api/marketplace/listings/${listingId}/delivery`); }
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> { const response = await this.fetcher.call(globalThis, `${this.baseUrl.replace(/\/$/, '')}${path}`, { ...init, credentials: 'include', headers: init.body ? { 'content-type': 'application/json' } : undefined }); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `HTTP_${response.status}`); return body as T; }
}
