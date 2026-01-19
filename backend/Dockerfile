# Build stage
FROM node:20-bullseye AS builder

WORKDIR /app

# Copy shared libraries first (needed for file: dependencies)
COPY lib/ ./lib/

# Build dotbot-core library first (required by backend)
# Use npm install instead of npm ci to handle file: dependencies and devDependencies
WORKDIR /app/lib/dotbot-core
RUN npm install && npm run build

# Build dotbot-express library (needed for backend TypeScript compilation)
WORKDIR /app/lib/dotbot-express
RUN npm install && npm run build || echo "No build script, skipping"

# Copy backend package files (reset WORKDIR first)
WORKDIR /app
COPY backend/package*.json ./backend/
COPY backend/tsconfig.json ./backend/

# Install backend dependencies (npm will resolve file:../lib/dotbot-core)
# Use npm install since we're in a Docker context without root package-lock.json
# Install all dependencies (including devDependencies) needed for TypeScript build
WORKDIR /app/backend
RUN npm install

# Copy backend source
COPY backend/src ./src

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-bullseye

WORKDIR /app

# Install curl for health checks
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Copy shared libraries (needed at runtime)
COPY lib/ ./lib/

# Build dotbot-core library first (must be built before backend install to avoid prepare script issues)
# Install all deps (including dev) needed for TypeScript build, then build
WORKDIR /app/lib/dotbot-core
RUN npm install && npm run build

# Build dotbot-express library (must be built before backend install)
# @polkadot/api is now in dotbot-express dependencies, so it will be installed here
WORKDIR /app/lib/dotbot-express
RUN npm install && npm run build || echo "No build script, skipping"

# Copy backend package files (needed for dependency resolution)
WORKDIR /app
COPY backend/package*.json ./backend/

# Install backend production dependencies
# dotbot-core and dotbot-express are already built, so their prepare scripts won't run
WORKDIR /app/backend
RUN npm install --omit=dev --ignore-scripts

# Copy built application from builder
COPY --from=builder /app/backend/dist ./dist

# Create data directory for persistent storage
RUN mkdir -p /app/backend/data/storage

# Expose port
EXPOSE 8000

# Define volume for persistent RPC health data
VOLUME ["/app/backend/data"]

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8000/api/health || exit 1

# Start the server
CMD ["npm", "start"]
