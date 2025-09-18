import { Protocol } from '@uniswap/router-sdk';
import { Token, CurrencyAmount, Percent, TradeType } from '@uniswap/sdk-core';
import { Pair as V2Pair } from '@uniswap/v2-sdk';
import { abi as IUniswapV3FactoryABI } from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Factory.sol/IUniswapV3Factory.json';
import { abi as IUniswapV3PoolABI } from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json';
import { FeeAmount, Pool as V3Pool } from '@uniswap/v3-sdk';
import { Contract, constants } from 'ethers';
import { getAddress } from 'ethers/lib/utils';
import JSBI from 'jsbi';

import { Ethereum, TokenInfo } from '../../chains/ethereum/ethereum';
import { logger } from '../../services/logger';

import { AerodromeConfig } from './aerodrome.config';
import {
  ROUTER_ADDRESS,
  POOL_FACTORY_ADDRESS,
  SLIPSTREAM_POOL_FACTORY_ADDRESS,
  SLIPSTREAM_NONFUNGIBLE_POSITION_MANAGER_ADDRESS,
  SLIPSTREAM_QUOTER_ADDRESS,
  SLIPSTREAM_UNIVERSAL_ROUTER_ADDRESS,
} from './aerodrome.constants';
import {
  IAerodromeRouterABI,
  IAerodromePoolABI,
  IAerodromeFactoryABI,
} from './aerodrome.contracts';
import { isValidV2Pool, isValidV3Pool } from './aerodrome.utils';
import { UniversalRouterService } from './universal-router'; // Assuming a generic UniversalRouterService

export class Aerodrome {
  private static _instances: { [name: string]: Aerodrome };
  private ethereum: Ethereum;
  public config: AerodromeConfig.RootConfig;
  private chainId: number;
  private _ready: boolean = false;

  // V2 (AMM) properties
  private v2Factory: Contract;
  private v2Router: Contract;

  // V3 (CLMM) properties
  private v3Factory: Contract;
  private v3NFTManager: Contract;
  private v3Quoter: Contract;
  private universalRouter: UniversalRouterService;

  private networkName: string;

  private constructor(network: string) {
    this.networkName = network;
    this.config = AerodromeConfig.config;
  }

  public static async getInstance(network: string): Promise<Aerodrome> {
    if (Aerodrome._instances === undefined) {
      Aerodrome._instances = {};
    }

    if (!(network in Aerodrome._instances)) {
      Aerodrome._instances[network] = new Aerodrome(network);
      await Aerodrome._instances[network].init();
    }

    return Aerodrome._instances[network];
  }

  public async init() {
    try {
      this.ethereum = await Ethereum.getInstance(this.networkName);
      this.chainId = this.ethereum.chainId;

      // Initialize V2 (AMM) contracts
      this.v2Factory = new Contract(
        POOL_FACTORY_ADDRESS,
        IAerodromeFactoryABI,
        this.ethereum.provider
      );

      this.v2Router = new Contract(
        ROUTER_ADDRESS,
        IAerodromeRouterABI,
        this.ethereum.provider
      );

      // Initialize V3 (CLMM) contracts
      this.v3Factory = new Contract(
        SLIPSTREAM_POOL_FACTORY_ADDRESS,
        IUniswapV3FactoryABI,
        this.ethereum.provider
      );

      this.v3NFTManager = new Contract(
        SLIPSTREAM_NONFUNGIBLE_POSITION_MANAGER_ADDRESS,
        IAerodromeNonfungiblePositionManagerABI,
        this.ethereum.provider
      );

      this.v3Quoter = new Contract(
        SLIPSTREAM_QUOTER_ADDRESS,
        IAerodromeQuoterABI,
        this.ethereum.provider
      );

      if (!this.ethereum.ready()) {
        await this.ethereum.init();
      }

      this._ready = true;
      logger.info(`Aerodrome connector initialized for network: ${this.networkName}`);
    } catch (error) {
      logger.error(`Error initializing Aerodrome: ${error.message}`);
      throw error;
    }
  }

  public ready(): boolean {
    return this._ready;
  }

  public getTokenByAddress(address: string): Token | null {
    const tokenInfo = this.ethereum.getToken(address);
    if (!tokenInfo) return null;

    return new Token(tokenInfo.chainId, tokenInfo.address, tokenInfo.decimals, tokenInfo.symbol, tokenInfo.name);
  }

  public getTokenBySymbol(symbol: string): Token | null {
    return this.getTokenByAddress(symbol);
  }

