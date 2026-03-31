import { Token } from '@raydium-io/raydium-sdk';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';

export function getToken(token: string) {
  switch (token) {
    case 'WSOL': {
      return Token.WSOL;
    }
    case 'USDC': {
      return new Token(
        TOKEN_PROGRAM_ID,
        new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
        6,
        'USDC',
        'USDC',
      );
    }
    case 'USD1': {
      return new Token(
        TOKEN_PROGRAM_ID,
        new PublicKey('USD1ttQYjDscXwD89mH8x6M2YyK7gq6r7rPz5zvEmuB'),
        6,
        'USD1',
        'USD1',
      );
    }
    default: {
      throw new Error(`Unsupported quote mint "${token}". Supported values are USDC, USD1 and WSOL`);
    }
  }
}
