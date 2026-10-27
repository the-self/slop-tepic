// server/passwords.ts
// A private room's password, kept only as a salted scrypt hash (node:crypto, no dependency): never the password
// itself, not even in memory past the hello that set it. Checked in constant time. Asynchronous, so a hello hashing a
// password doesn't stall the ticks of every room on the server.

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const KEY_BYTES = 32;
const SALT_BYTES = 16;

/** A password as the server keeps it */
export interface PasswordHash {
  salt: Buffer;
  hash: Buffer;
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFC'), salt, KEY_BYTES, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

async function hashPassword(password: string): Promise<PasswordHash> {
  const salt = randomBytes(SALT_BYTES);
  return { salt, hash: await derive(password, salt) };
}

async function checkPassword(password: string, kept: PasswordHash): Promise<boolean> {
  const key = await derive(password, kept.salt);
  return timingSafeEqual(key, kept.hash);
}

export { hashPassword, checkPassword };
