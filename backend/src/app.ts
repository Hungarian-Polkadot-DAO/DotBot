/**
 * DotBot Backend Express App
 * Exported for testing purposes
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
// Import @dotbot/express - this automatically sets up console filters via its index.ts
import { chatRouter, dotbotRouter, errorHandler, notFoundHandler, requestLogger } from '@dotbot/express';

dotenv.config();

const app = express();
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

    // In development, always allow any localhost origin (any port) for flexibility
    if (NODE_ENV === 'development') {
      if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
        return callback(null, true);
      }
    }

    // Get allowed origins from environment variable
    const allowedOrigins = process.env.CORS_ORIGINS 
      ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
      : [];

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
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200, // Some legacy browsers (IE11, various SmartTVs) choke on 204
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

export default app;
