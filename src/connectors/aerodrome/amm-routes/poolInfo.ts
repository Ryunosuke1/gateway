import { Contract } from '@ethersproject/contracts';
import { FastifyPluginAsync } from 'fastify';

import { Ethereum } from '../../../chains/ethereum/ethereum';
import { GetPoolInfoRequestType, PoolInfo, PoolInfoSchema } from '../../../schemas/amm-schema';
import { logger } from '../../../services/logger';
import { AerodromeAmmGetPoolInfoRequest } from '../schemas';
import { Aerodrome } from '../aerodrome';
import { IAerodromePoolABI } from '../aerodrome.contracts';
import { formatTokenAmount } from '../aerodrome.utils';

export const poolInfoRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{
    Querystring: GetPoolInfoRequestType;
    Reply: Record<string, any>;
  }>(
    '/pool-info',
    {
      schema: {
        description: 'Get AMM pool information from Aerodrome V2',
        tags: ['/connector/aerodrome'],
        querystring: AerodromeAmmGetPoolInfoRequest,
        response: {
          200: PoolInfoSchema,
        },
      },
    },
    async (request): Promise<PoolInfo> => {
      try {
        const { poolAddress } = request.query;
        const network = request.query.network;

        const ethereum = await Ethereum.getInstance(network);
        const aerodrome = await Aerodrome.getInstance(network);

        const pairContract = new Contract(poolAddress, IAerodromePoolABI, ethereum.provider);

        const token0Address = await pairContract.token0();
        const token1Address = await pairContract.token1();

        const token0 = aerodrome.getTokenByAddress(token0Address); // TODO: Implement this method in aerodrome.ts
        const token1 = aerodrome.getTokenByAddress(token1Address); // TODO: Implement this method in aerodrome.ts

        if (!token0 || !token1) {
          throw new Error('Could not find tokens for pool');
        }

        const v2Pair = await aerodrome.getV2Pool(token0, token1, poolAddress); // TODO: Implement this method in aerodrome.ts

        if (!v2Pair) {
          throw fastify.httpErrors.notFound('Pool not found');
        }

        const pairToken0 = v2Pair.token0;
        const pairToken1 = v2Pair.token1;

        const actualBaseToken = pairToken0;
        const actualQuoteToken = pairToken1;
        const baseTokenAmount = formatTokenAmount(v2Pair.reserve0.quotient.toString(), pairToken0.decimals);
        const quoteTokenAmount = formatTokenAmount(v2Pair.reserve1.quotient.toString(), pairToken1.decimals);

        const price = quoteTokenAmount / baseTokenAmount;

        return {
          address: poolAddress,
          baseTokenAddress: actualBaseToken.address,
          quoteTokenAddress: actualQuoteToken.address,
          feePct: 0.02, // Aerodrome AMM fee is fixed at 0.02%
          price: price,
          baseTokenAmount: baseTokenAmount,
          quoteTokenAmount: quoteTokenAmount,
        };
      } catch (e) {
        logger.error(`Error in pool-info route: ${e.message}`);
        if (e.stack) {
          logger.debug(`Stack trace: ${e.stack}`);
        }

        if (e.statusCode) {
          throw e;
        } else if (e.message && e.message.includes('invalid address')) {
          throw fastify.httpErrors.badRequest(`Invalid pool address`);
        } else if (e.message && e.message.includes('not found')) {
          logger.error('Not found error:', e);
          throw fastify.httpErrors.notFound('Resource not found');
        } else {
          logger.error('Unexpected error fetching pool info:', e);
          throw fastify.httpErrors.internalServerError('Failed to fetch pool info');
        }
      }
    },
  );
};

export default poolInfoRoute;
