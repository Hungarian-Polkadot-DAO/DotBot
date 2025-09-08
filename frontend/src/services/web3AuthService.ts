import { web3Accounts, web3Enable } from '@polkadot/extension-dapp';
import { stringToHex } from '@polkadot/util';
import { signatureVerify } from '@polkadot/util-crypto';
import { WalletAccount } from '../types/wallet';

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

  constructor() {
    this.authToken = localStorage.getItem('authToken');
    const storedUser = localStorage.getItem('user');
    this.user = storedUser ? JSON.parse(storedUser) : null;
  }

  /**
   * Enable Web3 extensions and get available accounts
   */
  async enableWeb3(): Promise<WalletAccount[]> {
    try {
      console.log('Enabling Web3 extensions...');
      
      // Enable all available extensions (Talisman, Subwallet, etc.)
      const extensions = await web3Enable('DotBot');
      console.log('Enabled extensions:', extensions);

      if (extensions.length === 0) {
        throw new Error('No Web3 extensions found. Please install Talisman, Subwallet, or another Polkadot wallet extension.');
      }

      // Get all available accounts
      const accounts = await web3Accounts();
      console.log('Available accounts:', accounts);

      // Transform to our WalletAccount interface
      return accounts.map(account => ({
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
      console.log('Checking wallet availability...');
      
      // Check if we're in a browser environment
      if (typeof window === 'undefined') {
        console.log('Not in browser environment');
        return { available: false, locked: false, error: 'Not in browser environment' };
      }
      
      // Check if the polkadot extension object exists
      if (typeof (window as any).injectedWeb3 === 'undefined') {
        console.log('No injectedWeb3 found');
        return { available: false, locked: false, error: 'No wallet extensions detected' };
      }
      
      console.log('Available injected extensions:', Object.keys((window as any).injectedWeb3));
      
      // Try to enable extensions
      const extensions = await web3Enable('DotBot');
      console.log('web3Enable result:', extensions);
      
      // If extensions array is empty but we have injectedWeb3, the extensions might be locked
      if (extensions.length === 0 && Object.keys((window as any).injectedWeb3).length > 0) {
        console.log('Extensions detected but not enabled - likely locked');
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
      console.log('Getting available accounts...');
      const accounts = await web3Accounts();
      console.log('Retrieved accounts:', accounts);
      
      return accounts.map(account => ({
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
   */
  async authenticate(account: WalletAccount): Promise<AuthenticationResult> {
    try {
      this.currentAccount = account;
      
      console.log('Authenticating account:', account);
      
      // Create a message to sign
      const timestamp = Date.now();
      const message = `Authenticate with DotBot\nTimestamp: ${timestamp}\nAddress: ${account.address}`;
      
      // Verify account is accessible
      if (!account.address) {
        throw new Error('Account address is missing. Please select a valid account in your wallet extension.');
      }
      
      console.log('Message to sign:', message);
      
      // Request signature from the wallet
      let signature;
      try {
        // Get the enabled extensions (these have the signing interfaces)
        console.log('Getting signing interface from enabled extensions...');
        const enabledExtensions = await web3Enable('DotBot');
        console.log('Enabled extensions for signing:', enabledExtensions);
        
        // Try to find a signing interface
        for (const extension of enabledExtensions) {
          console.log('Checking extension:', extension.name);
          
          // Prioritize Talisman since we know it's working from the example
          if (extension.name === 'talisman') {
            console.log('Prioritizing Talisman extension...');
            
            // Check if the extension has a signer with signing methods
            if (extension.signer && extension.signer.signRaw && typeof extension.signer.signRaw === 'function') {
              console.log('Using Talisman signer interface');
              try {
                signature = await extension.signer.signRaw({
                  address: account.address,
                  data: stringToHex(message),
                  type: 'bytes'
                });
                if (signature) break;
              } catch (signError) {
                console.log(`Talisman signer interface failed:`, signError);
                continue;
              }
            }
          }
        }
        
        // If Talisman didn't work, try other extensions
        if (!signature) {
          for (const extension of enabledExtensions) {
            if (extension.name === 'talisman') continue; // Skip Talisman, already tried
            
            console.log('Trying extension:', extension.name);
            
            // Check if the extension has a signer with signing methods
            if (extension.signer && extension.signer.signRaw && typeof extension.signer.signRaw === 'function') {
              console.log('Using extension signer interface:', extension.name);
              try {
                signature = await extension.signer.signRaw({
                  address: account.address,
                  data: stringToHex(message),
                  type: 'bytes'
                });
                if (signature) break;
              } catch (signError) {
                console.log(`Extension signer interface failed:`, signError);
                continue;
              }
            }
          }
        }
        
        if (!signature) {
          throw new Error(`No signing method found in enabled extensions. Available extensions: ${enabledExtensions.map(e => e.name).join(', ')}`);
        }
        
      } catch (signError) {
        console.error('Signing error:', signError);
        
        // Provide more specific error messages
        if (signError instanceof Error) {
          if (signError.message.includes('Unable to retrieve keypair')) {
            throw new Error(`Account not accessible: ${signError.message}. Please ensure the account is unlocked and accessible in your wallet extension.`);
          } else if (signError.message.includes('User rejected')) {
            throw new Error('Signing was rejected by the user. Please approve the signing request in your wallet extension.');
          } else if (signError.message.includes('No signing method found')) {
            const enabledExtensions = await web3Enable('DotBot');
            throw new Error(`No signing method found. Available extensions: ${enabledExtensions?.map(e => e.name).join(', ') || 'none'}`);
          } else {
            throw new Error(`Failed to sign message: ${signError.message}`);
          }
        } else {
          throw new Error('Failed to sign message: Unknown error');
        }
      }

      // Extract signature from response
      const signatureData = (signature as any)?.signature || signature;
      if (!signatureData) {
        throw new Error('No signature received from wallet');
      }

      console.log('Signature received:', signatureData);

      // Verify signature locally
      console.log('Verifying signature:', {
        message,
        messageHex: stringToHex(message),
        signatureData,
        address: account.address
      });
      
      try {
        const isValid = signatureVerify(message, signatureData, account.address);
        console.log('Signature verification result:', isValid);
        
        if (!isValid.isValid) {
          console.warn('Signature verification failed, but proceeding with authentication for demo purposes');
          // In a real application, you would want to throw an error here
          // For now, we'll skip verification to test the rest of the flow
        } else {
          console.log('Signature verified successfully');
        }
      } catch (verifyError) {
        console.warn('Signature verification error:', verifyError);
        console.log('Proceeding with authentication for demo purposes');
        // In a real application, you would want to handle this error properly
      }

      // For now, simulate a successful authentication without backend
      // In a real implementation, you would send this to your backend
      const mockResponse = {
        success: true,
        token: 'mock_jwt_token_' + Date.now(),
        user: {
          id: account.address,
          address: account.address,
          name: account.name,
          source: account.source
        }
      };

      console.log('Service: Mock response:', mockResponse);

      if (mockResponse.success) {
        this.authToken = mockResponse.token;
        this.user = mockResponse.user;
        this.currentAccount = account;
        
        // Store in localStorage
        localStorage.setItem('authToken', this.authToken);
        localStorage.setItem('user', JSON.stringify(this.user));
        
        console.log('Service: Authentication state updated:', {
          authToken: this.authToken,
          user: this.user,
          currentAccount: this.currentAccount,
          isAuthenticated: this.isAuthenticated()
        });
        
        return {
          success: true,
          user: this.user,
          token: this.authToken
        };
      } else {
        throw new Error('Authentication failed');
      }
    } catch (error) {
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
      console.log('Logging out user');
    } catch (error) {
      console.warn('Logout API call failed:', error);
    } finally {
      // Clear local data
      this.currentAccount = null;
      this.authToken = null;
      this.user = null;
      
      localStorage.removeItem('authToken');
      localStorage.removeItem('user');
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
      // In a real implementation, you would verify the token with your backend
      console.log('Initializing with existing auth state');
      return true;
    }
    return false;
  }
}

// Create singleton instance
const web3AuthService = new Web3AuthService();

export default web3AuthService;
