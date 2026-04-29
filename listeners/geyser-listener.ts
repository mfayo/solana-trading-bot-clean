import { LIQUIDITY_STATE_LAYOUT_V4, MAINNET_PROGRAM_ID, MARKET_STATE_LAYOUT_V3, Token } from '@raydium-io/raydium-sdk';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { AccountInfo, KeyedAccountInfo, PublicKey } from '@solana/web3.js';
import { EventEmitter } from 'events';
import bs58 from 'bs58';
import Client, {
  CommitmentLevel,
  SubscribeRequest,
  SubscribeUpdate,
} from '@triton-one/yellowstone-grpc';
import { logger } from '../helpers/logger';
import { ClientDuplexStream } from '@grpc/grpc-js';

// ── Types ────────────────────────────────────────────────────────────────────

interface GeyserConfig {
  walletPublicKey: PublicKey;
  quoteToken: Token;
  autoSell: boolean;
  cacheNewMarkets: boolean;
}

export interface VaultUpdate {
  mint: string;
  pubkey: PublicKey;
  data: Buffer;
  slot: bigint;
  writeVersion: bigint;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert a raw account update from Yellowstone into the same
 * KeyedAccountInfo shape that @solana/web3.js WebSocket emits,
 * so the rest of the bot needs zero changes.
 */
function toKeyedAccountInfo(pubkey: string, data: Buffer, owner: string, lamports: bigint): KeyedAccountInfo {
  const accountInfo: AccountInfo<Buffer> = {
    executable: false,
    owner: new PublicKey(owner),
    lamports: Number(lamports),
    data,
    rentEpoch: 0,
  };
  return {
    accountId: new PublicKey(pubkey),
    accountInfo,
  };
}

/**
 * Build a base58-encoded bytes string from a buffer slice — same format
 * the RPC memcmp filters use, accepted by Yellowstone as well.
 */
function memcmpBytes(layout: { offsetOf(field: string): number }, field: string, value: string): { offset: string; bytes: Uint8Array } {
  return {
    offset: layout.offsetOf(field).toString(),
    bytes: bs58.decode(value),
  };
}

// ── GeyserListener ───────────────────────────────────────────────────────────

const RECONNECT_DELAY_MS = 2_000;
const MAX_RECONNECT_ATTEMPTS = 10;
const PUMPSWAP_PROGRAM_ID = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const PUMPSWAP_POOL_SIZE = 244;

export class GeyserListener extends EventEmitter {
  private client: Client;
  private stream: ClientDuplexStream<SubscribeRequest, SubscribeUpdate> | null = null;
  private reconnectAttempts = 0;
  private stopping = false;
  private config: GeyserConfig | null = null;
  private vaultWatches: Map<string, string> = new Map(); // vault pubkey (base58) → mint

