import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  AccountLayout,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  getAccount,
  getAssociatedTokenAddress,
  RawAccount,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Liquidity, LiquidityPoolKeysV4, LiquidityStateV4, Percent, Token, TokenAmount } from '@raydium-io/raydium-sdk';
import { MarketCache, PoolCache, SnipeListCache } from './cache';
import { PoolFilters } from './filters';
import { TransactionExecutor } from './transactions';
import { createPoolKeys, logger, NETWORK, sleep } from './helpers';
import { GeyserListener } from './listeners/geyser-listener';
import { Mutex } from 'async-mutex';
import BN from 'bn.js';
import { WarpTransactionExecutor } from './transactions/warp-transaction-executor';
import { JitoTransactionExecutor } from './transactions/jito-rpc-transaction-executor';

export interface BotConfig {
  wallet: Keypair;
  checkRenounced: boolean;
  checkFreezable: boolean;
  checkBurned: boolean;
  minPoolSize: TokenAmount;
  maxPoolSize: TokenAmount;
  quoteToken: Token;
  quoteAmount: TokenAmount;
  quoteAta: PublicKey;
  oneTokenAtATime: boolean;
  rebuySameToken: boolean;
  useSnipeList: boolean;
  autoSell: boolean;
  autoBuyDelay: number;
  autoSellDelay: number;
  maxBuyRetries: number;
  maxSellRetries: number;
  unitLimit: number;
  unitPrice: number;
  takeProfit: number;
  stopLoss: number;
  buySlippage: number;
  sellSlippage: number;
  priceCheckInterval: number;
  priceCheckDuration: number;
  filterCheckInterval: number;
  filterCheckDuration: number;
  consecutiveMatchCount: number;
  minBuyPressurePct: number;
  minFlowRatio: number;
  minSwapCount: number;
  maxDrawdownFromPeakPct: number;
  paperTrading: boolean;
}

interface PreBuyObservation {
  poolKeys: LiquidityPoolKeysV4;
  baselineQuoteVault: BN | null;
  baselineBaseVault: BN | null;
  currentQuoteVault: BN | null;
  currentBaseVault: BN | null;
  grossQuoteFlow: BN;
  peakQuoteVault: BN | null;
  swapCount: number;
  // dedup: reject duplicate / out-of-order Yellowstone deliveries
  lastQuoteWriteVersion: bigint;
  lastBaseWriteVersion: bigint;
  // real swap count: tracks both swap directions from pool state
  baselineSwapBaseIn: BN | null;  // increases on sells (base → quote)
  baselineSwapQuoteIn: BN | null; // increases on buys  (quote → base)
}

interface WatchedPoolState {
  poolKeys: LiquidityPoolKeysV4;
  baseVaultBalance: BN | null;
  quoteVaultBalance: BN | null;
}

export class Bot {
  private readonly poolFilters: PoolFilters;

  // snipe list
  private readonly snipeListCache?: SnipeListCache;

  // one token at the time
  private readonly mutex: Mutex;
  private sellExecutionCount = 0;
  public readonly isWarp: boolean = false;
  public readonly isJito: boolean = false;

  private readonly preBuyObservations: Map<string, PreBuyObservation> = new Map();
  private geyserListener: GeyserListener | null = null;
  private readonly watchedPools: Map<string, WatchedPoolState> = new Map();

  constructor(
    private readonly connection: Connection,
    private readonly marketStorage: MarketCache,
    private readonly poolStorage: PoolCache,
    private readonly txExecutor: TransactionExecutor,
    readonly config: BotConfig,
  ) {
    this.isWarp = txExecutor instanceof WarpTransactionExecutor;
    this.isJito = txExecutor instanceof JitoTransactionExecutor;

    this.mutex = new Mutex();
    this.poolFilters = new PoolFilters(connection, {
      quoteToken: this.config.quoteToken,
      minPoolSize: this.config.minPoolSize,
      maxPoolSize: this.config.maxPoolSize,
    });

    if (this.config.useSnipeList) {
      this.snipeListCache = new SnipeListCache();
      this.snipeListCache.init();
    }
  }

