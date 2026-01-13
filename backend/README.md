# DotBot Backend

DotBot Backend API - AI-powered Polkadot blockchain operations through natural language.

## Overview

The DotBot backend provides a REST API for:
- Chat interactions with AI (via `/api/chat`)
- Full DotBot functionality with blockchain operations (via `/api/dotbot`)
- Session management for DotBot instances

All AI communication happens on the backend where API keys are securely stored.

## Quick Start

### Development with Mock Server (Recommended)

The mock server allows frontend development without needing a fully functional backend:

```bash
# Install dependencies
npm install

# Start mock server
npm run mock
```

The mock server will start on http://localhost:8000 and provide realistic responses based on the OpenAPI spec.

### Development with Real Backend

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env and add your API keys
# ANTHROPIC_API_KEY=your-key-here
# OPENAI_API_KEY=your-key-here

# Start development server
npm run dev
```

## Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build production bundle
- `npm start` - Start production server
- `npm test` - Run tests
- `npm run type-check` - Type check without emitting
- `npm run mock` - Start Prism mock server
- `npm run mock:verbose` - Start mock server with debug logging

## Testing the API

### Quick Test

```bash
# Test health endpoint
curl http://localhost:8000/api/health
```

### Comprehensive Test

Run the full test suite:

```bash
./test-mock-api.sh
```

This tests all endpoints and provides colored output showing which endpoints are working.

## API Documentation

See [openapi.yaml](./openapi.yaml) for the complete API specification.

Key endpoints:

### Health & Status
- `GET /hello` - Hello World
- `GET /api/health` - Health check
- `GET /api/status` - Detailed status

### Simple Chat
- `POST /api/chat` - Send chat message
- `GET /api/chat/providers` - Get available AI providers

### DotBot Operations
- `POST /api/dotbot/chat` - Send DotBot message
- `POST /api/dotbot/session` - Create/get session
- `GET /api/dotbot/session/{sessionId}` - Get session info
- `DELETE /api/dotbot/session/{sessionId}` - Delete session

### Chat Instance Management
- `GET /api/dotbot/session/{sessionId}/chats` - List chats
- `GET /api/dotbot/session/{sessionId}/chats/{chatId}` - Get chat
- `DELETE /api/dotbot/session/{sessionId}/chats/{chatId}` - Delete chat
- `POST /api/dotbot/session/{sessionId}/chats/{chatId}/load` - Load chat

### Execution Management
- `POST /api/dotbot/session/{sessionId}/execution/{executionId}/start` - Start
- `GET /api/dotbot/session/{sessionId}/execution/{executionId}` - Get state
- `POST /api/dotbot/session/{sessionId}/execution/{executionId}/approve` - Approve
- `POST /api/dotbot/session/{sessionId}/execution/{executionId}/reject` - Reject

## Architecture

```
backend/
├── src/
│   └── index.ts              # Main Express server
├── openapi.yaml              # API specification
├── .env.example              # Environment template
├── package.json
├── tsconfig.json
├── MOCK_SERVER.md            # Mock server documentation
├── test-mock-api.sh          # API test script
└── README.md                 # This file
```

## Environment Variables

Required for production:

```env
# AI Provider API Keys
ANTHROPIC_API_KEY=your-anthropic-key
OPENAI_API_KEY=your-openai-key
ASI_ONE_API_KEY=your-asi-one-key

# Server Configuration
PORT=8000
NODE_ENV=development

# CORS Configuration
ALLOWED_ORIGINS=http://localhost:3000
```

## Frontend Integration

The frontend is already configured to work with the backend:

```typescript
// Default URLs (in frontend .env)
REACT_APP_BACKEND_URL=http://localhost:8000
REACT_APP_API_URL=http://localhost:8000
```

## Development Workflow

### Using Mock Server (No Backend Implementation Needed)

1. Start mock server: `npm run mock`
2. Start frontend: `cd ../frontend && npm start`
3. Frontend makes API calls → mock server responds with realistic data
4. All state is managed client-side (localStorage)

### Using Real Backend (Full Implementation)

1. Configure `.env` with API keys
2. Start backend: `npm run dev`
3. Start frontend: `cd ../frontend && npm start`
4. Backend handles AI communication, session management, etc.

## Shared Libraries

The backend imports from shared libraries:

- `@dotbot/core` - Shared blockchain logic (`../lib/dotbot-core`)
- `@dotbot/express` - Express routes and middleware (`../lib/dotbot-express`)

These are local TypeScript packages that are also used by the frontend.

## Mock Server Details

The mock server uses [Prism](https://stoplight.io/open-source/prism) to generate responses from the OpenAPI spec.

**Features:**
- Dynamic example generation based on schemas
- Request validation
- CORS enabled by default
- No state persistence (stateless)

**Limitations:**
- No business logic
- No AI responses
- No blockchain operations
- Frontend must handle all state

See [MOCK_SERVER.md](./MOCK_SERVER.md) for detailed documentation.

## Migration Status

The DotBot project is currently migrating to a backend architecture:

- ✅ Backend structure created
- ✅ OpenAPI spec complete
- ✅ Mock server operational
- ✅ `@dotbot/core` extracted as shared library
- ✅ `@dotbot/express` wrapper created
- ⏳ Backend implementation in progress
- ⏳ PostgreSQL database integration (planned)

Currently, the frontend stores all data in localStorage. The backend will eventually handle:
- Session management (Redis/PostgreSQL)
- Chat history (PostgreSQL)
- Execution state tracking
- AI provider management

## Contributing

1. Review the OpenAPI spec in `openapi.yaml`
2. Implement endpoints in `@dotbot/express`
3. Use `@dotbot/core` for blockchain operations
4. Test with the mock server first
5. Add integration tests

## License

GNU General Public License v3.0

## Resources

- [Architecture Documentation](../docs/ARCHITECTURE.md)
- [OpenAPI Specification](./openapi.yaml)
- [Prism Documentation](https://docs.stoplight.io/docs/prism)
- [DotBot Core](../lib/dotbot-core)
- [DotBot Express](../lib/dotbot-express)
