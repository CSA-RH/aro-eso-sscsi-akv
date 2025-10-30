FROM node:18-alpine

# Install dependencies at build time (avoids runtime npm install issues)
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production --no-audit --no-fund

# The application code will be mounted via ConfigMap at /app
# Set NODE_PATH to find node_modules
ENV NODE_PATH=/app/node_modules

# Default command (will be overridden by deployment)
CMD ["node", "--version"]

