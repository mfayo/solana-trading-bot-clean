import { LiquidityStateV4 } from '@raydium-io/raydium-sdk';
import { logger } from '../helpers';

// ── Types ────────────────────────────────────────────────────────────────────

export interface PoolData {
  id: string;
  state: LiquidityStateV4;
  type: 'raydium';
}

export interface PumpSwapPoolData {
  id: string;
  baseMint: string;
  baseDecimals: number;
  quoteDecimals: number;
  poolAddress: string;
  type: 'bondingCurve' | 'pumpswapAMM';
  timestamp: number;
}

// ── PoolCache ───────────────────────────────────────────────────────────────────

export class PoolCache {
  private readonly keys: Map<string, PoolData> = new Map<string, PoolData>();
  private readonly pumpSwapPools: Map<string, PumpSwapPoolData> = new Map<string, PumpSwapPoolData>();

  public save(id: string, state: LiquidityStateV4) {
    if (!this.keys.has(state.baseMint.toString())) {
      logger.trace(`Caching new pool for mint: ${state.baseMint.toString()}`);
      this.keys.set(state.baseMint.toString(), { id, state, type: 'raydium' });
    }
  }

  public async get(mint: string): Promise<PoolData> {
    return this.keys.get(mint)!;
  }

  public delete(mint: string) {
    logger.trace(`Removing pool from cache for mint: ${mint}`);
    this.keys.delete(mint);
  }

  // ── PumpSwap Methods ───────────────────────────────────────────────────────────

  public savePumpSwapPool(data: PumpSwapPoolData) {
    if (!this.pumpSwapPools.has(data.baseMint)) {
      logger.trace(`Caching new PumpSwap pool for mint: ${data.baseMint}`);
      this.pumpSwapPools.set(data.baseMint, data);
    }
  }

  public getPumpSwapPool(mint: string): PumpSwapPoolData | undefined {
    return this.pumpSwapPools.get(mint);
  }

  public deletePumpSwapPool(mint: string) {
    logger.trace(`Removing PumpSwap pool from cache for mint: ${mint}`);
    this.pumpSwapPools.delete(mint);
  }
}
