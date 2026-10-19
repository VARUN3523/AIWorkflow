# ==============================================================================
# Production Dockerfile for B2B AI Workflow Automation SaaS
# Node.js v26 runtime with native SQLite (DatabaseSync)
# ==============================================================================

FROM node:26-alpine AS runner

# Set working directory
WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DATABASE_PATH=/app/data/saas.db

# Install dependencies (utilizing package-lock for reproducible builds)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source and public assets
COPY src/ ./src/
COPY public/ ./public/
COPY server.js ./

# Create data directory and define volume for SQLite persistence
RUN mkdir -p /app/data
VOLUME ["/app/data"]

# Expose HTTP port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start SaaS application
CMD ["node", "server.js"]
