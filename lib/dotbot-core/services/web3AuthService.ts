import { signatureVerify, cryptoWaitReady } from '@polkadot/util-crypto';
import { decodeAddress } from '@polkadot/keyring';
import { WalletAccount } from '../types/wallet';
import { isBrowser, getStorage } from '../env';

// Lazy import for browser-only extension-dapp
async function getExtensionDapp() {
  if (!isBrowser()) {
    throw new Error('Web3AuthService can only be used in browser environment');
  }
  // Dynamic import - only loads in browser
  return await import('@polkadot/extension-dapp');
}

// const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

interface WalletStatus {
  available: boolean;
  locked: boolean;
  error?: string;
  extensions?: string[];
}

interface AuthenticationResult {
  success: boolean;
  user?: any;
  token?: string;
  error?: string;
}

class Web3AuthService {
  private currentAccount: WalletAccount | null = null;
  private authToken: string | null = null;
  private user: any = null;
  private extensionsEnabled = false;
  private enabledExtensionsCache: any[] | null = null;
  private enablePromise: Promise<any[]> | null = null;

  constructor() {
    if (isBrowser()) {
      const storage = getStorage();
      this.authToken = storage.getItem('authToken');
      const storedUser = storage.getItem('user');
      this.user = storedUser ? JSON.parse(storedUser) : null;
    }
  }

  /**
   * Internal method to enable Web3 extensions (with caching to prevent duplicate calls)
   */
  private async _enableWeb3Internal(): Promise<any[]> {
    if (this.enabledExtensionsCache !== null) {
      return this.enabledExtensionsCache;
    }

    if (this.enablePromise !== null) {
      return this.enablePromise;
    }

    const extensionDapp = await getExtensionDapp();
    this.enablePromise = extensionDapp.web3Enable('DotBot');

    try {
      const extensions = await this.enablePromise;

      if (!extensions || extensions.length === 0) {
        throw new Error('No Web3 extensions found. Please install Talisman, Subwallet, or another Polkadot wallet extension.');
      }

      // Cache the result
      this.enabledExtensionsCache = extensions;
      this.extensionsEnabled = true;

      return extensions;
    } catch (error) {
      console.error('Error enabling Web3:', error);
      this.extensionsEnabled = false;
      this.enabledExtensionsCache = null;
      throw error;
    } finally {
      this.enablePromise = null;
    }
  }

  /**
   * Enable Web3 extensions and get available accounts
   * MUST be called before authenticate() to ensure extensions are ready
   */
  async enableWeb3(): Promise<WalletAccount[]> {
    try {
      await this._enableWeb3Internal();

      const extensionDapp = await getExtensionDapp();
      const accounts = await extensionDapp.web3Accounts();

      return accounts.map((account: any) => ({
        address: account.address,
        name: account.meta?.name || 'Unnamed Account',
        source: account.meta?.source || 'unknown',
        type: account.type,
        genesisHash: account.meta?.genesisHash || undefined
      }));
    } catch (error) {
      console.error('Error enabling Web3:', error);
      throw error;
    }
  }

