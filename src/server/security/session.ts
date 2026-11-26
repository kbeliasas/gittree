import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export interface SessionOptions {
  /** One-time sign-in token. Random unless given (the dev server passes one so restarts keep working). */
  token?: string;
  /** Cookie value the token is swapped for. Random unless given. */
  secret?: string;
}

/**
 * The CLI opens `/auth?token=…`; the server swaps the token, once, for an
 * HttpOnly cookie holding `secret`. Every other request must carry that cookie.
 */
export class Session {
  readonly token: string;
  readonly #secret: string;
  #tokenUsed = false;

  constructor(options: SessionOptions = {}) {
    this.token = options.token ?? randomSecret();
    this.#secret = options.secret ?? randomSecret();
  }

  /** Swaps a valid, unused token for the cookie secret. */
  redeem(candidate: string | undefined): { secret: string } | { failure: 'invalid' | 'used' } {
    if (candidate === undefined || !safeEqual(candidate, this.token)) return { failure: 'invalid' };
    if (this.#tokenUsed) return { failure: 'used' };
    this.#tokenUsed = true;
    return { secret: this.#secret };
  }

  isValidCookie(value: string | undefined): boolean {
    return value !== undefined && safeEqual(value, this.#secret);
  }
}

export function randomSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** Constant-time comparison that doesn't leak the length either. */
function safeEqual(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a).digest();
  const digestB = createHash('sha256').update(b).digest();
  return timingSafeEqual(digestA, digestB);
}
