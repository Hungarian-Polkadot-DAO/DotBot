// Local storage service - provides persistence without backend

import { ChatSession, Message } from '../types/chat';
import { WalletAccount } from '../types/wallet';

export class StorageService {
  private readonly STORAGE_KEYS = {
    CHAT_SESSIONS: 'dotbot_chat_sessions',
    CURRENT_SESSION: 'dotbot_current_session',
    WALLET_PREFERENCES: 'dotbot_wallet_preferences',
    AGENT_PREFERENCES: 'dotbot_agent_preferences',
    USER_SETTINGS: 'dotbot_user_settings'
  };

  // Chat session management
  saveChatSessions(sessions: ChatSession[]): void {
    try {
      localStorage.setItem(this.STORAGE_KEYS.CHAT_SESSIONS, JSON.stringify(sessions));
    } catch (error) {
      console.error('Failed to save chat sessions:', error);
    }
  }

  loadChatSessions(): ChatSession[] {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEYS.CHAT_SESSIONS);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Failed to load chat sessions:', error);
      return [];
    }
  }

  saveCurrentSession(sessionId: string): void {
    try {
      localStorage.setItem(this.STORAGE_KEYS.CURRENT_SESSION, sessionId);
    } catch (error) {
      console.error('Failed to save current session:', error);
    }
  }

  loadCurrentSession(): string | null {
    try {
      return localStorage.getItem(this.STORAGE_KEYS.CURRENT_SESSION);
    } catch (error) {
      console.error('Failed to load current session:', error);
      return null;
    }
  }

  // Add message to session
  addMessageToSession(sessionId: string, message: Message): void {
    const sessions = this.loadChatSessions();
    const sessionIndex = sessions.findIndex(s => s.id === sessionId);
    
    if (sessionIndex >= 0) {
      sessions[sessionIndex].messages.push(message);
      sessions[sessionIndex].updatedAt = Date.now();
      this.saveChatSessions(sessions);
    }
  }

  // Create new session
  createNewSession(title?: string): ChatSession {
    const newSession: ChatSession = {
      id: Date.now().toString(),
      title: title || 'New Chat',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    const sessions = this.loadChatSessions();
    sessions.unshift(newSession); // Add to beginning
    this.saveChatSessions(sessions);
    this.saveCurrentSession(newSession.id);

    return newSession;
  }

  // Delete session
  deleteSession(sessionId: string): void {
    const sessions = this.loadChatSessions();
    const filteredSessions = sessions.filter(s => s.id !== sessionId);
    this.saveChatSessions(filteredSessions);

    // If deleted session was current, clear current session
    const currentSession = this.loadCurrentSession();
    if (currentSession === sessionId) {
      localStorage.removeItem(this.STORAGE_KEYS.CURRENT_SESSION);
    }
  }

  // Wallet preferences
  saveWalletPreferences(preferences: {
    selectedWallet?: string;
    selectedAccount?: WalletAccount;
    autoConnect?: boolean;
  }): void {
    try {
      localStorage.setItem(this.STORAGE_KEYS.WALLET_PREFERENCES, JSON.stringify(preferences));
    } catch (error) {
      console.error('Failed to save wallet preferences:', error);
    }
  }

  loadWalletPreferences(): {
    selectedWallet?: string;
    selectedAccount?: WalletAccount;
    autoConnect?: boolean;
  } {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEYS.WALLET_PREFERENCES);
      return stored ? JSON.parse(stored) : {};
    } catch (error) {
      console.error('Failed to load wallet preferences:', error);
      return {};
    }
  }

  // Agent preferences
  saveAgentPreferences(preferences: {
    preferredAgent?: string;
    agentSettings?: Record<string, any>;
  }): void {
    try {
      localStorage.setItem(this.STORAGE_KEYS.AGENT_PREFERENCES, JSON.stringify(preferences));
    } catch (error) {
      console.error('Failed to save agent preferences:', error);
    }
  }

  loadAgentPreferences(): {
    preferredAgent?: string;
    agentSettings?: Record<string, any>;
  } {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEYS.AGENT_PREFERENCES);
      return stored ? JSON.parse(stored) : {};
    } catch (error) {
      console.error('Failed to load agent preferences:', error);
      return {};
    }
  }

  // User settings
  saveUserSettings(settings: {
    theme?: 'light' | 'dark';
    voiceEnabled?: boolean;
    autoExecute?: boolean;
    defaultNetwork?: string;
    notifications?: boolean;
  }): void {
    try {
      localStorage.setItem(this.STORAGE_KEYS.USER_SETTINGS, JSON.stringify(settings));
    } catch (error) {
      console.error('Failed to save user settings:', error);
    }
  }

  loadUserSettings(): {
    theme?: 'light' | 'dark';
    voiceEnabled?: boolean;
    autoExecute?: boolean;
    defaultNetwork?: string;
    notifications?: boolean;
  } {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEYS.USER_SETTINGS);
      return stored ? JSON.parse(stored) : {
        theme: 'dark',
        voiceEnabled: false,
        autoExecute: false,
        defaultNetwork: 'polkadot',
        notifications: true
      };
    } catch (error) {
      console.error('Failed to load user settings:', error);
      return {};
    }
  }

  // Clear all data
  clearAllData(): void {
    Object.values(this.STORAGE_KEYS).forEach(key => {
      localStorage.removeItem(key);
    });
  }

  // Export data for backup
  exportData(): string {
    const data = {
      sessions: this.loadChatSessions(),
      walletPreferences: this.loadWalletPreferences(),
      agentPreferences: this.loadAgentPreferences(),
      userSettings: this.loadUserSettings(),
      exportedAt: Date.now()
    };
    
    return JSON.stringify(data, null, 2);
  }

  // Import data from backup
  importData(dataString: string): boolean {
    try {
      const data = JSON.parse(dataString);
      
      if (data.sessions) {
        this.saveChatSessions(data.sessions);
      }
      if (data.walletPreferences) {
        this.saveWalletPreferences(data.walletPreferences);
      }
      if (data.agentPreferences) {
        this.saveAgentPreferences(data.agentPreferences);
      }
      if (data.userSettings) {
        this.saveUserSettings(data.userSettings);
      }
      
      return true;
    } catch (error) {
      console.error('Failed to import data:', error);
      return false;
    }
  }
}

// Singleton instance - all components use this same instance
const storageService = new StorageService();

// Export both default and named for flexibility
export default storageService;
export { storageService };
