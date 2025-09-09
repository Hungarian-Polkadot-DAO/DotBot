# ASI-One Integration for DotBot

This document describes the Fetch.ai ASI-One integration implemented in DotBot, designed to provide AI-powered chat functionality for the Polkadot ecosystem.

## Overview

The ASI-One integration enables DotBot to have intelligent conversations with users about Polkadot operations, using Fetch.ai's ASI-One API. The implementation is modular and designed to work in the frontend initially, with easy migration to backend services.

## Architecture

### Core Components

1. **ASIOneService** (`asiOneService.ts`)
   - Handles direct communication with ASI-One API
   - Manages conversation history in localStorage
   - Provides fallback responses when API is unavailable
   - Designed as a singleton for easy access

2. **AgentCommunicationService** (`agentCommunication.ts`)
   - Routes messages to appropriate agents
   - Integrates ASI-One service with existing agent system
   - Provides contextual responses based on agent type
   - Manages conversation flow and suggestions

3. **App Integration** (`App.tsx`)
   - Updated to use ASI-One service instead of mock responses
   - Maintains existing UI/UX while adding AI capabilities
   - Handles error states and fallbacks gracefully

## Features

### ✅ Implemented Features

- **AI-Powered Responses**: Real-time AI responses using ASI-One API
- **Conversation Memory**: Persistent chat history using localStorage
- **Agent Routing**: Intelligent routing to specialized agents (Asset Transfer, Swap, Governance, Multisig)
- **Context Awareness**: Maintains conversation context and user wallet information
- **Fallback Handling**: Graceful degradation when API is unavailable
- **Modular Design**: Easy to move from frontend to backend
- **Logging**: Comprehensive logging for debugging and monitoring

### 🔄 Future Enhancements

- **Backend Migration**: Move ASI-One service to backend for better security
- **Advanced Context**: Include more wallet and transaction context
- **Streaming Responses**: Real-time streaming of AI responses
- **Multi-Model Support**: Support for different ASI-One models
- **Caching**: Response caching for improved performance

## Configuration

### Environment Variables

Create a `.env.local` file in the frontend directory:

```env
# === ASI-ONE INTEGRATION (CRITICAL) ===
REACT_APP_ASI_ONE_API_URL=https://api.asi1.ai/v1/chat/completions
REACT_APP_ASI_ONE_API_KEY=sk_55aa3a95dcd341c6a2e13a4244e612f550f0520ca67342d88e0ad81812909ad5
REACT_APP_ASI_ONE_BASE_URL=https://api.asi1.ai/v1
REACT_APP_ASI_ONE_MAX_TOKENS=2048

# Application Configuration
REACT_APP_DEBUG=true
REACT_APP_LOG_LEVEL=INFO
```

### API Key Setup

The working API key is already configured in the code as a fallback. To use your own key:

1. Create a `.env.local` file in the frontend directory
2. Add your API key: `REACT_APP_ASI_ONE_API_KEY=your_key_here`
3. Restart the development server

**Note**: The integration will work immediately with the provided API key, no additional setup required!

## Usage

### Basic Usage

The integration is automatically active when you start the application. Users can:

1. **Start a conversation**: Type any message in the chat interface
2. **Ask about Polkadot operations**: "Send 5 DOT to Alice", "Check my balance", etc.
3. **Get AI assistance**: The system will route to appropriate agents and provide intelligent responses

### Programmatic Usage

```typescript
import { getASIOneService } from './services/asiOneService';
import { AgentCommunicationService } from './services/agentCommunication';

// Get ASI-One service
const asiOneService = getASIOneService();

// Send a message
const response = await asiOneService.sendMessage("Check my DOT balance", {
  walletAddress: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
  network: "Polkadot"
});

// Use agent communication service
const agentService = new AgentCommunicationService();
const agentResponse = await agentService.sendToAgent({
  agentId: "asset-transfer",
  message: "Send 1 DOT to Alice",
  context: {
    conversationId: "conv_123",
    userWallet: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"
  }
});
```

## Agent Types

### Asset Transfer Agent
- **ID**: `asset-transfer`
- **Purpose**: Handles DOT and token transfers
- **Example**: "Send 5 DOT to Alice", "Transfer 100 DOT to AssetHub"

