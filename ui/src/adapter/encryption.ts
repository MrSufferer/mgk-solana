/**
 * Encryption utilities for Perpetuals DEX Adapter
 * 
 * Uses Arcium's client SDK for encryption/decryption operations.
 * Based on patterns from tests/perpetuals.ts and tests/blackjack.ts
 */

import { randomBytes } from "crypto";
import * as anchor from "@coral-xyz/anchor";
import {
  RescueCipher,
  deserializeLE,
  x25519,
  getMXEPublicKey,
} from "@arcium-hq/client";
import { EncryptionContext, DecryptedPositionData } from "./types";

/**
 * Initialize encryption context with x25519 keypair and MXE shared secret
 */
export async function initializeEncryption(
  provider: anchor.AnchorProvider,
  programId: anchor.web3.PublicKey
): Promise<EncryptionContext> {
  // Generate client x25519 keypair
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);

  // Get MXE (MPC) public key from the program
  const mxePublicKeyResult = await getMXEPublicKey(provider, programId);
  
  if (!mxePublicKeyResult) {
    throw new Error("Failed to retrieve MXE public key");
  }
  
  const mxePublicKey = mxePublicKeyResult;

  // Compute shared secret using ECDH
  const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey as any);

  console.log("[Encryption] Initialized encryption context");
  console.log("  Client public key:", Buffer.from(publicKey).toString("hex"));
  console.log("  MXE public key:", Buffer.from(mxePublicKey).toString("hex"));

  return {
    privateKey,
    publicKey,
    mxePublicKey,
    sharedSecret,
  };
}

/**
 * Encrypt a value (size or collateral) for MPC computation
 */
export function encryptValue(
  value: bigint,
  sharedSecret: Uint8Array,
  nonce?: Uint8Array
): { ciphertext: number[]; nonce: Uint8Array } {
  const cipher = new RescueCipher(sharedSecret);
  const nonceToUse = nonce || randomBytes(16);
  
  // Encrypt the value - cipher.encrypt() returns array of number[]
  const ciphertext = cipher.encrypt([value], nonceToUse);

  return {
    ciphertext: Array.from(ciphertext[0] as any), // cipher returns number[] already
    nonce: nonceToUse,
  };
}

/**
 * Decrypt a value (size or collateral) from MPC computation result
 */
export function decryptValue(
  ciphertext: bigint | number[],
  sharedSecret: Uint8Array,
  nonce: Uint8Array
): bigint {
  const cipher = new RescueCipher(sharedSecret);
  const ciphertextBigInt = Array.isArray(ciphertext) 
    ? bytesToBigInt(ciphertext) 
    : ciphertext;
  const decrypted = cipher.decrypt([ciphertextBigInt as any], nonce);
  return decrypted[0];
}

/**
 * Encrypt position data (size and collateral)
 */
export function encryptPositionData(
  sizeUsd: bigint,
  collateralUsd: bigint,
  sharedSecret: Uint8Array
): {
  sizeEncrypted: number[];
  sizeNonce: Uint8Array;
  collateralEncrypted: number[];
  collateralNonce: Uint8Array;
} {
  const sizeResult = encryptValue(sizeUsd, sharedSecret);
  const collateralResult = encryptValue(collateralUsd, sharedSecret);

  return {
    sizeEncrypted: sizeResult.ciphertext,
    sizeNonce: sizeResult.nonce,
    collateralEncrypted: collateralResult.ciphertext,
    collateralNonce: collateralResult.nonce,
  };
}

/**
 * Decrypt position data (size and collateral)
 */
export function decryptPositionData(
  sizeEncrypted: bigint | number[],
  sizeNonce: anchor.BN,
  collateralEncrypted: bigint | number[],
  collateralNonce: anchor.BN,
  sharedSecret: Uint8Array
): DecryptedPositionData {
  // Convert array to bigint if needed
  const sizeCiphertext = Array.isArray(sizeEncrypted)
    ? bytesToBigInt(sizeEncrypted)
    : sizeEncrypted;
  const collateralCiphertext = Array.isArray(collateralEncrypted)
    ? bytesToBigInt(collateralEncrypted)
    : collateralEncrypted;

  // Convert nonces from anchor.BN to Uint8Array
  const sizeNonceBytes = bnToNonce(sizeNonce);
  const collateralNonceBytes = bnToNonce(collateralNonce);

  // Decrypt
  const sizeUsd = decryptValue(sizeCiphertext, sharedSecret, sizeNonceBytes);
  const collateralUsd = decryptValue(
    collateralCiphertext,
    sharedSecret,
    collateralNonceBytes
  );

  return {
    sizeUsd,
    collateralUsd,
  };
}

/**
 * Convert nonce from Uint8Array to anchor.BN (u128)
 */
export function nonceToBN(nonce: Uint8Array): anchor.BN {
  // Nonce is 16 bytes (128 bits), deserialize as little-endian
  const value = deserializeLE(nonce);
  return new anchor.BN(value.toString());
}

/**
 * Convert nonce from anchor.BN to Uint8Array (16 bytes)
 */
export function bnToNonce(bn: anchor.BN): Uint8Array {
  // Convert BN to 16-byte little-endian array
  return Uint8Array.from(bn.toArray("le", 16));
}

/**
 * Convert bigint ciphertext to 32-byte array (for program input)
 */
export function ciphertextToBytes(ciphertext: bigint): number[] {
  const bytes = new Array(32).fill(0);
  let value = ciphertext;
  
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number(value & BigInt(0xff));
    value >>= BigInt(8);
  }
  
  return bytes;
}

/**
 * Convert 32-byte array to bigint (from program output)
 */
export function bytesToBigInt(bytes: number[]): bigint {
  let result = BigInt(0);
  for (let i = 0; i < bytes.length; i++) {
    result |= BigInt(bytes[i]) << BigInt(i * 8);
  }
  return result;
}

/**
 * Generate a random computation offset (required for MPC operations)
 */
export function generateComputationOffset(): anchor.BN {
  return new anchor.BN(randomBytes(8));
}

/**
 * Generate a random position ID
 */
export function generatePositionId(): bigint {
  return BigInt(Date.now()) + BigInt(Math.floor(Math.random() * 1000));
}

/**
 * Retry function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 5,
  initialDelayMs: number = 500
): Promise<T> {
  let lastError: Error | undefined;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt < maxRetries - 1) {
        const delayMs = initialDelayMs * Math.pow(2, attempt);
        console.log(`  Retry ${attempt + 1}/${maxRetries} after ${delayMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  
  throw lastError || new Error("Max retries exceeded");
}
