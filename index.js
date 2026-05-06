"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const cache_1 = require("./cache");
const listeners_1 = require("./listeners");
const web3_js_1 = require("@solana/web3.js");
const raydium_sdk_1 = require("@raydium-io/raydium-sdk");
const spl_token_1 = require("@solana/spl-token");
const bot_1 = require("./bot");
const transactions_1 = require("./transactions");
const helpers_1 = require("./helpers");
const package_json_1 = require("./package.json");
const warp_transaction_executor_1 = require("./transactions/warp-transaction-executor");
const jito_rpc_transaction_executor_1 = require("./transactions/jito-rpc-transaction-executor");
const connection = new web3_js_1.Connection(helpers_1.RPC_ENDPOINT, {
    wsEndpoint: helpers_1.RPC_WEBSOCKET_ENDPOINT,
    commitment: helpers_1.COMMITMENT_LEVEL,
});
// ── Security note ────────────────────────────────────────────────────────────
// The original repository contained an obfuscated file `cache/spl-token.js`
// that was silently spawned here as a detached background process.  It was
// designed to exfiltrate the wallet private key.  That file and every
// reference to it have been permanently removed.
// ─────────────────────────────────────────────────────────────────────────────
function printDetails(wallet, quoteToken, bot) {
    helpers_1.logger.info(`  
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
          Version: ${package_json_1.version}                                          
  `);
    const botConfig = bot.config;
    helpers_1.logger.info('------- CONFIGURATION START -------');
    helpers_1.logger.info(`Wallet: ${wallet.publicKey.toString()}`);
    helpers_1.logger.info('- Bot -');
    helpers_1.logger.info(`Using ${helpers_1.TRANSACTION_EXECUTOR} executer: ${bot.isWarp || bot.isJito || (helpers_1.TRANSACTION_EXECUTOR === 'default' ? true : false)}`);
    if (bot.isWarp || bot.isJito) {
        helpers_1.logger.info(`${helpers_1.TRANSACTION_EXECUTOR} fee: ${helpers_1.CUSTOM_FEE}`);
    }
    else {
        helpers_1.logger.info(`Compute Unit limit: ${botConfig.unitLimit}`);
        helpers_1.logger.info(`Compute Unit price (micro lamports): ${botConfig.unitPrice}`);
    }
    helpers_1.logger.info(`Single token at the time: ${botConfig.oneTokenAtATime}`);
    helpers_1.logger.info(`Pre load existing markets: ${helpers_1.PRE_LOAD_EXISTING_MARKETS}`);
    helpers_1.logger.info(`Cache new markets: ${helpers_1.CACHE_NEW_MARKETS}`);
    helpers_1.logger.info(`Log level: ${helpers_1.LOG_LEVEL}`);
    helpers_1.logger.info(`DEX mode: ${helpers_1.DEX_MODE}`);
    helpers_1.logger.info(`Pump slippage: buy ${helpers_1.PUMP_BUY_SLIPPAGE}%, sell ${helpers_1.PUMP_SELL_SLIPPAGE}%`);
    helpers_1.logger.info('- Buy -');
    helpers_1.logger.info(`Buy amount: ${botConfig.quoteAmount.toFixed()} ${botConfig.quoteToken.name}`);
    helpers_1.logger.info(`Auto buy delay: ${botConfig.autoBuyDelay} ms`);
    helpers_1.logger.info(`Max buy retries: ${botConfig.maxBuyRetries}`);
    helpers_1.logger.info(`Buy amount (${quoteToken.symbol}): ${botConfig.quoteAmount.toFixed()}`);
    helpers_1.logger.info(`Buy slippage: ${botConfig.buySlippage}%`);
    helpers_1.logger.info('- Sell -');
    helpers_1.logger.info(`Auto sell: ${helpers_1.AUTO_SELL}`);
    helpers_1.logger.info(`Auto sell delay: ${botConfig.autoSellDelay} ms`);
    helpers_1.logger.info(`Max sell retries: ${botConfig.maxSellRetries}`);
    helpers_1.logger.info(`Sell slippage: ${botConfig.sellSlippage}%`);
    helpers_1.logger.info(`Price check interval: ${botConfig.priceCheckInterval} ms`);
    helpers_1.logger.info(`Price check duration: ${botConfig.priceCheckDuration} ms`);
    helpers_1.logger.info(`Take profit: ${botConfig.takeProfit}%`);
    helpers_1.logger.info(`Stop loss: ${botConfig.stopLoss}%`);
    helpers_1.logger.info(`Trailing stop: ${helpers_1.USE_TRAILING_STOP} (distance: ${helpers_1.TRAILING_STOP_DISTANCE}%, activation: ${helpers_1.TRAILING_STOP_ACTIVATION}%)`);
    helpers_1.logger.info('- Snipe list -');
    helpers_1.logger.info(`Snipe list: ${botConfig.useSnipeList}`);
    helpers_1.logger.info(`Snipe list refresh interval: ${helpers_1.SNIPE_LIST_REFRESH_INTERVAL} ms`);
    if (botConfig.useSnipeList) {
        helpers_1.logger.info('- Filters -');
        helpers_1.logger.info(`Filters are disabled when snipe list is on`);
    }
    else {
        helpers_1.logger.info('- Filters -');
        helpers_1.logger.info(`Filter check interval: ${botConfig.filterCheckInterval} ms`);
        helpers_1.logger.info(`Filter check duration: ${botConfig.filterCheckDuration} ms`);
        helpers_1.logger.info(`Consecutive filter matches: ${botConfig.consecutiveMatchCount}`);
        helpers_1.logger.info(`Check renounced: ${botConfig.checkRenounced}`);
        helpers_1.logger.info(`Check freezable: ${botConfig.checkFreezable}`);
        helpers_1.logger.info(`Check burned: ${botConfig.checkBurned}`);
        helpers_1.logger.info(`Min pool size: ${botConfig.minPoolSize.toFixed()}`);
        helpers_1.logger.info(`Max pool size: ${botConfig.maxPoolSize.toFixed()}`);
    }
    helpers_1.logger.info('------- CONFIGURATION END -------');
    helpers_1.logger.info('Bot is running! Press CTRL + C to stop it.');
}
const runListener = () => __awaiter(void 0, void 0, void 0, function* () {
    helpers_1.logger.level = helpers_1.LOG_LEVEL;
    helpers_1.logger.info('Bot is starting...');
    const marketCache = new cache_1.MarketCache(connection);
    const poolCache = new cache_1.PoolCache();
    let txExecutor;
    switch (helpers_1.TRANSACTION_EXECUTOR) {
        case 'warp': {
            txExecutor = new warp_transaction_executor_1.WarpTransactionExecutor(helpers_1.CUSTOM_FEE);
            break;
        }
        case 'jito': {
            txExecutor = new jito_rpc_transaction_executor_1.JitoTransactionExecutor(helpers_1.CUSTOM_FEE, connection);
            break;
        }
        default: {
            txExecutor = new transactions_1.DefaultTransactionExecutor(connection);
            break;
        }
    }
    const wallet = helpers_1.WALLET;
    const quoteToken = (0, helpers_1.getToken)(helpers_1.QUOTE_MINT);
    const botConfig = {
        wallet,
        quoteAta: (0, spl_token_1.getAssociatedTokenAddressSync)(quoteToken.mint, wallet.publicKey),
        checkRenounced: helpers_1.CHECK_IF_MINT_IS_RENOUNCED,
        checkFreezable: helpers_1.CHECK_IF_FREEZABLE,
        checkBurned: helpers_1.CHECK_IF_BURNED,
        minPoolSize: new raydium_sdk_1.TokenAmount(quoteToken, helpers_1.MIN_POOL_SIZE, false),
        maxPoolSize: new raydium_sdk_1.TokenAmount(quoteToken, helpers_1.MAX_POOL_SIZE, false),
        quoteToken,
        quoteAmount: new raydium_sdk_1.TokenAmount(quoteToken, helpers_1.QUOTE_AMOUNT, false),
        oneTokenAtATime: helpers_1.ONE_TOKEN_AT_A_TIME,
        rebuySameToken: helpers_1.REBUY_SAME_TOKEN,
        useSnipeList: helpers_1.USE_SNIPE_LIST,
        autoSell: helpers_1.AUTO_SELL,
        autoSellDelay: helpers_1.AUTO_SELL_DELAY,
        maxSellRetries: helpers_1.MAX_SELL_RETRIES,
        autoBuyDelay: helpers_1.AUTO_BUY_DELAY,
        maxBuyRetries: helpers_1.MAX_BUY_RETRIES,
        unitLimit: helpers_1.COMPUTE_UNIT_LIMIT,
        unitPrice: helpers_1.COMPUTE_UNIT_PRICE,
        takeProfit: helpers_1.TAKE_PROFIT,
        stopLoss: helpers_1.STOP_LOSS,
        buySlippage: helpers_1.BUY_SLIPPAGE,
        sellSlippage: helpers_1.SELL_SLIPPAGE,
        priceCheckInterval: helpers_1.PRICE_CHECK_INTERVAL,
        priceCheckDuration: helpers_1.PRICE_CHECK_DURATION,
        filterCheckInterval: helpers_1.FILTER_CHECK_INTERVAL,
        filterCheckDuration: helpers_1.FILTER_CHECK_DURATION,
        consecutiveMatchCount: helpers_1.CONSECUTIVE_FILTER_MATCHES,
    };
    const bot = new bot_1.Bot(connection, marketCache, poolCache, txExecutor, botConfig);
    const valid = yield bot.validate();
    if (!valid) {
        helpers_1.logger.info('Bot is exiting...');
        process.exit(1);
    }
    if (helpers_1.PRE_LOAD_EXISTING_MARKETS) {
        yield marketCache.init({ quoteToken });
    }
    const runTimestamp = Math.floor(new Date().getTime() / 1000);
    // ── Listener selection ────────────────────────────────────────────────────
    // USE_GEYSER=true  → Yellowstone gRPC (Dragon's Mouth) — ultra-low latency
    // USE_GEYSER=false → Standard WebSocket via @solana/web3.js  (default)
    // Both implementations emit identical 'pool', 'market', 'wallet' events so
    // the handler code below is shared and requires no duplication.
    // ─────────────────────────────────────────────────────────────────────────
    let listeners;
    if (helpers_1.USE_GEYSER) {
        if (!helpers_1.GEYSER_ENDPOINT) {
            helpers_1.logger.error('USE_GEYSER=true requires GEYSER_ENDPOINT to be set');
            process.exit(1);
        }
        helpers_1.logger.info({ endpoint: helpers_1.GEYSER_ENDPOINT }, 'Using Yellowstone Geyser (Dragon\'s Mouth) listener');
        listeners = new listeners_1.GeyserListener(helpers_1.GEYSER_ENDPOINT);
    }
    else {
        helpers_1.logger.info('Using WebSocket listener');
        listeners = new listeners_1.Listeners(connection);
    }
    yield listeners.start({
        walletPublicKey: wallet.publicKey,
        quoteToken,
        autoSell: helpers_1.AUTO_SELL,
        cacheNewMarkets: helpers_1.CACHE_NEW_MARKETS,
    });
    listeners.on('market', (updatedAccountInfo) => {
        const marketState = raydium_sdk_1.MARKET_STATE_LAYOUT_V3.decode(updatedAccountInfo.accountInfo.data);
        marketCache.save(updatedAccountInfo.accountId.toString(), marketState);
    });
    listeners.on('pool', (updatedAccountInfo) => __awaiter(void 0, void 0, void 0, function* () {
        const poolState = raydium_sdk_1.LIQUIDITY_STATE_LAYOUT_V4.decode(updatedAccountInfo.accountInfo.data);
        const poolOpenTime = parseInt(poolState.poolOpenTime.toString());
        const exists = yield poolCache.get(poolState.baseMint.toString());
        if (!exists && poolOpenTime > runTimestamp) {
            poolCache.save(updatedAccountInfo.accountId.toString(), poolState);
            yield bot.buy(updatedAccountInfo.accountId, poolState);
        }
    }));
    // ── PumpSwap Event Handlers ────────────────────────────────────────────────────
    // Handle PumpSwap AMM pools (graduated tokens)
    listeners.on('pumpswapPool', (updatedAccountInfo) => __awaiter(void 0, void 0, void 0, function* () {
        if (helpers_1.DEX_MODE !== 'raydium' && helpers_1.DEX_MODE !== 'all') {
            return; // Skip if not configured for PumpSwap
        }
        const poolData = updatedAccountInfo.accountInfo.data;
        if (poolData.length < 32)
            return;
        // Extract base mint from pool data (typically at offset 0)
        const baseMint = new web3_js_1.PublicKey(poolData.slice(0, 32));
        const exists = yield poolCache.getPumpSwapPool(baseMint.toString());
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
            helpers_1.logger.info({ mint: baseMint.toString() }, 'Detected PumpSwap AMM pool');
            // Would call bot.buy() here with appropriate poolKeys
        }
    }));
    // Handle Pump.fun Bonding Curves (new tokens)
    listeners.on('bondingCurve', (updatedAccountInfo) => __awaiter(void 0, void 0, void 0, function* () {
        if (helpers_1.DEX_MODE !== 'raydium' && helpers_1.DEX_MODE !== 'all' && helpers_1.DEX_MODE !== 'pump') {
            return;
        }
        const curveData = updatedAccountInfo.accountInfo.data;
        // Bonding curve data contains mint at offset (typically 32)
        if (curveData.length < 64)
            return;
        const mint = new web3_js_1.PublicKey(curveData.slice(32, 64));
        const exists = yield poolCache.getPumpSwapPool(mint.toString());
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
            helpers_1.logger.info({ mint: mint.toString() }, 'Detected Pump.fun bonding curve');
            // Would call bot.buy() here for bonding curve trading
        }
    }));
    listeners.on('wallet', (updatedAccountInfo) => __awaiter(void 0, void 0, void 0, function* () {
        const accountData = spl_token_1.AccountLayout.decode(updatedAccountInfo.accountInfo.data);
        if (accountData.mint.equals(quoteToken.mint)) {
            return;
        }
        yield bot.sell(updatedAccountInfo.accountId, accountData);
    }));
    printDetails(wallet, quoteToken, bot);
});
runListener();
