/**
 * DotBot Backend Server
 * Provides API endpoints to use DotBot
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
// Import @dotbot/express - this automatically sets up console filters via its index.ts
import { chatRouter, dotbotRouter, errorHandler, notFoundHandler, requestLogger } from '@dotbot/express';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;
const NODE_ENV = process.env.NODE_ENV || 'development';

/**
 * Middleware configuration
 */
// CORS configuration - works for both development and production
const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      return callback(null, true);
    }

    // Get allowed origins from environment variable
    const allowedOrigins = process.env.CORS_ORIGINS 
      ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
      : [];

    // In development, always allow localhost origins
    if (NODE_ENV === 'development') {
      const localhostPatterns = [
        'http://localhost:3000',
        'http://localhost:3001',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:3001',
      ];
      
      // Add localhost patterns if not already in allowedOrigins
      localhostPatterns.forEach(pattern => {
        if (!allowedOrigins.includes(pattern)) {
          allowedOrigins.push(pattern);
        }
      });
    }

    // If CORS_ORIGINS is set to '*' or empty, allow all origins
    if (process.env.CORS_ORIGINS === '*' || allowedOrigins.length === 0) {
      return callback(null, true);
    }

    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Blocked request from origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

/**
 * API Routes
 */
app.get('/hello', (req: Request, res: Response) => {
  res.json({ 
    message: 'Hello World',
    service: 'DotBot Backend',
    version: '0.1.0'
  });
});

app.get('/api/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'ok',
    service: 'DotBot Backend',
    environment: NODE_ENV,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/status', (req: Request, res: Response) => {
  res.json({
    status: 'running',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    environment: NODE_ENV,
    timestamp: new Date().toISOString()
  });
});

// Mount chat routes
app.use('/api/chat', chatRouter);

// Mount DotBot routes (full DotBot chat with AI on backend)
app.use('/api/dotbot', dotbotRouter);

/**
 * Error handling
 */
app.use(notFoundHandler);
app.use(errorHandler);

/**
 * Start server
 */
app.listen(PORT, () => {
  console.log('[Server] DotBot backend server started');
  console.log(`[Server] Environment: ${NODE_ENV}`);
  console.log(`[Server] Port: ${PORT}`);
    console.log(`[Server] Health check: http://localhost:${PORT}/api/health`);
    console.log(`[Server] Chat endpoint: http://localhost:${PORT}/api/chat`);
    console.log(`[Server] DotBot endpoint: http://localhost:${PORT}/api/dotbot/chat`);
});
