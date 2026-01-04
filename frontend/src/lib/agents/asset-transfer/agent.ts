/**
 * Asset Transfer Agent
 * 
 * Creates extrinsics for transferring assets (DOT, tokens) across chains.
 * Handles standard transfers, keep-alive transfers, and batch transfers.
 */

import { ApiPromise } from '@polkadot/api';
import { SubmittableExtrinsic } from '@polkadot/api/types';
import { BaseAgent } from '../baseAgent';
import { AgentResult, AgentError, DryRunResult, SimulationStatusCallback } from '../types';
import { TransferParams, BatchTransferParams } from './types';
import { BN } from '@polkadot/util';
import { 
  analyzeError, 
  getRetryStrategy, 
  formatErrorForUser,
  ErrorAnalysis 
} from '../errorAnalyzer';
import {
  detectTransferCapabilities,
  validateMinimumCapabilities,
  validateExistentialDeposit,
  TransferCapabilities,
} from './utils/transferCapabilities';
import {
  buildSafeTransferExtrinsic,
  buildSafeBatchExtrinsic,
} from './utils/safeExtrinsicBuilder';

/**
 * Agent for handling asset transfers
 * 
 * @example
 * const agent = new AssetTransferAgent();
 * agent.initialize(api);
 * const result = await agent.transfer({
 *   address: '1A2B3C4D5E6F7G8H9I0J1K2L3M4N5O6P7Q8R9S0T1U2V3W4X5Y6Z7A8B9C0D1',
 *   recipient: '1Z9B8C7D6E5F4G3H2I1J0K9L8M7N6O5P4Q3R2S1T0U9V8W7X6Y5Z4A3B2C1',
 *   amount: '1.5', // 1.5 DOT (will be converted to Planck)
 * });
 */
export class AssetTransferAgent extends BaseAgent {
  getAgentName(): string {
    return 'AssetTransferAgent';
  }

