import { create } from 'zustand';
import { WalletAccount, WalletState } from '../types/wallet';
import web3AuthService from '../services/web3AuthService';

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
      // Check if wallet is available
      const walletStatus = await web3AuthService.checkWalletAvailability();
      
      if (!walletStatus.available) {
        throw new Error(walletStatus.error || 'No wallet extensions found. Please install Talisman, Subwallet, or another Polkadot wallet extension.');
      }
      
      if (walletStatus.locked) {
        throw new Error(`Wallet extensions detected (${walletStatus.extensions?.join(', ')}) but they are locked. Please unlock your wallet in the browser extension and try again.`);
      }
      
      // Get available accounts
      const accounts = await web3AuthService.getAvailableAccounts();
      
      if (accounts.length === 0) {
        throw new Error('No accounts found in wallet. Please unlock your wallet and try again.');
      }
      
      // Transform accounts to wallet info structure
      const walletInfo = walletStatus.extensions?.map(extensionName => ({
        name: extensionName,
        version: '1.0.0', // We don't have version info from the API
        accounts: accounts.filter(account => account.source === extensionName),
        installed: true,
        connected: true
      })) || [];
      
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
      const result = await web3AuthService.authenticate(account);
      console.log('Store: Authentication result:', result);
      
      if (result.success) {
        console.log('Store: Authentication successful, updating state');
        set({
          isConnected: true,
          selectedAccount: account,
          selectedWallet: account.source,
          isConnecting: false,
          error: null
        });
        
        // Double-check by syncing with service state
        const { syncWithService } = get();
        syncWithService();
        
        console.log('Store: State updated, isConnected should be true');
      } else {
        throw new Error(result.error || 'Authentication failed');
      }
    } catch (error) {
      console.error('Store: Authentication error:', error);
      
      let errorMessage = 'Authentication failed';
      if (error instanceof Error) {
        errorMessage = error.message;
        
        // Add more detailed error information
        if (error.message.includes('signRaw') || error.message.includes('sign')) {
          errorMessage = `Wallet signing failed: ${error.message}. Please check your wallet extension and try again.`;
        }
      }
      
      set({
        isConnecting: false,
        error: errorMessage
      });
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
      const walletStatus = await web3AuthService.checkWalletAvailability();
      
      if (walletStatus.available && !walletStatus.locked) {
        // Get accounts
        const accounts = await web3AuthService.getAvailableAccounts();
        
        // Transform accounts to wallet info structure
        const walletInfo = walletStatus.extensions?.map(extensionName => ({
          name: extensionName,
          version: '1.0.0',
          accounts: accounts.filter(account => account.source === extensionName),
          installed: true,
          connected: true
        })) || [];
        
        set({ 
          availableWallets: walletInfo,
          error: null
        });
      } else if (walletStatus.locked) {
        set({
          error: `Wallet extensions are locked. Please unlock them and try again.`,
          availableWallets: []
        });
      } else {
        set({
          error: `Failed to connect to wallet: ${walletStatus.error || 'Unknown error'}`,
          availableWallets: []
        });
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
