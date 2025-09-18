import { ROUTER_ADDRESS, SLIPSTREAM_NONFUNGIBLE_POSITION_MANAGER_ADDRESS, SLIPSTREAM_UNIVERSAL_ROUTER_ADDRESS } from './aerodrome.constants';
import { NonfungiblePositionManagerABI } from './abi/NonfungiblePositionManager';
import { QuoteABI } from './abi/Quote';
import { RouterABI } from './abi/Router';
import { UniversalRouterABI } from './abi/UniversalRouter';

export function getSpender(connectorName: string): string {
  if (connectorName.includes('/amm')) {
    return ROUTER_ADDRESS;
  }
  if (connectorName.includes('/clmm')) {
    return SLIPSTREAM_NONFUNGIBLE_POSITION_MANAGER_ADDRESS;
  }
  return SLIPSTREAM_UNIVERSAL_ROUTER_ADDRESS;
}

export const IAerodromeRouterABI = RouterABI;
export const IAerodromePoolABI = [
  {
    constant: true,
    inputs: [],
    name: 'getReserves',
    outputs: [
      { internalType: 'uint112', name: '_reserve0', type: 'uint112' },
      { internalType: 'uint112', name: '_reserve1', type: 'uint112' },
      { internalType: 'uint32', name: '_blockTimestampLast', type: 'uint32' },
    ],
    payable: false,
    stateMutability: 'view',
    type: 'function',
  },
  {
    constant: true,
    inputs: [],
    name: 'token0',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    payable: false,
    stateMutability: 'view',
    type: 'function',
  },
]; // Using a generic V2 Pair ABI for now

export const IAerodromeFactoryABI = [
  {
    constant: true,
    inputs: [
      { internalType: 'address', name: 'tokenA', type: 'address' },
      { internalType: 'address', name: 'tokenB', type: 'address' },
    ],
    name: 'getPair',
    outputs: [{ internalType: 'address', name: 'pair', type: 'address' }],
    payable: false,
    stateMutability: 'view',
    type: 'function',
  },
]; // Using a generic V2 Factory ABI for now

export const IAerodromeNonfungiblePositionManagerABI = NonfungiblePositionManagerABI;
export const IAerodromeQuoterABI = QuoteABI;
export const IAerodromeUniversalRouterABI = UniversalRouterABI;
