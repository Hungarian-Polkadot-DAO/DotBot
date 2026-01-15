/**
 * WebSocket Integration Test
 * 
 * Tests that execution updates are properly broadcast via WebSocket
 * This verifies the backend WebSocket integration works correctly
 */

import { io, Socket } from 'socket.io-client';
import axios from 'axios';
import { ExecutionArrayState, ClientToServerEvents, ServerToClientEvents, WebSocketEvents } from '@dotbot/core';

interface TestConfig {
  baseUrl: string;
  wsUrl: string;
  sessionId: string;
  wallet: {
    address: string;
    name?: string;
    source: string;
  };
}

interface WebSocketEvent {
  type: 'execution-update' | 'execution-complete' | 'connected' | 'disconnect';
  executionId?: string;
  state?: ExecutionArrayState;
  success?: boolean;
  timestamp: number;
}

class WebSocketIntegrationTest {
  private config: TestConfig;
  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
  private receivedEvents: WebSocketEvent[] = [];
  private executionId: string | null = null;

  constructor(config: TestConfig) {
    this.config = config;
  }

  /**
   * Connect to WebSocket server
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('WebSocket connection timeout'));
      }, 10000);

      this.socket = io(this.config.wsUrl, {
        query: { sessionId: this.config.sessionId },
        transports: ['websocket', 'polling'],
        reconnection: false,
        timeout: 10000,
      }) as Socket<ServerToClientEvents, ClientToServerEvents>;

      this.socket.on('connect', () => {
        clearTimeout(timeout);
        console.log(`[WebSocket] Connected: ${this.socket?.id}`);
        resolve();
      });

      this.socket.on('connect_error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      // Listen for execution updates
      this.socket.on(WebSocketEvents.EXECUTION_UPDATE, (data) => {
        this.receivedEvents.push({
          type: 'execution-update',
          executionId: data.executionId,
          state: data.state,
          timestamp: Date.now(),
        });
        console.log(`[WebSocket] Received execution-update for ${data.executionId}`);
      });

      // Listen for execution completion
      this.socket.on(WebSocketEvents.EXECUTION_COMPLETE, (data) => {
        this.receivedEvents.push({
          type: 'execution-complete',
          executionId: data.executionId,
          success: data.success,
          timestamp: Date.now(),
        });
        console.log(`[WebSocket] Received execution-complete for ${data.executionId}, success: ${data.success}`);
      });

      // Listen for connection confirmation
      this.socket.on(WebSocketEvents.CONNECTED, (data) => {
        this.receivedEvents.push({
          type: 'connected',
          timestamp: Date.now(),
        });
        console.log(`[WebSocket] Server confirmation: ${data.message}`);
      });
    });
  }

  /**
   * Subscribe to execution updates
   * Note: Backend doesn't send a callback response, it just joins the room
   */
  async subscribeToExecution(executionId: string): Promise<void> {
    if (!this.socket || !this.socket.connected) {
      throw new Error('Socket not connected');
    }

    // Backend handler expects { sessionId, executionId } and doesn't send a callback
    // It just joins the room, so we emit and assume success
    this.socket.emit(WebSocketEvents.SUBSCRIBE_EXECUTION, {
      sessionId: this.config.sessionId,
      executionId,
    });

    console.log(`[WebSocket] Subscribed to execution ${executionId} (room: execution:${executionId})`);
    
    // Give it a moment to process
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  /**
   * Send a chat request that triggers execution
   */
  async sendChatRequest(message: string): Promise<{ executionId?: string; success: boolean }> {
    try {
      const response = await axios.post(
        `${this.config.baseUrl}/api/dotbot/chat`,
        {
          message,
          sessionId: this.config.sessionId,
          wallet: this.config.wallet,
          environment: 'testnet',
          network: 'westend',
        },
        {
          timeout: 120000, // 2 minutes - enough for RPC connection and simulation
          validateStatus: () => true,
        }
      );

      if (response.status !== 200) {
        throw new Error(`Chat request failed: ${response.status} - ${JSON.stringify(response.data)}`);
      }

      const result = response.data.result;
      this.executionId = result.executionId;

      console.log(`[Chat] Execution ID: ${this.executionId}`);
      console.log(`[Chat] Has plan: ${!!result.plan}`);
      console.log(`[Chat] Steps: ${result.plan?.steps?.length || 0}`);

      return {
        executionId: result.executionId,
        success: result.success,
      };
    } catch (error: any) {
      console.error('[Chat] Error:', error.message);
      throw error;
    }
  }

  /**
   * Wait for execution update events
   */
  async waitForExecutionUpdate(
    executionId: string,
    timeout: number = 30000
  ): Promise<WebSocketEvent | null> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const checkInterval = setInterval(() => {
        // Check if we received an update for this execution
        const update = this.receivedEvents.find(
          (e) => e.type === 'execution-update' && e.executionId === executionId
        );

        if (update) {
          clearInterval(checkInterval);
          resolve(update);
          return;
        }

        // Check timeout
        if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval);
          resolve(null);
        }
      }, 100);
    });
  }

  /**
   * Wait for multiple execution updates
   */
  async waitForExecutionUpdates(
    executionId: string,
    minCount: number = 1,
    timeout: number = 60000
  ): Promise<WebSocketEvent[]> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const checkInterval = setInterval(() => {
        const updates = this.receivedEvents.filter(
          (e) => e.type === 'execution-update' && e.executionId === executionId
        );

        if (updates.length >= minCount || Date.now() - startTime > timeout) {
          clearInterval(checkInterval);
          resolve(updates);
        }
      }, 100);
    });
  }

  /**
   * Get all received events
   */
  getReceivedEvents(): WebSocketEvent[] {
    return [...this.receivedEvents];
  }

  /**
   * Clear received events
   */
  clearEvents(): void {
    this.receivedEvents = [];
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  /**
   * Run the full test suite
   */
  async runTests(): Promise<{ passed: number; failed: number; results: Array<{ name: string; status: 'pass' | 'fail'; error?: string }> }> {
    const results: Array<{ name: string; status: 'pass' | 'fail'; error?: string }> = [];

    try {
      // Test 1: Connect to WebSocket
      console.log('\n[Test 1] Connecting to WebSocket server...');
      try {
        await this.connect();
        results.push({ name: 'WebSocket connection', status: 'pass' });
        console.log('✅ WebSocket connected');
      } catch (error: any) {
        results.push({ name: 'WebSocket connection', status: 'fail', error: error.message });
        console.log(`❌ WebSocket connection failed: ${error.message}`);
        return { passed: 0, failed: 1, results };
      }

      // Test 2: Send chat request that triggers execution
      console.log('\n[Test 2] Sending chat request...');
      let chatResult;
      try {
        chatResult = await this.sendChatRequest('Send 0.01 WND to 5GdbP1xdw4oNNPuKMjvMykd5xgN74z1APCGBtgYF2Tu8CTtT');
        if (chatResult.executionId) {
          results.push({ name: 'Chat request with execution', status: 'pass' });
          console.log('✅ Chat request successful, execution ID:', chatResult.executionId);
        } else {
          results.push({ name: 'Chat request with execution', status: 'fail', error: 'No execution ID returned' });
          console.log('❌ Chat request did not return execution ID');
          return { passed: 1, failed: 1, results };
        }
      } catch (error: any) {
        results.push({ name: 'Chat request with execution', status: 'fail', error: error.message });
        console.log(`❌ Chat request failed: ${error.message}`);
        return { passed: 1, failed: 1, results };
      }

      // Test 3: Subscribe to execution updates
      console.log('\n[Test 3] Subscribing to execution updates...');
      try {
        await this.subscribeToExecution(chatResult.executionId!);
        results.push({ name: 'Subscribe to execution', status: 'pass' });
        console.log('✅ Subscribed to execution updates');
      } catch (error: any) {
        results.push({ name: 'Subscribe to execution', status: 'fail', error: error.message });
        console.log(`❌ Subscribe failed: ${error.message}`);
        return { passed: 2, failed: 1, results };
      }

      // Test 4: Wait for execution update events
      console.log('\n[Test 4] Waiting for execution update events...');
      try {
        const updates = await this.waitForExecutionUpdates(chatResult.executionId!, 1, 60000);
        if (updates.length > 0) {
          results.push({ name: 'Receive execution updates', status: 'pass' });
          console.log(`✅ Received ${updates.length} execution update(s)`);
          console.log(`   First update: ${JSON.stringify(updates[0].state?.items?.length || 0)} items`);
        } else {
          results.push({ name: 'Receive execution updates', status: 'fail', error: 'No updates received' });
          console.log('❌ No execution updates received');
          return { passed: 3, failed: 1, results };
        }
      } catch (error: any) {
        results.push({ name: 'Receive execution updates', status: 'fail', error: error.message });
        console.log(`❌ Error waiting for updates: ${error.message}`);
        return { passed: 3, failed: 1, results };
      }

      // Test 5: Verify update contains expected data
      console.log('\n[Test 5] Verifying update data structure...');
      try {
        const updates = this.receivedEvents.filter(
          (e) => e.type === 'execution-update' && e.executionId === chatResult.executionId
        );
        const firstUpdate = updates[0];
        
        if (!firstUpdate || !firstUpdate.state) {
          throw new Error('Update missing state');
        }

        const state = firstUpdate.state;
        const hasItems = Array.isArray(state.items);
        const hasExecutionId = state.id === chatResult.executionId;

        if (hasItems && hasExecutionId) {
          results.push({ name: 'Update data structure', status: 'pass' });
          console.log('✅ Update data structure is valid');
          console.log(`   Items: ${state.items.length}`);
          console.log(`   Is executing: ${state.isExecuting}`);
        } else {
          throw new Error(`Invalid state structure: hasItems=${hasItems}, hasExecutionId=${hasExecutionId}`);
        }
      } catch (error: any) {
        results.push({ name: 'Update data structure', status: 'fail', error: error.message });
        console.log(`❌ Update data structure invalid: ${error.message}`);
        return { passed: 4, failed: 1, results };
      }

      // All tests passed
      return { passed: 5, failed: 0, results };
    } catch (error: any) {
      console.error('[Test] Unexpected error:', error);
      return { passed: results.filter(r => r.status === 'pass').length, failed: results.filter(r => r.status === 'fail').length, results };
    } finally {
      this.disconnect();
    }
  }
}