  public setGeyserListener(listener: GeyserListener): void {
    this.geyserListener = listener;
  }

  async validate() {
    try {
      await getAccount(this.connection, this.config.quoteAta, this.connection.commitment);
    } catch (error) {
      logger.error(
        `${this.config.quoteToken.symbol} token account not found in wallet: ${this.config.wallet.publicKey.toString()}`,
      );
      return false;
    }

    return true;
  }

  public async buy(accountId: PublicKey, poolState: LiquidityStateV4) {
    logger.trace({ mint: poolState.baseMint }, `Processing new pool...`);

    if (this.config.useSnipeList && !this.snipeListCache?.isInList(poolState.baseMint.toString())) {
      logger.debug({ mint: poolState.baseMint.toString() }, `Skipping buy because token is not in a snipe list`);
      return;
    }

    if (this.config.autoBuyDelay > 0) {
      logger.debug({ mint: poolState.baseMint }, `Waiting for ${this.config.autoBuyDelay} ms before buy`);
      await sleep(this.config.autoBuyDelay);
    }

    if (this.config.oneTokenAtATime) {
      if (this.mutex.isLocked() || this.sellExecutionCount > 0) {
        logger.debug(
          { mint: poolState.baseMint.toString() },
          `Skipping buy because one token at a time is turned on and token is already being processed`,
        );
        return;
      }

      await this.mutex.acquire();
    }

    try {
      const [market, mintAta] = await Promise.all([
        this.marketStorage.get(poolState.marketId.toString()),
        getAssociatedTokenAddress(poolState.baseMint, this.config.wallet.publicKey),
      ]);
      const poolKeys: LiquidityPoolKeysV4 = createPoolKeys(accountId, poolState, market);

      if (!this.config.useSnipeList) {
        this.startPreBuyObservation(poolKeys);

        let proceedToBuy = false;
        try {
          const safetyMatch = await this.filterMatch(poolKeys);
          if (!safetyMatch) {
            logger.trace({ mint: poolState.baseMint.toString() }, `Skipping buy because pool failed safety filters`);
            return;
          }

          const deltaMatch = this.evaluateDeltaFilters(poolState.baseMint.toString());
          if (!deltaMatch) {
            logger.trace({ mint: poolState.baseMint.toString() }, `Skipping buy because pool failed delta filters`);
            return;
          }

          proceedToBuy = true;
        } finally {
          this.stopPreBuyObservation(poolState.baseMint.toString(), poolKeys, proceedToBuy);
        }
      }

      for (let i = 0; i < this.config.maxBuyRetries; i++) {
        try {
          logger.info(
            { mint: poolState.baseMint.toString() },
            `Send buy transaction attempt: ${i + 1}/${this.config.maxBuyRetries}`,
          );
          const tokenOut = new Token(TOKEN_PROGRAM_ID, poolKeys.baseMint, poolKeys.baseDecimals);
          const result = await this.swap(
            poolKeys,
            this.config.quoteAta,
            mintAta,
            this.config.quoteToken,
            tokenOut,
            this.config.quoteAmount,
            this.config.buySlippage,
            this.config.wallet,
            'buy',
          );

          if (result.confirmed) {
            logger.info(
              {
                mint: poolState.baseMint.toString(),
                signature: result.signature,
                url: `https://solscan.io/tx/${result.signature}?cluster=${NETWORK}`,
              },
              `Confirmed buy tx`,
            );

            break;
          }

          logger.info(
            {
              mint: poolState.baseMint.toString(),
              signature: result.signature,
              error: result.error,
            },
            `Error confirming buy tx`,
          );
        } catch (error) {
          logger.debug({ mint: poolState.baseMint.toString(), error }, `Error confirming buy transaction`);
        }
      }
    } catch (error) {
      logger.error({ mint: poolState.baseMint.toString(), error }, `Failed to buy token`);
    } finally {
      if (this.config.oneTokenAtATime) {
        this.mutex.release();
      }
    }
  }

