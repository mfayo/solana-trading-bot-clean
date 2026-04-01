import { BlockhashWithExpiryBlockHeight, Keypair, VersionedTransaction } from '@solana/web3.js';
import { TransactionExecutor } from './transaction-executor.interface';
import { logger } from '../helpers';

export class DryRunTransactionExecutor implements TransactionExecutor {
  async executeAndConfirm(
    _transaction: VersionedTransaction,
    _payer: Keypair,
    _latestBlockHash: BlockhashWithExpiryBlockHeight,
  ): Promise<{ confirmed: boolean; signature: string }> {
    const signature = `DRY_RUN_${Date.now()}`;
    logger.info({ signature }, 'DRY RUN — transaction NOT submitted to blockchain');
    return { confirmed: true, signature };
  }
}
