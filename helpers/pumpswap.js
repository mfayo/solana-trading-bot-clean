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
exports.buildPumpSwapSellInstructions = exports.buildPumpSwapBuyInstructions = exports.buildPumpSellInstructions = exports.buildPumpBuyInstructions = exports.getPumpSwapPoolKeys = exports.getBondingCurveV2Address = exports.getBondingCurveAddress = void 0;
const pump_sdk_1 = require("@pump-fun/pump-sdk");
const logger_1 = require("./logger");
// ═══════════════════════════════════════════════════════════════════════════════
// PumpSwap Helper Module
// ═══════════════════════════════════════════════════════════════════════════════
// This module provides helper functions for trading on PumpSwap (bonding curves and AMM).
// The actual trading functions require more complex setup with SDK state fetching.
// For now, this provides the basic infrastructure for pool detection.
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Get the bonding curve PDA for a mint
 */
function getBondingCurveAddress(mint) {
    return (0, pump_sdk_1.bondingCurvePda)(mint);
}
exports.getBondingCurveAddress = getBondingCurveAddress;
/**
 * Get the bonding curve V2 PDA for a mint
 */
function getBondingCurveV2Address(mint) {
    return (0, pump_sdk_1.bondingCurveV2Pda)(mint);
}
exports.getBondingCurveV2Address = getBondingCurveV2Address;
/**
 * Get PumpSwap pool keys for a given mint
 * Note: This is a placeholder - actual implementation would require fetching pool state
 */
function getPumpSwapPoolKeys(connection, mint) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const bondingCurve = (0, pump_sdk_1.bondingCurvePda)(mint);
            const curveInfo = yield connection.getAccountInfo(bondingCurve);
            // Check if it's a bonding curve or AMM pool
            if (curveInfo && curveInfo.data.length >= 32) {
                return {
                    baseMint: mint,
                    baseDecimals: 6,
                    quoteDecimals: 9,
                    poolAddress: bondingCurve,
                    bondingCurve: bondingCurve,
                    associatedBondingCurve: bondingCurve,
                    type: 'bondingCurve',
                };
            }
            return null;
        }
        catch (error) {
            logger_1.logger.error({ mint: mint.toString(), error }, 'Failed to get PumpSwap pool keys');
            return null;
        }
    });
}
exports.getPumpSwapPoolKeys = getPumpSwapPoolKeys;
/**
 * Build placeholder instructions for Pump buy
 * TODO: Implement actual instruction building with proper SDK
 */
function buildPumpBuyInstructions(config, mint, solInAmount, minTokenOut) {
    return __awaiter(this, void 0, void 0, function* () {
        logger_1.logger.info({ mint: mint.toString(), solInAmount, minTokenOut }, 'Building Pump buy instructions - placeholder');
        return [];
    });
}
exports.buildPumpBuyInstructions = buildPumpBuyInstructions;
/**
 * Build placeholder instructions for Pump sell
 * TODO: Implement actual instruction building with proper SDK
 */
function buildPumpSellInstructions(config, mint, tokenInAmount, minSolOut) {
    return __awaiter(this, void 0, void 0, function* () {
        logger_1.logger.info({ mint: mint.toString(), tokenInAmount, minSolOut }, 'Building Pump sell instructions - placeholder');
        return [];
    });
}
exports.buildPumpSellInstructions = buildPumpSellInstructions;
/**
 * Build placeholder instructions for PumpSwap AMM buy
 * TODO: Implement actual instruction building with proper SDK
 */
function buildPumpSwapBuyInstructions(config, mint, solInAmount, minTokenOut) {
    return __awaiter(this, void 0, void 0, function* () {
        logger_1.logger.info({ mint: mint.toString(), solInAmount, minTokenOut }, 'Building PumpSwap AMM buy instructions - placeholder');
        return [];
    });
}
exports.buildPumpSwapBuyInstructions = buildPumpSwapBuyInstructions;
/**
 * Build placeholder instructions for PumpSwap AMM sell
 * TODO: Implement actual instruction building with proper SDK
 */
function buildPumpSwapSellInstructions(config, mint, tokenInAmount, minSolOut) {
    return __awaiter(this, void 0, void 0, function* () {
        logger_1.logger.info({ mint: mint.toString(), tokenInAmount, minSolOut }, 'Building PumpSwap AMM sell instructions - placeholder');
        return [];
    });
}
exports.buildPumpSwapSellInstructions = buildPumpSwapSellInstructions;