  /**
   * Transfer DOT or tokens
   * 
   * PRODUCTION-SAFE FLOW:
   * 1. Validate addresses and amount (fail fast on user errors)
   * 2. Detect chain capabilities (available methods, ED, decimals)
   * 3. Check balance
   * 4. Create extrinsic using production-safe builder (automatic fallbacks)
   * 5. Return extrinsic ready for signing
   * 
   * @param params Transfer parameters
   * @returns AgentResult with transfer extrinsic
   */
  async transfer(params: TransferParams): Promise<AgentResult> {
    this.ensureInitialized();
    
    if (!this.api) {
      throw new AgentError('API not initialized', 'API_NOT_INITIALIZED');
    }

    console.log('[AssetTransferAgent] ═══════════════════════════════════════════════════');
    console.log('[AssetTransferAgent] 📥 TRANSFER REQUEST RECEIVED');
    console.log('[AssetTransferAgent] ───────────────────────────────────────────────────');
    console.log('[AssetTransferAgent] Parameters:', {
      sender: params.address,
      recipient: params.recipient,
      amount: params.amount,
      chain: params.chain || 'assetHub (default)',
      keepAlive: params.keepAlive || false,
      validateBalance: params.validateBalance !== false,
    });
    console.log('[AssetTransferAgent] ═══════════════════════════════════════════════════');

    try {
      // ═══════════════════════════════════════════════════════════════════════════════
      // EXECUTION FLOW: Step 1 - Address Validation
      // ═══════════════════════════════════════════════════════════════════════════════
      console.log('[AssetTransferAgent] 🔍 STEP 1: Validating addresses...');
      this.validateTransferAddresses(params.address, params.recipient);
      console.log('[AssetTransferAgent] ✅ STEP 1: Addresses validated');
      // NOTE: Don't parse amount yet - need chain decimals first!
      const keepAlive = params.keepAlive === true;
      
      // ═══════════════════════════════════════════════════════════════════════════════
      // EXECUTION FLOW: Step 2 - Chain Selection & API Retrieval
      // ═══════════════════════════════════════════════════════════════════════════════
      const targetChain = params.chain || 'assetHub';
      const chainName = targetChain === 'assetHub' ? 'Asset Hub' : 'Relay Chain';
      console.log(`[AssetTransferAgent] 🔗 STEP 2: Target chain: ${chainName}`);
      
      // Get API for target chain (NOT this.api which might be relay!)
      // IMPORTANT: Agent is initialized with relay API, but transfers happen on Asset Hub
      console.log(`[AssetTransferAgent] 🔌 STEP 2.1: Getting API for ${chainName}...`);
      const targetApi = await this.getApiForChain(targetChain);
      
      // CRITICAL: Ensure API is ready before proceeding
      if (!targetApi) {
        throw new AgentError(
          `Failed to get API for ${chainName}`,
          'API_NOT_AVAILABLE',
          { chain: targetChain }
        );
      }
      
      // Always await API readiness
      console.log(`[AssetTransferAgent] ⏳ STEP 2.2: Awaiting API readiness...`);
      await targetApi.isReady;
      console.log(`[AssetTransferAgent] ✅ STEP 2: API ready for ${chainName}`);
      
      // Validate API has required pallets
      console.log(`[AssetTransferAgent] 🔍 STEP 2.3: Validating API has balances pallet...`);
      if (!targetApi.tx || !targetApi.tx.balances) {
        throw new AgentError(
          `Target chain (${chainName}) API does not have balances pallet. ` +
          `This is required for native token transfers. ` +
          `API ready: ${targetApi?.isReady}, Chain: ${targetApi?.runtimeChain?.toString() || 'unknown'}`,
          'INVALID_API_STATE',
          { chain: targetChain, chainName }
        );
      }
      console.log(`[AssetTransferAgent] ✅ STEP 2.3: Balances pallet confirmed`);
      
      // ═══════════════════════════════════════════════════════════════════════════════
      // EXECUTION FLOW: Step 3 - Chain Capabilities Detection
      // ═══════════════════════════════════════════════════════════════════════════════
      console.log(`[AssetTransferAgent] 🔍 STEP 3: Detecting chain capabilities...`);
      const capabilities = await detectTransferCapabilities(targetApi);
      
      console.log(`[AssetTransferAgent] ✅ STEP 3: Capabilities detected:`, {
        chain: capabilities.chainName,
        methods: {
          transferAllowDeath: capabilities.hasTransferAllowDeath,
          transfer: capabilities.hasTransfer,
          transferKeepAlive: capabilities.hasTransferKeepAlive,
        },
        decimals: capabilities.nativeDecimals,
        symbol: capabilities.nativeTokenSymbol,
        ed: capabilities.existentialDeposit,
      });
      
      // ═══════════════════════════════════════════════════════════════════════════════
      // EXECUTION FLOW: Step 3.5 - Amount Parsing
      // ═══════════════════════════════════════════════════════════════════════════════
      console.log(`[AssetTransferAgent] 🔍 STEP 3.5: Parsing amount with chain decimals (${capabilities.nativeDecimals})...`);
      // CRITICAL: Must use chain's decimals, not hardcoded 10!
      const amountBN = this.parseAndValidateAmountWithCapabilities(params.amount, capabilities);
      console.log(`[AssetTransferAgent] ✅ STEP 3.5: Amount parsed: ${amountBN.toString()} Planck (${this.formatAmount(amountBN, capabilities.nativeDecimals)} ${capabilities.nativeTokenSymbol})`);
      
      // ═══════════════════════════════════════════════════════════════════════════════
      // EXECUTION FLOW: Step 4 - Chain Type Validation
      // ═══════════════════════════════════════════════════════════════════════════════
      console.log(`[AssetTransferAgent] 🔍 STEP 4: Validating chain type...`);
      const isAssetHub = 
        capabilities.chainName.toLowerCase().includes('asset') ||
        capabilities.chainName.toLowerCase().includes('statemint') ||
        capabilities.specName.toLowerCase().includes('asset') ||
        capabilities.specName.toLowerCase().includes('statemint');
      
      const isRelayChain = 
        capabilities.chainName.toLowerCase().includes('polkadot') && 
        !isAssetHub &&
        capabilities.specName.toLowerCase().includes('polkadot');
      
      // Validate chain type matches expected
      if (targetChain === 'assetHub' && !isAssetHub) {
        throw new AgentError(
          `Chain type mismatch: Expected Asset Hub, but detected "${capabilities.chainName}" (${capabilities.specName}). ` +
          `This may indicate a connection to the wrong chain. ` +
          `balances pallet methods for DOT are only valid on Asset Hub or Relay Chain.`,
          'CHAIN_TYPE_MISMATCH',
          {
            expected: 'assetHub',
            detected: capabilities.chainName,
            specName: capabilities.specName,
            isAssetHub,
            isRelayChain,
          }
        );
      }
      
      if (targetChain === 'relay' && !isRelayChain && !isAssetHub) {
        console.warn(
          `[AssetTransferAgent] ⚠️ WARNING: Expected Relay Chain, but detected "${capabilities.chainName}". ` +
          `Proceeding, but this may not be correct.`
        );
      }
      
      console.log(`[AssetTransferAgent] ✅ STEP 4: Chain type validated:`, {
        chain: capabilities.chainName,
        chainType: isAssetHub ? 'Asset Hub' : isRelayChain ? 'Relay Chain' : 'Parachain',
        runtime: `${capabilities.specName} v${capabilities.specVersion}`,
        ss58Prefix: capabilities.ss58Prefix,
        nativeToken: `${capabilities.nativeTokenSymbol} (${capabilities.nativeDecimals} decimals)`,
        ed: capabilities.existentialDeposit,
        migrationCompliance: {
          balancesForDOT: isAssetHub || isRelayChain ? 'VALID' : 'REQUIRES_XCM',
        },
      });
      
      // Validate minimum capabilities
      console.log(`[AssetTransferAgent] 🔍 STEP 4.1: Validating minimum capabilities...`);
      validateMinimumCapabilities(capabilities);
      console.log(`[AssetTransferAgent] ✅ STEP 4.1: Minimum capabilities confirmed`);
      
      // ═══════════════════════════════════════════════════════════════════════════════
      // EXECUTION FLOW: Step 5 - Balance & ED Validation
      // ═══════════════════════════════════════════════════════════════════════════════
      console.log(`[AssetTransferAgent] 🔍 STEP 5: Validating existential deposit...`);
      const warnings: string[] = [];
      const edCheck = validateExistentialDeposit(amountBN, capabilities);
      if (!edCheck.valid && edCheck.warning) {
        warnings.push(edCheck.warning);
        console.log(`[AssetTransferAgent] ⚠️ STEP 5: ED warning: ${edCheck.warning}`);
      } else {
        console.log(`[AssetTransferAgent] ✅ STEP 5: ED check passed`);
      }
      
      // ═══════════════════════════════════════════════════════════════════════════════
      // EXECUTION FLOW: Step 5.0 - Validate Sender Address
      // ═══════════════════════════════════════════════════════════════════════════════
      // CRITICAL: Sender address MUST NOT be re-encoded! It must match the wallet format
      // exactly, otherwise the signature won't validate. Balance queries work with any
      // valid encoding of the same public key.
      console.log('[AssetTransferAgent] 🔐 STEP 5.0: Validating sender address...');
      const { decodeAddress } = await import('@polkadot/util-crypto');
      
      // Validate address is decodable (but don't re-encode it!)
      try {
        decodeAddress(params.address);
        console.log('[AssetTransferAgent] ✅ Sender address is valid:', {
          address: params.address,
          note: 'Using address as-is from wallet (signature must match)',
        });
      } catch (error) {
        throw new AgentError(
          `Invalid sender address: ${params.address}`,
          'INVALID_ADDRESS',
          { address: params.address, error: error instanceof Error ? error.message : String(error) }
        );
      }
      
      // Use sender address exactly as provided by wallet
      const senderAddress = params.address;
      
      // ═══════════════════════════════════════════════════════════════════════════════
      // EXECUTION FLOW: Step 5.1 - Balance Check
      // ═══════════════════════════════════════════════════════════════════════════════
      console.log(`[AssetTransferAgent] 🔍 STEP 5.1: Checking balance on ${chainName}...`);
      const balance = await targetApi.query.system.account(senderAddress);
      const balanceData = balance as any;
      const availableBN = new BN(balanceData.data?.free?.toString() || '0');
      const reservedBN = new BN(balanceData.data?.reserved?.toString() || '0');
      const frozenBN = new BN(balanceData.data?.frozen?.toString() || '0');
      const nonce = balanceData.nonce?.toString() || '0';
      
      console.log(`[AssetTransferAgent] ✅ STEP 5.1: Balance retrieved:`, {
        free: this.formatAmount(availableBN, capabilities.nativeDecimals),
        reserved: this.formatAmount(reservedBN, capabilities.nativeDecimals),
        frozen: this.formatAmount(frozenBN, capabilities.nativeDecimals),
        available: this.formatAmount(availableBN.sub(frozenBN), capabilities.nativeDecimals),
        nonce,
      });
      
      // ═══════════════════════════════════════════════════════════════════════════════
      // CRITICAL: Post-Migration Validation (November 4, 2025)
      // ═══════════════════════════════════════════════════════════════════════════════
      // After DOT migration to Asset Hub, accounts might not exist on Asset Hub yet
      // even if they had balance on Relay Chain. This causes validation errors.
      
      // Check if account exists on Asset Hub (has any balance or nonce > 0)
      const accountExists = availableBN.gt(new BN(0)) || new BN(nonce).gt(new BN(0));
      
      if (!accountExists) {
        console.error(`[AssetTransferAgent] ❌ Account does not exist on ${chainName}!`);
        throw new AgentError(
          `Account ${senderAddress.slice(0, 8)}...${senderAddress.slice(-8)} does not exist on ${chainName}. ` +
          `After the November 2025 migration, you need to receive DOT on Asset Hub before you can send. ` +
          `Free balance: ${availableBN.toString()}, Nonce: ${nonce}`,
          'ACCOUNT_NOT_EXISTS',
          {
            chain: capabilities.chainName,
            address: senderAddress,
            free: availableBN.toString(),
            nonce,
          }
        );
      }
      
      console.log(`[AssetTransferAgent] ✅ STEP 5.1: Account exists on ${chainName}`);
      
      // Estimate fees (conservative)
      const estimatedFeeBN = new BN('200000000'); // 0.02 DOT
      const totalRequired = amountBN.add(estimatedFeeBN);
      
      console.log(`[AssetTransferAgent] 🔍 STEP 5.2: Validating sufficient balance...`);
      if (params.validateBalance !== false && availableBN.lt(totalRequired)) {
        throw new AgentError(
          `Insufficient balance. Available: ${this.formatAmount(availableBN, capabilities.nativeDecimals)} ${capabilities.nativeTokenSymbol}, Required: ${this.formatAmount(totalRequired, capabilities.nativeDecimals)} ${capabilities.nativeTokenSymbol} (including fees)`,
          'INSUFFICIENT_BALANCE',
          {
            chain: capabilities.chainName,
            available: availableBN.toString(),
            required: totalRequired.toString(),
          }
        );
      }
      console.log(`[AssetTransferAgent] ✅ STEP 5.2: Sufficient balance confirmed`);
      
      // CRITICAL: Check for account reaping risk (transferAllowDeath/transfer only)
      // Account is reaped if: (free_balance - fees - amount) < ED
      console.log(`[AssetTransferAgent] 🔍 STEP 5.3: Checking account reaping risk...`);
      if (!params.keepAlive) {
        const edBN = new BN(capabilities.existentialDeposit);
        const balanceAfterTransfer = availableBN.sub(amountBN).sub(estimatedFeeBN);
        
        if (balanceAfterTransfer.lt(edBN)) {
          const willBeReaped = balanceAfterTransfer.lt(new BN(0)) || balanceAfterTransfer.lt(edBN);
          
          warnings.push(
            `⚠️ ACCOUNT REAPING RISK: Using transferAllowDeath/transfer. ` +
            `After this transfer, sender balance will be: ${this.formatAmount(balanceAfterTransfer, capabilities.nativeDecimals)} ${capabilities.nativeTokenSymbol}. ` +
            `Existential Deposit (ED): ${this.formatAmount(edBN, capabilities.nativeDecimals)} ${capabilities.nativeTokenSymbol}. ` +
            `${willBeReaped ? 'ACCOUNT WILL BE REAPED' : 'Balance below ED - account may be reaped'}. ` +
            `Reaped accounts lose all state, nonces reset, locks/reserves removed. ` +
            `Use keepAlive=true to prevent account reaping.`
          );
          
          console.warn('[AssetTransferAgent] ⚠️ STEP 5.3: Account reaping risk detected:', {
            sender: senderAddress,
            currentBalance: this.formatAmount(availableBN, capabilities.nativeDecimals),
            amount: this.formatAmount(amountBN, capabilities.nativeDecimals),
            estimatedFees: this.formatAmount(estimatedFeeBN, capabilities.nativeDecimals),
            balanceAfterTransfer: this.formatAmount(balanceAfterTransfer, capabilities.nativeDecimals),
            ed: this.formatAmount(edBN, capabilities.nativeDecimals),
            willBeReaped,
            chain: capabilities.chainName,
          });
        } else {
          console.log(`[AssetTransferAgent] ✅ STEP 5.3: No account reaping risk`);
        }
      } else {
        console.log(`[AssetTransferAgent] ✅ STEP 5.3: Account protected (keepAlive=true)`);
      }
      
      // ═══════════════════════════════════════════════════════════════════════════════
      // EXECUTION FLOW: Step 6 - Extrinsic Construction
      // ═══════════════════════════════════════════════════════════════════════════════
      // ═══════════════════════════════════════════════════════════════════════════════
      // IMPORTANT: Post-Migration (November 4, 2025)
      // ═══════════════════════════════════════════════════════════════════════════════
      // DOT IS now native to Asset Hub. Both balances.transfer and balances.transferKeepAlive
      // work normally. We prefer transferKeepAlive for safety (prevents account reaping).
      console.log('[AssetTransferAgent] 🔨 STEP 6: Creating transfer extrinsic...');
      console.log('[AssetTransferAgent] 📋 Transfer details:', {
        senderAddress,
        recipient: params.recipient,
        amount: amountBN.toString(),
        amountFormatted: this.formatAmount(amountBN, capabilities.nativeDecimals),
        keepAlive,
        chain: capabilities.chainName,
        symbol: capabilities.nativeTokenSymbol,
        ss58Prefix: capabilities.ss58Prefix,
      });
      
      const result = buildSafeTransferExtrinsic(
        targetApi, // Use target chain API, not this.api!
        {
          recipient: params.recipient,
          amount: amountBN, // BN used throughout
          keepAlive,
        },
        capabilities
      );
      
      // Add builder warnings
      warnings.push(...result.warnings);
      
      console.log('[AssetTransferAgent] ✅ STEP 6: Extrinsic created successfully:', {
        method: result.method,
        recipient: result.recipientEncoded,
        amount: result.amountBN.toString(),
        section: result.extrinsic.method.section,
        methodName: result.extrinsic.method.method,
        callIndex: Array.from(result.extrinsic.method.toU8a().slice(0, 2)),
        callHex: result.extrinsic.method.toHex().slice(0, 66) + '...',
      });
      
      // Detailed extrinsic info for debugging validation errors
      console.log('[AssetTransferAgent] 🔍 Extrinsic details for validation:', {
        sender: senderAddress,
        recipient: result.recipientEncoded,
        amount: result.amountBN.toString(),
        method: `${result.extrinsic.method.section}.${result.extrinsic.method.method}`,
        args: result.extrinsic.method.args.map((arg: any) => arg.toString()),
      });
      
      // ═══════════════════════════════════════════════════════════════════════════════
      // EXECUTION FLOW: Step 7 - Extrinsic Ready (No Simulation in Agent)
      // ═══════════════════════════════════════════════════════════════════════════════
      // Agent's ONLY job is CONSTRUCTION. Validation/simulation happens in Executioner.
      // This ensures single simulation point and proper separation of concerns.
      console.log('[AssetTransferAgent] ✅ STEP 7: Extrinsic constructed successfully');
      console.log('[AssetTransferAgent] 💡 NOTE: Validation will happen in Executioner before execution');
      const finalEstimatedFee = estimatedFeeBN.toString();
      
      // ═══════════════════════════════════════════════════════════════════════════════
      // EXECUTION FLOW: Step 8 - Return Result
      // ═══════════════════════════════════════════════════════════════════════════════
      console.log('[AssetTransferAgent] 📤 STEP 8: Preparing result...');
      const description = `Transfer ${this.formatAmount(result.amountBN)} ${capabilities.nativeTokenSymbol} from ${senderAddress.slice(0, 8)}...${senderAddress.slice(-8)} to ${result.recipientEncoded.slice(0, 8)}...${result.recipientEncoded.slice(-8)} on ${chainName}`;

      const result_obj = this.createResult(
        description,
        result.extrinsic, // ✅ EXTRINSIC READY! (validated if simulation enabled)
        {
          estimatedFee: finalEstimatedFee,
          warnings: warnings.length > 0 ? warnings : undefined,
          metadata: {
            method: result.method,
            chain: capabilities.chainName,
            decimals: capabilities.nativeDecimals,
            symbol: capabilities.nativeTokenSymbol,
          },
          resultType: 'extrinsic',
          requiresConfirmation: true,
          executionType: 'extrinsic',
        }
      );
      
      console.log('[AssetTransferAgent] ✅ STEP 8: Result prepared successfully');
      console.log('[AssetTransferAgent] ═══════════════════════════════════════════════════');
      console.log('[AssetTransferAgent] ✅ TRANSFER REQUEST COMPLETED');
      console.log('[AssetTransferAgent] ═══════════════════════════════════════════════════');
      
      return result_obj;
    } catch (error) {
      // Enhanced error logging for debugging wasm unreachable and other issues
      console.error('[AssetTransferAgent] ✗ Transfer failed:', {
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof AgentError ? (error as AgentError).code : 'UNKNOWN',
        stack: error instanceof Error ? error.stack : undefined,
        params: {
          sender: params.address,
          recipient: params.recipient,
          amount: params.amount,
          chain: params.chain,
          keepAlive: params.keepAlive,
        },
      });
      return this.handleTransferError(error, 'Transfer');
    }
  }

