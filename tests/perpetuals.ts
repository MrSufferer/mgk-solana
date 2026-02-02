import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { Perpetuals } from "../target/types/perpetuals";
import { randomBytes } from "crypto";
import {
  awaitComputationFinalization,
  getArciumEnv,
  getCompDefAccOffset,
  RescueCipher,
  deserializeLE,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  x25519,
  getComputationAccAddress,
  getClusterAccAddress,
  getMXEPublicKey,
  getArciumAccountBaseSeed,
  getArciumProgramId,
  uploadCircuit,
  buildFinalizeCompDefTx,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import { expect } from "chai";

/**
 * Configuration for Arcium Perpetuals DEX Tests
 * 
 * This test suite is configured to run on localnet by default.
 * To run tests:
 *   arcium test
 * 
 * The test uses the local Arcium cluster configured in Arcium.toml.
 * Set USE_DEVNET=true to run against devnet with cluster offset 123.
 */

const useDevnet = true;
const devnetRpcUrl =
  process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com";
const devnetClusterOffset = 123;
const clusterOffset = useDevnet
  ? devnetClusterOffset
  : getArciumEnv().arciumClusterOffset;

// Helper to read keypair from file
function readKpJson(path: string) {
  const kpJson = JSON.parse(fs.readFileSync(path, "utf-8"));
  return anchor.web3.Keypair.fromSecretKey(new Uint8Array(kpJson));
}

async function getMXEPublicKeyWithRetry(
  provider: anchor.AnchorProvider,
  programId: PublicKey,
  maxRetries: number = 20,
  retryDelayMs: number = 500
): Promise<Uint8Array> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const mxePublicKey = await getMXEPublicKey(provider, programId);
      if (mxePublicKey) {
        return mxePublicKey;
      }
    } catch (error) {
      console.log(`Attempt ${attempt} failed to fetch MXE public key:`, error);
    }

    if (attempt < maxRetries) {
      console.log(
        `Retrying in ${retryDelayMs}ms... (attempt ${attempt}/${maxRetries})`
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw new Error(
    `Failed to fetch MXE public key after ${maxRetries} attempts`
  );
}

/**
 * Gets the cluster account address using the cluster offset from environment.
 */
function getClusterAccount(): PublicKey {
  return getClusterAccAddress(clusterOffset);
}

describe("Perpetuals DEX", () => {
  const owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);

  let provider: anchor.AnchorProvider;
  let program: Program<Perpetuals>;

  if (useDevnet) {
    // Configure devnet provider and program (cluster offset 123)
    const connection = new anchor.web3.Connection(devnetRpcUrl, "confirmed");
    provider = new anchor.AnchorProvider(
      connection,
      new anchor.Wallet(owner),
      anchor.AnchorProvider.defaultOptions()
    );
    anchor.setProvider(provider);

    const idl = {
      ...(anchor.workspace.Perpetuals.idl as anchor.Idl),
      metadata: {
        ...((anchor.workspace.Perpetuals.idl as any).metadata ?? {}),
      },
    } as anchor.Idl;
    const programId = new PublicKey(
      process.env.DEVNET_PROGRAM_ID ?? anchor.workspace.Perpetuals.programId
    );
    (idl as any).metadata.address = programId.toBase58();
    program = new Program<Perpetuals>(idl, provider);
    console.log(
      `Using devnet (cluster offset ${clusterOffset}) RPC: ${devnetRpcUrl}`
    );
  } else {
    // Configure the client to use the local cluster.
    anchor.setProvider(anchor.AnchorProvider.env());
    provider = anchor.getProvider() as anchor.AnchorProvider;
    program = anchor.workspace.Perpetuals as Program<Perpetuals>;
  }


  type Event = anchor.IdlEvents<(typeof program)["idl"]>;
  const awaitEvent = async <E extends keyof Event>(
    eventName: E,
    timeoutMs = 60000
  ): Promise<Event[E]> => {
    let listenerId: number;
    let timeoutId: NodeJS.Timeout;
    const event = await new Promise<Event[E]>((res, rej) => {
      listenerId = program.addEventListener(eventName as any, (event) => {
        if (timeoutId) clearTimeout(timeoutId);
        res(event);
      });
      timeoutId = setTimeout(() => {
        program.removeEventListener(listenerId);
        rej(new Error(`Event ${String(eventName)} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    await program.removeEventListener(listenerId);
    return event;
  };

  it("Initializes open_position computation definition", async () => {
    console.log("Initializing open_position computation definition");

    const baseSeedCompDefAcc = getArciumAccountBaseSeed(
      "ComputationDefinitionAccount"
    );
    const offset = getCompDefAccOffset("open_position");
    const compDefAcc = PublicKey.findProgramAddressSync(
      [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
      getArciumProgramId()
    )[0];

    // Check if already initialized
    try {
      await program.account.computationDefinitionAccount.fetch(compDefAcc);
      console.log("open_position comp def already initialized, skipping");
      return;
    } catch (e) {
      // Not initialized, proceed
    }

    // Wait for MXE account to be ready first
    console.log("Waiting for MXE account to be ready...");
    try {
      await getMXEPublicKeyWithRetry(provider, program.programId, 30, 1000);
      console.log("MXE account is ready!");
    } catch (error) {
      console.error("Warning: MXE account not ready, but continuing...", error);
    }

    const mxeAcc = getMXEAccAddress(program.programId);
    
    // Initialize computation definition
    const initSig = await program.methods
      .initOpenPositionCompDef()
      .accounts({
        payer: owner.publicKey,
        mxeAccount: mxeAcc,
        compDefAccount: compDefAcc,
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });
    console.log("open_position CompDef initialized:", initSig);

    /*
    const rawCircuit = fs.readFileSync("build/open_position.arcis");

    const uploadSig = await uploadCircuit(
      provider as anchor.AnchorProvider,
      "open_position",
      program.programId,
      rawCircuit,
      true
    );

    console.log("OpenPosition CompDef uploaded:", uploadSig);
    */

    // const finalizeTx = await buildFinalizeCompDefTx(
    //   provider,
    //   Buffer.from(offset).readUInt32LE(),
    //   program.programId
    // );
    // const latestBlockhash = await provider.connection.getLatestBlockhash();
    // finalizeTx.recentBlockhash = latestBlockhash.blockhash;
    // finalizeTx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
    // finalizeTx.sign(owner);
    // await provider.sendAndConfirm(finalizeTx, [owner], {
    //   commitment: "confirmed",
    // });
    // console.log("OpenPosition CompDef finalized.");
  });

  it("Opens a position with encrypted size and collateral", async () => {
    console.log("\n=== Testing Open Position ===");

    // Generate encryption keys
    const privateKey = x25519.utils.randomSecretKey();
    const publicKey = x25519.getPublicKey(privateKey);
    const mxePublicKey = await getMXEPublicKeyWithRetry(
      provider as anchor.AnchorProvider,
      program.programId
    );

    console.log("MXE x25519 pubkey:", Buffer.from(mxePublicKey).toString("hex"));
    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);

    // Position parameters
    const positionId = BigInt(Date.now()); // Unique position ID
    const side = 0; // 0 = Long, 1 = Short
    const entryPrice = 50000n * BigInt(1e8); // $50,000 with 8 decimals
    const sizeUsd = 10000n; // $10,000 position size
    const collateralUsd = 1000n; // $1,000 collateral (10x leverage)

    // Encrypt size and collateral
    const sizeNonce = randomBytes(16);
    const collateralNonce = randomBytes(16);
    const sizeCiphertext = cipher.encrypt([sizeUsd], sizeNonce);
    const collateralCiphertext = cipher.encrypt([collateralUsd], collateralNonce);

    console.log("Position parameters:");
    console.log("  Position ID:", positionId.toString());
    console.log("  Side:", side === 0 ? "Long" : "Short");
    console.log("  Entry Price:", entryPrice.toString());
    console.log("  Size (encrypted):", sizeUsd.toString(), "USD");
    console.log("  Collateral (encrypted):", collateralUsd.toString(), "USD");
    console.log("  Leverage:", (Number(sizeUsd) / Number(collateralUsd)).toFixed(1) + "x");

    // Derive position PDA - must match Rust: seeds = [b"position", owner, position_id.to_le_bytes()]
    const positionIdBuffer = Buffer.alloc(8);
    positionIdBuffer.writeBigUInt64LE(positionId);
    
    const [positionPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("position"),
        owner.publicKey.toBuffer(),
        positionIdBuffer,
      ],
      program.programId
    );

    console.log("Position PDA:", positionPda.toBase58());

    // Set up computation offset
    const computationOffset = new anchor.BN(randomBytes(8));

    // Wait for event
    const positionOpenedPromise = awaitEvent("positionOpenedEvent");

    // Call open_position
    const compDefAccOffset = getCompDefAccOffset("open_position");
    const queueSig = await program.methods
      .openPosition(
        computationOffset,
        new anchor.BN(positionId.toString()),
        side,
        new anchor.BN(entryPrice.toString()),
        Array.from(sizeCiphertext[0]),
        Array.from(collateralCiphertext[0]),
        Array.from(publicKey),
        new anchor.BN(deserializeLE(sizeNonce).toString()),
        new anchor.BN(deserializeLE(collateralNonce).toString())
      )
      .accountsPartial({
        owner: owner.publicKey,
        payer: owner.publicKey,
        computationAccount: getComputationAccAddress(
          clusterOffset,
          computationOffset
        ),
        clusterAccount: getClusterAccount(),
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(clusterOffset),
        executingPool: getExecutingPoolAccAddress(clusterOffset),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(compDefAccOffset).readUInt32LE()
        ),
        position: positionPda,
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });

    console.log("Queue signature:", queueSig);

    // Wait for computation to finalize
    const finalizeSig = await awaitComputationFinalization(
      provider as anchor.AnchorProvider,
      computationOffset,
      program.programId,
      "confirmed"
    );
    console.log("Finalize signature:", finalizeSig);

    // Wait for event
    const positionOpenedEvent = await positionOpenedPromise;
    console.log("\nPosition opened event:");
    console.log("  Position ID:", positionOpenedEvent.positionId.toString());
    console.log("  Owner:", positionOpenedEvent.owner.toString());
    console.log("  Side:", positionOpenedEvent.side);
    console.log("  Entry Price:", positionOpenedEvent.entryPrice.toString());

    // Decrypt and verify
    const decryptedSize = cipher.decrypt(
      [positionOpenedEvent.sizeEncrypted],
      Buffer.from(positionOpenedEvent.sizeNonce.toArrayLike(Buffer, "le", 16))
    )[0];
    const decryptedCollateral = cipher.decrypt(
      [positionOpenedEvent.collateralEncrypted],
      Buffer.from(positionOpenedEvent.collateralNonce.toArrayLike(Buffer, "le", 16))
    )[0];

    console.log("\nDecrypted values:");
    console.log("  Size:", decryptedSize.toString(), "USD");
    console.log("  Collateral:", decryptedCollateral.toString(), "USD");

    expect(decryptedSize).to.equal(sizeUsd);
    expect(decryptedCollateral).to.equal(collateralUsd);

    // Fetch and verify position account
    const positionAccount = await program.account.position.fetch(positionPda);
    console.log("\nPosition account:");
    console.log("  Owner:", positionAccount.owner.toString());
    console.log("  Position ID:", positionAccount.positionId.toString());
    console.log("  Side:", positionAccount.side);
    console.log("  Entry Price:", positionAccount.entryPrice.toString());

    expect(positionAccount.owner.toString()).to.equal(owner.publicKey.toString());
    expect(positionAccount.positionId.toString()).to.equal(positionId.toString());
    expect(positionAccount.entryPrice.toString()).to.equal(entryPrice.toString());
  });

  it("Initializes calculate_position_value computation definition", async () => {
    console.log("\nInitializing calculate_position_value computation definition");

    const baseSeedCompDefAcc = getArciumAccountBaseSeed(
      "ComputationDefinitionAccount"
    );
    const offset = getCompDefAccOffset("calculate_position_value");
    const compDefAcc = PublicKey.findProgramAddressSync(
      [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
      getArciumProgramId()
    )[0];

    // Check if already initialized
    try {
      await program.account.computationDefinitionAccount.fetch(compDefAcc);
      console.log("calculate_position_value comp def already initialized, skipping");
      return;
    } catch (e) {
      // Not initialized, proceed
    }

    // Wait for MXE account to be ready first
    console.log("Waiting for MXE account to be ready...");
    try {
      await getMXEPublicKeyWithRetry(provider, program.programId, 30, 1000);
      console.log("MXE account is ready!");
    } catch (error) {
      console.error("Warning: MXE account not ready, but continuing...", error);
    }

    const mxeAcc = getMXEAccAddress(program.programId);
    
    // Initialize computation definition
    const initSig = await program.methods
      .initCalculatePositionValueCompDef()
      .accounts({
        payer: owner.publicKey,
        mxeAccount: mxeAcc,
        compDefAccount: compDefAcc,
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });
    console.log("calculate_position_value CompDef initialized:", initSig);

    // Upload circuit
    console.log("Uploading calculate_position_value circuit...");
    // const rawCircuit = fs.readFileSync("build/calculate_position_value.arcis");
    // await uploadCircuit(
    //   provider as anchor.AnchorProvider,
    //   "calculate_position_value",
    //   program.programId,
    //   rawCircuit,
    //   true
    // );
    // console.log("Circuit uploaded");

    // Finalize computation definition
  //   console.log("Finalizing calculate_position_value comp def...");
  //   const finalizeTx = await buildFinalizeCompDefTx(
  //     provider as anchor.AnchorProvider,
  //     Buffer.from(offset).readUInt32LE(),
  //     program.programId
  //   );
  //   const latestBlockhash = await provider.connection.getLatestBlockhash();
  //   finalizeTx.recentBlockhash = latestBlockhash.blockhash;
  //   finalizeTx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
  //   finalizeTx.sign(owner);
  //   await provider.sendAndConfirm(finalizeTx, [owner], { commitment: "confirmed" });
  //   console.log("CompDef finalized");
  // });

  it("Calculates position value and PnL", async () => {
    console.log("\n=== Testing Calculate Position Value ===");

    // First, open a position
    const privateKey = x25519.utils.randomSecretKey();
    const publicKey = x25519.getPublicKey(privateKey);
    const mxePublicKey = await getMXEPublicKeyWithRetry(
      provider as anchor.AnchorProvider,
      program.programId
    );
    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);

    // Position parameters
    const positionId = BigInt(Date.now()) + 1000n; // Unique position ID
    const side = 0; // Long position
    const entryPrice = 50000n * BigInt(1e8); // $50,000 with 8 decimals
    const sizeUsd = 10000n; // $10,000 position size
    const collateralUsd = 1000n; // $1,000 collateral (10x leverage)

    // Encrypt size and collateral
    const sizeNonce = randomBytes(16);
    const collateralNonce = randomBytes(16);
    const sizeCiphertext = cipher.encrypt([sizeUsd], sizeNonce);
    const collateralCiphertext = cipher.encrypt([collateralUsd], collateralNonce);

    console.log("Opening position:");
    console.log("  Entry Price: $50,000");
    console.log("  Size: $10,000");
    console.log("  Collateral: $1,000");

    // Derive position PDA
    const positionIdBuffer = Buffer.alloc(8);
    positionIdBuffer.writeBigUInt64LE(positionId);
    const [positionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), owner.publicKey.toBuffer(), positionIdBuffer],
      program.programId
    );

    // Open position
    const computationOffset1 = new anchor.BN(randomBytes(8));
    const compDefAccOffset1 = getCompDefAccOffset("open_position");
    
    const queueSig1 = await program.methods
      .openPosition(
        computationOffset1,
        new anchor.BN(positionId.toString()),
        side,
        new anchor.BN(entryPrice.toString()),
        Array.from(sizeCiphertext[0]),
        Array.from(collateralCiphertext[0]),
        Array.from(publicKey),
        new anchor.BN(deserializeLE(sizeNonce).toString()),
        new anchor.BN(deserializeLE(collateralNonce).toString())
      )
      .accountsPartial({
        owner: owner.publicKey,
        payer: owner.publicKey,
        computationAccount: getComputationAccAddress(clusterOffset, computationOffset1),
        clusterAccount: getClusterAccount(),
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(clusterOffset),
        executingPool: getExecutingPoolAccAddress(clusterOffset),
        compDefAccount: getCompDefAccAddress(program.programId, Buffer.from(compDefAccOffset1).readUInt32LE()),
        position: positionPda,
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });

    await awaitComputationFinalization(provider as anchor.AnchorProvider, computationOffset1, program.programId, "confirmed");
    console.log("Position opened successfully");

    // Now calculate position value with a new price
    const currentPrice = 55000n * BigInt(1e8); // $55,000 (10% increase)
    const valueNonce = randomBytes(16);

    console.log("\nCalculating position value:");
    console.log("  Current Price: $55,000 (10% increase)");
    console.log("  Expected PnL: $1,000 (10% of $10,000)");

    const computationOffset2 = new anchor.BN(randomBytes(8));
    const compDefAccOffset2 = getCompDefAccOffset("calculate_position_value");
    
    const valueEventPromise = awaitEvent("positionValueCalculatedEvent");

    const queueSig2 = await program.methods
      .calculatePositionValue(
        computationOffset2,
        new anchor.BN(positionId.toString()),
        new anchor.BN(currentPrice.toString()),
        Array.from(publicKey),
        new anchor.BN(deserializeLE(valueNonce).toString())
      )
      .accountsPartial({
        payer: owner.publicKey,
        computationAccount: getComputationAccAddress(clusterOffset, computationOffset2),
        clusterAccount: getClusterAccount(),
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(clusterOffset),
        executingPool: getExecutingPoolAccAddress(clusterOffset),
        compDefAccount: getCompDefAccAddress(program.programId, Buffer.from(compDefAccOffset2).readUInt32LE()),
        position: positionPda,
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });

    console.log("Queue signature:", queueSig2);

    const finalizeSig2 = await awaitComputationFinalization(
      provider as anchor.AnchorProvider,
      computationOffset2,
      program.programId,
      "confirmed"
    );
    console.log("Finalize signature:", finalizeSig2);

    // Wait for event and decrypt
    const valueEvent = await valueEventPromise;
    console.log("\nPosition value calculated event received");

    // Note: The output has 2 ciphertexts [current_value, pnl]
    const decryptedResults = cipher.decrypt(
      [valueEvent.currentValueEncrypted, valueEvent.pnlEncrypted],
      Buffer.from(valueEvent.valueNonce.toArrayLike(Buffer, "le", 16))
    );

    const decryptedValue = decryptedResults[0];
    const decryptedPnl = decryptedResults[1];

    console.log("\nDecrypted results:");
    console.log("  Current Value:", decryptedValue.toString(), "USD");
    console.log("  PnL:", decryptedPnl.toString(), "USD");

    // For a long position with 10% price increase:
    // PnL = 10000 * (55000 - 50000) / 50000 = 10000 * 0.1 = 1000
    // Current Value = 1000 (collateral) + 1000 (PnL) = 2000
    expect(decryptedPnl).to.equal(1000n);
    expect(decryptedValue).to.equal(2000n);

    console.log("✅ Position value calculation test passed!");
  });

  it("Initializes close_position computation definition", async () => {
    console.log("\nInitializing close_position computation definition");

    const baseSeedCompDefAcc = getArciumAccountBaseSeed(
      "ComputationDefinitionAccount"
    );
    const offset = getCompDefAccOffset("close_position");
    const compDefAcc = PublicKey.findProgramAddressSync(
      [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
      getArciumProgramId()
    )[0];

    // Check if already initialized
    try {
      await program.account.computationDefinitionAccount.fetch(compDefAcc);
      console.log("close_position comp def already initialized, skipping");
      return;
    } catch (e) {
      // Not initialized, proceed
    }

    // Wait for MXE account to be ready first
    console.log("Waiting for MXE account to be ready...");
    try {
      await getMXEPublicKeyWithRetry(provider, program.programId, 30, 1000);
      console.log("MXE account is ready!");
    } catch (error) {
      console.error("Warning: MXE account not ready, but continuing...", error);
    }

    const mxeAcc = getMXEAccAddress(program.programId);
    const initSig = await program.methods
      .initClosePositionCompDef()
      .accounts({
        payer: owner.publicKey,
        mxeAccount: mxeAcc,
        compDefAccount: compDefAcc,
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });

    console.log("close_position CompDef initialized:", initSig);
  });

  it("Closes a position and realizes PnL", async () => {
    console.log("\n=== Testing Close Position ===");

    // Setup - open a position first
    const privateKey = x25519.utils.randomSecretKey();
    const publicKey = x25519.getPublicKey(privateKey);
    const mxePublicKey = await getMXEPublicKeyWithRetry(
      provider as anchor.AnchorProvider,
      program.programId
    );
    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);

    const positionId = BigInt(Date.now()) + 2000n;
    const side = 0; // Long
    const entryPrice = 50000n * BigInt(1e8);
    const sizeUsd = 5000n;
    const collateralUsd = 500n;

    const sizeNonce = randomBytes(16);
    const collateralNonce = randomBytes(16);
    const sizeCiphertext = cipher.encrypt([sizeUsd], sizeNonce);
    const collateralCiphertext = cipher.encrypt([collateralUsd], collateralNonce);

    const positionIdBuffer = Buffer.alloc(8);
    positionIdBuffer.writeBigUInt64LE(positionId);
    const [positionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), owner.publicKey.toBuffer(), positionIdBuffer],
      program.programId
    );

    console.log("Opening position to close...");
    const computationOffset1 = new anchor.BN(randomBytes(8));
    const compDefAccOffset1 = getCompDefAccOffset("open_position");
    
    await program.methods
      .openPosition(
        computationOffset1,
        new anchor.BN(positionId.toString()),
        side,
        new anchor.BN(entryPrice.toString()),
        Array.from(sizeCiphertext[0]),
        Array.from(collateralCiphertext[0]),
        Array.from(publicKey),
        new anchor.BN(deserializeLE(sizeNonce).toString()),
        new anchor.BN(deserializeLE(collateralNonce).toString())
      )
      .accountsPartial({
        owner: owner.publicKey,
        payer: owner.publicKey,
        computationAccount: getComputationAccAddress(clusterOffset, computationOffset1),
        clusterAccount: getClusterAccount(),
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(clusterOffset),
        executingPool: getExecutingPoolAccAddress(clusterOffset),
        compDefAccount: getCompDefAccAddress(program.programId, Buffer.from(compDefAccOffset1).readUInt32LE()),
        position: positionPda,
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });

    await awaitComputationFinalization(provider as anchor.AnchorProvider, computationOffset1, program.programId, "confirmed");
    console.log("Position opened");

    // Now close the position with profit
    const currentPrice = 60000n * BigInt(1e8); // 20% gain
    const closeNonce = randomBytes(16);

    console.log("\nClosing position:");
    console.log("  Entry Price: $50,000");
    console.log("  Current Price: $60,000 (20% gain)");
    console.log("  Expected PnL: $1,000 (20% of $5,000)");
    console.log("  Expected Final Balance: $1,500 ($500 collateral + $1,000 PnL)");

    const computationOffset2 = new anchor.BN(randomBytes(8));
    const compDefAccOffset2 = getCompDefAccOffset("close_position");
    
    const closeEventPromise = awaitEvent("positionClosedEvent");

    const queueSig = await program.methods
      .closePosition(
        computationOffset2,
        new anchor.BN(positionId.toString()),
        new anchor.BN(currentPrice.toString()),
        Array.from(publicKey),
        new anchor.BN(deserializeLE(closeNonce).toString())
      )
      .accountsPartial({
        owner: owner.publicKey,
        payer: owner.publicKey,
        computationAccount: getComputationAccAddress(clusterOffset, computationOffset2),
        clusterAccount: getClusterAccount(),
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(clusterOffset),
        executingPool: getExecutingPoolAccAddress(clusterOffset),
        compDefAccount: getCompDefAccAddress(program.programId, Buffer.from(compDefAccOffset2).readUInt32LE()),
        position: positionPda,
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });

    console.log("Queue signature:", queueSig);
    const finalizeSig = await awaitComputationFinalization(provider as anchor.AnchorProvider, computationOffset2, program.programId, "confirmed");
    console.log("Finalize signature:", finalizeSig);

    const closeEvent = await closeEventPromise;
    console.log("\nPosition closed event received");

    const decryptedResults = cipher.decrypt(
      [closeEvent.realizedPnlEncrypted, closeEvent.finalBalanceEncrypted, closeEvent.canCloseEncrypted],
      Buffer.from(closeEvent.nonce.toArrayLike(Buffer, "le", 16))
    );

    const decryptedPnl = decryptedResults[0];
    const decryptedBalance = decryptedResults[1];
    const canClose = Number(decryptedResults[2]);

    console.log("\nDecrypted results:");
    console.log("  Realized PnL:", decryptedPnl.toString(), "USD");
    console.log("  Final Balance:", decryptedBalance.toString(), "USD");
    console.log("  Can Close:", canClose === 1 ? "Yes" : "No");

    expect(decryptedPnl).to.equal(1000n); // 20% of 5000
    expect(decryptedBalance).to.equal(1500n); // 500 + 1000
    expect(canClose).to.equal(1);

    console.log("✅ Close position test passed!");
  });

  it("Initializes add_collateral computation definition", async () => {
    console.log("\nInitializing add_collateral computation definition");

    const baseSeedCompDefAcc = getArciumAccountBaseSeed(
      "ComputationDefinitionAccount"
    );
    const offset = getCompDefAccOffset("add_collateral");
    const compDefAcc = PublicKey.findProgramAddressSync(
      [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
      getArciumProgramId()
    )[0];

    try {
      await program.account.computationDefinitionAccount.fetch(compDefAcc);
      console.log("add_collateral comp def already initialized, skipping");
      return;
    } catch (e) {
      // Not initialized, proceed
    }

    // Wait for MXE account to be ready first
    console.log("Waiting for MXE account to be ready...");
    try {
      await getMXEPublicKeyWithRetry(provider, program.programId, 30, 1000);
      console.log("MXE account is ready!");
    } catch (error) {
      console.error("Warning: MXE account not ready, but continuing...", error);
    }

    const mxeAcc = getMXEAccAddress(program.programId);
    const initSig = await program.methods
      .initAddCollateralCompDef()
      .accounts({
        payer: owner.publicKey,
        mxeAccount: mxeAcc,
        compDefAccount: compDefAcc,
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });

    console.log("add_collateral CompDef initialized:", initSig);
  });

  it("Adds collateral to a position", async () => {
    console.log("\n=== Testing Add Collateral ===");

    // Open a position first
    const privateKey = x25519.utils.randomSecretKey();
    const publicKey = x25519.getPublicKey(privateKey);
    const mxePublicKey = await getMXEPublicKeyWithRetry(
      provider as anchor.AnchorProvider,
      program.programId
    );
    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);

    const positionId = BigInt(Date.now()) + 3000n;
    const side = 0;
    const entryPrice = 50000n * BigInt(1e8);
    const sizeUsd = 10000n;
    const collateralUsd = 500n; // 20x leverage - risky!

    const sizeNonce = randomBytes(16);
    const collateralNonce = randomBytes(16);
    const sizeCiphertext = cipher.encrypt([sizeUsd], sizeNonce);
    const collateralCiphertext = cipher.encrypt([collateralUsd], collateralNonce);

    const positionIdBuffer = Buffer.alloc(8);
    positionIdBuffer.writeBigUInt64LE(positionId);
    const [positionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), owner.publicKey.toBuffer(), positionIdBuffer],
      program.programId
    );

    console.log("Opening position with high leverage (20x)...");
    const computationOffset1 = new anchor.BN(randomBytes(8));
    
    await program.methods
      .openPosition(
        computationOffset1,
        new anchor.BN(positionId.toString()),
        side,
        new anchor.BN(entryPrice.toString()),
        Array.from(sizeCiphertext[0]),
        Array.from(collateralCiphertext[0]),
        Array.from(publicKey),
        new anchor.BN(deserializeLE(sizeNonce).toString()),
        new anchor.BN(deserializeLE(collateralNonce).toString())
      )
      .accountsPartial({
        owner: owner.publicKey,
        payer: owner.publicKey,
        computationAccount: getComputationAccAddress(clusterOffset, computationOffset1),
        clusterAccount: getClusterAccount(),
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(clusterOffset),
        executingPool: getExecutingPoolAccAddress(clusterOffset),
        compDefAccount: getCompDefAccAddress(program.programId, Buffer.from(getCompDefAccOffset("open_position")).readUInt32LE()),
        position: positionPda,
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });

    await awaitComputationFinalization(provider as anchor.AnchorProvider, computationOffset1, program.programId, "confirmed");
    console.log("Position opened with 20x leverage");

    // Add collateral to reduce leverage
    const additionalCollateral = 500n; // Adding $500 more
    const additionalNonce = randomBytes(16);
    const additionalCiphertext = cipher.encrypt([additionalCollateral], additionalNonce);

    console.log("\nAdding collateral:");
    console.log("  Current Collateral: $500");
    console.log("  Additional Collateral: $500");
    console.log("  New Total Collateral: $1,000");
    console.log("  New Leverage: 10x (down from 20x)");

    const computationOffset2 = new anchor.BN(randomBytes(8));
    const collateralEventPromise = awaitEvent("collateralAddedEvent");

    const queueSig = await program.methods
      .addCollateral(
        computationOffset2,
        new anchor.BN(positionId.toString()),
        Array.from(additionalCiphertext[0]),
        Array.from(publicKey),
        new anchor.BN(deserializeLE(additionalNonce).toString())
      )
      .accountsPartial({
        owner: owner.publicKey,
        payer: owner.publicKey,
        computationAccount: getComputationAccAddress(clusterOffset, computationOffset2),
        clusterAccount: getClusterAccount(),
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(clusterOffset),
        executingPool: getExecutingPoolAccAddress(clusterOffset),
        compDefAccount: getCompDefAccAddress(program.programId, Buffer.from(getCompDefAccOffset("add_collateral")).readUInt32LE()),
        position: positionPda,
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });

    console.log("Queue signature:", queueSig);
    const finalizeSig = await awaitComputationFinalization(provider as anchor.AnchorProvider, computationOffset2, program.programId, "confirmed");
    console.log("Finalize signature:", finalizeSig);

    const collateralEvent = await collateralEventPromise;
    console.log("\nCollateral added event received");

    const decryptedResults = cipher.decrypt(
      [collateralEvent.newCollateralEncrypted, collateralEvent.newLeverageEncrypted],
      Buffer.from(collateralEvent.nonce.toArrayLike(Buffer, "le", 16))
    );

    const newCollateral = decryptedResults[0];
    const newLeverage = decryptedResults[1];

    console.log("\nDecrypted results:");
    console.log("  New Total Collateral:", newCollateral.toString(), "USD");
    console.log("  New Leverage:", newLeverage.toString() + "x");

    expect(newCollateral).to.equal(1000n); // 500 + 500
    expect(newLeverage).to.equal(10n); // 10000 / 1000

    console.log("✅ Add collateral test passed!");
  });

  it("Initializes liquidate computation definition", async () => {
    console.log("\nInitializing liquidate computation definition");

    const baseSeedCompDefAcc = getArciumAccountBaseSeed(
      "ComputationDefinitionAccount"
    );
    const offset = getCompDefAccOffset("liquidate");
    const compDefAcc = PublicKey.findProgramAddressSync(
      [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
      getArciumProgramId()
    )[0];

    try {
      await program.account.computationDefinitionAccount.fetch(compDefAcc);
      console.log("liquidate comp def already initialized, skipping");
      return;
    } catch (e) {
      // Not initialized, proceed
    }

    // Wait for MXE account to be ready first
    console.log("Waiting for MXE account to be ready...");
    try {
      await getMXEPublicKeyWithRetry(provider, program.programId, 30, 1000);
      console.log("MXE account is ready!");
    } catch (error) {
      console.error("Warning: MXE account not ready, but continuing...", error);
    }

    const mxeAcc = getMXEAccAddress(program.programId);
    const initSig = await program.methods
      .initLiquidateCompDef()
      .accounts({
        payer: owner.publicKey,
        mxeAccount: mxeAcc,
        compDefAccount: compDefAcc,
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });

    console.log("liquidate CompDef initialized:", initSig);
  });

  it("Liquidates an underwater position", async () => {
    console.log("\n=== Testing Liquidate Position ===");

    // Open a highly leveraged position
    const privateKey = x25519.utils.randomSecretKey();
    const publicKey = x25519.getPublicKey(privateKey);
    const mxePublicKey = await getMXEPublicKeyWithRetry(
      provider as anchor.AnchorProvider,
      program.programId
    );
    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);

    const positionId = BigInt(Date.now()) + 4000n;
    const side = 0; // Long
    const entryPrice = 50000n * BigInt(1e8);
    const sizeUsd = 10000n;
    const collateralUsd = 500n; // 20x leverage

    const sizeNonce = randomBytes(16);
    const collateralNonce = randomBytes(16);
    const sizeCiphertext = cipher.encrypt([sizeUsd], sizeNonce);
    const collateralCiphertext = cipher.encrypt([collateralUsd], collateralNonce);

    const positionIdBuffer = Buffer.alloc(8);
    positionIdBuffer.writeBigUInt64LE(positionId);
    const [positionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), owner.publicKey.toBuffer(), positionIdBuffer],
      program.programId
    );

    console.log("Opening position with 20x leverage...");
    const computationOffset1 = new anchor.BN(randomBytes(8));
    
    await program.methods
      .openPosition(
        computationOffset1,
        new anchor.BN(positionId.toString()),
        side,
        new anchor.BN(entryPrice.toString()),
        Array.from(sizeCiphertext[0]),
        Array.from(collateralCiphertext[0]),
        Array.from(publicKey),
        new anchor.BN(deserializeLE(sizeNonce).toString()),
        new anchor.BN(deserializeLE(collateralNonce).toString())
      )
      .accountsPartial({
        owner: owner.publicKey,
        payer: owner.publicKey,
        computationAccount: getComputationAccAddress(clusterOffset, computationOffset1),
        clusterAccount: getClusterAccount(),
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(clusterOffset),
        executingPool: getExecutingPoolAccAddress(clusterOffset),
        compDefAccount: getCompDefAccAddress(program.programId, Buffer.from(getCompDefAccOffset("open_position")).readUInt32LE()),
        position: positionPda,
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });

    await awaitComputationFinalization(provider as anchor.AnchorProvider, computationOffset1, program.programId, "confirmed");
    console.log("Position opened");

    // Price drops 6% - position becomes liquidatable
    // Entry: $50,000, Size: $10,000, Collateral: $500
    // Current: $47,000 (6% drop)
    // Loss: $10,000 * 6% = $600
    // Current Value: $500 - $600 = -$100 (underwater!)
    // Liquidation threshold: $10,000 * 5% = $500
    const currentPrice = 47000n * BigInt(1e8);
    const liquidateNonce = randomBytes(16);

    console.log("\nLiquidating position:");
    console.log("  Entry Price: $50,000");
    console.log("  Current Price: $47,000 (6% drop)");
    console.log("  Expected Loss: $600");
    console.log("  Collateral: $500");
    console.log("  Current Value: -$100 (underwater!)");
    console.log("  Liquidation Threshold: $500 (5% of size)");
    console.log("  Should be liquidatable: Yes");

    const computationOffset2 = new anchor.BN(randomBytes(8));
    const liquidateEventPromise = awaitEvent("positionLiquidatedEvent");

    const queueSig = await program.methods
      .liquidate(
        computationOffset2,
        new anchor.BN(positionId.toString()),
        new anchor.BN(currentPrice.toString()),
        Array.from(publicKey),
        new anchor.BN(deserializeLE(liquidateNonce).toString())
      )
      .accountsPartial({
        liquidator: owner.publicKey, // In practice, this would be a different account
        payer: owner.publicKey,
        computationAccount: getComputationAccAddress(clusterOffset, computationOffset2),
        clusterAccount: getClusterAccount(),
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(clusterOffset),
        executingPool: getExecutingPoolAccAddress(clusterOffset),
        compDefAccount: getCompDefAccAddress(program.programId, Buffer.from(getCompDefAccOffset("liquidate")).readUInt32LE()),
        position: positionPda,
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });

    console.log("Queue signature:", queueSig);
    const finalizeSig = await awaitComputationFinalization(provider as anchor.AnchorProvider, computationOffset2, program.programId, "confirmed");
    console.log("Finalize signature:", finalizeSig);

    const liquidateEvent = await liquidateEventPromise;
    console.log("\nPosition liquidated event received");
    console.log("  Position ID:", liquidateEvent.positionId.toString());
    console.log("  Owner:", liquidateEvent.owner.toString());
    console.log("  Liquidator:", liquidateEvent.liquidator.toString());

    // Decrypt the results
    const decryptedResults = cipher.decrypt(
      [
        liquidateEvent.isLiquidatableEncrypted,
        liquidateEvent.remainingCollateralEncrypted,
        liquidateEvent.penaltyEncrypted
      ],
      Buffer.from(liquidateEvent.nonce.toArrayLike(Buffer, "le", 16))
    );

    const isLiquidatable = Number(decryptedResults[0]);
    const remainingCollateral = decryptedResults[1];
    const penalty = decryptedResults[2];

    console.log("\nDecrypted results:");
    console.log("  Is Liquidatable:", isLiquidatable === 1 ? "Yes" : "No");
    console.log("  Remaining Collateral:", remainingCollateral.toString(), "USD");
    console.log("  Liquidation Penalty:", penalty.toString(), "USD");

    expect(isLiquidatable).to.equal(1);
    console.log("✅ Liquidate position test passed!");
  });
})
})