  public async sell(accountId: PublicKey, rawAccount: RawAccount) {
    if (this.config.oneTokenAtATime) {
      this.sellExecutionCount++;
    }

    try {
      logger.trace({ mint: rawAccount.mint }, `Processing new token...`);

      const poolData = await this.poolStorage.get(rawAccount.mint.toString());

      if (!poolData) {
        logger.trace({ mint: rawAccount.mint.toString() }, `Token pool data is not found, can't sell`);
        return;
      }

      const tokenIn = new Token(TOKEN_PROGRAM_ID, poolData.state.baseMint, poolData.state.baseDecimal.toNumber());
      const tokenAmountIn = new TokenAmount(tokenIn, rawAccount.amount, true);

      if (tokenAmountIn.isZero()) {
        logger.info({ mint: rawAccount.mint.toString() }, `Empty balance, can't sell`);
        return;
      }

      if (this.config.autoSellDelay > 0) {
        logger.debug({ mint: rawAccount.mint }, `Waiting for ${this.config.autoSellDelay} ms before sell`);
        await sleep(this.config.autoSellDelay);
      }

      const market = await this.marketStorage.get(poolData.state.marketId.toString());
      const poolKeys: LiquidityPoolKeysV4 = createPoolKeys(new PublicKey(poolData.id), poolData.state, market);

      await this.priceMatch(tokenAmountIn, poolKeys);

      for (let i = 0; i < this.config.maxSellRetries; i++) {
        try {
          logger.info(
            { mint: rawAccount.mint },
            `Send sell transaction attempt: ${i + 1}/${this.config.maxSellRetries}`,
          );

          const result = await this.swap(
            poolKeys,
            accountId,
            this.config.quoteAta,
            tokenIn,
            this.config.quoteToken,
            tokenAmountIn,
            this.config.sellSlippage,
            this.config.wallet,
            'sell',
          );

          if (result.confirmed) {
            logger.info(
              {
                dex: `https://dexscreener.com/solana/${rawAccount.mint.toString()}?maker=${this.config.wallet.publicKey}`,
                mint: rawAccount.mint.toString(),
                signature: result.signature,
                url: `https://solscan.io/tx/${result.signature}?cluster=${NETWORK}`,
              },
              `Confirmed sell tx`,
            );

            if (this.config.rebuySameToken) {
              this.poolStorage.delete(rawAccount.mint.toString());
              logger.info({ mint: rawAccount.mint.toString() }, `Removed token from pool cache for potential rebuy`);
            }

            break;
          }

          logger.info(
            {
              mint: rawAccount.mint.toString(),
              signature: result.signature,
              error: result.error,
            },
            `Error confirming sell tx`,
          );
        } catch (error) {
          logger.debug({ mint: rawAccount.mint.toString(), error }, `Error confirming sell transaction`);
        }
      }
    } catch (error) {
      logger.error({ mint: rawAccount.mint.toString(), error }, `Failed to sell token`);
    } finally {
      if (this.config.oneTokenAtATime) {
        this.sellExecutionCount--;
      }
    }
  }

