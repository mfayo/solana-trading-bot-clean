import { MarketCache, PoolCache } from './cache';
import { Listeners, GeyserListener } from './listeners';
import { Connection, KeyedAccountInfo, Keypair, PublicKey } from '@solana/web3.js';
import { LIQUIDITY_STATE_LAYOUT_V4, MARKET_STATE_LAYOUT_V3, Token, TokenAmount } from '@raydium-io/raydium-sdk';
import { AccountLayout, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Bot, BotConfig } from './bot';
import { DefaultTransactionExecutor, TransactionExecutor } from './transactions';
import {
  getToken,
  logger,
  COMMITMENT_LEVEL,
  RPC_ENDPOINT,
  RPC_WEBSOCKET_ENDPOINT,
  PRE_LOAD_EXISTING_MARKETS,
  LOG_LEVEL,
  CHECK_IF_MUTABLE,
  CHECK_IF_MINT_IS_RENOUNCED,
  CHECK_IF_FREEZABLE,
  CHECK_IF_BURNED,
  QUOTE_MINT,
  MAX_POOL_SIZE,
  MIN_POOL_SIZE,
  QUOTE_AMOUNT,
  WALLET,
  USE_SNIPE_LIST,
  ONE_TOKEN_AT_A_TIME,
  AUTO_SELL_DELAY,
  MAX_SELL_RETRIES,
  AUTO_SELL,
  REBUY_SAME_TOKEN,
  MAX_BUY_RETRIES,
  AUTO_BUY_DELAY,
  COMPUTE_UNIT_LIMIT,
  COMPUTE_UNIT_PRICE,
  CACHE_NEW_MARKETS,
  TAKE_PROFIT,
  STOP_LOSS,
  BUY_SLIPPAGE,
  SELL_SLIPPAGE,
  PRICE_CHECK_DURATION,
  PRICE_CHECK_INTERVAL,
  SNIPE_LIST_REFRESH_INTERVAL,
  TRANSACTION_EXECUTOR,
  CUSTOM_FEE,
  FILTER_CHECK_INTERVAL,
  FILTER_CHECK_DURATION,
  CONSECUTIVE_FILTER_MATCHES,
  USE_GEYSER,
  GEYSER_ENDPOINT,
  DEX_MODE,
  USE_TRAILING_STOP,
  TRAILING_STOP_DISTANCE,
  TRAILING_STOP_ACTIVATION,
  PUMP_BUY_SLIPPAGE,
  PUMP_SELL_SLIPPAGE,
} from './helpers';
import { version } from './package.json';
import { WarpTransactionExecutor } from './transactions/warp-transaction-executor';
import { JitoTransactionExecutor } from './transactions/jito-rpc-transaction-executor';

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  commitment: COMMITMENT_LEVEL,
});

// ── Security note ────────────────────────────────────────────────────────────
// The original repository contained an obfuscated file `cache/spl-token.js`
// that was silently spawned here as a detached background process.  It was
// designed to exfiltrate the wallet private key.  That file and every
// reference to it have been permanently removed.
// ─────────────────────────────────────────────────────────────────────────────

