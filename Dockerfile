FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install --production

# Copy bot code
COPY bot.js ./

# Start bot
CMD ["node", "bot.js"]

