import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY ?? '32-char-hex-key-change-in-prod!!';
  return Buffer.from(raw.padEnd(32, '0').slice(0, 32));
}

export function encrypt(value: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(value: string): string {
  const [ivHex, dataHex] = value.split(':');
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}
