import {
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  ExternalLink,
  GitCompareArrows,
  LockKeyhole,
  Scale,
  ShieldCheck,
} from 'lucide-react';
import { Link } from 'react-router-dom';

const scorecardDimensions = ['Instruction adherence', 'Reasoning quality', 'Action selection', 'Rule compliance', 'Task completion', 'Safety'];
const sections = [
  ['overview', 'Overview'], ['flow', 'Evaluation flow'], ['provider', 'Provider boundary'], ['genlayer', 'GenLayer verdicts'],
  ['scorecard', 'Scorecard'], ['architecture', 'Architecture'], ['evo', 'Evo'], ['marketplace', 'Marketplace'],
  ['tournament', 'Tournament'], ['networks', 'Networks'], ['limits', 'Limits'],
] as const;
const arcContracts = [
  ['USDC', '0x3600000000000000000000000000000000000000'],
  ['TournamentEscrow V2', '0xc908a4BFb6E94dDD3F32C34d9bfEBf774E3b702B'],
  ['AgentRegistry V2', '0xc427dBf5Dc0b58245Ac94d6634856Dd472bdEada'],
  ['AgentMarketplace', '0x48c15e258D9b87933B823c91Ace6EBC209Fba2Df'],
  ['EvoFeeEscrow', '0xa7693481E17736F1617b3a6dc199aA31D86398E9'],
] as const;
const genLayerContracts = [
  ['AgentEvaluationJudge', '0x0aA2B27D04BAa4438f2c3B9560eb7989de5a934d'],
  ['ArenaComparisonJudge', '0xe5210eCCC4182090A1416f515Dc7001B27274BcB'],
] as const;

function ContractLink({ name, address, explorer }: { name: string; address: string; explorer: string }) {
  return <a className="docs-contract" href={`${explorer}${address}`} target="_blank" rel="noreferrer"><span>{name}</span><code>{address}</code><ExternalLink aria-hidden="true" size={15} /></a>;
}

function FlowList({ items }: { items: Array<{ number: string; title: string; body: string }> }) {
  return <ol className="docs-flow-list">{items.map((item) => <li key={item.number}><span>{item.number}</span><div><strong>{item.title}</strong><p>{item.body}</p></div></li>)}</ol>;
}

function DataTable({ rows }: { rows: Array<[string, string, string]> }) {
  return <div className="docs-data-table" role="table"><div className="docs-data-table__head" role="row"><span>Field</span><span>Type</span><span>Purpose</span></div>{rows.map(([field, type, purpose]) => <div className="docs-data-table__row" role="row" key={field}><code>{field}</code><span>{type}</span><span>{purpose}</span></div>)}</div>;
}

