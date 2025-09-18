import { Provider } from '@ethersproject/providers';
import { Protocol, Trade as RouterTrade } from '@uniswap/router-sdk';
import { TradeType, Percent, Currency, CurrencyAmount, Token } from '@uniswap/sdk-core';
import {
  SwapRouter,
  SwapOptions,
  UniversalRouterVersion,
} from '@uniswap/universal-router-sdk';
import { Pair as V2Pair, Route as V2Route, Trade as V2Trade, computePairAddress } from '@uniswap/v2-sdk';
import { abi as IUniswapV3PoolABI } from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json';
import {
  Pool as V3Pool,
  Route as V3Route,
  Trade as V3Trade,
  FeeAmount,
  computePoolAddress,
  nearestUsableTick,
  TickMath,
  TICK_SPACINGS,
} from '@uniswap/v3-sdk';
import { BigNumber, Contract } from 'ethers';

import { Ethereum } from '../../chains/ethereum/ethereum';
import { logger } from '../../services/logger';

import {
  IAerodromePoolABI,
} from './aerodrome.contracts';
import {
  SLIPSTREAM_UNIVERSAL_ROUTER_ADDRESS,
  SLIPSTREAM_POOL_FACTORY_ADDRESS,
  POOL_FACTORY_ADDRESS,
  SLIPSTREAM_QUOTER_ADDRESS,
} from './aerodrome.constants';

// Common fee tiers for V3
const V3_FEE_TIERS = [FeeAmount.LOWEST, FeeAmount.LOW, FeeAmount.MEDIUM, FeeAmount.HIGH];

export interface UniversalRouterQuoteResult {
  trade: RouterTrade<Currency, Currency, TradeType>;
  route: string[];
  routePath: string;
  priceImpact: number;
  estimatedGasUsed: BigNumber;
  estimatedGasUsedQuoteToken: CurrencyAmount<Currency>;
  quote: CurrencyAmount<Currency>;
  quoteGasAdjusted: CurrencyAmount<Currency>;
  methodParameters?: {
    calldata: string;
    value: string;
    to: string;
  };
}

export class UniversalRouterService {
  private provider: Provider;
  private chainId: number;
  private network: string;
  private ethereum: Ethereum | null = null;

  constructor(provider: Provider, chainId: number, network: string) {
    this.provider = provider;
    this.chainId = chainId;
    this.network = network;
  }

  private async getEthereum(): Promise<Ethereum> {
    if (!this.ethereum) {
      this.ethereum = await Ethereum.getInstance(this.network);
    }
    return this.ethereum;
  }

