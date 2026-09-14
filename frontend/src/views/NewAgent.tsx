import { FormEvent, useState } from 'react';
import { FileText, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context';

const MAX_BYTES = 32_768;
const FUTURE_AGENT_FILES = [
  { name: 'SKILL.md', description: 'Reusable procedures for specialized tasks.' },
] as const;

export function NewAgent() {
  const { account, agentApi } = useAppContext();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [agentsMd, setAgentsMd] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const bytes = new Blob([agentsMd]).size;

  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    if (!account || !agentApi) return setError('Connect a wallet and configure the Agent API first.');
    if (!name.trim() || !agentsMd.trim() || bytes > MAX_BYTES) return setError('Provide a name and an AGENTS.md within 32,768 bytes.');
    setPending(true);
    try { await agentApi.createAgent(name.trim(), agentsMd); navigate('/agents'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Agent creation failed.'); }
    finally { setPending(false); }
  }

  return <section className="mx-auto max-w-3xl space-y-7">
    <div><p className="page-kicker">Strategy authoring</p><h1 className="page-title">Create Agent</h1><p className="page-lede">The plaintext stays private in the platform service; only its commitment is registered on Arc.</p></div>
    {error && <div role="alert" className="glass-panel rounded-2xl border-red-800/40 p-4 text-red-900">{error}</div>}
    <form onSubmit={submit} className="glass-panel space-y-6 rounded-[28px] p-6 md:p-8">
      <div><label htmlFor="agent-name" className="mb-2 block text-sm font-semibold">Agent name</label><input id="agent-name" value={name} onChange={(e) => setName(e.target.value)} className="field-control" maxLength={96} /></div>
      <div><div className="mb-2 flex justify-between gap-4"><label htmlFor="agent-body" className="text-sm font-semibold">AGENTS.md content</label><span className="font-mono text-xs text-neutral-600">{bytes} / {MAX_BYTES} bytes</span></div><textarea id="agent-body" value={agentsMd} onChange={(e) => setAgentsMd(e.target.value)} className="field-control min-h-72 resize-y p-4 font-mono text-sm" aria-describedby="agent-help" /><p id="agent-help" className="mt-2 text-sm text-neutral-600">Define the strategy and output behavior; never include wallet secrets or API keys.</p></div>
      <section aria-labelledby="agent-extensions-title" className="space-y-3 border-t border-black/20 pt-6">
        <div>
          <h2 id="agent-extensions-title" className="text-lg font-semibold">Agent extensions</h2>
          <p className="mt-1 text-sm text-neutral-600">AGENTS.md is the active profile file. Portable skill instructions are planned for a future Arena format.</p>
        </div>
        <div>
          {FUTURE_AGENT_FILES.map((file) => (
            <article key={file.name} className="border border-black/25 bg-white/35 p-4" aria-label={`${file.name} extension`}>
              <div className="flex items-start gap-3">
                <span className="retro-icon-box h-10 w-10 shrink-0" aria-hidden="true"><FileText size={18} strokeWidth={1.7} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-mono text-sm font-semibold">{file.name}</h3>
                    <span className="border border-black/30 bg-neutral-200 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em]">Coming soon</span>
                  </div>
                  <p className="mt-2 text-sm leading-5 text-neutral-600">{file.description}</p>
                </div>
              </div>
              <button type="button" disabled aria-label={`Upload ${file.name} — coming soon`} className="metal-button-ghost mt-4 w-full gap-2">
                <Upload size={15} strokeWidth={1.7} aria-hidden="true" />
                Upload file
              </button>
            </article>
          ))}
        </div>
      </section>
      <button disabled={pending || bytes > MAX_BYTES} className="metal-button-solid">{pending ? 'Creating…' : 'Create Agent'}</button>
    </form>
  </section>;
}