  /**
   * Batch transfer - transfer to multiple recipients in a single transaction
   * 
   * PRODUCTION-SAFE FLOW:
   * 1. Validate all recipients and amounts
   * 2. Detect chain capabilities
   * 3. Check total balance
   * 4. Create batch extrinsic using production-safe builder
   * 5. Return extrinsic ready for signing
   */
  async batchTransfer(params: BatchTransferParams): Promise<AgentResult> {
    this.ensureInitialized();
    
    if (!this.api) {
      throw new AgentError('API not initialized', 'API_NOT_INITIALIZED');
    }

    console.log('[AssetTransferAgent] ═══════════════════════════════════════════════════');
    console.log('[AssetTransferAgent] 📥 BATCH TRANSFER REQUEST RECEIVED');
    console.log('[AssetTransferAgent] ───────────────────────────────────────────────────');
    console.log('[AssetTransferAgent] Parameters:', {
      sender: params.address,
      transferCount: params.transfers?.length || 0,
      chain: params.chain || 'assetHub (default)',
      validateBalance: params.validateBalance !== false,
    });
    console.log('[AssetTransferAgent] ═══════════════════════════════════════════════════');

    try {
      // Step 1: Validate sender and transfers array
      this.validateSenderAddress(params.address);
      this.validateTransfersArray(params.transfers);

      // Step 2: Determine target chain and get appropriate API
      const targetChain = params.chain || 'assetHub';
      const chainName = targetChain === 'assetHub' ? 'Asset Hub' : 'Relay Chain';
      
      console.log(`[AssetTransferAgent] Preparing batch transfer on ${chainName}`);
      
      // Get API for target chain
      const targetApi = await this.getApiForChain(targetChain);
      
      // CRITICAL: Ensure API is ready before proceeding
      if (!targetApi) {
        throw new AgentError(
          `Failed to get API for ${chainName}`,
          'API_NOT_AVAILABLE',
          { chain: targetChain }
        );
      }
      
      // Always await API readiness
      await targetApi.isReady;

      // Step 3: Detect chain capabilities
      const capabilities = await detectTransferCapabilities(targetApi);
      
      console.log(`[AssetTransferAgent] Detected chain capabilities for batch:`, {
        chain: capabilities.chainName,
        hasBatch: capabilities.hasBatch,
        hasBatchAll: capabilities.hasBatchAll,
      });
      
      validateMinimumCapabilities(capabilities);
      
      // Check batch support
      if (!capabilities.hasUtility) {
        throw new AgentError(
          `Chain ${capabilities.chainName} does not support batch operations (no utility pallet)`,
          'BATCH_NOT_SUPPORTED'
        );
      }

      // Step 3.5: NOW parse transfers with correct chain decimals
      const { validatedTransfers, totalAmount } = this.validateAndParseTransfersWithCapabilities(
        params.address,
        params.transfers,
        capabilities
      );

      // Step 4: Validate sender address and check balance
      const warnings: string[] = [];
      
      // CRITICAL: Sender address MUST NOT be re-encoded! Use exactly as from wallet
      console.log('[AssetTransferAgent] 🔐 Validating sender address (batch)...');
      const { decodeAddress } = await import('@polkadot/util-crypto');
      
      try {
        decodeAddress(params.address);
      } catch (error) {
        throw new AgentError(
          `Invalid sender address: ${params.address}`,
          'INVALID_ADDRESS',
          { address: params.address }
        );
      }
      
      // Use sender address exactly as provided by wallet
      const senderAddress = params.address;
      
      const balance = await targetApi.query.system.account(senderAddress);
      const balanceData = balance as any;
      const availableBN = new BN(balanceData.data?.free?.toString() || '0');
      
      const estimatedFeeBN = new BN('500000000'); // 0.05 DOT for batch
      const totalRequired = totalAmount.add(estimatedFeeBN);
      
      if (params.validateBalance !== false && availableBN.lt(totalRequired)) {
        throw new AgentError(
          `Insufficient balance for batch. Available: ${this.formatAmount(availableBN)} ${capabilities.nativeTokenSymbol}, Required: ${this.formatAmount(totalRequired)} ${capabilities.nativeTokenSymbol}`,
          'INSUFFICIENT_BALANCE',
          {
            available: availableBN.toString(),
            required: totalRequired.toString(),
          }
        );
      }

      // Step 5: Create batch extrinsic using production-safe builder with TARGET API
      console.log('[AssetTransferAgent] Creating batch extrinsic...');
      
      const transfersWithBN = validatedTransfers.map(t => ({
        recipient: t.recipient,
        amount: new BN(t.amount),
      }));
      
      const result = buildSafeBatchExtrinsic(
        targetApi, // Use target chain API!
        transfersWithBN,
        capabilities,
        true // useAtomicBatch (batchAll)
      );
      
      warnings.push(...result.warnings);
      
      console.log('[AssetTransferAgent] ✅ STEP 6: Batch extrinsic created:', {
        method: result.method,
        transfers: params.transfers.length,
        totalAmount: result.amountBN.toString(),
      });
      
      // ═══════════════════════════════════════════════════════════════════════════════
      // EXECUTION FLOW: Step 7 - Extrinsic Ready (No Simulation in Agent)
      // ═══════════════════════════════════════════════════════════════════════════════
      // Agent's ONLY job is CONSTRUCTION. Validation/simulation happens in Executioner.
      // This ensures single simulation point and proper separation of concerns.
      console.log('[AssetTransferAgent] ✅ STEP 7: Batch extrinsic constructed successfully');
      console.log('[AssetTransferAgent] 💡 NOTE: Validation will happen in Executioner before execution');
      const finalEstimatedFee = estimatedFeeBN.toString();
      
      // ═══════════════════════════════════════════════════════════════════════════════
      // EXECUTION FLOW: Step 8 - Return Result
      // ═══════════════════════════════════════════════════════════════════════════════
      console.log('[AssetTransferAgent] 📤 STEP 8: Preparing result...');
      const description = `Batch transfer: ${params.transfers.length} transfers totaling ${this.formatAmount(result.amountBN, capabilities.nativeDecimals)} ${capabilities.nativeTokenSymbol} from ${senderAddress.slice(0, 8)}...${senderAddress.slice(-8)} on ${chainName}`;

      const result_obj = this.createResult(
        description,
        result.extrinsic, // ✅ BATCH EXTRINSIC READY! (validated if simulation enabled)
        {
          estimatedFee: finalEstimatedFee,
          warnings: warnings.length > 0 ? warnings : undefined,
          metadata: {
            method: result.method,
            transferCount: params.transfers.length,
            chain: capabilities.chainName,
            decimals: capabilities.nativeDecimals,
            symbol: capabilities.nativeTokenSymbol,
          },
          resultType: 'extrinsic',
          requiresConfirmation: true,
          executionType: 'extrinsic',
        }
      );
      
      console.log('[AssetTransferAgent] ✅ STEP 8: Result prepared successfully');
      console.log('[AssetTransferAgent] ═══════════════════════════════════════════════════');
      console.log('[AssetTransferAgent] ✅ BATCH TRANSFER REQUEST COMPLETED');
      console.log('[AssetTransferAgent] ═══════════════════════════════════════════════════');
      
      return result_obj;
    } catch (error) {
      // Enhanced error logging for debugging wasm unreachable and other issues
      console.error('[AssetTransferAgent] ✗ Batch transfer failed:', {
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof AgentError ? (error as AgentError).code : 'UNKNOWN',
        stack: error instanceof Error ? error.stack : undefined,
        params: {
          sender: params.address,
          transferCount: params.transfers?.length || 0,
          chain: params.chain,
        },
      });
      return this.handleTransferError(error, 'Batch transfer');
    }
  }