  /**
   * Get a quote for a swap using Universal Router
   */
  async getQuote(
    tokenIn: Token,
    tokenOut: Token,
    amount: CurrencyAmount<Currency>,
    tradeType: TradeType,
    options: {
      slippageTolerance: Percent;
      deadline: number;
      recipient: string;
      protocols?: Protocol[];
    },
  ): Promise<UniversalRouterQuoteResult> {
    logger.info(`[Aerodrome UniversalRouter] Starting quote generation`);
    logger.info(`[Aerodrome UniversalRouter] Input: ${amount.toExact()} ${tokenIn.symbol} (${tokenIn.address})`);
    logger.info(`[Aerodrome UniversalRouter] Output: ${tokenOut.symbol} (${tokenOut.address})`);
    logger.info(
      `[Aerodrome UniversalRouter] Trade type: ${tradeType === TradeType.EXACT_INPUT ? 'EXACT_INPUT' : 'EXACT_OUTPUT'}`,
    );
    logger.info(`[Aerodrome UniversalRouter] Recipient: ${options.recipient}`);
    logger.info(`[Aerodrome UniversalRouter] Slippage: ${options.slippageTolerance.toSignificant()}%`);

    const protocols = options.protocols || [Protocol.V2, Protocol.V3];
    logger.info(`[Aerodrome UniversalRouter] Protocols to check: ${protocols.join(', ')}`);
    const routes: any[] = [];

    // Try to find routes through each protocol
    if (protocols.includes(Protocol.V3)) {
      logger.info(`[Aerodrome UniversalRouter] Searching for V3 routes...`);
      try {
        const v3Trade = await this.findV3Route(tokenIn, tokenOut, amount, tradeType);
        if (v3Trade) {
          logger.info(
            `[Aerodrome UniversalRouter] Found V3 route: ${v3Trade.inputAmount.toExact()} -> ${v3Trade.outputAmount.toExact()}`,
          );
          routes.push({
            routev3: v3Trade.route,
            inputAmount: v3Trade.inputAmount,
            outputAmount: v3Trade.outputAmount,
          });
        } else {
          logger.info(`[Aerodrome UniversalRouter] No V3 route found`);
        }
      } catch (error) {
        logger.warn(`[Aerodrome UniversalRouter] Failed to find V3 route: ${error.message}`);
      }
    }

    if (protocols.includes(Protocol.V2)) {
      logger.info(`[Aerodrome UniversalRouter] Searching for V2 routes...`);
      try {
        const v2Trade = await this.findV2Route(tokenIn, tokenOut, amount, tradeType);
        if (v2Trade) {
          logger.info(
            `[Aerodrome UniversalRouter] Found V2 route: ${v2Trade.inputAmount.toExact()} -> ${v2Trade.outputAmount.toExact()}`,
          );
          routes.push({
            routev2: v2Trade.route,
            inputAmount: v2Trade.inputAmount,
            outputAmount: v2Trade.outputAmount,
          });
        } else {
          logger.info(`[Aerodrome UniversalRouter] No V2 route found`);
        }
      } catch (error) {
        logger.warn(`[Aerodrome UniversalRouter] Failed to find V2 route: ${error.message}`);
      }
    }

    if (routes.length === 0) {
      logger.error(`[Aerodrome UniversalRouter] No routes found for ${tokenIn.symbol} -> ${tokenOut.symbol}`);
      throw new Error(`No routes found for ${tokenIn.symbol} -> ${tokenOut.symbol}`);
    }

    logger.info(`[Aerodrome UniversalRouter] Found ${routes.length} route(s), selecting best route`);
    // Pick the best route (for now, just use the first one)
    const bestRoute = routes[0];

    // Create RouterTrade based on the best route
    let bestTrade: RouterTrade<Currency, Currency, TradeType>;

    if (bestRoute.routev3) {
      logger.info(`[Aerodrome UniversalRouter] Creating RouterTrade with V3 route`);
      bestTrade = new RouterTrade({
        v2Routes: [],
        v3Routes: [bestRoute],
        v4Routes: [],
        tradeType,
      });
    } else {
      logger.info(`[Aerodrome UniversalRouter] Creating RouterTrade with V2 route`);
      bestTrade = new RouterTrade({
        v2Routes: [bestRoute],
        v3Routes: [],
        v4Routes: [],
        tradeType,
      });
    }

    // Build the Universal Router swap
    const swapOptions: SwapOptions = {
      slippageTolerance: options.slippageTolerance,
      deadlineOrPreviousBlockhash: options.deadline,
      recipient: options.recipient,
    };

    logger.info(`[Aerodrome UniversalRouter] Building swap parameters...`);
    // Create method parameters for the swap
    const { calldata, value } = SwapRouter.swapCallParameters(bestTrade, swapOptions);
    logger.info(`[Aerodrome UniversalRouter] Calldata length: ${calldata.length}, Value: ${value}`);

    // Calculate route path
    const route = this.extractRoutePath(bestTrade);
    const routePath = route.join(' -> ');
    logger.info(`[Aerodrome UniversalRouter] Route path: ${routePath}`);

    // Estimate gas with proper gas options
    logger.info(`[Aerodrome UniversalRouter] Estimating gas for swap...`);
    const estimatedGasUsed = await this.estimateGas(calldata, value, options.recipient);
    logger.info(`[Aerodrome UniversalRouter] Estimated gas: ${estimatedGasUsed.toString()}`);

    // Simple gas cost estimation
    const estimatedGasUsedQuoteToken = CurrencyAmount.fromRawAmount(
      tokenOut,
      '0', // Simplified for now
    );

    const result = {
      trade: bestTrade,
      route,
      routePath,
      priceImpact: parseFloat(bestTrade.priceImpact.toSignificant(6)),
      estimatedGasUsed,
      estimatedGasUsedQuoteToken,
      quote: bestTrade.outputAmount,
      quoteGasAdjusted: bestTrade.outputAmount,
      methodParameters: {
        calldata,
        value,
        to: SLIPSTREAM_UNIVERSAL_ROUTER_ADDRESS,
      },
    };

    logger.info(`[Aerodrome UniversalRouter] Quote generation complete`);
    logger.info(`[Aerodrome UniversalRouter] Input: ${bestTrade.inputAmount.toExact()} ${bestTrade.inputAmount.currency.symbol}`);
    logger.info(
      `[Aerodrome UniversalRouter] Output: ${bestTrade.outputAmount.toExact()} ${bestTrade.outputAmount.currency.symbol}`,
    );
    logger.info(`[Aerodrome UniversalRouter] Price Impact: ${result.priceImpact}%`);

    return result;
  }

