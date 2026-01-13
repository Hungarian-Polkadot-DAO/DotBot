# DotBot Backend

API gateway for AI-powered blockchain operations on Polkadot ecosystem.

## Architecture

### Directory Structure

```
backend/
├── lib/
│   ├── dotbot-core/          # Core blockchain logic (@dotbot/core)
│   │   ├── agents/           # Blockchain agents (transfer, staking, governance)
│   │   ├── executionEngine/  # Transaction execution system
│   │   ├── services/         # AI services, RPC management, storage
│   │   └── prompts/          # LLM system prompts and knowledge
│   └── dotbot-express/       # Express integration (@dotbot/express)
│       ├── routes/           # API routes
│       └── middleware/       # Express middleware
└── src/
    └── index.ts              # Main server entry point
```

### Libraries

#### @dotbot/core

Core library containing blockchain operations, AI services, and execution engine. Designed to work in both browser and Node.js environments.

**Key Components:**
- **Agents**: Create production-safe extrinsics for blockchain operations
- **Execution Engine**: Execute, sign, and broadcast transactions
- **AI Services**: ASI-One and Claude provider integrations
- **RPC Manager**: Multi-endpoint management with health monitoring

#### @dotbot/express

Express.js integration layer providing HTTP API for DotBot operations.

**Features:**
- RESTful API routes for chat and blockchain operations
- Request logging and error handling middleware
- Secure API key management on server-side

## Environment Variables

See `.env.example` for configuration options:

### Required
- `ASI_ONE_API_KEY` - API key for ASI-One service
- `CLAUDE_API_KEY` - API key for Claude service (if using Claude provider)

### Optional
- `PORT` - Server port (default: 8000)
- `NODE_ENV` - Environment (development/production)
- `CORS_ORIGINS` - Allowed CORS origins (comma-separated)
- `AI_PROVIDER` - Default AI provider (asi-one/claude)

## Development

### Install Dependencies

```bash
npm install
```

### Run Development Server

```bash
npm run dev
```

Server will start on http://localhost:8000

### Build for Production

```bash
npm run build
npm start
```

### Type Checking

```bash
npm run type-check
```

## API Endpoints

### Health Check
```
GET /api/health
```

Returns server status and environment information.

### Chat
```
POST /api/chat
Content-Type: application/json

{
  "message": "Transfer 10 DOT to Alice",
  "context": {},
  "provider": "asi-one"  // optional
}
```

Returns AI-powered response for blockchain operations.

### Available Providers
```
GET /api/chat/providers
```

Lists available AI providers.

## Docker

### Build Image

```bash
docker build -t dotbot-backend .
```

### Run Container

```bash
docker run -p 8000:8000 \
  -e ASI_ONE_API_KEY=your_key \
  -e NODE_ENV=production \
  dotbot-backend
```

## Future Migration to NPM Packages

The `lib/` folder contains code that will eventually be published as npm packages:

- `lib/dotbot-core` → `@dotbot/core`
- `lib/dotbot-express` → `@dotbot/express`

For now, they are maintained as part of the monorepo for rapid development.

## License

GNU General Public License v3.0
