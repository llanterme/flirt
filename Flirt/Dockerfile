# Flirt Hair & Beauty - Production Dockerfile for Railway.app
FROM node:18-alpine

# Install SQLite3 and other necessary packages
RUN apk add --no-cache sqlite python3 make g++

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy app source
COPY . .

# Create directory for SQLite database with proper permissions
RUN mkdir -p /app/data && \
    chmod 755 /app/data

# Initialize database on build (optional - can be done at runtime)
RUN npm run db:init || echo "Database initialization will happen at runtime"

# Create a non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S flirt -u 1001 && \
    chown -R flirt:nodejs /app

USER flirt

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Start the application
CMD ["npm", "start"]