  public updateVaultBalance(
    mint: string,
    pubkey: PublicKey,
    data: Buffer,
    writeVersion: bigint,
  ): void {
    let amountBN: BN;
    try {
      const { amount } = AccountLayout.decode(data);
      amountBN = new BN(amount.toString());
    } catch (e) {
      logger.trace({ mint, e }, 'Failed to decode vault account data');
      return;
    }

    // Phase 1: pre-buy observation
    const obs = this.preBuyObservations.get(mint);
    if (obs) {
      const isQuote = pubkey.equals(obs.poolKeys.quoteVault);
      const isBase = pubkey.equals(obs.poolKeys.baseVault);

      if (isQuote) {
        if (writeVersion <= obs.lastQuoteWriteVersion) {
          logger.trace({ mint, writeVersion: writeVersion.toString() }, 'Skipping stale quote vault update');
          return;
        }
        obs.lastQuoteWriteVersion = writeVersion;

        if (obs.baselineQuoteVault === null) {
          obs.baselineQuoteVault = amountBN;
          obs.currentQuoteVault = amountBN;
          obs.peakQuoteVault = amountBN;
        } else {
          const delta = amountBN.sub(obs.currentQuoteVault!).abs();
          obs.grossQuoteFlow = obs.grossQuoteFlow.add(delta);
          obs.currentQuoteVault = amountBN;
          // swapCount is now tracked via observePoolState() from swapBaseInAmount
          if (amountBN.gt(obs.peakQuoteVault!)) obs.peakQuoteVault = amountBN;
        }
        return;
      }
      if (isBase) {
        if (writeVersion <= obs.lastBaseWriteVersion) {
          logger.trace({ mint, writeVersion: writeVersion.toString() }, 'Skipping stale base vault update');
          return;
        }
        obs.lastBaseWriteVersion = writeVersion;

        if (obs.baselineBaseVault === null) obs.baselineBaseVault = amountBN;
        obs.currentBaseVault = amountBN;
        return;
      }
    }

    // Phase 2: active position (trailing stop)
    const watchState = this.watchedPools.get(mint);
    if (!watchState) return;

    if (pubkey.equals(watchState.poolKeys.baseVault)) {
      watchState.baseVaultBalance = amountBN;
    } else if (pubkey.equals(watchState.poolKeys.quoteVault)) {
      watchState.quoteVaultBalance = amountBN;
    }
  }

  public observePoolState(poolState: LiquidityStateV4): void {
    const mint = poolState.baseMint.toString();
    const obs = this.preBuyObservations.get(mint);
    if (!obs) return;

    const curBaseIn = poolState.swapBaseInAmount;
    const curQuoteIn = poolState.swapQuoteInAmount;

    // First update — capture baseline for both directions
    if (obs.baselineSwapBaseIn === null || obs.baselineSwapQuoteIn === null) {
      obs.baselineSwapBaseIn = curBaseIn;
      obs.baselineSwapQuoteIn = curQuoteIn;
      return;
    }

    // A swap happened if either direction's cumulative amount strictly increased.
    // swapBaseInAmount  → sell swap (user sends base, receives quote)
    // swapQuoteInAmount → buy  swap (user sends quote, receives base)
    // Both are updated by real swap txs only; LP events touch neither.
    const swapped = curBaseIn.gt(obs.baselineSwapBaseIn) || curQuoteIn.gt(obs.baselineSwapQuoteIn);
    if (swapped) {
      obs.swapCount += 1;
      obs.baselineSwapBaseIn = curBaseIn;
      obs.baselineSwapQuoteIn = curQuoteIn;
    }
  }

  private startPreBuyObservation(poolKeys: LiquidityPoolKeysV4): void {
    if (!this.geyserListener) return;
    const mint = poolKeys.baseMint.toString();
    this.preBuyObservations.set(mint, {
      poolKeys,
      baselineQuoteVault: null,
      baselineBaseVault: null,
      currentQuoteVault: null,
      currentBaseVault: null,
      grossQuoteFlow: new BN(0),
      peakQuoteVault: null,
      swapCount: 0,
      lastQuoteWriteVersion: BigInt(0),
      lastBaseWriteVersion: BigInt(0),
      baselineSwapBaseIn: null,
      baselineSwapQuoteIn: null,
    });
    this.geyserListener.watchVaults(poolKeys.baseVault, poolKeys.quoteVault, mint);
  }

