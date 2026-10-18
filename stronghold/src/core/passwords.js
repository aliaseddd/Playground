// Password hashing with PBKDF2-SHA-256 from the Web Crypto API (browser and Node alike).

const DEFAULT_ITERATIONS = 150000;

function subtle() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new Error(
      'This browser cannot hash passwords here because Web Crypto is unavailable. Open Stronghold from https://, http://localhost or a file on this computer.',
    );
  }
  return c.subtle;
}

function toHex(bytes) {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function derive(password, salt, iterations) {
  const key = await subtle().importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return toHex(bits);
}

export async function hashPassword(password, iterations = DEFAULT_ITERATIONS) {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return { algorithm: 'PBKDF2-SHA-256', iterations, salt: toHex(salt), hash: await derive(password, salt, iterations) };
}

export async function verifyPassword(password, record) {
  if (!record || !record.salt || !record.hash) return false;
  const hash = await derive(password, fromHex(record.salt), record.iterations);
  // Constant-time comparison of the two hex strings.
  let diff = hash.length ^ record.hash.length;
  for (let i = 0; i < hash.length; i += 1) diff |= hash.charCodeAt(i) ^ (record.hash.charCodeAt(i) || 0);
  return diff === 0;
}