### Asset Swap Agent
- **ID**: `asset-swap`
- **Purpose**: Facilitates token swaps across DEXs
- **Example**: "Swap DOT for USDC", "Find best price for DOT/USDT"

### Governance Agent
- **ID**: `governance`
- **Purpose**: Manages voting and governance participation
- **Example**: "Vote YES on referendum #123", "Show active referendums"

### Multisig Agent
- **ID**: `multisig`
- **Purpose**: Coordinates multisig operations
- **Example**: "Create 2-of-3 multisig", "Sign pending transaction"

## Conversation Management

### Starting New Conversations

```typescript
// Start a new conversation
agentService.startNewConversation();

// Or directly with ASI-One service
asiOneService.startNewConversation();
```

### Managing History

```typescript
// Get conversation history
const history = agentService.getConversationHistory();

// Clear conversation history
agentService.clearConversationHistory();
```

## Error Handling

The integration includes comprehensive error handling:

1. **API Errors**: Graceful fallback to local responses
2. **Network Issues**: Retry logic and user-friendly error messages
3. **Invalid Responses**: Validation and fallback responses
4. **Rate Limiting**: Proper handling of API rate limits

## Migration to Backend

The modular design makes it easy to move the ASI-One integration to the backend:

### Current Frontend Structure
```
frontend/src/services/
├── asiOneService.ts          # ASI-One API client
├── agentCommunication.ts     # Agent routing and management
└── README_ASI_ONE_INTEGRATION.md
```

### Backend Migration Plan
```
backend/services/
├── asi_one_service.py        # Python ASI-One service
├── agent_communication.py    # Agent management
└── conversation_memory.py    # Database-backed memory
```

### Migration Steps
1. Move `asiOneService.ts` logic to Python backend service
2. Update `agentCommunication.ts` to call backend endpoints
3. Replace localStorage with database storage
4. Add authentication and rate limiting
5. Update frontend to use backend API

## Testing

### Manual Testing
1. Start the application: `npm start`
2. Open browser to `http://localhost:3000`
3. Try various Polkadot-related queries
4. Check browser console for logs
5. Verify conversation persistence on page refresh

### API Testing
```typescript
// Test ASI-One connectivity
const isConnected = await asiOneService.testConnection();
console.log('ASI-One connected:', isConnected);

// Test agent availability
const availability = await agentService.checkAgentAvailability();
console.log('Agent availability:', availability);
```

## Troubleshooting

### Common Issues

1. **API Key Not Working**
   - Verify API key is correct
   - Check if key has proper permissions
   - Ensure key is in `.env` file

2. **No Responses**
   - Check browser console for errors
   - Verify network connectivity
   - Check ASI-One service status

3. **Conversation Not Persisting**
   - Check localStorage is enabled
   - Verify conversation ID generation
   - Check for storage quota issues

### Debug Mode

Enable debug logging by setting:
```env
REACT_APP_DEBUG=true
REACT_APP_LOG_LEVEL=DEBUG
```

## Security Considerations

### Current Implementation (Frontend)
- API key stored in environment variables
- Conversation history in localStorage
- No server-side validation

### Backend Migration Benefits
- API key stored securely on server
- Database-backed conversation storage
- Server-side validation and sanitization
- Rate limiting and abuse prevention

## Performance

### Current Optimizations
- Conversation history limited to last 10 messages
- Singleton service pattern
- Efficient localStorage usage
- Error caching and fallbacks

### Future Optimizations
- Response caching
- Streaming responses
- Background conversation processing
- CDN integration

## Contributing

When contributing to the ASI-One integration:

1. Follow existing code patterns
2. Add comprehensive logging
3. Include error handling
4. Update this documentation
5. Test with various scenarios

## Support

For issues related to ASI-One integration:
1. Check this documentation
2. Review browser console logs
3. Test with different API keys
4. Verify network connectivity
5. Check ASI-One service status

---

**Note**: This integration is designed to be easily moved to the backend. The modular architecture ensures minimal changes when migrating from frontend to backend implementation.
