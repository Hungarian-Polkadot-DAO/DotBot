# DotBot Logging System Setup - Hello World

This document explains the logging system setup for both the TypeScript frontend and Python backend.

## 🎯 What We've Implemented

### Frontend (TypeScript + Pino)
- **Location**: `frontend/src/config/logger.ts` and `frontend/src/types/logging.ts`
- **Library**: Pino (browser-compatible structured logging)
- **Features**: 
  - Subsystem-based logging (APP, CHAT, SIDEBAR, etc.)
  - Structured logging with context
  - Browser-optimized output
  - Error type classification

### Backend (Python + Structlog)
- **Location**: `backend/config/logger.py` and `backend/types/logging.py`
- **Library**: Structlog (structured logging for Python)
- **Features**:
  - Colored console output in development
  - JSON output in production
  - Subsystem-based logging (APP, API, MEMORY, etc.)
  - Error type classification

## 🚀 Installation & Testing

### Step 1: Install Dependencies

#### Frontend
```bash
cd frontend
npm install
# This will install pino which we added to package.json
```

#### Backend
```bash
cd backend
pip install -r requirements.txt
# This will install structlog and colorama
```

### Step 2: Test the Logging Systems

#### Test Backend Logging
```bash
# From the project root
python test_logging.py
```

This will show colored, structured logging output demonstrating:
- Different log levels (debug, info, warning, error)
- Different subsystems (app, api, memory)
- Structured context data
- Error type classification

#### Test Frontend Logging
```bash
cd frontend
npm start
```

Open the browser console to see:
- Application startup logs
- Session loading logs
- Structured logging with context

## 📝 Usage Examples

### Frontend (TypeScript)
```typescript
import { createSubsystemLogger } from './config/logger';
import { Subsystem, ErrorType } from './types/logging';

const logger = createSubsystemLogger(Subsystem.CHAT);

// Simple logging
logger.info("User sent message");

// Structured logging
logger.info("Message processed", { 
  messageId: "msg_123", 
  userId: "user_456",
  duration: 150 
});

// Error logging with type
import { logError } from './config/logger';
logError(logger, 
  { messageId: "msg_123", error: "timeout" }, 
  "Failed to send message to agent", 
  ErrorType.AGENT_TIMEOUT
);
```

### Backend (Python)
```python
from config.logger import create_subsystem_logger, log_error
from types.logging import Subsystem, ErrorType

logger = create_subsystem_logger(Subsystem.API)

# Simple logging
logger.info("API endpoint called")

# Structured logging
logger.info("Request processed", 
           endpoint="/api/chat", 
           method="POST", 
           status=200,
           duration=0.15)

# Error logging with type
log_error(logger,
         {"user_id": "user_123", "request_id": "req_456"},
         "Database connection failed",
         ErrorType.DATABASE_CONNECTION)
```

## 🔧 Configuration

### Environment Variables

#### Frontend (.env)
```bash
REACT_APP_LOG_LEVEL=debug    # debug/info/warn/error
```

#### Backend (.env)
```bash
NODE_ENV=development         # development/production
LOG_LEVEL=DEBUG             # DEBUG/INFO/WARNING/ERROR
```

## 🎨 Output Examples

### Development Mode
- **Frontend**: Pretty console logs in browser DevTools
- **Backend**: Colored console output with timestamps

### Production Mode
- **Frontend**: Structured JSON logs
- **Backend**: JSON logs suitable for log aggregation

## 📊 Subsystems Defined

### Frontend
- `APP` - Main application
- `CHAT` - Chat interface
- `SIDEBAR` - Sidebar components
- `AGENT_COMM` - Agent communication
- `STORAGE` - Local storage operations
- `WALLET` - Wallet integration
- `POLKADOT_API` - Polkadot API calls

### Backend
- `APP` - Main application
- `API` - API endpoints
- `MEMORY` - Memory service
- `PAYMENT` - Payment service
- `AGENT_COMM` - Agent communication
- `DATABASE` - Database operations
- `HEALTH` - Health checks

## ✅ Next Steps

This is just the "Hello World" implementation. Future enhancements will include:

1. **Log Aggregation**: Integration with services like Loki or ELK stack
2. **Performance Logging**: Request timing and performance metrics
3. **User Activity Logging**: Track user interactions for analytics
4. **Error Reporting**: Integration with error tracking services
5. **Log Filtering**: Advanced filtering and search capabilities

The foundation is now in place for comprehensive logging across the entire DotBot application! 