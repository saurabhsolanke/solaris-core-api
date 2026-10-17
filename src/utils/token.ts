import crypto from 'crypto';
import { env } from '../config/env';
import { UserRole } from '../types/database';

function base64UrlEncode(data: string | Buffer): string {
  const base64 = Buffer.isBuffer(data) ? data.toString('base64') : Buffer.from(data).toString('base64');
  return base64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export interface TokenClaims {
  sub: string;
  tenant_id: string;
  role: UserRole;
  email?: string;
  [key: string]: unknown;
}

/**
 * Signs a multi-tenant JWT payload with HS256 using the configured JWT_SECRET.
 */
export function signJwt(claims: TokenClaims, secret: string = env.JWT_SECRET): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now,
    exp: now + 30 * 24 * 60 * 60, // 30 days validity
    ...claims,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest();

  return `${encodedHeader}.${encodedPayload}.${base64UrlEncode(signature)}`;
}