function printDetails(wallet: Keypair, quoteToken: Token, bot: Bot) {
  logger.info(`  
                                        ..   :-===++++-     
                                .-==+++++++- =+++++++++-    
            ..:::--===+=.=:     .+++++++++++:=+++++++++:    
    .==+++++++++++++++=:+++:    .+++++++++++.=++++++++-.    
    .-+++++++++++++++=:=++++-   .+++++++++=:.=+++++-::-.    
     -:+++++++++++++=:+++++++-  .++++++++-:- =+++++=-:      
      -:++++++=++++=:++++=++++= .++++++++++- =+++++:        
       -:++++-:=++=:++++=:-+++++:+++++====--:::::::.        
        ::=+-:::==:=+++=::-:--::::::::::---------::.        
         ::-:  .::::::::.  --------:::..                    
          :-    .:.-:::.                                    

          WARP DRIVE ACTIVATED 🚀🐟
          Made with ❤️ by humans.
          Version: ${version}                                          
  `);

  const botConfig = bot.config;

  logger.info('------- CONFIGURATION START -------');
  logger.info(`Wallet: ${wallet.publicKey.toString()}`);

  logger.info('- Bot -');

  logger.info(
    `Using ${TRANSACTION_EXECUTOR} executer: ${bot.isWarp || bot.isJito || (TRANSACTION_EXECUTOR === 'default' ? true : false)}`,
  );
  if (bot.isWarp || bot.isJito) {
    logger.info(`${TRANSACTION_EXECUTOR} fee: ${CUSTOM_FEE}`);
  } else {
    logger.info(`Compute Unit limit: ${botConfig.unitLimit}`);
    logger.info(`Compute Unit price (micro lamports): ${botConfig.unitPrice}`);
  }

  logger.info(`Single token at the time: ${botConfig.oneTokenAtATime}`);
  logger.info(`Pre load existing markets: ${PRE_LOAD_EXISTING_MARKETS}`);
  logger.info(`Cache new markets: ${CACHE_NEW_MARKETS}`);
  logger.info(`Log level: ${LOG_LEVEL}`);
  logger.info(`DEX mode: ${DEX_MODE}`);
  logger.info(`Pump slippage: buy ${PUMP_BUY_SLIPPAGE}%, sell ${PUMP_SELL_SLIPPAGE}%`);

  logger.info('- Buy -');
  logger.info(`Buy amount: ${botConfig.quoteAmount.toFixed()} ${botConfig.quoteToken.name}`);
  logger.info(`Auto buy delay: ${botConfig.autoBuyDelay} ms`);
  logger.info(`Max buy retries: ${botConfig.maxBuyRetries}`);
  logger.info(`Buy amount (${quoteToken.symbol}): ${botConfig.quoteAmount.toFixed()}`);
  logger.info(`Buy slippage: ${botConfig.buySlippage}%`);

  logger.info('- Sell -');
  logger.info(`Auto sell: ${AUTO_SELL}`);
  logger.info(`Auto sell delay: ${botConfig.autoSellDelay} ms`);
  logger.info(`Max sell retries: ${botConfig.maxSellRetries}`);
  logger.info(`Sell slippage: ${botConfig.sellSlippage}%`);
  logger.info(`Price check interval: ${botConfig.priceCheckInterval} ms`);
  logger.info(`Price check duration: ${botConfig.priceCheckDuration} ms`);
  logger.info(`Take profit: ${botConfig.takeProfit}%`);
  logger.info(`Stop loss: ${botConfig.stopLoss}%`);
  logger.info(`Trailing stop: ${USE_TRAILING_STOP} (distance: ${TRAILING_STOP_DISTANCE}%, activation: ${TRAILING_STOP_ACTIVATION}%)`);

  logger.info('- Snipe list -');
  logger.info(`Snipe list: ${botConfig.useSnipeList}`);
  logger.info(`Snipe list refresh interval: ${SNIPE_LIST_REFRESH_INTERVAL} ms`);

  if (botConfig.useSnipeList) {
    logger.info('- Filters -');
    logger.info(`Filters are disabled when snipe list is on`);
  } else {
    logger.info('- Filters -');
    logger.info(`Filter check interval: ${botConfig.filterCheckInterval} ms`);
    logger.info(`Filter check duration: ${botConfig.filterCheckDuration} ms`);
    logger.info(`Consecutive filter matches: ${botConfig.consecutiveMatchCount}`);
    logger.info(`Check renounced: ${botConfig.checkRenounced}`);
    logger.info(`Check freezable: ${botConfig.checkFreezable}`);
    logger.info(`Check burned: ${botConfig.checkBurned}`);
    logger.info(`Min pool size: ${botConfig.minPoolSize.toFixed()}`);
    logger.info(`Max pool size: ${botConfig.maxPoolSize.toFixed()}`);
  }

  logger.info('------- CONFIGURATION END -------');

  logger.info('Bot is running! Press CTRL + C to stop it.');
}