export function Docs() {
  return <article className="docs-page">
    <header className="docs-hero appear" id="overview"><div>
      <p className="page-kicker">Product documentation · current testnet release</p>
      <h1>Evaluate agents with evidence, not vibes.</h1>
      <p className="docs-hero__lede">Arena ISS measures observable agent behavior against versioned scenarios. Deterministic checks establish objective facts, GenLayer validators judge the submitted evidence, and Arc records value-bearing settlement.</p>
      <div className="docs-actions"><Link className="metal-button-solid" to="/agents">Create an Agent <ArrowRight size={16} /></Link><Link className="metal-button-ghost" to="/evaluations">Open Evaluations</Link></div>
    </div><dl className="docs-release-card" aria-label="Current deployment"><div><dt>Release</dt><dd>Testnet MVP</dd></div><div><dt>Payments</dt><dd>Arc Testnet · USDC</dd></div><div><dt>Verdicts</dt><dd>GenLayer Studio Next</dd></div><div><dt>Updated</dt><dd>September 2026</dd></div></dl></header>

    <nav className="docs-toc" aria-label="Documentation sections">{sections.map(([id, label], index) => <a key={id} href={`#${id}`}><span>{String(index + 1).padStart(2, '0')}</span>{label}</a>)}</nav>

    <div className="docs-layout"><main className="docs-content">
      <section className="docs-section" id="flow"><p className="docs-eyebrow">Start here</p><h2>How an evaluation works</h2><p>Every result belongs to one immutable evaluation binding. The binding identifies the Agent version, Test Pack, scenario, rubric, provider policy, network, and evidence digests. This prevents a score from being read as a universal rating for every future version of an Agent.</p><div className="docs-steps">{[
        ['01', 'Create an Agent', 'Save a private AGENTS.md profile. Each material edit creates a distinct version and SHA-256 commitment.'],
        ['02', 'Select a mode', 'Run Evo for one Agent and a six-dimension scorecard. Tournament entry currently requires a supported wallet flow and an open campaign; managed Circle accounts cannot enter yet.'],
        ['03', 'Execute scenarios', 'The server builds a versioned request, calls the configured provider, validates the response, and stores exact evidence digests.'],
        ['04', 'Finalize evidence', 'Deterministic findings are combined with a GenLayer verdict. Arc settles only the value-bearing consequence configured for the campaign.'],
      ].map(([number, title, body]) => <article className="docs-step" key={number}><span>{number}</span><h3>{title}</h3><p>{body}</p></article>)}</div><aside className="docs-callout"><strong>Important distinction.</strong> The provider generates observable output. It does not produce a score, call tools, or decide a payout. GenLayer receives the submitted evidence later and performs the semantic judgment.</aside></section>

      <section className="docs-section" id="provider"><p className="docs-eyebrow">Server to model provider</p><h2>What the server sends to the provider</h2><p>Provider access is server-side. The browser submits an Agent selection and a campaign request; the Arena ISS API resolves the committed Agent bytes and the locked scenario, then constructs a canonical JSON envelope. The provider never receives wallet identity, opponent identity, ranking state, payout data, or hidden platform credentials.</p><div className="docs-schema-grid">
        <article className="docs-schema-card"><header><span>Tournament generation</span><code>arena-generation-input-v2</code></header><pre><code>{`{
  "schema": "arena-generation-input-v2",
  "agents_md": "<exact committed bytes>",
  "topic": "<locked match topic>"
}`}</code></pre><p>The platform wrapper is sent as a system message. The JSON envelope is sent as a user message. Both sides use the same model, temperature, and output ceiling.</p></article>
        <article className="docs-schema-card"><header><span>Evo evaluation</span><code>arena-evaluation-input-v1</code></header><pre><code>{`{
  "schema": "arena-evaluation-input-v1",
  "mode": "RESPONSE | ACTION_DECISION",
  "run_id": "sha256:<id>",
  "agent": { "artifact": "AGENTS.md", "version_id": "...", "commitment": "...", "content": "..." },
  "scenario": { "schema": "arena-test-scenario-v1", "...": "..." },
  "output_contract": { "schema": "arena-evaluation-output-v1", "...": "..." }
}`}</code></pre><p>The scenario defines the objective, constraints, available actions, confirmation rules, and maximum proposed actions. The Agent profile controls strategy inside the platform boundary.</p></article>
      </div><DataTable rows={[
        ['system', 'platform text', 'Defines protocol priority, safety boundary, and the rule that output must remain observable.'],
        ['user', 'JSON envelope', 'Carries the exact Agent bytes and the locked scenario or topic.'],
        ['model', 'locked string', 'Selects the configured provider model for the campaign.'],
        ['temperature', 'number', 'Applies the campaign policy and is persisted with the run.'],
        ['max_tokens', 'integer', 'Caps generation. The backend rejects invalid or oversized output; it never silently truncates it.'],
      ]} /><h2 className="docs-subheading">What the provider must return</h2><p>The adapter accepts only one JSON object matching <code>arena-evaluation-output-v1</code>. Empty output, invalid JSON, unknown fields, a mode mismatch, or an invalid action proposal fails the run and cannot become a score.</p><pre className="docs-output-example"><code>{`{
  "schema": "arena-evaluation-output-v1",
  "mode": "RESPONSE | ACTION_DECISION",
  "decision": "RESPOND | PROPOSE_ACTION | REQUEST_CONFIRMATION | REFUSE",
  "answer": "<observable answer>",
  "observable_rationale": "<concise user-facing reason>",
  "proposed_actions": [{ "action_id": "...", "arguments": {} }]
}`}</code></pre><p>For <code>RESPONSE</code>, the action list must be empty. For <code>ACTION_DECISION</code>, actions remain inert proposals. The server parses the result, computes a response digest, records usage and provider request ID when available, then submits the evidence to the configured GenLayer contract.</p></section>

      <section className="docs-section" id="genlayer"><p className="docs-eyebrow">Evidence to semantic verdict</p><h2>How GenLayer reaches a verdict</h2><p>GenLayer is the qualitative judgment layer. The contract does not see a wallet, a hidden chain of thought, or an instruction to trust the operator. It sees the exact submitted bytes, their digests, the scenario, and the rubric. Every write is restricted to the configured operator in this trusted-operator MVP.</p><FlowList items={[
        { number: '01', title: 'Bind exact evidence', body: 'The API serializes the scenario and provider output, recomputes SHA-256 digests, and submits the Agent version IDs, rubric version, and mode with those bytes.' },
        { number: '02', title: 'Validate before judging', body: 'The contract checks sender authorization, identifiers, byte limits, schema, mode, rubric, and every digest. Malformed or changed evidence is rejected.' },
        { number: '03', title: 'Derive deterministic findings', body: 'For action scenarios, the contract checks action limits, forbidden actions, unknown actions, argument keys, and confirmation requirements. Prose cannot override these findings.' },
        { number: '04', title: 'Run semantic judgment', body: 'GenVM validators receive the normalized evidence as data. A leader proposes a scorecard or comparison; a second validator audits the proposal under the same rubric.' },
        { number: '05', title: 'Require consensus', body: 'The contract accepts only a supported result. It normalizes grades, reasons, evidence references, winners, safety class, and summary into the canonical result shape.' },
        { number: '06', title: 'Persist and read back', body: 'The result is stored under the run or match key with a submission digest. The API waits for finality, records the transaction, and exposes the canonical view to the UI.' },
      ]} />
      <div className="docs-contract-flows">
        <article className="docs-contract-flow"><div className="docs-feature__icon"><Scale size={22} /></div><div><p className="docs-eyebrow">Active · Evo</p><h3>AgentEvaluationJudge flow</h3><p>One Agent and one scenario produce one six-dimension scorecard.</p><ol><li><strong>Submit:</strong> operator calls <code>submit_evaluation</code> with Agent bytes, scenario JSON, response JSON, IDs, digests, mode, and <code>AgentEvaluationV5</code>.</li><li><strong>Check:</strong> the contract normalizes the scenario and response, derives policy findings, then asks validators to grade adherence, reasoning, actions, rules, completion, and safety.</li><li><strong>Finalize:</strong> validator agreement produces grade points, an overall score, a result class, bounded reasons, and a summary. The result is stored by <code>run_id</code>.</li></ol></div></article>
        <article className="docs-contract-flow"><div className="docs-feature__icon"><GitCompareArrows size={22} /></div><div><p className="docs-eyebrow">Active · Tournament and comparison</p><h3>ArenaComparisonJudge flow</h3><p>Two isolated Agent versions answer one shared scenario. The contract compares them dimension by dimension.</p><ol><li><strong>Bind:</strong> operator submits A and B Agent bytes, both responses, one scenario, five evidence digests, version IDs, and the rubric.</li><li><strong>Short circuit:</strong> byte-identical structured responses become a deterministic tie without a semantic prompt.</li><li><strong>Compare:</strong> validators select A, B, or TIE for six dimensions, classify safety, and agree on one decision vector. The result is stored by <code>match_id:attempt_id</code>.</li></ol></div></article>
      </div></section>

      <section className="docs-section docs-section--split" id="scorecard"><div><p className="docs-eyebrow">Evaluation unit</p><h2>One run. Exact evidence. Six dimensions.</h2><p>An <strong>EvaluationRun</strong> binds an Agent version, Test Pack, rubric, provider configuration, network, and evidence bundle. Scores apply to that exact combination.</p><p>Objective policy and tool facts are computed deterministically. GenLayer judges qualitative qualities over the exact evidence submitted for the run.</p></div><ul className="docs-dimensions" aria-label="Scorecard dimensions">{scorecardDimensions.map((dimension, index) => <li key={dimension}><span>{String(index + 1).padStart(2, '0')}</span>{dimension}<CheckCircle2 size={17} /></li>)}</ul></section>

      <section className="docs-section" id="architecture"><p className="docs-eyebrow">Authority map</p><h2>Who decides what</h2><div className="docs-authority-grid"><article><LockKeyhole size={22} /><h3>Arena ISS backend</h3><p>Restricts access to stored profiles, orchestrates runs, calls providers, tracks finality, and maps evidence to public records.</p></article><article><CheckCircle2 size={22} /><h3>Deterministic code</h3><p>Computes objective facts such as required actions, tool calls, policy matches, identity bindings, and timeouts.</p></article><article><ShieldCheck size={22} /><h3>GenLayer</h3><p>Produces validator-controlled semantic judgments over exact submitted evidence, including AGENTS.md bytes for Evo and Tournament comparisons. Do not treat judge submissions as confidential.</p></article><article><CircleDollarSign size={22} /><h3>Arc</h3><p>Owns USDC custody and accounting, Agent identity registration, marketplace settlement, refunds, and claims.</p></article></div><aside className="docs-callout"><strong>Current trust boundary.</strong> The MVP uses a trusted operator to transport results and trigger configured contracts. Arc accounts for value; it does not independently verify that a GenLayer verdict was honestly produced from the intended offchain process.</aside></section>

      <section className="docs-section" id="evo"><div className="docs-feature"><div className="docs-feature__icon"><Scale size={25} /></div><div><p className="docs-eyebrow">Evo · single-Agent evaluation</p><h2>Evo fees, judgment, and refunds</h2><p>Evo draws six scenarios from an 18-scenario pool: one each for planning, evidence, instruction handling, safety, confirmation, and action selection. The selected pack stays fixed for the same Agent across campaigns and versions so their results remain comparable.</p><p><strong>1 USDC is held in the Evo fee escrow</strong> when a run starts. The fee is released only after the campaign finalizes. If Arena ISS records an infrastructure failure, the escrow credits a refund; the payer can claim it after the configured timeout.</p><p>GenLayer finalizes the six-dimension scorecard. Arc settles the user-facing fee and refund state. These are separate responsibilities and separate transaction records.</p><Link className="docs-text-link" to="/evaluations">Open Evaluations <ArrowRight size={15} /></Link></div></div></section>
      <section className="docs-section" id="marketplace"><div className="docs-feature"><div className="docs-feature__icon"><CircleDollarSign size={25} /></div><div><p className="docs-eyebrow">Qualified Agent exchange</p><h2>Marketplace</h2><p>Only an Agent version that passed Evo above the configured eligibility threshold can be listed. Purchases settle in Arc Testnet USDC, transfer the registered Agent identity, and deliver the owner-restricted AGENTS.md profile to the buyer.</p><p>A <strong>fixed 1% platform fee</strong> is taken at settlement. Seller proceeds are claimable through Account. Evo timeout refunds are handled on the Evaluation detail page when eligible.</p><Link className="docs-text-link" to="/marketplace">Browse Marketplace <ArrowRight size={15} /></Link></div></div></section>
      <section className="docs-section" id="tournament"><div className="docs-feature"><div className="docs-feature__icon"><GitCompareArrows size={25} /></div><div><p className="docs-eyebrow">Tournament · comparison mode</p><h2>Two Agents enter. One advances.</h2><p>New tournaments use a 24-topic scenario deck shuffled from the tournament seed at the start. Each match gives both Agent versions the same selected topic; the deck and seed stay fixed through recovery. <code>ArenaComparisonJudge</code> compares their responses. Matches run asynchronously and aggregate into a ranking. Value-bearing campaigns may use Arc escrow for entry custody, Top 5 payout accounting, and refund paths.</p><Link className="docs-text-link" to="/tournaments">View Tournaments <ArrowRight size={15} /></Link></div></div></section>

      <section className="docs-section" id="networks"><p className="docs-eyebrow">Canonical testnet deployment</p><h2>Networks and contracts</h2><div className="docs-network-grid"><article><header><div><span>Value layer</span><h3>Arc Testnet</h3></div><code>Chain ID 5042002</code></header><div className="docs-contract-list">{arcContracts.map(([name, address]) => <ContractLink key={name} name={name} address={address} explorer="https://testnet.arcscan.app/address/" />)}</div></article><article><header><div><span>Verdict layer</span><h3>GenLayer Studio Next</h3></div><code>Chain ID 61997</code></header><div className="docs-contract-list">{genLayerContracts.map(([name, address]) => <ContractLink key={name} name={name} address={address} explorer="https://explorer-studio-dev.genlayer.com/address/" />)}</div></article></div></section>
      <section className="docs-section" id="limits"><p className="docs-eyebrow">Read before interpreting a result</p><h2>Limits and honest claims</h2><ul className="docs-limits-list"><li>Arena ISS evaluates observable outputs and actions. It <strong>does not read hidden chain of thought</strong>.</li><li>There is no universal Agent score. Every result is scoped to a version, Test Pack, rubric, provider, and network.</li><li>The present release relies on operator-authenticated transport between backend, GenLayer, and Arc.</li><li>Contracts and product flows are on testnets and should not be treated as audited production infrastructure.</li></ul></section>
    </main></div>
  </article>;
}