  public getAerodromeToken(tokenInfo: TokenInfo): Token {
    return new Token(this.ethereum.chainId, tokenInfo.address, tokenInfo.decimals, tokenInfo.symbol, tokenInfo.name);
  }

  public async getUniversalRouterQuote(
    inputToken: Token,
    outputToken: Token,
    amount: number,
    side: 'BUY' | 'SELL',
    walletAddress: string,
  ): Promise<any> {
    const exactIn = side === 'SELL';
    const tokenForAmount = exactIn ? inputToken : outputToken;

    const amountStr = amount.toFixed(tokenForAmount.decimals);
    const rawAmount = amountStr.replace('.', '');
    const tradeAmount = CurrencyAmount.fromRawAmount(tokenForAmount, rawAmount);

    const protocolsToUse = [Protocol.V2, Protocol.V3]; // Assuming V2 and V3 protocols are supported by Universal Router

    const slippageTolerance = new Percent(Math.floor(this.config.slippagePct * 100), 10000);

    const quoteResult = await this.universalRouter.getQuote(
      inputToken,
      outputToken,
      tradeAmount,
      exactIn ? TradeType.EXACT_INPUT : TradeType.EXACT_OUTPUT,
      {
        slippageTolerance,
        deadline: Math.floor(Date.now() / 1000 + 1800), // 30 minutes
        recipient: walletAddress,
        protocols: protocolsToUse,
      },
    );

    return quoteResult;
  }

  public async getV2Pool(tokenA: Token | string, tokenB: Token | string, poolAddress?: string): Promise<V2Pair | null> {
    try {
      let pairAddress = poolAddress;

      const tokenAObj = typeof tokenA === 'string' ? this.getTokenBySymbol(tokenA) : tokenA;
      const tokenBObj = typeof tokenB === 'string' ? this.getTokenBySymbol(tokenB) : tokenB;

      if (!tokenAObj || !tokenBObj) {
        throw new Error(`Invalid tokens: ${tokenA}, ${tokenB}`);
      }

      if (!pairAddress) {
        pairAddress = await this.v2Factory.getPair(tokenAObj.address, tokenBObj.address);
      }

      if (!pairAddress || pairAddress === constants.AddressZero) {
        return null;
      }

      const isValid = await isValidV2Pool(pairAddress);
      if (!isValid) {
        return null;
      }

      const pairContract = new Contract(pairAddress, IAerodromePoolABI, this.ethereum.provider);

      const [reserves, token0Address] = await Promise.all([pairContract.getReserves(), pairContract.token0()]);

      const [reserve0, reserve1] = reserves;
      const token0 = getAddress(token0Address) === getAddress(tokenAObj.address) ? tokenAObj : tokenBObj;
      const token1 = token0.address === tokenAObj.address ? tokenBObj : tokenAObj;

      return new V2Pair(
        CurrencyAmount.fromRawAmount(token0, reserve0.toString()),
        CurrencyAmount.fromRawAmount(token1, reserve1.toString()),
      );
    } catch (error) {
      logger.error(`Error getting V2 pool: ${error.message}`);
      return null;
    }
  }

  public async getV3Pool(
    tokenA: Token | string,
    tokenB: Token | string,
    fee?: FeeAmount,
    poolAddress?: string,
  ): Promise<V3Pool | null> {
    try {
      let poolAddr = poolAddress;

      const tokenAObj = typeof tokenA === 'string' ? this.getTokenBySymbol(tokenA) : tokenA;
      const tokenBObj = typeof tokenB === 'string' ? this.getTokenBySymbol(tokenB) : tokenB;

      if (!tokenAObj || !tokenBObj) {
        throw new Error(`Invalid tokens: ${tokenA}, ${tokenB}`);
      }

      if (!poolAddr) {
        if (fee) {
          poolAddr = await this.v3Factory.getPool(tokenAObj.address, tokenBObj.address, fee);
        }

        if (!poolAddr) {
          const allFeeTiers = [FeeAmount.LOWEST, FeeAmount.LOW, FeeAmount.MEDIUM, FeeAmount.HIGH];

          for (const feeTier of allFeeTiers) {
            if (feeTier === fee) continue;

            poolAddr = await this.v3Factory.getPool(tokenAObj.address, tokenBObj.address, feeTier);

            if (poolAddr && poolAddr !== constants.AddressZero) {
              break;
            }
          }
        }
      }

      if (!poolAddr || poolAddr === constants.AddressZero) {
        return null;
      }

      const isValid = await isValidV3Pool(poolAddr);
      if (!isValid) {
        return null;
      }

      const poolContract = new Contract(poolAddr, IUniswapV3PoolABI, this.ethereum.provider);

      const [liquidity, slot0, feeData] = await Promise.all([
        poolContract.liquidity(),
        poolContract.slot0(),
        poolContract.fee(),
      ]);

      const [sqrtPriceX96, tick] = slot0;

      return new V3Pool(
        tokenAObj,
        tokenBObj,
        feeData,
        sqrtPriceX96.toString(),
        liquidity.toString(),
        tick,
        {
          async getTick(index) {
            return {
              index,
              liquidityNet: JSBI.BigInt(0),
              liquidityGross: JSBI.BigInt(0),
            };
          },
          async nextInitializedTickWithinOneWord(tick, lte, tickSpacing) {
            const nextTick = lte ? tick - tickSpacing : tick + tickSpacing;
            return [nextTick, false];
          },
        },
      );
    } catch (error) {
      logger.error(`Error getting V3 pool: ${error.message}`);
      return null;
    }
  }

