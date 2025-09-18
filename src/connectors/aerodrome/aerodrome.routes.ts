import sensible from '@fastify/sensible';
import { FastifyPluginAsync } from 'fastify';

import { aerodromeAmmRoutes } from './amm-routes';
// TODO: Create these files
// import { aerodromeClmmRoutes } from './clmm-routes';
// import { aerodromeRouterRoutes } from './router-routes';

const aerodromeRouterRoutesWrapper: FastifyPluginAsync = async (fastify) => {
  await fastify.register(sensible);

  await fastify.register(async (instance) => {
    instance.addHook('onRoute', (routeOptions) => {
      if (routeOptions.schema && routeOptions.schema.tags) {
        routeOptions.schema.tags = ['/connector/aerodrome'];
      }
    });

    // await instance.register(aerodromeRouterRoutes);
  });
};

const aerodromeAmmRoutesWrapper: FastifyPluginAsync = async (fastify) => {
  await fastify.register(sensible);

  await fastify.register(async (instance) => {
    instance.addHook('onRoute', (routeOptions) => {
      if (routeOptions.schema && routeOptions.schema.tags) {
        routeOptions.schema.tags = ['/connector/aerodrome'];
      }
    });

    await instance.register(aerodromeAmmRoutes);
  });
};

const aerodromeClmmRoutesWrapper: FastifyPluginAsync = async (fastify) => {
  await fastify.register(sensible);

  await fastify.register(async (instance) => {
    instance.addHook('onRoute', (routeOptions) => {
      if (routeOptions.schema && routeOptions.schema.tags) {
        routeOptions.schema.tags = ['/connector/aerodrome'];
      }
    });

    // await instance.register(aerodromeClmmRoutes);
  });
};

export const aerodromeRoutes = {
  router: aerodromeRouterRoutesWrapper,
  amm: aerodromeAmmRoutesWrapper,
  clmm: aerodromeClmmRoutesWrapper,
};

export default aerodromeRoutes;
