"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeyserListener = void 0;
const raydium_sdk_1 = require("@raydium-io/raydium-sdk");
const spl_token_1 = require("@solana/spl-token");
const web3_js_1 = require("@solana/web3.js");
const events_1 = require("events");
const bs58_1 = __importDefault(require("bs58"));
const yellowstone_grpc_1 = __importStar(require("@triton-one/yellowstone-grpc"));
const logger_1 = require("../helpers/logger");
const constants_1 = require("../helpers/constants");
// ── Helpers ──────────────────────────────────────────────────────────────────
/**
 * Convert a raw account update from Yellowstone into the same
 * KeyedAccountInfo shape that @solana/web3.js WebSocket emits,
 * so the rest of the bot needs zero changes.
 */
function toKeyedAccountInfo(pubkey, data, owner, lamports) {
    const accountInfo = {
        executable: false,
        owner: new web3_js_1.PublicKey(owner),
        lamports: Number(lamports),
        data,
        rentEpoch: 0,
    };
    return {
        accountId: new web3_js_1.PublicKey(pubkey),
        accountInfo,
    };
}
/**
 * Build a base58-encoded bytes string from a buffer slice — same format
 * the RPC memcmp filters use, accepted by Yellowstone as well.
 */
function memcmpBytes(layout, field, value) {
    return {
        offset: layout.offsetOf(field).toString(),
        bytes: bs58_1.default.decode(value),
    };
}
// ── GeyserListener ───────────────────────────────────────────────────────────
const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 10;
class GeyserListener extends events_1.EventEmitter {
    constructor(endpoint) {
        super();
        this.endpoint = endpoint;
        this.stream = null;
        this.reconnectAttempts = 0;
        this.stopping = false;
        this.config = null;
        this.client = new yellowstone_grpc_1.default(endpoint, '', {});
    }
    // ── Public API ─────────────────────────────────────────────────────────────
    start(config) {
        return __awaiter(this, void 0, void 0, function* () {
            this.config = config;
            this.stopping = false;
            yield this.connect();
        });
    }
    stop() {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            this.stopping = true;
            (_a = this.stream) === null || _a === void 0 ? void 0 : _a.cancel();
            this.stream = null;
            logger_1.logger.info('Geyser listener stopped');
        });
    }
    // ── Internal ───────────────────────────────────────────────────────────────
    connect() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.config)
                return;
            try {
                this.stream = yield this.client.subscribe();
                this.attachStreamHandlers(this.stream);
                yield this.sendSubscription(this.stream, this.config);
                this.reconnectAttempts = 0;
                logger_1.logger.info({ endpoint: this.endpoint }, 'Geyser (Dragon\'s Mouth) connected ✅');
            }
            catch (err) {
                logger_1.logger.error({ err }, 'Geyser connection failed');
                yield this.scheduleReconnect();
            }
        });
    }
    attachStreamHandlers(stream) {
        stream.on('data', (update) => this.handleUpdate(update));
        stream.on('error', (err) => __awaiter(this, void 0, void 0, function* () {
            logger_1.logger.error({ err }, 'Geyser stream error');
            if (!this.stopping)
                yield this.scheduleReconnect();
        }));
        stream.on('end', () => __awaiter(this, void 0, void 0, function* () {
            logger_1.logger.warn('Geyser stream ended');
            if (!this.stopping)
                yield this.scheduleReconnect();
        }));
    }
    sendSubscription(stream, config) {
        return __awaiter(this, void 0, void 0, function* () {
            const { quoteToken, walletPublicKey, autoSell, cacheNewMarkets } = config;
            const quoteMintB58 = quoteToken.mint.toBase58();
            const openBookProgramB58 = raydium_sdk_1.MAINNET_PROGRAM_ID.OPENBOOK_MARKET.toBase58();
            const pumpProgramId = constants_1.PUMP_TOKEN_PROGRAM_ID;
            const pumpswapProgramId = constants_1.PUMPSWAP_AMM_PROGRAM_ID;
            const request = {
                accounts: {},
                slots: {},
                transactions: {},
                transactionsStatus: {},
                blocks: {},
                blocksMeta: {},
                entry: {},
                accountsDataSlice: [],
                commitment: yellowstone_grpc_1.CommitmentLevel.CONFIRMED,
            };
            // ── Raydium AMM V4 pool updates (always subscribed) ────────────────────
            request.accounts['raydiumPools'] = {
                account: [],
                owner: [raydium_sdk_1.MAINNET_PROGRAM_ID.AmmV4.toBase58()],
                filters: [
                    { datasize: raydium_sdk_1.LIQUIDITY_STATE_LAYOUT_V4.span.toString() },
                    { memcmp: memcmpBytes(raydium_sdk_1.LIQUIDITY_STATE_LAYOUT_V4, 'quoteMint', quoteMintB58) },
                    { memcmp: memcmpBytes(raydium_sdk_1.LIQUIDITY_STATE_LAYOUT_V4, 'marketProgramId', openBookProgramB58) },
                    {
                        memcmp: {
                            offset: raydium_sdk_1.LIQUIDITY_STATE_LAYOUT_V4.offsetOf('status').toString(),
                            bytes: Buffer.from([6, 0, 0, 0, 0, 0, 0, 0]),
                        },
                    },
                ],
                nonemptyTxnSignature: false,
            };
            // ── PumpSwap AMM pools (graduated tokens) ───────────────────────────────
            request.accounts['pumpswapPools'] = {
                account: [],
                owner: [pumpswapProgramId],
                filters: [
                    // Filter for pools with quote mint (SOL)
                    {
                        memcmp: {
                            offset: '32',
                            bytes: bs58_1.default.decode(quoteMintB58),
                        },
                    },
                ],
                nonemptyTxnSignature: false,
            };
            // ── Pump.fun Bonding Curves (new tokens) ───────────────────────────────
            request.accounts['bondingCurves'] = {
                account: [],
                owner: [pumpProgramId],
                filters: [
                    // Bonding curve account data size (new format)
                    { datasize: '151' },
                ],
                nonemptyTxnSignature: false,
            };
            // ── OpenBook market updates (optional) ─────────────────────────────────
            if (cacheNewMarkets) {
                request.accounts['openBookMarkets'] = {
                    account: [],
                    owner: [raydium_sdk_1.MAINNET_PROGRAM_ID.OPENBOOK_MARKET.toBase58()],
                    filters: [
                        { datasize: raydium_sdk_1.MARKET_STATE_LAYOUT_V3.span.toString() },
                        { memcmp: memcmpBytes(raydium_sdk_1.MARKET_STATE_LAYOUT_V3, 'quoteMint', quoteMintB58) },
                    ],
                    nonemptyTxnSignature: false,
                };
            }
            // ── Wallet token-account changes (optional, used for auto-sell) ────────
            if (autoSell) {
                request.accounts['walletTokenAccounts'] = {
                    account: [],
                    owner: [spl_token_1.TOKEN_PROGRAM_ID.toBase58()],
                    filters: [
                        { datasize: '165' },
                        {
                            memcmp: {
                                offset: '32',
                                bytes: walletPublicKey.toBytes(),
                            },
                        },
                    ],
                    nonemptyTxnSignature: false,
                };
            }
            yield new Promise((resolve, reject) => {
                stream.write(request, (err) => {
                    if (err)
                        reject(err);
                    else
                        resolve();
                });
            });
        });
    }
    handleUpdate(update) {
        var _a;
        if (!update.account)
            return;
        const { filters } = update;
        const { account } = update.account;
        if (!(account === null || account === void 0 ? void 0 : account.pubkey) || !account.data)
            return;
        const pubkey = bs58_1.default.encode(Buffer.from(account.pubkey));
        const data = Buffer.from(account.data);
        const owner = bs58_1.default.encode(Buffer.from(account.owner));
        const lamports = BigInt((_a = account.lamports) !== null && _a !== void 0 ? _a : '0');
        const keyedInfo = toKeyedAccountInfo(pubkey, data, owner, lamports);
        // Route to the correct event based on which subscription filter matched
        for (const filterId of filters) {
            if (filterId === 'raydiumPools') {
                this.emit('pool', keyedInfo);
            }
            else if (filterId === 'pumpswapPools') {
                this.emit('pumpswapPool', keyedInfo);
            }
            else if (filterId === 'bondingCurves') {
                this.emit('bondingCurve', keyedInfo);
            }
            else if (filterId === 'openBookMarkets') {
                this.emit('market', keyedInfo);
            }
            else if (filterId === 'walletTokenAccounts') {
                this.emit('wallet', keyedInfo);
            }
        }
    }
    scheduleReconnect() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.stopping)
                return;
            this.reconnectAttempts++;
            if (this.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
                logger_1.logger.error('Geyser: max reconnect attempts reached, giving up');
                this.emit('error', new Error('Geyser max reconnect attempts exceeded'));
                return;
            }
            const delay = RECONNECT_DELAY_MS * this.reconnectAttempts;
            logger_1.logger.warn({ attempt: this.reconnectAttempts, delayMs: delay }, 'Geyser: reconnecting...');
            yield new Promise((r) => setTimeout(r, delay));
            yield this.connect();
        });
    }
}
exports.GeyserListener = GeyserListener;
