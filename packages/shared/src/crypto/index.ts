export {
  MAGIC_PREFIX,
  hasMagicPrefix,
  parseCompositeKey,
  buildCompositeKey,
  encryptSecret,
  decryptSecret,
  encryptServerConfig,
  decryptServerConfigs,
  decryptDomainSecret,
  decryptAdminServerConfigs,
  generateDomainKeyForMint,
  type CompositeKey,
} from "./client-crypto";

export {
  generateSecretKey,
  hashSecretKey,
  registerSecretKey,
  rollSecretKey,
  resetSecretKey,
  verifySecretKey,
  getCachedSecretKey,
  cacheSecretKey,
  clearCachedSecretKey,
  type VerifySecretKeyResult,
} from "./secret-key-api";
