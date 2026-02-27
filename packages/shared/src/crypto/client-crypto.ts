/**
 * Client-side encryption for Edison Watch zero-knowledge secrets.
 *
 * Mirrors the server-side encryption in src/secrets_encryption.py:
 *   - Key derivation: HKDF-SHA256, salt = zero-filled (32 bytes), info = "edison-secret:{context}"
 *   - Cipher:         AES-256-GCM
 *   - Wire format:    MAGIC_PREFIX + base64( nonce[12] || ciphertext )
 *
 * Composite key format:
 *   user:{base64_key}.admin:{base64_key}[.role:NAME:{base64_key} ...]
 */

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

// -- Magic Prefix --

/**
 * Deterministic prefix prepended to all encrypted blobs.
 * Must match the Python constant in src/secrets_encryption.py.
 */
export const MAGIC_PREFIX = "$EDISON$1$";

/** Return true if the value starts with the Edison encryption magic prefix. */
export function hasMagicPrefix(value: string): boolean {
  return value.startsWith(MAGIC_PREFIX);
}

/** Strip the magic prefix if present; return unchanged otherwise. */
function stripMagicPrefix(value: string): string {
  return value.startsWith(MAGIC_PREFIX) ? value.slice(MAGIC_PREFIX.length) : value;
}

// -- Composite Key Parsing --

export interface CompositeKey {
  userPart: string;
  domainPart: string | null;
  roleKeys: Record<string, string>;
}

/**
 * Parse a composite key string with self-describing typed segments.
 * Format: user:{key}[.admin:{key}][.role:{name}:{key} ...]
 */
export function parseCompositeKey(key: string): CompositeKey {
  let userPart: string | null = null;
  let domainPart: string | null = null;
  const roleKeys: Record<string, string> = {};

  for (const segment of key.split(".")) {
    if (segment.startsWith("user:")) {
      userPart = segment.slice(5);
    } else if (segment.startsWith("admin:")) {
      domainPart = segment.slice(6);
    } else if (segment.startsWith("role:")) {
      const rest = segment.slice(5);
      const colonIdx = rest.indexOf(":");
      if (colonIdx === -1) {
        throw new Error(`Invalid role key segment (missing role name): ${segment}`);
      }
      roleKeys[rest.slice(0, colonIdx)] = rest.slice(colonIdx + 1);
    } else {
      throw new Error(`Unknown key segment type: ${segment}`);
    }
  }

  if (userPart === null) {
    throw new Error("Composite key must contain a user: segment");
  }

  return { userPart, domainPart, roleKeys };
}

/** Build a composite key string from its parts. */
export function buildCompositeKey(userPart: string, domainPart: string | null): string {
  const parts = [`user:${userPart}`];
  if (domainPart !== null) {
    parts.push(`admin:${domainPart}`);
  }
  return parts.join(".");
}

// -- Key Derivation --

async function deriveKey(
  secretKey: string,
  context: string,
  usages: KeyUsage[] = ["encrypt", "decrypt"],
): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey(
    "raw",
    ENCODER.encode(secretKey),
    "HKDF",
    false,
    ["deriveKey"],
  );

  const salt = new Uint8Array(32); // zero-filled per RFC 5869

  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: ENCODER.encode(`edison-secret:${context}`) },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    usages,
  );
}

// -- Encrypt / Decrypt --

export async function encryptSecret(
  plaintext: string,
  secretKey: string,
  serverName: string,
  templateKey: string,
): Promise<string> {
  const key = await deriveKey(secretKey, `${serverName}:${templateKey}`, ["encrypt"]);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    ENCODER.encode(plaintext),
  );

  const combined = new Uint8Array(nonce.length + ciphertext.byteLength);
  combined.set(nonce, 0);
  combined.set(new Uint8Array(ciphertext), nonce.length);

  return MAGIC_PREFIX + btoa(String.fromCharCode(...combined));
}

export async function decryptSecret(
  encryptedBase64: string,
  secretKey: string,
  serverName: string,
  templateKey: string,
): Promise<string> {
  if (!encryptedBase64 || encryptedBase64.startsWith("__")) {
    throw new Error(`Cannot decrypt sentinel or placeholder value for ${serverName}:${templateKey}`);
  }

  const key = await deriveKey(secretKey, `${serverName}:${templateKey}`);

  // Strip magic prefix if present (backward compat for legacy values without it)
  const rawB64 = stripMagicPrefix(encryptedBase64);

  let raw: Uint8Array;
  try {
    raw = Uint8Array.from(atob(rawB64), (c) => c.charCodeAt(0));
  } catch {
    throw new Error(`Invalid base64 input for ${serverName}:${templateKey}`);
  }

  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: raw.slice(0, 12) },
    key,
    raw.slice(12),
  );

  return DECODER.decode(plainBuf);
}