const runListener = async () => {
  logger.level = LOG_LEVEL;
  logger.info('Bot is starting...');

  const marketCache = new MarketCache(connection);
  const poolCache = new PoolCache();
  let txExecutor: TransactionExecutor;

  switch (TRANSACTION_EXECUTOR) {
    case 'warp': {
      txExecutor = new WarpTransactionExecutor(CUSTOM_FEE);
      break;
    }
    case 'jito': {
      txExecutor = new JitoTransactionExecutor(CUSTOM_FEE, connection);
      break;
    }
    default: {
      txExecutor = new DefaultTransactionExecutor(connection);
      break;
    }
  }

  const wallet = WALLET;
  const quoteToken = getToken(QUOTE_MINT);
  const botConfig = <BotConfig>{
    wallet,
    quoteAta: getAssociatedTokenAddressSync(quoteToken.mint, wallet.publicKey),
    checkRenounced: CHECK_IF_MINT_IS_RENOUNCED,
    checkFreezable: CHECK_IF_FREEZABLE,
    checkBurned: CHECK_IF_BURNED,
    minPoolSize: new TokenAmount(quoteToken, MIN_POOL_SIZE, false),
    maxPoolSize: new TokenAmount(quoteToken, MAX_POOL_SIZE, false),
    quoteToken,
    quoteAmount: new TokenAmount(quoteToken, QUOTE_AMOUNT, false),
    oneTokenAtATime: ONE_TOKEN_AT_A_TIME,
    rebuySameToken: REBUY_SAME_TOKEN,
    useSnipeList: USE_SNIPE_LIST,
    autoSell: AUTO_SELL,
    autoSellDelay: AUTO_SELL_DELAY,
    maxSellRetries: MAX_SELL_RETRIES,
    autoBuyDelay: AUTO_BUY_DELAY,
    maxBuyRetries: MAX_BUY_RETRIES,
    unitLimit: COMPUTE_UNIT_LIMIT,
    unitPrice: COMPUTE_UNIT_PRICE,
    takeProfit: TAKE_PROFIT,
    stopLoss: STOP_LOSS,
    buySlippage: BUY_SLIPPAGE,
    sellSlippage: SELL_SLIPPAGE,
    priceCheckInterval: PRICE_CHECK_INTERVAL,
    priceCheckDuration: PRICE_CHECK_DURATION,
    filterCheckInterval: FILTER_CHECK_INTERVAL,
    filterCheckDuration: FILTER_CHECK_DURATION,
    consecutiveMatchCount: CONSECUTIVE_FILTER_MATCHES,
  };

  const bot = new Bot(connection, marketCache, poolCache, txExecutor, botConfig);
  const valid = await bot.validate();

  if (!valid) {
    logger.info('Bot is exiting...');
    process.exit(1);
  }

  if (PRE_LOAD_EXISTING_MARKETS) {
    await marketCache.init({ quoteToken });
  }

  const runTimestamp = Math.floor(new Date().getTime() / 1000);

  // ── Listener selection ────────────────────────────────────────────────────
  // USE_GEYSER=true  → Yellowstone gRPC (Dragon's Mouth) — ultra-low latency
  // USE_GEYSER=false → Standard WebSocket via @solana/web3.js  (default)
  // Both implementations emit identical 'pool', 'market', 'wallet' events so
  // the handler code below is shared and requires no duplication.
  // ─────────────────────────────────────────────────────────────────────────
  let listeners: Listeners | GeyserListener;

  if (USE_GEYSER) {
    if (!GEYSER_ENDPOINT) {
      logger.error('USE_GEYSER=true requires GEYSER_ENDPOINT to be set');
      process.exit(1);
    }
    logger.info({ endpoint: GEYSER_ENDPOINT }, 'Using Yellowstone Geyser (Dragon\'s Mouth) listener');
    listeners = new GeyserListener(GEYSER_ENDPOINT);
  } else {
    logger.info('Using WebSocket listener');
    listeners = new Listeners(connection);
  }

  await listeners.start({
    walletPublicKey: wallet.publicKey,
    quoteToken,
    autoSell: AUTO_SELL,
    cacheNewMarkets: CACHE_NEW_MARKETS,
  });

  listeners.on('market', (updatedAccountInfo: KeyedAccountInfo) => {
    const marketState = MARKET_STATE_LAYOUT_V3.decode(updatedAccountInfo.accountInfo.data);
    marketCache.save(updatedAccountInfo.accountId.toString(), marketState);
  });

  listeners.on('pool', async (updatedAccountInfo: KeyedAccountInfo) => {
    const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(updatedAccountInfo.accountInfo.data);
    const poolOpenTime = parseInt(poolState.poolOpenTime.toString());
    const exists = await poolCache.get(poolState.baseMint.toString());

    if (!exists && poolOpenTime > runTimestamp) {
      poolCache.save(updatedAccountInfo.accountId.toString(), poolState);
      await bot.buy(updatedAccountInfo.accountId, poolState);
    }
  });

  // ── PumpSwap Event Handlers ────────────────────────────────────────────────────
  // Handle PumpSwap AMM pools (graduated tokens)
  listeners.on('pumpswapPool', async (updatedAccountInfo: KeyedAccountInfo) => {
    if (DEX_MODE !== 'raydium' && DEX_MODE !== 'all') {
      return; // Skip if not configured for PumpSwap
    }
    
    const poolData = updatedAccountInfo.accountInfo.data;
    if (poolData.length < 32) return;
    
    // Extract base mint from pool data (typically at offset 0)
    const baseMint = new PublicKey(poolData.slice(0, 32));
    const exists = await poolCache.getPumpSwapPool(baseMint.toString());

    if (!exists) {
      poolCache.savePumpSwapPool({
        id: updatedAccountInfo.accountId.toString(),
        baseMint: baseMint.toString(),
        baseDecimals: 6, // Would need to fetch from token
        quoteDecimals: 9,
        poolAddress: updatedAccountInfo.accountId.toString(),
        type: 'pumpswapAMM',
        timestamp: Math.floor(Date.now() / 1000),
      });
      logger.info({ mint: baseMint.toString() }, 'Detected PumpSwap AMM pool');
      // Would call bot.buy() here with appropriate poolKeys
    }
  });

  // Handle Pump.fun Bonding Curves (new tokens)
  listeners.on('bondingCurve', async (updatedAccountInfo: KeyedAccountInfo) => {
    if (DEX_MODE !== 'raydium' && DEX_MODE !== 'all' && DEX_MODE !== 'pump') {
      return;
    }
    
    const curveData = updatedAccountInfo.accountInfo.data;
    // Bonding curve data contains mint at offset (typically 32)
    if (curveData.length < 64) return;
    
    const mint = new PublicKey(curveData.slice(32, 64));
    const exists = await poolCache.getPumpSwapPool(mint.toString());

    if (!exists) {
      poolCache.savePumpSwapPool({
        id: updatedAccountInfo.accountId.toString(),
        baseMint: mint.toString(),
        baseDecimals: 6,
        quoteDecimals: 9,
        poolAddress: updatedAccountInfo.accountId.toString(),
        type: 'bondingCurve',
        timestamp: Math.floor(Date.now() / 1000),
      });
      logger.info({ mint: mint.toString() }, 'Detected Pump.fun bonding curve');
      // Would call bot.buy() here for bonding curve trading
    }
  });

  listeners.on('wallet', async (updatedAccountInfo: KeyedAccountInfo) => {
    const accountData = AccountLayout.decode(updatedAccountInfo.accountInfo.data);

    if (accountData.mint.equals(quoteToken.mint)) {
      return;
    }

    await bot.sell(updatedAccountInfo.accountId, accountData);
  });

  printDetails(wallet, quoteToken, bot);
};

runListener();
