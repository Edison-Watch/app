/**
 * Secret key management API client for Edison Watch.
 *
 * Provides functions for generating, registering, rolling, resetting,
 * verifying, and caching the user's edison_secret_key.
 */

const EDISON_SECRET_KEY_STORAGE = "edison_secret_key";

/**
 * Create authorization headers for API requests.
 * Accepts a getApiKey function to decouple from specific storage implementations.
 */
function createHeaders(getApiKey?: () => string | null): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = getApiKey?.();
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  return headers;
}

/** Generate a cryptographically random 32-byte base64-encoded secret key. */
export function generateSecretKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/** Compute SHA-256 hex hash of a string. */
export async function hashSecretKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Register a new composite secret key hash with the backend. */
export async function registerSecretKey(
  userKeyHash: string,
  domainKeyHash?: string,
  getApiKey?: () => string | null,
): Promise<void> {
  const body: Record<string, string> = { user_key_hash: userKeyHash };
  if (domainKeyHash) body.domain_key_hash = domainKeyHash;

  const response = await fetch("/api/v1/user/secret-key/register", {
    method: "POST",
    headers: createHeaders(getApiKey),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to register secret key: ${response.status} ${text}`);
  }
}

/** Roll the user part of the composite key: re-encrypt all user-scope values. */
export async function rollSecretKey(
  oldKey: string,
  newUserPart: string,
  newUserPartHash: string,
  getApiKey?: () => string | null,
): Promise<{ success: boolean; re_encrypted: number; new_composite_key: string }> {
  const response = await fetch("/api/v1/user/secret-key/roll", {
    method: "POST",
    headers: createHeaders(getApiKey),
    body: JSON.stringify({
      old_key: oldKey,
      new_user_part: newUserPart,
      new_user_part_hash: newUserPartHash,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to roll secret key: ${response.status} ${text}`);
  }

  return response.json();
}

/** Reset the secret key: delete all encrypted values and register a new key. */
export async function resetSecretKey(
  newKeyHash: string,
  getApiKey?: () => string | null,
): Promise<{ success: boolean; deleted: number }> {
  const response = await fetch("/api/v1/user/secret-key/reset", {
    method: "POST",
    headers: createHeaders(getApiKey),
    body: JSON.stringify({ new_key_hash: newKeyHash, confirm: true }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to reset secret key: ${response.status} ${text}`);
  }

  return response.json();
}

/** Verify a secret key against the server-stored hash. */
export async function verifySecretKey(
  key: string,
  getApiKey?: () => string | null,
): Promise<boolean> {
  const response = await fetch("/api/v1/user/secret-key/verify", {
    method: "POST",
    headers: createHeaders(getApiKey),
    body: JSON.stringify({ key }),
  });
  if (!response.ok) return false;
  const data = await response.json();
  return data.valid === true;
}

/** Get cached secret key from localStorage. */
export function getCachedSecretKey(): string | null {
  try {
    return localStorage.getItem(EDISON_SECRET_KEY_STORAGE);
  } catch {
    return null;
  }
}

/** Cache secret key in localStorage. */
export function cacheSecretKey(key: string): void {
  try {
    localStorage.setItem(EDISON_SECRET_KEY_STORAGE, key);
  } catch {
    /* ignore */
  }
}

/** Clear cached secret key from localStorage. */
export function clearCachedSecretKey(): void {
  try {
    localStorage.removeItem(EDISON_SECRET_KEY_STORAGE);
  } catch {
    /* ignore */
  }
}