  // ===== HELPER METHODS =====

  private validateTransferAddresses(sender: string, recipient: string): void {
    const senderValidation = this.validateAddress(sender);
    if (!senderValidation.valid) {
      throw new AgentError(
        `Invalid sender address: ${senderValidation.errors.join(', ')}`,
        'INVALID_SENDER_ADDRESS',
        { errors: senderValidation.errors }
      );
    }

    const recipientValidation = this.validateAddress(recipient);
    if (!recipientValidation.valid) {
      throw new AgentError(
        `Invalid recipient address: ${recipientValidation.errors.join(', ')}`,
        'INVALID_RECIPIENT_ADDRESS',
        { errors: recipientValidation.errors }
      );
    }

    if (sender === recipient) {
      throw new AgentError(
        'Sender and recipient addresses cannot be the same',
        'SAME_SENDER_RECIPIENT'
      );
    }
  }

  private validateSenderAddress(address: string): void {
    const validation = this.validateAddress(address);
    if (!validation.valid) {
      throw new AgentError(
        `Invalid sender address: ${validation.errors.join(', ')}`,
        'INVALID_SENDER_ADDRESS',
        { errors: validation.errors }
      );
    }
  }

  private validateTransfersArray(transfers?: Array<{ recipient: string; amount: string | number }>): void {
    if (!transfers || transfers.length === 0) {
      throw new AgentError('At least one transfer is required', 'NO_TRANSFERS');
    }
    if (transfers.length > 100) {
      throw new AgentError('Batch transfer cannot exceed 100 transfers', 'TOO_MANY_TRANSFERS');
    }
  }

