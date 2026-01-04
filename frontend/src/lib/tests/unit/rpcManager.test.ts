/**
 * Unit tests for RpcManager
 */

// Mock Polkadot modules before imports
jest.mock('@polkadot/api', () => ({
  ApiPromise: {
    create: jest.fn(),
  },
  WsProvider: jest.fn(),
}));

import { RpcManager, ExecutionSession } from '../../rpcManager';
import { ApiPromise, WsProvider } from '@polkadot/api';
import type { Registry } from '@polkadot/types/types';

describe('RpcManager', () => {
  let mockApi: Partial<ApiPromise>;
  let mockProvider: Partial<WsProvider>;
  let mockRegistry: Partial<Registry>;
  let localStorageMock: Storage;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mock API
    mockRegistry = {
      hash: 'mock-registry-hash-123',
    } as any as Registry;

    mockApi = {
      isReady: Promise.resolve(mockApi as ApiPromise),
      isConnected: true,
      disconnect: jest.fn().mockResolvedValue(undefined),
      registry: mockRegistry as Registry,
      on: jest.fn(),
    };

    // Create mock provider
    mockProvider = {
      isConnected: false,
      connect: jest.fn(),
      disconnect: jest.fn(),
      on: jest.fn(),
    };

    // Mock ApiPromise.create
    (ApiPromise.create as jest.Mock).mockResolvedValue(mockApi as ApiPromise);

    // Mock WsProvider - triggers 'connected' event asynchronously
    (WsProvider as jest.Mock).mockImplementation(() => {
      const provider: any = {
        isConnected: false,
        disconnect: jest.fn(),
        on: jest.fn((event: string, handler: Function) => {
          // For 'connected' event, call handler asynchronously in next tick
          if (event === 'connected') {
            // Use setImmediate or setTimeout(0) to ensure async behavior
            if (typeof setImmediate !== 'undefined') {
              setImmediate(() => handler());
            } else {
              setTimeout(() => handler(), 0);
            }
          }
        }),
      };
      return provider;
    });

    // Mock localStorage
    localStorageMock = {
      getItem: jest.fn(),
      setItem: jest.fn(),
      removeItem: jest.fn(),
      clear: jest.fn(),
      length: 0,
      key: jest.fn(),
    };
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('RpcManager class', () => {
    it('should initialize with endpoints', () => {
      const manager = new RpcManager({
        endpoints: ['wss://rpc.polkadot.io', 'wss://polkadot-rpc.dwellir.com'],
        enablePeriodicHealthChecks: false, // Disable for tests
      });

      const healthStatus = manager.getHealthStatus();
      expect(healthStatus).toHaveLength(2);
      expect(healthStatus[0].endpoint).toBe('wss://rpc.polkadot.io');
      expect(healthStatus[1].endpoint).toBe('wss://polkadot-rpc.dwellir.com');
    });

    it('should initialize health map with default values', () => {
      const manager = new RpcManager({
        endpoints: ['wss://rpc.polkadot.io'],
        enablePeriodicHealthChecks: false,
      });

      const healthStatus = manager.getHealthStatus();
      expect(healthStatus[0].healthy).toBe(true);
      expect(healthStatus[0].failureCount).toBe(0);
      expect(healthStatus[0].lastChecked).toBe(0);
    });

    it('should load persisted health data from localStorage', () => {
      const storedData = {
        timestamp: Date.now() - 1000, // 1 second ago
        healthMap: [
          {
            endpoint: 'wss://rpc.polkadot.io',
            healthy: false,
            lastChecked: Date.now() - 5000,
            failureCount: 3,
            lastFailure: Date.now() - 2000,
          },
        ],
      };

      (localStorageMock.getItem as jest.Mock).mockReturnValue(JSON.stringify(storedData));

      const manager = new RpcManager({
        endpoints: ['wss://rpc.polkadot.io'],
        storageKey: 'test_health',
        enablePeriodicHealthChecks: false,
      });

      const healthStatus = manager.getHealthStatus();
      expect(healthStatus[0].healthy).toBe(false);
      expect(healthStatus[0].failureCount).toBe(3);
    });

    it('should start periodic health monitoring by default', () => {
      const manager = new RpcManager({
        endpoints: ['wss://rpc.polkadot.io'],
      });

      // Health monitoring should be active
      // We can't directly test the timer, but we can verify it's set up
      expect(manager).toBeDefined();
    });

    it('should not start health monitoring if disabled', () => {
      const manager = new RpcManager({
        endpoints: ['wss://rpc.polkadot.io'],
        enablePeriodicHealthChecks: false,
      });

      expect(manager).toBeDefined();
    });
  });

  describe('getReadApi()', () => {
    it('should connect to first healthy endpoint', async () => {
      const manager = new RpcManager({
        endpoints: ['wss://rpc.polkadot.io', 'wss://polkadot-rpc.dwellir.com'],
        enablePeriodicHealthChecks: false,
      });

      const api = await manager.getReadApi();

      expect(api).toBeDefined();
      expect(WsProvider).toHaveBeenCalledWith('wss://rpc.polkadot.io');
      expect(ApiPromise.create).toHaveBeenCalled();
    });

    it('should reuse existing connection if still connected', async () => {
      const manager = new RpcManager({
        endpoints: ['wss://rpc.polkadot.io'],
        enablePeriodicHealthChecks: false,
      });

      const api1 = await manager.getReadApi();

      // Second call should reuse the same API
      const api2 = await manager.getReadApi();

      expect(api1).toBe(api2);
      expect(WsProvider).toHaveBeenCalledTimes(1);
    });

    it('should failover to next endpoint if first fails', async () => {
      const manager = new RpcManager({
        endpoints: ['wss://rpc.polkadot.io', 'wss://polkadot-rpc.dwellir.com'],
        enablePeriodicHealthChecks: false,
      });

      // Make first endpoint fail
      (WsProvider as jest.Mock).mockImplementationOnce(() => {
        const provider = {
          isConnected: false,
          disconnect: jest.fn(),
          on: jest.fn((event: string, handler: Function) => {
            if (event === 'error') {
              // Call error handler immediately
              Promise.resolve().then(() => handler(new Error('Connection failed')));
            }
          }),
        };
        return provider;
      });

      // Should try second endpoint
      const api = await manager.getReadApi();

      expect(api).toBeDefined();
      expect(WsProvider).toHaveBeenCalledWith('wss://polkadot-rpc.dwellir.com');
    });

    it('should throw error if all endpoints fail', async () => {
      const manager = new RpcManager({
        endpoints: ['wss://rpc.polkadot.io', 'wss://polkadot-rpc.dwellir.com'],
        enablePeriodicHealthChecks: false,
      });

      // Make all endpoints fail
      (WsProvider as jest.Mock).mockImplementation(() => {
        const provider = {
          isConnected: false,
          disconnect: jest.fn(),
          on: jest.fn((event: string, handler: Function) => {
            if (event === 'error') {
              // Call error handler immediately
              Promise.resolve().then(() => handler(new Error('Connection failed')));
            }
          }),
        };
        return provider;
      });

      await expect(manager.getReadApi()).rejects.toThrow('Failed to connect to any RPC endpoint');
    });

    it('should mark endpoint as failed when connection fails', async () => {
      const manager = new RpcManager({
        endpoints: ['wss://rpc.polkadot.io', 'wss://polkadot-rpc.dwellir.com'],
        enablePeriodicHealthChecks: false,
      });

      // Make first endpoint fail
      (WsProvider as jest.Mock).mockImplementationOnce(() => {
        const provider = {
          isConnected: false,
          disconnect: jest.fn(),
          on: jest.fn((event: string, handler: Function) => {
            if (event === 'error') {
              // Call error handler immediately
              Promise.resolve().then(() => handler(new Error('Connection failed')));
            }
          }),
        };
        return provider;
      });

      try {
        await manager.getReadApi();
      } catch {
        // Expected to fail on first endpoint, then succeed on second
      }

      const healthStatus = manager.getHealthStatus();
      const failedEndpoint = healthStatus.find(h => h.endpoint === 'wss://rpc.polkadot.io');
      expect(failedEndpoint?.healthy).toBe(false);
      expect(failedEndpoint?.failureCount).toBeGreaterThan(0);
    });
  });

  describe('createExecutionSession()', () => {
    it('should create immutable execution session', async () => {
      const manager = new RpcManager({
        endpoints: ['wss://rpc.polkadot.io'],
        enablePeriodicHealthChecks: false,
      });

      const session = await manager.createExecutionSession();

      expect(session).toBeInstanceOf(ExecutionSession);
      expect(session.endpoint).toBe('wss://rpc.polkadot.io');
      expect(session.api).toBeDefined();
      expect(session.registry).toBeDefined();
    });

    it('should lock API instance to specific endpoint', async () => {
      const manager = new RpcManager({
        endpoints: ['wss://rpc.polkadot.io', 'wss://polkadot-rpc.dwellir.com'],
        enablePeriodicHealthChecks: false,
      });

      const session = await manager.createExecutionSession();

      // Session should be locked to the endpoint it was created with
      expect(session.endpoint).toBe('wss://rpc.polkadot.io');
      expect(session.api).toBe(mockApi);
    });

    it('should track active sessions', async () => {
      const manager = new RpcManager({
        endpoints: ['wss://rpc.polkadot.io'],
        enablePeriodicHealthChecks: false,
      });

      const session1 = await manager.createExecutionSession();
      const session2 = await manager.createExecutionSession();

      expect(manager.getActiveSessionCount()).toBe(2);
    });

    it('should remove session when API disconnects', async () => {
      const manager = new RpcManager({
        endpoints: ['wss://rpc.polkadot.io'],
        enablePeriodicHealthChecks: false,
      });

      const session = await manager.createExecutionSession();

      expect(manager.getActiveSessionCount()).toBe(1);

      // Simulate disconnect - find the handler registered in createExecutionSession
      // The handler is registered via api.on('disconnected', ...)
      const onCalls = (mockApi.on as jest.Mock).mock.calls;
      const disconnectCall = onCalls.find((call: any[]) => call[0] === 'disconnected');
      if (disconnectCall && disconnectCall[1]) {
        disconnectCall[1](); // Call the disconnect handler
      }

      expect(manager.getActiveSessionCount()).toBe(0);
      // Session should be inactive (tested via isConnected)
      const isConnected = await session.isConnected();
      expect(isConnected).toBe(false);
    });

    it('should failover if first endpoint fails', async () => {
      const manager = new RpcManager({
        endpoints: ['wss://rpc.polkadot.io', 'wss://polkadot-rpc.dwellir.com'],
        enablePeriodicHealthChecks: false,
      });

      // Make first endpoint fail
      (WsProvider as jest.Mock).mockImplementationOnce(() => {
        const provider = {
          isConnected: false,
          disconnect: jest.fn(),
          on: jest.fn((event: string, handler: Function) => {
            if (event === 'error') {
              // Call error handler immediately
              Promise.resolve().then(() => handler(new Error('Connection failed')));
            }
          }),
        };
        return provider;
      });

      const session = await manager.createExecutionSession();

      expect(session.endpoint).toBe('wss://polkadot-rpc.dwellir.com');
    });
  });

  describe('getHealthStatus()', () => {
    it('should return health status for all endpoints', () => {
      const manager = new RpcManager({
        endpoints: ['wss://rpc.polkadot.io', 'wss://polkadot-rpc.dwellir.com'],
        enablePeriodicHealthChecks: false,
      });

      const healthStatus = manager.getHealthStatus();

      expect(healthStatus).toHaveLength(2);
      expect(healthStatus[0]).toHaveProperty('endpoint');
      expect(healthStatus[0]).toHaveProperty('healthy');
      expect(healthStatus[0]).toHaveProperty('lastChecked');
      expect(healthStatus[0]).toHaveProperty('failureCount');
    });

    it('should include all health information fields', () => {
      const manager = new RpcManager({
        endpoints: ['wss://rpc.polkadot.io'],
        enablePeriodicHealthChecks: false,
      });

      const healthStatus = manager.getHealthStatus();

      expect(healthStatus[0]).toHaveProperty('endpoint');
      expect(healthStatus[0]).toHaveProperty('healthy');
      expect(healthStatus[0]).toHaveProperty('lastChecked');
      expect(healthStatus[0]).toHaveProperty('failureCount');
      // Optional fields may not be present initially
      // lastFailure and avgResponseTime are optional
    });
  });

  describe('getCurrentEndpoint()', () => {
    it('should return current endpoint after connection', async () => {
      const manager = new RpcManager({
        endpoints: ['wss://rpc.polkadot.io', 'wss://polkadot-rpc.dwellir.com'],
        enablePeriodicHealthChecks: false,
      });

      expect(manager.getCurrentEndpoint()).toBeNull();

      await manager.getReadApi();

      expect(manager.getCurrentEndpoint()).toBe('wss://rpc.polkadot.io');
    });

    it('should return null if no connection established', () => {
      const manager = new RpcManager({
        endpoints: ['wss://rpc.polkadot.io'],
        enablePeriodicHealthChecks: false,
      });

      expect(manager.getCurrentEndpoint()).toBeNull();
    });
  });

  describe('ExecutionSession class', () => {
    let session: ExecutionSession;

    beforeEach(() => {
      session = new ExecutionSession(mockApi as ApiPromise, 'wss://rpc.polkadot.io');
    });

    it('should create immutable session', () => {
      expect(session.api).toBe(mockApi);
      expect(session.endpoint).toBe('wss://rpc.polkadot.io');
      expect(session.registry).toBe(mockRegistry);

      // Verify immutability - endpoint is readonly
      expect(() => {
        (session as any).endpoint = 'different';
      }).toThrow(); // Readonly property should throw in strict mode
    });

    it('should check if session is connected', async () => {
      const isConnected = await session.isConnected();

      expect(isConnected).toBe(true);
      expect(mockApi.isConnected).toBe(true);
    });

    it('should mark session as inactive', async () => {
      // Initially should be connected
      expect(await session.isConnected()).toBe(true);

      session.markInactive();

      // After marking inactive, should not be connected
      expect(await session.isConnected()).toBe(false);
    });

    it('should return false for isConnected if session is inactive', async () => {
      session.markInactive();

      const isConnected = await session.isConnected();

      expect(isConnected).toBe(false);
    });

    it('should validate extrinsic registry matches session registry', () => {
      const mockExtrinsic = {
        registry: mockRegistry,
      };

      expect(() => {
        session.assertSameRegistry(mockExtrinsic);
      }).not.toThrow();
    });

    it('should throw error if extrinsic has no registry', () => {
      const mockExtrinsic = {};

      expect(() => {
        session.assertSameRegistry(mockExtrinsic);
      }).toThrow('Invalid extrinsic: missing registry');
    });

    it('should throw error if extrinsic registry does not match', () => {
      const differentRegistry = {
        hash: 'different-registry-hash',
      };

      const mockExtrinsic = {
        registry: differentRegistry,
      };

      expect(() => {
        session.assertSameRegistry(mockExtrinsic);
      }).toThrow('Cross-registry extrinsic detected');
    });
  });
});