  /**
   * Check if wallet extensions are available
   */
  async checkWalletAvailability(): Promise<WalletStatus> {
    try {
      if (typeof window === 'undefined') {
        return { available: false, locked: false, error: 'Not in browser environment' };
      }
      
      if (typeof (window as any).injectedWeb3 === 'undefined') {
        return { available: false, locked: false, error: 'No wallet extensions detected' };
      }
      
      const extensions = await this._enableWeb3Internal();
      
      if (extensions.length === 0 && Object.keys((window as any).injectedWeb3).length > 0) {
        return { 
          available: true, 
          locked: true, 
          extensions: Object.keys((window as any).injectedWeb3) 
        };
      }
      
      return { 
        available: extensions.length > 0, 
        locked: false, 
        extensions: extensions.map(ext => ext.name) 
      };
    } catch (error) {
      console.error('Error checking wallet availability:', error);
      return { 
        available: false, 
        locked: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Get available accounts if wallet is enabled
   */
  async getAvailableAccounts(): Promise<WalletAccount[]> {
    try {
      const extensionDapp = await getExtensionDapp();
      const accounts = await extensionDapp.web3Accounts();
      console.log('Accounts:', accounts);
      
      return accounts.map((account: any) => ({
        address: account.address,
        name: account.meta?.name || 'Unnamed Account',
        source: account.meta?.source || 'unknown',
        type: account.type,
        genesisHash: account.meta?.genesisHash || undefined
      }));
    } catch (error) {
      console.error('Error getting accounts:', error);
      return [];
    }
  }


  /**
   * Authenticate with a specific account
   * 
   * CRITICAL: ensureWeb3Enabled() is called first to ensure extensions are ready
   */
  async authenticate(account: WalletAccount): Promise<AuthenticationResult> {
    try {
      this.currentAccount = account;
      
      // Create authentication message
      const timestamp = Date.now();
      const message = `Authenticate with DotBot\nTimestamp: ${timestamp}\nAddress: ${account.address}`;
      
      // Decode account address to get the expected public key (for comparison)
      const expectedPublicKey = decodeAddress(account.address);
      
      // Verify account is accessible
      if (!account.address) {
        throw new Error('Account address is missing. Please select a valid account in your wallet extension.');
      }
      
      // Request signature from the wallet
      let signatureData: string;
      try {
        // Use web3FromAddress instead of web3Enable to avoid triggering permission popup again
        const extensionDapp = await getExtensionDapp();
        const injector = await extensionDapp.web3FromAddress(account.address);
        
        if (!injector.signer || !injector.signer.signRaw) {
          throw new Error('No signer available for this account');
        }


        // Sign the message
        const signResult = await injector.signer.signRaw({
          address: account.address,
          data: message,
          type: 'payload'
        });

        signatureData = signResult.signature;
        
      } catch (signError) {
        console.error('Signing error:', signError);
        
        // Provide more specific error messages
        if (signError instanceof Error) {
          if (signError.message.includes('Unable to retrieve keypair')) {
            throw new Error(`Account not accessible: ${signError.message}. Please ensure the account is unlocked and accessible in your wallet extension.`);
          } else           if (signError.message.includes('User rejected')) {
            throw new Error('Signing was rejected by the user. Please approve the signing request in your wallet extension.');
          } else if (signError.message.includes('No signing method found')) {
            const enabledExtensions = await this._enableWeb3Internal();
            throw new Error(`No signing method found. Available extensions: ${enabledExtensions?.map(e => e.name).join(', ') || 'none'}`);
          } else {
            throw new Error(`Failed to sign message: ${signError.message}`);
          }
        } else {
          throw new Error('Failed to sign message: Unknown error');
        }
      }

      // Verify signature - REQUIRED for security
      let isValid = false;
      let verificationError: Error | null = null;
      
      try {
        await cryptoWaitReady();
        
        // Verify the signature
        const verificationResult = signatureVerify(message, signatureData, account.address);
        
        // Compare public keys (not SS58 addresses - critical for multi-chain support)
        if (verificationResult.publicKey) {
          const verifiedPublicKey = verificationResult.publicKey;
          const keysMatch = expectedPublicKey.length === verifiedPublicKey.length &&
            expectedPublicKey.every((b, i) => b === verifiedPublicKey[i]);
          
          // Success ONLY if both signature valid AND public keys match
          isValid = verificationResult.isValid && keysMatch;
          
          if (!keysMatch) {
            verificationError = new Error('Public keys do not match. Wrong account or address encoding issue.');
          } else if (!verificationResult.isValid) {
            verificationError = new Error('Signature is invalid. Message or signature may have been modified.');
          }
        } else {
          isValid = verificationResult.isValid;
          if (!isValid) {
            verificationError = new Error('Signature verification failed.');
          }
        }
      } catch (verifyError) {
        verificationError = verifyError instanceof Error 
          ? verifyError 
          : new Error(`Signature verification threw an error: ${String(verifyError)}`);
      }
      
      if (verificationError || !isValid) {
        const errorMessage = verificationError?.message || 'Signature verification failed';
        throw new Error(`Authentication failed: ${errorMessage}`);
      }

      // Create session token (in production, send signature to backend for verification)
      const sessionToken = `session_${account.address}_${Date.now()}`;

      // Store authentication state
      this.authToken = sessionToken;
      this.user = {
        id: account.address,
        address: account.address,
        name: account.name,
        source: account.source
      };
      this.currentAccount = account;
      
      if (isBrowser()) {
        const storage = getStorage();
        storage.setItem('authToken', this.authToken);
        storage.setItem('user', JSON.stringify(this.user));
      }
      
      return {
        success: true,
        user: this.user,
        token: this.authToken
      };
    } catch (error: any) {
      console.error('Authentication error:', error);
      throw error;
    }
  }

  /**
   * Logout user
   */
  async logout(): Promise<void> {
    try {
      // In a real implementation, you would call a logout endpoint
    } catch {
      // Ignore logout errors
    } finally {
      // Clear local data
      this.currentAccount = null;
      this.authToken = null;
      this.user = null;
      
      if (isBrowser()) {
        const storage = getStorage();
        storage.removeItem('authToken');
        storage.removeItem('user');
      }
    }
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return !!this.authToken && !!this.user;
  }

  /**
   * Get current user
   */
  getCurrentUser(): any {
    return this.user;
  }

  /**
   * Get current account
   */
  getCurrentAccount(): WalletAccount | null {
    return this.currentAccount;
  }

  /**
   * Get auth token
   */
  getAuthToken(): string | null {
    return this.authToken;
  }

  /**
   * Initialize authentication state
   */
  async initialize(): Promise<boolean> {
    if (this.authToken && this.user) {
      return true;
    }
    return false;
  }
}

// Create singleton instance - all components use this same instance
const web3AuthService = new Web3AuthService();

// Export both default and named for flexibility
export default web3AuthService;
export { web3AuthService };
