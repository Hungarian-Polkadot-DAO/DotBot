# DotBot - Project Structure

## 📁 Directory Architecture

```
DotBot/
├── agents/                           # 🤖 Standalone Fetch.ai agents (AgentVerse compatible)
│   ├── asset-transfer-agent/
│   │   ├── agent.py                  # Main agent implementation
│   │   ├── config.yaml              # AgentVerse configuration
│   │   ├── requirements.txt         # Agent dependencies
│   │   └── README.md               # Agent documentation
│   │
│   ├── asset-swap-agent/
│   │   ├── agent.py
│   │   ├── config.yaml
│   │   ├── requirements.txt
│   │   └── README.md
│   │
│   ├── governance-agent/
│   │   ├── agent.py
│   │   ├── config.yaml
│   │   ├── requirements.txt
│   │   └── README.md
│   │
│   ├── multisig-agent/
│   │   ├── agent.py
│   │   ├── config.yaml
│   │   ├── requirements.txt
│   │   └── README.md
│   │
│   └── shared/                      # Shared agent utilities
│       ├── polkadot_client.py
│       ├── wallet_interface.py
│       ├── xcm_builder.py
│       └── types.py
│
├── frontend/                        # 🖥️ React web application
│   ├── public/
│   │   ├── index.html
│   │   ├── favicon.ico
│   │   └── manifest.json
│   │
│   ├── src/
│   │   ├── components/              # UI Components
│   │   │   ├── chat/
│   │   │   │   ├── ChatInterface.tsx     # Main chat component
│   │   │   │   ├── MessageBubble.tsx     # Individual messages
│   │   │   │   ├── InputField.tsx        # Message input
│   │   │   │   ├── VoiceInput.tsx        # Voice input button
│   │   │   │   └── TypingIndicator.tsx   # Typing animation
│   │   │   │
│   │   │   ├── sidebar/
│   │   │   │   ├── Sidebar.tsx           # Left sidebar
│   │   │   │   ├── NewChatButton.tsx     # New chat button
│   │   │   │   ├── ChatHistory.tsx       # Chat history list
│   │   │   │   └── TransactionHistory.tsx # Transaction list
│   │   │   │
│   │   │   ├── quick-actions/
│   │   │   │   ├── QuickActions.tsx      # Action buttons (Balance, Transfer, Status)
│   │   │   │   ├── BalanceCard.tsx       # Balance display
│   │   │   │   ├── TransferCard.tsx      # Transfer shortcut
│   │   │   │   └── StatusCard.tsx        # Network status
│   │   │   │
│   │   │   ├── wallet/
│   │   │   │   ├── WalletConnector.tsx   # Wallet connection
│   │   │   │   ├── WalletStatus.tsx      # Connection status
│   │   │   │   ├── AccountSelector.tsx   # Account selection
│   │   │   │   └── SigningModal.tsx      # Transaction signing
│   │   │   │
│   │   │   ├── agents/
│   │   │   │   ├── AgentStatusBar.tsx    # Agent availability status
│   │   │   │   ├── AgentSelector.tsx     # Agent selection interface
│   │   │   │   ├── AgentResponse.tsx     # Agent response formatting
│   │   │   │   └── AgentThinking.tsx     # Thinking animation
│   │   │   │
│   │   │   └── common/
│   │   │       ├── LoadingSpinner.tsx
│   │   │       ├── ErrorBoundary.tsx
│   │   │       ├── NotificationToast.tsx
│   │   │       └── Layout.tsx
│   │   │
│   │   ├── services/                # Core services (work without backend)
│   │   │   ├── agentCommunication.ts     # Direct agent communication
│   │   │   ├── polkadotService.ts        # Blockchain interaction
│   │   │   ├── walletService.ts          # Wallet management
│   │   │   ├── storageService.ts         # Local storage
│   │   │   ├── voiceService.ts           # Voice input
│   │   │   └── asiOneClient.ts           # ASI-One integration
│   │   │
│   │   ├── hooks/                   # React hooks
│   │   │   ├── useChat.ts           # Chat functionality
│   │   │   ├── useAgents.ts         # Agent management
│   │   │   ├── useWallet.ts         # Wallet connection
│   │   │   ├── usePolkadot.ts       # Blockchain state
│   │   │   ├── useVoice.ts          # Voice input
│   │   │   └── useLocalStorage.ts   # Local persistence
│   │   │
│   │   ├── context/                 # React context
│   │   │   ├── AppContext.tsx       # Global app state
│   │   │   ├── ChatContext.tsx      # Chat state
│   │   │   ├── WalletContext.tsx    # Wallet state
│   │   │   └── AgentContext.tsx     # Agent state
│   │   │
│   │   ├── types/                   # TypeScript types
│   │   │   ├── chat.ts              # Chat types
│   │   │   ├── agents.ts            # Agent types
│   │   │   ├── wallet.ts            # Wallet types
│   │   │   ├── polkadot.ts          # Blockchain types
│   │   │   └── api.ts               # API types
│   │   │
│   │   ├── utils/                   # Utility functions
│   │   │   ├── formatters.ts        # Data formatting
│   │   │   ├── validators.ts        # Input validation
│   │   │   ├── constants.ts         # App constants
│   │   │   ├── helpers.ts           # General helpers
│   │   │   └── polkadotHelpers.ts   # Polkadot utilities
│   │   │
│   │   ├── styles/                  # Styling
│   │   │   ├── globals.css          # Global styles
│   │   │   ├── components.css       # Component styles
│   │   │   ├── chat.css             # Chat-specific styles
│   │   │   └── themes.css           # Theme variables
│   │   │
│   │   ├── App.tsx                  # Main app component
│   │   ├── index.tsx                # React entry point
│   │   └── setupTests.ts            # Test configuration
│   │
│   ├── package.json                 # Frontend dependencies
│   ├── tsconfig.json               # TypeScript config
│   ├── tailwind.config.js          # Tailwind CSS config
│   └── README.md                   # Frontend documentation
│
├── backend/                         # 🔧 Optional memory & payment layer
│   ├── api/
│   │   ├── main.py                  # FastAPI app
│   │   ├── dependencies.py          # Dependencies
│   │   └── middleware.py            # Middleware
│   │
│   ├── routers/
│   │   ├── memory.py               # Chat memory endpoints
│   │   ├── payments.py             # Payment processing
│   │   ├── analytics.py            # Usage analytics
│   │   └── health.py               # Health check
│   │
│   ├── services/
│   │   ├── memory_service.py       # Chat history storage
│   │   ├── payment_service.py      # Payment processing
│   │   ├── analytics_service.py    # Usage tracking
│   │   └── cache_service.py        # Caching layer
│   │
│   ├── storage/
│   │   ├── database.py             # Database config
│   │   ├── models.py               # Data models
│   │   └── repositories.py         # Data access
│   │
│   ├── config/
│   │   ├── settings.py             # App settings
│   │   └── database.py             # DB settings
│   │
│   ├── requirements.txt            # Backend dependencies
│   └── README.md                   # Backend documentation
│
├── shared/                          # 🔗 Shared types and utilities
│   ├── types/
│   │   ├── agent_messages.py/ts    # Agent communication types
│   │   ├── blockchain.py/ts        # Blockchain types
│   │   └── common.py/ts            # Common types
│   │
│   └── constants/
│       ├── networks.py/ts          # Network configurations
│       └── agents.py/ts            # Agent configurations
│
├── config/                          # 📝 Configuration files
│   ├── env.example                 # Environment template
│   ├── agent.env.example          # Agent environment template
│   └── networks.yaml              # Network configurations
│
├── docs/                           # 📚 Documentation
│   ├── ARCHITECTURE.md             # System architecture
│   ├── AGENTS.md                   # Agent documentation
│   ├── FRONTEND.md                 # Frontend guide
│   ├── DEPLOYMENT.md               # Deployment guide
│   └── API.md                      # API documentation
│
├── scripts/                        # 🛠️ Development scripts
│   ├── setup.sh                   # Project setup
│   ├── start-dev.sh               # Development server
│   ├── deploy-agents.sh           # Agent deployment
│   └── build.sh                   # Production build
│
├── docker-compose.yml              # 🐳 Development environment
├── .gitignore                      # Git ignore rules
├── README.md                       # Project overview
└── CHANGELOG.md                    # Version history
```

## 🎯 Key Architecture Principles

### 1. **Agent Independence**
- Agents are completely standalone
- Compatible with AgentVerse
- Can be accessed by any ASI-One chatbot
- No dependency on DotBot frontend/backend

### 2. **Frontend Self-Sufficiency**
- Core functionality works without backend
- Direct agent communication
- Local storage for basic persistence
- Wallet integration independent

### 3. **Optional Backend Enhancement**
- Memory service for chat history
- Payment processing for premium features
- Analytics and usage tracking
- Caching for performance

### 4. **ChatGPT-like Design Ready**
- Component structure matches provided design
- Sidebar for navigation and history
- Main chat interface with quick actions
- Agent status indicators
- Voice input support

## 🚀 Development Flow

### Without Backend (Basic Mode)
```
User Input → Frontend → Direct Agent Call → Polkadot → Wallet → Response
```

### With Backend (Enhanced Mode)
```
User Input → Frontend → Agent + Backend → Memory/Payment → Response
```