  private stopPreBuyObservation(mint: string, poolKeys: LiquidityPoolKeysV4, proceedingToBuy: boolean): void {
    this.preBuyObservations.delete(mint);
    if (!this.geyserListener) return;
    // If proceeding to buy, leave subscription alive — it transitions to trailing stop monitoring
    if (!proceedingToBuy) {
      this.geyserListener.unwatchVaults(poolKeys.baseVault, poolKeys.quoteVault, mint);
    }
  }

  private evaluateDeltaFilters(mint: string): boolean {
    const obs = this.preBuyObservations.get(mint);
    if (!obs || !obs.baselineQuoteVault || !obs.currentQuoteVault) {
      logger.debug({ mint }, 'No vault data collected — failing delta filters');
      return false;
    }

    if (obs.swapCount < this.config.minSwapCount) {
      logger.debug({ mint, swapCount: obs.swapCount }, 'Failed: not enough swap activity');
      return false;
    }

    const netFlow = obs.currentQuoteVault.sub(obs.baselineQuoteVault);
    const baselinePct = obs.baselineQuoteVault.muln(this.config.minBuyPressurePct).divn(100);
    if (netFlow.lt(baselinePct)) {
      logger.debug({ mint }, 'Failed: insufficient buy pressure');
      return false;
    }

    if (obs.grossQuoteFlow.isZero()) {
      logger.debug({ mint }, 'Failed: zero gross flow');
      return false;
    }
    const ratioScaled = netFlow.muln(100).div(obs.grossQuoteFlow).toNumber();
    const requiredRatio = Math.floor(this.config.minFlowRatio * 100);
    if (ratioScaled < requiredRatio) {
      logger.debug({ mint, ratioScaled, requiredRatio }, 'Failed: net/gross flow ratio too low');
      return false;
    }

    if (obs.peakQuoteVault && obs.peakQuoteVault.gt(obs.currentQuoteVault)) {
      const drawdown = obs.peakQuoteVault.sub(obs.currentQuoteVault);
      const drawdownPct = drawdown.muln(100).div(obs.peakQuoteVault).toNumber();
      if (drawdownPct > this.config.maxDrawdownFromPeakPct) {
        logger.debug({ mint, drawdownPct }, 'Failed: price already dumping from peak');
        return false;
      }
    }

    logger.info({ mint, swapCount: obs.swapCount, ratioScaled }, 'Delta filters passed ✅');
    return true;
  }