  public async findDefaultPool(
    baseToken: string,
    quoteToken: string,
    poolType: 'amm' | 'clmm',
  ): Promise<string | null> {
    try {
      logger.info(`Finding ${poolType} pool for ${baseToken}-${quoteToken} on ${this.networkName}`);

      const baseTokenInfo = this.getTokenBySymbol(baseToken) || this.getTokenByAddress(baseToken);
      const quoteTokenInfo = this.getTokenBySymbol(quoteToken) || this.getTokenByAddress(quoteToken);

      if (!baseTokenInfo || !quoteTokenInfo) {
        logger.warn(`Token not found: ${!baseTokenInfo ? baseToken : quoteToken}`);
        return null;
      }

      logger.info(
        `Resolved tokens: ${baseTokenInfo.symbol} (${baseTokenInfo.address}), ${quoteTokenInfo.symbol} (${quoteTokenInfo.address})`,
      );

      const { PoolService } = await import('../../services/pool-service');
      const poolService = PoolService.getInstance();

      const pool = await poolService.getPool(
        'aerodrome',
        this.networkName,
        poolType,
        baseTokenInfo.symbol,
        quoteTokenInfo.symbol,
      );

      if (!pool) {
        logger.warn(
          `No ${poolType} pool found for ${baseTokenInfo.symbol}-${quoteTokenInfo.symbol} on Aerodrome network ${this.networkName}`,
        );
        return null;
      }

      logger.info(`Found ${poolType} pool at ${pool.address}`);
      return pool.address;
    } catch (error) {
      logger.error(`Error finding default pool: ${error.message}`);
      if (error.stack) {
        logger.debug(`Stack trace: ${error.stack}`);
      }
      return null;
    }
  }

  public async getFirstWalletAddress(): Promise<string | null> {
    try {
      return await Ethereum.getFirstWalletAddress();
    } catch (error) {
      logger.error(`Error getting first wallet address: ${error.message}`);
      return null;
    }
  }

  public async checkNFTOwnership(positionId: string, walletAddress: string): Promise<void> {
    const nftContract = new Contract(
      SLIPSTREAM_NONFUNGIBLE_POSITION_MANAGER_ADDRESS,
      IAerodromeNonfungiblePositionManagerABI,
      this.ethereum.provider,
    );

    try {
      const owner = await nftContract.ownerOf(positionId);
      if (owner.toLowerCase() !== walletAddress.toLowerCase()) {
        throw new Error(`Position ${positionId} is not owned by wallet ${walletAddress}`);
      }
    } catch (error: any) {
      if (error.message.includes('is not owned by')) {
        throw error;
      }
      throw new Error(`Invalid position ID ${positionId}`);
    }
  }

  public async checkNFTApproval(positionId: string, walletAddress: string, operatorAddress: string): Promise<void> {
    const nftContract = new Contract(
      SLIPSTREAM_NONFUNGIBLE_POSITION_MANAGER_ADDRESS,
      IAerodromeNonfungiblePositionManagerABI,
      this.ethereum.provider,
    );

    const approvedAddress = await nftContract.getApproved(positionId);
    const isApprovedForAll = await nftContract.isApprovedForAll(walletAddress, operatorAddress);

    if (approvedAddress.toLowerCase() !== operatorAddress.toLowerCase() && !isApprovedForAll) {
      throw new Error(
        `Insufficient NFT approval. Please approve the position NFT (${positionId}) for the Aerodrome Position Manager (${operatorAddress})`,
      );
    }
  }

  public async close() {
    if (this.networkName in Aerodrome._instances) {
      delete Aerodrome._instances[this.networkName];
    }
  }
}