/**
 * DotBot Backend Server
 * Provides API endpoints to use DotBot with WebSocket support
 */

import { createServer } from 'http';
import app from './app';
import { exec } from 'child_process';
import { promisify } from 'util';
import { WebSocketManager } from '@dotbot/express';
import { initFileStorage } from '@dotbot/core';
import path from 'path';
import fs from 'fs';

const execAsync = promisify(exec);

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
 * Find and kill process using the specified port
 */
async function killProcessOnPort(port: number): Promise<boolean> {
  try {
    // Find process using the port
    const { stdout } = await execAsync(`lsof -ti:${port}`);
    const pid = stdout.trim();
    
    if (pid) {
      console.log(`[Server] Found process ${pid} using port ${port}, attempting to kill...`);
      await execAsync(`kill -9 ${pid}`);
      // Wait a bit for the port to be released
      await new Promise(resolve => setTimeout(resolve, 1000));
      return true;
    }
    return false;
  } catch (error) {
    // No process found or error killing it
    return false;
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
      console.log('[Server] DotBot backend server started');
      console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`[Server] Port: ${port}`);
      console.log(`[Server] Health check: http://localhost:${port}/api/health`);
      console.log(`[Server] Chat endpoint: http://localhost:${port}/api/chat`);
      console.log(`[Server] DotBot endpoint: http://localhost:${port}/api/dotbot/chat`);
      console.log(`[Server] WebSocket endpoint: ws://localhost:${port}/socket.io`);
      resolve();
    });

    server.on('error', async (error: NodeJS.ErrnoException) => {
      // Close the server instance that failed to listen
      server.close();
      
      if (error.code === 'EADDRINUSE') {
        console.log(`[Server] Port ${port} is already in use`);
        
        // Try to kill the process on the port
        const killed = await killProcessOnPort(port);
        
        if (killed) {
          console.log(`[Server] Process killed, retrying on port ${port}...`);
          // Wait a bit longer for the port to be fully released
          await new Promise(resolve => setTimeout(resolve, 1000));
          // Retry on the same port
          startServer(port, maxRetries - 1).then(resolve).catch(reject);
        } else {
          // Try next available port
          const nextPort = port + 1;
          console.log(`[Server] Trying next available port: ${nextPort}`);
          startServer(nextPort, maxRetries - 1).then(resolve).catch(reject);
        }
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
