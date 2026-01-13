/**
 * Settings Manager
 * 
 * Centralized settings management for all DotBot configuration.
 * Supports persistence and runtime changes.
 * Extensible for future settings categories.
 */

import { getStorage } from '../env';

/**
 * Simulation Configuration
 */
export interface SimulationConfig {
  /** Whether simulation is enabled globally */
  enabled: boolean;
  
  /** Timeout for simulation (ms) */
  timeout: number;
  
  /** THESE WE DO NOT IMPLEMENT, probably we leave it in interface, for feature enhancement */
  /** Whether to skip simulation if it fails (fallback to execution) */
  skipOnFailure?: boolean;
  
  /** Whether to allow ignoring simulation results */
  allowIgnoreResults?: boolean;
  
  /** Whether to use Chopsticks (if false, use paymentInfo fallback) */
  useChopsticks?: boolean;
}

/**
 * Complete application settings
 */
export interface AppSettings {
  simulation: SimulationConfig;
  // Future settings can be added here:
  // ui: UIConfig;
  // notifications: NotificationConfig;
  // etc.
}

const DEFAULT_SIMULATION_CONFIG: SimulationConfig = {
  enabled: true,  // Default: simulation enabled
  timeout: 120000,  // 2 minutes
};

const DEFAULT_SETTINGS: AppSettings = {
  simulation: { ...DEFAULT_SIMULATION_CONFIG },
};

/**
 * Settings Manager
 * 
 * Singleton class for managing all application settings with persistence.
 * Components can read current state by calling methods on the instance.
 */
class SettingsManager {
  private settings: AppSettings;
  private readonly storageKey = 'dotbot_settings';

  constructor() {
    this.settings = { ...DEFAULT_SETTINGS };
    this.load();
  }

  /**
   * Get all settings
   */
  getAllSettings(): AppSettings {
    return JSON.parse(JSON.stringify(this.settings)); // Deep copy
  }

  /**
   * Get simulation configuration
   */
  getSimulationConfig(): SimulationConfig {
    return { ...this.settings.simulation };
  }

  /**
   * Update simulation configuration
   */
  updateSimulationConfig(updates: Partial<SimulationConfig>): void {
    this.settings.simulation = { ...this.settings.simulation, ...updates };
    this.save();
  }

  /**
   * Update any settings (generic method for future extensibility)
   */
  updateSettings(updates: Partial<AppSettings>): void {
    this.settings = { ...this.settings, ...updates };
    this.save();
  }

  /**
   * Reset all settings to defaults
   */
  reset(): void {
    this.settings = { ...DEFAULT_SETTINGS };
    this.save();
  }

  /**
   * Reset simulation settings to defaults
   */
  resetSimulation(): void {
    this.settings.simulation = { ...DEFAULT_SIMULATION_CONFIG };
    this.save();
  }

  /**
   * Load settings from storage (localStorage in browser, in-memory in Node.js)
   */
  private load(): void {
    try {
      const storage = getStorage();
      const stored = storage.getItem(this.storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Merge with defaults to handle new settings added in future
        this.settings = {
          ...DEFAULT_SETTINGS,
          ...parsed,
          simulation: {
            ...DEFAULT_SIMULATION_CONFIG,
            ...(parsed.simulation || {}),
          },
        };
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }

  /**
   * Save settings to storage (localStorage in browser, in-memory in Node.js)
   */
  private save(): void {
    try {
      const storage = getStorage();
      storage.setItem(this.storageKey, JSON.stringify(this.settings));
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  }
}

// Export singleton instance - this is the main API
// Domain-specific convenience functions live in their respective modules
// (e.g., simulationConfig.ts for simulation settings)
export const settingsManager = new SettingsManager();
// This keeps the API clean and scalable

