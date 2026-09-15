import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom';
import { AppProvider } from './context';
import { Layout } from './components/Layout';
import { Home } from './views/Home';
import { ArcNetworkConfig, ArcWalletAdapter } from './adapters/interfaces';
import type { AgentApiAdapter, ArenaReadAdapter, GenLayerReadAdapter, EvaluationApiAdapter, ManagedIdentityAdapter, MarketplaceApiAdapter } from './adapters/interfaces';

const Tournaments = lazy(() => import('./views/Tournaments').then((module) => ({ default: module.Tournaments })));
const TournamentDetail = lazy(() => import('./views/TournamentDetail').then((module) => ({ default: module.TournamentDetail })));
const SubmitEntry = lazy(() => import('./views/SubmitEntry').then((module) => ({ default: module.SubmitEntry })));
const MatchDetail = lazy(() => import('./views/MatchDetail').then((module) => ({ default: module.MatchDetail })));
const Agents = lazy(() => import('./views/Agents').then((module) => ({ default: module.Agents })));
const NewAgent = lazy(() => import('./views/NewAgent').then((module) => ({ default: module.NewAgent })));
const Account = lazy(() => import('./views/Account').then((module) => ({ default: module.Account })));
const NotFound = lazy(() => import('./views/NotFound').then((module) => ({ default: module.NotFound })));
const Evaluations = lazy(() => import('./views/Evaluations').then((module) => ({ default: module.Evaluations })));
const EvaluationDetail = lazy(() => import('./views/EvaluationDetail').then((module) => ({ default: module.EvaluationDetail })));
const EvaluationRunDetail = lazy(() => import('./views/EvaluationRunDetail').then((module) => ({ default: module.EvaluationRunDetail })));
const Marketplace = lazy(() => import('./views/Marketplace').then((module) => ({ default: module.Marketplace })));

function deferred(element: ReactNode) {
  return <Suspense fallback={<div className="route-loading" role="status">Loading…</div>}>{element}</Suspense>;
}

interface AppProps {
  config?: ArcNetworkConfig | null;
  env?: Record<string, string | undefined>;
  walletAdapter?: ArcWalletAdapter;
  agentApiAdapter?: AgentApiAdapter;
  evaluationApiAdapter?: EvaluationApiAdapter;
  arenaReadAdapter?: ArenaReadAdapter;
  genLayerReadAdapter?: GenLayerReadAdapter;
  identityAdapter?: ManagedIdentityAdapter;
  marketplaceApiAdapter?: MarketplaceApiAdapter;
}

export default function App({ config, env, walletAdapter, agentApiAdapter, evaluationApiAdapter, arenaReadAdapter, genLayerReadAdapter, identityAdapter, marketplaceApiAdapter }: AppProps = {}) {
  return (
    <AppProvider config={config} env={env} walletAdapter={walletAdapter} agentApiAdapter={agentApiAdapter} evaluationApiAdapter={evaluationApiAdapter} arenaReadAdapter={arenaReadAdapter} genLayerReadAdapter={genLayerReadAdapter} identityAdapter={identityAdapter} marketplaceApiAdapter={marketplaceApiAdapter}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="tournaments" element={deferred(<Tournaments />)} />
            <Route path="tournaments/:id" element={deferred(<TournamentDetail />)} />
            <Route path="tournaments/:id/submit" element={deferred(<SubmitEntry />)} />
            <Route path="matches/:id" element={deferred(<MatchDetail />)} />
            <Route path="agents" element={deferred(<Agents />)} />
            <Route path="agents/new" element={deferred(<NewAgent />)} />
            <Route path="credits" element={<Navigate to="/account?tab=credits" replace />} />
            <Route path="account" element={deferred(<Account />)} />
            <Route path="evaluations" element={deferred(<Evaluations />)} />
            <Route path="evaluations/:id" element={deferred(<EvaluationDetail />)} />
            <Route path="evaluation-runs/:id" element={deferred(<EvaluationRunDetail />)} />
            <Route path="marketplace" element={deferred(<Marketplace />)} />
            <Route path="docs" element={<section aria-label="Arena ISS documentation" />} />
            <Route path="*" element={deferred(<NotFound />)} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}
