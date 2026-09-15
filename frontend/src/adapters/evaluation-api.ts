import type { EvaluationApiAdapter, EvaluationCampaign, EvaluationPack, EvaluationRun } from './interfaces';
type Fetcher = typeof fetch;
export class HttpEvaluationAdapter implements EvaluationApiAdapter {
  private base: string; private fetcher: Fetcher; private auth: () => Promise<void>;
  constructor(baseUrl: string, auth: () => Promise<void>, fetcher: Fetcher = fetch) { this.base = baseUrl.replace(/\/$/, ''); this.auth = auth; this.fetcher = fetcher; }
  async listCampaigns() { await this.auth(); return this.request<EvaluationCampaign[]>('/api/evaluation-campaigns'); }
  async getCampaign(id: string) { const r = await this.fetcher.call(globalThis, `${this.base}/api/evaluation-campaigns/${encodeURIComponent(id)}`, { credentials: 'omit' }); if (r.status === 404) return null; return this.read<EvaluationCampaign>(r); }
  async listRuns() { await this.auth(); return this.request<EvaluationRun[]>('/api/evaluation-runs'); }
  async getRun(id: string, privateView = false) { if (privateView) await this.auth(); return this.request<Awaited<ReturnType<EvaluationApiAdapter['getRun']>>>(`/api/evaluation-runs/${encodeURIComponent(id)}${privateView ? '/private' : ''}`, { method: 'GET' }); }
  async createPack(input: Parameters<EvaluationApiAdapter['createPack']>[0]) { await this.auth(); return this.request<EvaluationPack>('/api/evaluation-packs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }); }
  async createSoloCampaign(input: Parameters<EvaluationApiAdapter['createSoloCampaign']>[0]) { await this.auth(); return this.request<EvaluationCampaign>('/api/evaluation-campaigns', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }); }
  async getExecutionConfig() { return this.request<{ enabled: boolean; feeUsdc?: string; feeAsset: 'USDC'; genLayerGasPayer: 'OWNER' }>('/api/evaluation-config'); }
  async startEvo(input: { agentId: string; agentsVersion: string }) { await this.auth(); return this.request<EvaluationCampaign>('/api/evaluation-campaigns/evo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }); }
  async advanceCampaign(campaignId: string) { await this.auth(); return this.request<EvaluationCampaign>(`/api/evaluation-campaigns/${encodeURIComponent(campaignId)}/advance`, { method: 'POST' }); }
  async listComparisons() { await this.auth(); return this.request<Awaited<ReturnType<EvaluationApiAdapter['listComparisons']>>>('/api/evaluation-comparisons'); }
  async getComparison(id: string) { await this.auth(); return this.request<Awaited<ReturnType<EvaluationApiAdapter['getComparison']>>>(`/api/evaluation-comparisons/${encodeURIComponent(id)}`); }
  async createVersionComparison(input: Parameters<EvaluationApiAdapter['createVersionComparison']>[0]) { await this.auth(); return this.request<Awaited<ReturnType<EvaluationApiAdapter['createVersionComparison']>>>('/api/evaluation-comparisons', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }); }
  private async request<T>(path: string, init: RequestInit = {}) { return this.read<T>(await this.fetcher.call(globalThis, `${this.base}${path}`, { ...init, credentials: init.credentials || 'include' })); }
  private async read<T>(response: Response): Promise<T> { if (!response.ok) { const detail = await response.json().catch(() => ({})); throw new Error(typeof detail.error === 'string' ? detail.error : `HTTP_${response.status}`); } return response.status === 204 ? undefined as T : response.json() as Promise<T>; }
}
