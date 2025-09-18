export declare class Token {
    isNative: boolean;
    chainId: number;
    chainName: string;
    tokenAddress: string;
    symbol?: string;
    decimals: number;
    listed: boolean;
    wrappedTokenAddress: string;
    name?: string;
    constructor(chainId: number, chainName: string, tokenAddress: string, decimals: number, symbol?: string, name?: string, listed?: boolean, wrappedTokenAddress?: string);
    equals(other: Token): boolean;
}