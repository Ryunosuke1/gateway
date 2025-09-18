import { logger } from '../../services/logger';

export const formatTokenAmount = (amount: string | number, decimals: number): number => {
  try {
    if (typeof amount === 'string') {
      return parseFloat(amount) / Math.pow(10, decimals);
    }
    return amount / Math.pow(10, decimals);
  } catch (error) {
    logger.error(`Error formatting token amount: ${error}`);
    return 0;
  }
};

export const isValidV2Pool = async (poolAddress: string): Promise<boolean> => {
  try {
    return poolAddress && poolAddress.length === 42 && poolAddress.startsWith('0x');
  } catch (error) {
    logger.error(`Error validating V2 pool: ${error}`);
    return false;
  }
};

export const isValidV3Pool = async (poolAddress: string): Promise<boolean> => {
  try {
    return poolAddress && poolAddress.length === 42 && poolAddress.startsWith('0x');
  } catch (error) {
    logger.error(`Error validating V3 pool: ${error}`);
    return false;
  }
};
