FROM node:20-alpine

WORKDIR /app

# Copy shared library first
COPY lib/ ./lib/

# Copy backend package files
COPY backend/package*.json ./backend/
COPY backend/tsconfig.json ./backend/

# Install backend dependencies
WORKDIR /app/backend
RUN npm ci --only=production

# Copy backend source
COPY backend/src ./src

# Build TypeScript
RUN npm run build

# Expose port
EXPOSE 8000

# Start the server
CMD ["npm", "start"]
