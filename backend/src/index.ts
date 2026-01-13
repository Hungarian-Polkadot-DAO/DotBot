/**
 * DotBot Backend Server
 * Provides API endpoints to use DotBot
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { chatRouter, errorHandler, notFoundHandler, requestLogger } from '@dotbot/express';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;
const NODE_ENV = process.env.NODE_ENV || 'development';

/**
 * Middleware configuration
 */
app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(',') || '*',
  credentials: true
}));
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
});