  constructor(
    private readonly endpoint: string,
  ) {
    super();
    this.client = new Client(endpoint, '', {});
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  public async start(config: GeyserConfig): Promise<void> {
    this.config = config;
    this.stopping = false;
    await this.connect();
  }

  public watchVaults(baseVault: PublicKey, quoteVault: PublicKey, mint: string): void {
    this.vaultWatches.set(baseVault.toBase58(), mint);
    this.vaultWatches.set(quoteVault.toBase58(), mint);
    this.sendVaultSubscriptionUpdate();
  }

  public unwatchVaults(baseVault: PublicKey, quoteVault: PublicKey, mint: string): void {
    this.vaultWatches.delete(baseVault.toBase58());
    this.vaultWatches.delete(quoteVault.toBase58());
    this.sendVaultSubscriptionUpdate();
  }

  public async stop(): Promise<void> {
    this.stopping = true;
    this.stream?.cancel();
    this.stream = null;
    logger.info('Geyser listener stopped');
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private async connect(): Promise<void> {
    if (!this.config) return;

    try {
      this.stream = await this.client.subscribe();
      this.attachStreamHandlers(this.stream);
      await this.sendSubscription(this.stream, this.config);
      this.reconnectAttempts = 0;
      logger.info({ endpoint: this.endpoint }, 'Geyser (Dragon\'s Mouth) connected ✅');
    } catch (err) {
      logger.error({ err }, 'Geyser connection failed');
      await this.scheduleReconnect();
    }
  }

  private attachStreamHandlers(stream: ClientDuplexStream<SubscribeRequest, SubscribeUpdate>): void {
    stream.on('data', (update: SubscribeUpdate) => this.handleUpdate(update));

    stream.on('error', async (err: Error) => {
      logger.error({ err }, 'Geyser stream error');
      if (!this.stopping) await this.scheduleReconnect();
    });

    stream.on('end', async () => {
      logger.warn('Geyser stream ended');
      if (!this.stopping) await this.scheduleReconnect();
    });
  }

  private async sendSubscription(
    stream: ClientDuplexStream<SubscribeRequest, SubscribeUpdate>,
    config: GeyserConfig,
  ): Promise<void> {
    const { quoteToken, walletPublicKey, autoSell, cacheNewMarkets } = config;
    const quoteMintB58 = quoteToken.mint.toBase58();
    const openBookProgramB58 = MAINNET_PROGRAM_ID.OPENBOOK_MARKET.toBase58();

    const request: SubscribeRequest = {
      accounts: {},
      slots: {},
      transactions: {},
      transactionsStatus: {},
      blocks: {},
      blocksMeta: {},
      entry: {},
      accountsDataSlice: [],
      commitment: CommitmentLevel.CONFIRMED,
    };

    // ── Raydium AMM V4 pool updates (always subscribed) ────────────────────
    request.accounts['raydiumPools'] = {
      account: [],
      owner: [MAINNET_PROGRAM_ID.AmmV4.toBase58()],
      filters: [
        { datasize: LIQUIDITY_STATE_LAYOUT_V4.span.toString() },
        { memcmp: memcmpBytes(LIQUIDITY_STATE_LAYOUT_V4, 'quoteMint', quoteMintB58) },
        { memcmp: memcmpBytes(LIQUIDITY_STATE_LAYOUT_V4, 'marketProgramId', openBookProgramB58) },
        {
          memcmp: {
            offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('status').toString(),
            bytes: Buffer.from([6, 0, 0, 0, 0, 0, 0, 0]),
          },
        },
      ],
      nonemptyTxnSignature: false,
    };

    // ── PumpSwap pool updates ──────────────────────────────────────────────
    request.accounts['pumpswapPools'] = {
      account: [],
      owner: [PUMPSWAP_PROGRAM_ID],
      filters: [
        { datasize: PUMPSWAP_POOL_SIZE.toString() },
      ],
      nonemptyTxnSignature: false,
    };

    // ── OpenBook market updates (optional) ─────────────────────────────────
    if (cacheNewMarkets) {
      request.accounts['openBookMarkets'] = {
        account: [],
        owner: [MAINNET_PROGRAM_ID.OPENBOOK_MARKET.toBase58()],
        filters: [
          { datasize: MARKET_STATE_LAYOUT_V3.span.toString() },
          { memcmp: memcmpBytes(MARKET_STATE_LAYOUT_V3, 'quoteMint', quoteMintB58) },
        ],
        nonemptyTxnSignature: false,
      };
    }

    // ── Wallet token-account changes (optional, used for auto-sell) ────────
    if (autoSell) {
      request.accounts['walletTokenAccounts'] = {
        account: [],
        owner: [TOKEN_PROGRAM_ID.toBase58()],
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

    await new Promise<void>((resolve, reject) => {
      stream.write(request, (err: Error | null | undefined) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private handleUpdate(update: SubscribeUpdate): void {
    if (!update.account) return;

    const { filters } = update;
    const { account, slot } = update.account;
    if (!account?.pubkey || !account.data) return;

    const pubkey = bs58.encode(Buffer.from(account.pubkey));
    const data = Buffer.from(account.data);

    // Vault routing is pubkey-based — does not rely on the filters[] label,
    // which is not guaranteed to be populated on every Yellowstone delivery.
    const mint = this.vaultWatches.get(pubkey);
    if (mint) {
      const vaultUpdate: VaultUpdate = {
        mint,
        pubkey: new PublicKey(pubkey),
        data,
        slot: BigInt(slot ?? '0'),
        writeVersion: BigInt(account.writeVersion ?? '0'),
      };
      this.emit('vault', vaultUpdate);
      return; // vault updates are signal-critical; skip the filter loop
    }

    const owner = bs58.encode(Buffer.from(account.owner));
    const lamports = BigInt(account.lamports ?? '0');
    const keyedInfo = toKeyedAccountInfo(pubkey, data, owner, lamports);

    for (const filterId of filters) {
      if (filterId === 'raydiumPools') {
        this.emit('pool', keyedInfo);
      } else if (filterId === 'openBookMarkets') {
        this.emit('market', keyedInfo);
      } else if (filterId === 'walletTokenAccounts') {
        this.emit('wallet', keyedInfo);
      } else if (filterId === 'pumpswapPools') {
        this.emit('pumpswap_pool', keyedInfo);
      }
    }
  }

  private sendVaultSubscriptionUpdate(): void {
    if (!this.stream) return;
    const accounts = Array.from(this.vaultWatches.keys());
    const request: SubscribeRequest = {
      accounts: {
        vaultAccounts: {
          account: accounts,
          owner: [],
          filters: [],
          nonemptyTxnSignature: false,
        },
      },
      slots: {},
      transactions: {},
      transactionsStatus: {},
      blocks: {},
      blocksMeta: {},
      entry: {},
      accountsDataSlice: [],
      commitment: CommitmentLevel.CONFIRMED,
    };
    this.stream.write(request, (err: Error | null | undefined) => {
      if (err) logger.warn({ err }, 'Failed to update vault subscription');
    });
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.stopping) return;

    this.reconnectAttempts++;
    if (this.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      logger.error('Geyser: max reconnect attempts reached, giving up');
      this.emit('error', new Error('Geyser max reconnect attempts exceeded'));
      return;
    }

    const delay = RECONNECT_DELAY_MS * this.reconnectAttempts;
    logger.warn({ attempt: this.reconnectAttempts, delayMs: delay }, 'Geyser: reconnecting...');
    await new Promise((r) => setTimeout(r, delay));
    await this.connect();
  }
}