  /**
   * Validate and parse transfers for batch operations
   * 
   * CRITICAL: Must use chain's decimals for amount parsing!
   */
  private validateAndParseTransfersWithCapabilities(
    senderAddress: string,
    transfers: Array<{ recipient: string; amount: string | number }>,
    capabilities: TransferCapabilities
  ): { validatedTransfers: Array<{ recipient: string; amount: string }>; totalAmount: BN } {
    const totalAmount = new BN(0);
    const validatedTransfers = transfers.map((transfer, index) => {
      const recipientValidation = this.validateAddress(transfer.recipient);
      if (!recipientValidation.valid) {
        throw new AgentError(
          `Invalid recipient address at index ${index}: ${recipientValidation.errors.join(', ')}`,
          'INVALID_RECIPIENT_ADDRESS',
          { index, errors: recipientValidation.errors }
        );
      }

      if (senderAddress === transfer.recipient) {
        throw new AgentError(
          `Transfer ${index + 1}: Sender and recipient addresses cannot be the same`,
          'SAME_SENDER_RECIPIENT',
          { index }
        );
      }

      const amountBN = this.parseAndValidateAmountWithCapabilities(transfer.amount, capabilities, index);
      totalAmount.iadd(amountBN);

      return {
        recipient: transfer.recipient,
        amount: amountBN.toString(),
      };
    });

    return { validatedTransfers, totalAmount };
  }

