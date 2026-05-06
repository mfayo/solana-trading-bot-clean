# 1. OBJECTIVE

**Goal:** Adapt the existing Raydium-only Solana trading bot to support both PumpSwap trading modes (bonding curve + AMM) with real-time gRPC pool detection.

This bot currently exclusively works with Raydium DEX. The objective is to add PumpSwap support for:
- **Bonding Curve Trading:** Buy/sell instantly on token launch (via Pump Program)
- **PumpSwap AMM Trading:** Trade on graduated pools (via PumpSwap AMM)
- **Real-time Detection:** gRPC listener for both pool types

---

# 2. CONTEXT SUMMARY

**Current System:**
- **Trading Bot:** TypeScript/Node.js Solana trading bot
- **Current DEX:** Raydium only
- **SDK:** `@raydium-io/raydium-sdk` (v1.3.1-beta.58)
- **Detection:** gRPC via Yellowstone/Dragon's Mouth, monitors Raydium pools
- **Pool Formats:** `LiquidityStateV4`, `LiquidityPoolKeysV4`

**PumpSwap Integration:**
| Component | Program ID | SDK |
|-----------|-----------|-----|
| **Bonding Curve** | `pumpNoMU5R7d2oBHpX5bBkY5wT3SZXnYqMpVAxG2` | `@pump-fun/pump-sdk` |
| **PumpSwap AMM** | `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` | `@pump-fun/pump-swap-sdk` |

**Files to Modify:**
- `bot.ts` - Add PumpSwap swap methods
- `listeners/geyser-listener.ts` - Add PumpSwap/Bonding Curve subscriptions
- `helpers/constants.ts` - Add DEX config
- `cache/pool.cache.ts` - Add PumpSwap pool format
- Filters - May need adjustments

---

# 3. APPROACH OVERVIEW

**Architecture:** Implement dual-mode support - detect and trade both Bonding Curve and PumpSwap AMM pools.

**Implementation:**
1. Add both `@pump-fun/pump-sdk` and `@pump-fun/pump-swap-sdk` dependencies
2. Extend gRPC listener with subscriptions for:
   - PumpSwap AMM pools (graduated tokens)
   - Bonding curves (new tokens)
3. Create PumpSwap helper module for both trading types
4. Route trades based on pool type (bonding curve vs AMM)
5. Reuse existing filters where possible
6. Reuse transaction executors (Warp/Jito work with any tx)

**Why this approach:**
- Bonding curve = instant trading at launch (key for sniping)
- AMM = after graduation (safer, more liquidity)
- Both detected via gRPC for real-time speed
- Backward compatible with existing Raydium

---

# 4. IMPLEMENTATION STEPS

## Step 1: Install PumpSwap SDKs
**Goal:** Add both Pump SDKs
**Method:** Add to package.json:
- `@pump-fun/pump-sdk` (bonding curve / token program)
- `@pump-fun/pump-swap-sdk` (AMM swaps)
**Reference:** `package.json`

## Step 2: Extend gRPC Listener
**Goal:** Detect PumpSwap pools in real-time
**Method:** Add new subscriptions in `geyser-listener.ts`:
- PumpSwap AMM pools (`pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`)
- Bonding curves (Pump Token Program: `pumpNoMU5R7d2oBHpX5bBkY5wT3SZXnYqMpVAxG2`)
- Route as separate events: `pumpswapPool`, `bondingCurve`
**Reference:** `listeners/geyser-listener.ts:140-156`

### New Subscription Filters
```typescript
// PumpSwap AMM pools
request.accounts['pumpswapPools'] = {
  account: [],
  owner: [PUMPSWAP_AMM_PROGRAM_ID],
  filters: [/* pool data size, quote mint filter */],
};

// Bonding curves
request.accounts['bondingCurves'] = {
  account: [],
  owner: [PUMP_TOKEN_PROGRAM_ID],
  filters: [/* curve data size, state filter */],
};
```

## Step 3: Create PumpSwap Helper Module
**Goal:** Handle all PumpSwap operations
**Method:** Create `helpers/pumpswap.ts` with:
- Program ID constants
- Bonding curve buy/sell (using `@pump-fun/pump-sdk`)
- AMM swap (using `@pump-fun/pump-swap-sdk`)
- Pool key generation
- Pool state parsing
**Reference:** New file `helpers/pumpswap.ts`

## Step 4: Add DEX Configuration
**Goal:** Select which DEX to trade on
**Method:** Add environment variable:
- `DEX=raydium` (existing)
- `DEX=pumpswap` (AMM only)
- `DEX=pump` (bonding curve only - fastest)
- `DEX=all` (all available pools)
**Reference:** `helpers/constants.ts`

## Step 5: Modify Bot Trading Logic
**Goal:** Route trades to correct DEX/program
**Method:** In `bot.ts`:
- Detect pool type (Raydium / PumpSwap AMM / Bonding Curve)
- Route to appropriate swap function
- Apply filters as configured
**Reference:** `bot.ts`

## Step 6: Update Cache System
**Goal:** Store PumpSwap pool data
**Method:** Extend pool cache to handle:
- PumpSwap pool accounts
- Bonding curve state accounts
**Reference:** `cache/pool.cache.ts`

## Step 7: Transaction Executors
**Goal:** Verify compatibility
**Method:** Existing Warp/Jito executors work with any VersionedTransaction - no changes needed.
**Reference:** `transactions/*.ts`

---

# 5. TESTING AND VALIDATION

**Success Conditions:**
1. ✅ Bot detects PumpSwap AMM pools in real-time ✅ Bot detects Bonding Curves on token creation
2. ✅ BUY executes on bonding curve (instant)
3. ✅ SELL executes on bonding curve (instant)
4. ✅ BUY/SELL on PumpSwap AMM (graduated tokens)
5. ✅ Transaction appears on Solscan with correct program (Pump/PumpSwap)
6. ✅ Filters correctly evaluate pump.fun pool data

**Testing Commands:**
```bash
# Trade on bonding curves only (fastest sniping)
DEX=pump

# Trade on PumpSwap AMM only
DEX=pumpswap

# Trade on both (comprehensive)
DEX=all
```

**Expected Output:**
- Logs show "Pump bonding curve" or "PumpSwap AMM" when executing
- Transaction shows correct program address on Solscan

---

# 6. TRADE-OFFS & DECISIONS

**Q: Should both DEXs run simultaneously?**
- Recommendation: Use `oneTokenAtATime=true` when running multiple DEX modes
- Otherwise separate processes (one per DEX)

**Q: Should pump.fun tokens graduating to Raydium also be tracked?**
- This would require cross-DEX pool tracking
- Future enhancement: Track migrated pools on Raydium