  // noinspection JSUnusedLocalSymbols
  private async swap(
    poolKeys: LiquidityPoolKeysV4,
    ataIn: PublicKey,
    ataOut: PublicKey,
    tokenIn: Token,
    tokenOut: Token,
    amountIn: TokenAmount,
    slippage: number,
    wallet: Keypair,
    direction: 'buy' | 'sell',
  ) {
    const slippagePercent = new Percent(slippage, 100);
    const poolInfo = await Liquidity.fetchInfo({
      connection: this.connection,
      poolKeys,
    });

    const computedAmountOut = Liquidity.computeAmountOut({
      poolKeys,
      poolInfo,
      amountIn,
      currencyOut: tokenOut,
      slippage: slippagePercent,
    });

    const latestBlockhash = await this.connection.getLatestBlockhash();
    const { innerTransaction } = Liquidity.makeSwapFixedInInstruction(
      {
        poolKeys: poolKeys,
        userKeys: {
          tokenAccountIn: ataIn,
          tokenAccountOut: ataOut,
          owner: wallet.publicKey,
        },
        amountIn: amountIn.raw,
        minAmountOut: computedAmountOut.minAmountOut.raw,
      },
      poolKeys.version,
    );

    const messageV0 = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [
        ...(this.isWarp || this.isJito
          ? []
          : [
              ComputeBudgetProgram.setComputeUnitPrice({ microLamports: this.config.unitPrice }),
              ComputeBudgetProgram.setComputeUnitLimit({ units: this.config.unitLimit }),
            ]),
        ...(direction === 'buy'
          ? [
              createAssociatedTokenAccountIdempotentInstruction(
                wallet.publicKey,
                ataOut,
                wallet.publicKey,
                tokenOut.mint,
              ),
            ]
          : []),
        ...innerTransaction.instructions,
        ...(direction === 'sell' ? [createCloseAccountInstruction(ataIn, wallet.publicKey, wallet.publicKey)] : []),
      ],
    }).compileToV0Message();

    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([wallet, ...innerTransaction.signers]);

    if (this.config.paperTrading) {
      const estimatedOut = computedAmountOut.amountOut.toFixed();
      logger.info(
        {
          direction,
          amountIn: amountIn.toFixed(),
          estimatedOut,
          mint: (direction === 'buy' ? tokenOut : tokenIn).mint.toString(),
        },
        `[PAPER TRADE] Simulated ${direction} — no transaction submitted`,
      );
      return { confirmed: true, signature: 'PAPER_TRADE' };
    }

    return this.txExecutor.executeAndConfirm(transaction, wallet, latestBlockhash);
  }

  private async filterMatch(poolKeys: LiquidityPoolKeysV4) {
    if (this.config.filterCheckInterval === 0 || this.config.filterCheckDuration === 0) {
      return true;
    }

    const timesToCheck = this.config.filterCheckDuration / this.config.filterCheckInterval;
    let timesChecked = 0;
    let matchCount = 0;

    do {
      try {
        const shouldBuy = await this.poolFilters.execute(poolKeys);

        if (shouldBuy) {
          matchCount++;

          if (this.config.consecutiveMatchCount <= matchCount) {
            logger.debug(
              { mint: poolKeys.baseMint.toString() },
              `Filter match ${matchCount}/${this.config.consecutiveMatchCount}`,
            );
            return true;
          }
        } else {
          matchCount = 0;
        }

        await sleep(this.config.filterCheckInterval);
      } finally {
        timesChecked++;
      }
    } while (timesChecked < timesToCheck);

    return false;
  }

  private async priceMatch(amountIn: TokenAmount, poolKeys: LiquidityPoolKeysV4) {
    if (this.config.priceCheckDuration === 0 || this.config.priceCheckInterval === 0) {
      return;
    }

    const timesToCheck = this.config.priceCheckDuration / this.config.priceCheckInterval;
    const profitFraction = this.config.quoteAmount.mul(this.config.takeProfit).numerator.div(new BN(100));
    const profitAmount = new TokenAmount(this.config.quoteToken, profitFraction, true);
    const takeProfit = this.config.quoteAmount.add(profitAmount);

    const lossFraction = this.config.quoteAmount.mul(this.config.stopLoss).numerator.div(new BN(100));
    const lossAmount = new TokenAmount(this.config.quoteToken, lossFraction, true);
    const stopLoss = this.config.quoteAmount.subtract(lossAmount);
    const slippage = new Percent(this.config.sellSlippage, 100);
    let timesChecked = 0;

    do {
      try {
        const poolInfo = await Liquidity.fetchInfo({
          connection: this.connection,
          poolKeys,
        });

        const amountOut = Liquidity.computeAmountOut({
          poolKeys,
          poolInfo,
          amountIn: amountIn,
          currencyOut: this.config.quoteToken,
          slippage,
        }).amountOut;

        logger.debug(
          { mint: poolKeys.baseMint.toString() },
          `Take profit: ${takeProfit.toFixed()} | Stop loss: ${stopLoss.toFixed()} | Current: ${amountOut.toFixed()}`,
        );

        if (amountOut.lt(stopLoss)) {
          break;
        }

        if (amountOut.gt(takeProfit)) {
          break;
        }

        await sleep(this.config.priceCheckInterval);
      } catch (e) {
        logger.trace({ mint: poolKeys.baseMint.toString(), e }, `Failed to check token price`);
      } finally {
        timesChecked++;
      }
    } while (timesChecked < timesToCheck);
  }
}
