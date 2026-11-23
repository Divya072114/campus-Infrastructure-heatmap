import crypto from 'node:crypto';

const SESSION_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16
    ? process.env.SESSION_SECRET
    : crypto.randomBytes(32).toString('hex');

const TOKEN_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

export interface SessionPayload {
  sub: string;
  userId: number;
  role: 'student' | 'admin';
  email: string;
  exp: number;
}

export function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

export function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const parts = storedHash.split(':');
    if (parts.length !== 2) return resolve(false);
    const [salt, keyHex] = parts;
    if (!salt || !keyHex) return resolve(false);
    const keyBuf = Buffer.from(keyHex, 'hex');
    crypto.scrypt(password, salt, keyBuf.length, (err, derivedKey) => {
      if (err) return reject(err);
      if (derivedKey.length !== keyBuf.length) return resolve(false);
      resolve(crypto.timingSafeEqual(derivedKey, keyBuf));
    });
  });
}

export function safeEqualString(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export function signSessionToken(payload: Omit<SessionPayload, 'exp'>): string {
  const fullPayload: SessionPayload = {
    ...payload,
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [encoded, sig] = parts;
    if (!encoded || !sig) return null;
    const expectedSig = crypto
      .createHmac('sha256', SESSION_SECRET)
      .update(encoded)
      .digest('base64url');
    if (!safeEqualString(sig, expectedSig)) return null;
    const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (!decoded || typeof decoded.exp !== 'number' || decoded.exp < Date.now()) {
      return null;
    }
    if (decoded.role !== 'student' && decoded.role !== 'admin') return null;
    return decoded;
  } catch {
    return null;
  }
}

export function normalizeMobile(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/\D/g, '');
  const trimmed = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(trimmed) ? trimmed : null;
}

export function normalizeRollNumber(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,20}$/.test(cleaned)) return null;
  return cleaned;
}

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned) || cleaned.length > 254) return null;
  return cleaned;
}

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export function validateImageBuffer(
  buffer: Buffer,
  declaredMime: string
): { valid: true; mimeType: string } | { valid: false; error: string } {
  if (!buffer || buffer.length === 0) {
    return { valid: false, error: 'Uploaded file is empty.' };
  }
  if (buffer.length > 5 * 1024 * 1024) {
    return { valid: false, error: 'Image size must be 5 MB or less.' };
  }
  if (!ALLOWED_IMAGE_MIME_TYPES.has(declaredMime)) {
    return { valid: false, error: 'Only JPEG, PNG, WebP, or GIF images are allowed.' };
  }

  const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng =
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;
  const isGif =
    buffer.length >= 6 &&
    (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' ||
      buffer.subarray(0, 6).toString('ascii') === 'GIF89a');
  const isWebp =
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP';

  if (declaredMime === 'image/jpeg' && isJpeg) return { valid: true, mimeType: 'image/jpeg' };
  if (declaredMime === 'image/png' && isPng) return { valid: true, mimeType: 'image/png' };
  if (declaredMime === 'image/gif' && isGif) return { valid: true, mimeType: 'image/gif' };
  if (declaredMime === 'image/webp' && isWebp) return { valid: true, mimeType: 'image/webp' };

  return {
    valid: false,
    error: 'File contents do not match a valid JPEG, PNG, WebP, or GIF image.',
  };
}

export function escapeCsvCell(value: unknown): string {
  const str = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  return `"${safe.replace(/"/g, '""')}"`;
}
