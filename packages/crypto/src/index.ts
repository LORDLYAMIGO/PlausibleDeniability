import argon2 from 'argon2';
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

export const SALT_SIZE = 32;
export const NONCE_SIZE = 12;
export const TAG_SIZE = 16;

export interface KdfParams {
  memory: number;
  iterations: number;
  parallelism: number;
}

export const DEFAULT_KDF: KdfParams = {
  memory: 64 * 1024,
  iterations: 3,
  parallelism: 1
};

export async function deriveMasterKey(password: string, salt: Buffer, params: KdfParams): Promise<Buffer> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    raw: true,
    salt,
    memoryCost: params.memory,
    timeCost: params.iterations,
    parallelism: params.parallelism,
    hashLength: 32
  });
}

export function deriveKeys(masterKey: Buffer): { placement: Buffer; encryption: Buffer } {
  return {
    placement: Buffer.from(hkdfSync('sha256', masterKey, Buffer.alloc(0), 'plausible-deniability/placement/v1', 32)),
    encryption: Buffer.from(hkdfSync('sha256', masterKey, Buffer.alloc(0), 'plausible-deniability/encryption/v1', 32))
  };
}

export function keyedBytes(key: Buffer, label: string, size = 32): Buffer {
  return createHmac('sha256', key).update(label).digest().subarray(0, size);
}

export function encrypt(key: Buffer, plaintext: Buffer, aad?: Buffer): Buffer {
  const nonce = randomBytes(NONCE_SIZE);
  const cipher = createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: TAG_SIZE });
  if (aad) cipher.setAAD(aad, { plaintextLength: plaintext.length });
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]);
}

export function decrypt(key: Buffer, encoded: Buffer, aad?: Buffer): Buffer | undefined {
  if (encoded.length < NONCE_SIZE + TAG_SIZE) return undefined;
  try {
    const nonce = encoded.subarray(0, NONCE_SIZE);
    const tag = encoded.subarray(encoded.length - TAG_SIZE);
    const ciphertext = encoded.subarray(NONCE_SIZE, encoded.length - TAG_SIZE);
    const decipher = createDecipheriv('chacha20-poly1305', key, nonce, { authTagLength: TAG_SIZE });
    if (aad) decipher.setAAD(aad, { plaintextLength: ciphertext.length });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    return undefined;
  }
}
