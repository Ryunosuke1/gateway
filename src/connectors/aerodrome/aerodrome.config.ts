import { getAvailableEthereumNetworks } from '../../chains/ethereum/ethereum.utils';
import { AvailableNetworks } from '../../services/base';
import { ConfigManagerV2 } from '../../services/config-manager-v2';

export namespace AerodromeConfig {
  export const chain = 'ethereum';
  export const networks = getAvailableEthereumNetworks().filter((network) =>
    ['base'].includes(network)
  );
  export type Network = string;

  export const tradingTypes = ['amm', 'clmm', 'router'] as const;

  export interface RootConfig {
    slippagePct: number;
    maximumHops: number;
    availableNetworks: Array<AvailableNetworks>;
  }

  export const config: RootConfig = {
    slippagePct: ConfigManagerV2.getInstance().get('aerodrome.slippagePct'),
    maximumHops: ConfigManagerV2.getInstance().get('aerodrome.maximumHops') || 4,

    availableNetworks: [
      {
        chain,
        networks: networks,
      },
    ],
  };
}