// Run tests if executed directly
if (require.main === module) {
  const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:8000';
  const wsUrl = process.env.TEST_WS_URL || 'http://localhost:8000';
  const sessionId = process.env.TEST_SESSION_ID || `test-session-${Date.now()}`;
  
  // Use a test wallet address
  const wallet = {
    address: '5FRPxqwZaqh5uoYBD8U5VYpEYmhZYyKjVnRe5JBVyyzVMxqk',
    name: 'Test Wallet',
    source: 'test',
  };

  // First, create a session
  async function createSession() {
    try {
      const response = await axios.post(
        `${baseUrl}/api/dotbot/session`,
        {
          sessionId,
          wallet,
          environment: 'testnet',
          network: 'westend',
        },
        {
          timeout: 30000,
          validateStatus: () => true,
        }
      );

      if (response.status !== 200) {
        throw new Error(`Failed to create session: ${response.status} - ${JSON.stringify(response.data)}`);
      }

      console.log(`[Setup] Session created: ${sessionId}`);
      return sessionId;
    } catch (error: any) {
      console.error('[Setup] Failed to create session:', error.message);
      throw error;
    }
  }

  async function run() {
    try {
      await createSession();

      const test = new WebSocketIntegrationTest({
        baseUrl,
        wsUrl,
        sessionId,
        wallet,
      });

      const result = await test.runTests();

      console.log('\n' + '='.repeat(60));
      console.log('Test Results:');
      console.log('='.repeat(60));
      result.results.forEach((r) => {
        const icon = r.status === 'pass' ? '✅' : '❌';
        console.log(`${icon} ${r.name}`);
        if (r.error) {
          console.log(`   Error: ${r.error}`);
        }
      });
      console.log('='.repeat(60));
      console.log(`Passed: ${result.passed}`);
      console.log(`Failed: ${result.failed}`);
      console.log(`Total: ${result.results.length}`);
      console.log('='.repeat(60));

      if (result.failed > 0) {
        console.log('\n❌ Some tests failed. This indicates a backend WebSocket issue.');
        process.exit(1);
      } else {
        console.log('\n✅ All WebSocket integration tests passed!');
        process.exit(0);
      }
    } catch (error: any) {
      console.error('\n❌ Test runner error:', error);
      process.exit(1);
    }
  }

  run();
}

export default WebSocketIntegrationTest;
