/**
 * DotBot Backend Server
 * Provides API endpoints to use DotBot with WebSocket support
 */

import { createServer } from 'http';
import app from './app';
import { exec } from 'child_process';
import { promisify } from 'util';
import { WebSocketManager } from '@dotbot/express';
import { initFileStorage, validateAndReport } from '@dotbot/core';
import path from 'path';
import fs from 'fs';

const execAsync = promisify(exec);

// Validate environment configuration before starting
validateAndReport();

const PORT = process.env.PORT || 8000;

const STORAGE_DIR = process.env.STORAGE_DIR || path.join(path.resolve(__dirname, '../..'), 'data', 'storage');

try {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  initFileStorage(STORAGE_DIR);
  console.log(`[Server] FileStorage initialized at: ${STORAGE_DIR}`);
} catch (error) {
  console.error('[Server] Failed to initialize FileStorage, using MemoryStorage:', error);
}

// Create HTTP server (needed for Socket.IO)
const httpServer = createServer(app);

// Initialize WebSocket Manager
const wsManager = new WebSocketManager({
  httpServer,
  corsOrigins: process.env.CORS_ORIGINS || '*',
  path: '/socket.io'
});

app.locals.wsManager = wsManager;

/**
 * Find process ID using the specified port
 */
async function findProcessOnPort(port: number): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`lsof -ti:${port}`);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Kill process by PID
 */
async function killProcess(pid: string): Promise<void> {
  await execAsync(`kill -9 ${pid}`);
  // Wait for port to be released
  await new Promise(resolve => setTimeout(resolve, 1000));
}

/**
 * Find and kill process using the specified port
 */
async function killProcessOnPort(port: number): Promise<boolean> {
  const pid = await findProcessOnPort(port);
  
  if (!pid) {
    return false;
  }
  
  try {
    console.log(`[Server] Found process ${pid} using port ${port}, attempting to kill...`);
    await killProcess(pid);
    return true;
  } catch (error) {
    console.warn(`[Server] Failed to kill process ${pid}:`, error);
    return false;
  }
}

/**
 * Log server startup information
 */
function logServerStartup(port: number): void {
  const env = process.env.NODE_ENV || 'development';
  console.log('[Server] DotBot backend server started');
  console.log(`[Server] Environment: ${env}`);
  console.log(`[Server] Port: ${port}`);
  console.log(`[Server] Health check: http://localhost:${port}/api/health`);
  console.log(`[Server] Chat endpoint: http://localhost:${port}/api/chat`);
  console.log(`[Server] DotBot endpoint: http://localhost:${port}/api/dotbot/chat`);
  console.log(`[Server] WebSocket endpoint: ws://localhost:${port}/socket.io`);
}

/**
 * Handle port in use error
 */
async function handlePortInUse(
  port: number,
  maxRetries: number,
  resolve: () => void,
  reject: (error: Error) => void
): Promise<void> {
  console.log(`[Server] Port ${port} is already in use`);
  
  const killed = await killProcessOnPort(port);
  
  if (killed) {
    console.log(`[Server] Process killed, retrying on port ${port}...`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    startServer(port, maxRetries - 1).then(resolve).catch(reject);
  } else {
    const nextPort = port + 1;
    console.log(`[Server] Trying next available port: ${nextPort}`);
    startServer(nextPort, maxRetries - 1).then(resolve).catch(reject);
  }
}

/**
 * Try to start server on a port, with fallback to next available port
 */
async function startServer(port: number, maxRetries: number = 10): Promise<void> {
  if (maxRetries <= 0) {
    throw new Error('Failed to start server: maximum retries exceeded');
  }

  return new Promise((resolve, reject) => {
    const server = httpServer.listen(port, () => {
      logServerStartup(port);
      resolve();
    });

    server.on('error', async (error: NodeJS.ErrnoException) => {
      server.close();
      
      if (error.code === 'EADDRINUSE') {
        await handlePortInUse(port, maxRetries, resolve, reject);
      } else {
        reject(error);
      }
    });
  });
}

/**
 * Start server
 */
startServer(Number(PORT)).catch((error) => {
  console.error('[Server] Failed to start server:', error);
  process.exit(1);
});
