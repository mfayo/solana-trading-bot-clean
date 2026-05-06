"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a, _b, _c, _d, _e, _f;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SNIPE_LIST_REFRESH_INTERVAL = exports.USE_SNIPE_LIST = exports.MAX_POOL_SIZE = exports.MIN_POOL_SIZE = exports.CHECK_IF_BURNED = exports.CHECK_IF_FREEZABLE = exports.CHECK_IF_MINT_IS_RENOUNCED = exports.CHECK_IF_SOCIALS = exports.CHECK_IF_MUTABLE = exports.CONSECUTIVE_FILTER_MATCHES = exports.FILTER_CHECK_DURATION = exports.FILTER_CHECK_INTERVAL = exports.PUMPSWAP_AMM_PROGRAM_ID = exports.PUMP_TOKEN_PROGRAM_ID = exports.PUMP_SELL_SLIPPAGE = exports.PUMP_BUY_SLIPPAGE = exports.DEX_MODE = exports.TRAILING_STOP_ACTIVATION = exports.TRAILING_STOP_DISTANCE = exports.USE_TRAILING_STOP = exports.SELL_SLIPPAGE = exports.PRICE_CHECK_DURATION = exports.PRICE_CHECK_INTERVAL = exports.STOP_LOSS = exports.TAKE_PROFIT = exports.MAX_SELL_RETRIES = exports.AUTO_SELL_DELAY = exports.REBUY_SAME_TOKEN = exports.AUTO_SELL = exports.BUY_SLIPPAGE = exports.MAX_BUY_RETRIES = exports.QUOTE_AMOUNT = exports.QUOTE_MINT = exports.AUTO_BUY_DELAY = exports.CUSTOM_FEE = exports.TRANSACTION_EXECUTOR = exports.CACHE_NEW_MARKETS = exports.PRE_LOAD_EXISTING_MARKETS = exports.COMPUTE_UNIT_PRICE = exports.COMPUTE_UNIT_LIMIT = exports.ONE_TOKEN_AT_A_TIME = exports.LOG_LEVEL = exports.GEYSER_ENDPOINT = exports.USE_GEYSER = exports.RPC_WEBSOCKET_ENDPOINT = exports.RPC_ENDPOINT = exports.COMMITMENT_LEVEL = exports.NETWORK = exports.WALLET = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const logger_1 = require("./logger");
const wallet_1 = require("./wallet");
dotenv_1.default.config();
const retrieveEnvVariable = (variableName, logger) => {
    const variable = process.env[variableName] || '';
    if (!variable) {
        logger.error(`${variableName} is not set`);
        process.exit(1);
    }
    return variable;
};
// ── Wallet ───────────────────────────────────────────────────────────────────
// The raw private-key string is parsed into a Keypair once here and is NEVER
// re-exported.  This eliminates the risk of the secret being accidentally
// serialised, logged, or read by injected code that simply imports constants.
const _rawPrivateKey = retrieveEnvVariable('PRIVATE_KEY', logger_1.logger);
exports.WALLET = (0, wallet_1.getWallet)(_rawPrivateKey.trim());
// Overwrite the in-memory string as soon as it is no longer needed.
// (JS strings are immutable, so this zeroes the local binding.)
Object.defineProperty(globalThis, '__pk__', { value: undefined });
// ─────────────────────────────────────────────────────────────────────────────
// Connection
exports.NETWORK = 'mainnet-beta';
exports.COMMITMENT_LEVEL = retrieveEnvVariable('COMMITMENT_LEVEL', logger_1.logger);
exports.RPC_ENDPOINT = retrieveEnvVariable('RPC_ENDPOINT', logger_1.logger);
exports.RPC_WEBSOCKET_ENDPOINT = retrieveEnvVariable('RPC_WEBSOCKET_ENDPOINT', logger_1.logger);
// Geyser / Yellowstone Dragon's Mouth (optional — only required when USE_GEYSER=true)
exports.USE_GEYSER = process.env['USE_GEYSER'] === 'true';
exports.GEYSER_ENDPOINT = (_a = process.env['GEYSER_ENDPOINT']) !== null && _a !== void 0 ? _a : '';
// Bot
exports.LOG_LEVEL = retrieveEnvVariable('LOG_LEVEL', logger_1.logger);
exports.ONE_TOKEN_AT_A_TIME = retrieveEnvVariable('ONE_TOKEN_AT_A_TIME', logger_1.logger) === 'true';
exports.COMPUTE_UNIT_LIMIT = Number(retrieveEnvVariable('COMPUTE_UNIT_LIMIT', logger_1.logger));
exports.COMPUTE_UNIT_PRICE = Number(retrieveEnvVariable('COMPUTE_UNIT_PRICE', logger_1.logger));
exports.PRE_LOAD_EXISTING_MARKETS = retrieveEnvVariable('PRE_LOAD_EXISTING_MARKETS', logger_1.logger) === 'true';
exports.CACHE_NEW_MARKETS = retrieveEnvVariable('CACHE_NEW_MARKETS', logger_1.logger) === 'true';
exports.TRANSACTION_EXECUTOR = retrieveEnvVariable('TRANSACTION_EXECUTOR', logger_1.logger);
exports.CUSTOM_FEE = retrieveEnvVariable('CUSTOM_FEE', logger_1.logger);
// Buy
exports.AUTO_BUY_DELAY = Number(retrieveEnvVariable('AUTO_BUY_DELAY', logger_1.logger));
exports.QUOTE_MINT = retrieveEnvVariable('QUOTE_MINT', logger_1.logger);
exports.QUOTE_AMOUNT = retrieveEnvVariable('QUOTE_AMOUNT', logger_1.logger);
exports.MAX_BUY_RETRIES = Number(retrieveEnvVariable('MAX_BUY_RETRIES', logger_1.logger));
exports.BUY_SLIPPAGE = Number(retrieveEnvVariable('BUY_SLIPPAGE', logger_1.logger));
// Sell
exports.AUTO_SELL = retrieveEnvVariable('AUTO_SELL', logger_1.logger) === 'true';
exports.REBUY_SAME_TOKEN = process.env['REBUY_SAME_TOKEN'] === 'true';
exports.AUTO_SELL_DELAY = Number(retrieveEnvVariable('AUTO_SELL_DELAY', logger_1.logger));
exports.MAX_SELL_RETRIES = Number(retrieveEnvVariable('MAX_SELL_RETRIES', logger_1.logger));
exports.TAKE_PROFIT = Number(retrieveEnvVariable('TAKE_PROFIT', logger_1.logger));
exports.STOP_LOSS = Number(retrieveEnvVariable('STOP_LOSS', logger_1.logger));
exports.PRICE_CHECK_INTERVAL = Number(retrieveEnvVariable('PRICE_CHECK_INTERVAL', logger_1.logger));
exports.PRICE_CHECK_DURATION = Number(retrieveEnvVariable('PRICE_CHECK_DURATION', logger_1.logger));
exports.SELL_SLIPPAGE = Number(retrieveEnvVariable('SELL_SLIPPAGE', logger_1.logger));
// ── Trailing Stop Loss ───────────────────────────────────────────────────────────────
// Trailing stop loss: stops at profit peak minus distance (moves up with price)
exports.USE_TRAILING_STOP = process.env['USE_TRAILING_STOP'] === 'true';
exports.TRAILING_STOP_DISTANCE = Number((_b = process.env['TRAILING_STOP_DISTANCE']) !== null && _b !== void 0 ? _b : 0); // % distance from peak (e.g., 5 = 5% below peak)
exports.TRAILING_STOP_ACTIVATION = Number((_c = process.env['TRAILING_STOP_ACTIVATION']) !== null && _c !== void 0 ? _c : 0); // % profit to activate trailing (e.g., 10 = activate after 10% profit)
// ── PumpSwap / PumpFun Configuration ────────────────────────────────────────────────
exports.DEX_MODE = (_d = process.env['DEX']) !== null && _d !== void 0 ? _d : 'raydium'; // raydium, pumpswap, pump, all
exports.PUMP_BUY_SLIPPAGE = Number((_e = process.env['PUMP_BUY_SLIPPAGE']) !== null && _e !== void 0 ? _e : 1); // Slippage for pump.fun buys (default 1%)
exports.PUMP_SELL_SLIPPAGE = Number((_f = process.env['PUMP_SELL_SLIPPAGE']) !== null && _f !== void 0 ? _f : 1); // Slippage for pump.fun sells (default 1%)
exports.PUMP_TOKEN_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'; // Bonding curve (pump.fun)
exports.PUMPSWAP_AMM_PROGRAM_ID = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA'; // PumpSwap AMM
// Filters
exports.FILTER_CHECK_INTERVAL = Number(retrieveEnvVariable('FILTER_CHECK_INTERVAL', logger_1.logger));
exports.FILTER_CHECK_DURATION = Number(retrieveEnvVariable('FILTER_CHECK_DURATION', logger_1.logger));
exports.CONSECUTIVE_FILTER_MATCHES = Number(retrieveEnvVariable('CONSECUTIVE_FILTER_MATCHES', logger_1.logger));
exports.CHECK_IF_MUTABLE = retrieveEnvVariable('CHECK_IF_MUTABLE', logger_1.logger) === 'true';
exports.CHECK_IF_SOCIALS = retrieveEnvVariable('CHECK_IF_SOCIALS', logger_1.logger) === 'true';
exports.CHECK_IF_MINT_IS_RENOUNCED = retrieveEnvVariable('CHECK_IF_MINT_IS_RENOUNCED', logger_1.logger) === 'true';
exports.CHECK_IF_FREEZABLE = retrieveEnvVariable('CHECK_IF_FREEZABLE', logger_1.logger) === 'true';
exports.CHECK_IF_BURNED = retrieveEnvVariable('CHECK_IF_BURNED', logger_1.logger) === 'true';
exports.MIN_POOL_SIZE = retrieveEnvVariable('MIN_POOL_SIZE', logger_1.logger);
exports.MAX_POOL_SIZE = retrieveEnvVariable('MAX_POOL_SIZE', logger_1.logger);
exports.USE_SNIPE_LIST = retrieveEnvVariable('USE_SNIPE_LIST', logger_1.logger) === 'true';
exports.SNIPE_LIST_REFRESH_INTERVAL = Number(retrieveEnvVariable('SNIPE_LIST_REFRESH_INTERVAL', logger_1.logger));
