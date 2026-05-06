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
exports.PoolCache = void 0;
const helpers_1 = require("../helpers");
// ── PoolCache ───────────────────────────────────────────────────────────────────
class PoolCache {
    constructor() {
        this.keys = new Map();
        this.pumpSwapPools = new Map();
    }
    save(id, state) {
        if (!this.keys.has(state.baseMint.toString())) {
            helpers_1.logger.trace(`Caching new pool for mint: ${state.baseMint.toString()}`);
            this.keys.set(state.baseMint.toString(), { id, state, type: 'raydium' });
        }
    }
    get(mint) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.keys.get(mint);
        });
    }
    delete(mint) {
        helpers_1.logger.trace(`Removing pool from cache for mint: ${mint}`);
        this.keys.delete(mint);
    }
    // ── PumpSwap Methods ───────────────────────────────────────────────────────────
    savePumpSwapPool(data) {
        if (!this.pumpSwapPools.has(data.baseMint)) {
            helpers_1.logger.trace(`Caching new PumpSwap pool for mint: ${data.baseMint}`);
            this.pumpSwapPools.set(data.baseMint, data);
        }
    }
    getPumpSwapPool(mint) {
        return this.pumpSwapPools.get(mint);
    }
    deletePumpSwapPool(mint) {
        helpers_1.logger.trace(`Removing PumpSwap pool from cache for mint: ${mint}`);
        this.pumpSwapPools.delete(mint);
    }
}
exports.PoolCache = PoolCache;
