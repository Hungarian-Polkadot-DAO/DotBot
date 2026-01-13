import { create } from 'zustand';
import { WalletAccount, WalletState } from '../types/wallet';
import web3AuthService from '@dotbot/core/services/web3AuthService';

interface WalletStore extends WalletState {
  // Actions
  enableWallet: () => Promise<void>;
  connectAccount: (account: WalletAccount) => Promise<void>;
  disconnect: () => Promise<void>;
  refreshAccounts: () => Promise<void>;
  checkWalletStatus: () => Promise<void>;
  setError: (error: string | null) => void;
  clearError: () => void;
  initialize: () => Promise<void>;
  syncWithService: () => void;
}

export const useWalletStore = create<WalletStore>((set, get) => ({
  // Initial state
  isConnected: false,
  selectedWallet: null,
  selectedAccount: null,
  availableWallets: [],
  isConnecting: false,
  error: null,

  // Actions
  enableWallet: async () => {
    set({ isConnecting: true, error: null });
    
    try {
      // CRITICAL: Enable Web3 extensions ONCE - all other calls will use cache
      console.log('Store: Enabling Web3 extensions...');
      const accounts = await web3AuthService.enableWeb3();
      console.log('Store: Web3 extensions enabled, got accounts:', accounts.length);
      
      if (accounts.length === 0) {
        throw new Error('No accounts found in wallet. Please unlock your wallet and try again.');
      }
      
      // Transform accounts to wallet info structure
      // Group accounts by source (extension name)
      const accountsBySource = new Map<string, WalletAccount[]>();
      accounts.forEach(account => {
        const source = account.source || 'unknown';
        if (!accountsBySource.has(source)) {
          accountsBySource.set(source, []);
        }
        accountsBySource.get(source)!.push(account);
      });
      
      const walletInfo = Array.from(accountsBySource.entries()).map(([extensionName, extensionAccounts]) => ({
        name: extensionName,
        version: '1.0.0', // We don't have version info from the API
        accounts: extensionAccounts,
        installed: true,
        connected: true
      }));
      
      set({ 
        availableWallets: walletInfo,
        isConnecting: false,
        error: null
      });
      
    } catch (error) {
      set({ 
        isConnecting: false, 
        error: error instanceof Error ? error.message : 'Failed to enable wallet extensions'
      });
    }
  },

  connectAccount: async (account: WalletAccount) => {
    console.log('Store: Attempting to connect account:', account);
    set({ isConnecting: true, error: null });
    
    try {
      // CRITICAL: authenticate() is called from the modal with proper error handling
      // This function just updates the store state after successful authentication
      // The service already handled authentication, so we just sync state
      
      // Verify authentication succeeded by checking service state
      const isAuthenticated = web3AuthService.isAuthenticated();
      const currentAccount = web3AuthService.getCurrentAccount();
      
      if (!isAuthenticated || !currentAccount) {
        throw new Error('Authentication not completed. Please try connecting again.');
      }
      
      // Verify account matches
      if (currentAccount.address !== account.address) {
        throw new Error('Account mismatch. Please select the correct account.');
      }
      
      console.log('Store: Authentication verified, updating state');
      set({
        isConnected: true,
        selectedAccount: account,
        selectedWallet: account.source,
        isConnecting: false,
        error: null
      });
      
      console.log('Store: ✅ State updated successfully');
    } catch (error) {
      console.error('Store: ❌ State update error:', error);
      
      // This should rarely happen since modal handles authentication
      // But if it does, set error state
      const errorMessage = error instanceof Error ? error.message : 'Failed to update connection state';
      set({
        isConnecting: false,
        error: errorMessage
      });
      
      // Re-throw so modal can handle it
      throw error;
    }
  },

  disconnect: async () => {
    try {
      await web3AuthService.logout();
      
      set({
        isConnected: false,
        selectedAccount: null,
        selectedWallet: null,
        availableWallets: [],
        error: null
      });
    } catch (error) {
      console.error('Disconnect error:', error);
    }
  },

  refreshAccounts: async () => {
    const { enableWallet } = get();
    await enableWallet();
  },

  checkWalletStatus: async () => {
    try {
      // Ensure extensions are enabled first
      const accounts = await web3AuthService.enableWeb3();
      
      if (accounts.length > 0) {
        // No need to call checkWalletAvailability - we already have accounts
        
        // Group accounts by source (extension name)
        const accountsBySource = new Map<string, WalletAccount[]>();
        accounts.forEach(account => {
          const source = account.source || 'unknown';
          if (!accountsBySource.has(source)) {
            accountsBySource.set(source, []);
          }
          accountsBySource.get(source)!.push(account);
        });
        
        // Transform accounts to wallet info structure
        const walletInfo = Array.from(accountsBySource.entries()).map(([extensionName, extensionAccounts]) => ({
          name: extensionName,
          version: '1.0.0',
          accounts: extensionAccounts,
          installed: true,
          connected: true
        }));
        
        set({ 
          availableWallets: walletInfo,
          error: null
        });
      } else {
        // Check if extensions are locked
        const walletStatus = await web3AuthService.checkWalletAvailability();
        if (walletStatus.locked) {
          set({
            error: `Wallet extensions are locked. Please unlock them and try again.`,
            availableWallets: []
          });
        } else {
          set({
            error: `Failed to connect to wallet: ${walletStatus.error || 'No accounts found'}`,
            availableWallets: []
          });
        }
      }
    } catch (error) {
      set({
        error: `Status check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        availableWallets: []
      });
    }
  },

  setError: (error: string | null) => {
    set({ error });
  },

  clearError: () => {
    set({ error: null });
  },

  // Initialize store with existing authentication state
  initialize: async () => {
    try {
      const wasAuthenticated = await web3AuthService.initialize();
      if (wasAuthenticated) {
        const user = web3AuthService.getCurrentUser();
        const currentAccount = web3AuthService.getCurrentAccount();
        
        if (user && currentAccount) {
          set({
            isConnected: true,
            selectedAccount: currentAccount,
            selectedWallet: currentAccount.source,
            error: null
          });
        }
      }
    } catch (error) {
      console.error('Failed to initialize wallet store:', error);
    }
  },

  // Sync store state with service state
  syncWithService: () => {
    const isAuthenticated = web3AuthService.isAuthenticated();
    const currentAccount = web3AuthService.getCurrentAccount();
    const user = web3AuthService.getCurrentUser();
    
    if (isAuthenticated && currentAccount && user) {
      set({
        isConnected: true,
        selectedAccount: currentAccount,
        selectedWallet: currentAccount.source,
        error: null
      });
    } else {
      set({
        isConnected: false,
        selectedAccount: null,
        selectedWallet: null
      });
    }
  }
}));