/** Batch-encrypt all values in a config object. */
export async function encryptServerConfig(
  config: Record<string, string>,
  serverName: string,
  secretKey: string,
): Promise<Record<string, string>> {
  const encrypted: Record<string, string> = {};
  for (const [templateKey, plaintext] of Object.entries(config)) {
    if (!plaintext) {
      encrypted[templateKey] = plaintext;
      continue;
    }
    encrypted[templateKey] = await encryptSecret(plaintext, secretKey, serverName, templateKey);
  }
  return encrypted;
}

/** Batch-decrypt all encrypted values. Keys that fail are left as-is. */
export async function decryptServerConfigs(
  configs: Record<string, Record<string, string>>,
  encryptedKeys: Record<string, string[]>,
  secretKey: string,
): Promise<{
  decrypted: Record<string, Record<string, string>>;
  failedKeys: Array<{ server: string; key: string; error: string }>;
}> {
  const decrypted: Record<string, Record<string, string>> = {};
  const failedKeys: Array<{ server: string; key: string; error: string }> = [];

  for (const [serverName, serverValues] of Object.entries(configs)) {
    decrypted[serverName] = { ...serverValues };
    for (const templateKey of encryptedKeys[serverName] ?? []) {
      const ciphertext = serverValues[templateKey];
      if (!ciphertext) continue;
      try {
        decrypted[serverName][templateKey] = await decryptSecret(
          ciphertext,
          secretKey,
          serverName,
          templateKey,
        );
      } catch (e) {
        failedKeys.push({
          server: serverName,
          key: templateKey,
          error: e instanceof Error ? e.message : "Decryption failed",
        });
      }
    }
  }

  return { decrypted, failedKeys };
}

// -- Domain Key Functions --

async function deriveDomainKey(domainKey: string, context: string): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey(
    "raw",
    ENCODER.encode(domainKey),
    "HKDF",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32),
      info: ENCODER.encode(`edison-domain-secret:${context}`),
    },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
}

export async function decryptDomainSecret(
  encryptedBase64: string,
  domainKey: string,
  serverName: string,
  templateKey: string,
): Promise<string> {
  if (!encryptedBase64 || encryptedBase64.startsWith("__")) {
    throw new Error(`Cannot decrypt sentinel or placeholder value for ${serverName}:${templateKey}`);
  }

  const key = await deriveDomainKey(domainKey, `${serverName}:${templateKey}`);

  // Strip magic prefix if present (backward compat for legacy values without it)
  const rawB64 = stripMagicPrefix(encryptedBase64);

  let raw: Uint8Array;
  try {
    raw = Uint8Array.from(atob(rawB64), (c) => c.charCodeAt(0));
  } catch {
    throw new Error(`Invalid base64 input for ${serverName}:${templateKey}`);
  }

  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: raw.slice(0, 12) },
    key,
    raw.slice(12),
  );

  return DECODER.decode(plainBuf);
}

export async function decryptAdminServerConfigs(
  configs: Record<string, Record<string, string>>,
  encryptedKeys: Record<string, string[]>,
  domainKey: string,
): Promise<{
  decrypted: Record<string, Record<string, string>>;
  failedKeys: Array<{ server: string; key: string; error: string }>;
}> {
  const decrypted: Record<string, Record<string, string>> = {};
  const failedKeys: Array<{ server: string; key: string; error: string }> = [];

  for (const [serverName, serverValues] of Object.entries(configs)) {
    decrypted[serverName] = { ...serverValues };
    for (const templateKey of encryptedKeys[serverName] ?? []) {
      const ciphertext = serverValues[templateKey];
      if (!ciphertext) continue;
      try {
        decrypted[serverName][templateKey] = await decryptDomainSecret(
          ciphertext,
          domainKey,
          serverName,
          templateKey,
        );
      } catch (e) {
        failedKeys.push({
          server: serverName,
          key: templateKey,
          error: e instanceof Error ? e.message : "Decryption failed",
        });
      }
    }
  }

  return { decrypted, failedKeys };
}

/** Generate a new domain key and its SHA-256 hex hash. */
export async function generateDomainKeyForMint(): Promise<{
  domainKey: string;
  domainKeyHash: string;
}> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const domainKey = btoa(String.fromCharCode(...bytes));
  const hashBuffer = await crypto.subtle.digest("SHA-256", ENCODER.encode(domainKey));
  const domainKeyHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return { domainKey, domainKeyHash };
}