  /**
   * Find V3 route using pool address computation
   */
  private async findV3Route(
    tokenIn: Token,
    tokenOut: Token,
    amount: CurrencyAmount<Currency>,
    tradeType: TradeType,
  ): Promise<V3Trade<Currency, Currency, TradeType> | null> {
    // Try each fee tier
    for (const fee of V3_FEE_TIERS) {
      try {
        // Compute pool address
        const poolAddress = computePoolAddress({
          factoryAddress: SLIPSTREAM_POOL_FACTORY_ADDRESS,
          tokenA: tokenIn,
          tokenB: tokenOut,
          fee,
        });

        // Get pool contract
        const poolContract = new Contract(poolAddress, IUniswapV3PoolABI, this.provider);

        // Check if pool exists by querying liquidity
        const liquidity = await poolContract.liquidity();
        if (liquidity.eq(0)) continue;

        // Get slot0 data
        const slot0 = await poolContract.slot0();
        const sqrtPriceX96 = slot0[0];
        const tick = slot0[1];

        // Create minimal tick data around current tick
        const tickSpacing = TICK_SPACINGS[fee];
        const numSurroundingTicks = 300; // Number of ticks on each side

        const minTick = nearestUsableTick(tick - numSurroundingTicks * tickSpacing, tickSpacing);
        const maxTick = nearestUsableTick(tick + numSurroundingTicks * tickSpacing, tickSpacing);

        // Create tick data - for simplicity, assume all ticks have liquidity
        const ticks = [];
        for (let i = minTick; i <= maxTick; i += tickSpacing) {
          ticks.push({
            index: i,
            liquidityNet: 0,
            liquidityGross: 1,
          });
        }

        // Create pool instance with tick data
        const pool = new V3Pool(tokenIn, tokenOut, fee, sqrtPriceX96.toString(), liquidity.toString(), tick, ticks);

        // Create route and trade
        const route = new V3Route([pool], tokenIn, tokenOut);

        return tradeType === TradeType.EXACT_INPUT ? V3Trade.exactIn(route, amount) : V3Trade.exactOut(route, amount);
      } catch (error) {
        // Pool doesn't exist or other error, continue to next fee tier
        continue;
      }
    }

    return null;
  }

