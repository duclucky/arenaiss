import WalletBackpack from '@web3icons/react/icons/wallets/WalletBackpack';
import WalletCoinbase from '@web3icons/react/icons/wallets/WalletCoinbase';
import WalletEnkrypt from '@web3icons/react/icons/wallets/WalletEnkrypt';
import WalletExodus from '@web3icons/react/icons/wallets/WalletExodus';
import WalletMetamask from '@web3icons/react/icons/wallets/WalletMetamask';
import WalletOkx from '@web3icons/react/icons/wallets/WalletOkx';
import WalletPhantom from '@web3icons/react/icons/wallets/WalletPhantom';
import WalletRabby from '@web3icons/react/icons/wallets/WalletRabby';
import WalletRainbow from '@web3icons/react/icons/wallets/WalletRainbow';
import WalletSafe from '@web3icons/react/icons/wallets/WalletSafe';
import WalletTrust from '@web3icons/react/icons/wallets/WalletTrust';
import WalletXdefi from '@web3icons/react/icons/wallets/WalletXdefi';
import WalletZerion from '@web3icons/react/icons/wallets/WalletZerion';
import { WalletCards } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';

import type { WalletProvider } from '../adapters/interfaces';
import { resolveKnownWalletLogo, sanitizeWalletIcon, type KnownWalletLogo } from '../wallet-logo';

type LogoComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string; variant?: 'branded' | 'background' | 'mono' }>;

const bundledLogos: Record<KnownWalletLogo, LogoComponent> = {
  backpack: WalletBackpack,
  coinbase: WalletCoinbase,
  enkrypt: WalletEnkrypt,
  exodus: WalletExodus,
  metamask: WalletMetamask,
  okx: WalletOkx,
  phantom: WalletPhantom,
  rabby: WalletRabby,
  rainbow: WalletRainbow,
  safe: WalletSafe,
  trust: WalletTrust,
  xdefi: WalletXdefi,
  zerion: WalletZerion,
};

export function WalletLogo({ provider }: { provider: WalletProvider }) {
  const announcedIcon = sanitizeWalletIcon(provider.icon);
  if (announcedIcon) {
    return <img src={announcedIcon} alt="" aria-hidden="true" className="h-7 w-7 shrink-0 object-contain" />;
  }

  const logo = resolveKnownWalletLogo(provider);
  if (logo) {
    const Logo = bundledLogos[logo];
    return <Logo size={28} variant="branded" aria-hidden="true" data-wallet-logo={logo} className="shrink-0" />;
  }

  return <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-black/25 bg-white/55"><WalletCards size={18} /></span>;
}
