import type { WalletProvider } from './adapters/interfaces';

export type KnownWalletLogo =
  | 'backpack'
  | 'coinbase'
  | 'enkrypt'
  | 'exodus'
  | 'metamask'
  | 'okx'
  | 'phantom'
  | 'rabby'
  | 'rainbow'
  | 'safe'
  | 'trust'
  | 'xdefi'
  | 'zerion';

const MAX_PROVIDER_ICON_LENGTH = 256 * 1024;
const SAFE_PROVIDER_ICON = /^data:image\/(?:avif|gif|jpeg|png|svg\+xml|webp)(?:;[^,]*)?,/i;

export function sanitizeWalletIcon(icon: unknown): string {
  if (typeof icon !== 'string' || icon.length === 0 || icon.length > MAX_PROVIDER_ICON_LENGTH) return '';
  return SAFE_PROVIDER_ICON.test(icon) ? icon : '';
}

export function resolveKnownWalletLogo(provider: Pick<WalletProvider, 'name' | 'rdns'>): KnownWalletLogo | null {
  const identity = `${provider.rdns ?? ''} ${provider.name}`.toLowerCase();
  const matches: Array<[KnownWalletLogo, RegExp]> = [
    ['metamask', /(?:^|[.\s_-])metamask(?:$|[.\s_-])/],
    ['coinbase', /(?:^|[.\s_-])coinbase(?:$|[.\s_-])/],
    ['okx', /(?:^|[.\s_-])(?:okx|okex)(?:$|[.\s_-])/],
    ['rabby', /(?:^|[.\s_-])rabby(?:$|[.\s_-])/],
    ['phantom', /(?:^|[.\s_-])phantom(?:$|[.\s_-])/],
    ['rainbow', /(?:^|[.\s_-])rainbow(?:$|[.\s_-])/],
    ['trust', /(?:^|[.\s_-])trust(?:wallet)?(?:$|[.\s_-])/],
    ['safe', /(?:^|[.\s_-])safe(?:$|[.\s_-])/],
    ['enkrypt', /(?:^|[.\s_-])enkrypt(?:$|[.\s_-])/],
    ['exodus', /(?:^|[.\s_-])exodus(?:$|[.\s_-])/],
    ['zerion', /(?:^|[.\s_-])zerion(?:$|[.\s_-])/],
    ['backpack', /(?:^|[.\s_-])backpack(?:$|[.\s_-])/],
    ['xdefi', /(?:^|[.\s_-])xdefi(?:$|[.\s_-])/],
  ];
  return matches.find(([, pattern]) => pattern.test(identity))?.[0] ?? null;
}