  /**
   * Find V2 route for a token pair
   */
  private async findV2Route(
    tokenIn: Token,
    tokenOut: Token,
    amount: CurrencyAmount<Currency>,
    tradeType: TradeType,
  ): Promise<V2Trade<Currency, Currency, TradeType> | null> {
    try {
      // Compute pair address
      const pairAddress = computePairAddress({
        factoryAddress: POOL_FACTORY_ADDRESS,
        tokenA: tokenIn,
        tokenB: tokenOut,
      });

      const pairContract = new Contract(pairAddress, IAerodromePoolABI, this.provider);
      const reserves = await pairContract.getReserves();
      const token0 = await pairContract.token0();

      const [reserve0, reserve1] = reserves;
      const [reserveIn, reserveOut] =
        tokenIn.address.toLowerCase() === token0.toLowerCase() ? [reserve0, reserve1] : [reserve1, reserve0];

      const pair = new V2Pair(
        CurrencyAmount.fromRawAmount(tokenIn, reserveIn.toString()),
        CurrencyAmount.fromRawAmount(tokenOut, reserveOut.toString()),
      );

      const route = new V2Route([pair], tokenIn, tokenOut);

      return new V2Trade(route, amount, tradeType);
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract route path from a trade
   */
  private extractRoutePath(trade: RouterTrade<Currency, Currency, TradeType>): string[] {
    const path: string[] = [];

    if (trade.swaps.length > 0) {
      const firstSwap = trade.swaps[0];
      const route = firstSwap.route;

      path.push(route.input.symbol || (route.input as Token).address);
      path.push(route.output.symbol || (route.output as Token).address);
    }

    return path;
  }

  /**
   * Estimate gas for the swap
   */
  private async estimateGas(calldata: string, value: string, from: string): Promise<BigNumber> {
    const ethereum = await this.getEthereum();
    const routerAddress = SLIPSTREAM_UNIVERSAL_ROUTER_ADDRESS;

    logger.info(`[Aerodrome UniversalRouter] Estimating gas...`);
    logger.info(`[Aerodrome UniversalRouter] From: ${from}`);
    logger.info(`[Aerodrome UniversalRouter] To: ${routerAddress}`);
    logger.info(`[Aerodrome UniversalRouter] Value: ${value}`);
    logger.info(`[Aerodrome UniversalRouter] Calldata length: ${calldata.length}`);

    try {
      // Get gas options from Ethereum
      const gasOptions = await ethereum.prepareGasOptions(undefined, 500000);
      logger.info(`[Aerodrome UniversalRouter] Gas options: ${JSON.stringify(gasOptions)}`);

      const gasEstimate = await this.provider.estimateGas({
        to: routerAddress,
        data: calldata,
        value,
        from,
        gasLimit: BigNumber.from(600000), // Increase gas limit for estimation
        ...gasOptions, // Include gas price options
      });

      logger.info(`[Aerodrome UniversalRouter] Gas estimation successful: ${gasEstimate.toString()}`);
      return gasEstimate;
    } catch (error) {
      // Check if this is a Permit2 AllowanceExpired error (0xd81b2f2e)
      const isPermit2Error = error.error && error.error.data && error.error.data.startsWith('0xd81b2f2e');

      if (isPermit2Error) {
        // This is expected if user hasn't approved tokens to Permit2 yet
        logger.info(`[Aerodrome UniversalRouter] Gas estimation skipped - Permit2 approval needed`);
        logger.debug(`[Aerodrome UniversalRouter] User needs to approve tokens to Permit2 before executing swap`);
      } else {
        // Log other errors as actual errors
        logger.error(`[Aerodrome UniversalRouter] Gas estimation failed:`, error);
        logger.error(`[Aerodrome UniversalRouter] Error message: ${error.message}`);
        if (error.error && error.error.data) {
          logger.error(`[Aerodrome UniversalRouter] Error data: ${error.error.data}`);
        }
        if (error.reason) {
          logger.error(`[Aerodrome UniversalRouter] Error reason: ${error.reason}`);
        }
      }

      // Use a higher default gas limit
      const defaultGas = BigNumber.from(500000);
      logger.info(`[Aerodrome UniversalRouter] Using default gas estimate: ${defaultGas.toString()}`);
      return defaultGas;
    }
  }
}
