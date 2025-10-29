FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy bot code
COPY bot.js ./

# Run as non-root user
USER node

# Start bot
CMD ["node", "bot.js"]

