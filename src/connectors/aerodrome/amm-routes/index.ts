import { FastifyPluginAsync } from 'fastify';

import poolInfoRoute from './poolInfo';

export const aerodromeAmmRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(poolInfoRoute);
};

export default aerodromeAmmRoutes;