  /**
   * @deprecated Use validateAndParseTransfersWithCapabilities instead
   */
  private validateAndParseTransfers(
    senderAddress: string,
    transfers: Array<{ recipient: string; amount: string | number }>
  ): { validatedTransfers: Array<{ recipient: string; amount: string }>; totalAmount: BN } {
    const totalAmount = new BN(0);
    const validatedTransfers = transfers.map((transfer, index) => {
      const recipientValidation = this.validateAddress(transfer.recipient);
      if (!recipientValidation.valid) {
        throw new AgentError(
          `Invalid recipient address at index ${index}: ${recipientValidation.errors.join(', ')}`,
          'INVALID_RECIPIENT_ADDRESS',
          { index, errors: recipientValidation.errors }
        );
      }

      if (senderAddress === transfer.recipient) {
        throw new AgentError(
          `Transfer ${index + 1}: Sender and recipient addresses cannot be the same`,
          'SAME_SENDER_RECIPIENT',
          { index }
        );
      }

      const amountBN = this.parseAndValidateAmount(transfer.amount, index);
      totalAmount.iadd(amountBN);

      return {
        recipient: transfer.recipient,
        amount: amountBN.toString(),
      };
    });

    return { validatedTransfers, totalAmount };
  }

  /**
   * Parse and validate amount with chain-specific decimals
   * 
   * CRITICAL: This method MUST use the chain's actual decimals, not hardcoded 10!
   * According to GLOBAL RULE #9: AMOUNTS ARE ALWAYS BN INTERNALLY
   */
  private parseAndValidateAmountWithCapabilities(
    amount: string | number, 
    capabilities: TransferCapabilities,
    index?: number
  ): BN {
    const amountBN = typeof amount === 'string' && amount.includes('.')
      ? this.parseAmount(amount, capabilities.nativeDecimals) // Use chain's decimals!
      : new BN(amount);

    if (amountBN.lte(new BN(0))) {
      const prefix = index !== undefined ? `Transfer ${index + 1}: ` : '';
      throw new AgentError(
        `${prefix}Transfer amount must be greater than zero`,
        'INVALID_AMOUNT',
        index !== undefined ? { index } : undefined
      );
    }

    return amountBN;
  }

  /**
   * @deprecated Use parseAndValidateAmountWithCapabilities instead
   * This method uses hardcoded 10 decimals which may not match the chain
   */
  private parseAndValidateAmount(amount: string | number, index?: number): BN {
    const amountBN = typeof amount === 'string' && amount.includes('.')
      ? this.parseAmount(amount)
      : new BN(amount);

    if (amountBN.lte(new BN(0))) {
      const prefix = index !== undefined ? `Transfer ${index + 1}: ` : '';
      throw new AgentError(
        `${prefix}Transfer amount must be greater than zero`,
        'INVALID_AMOUNT',
        index !== undefined ? { index } : undefined
      );
    }

    return amountBN;
  }


  private handleTransferError(error: unknown, operation: string): never {
    if (error instanceof AgentError) {
      throw error;
    }
    throw new AgentError(
      `${operation} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      `${operation.toUpperCase().replace(' ', '_')}_ERROR`,
      { originalError: error instanceof Error ? error.message : String(error) }
    );
  }
}
