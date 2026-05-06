# Dockerfile for Linda Agent (Multi-firm deployment)
# This file is located at the root of the pi-mono repository.

FROM node:20-slim AS builder

# Install git for pnpm to fetch git dependencies
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN npm install -g pnpm@9

WORKDIR /app

# Copy workspace configuration
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Copy package.json files for all involved packages to leverage Docker cache
COPY packages/linda-agent/package.json ./packages/linda-agent/
COPY packages/agent/package.json ./packages/agent/
COPY packages/ai/package.json ./packages/ai/

# Install dependencies for the whole workspace (filtered for linda-agent and its deps)
RUN pnpm install --frozen-lockfile=false

# Copy the rest of the source code
COPY . .

# Build the linda-agent package and its local dependencies recursively
RUN pnpm -r build --filter @psf/linda-agent...

# Final runtime image
FROM node:20-slim

# Install system dependencies for WhatsApp (ffmpeg, webp)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libwebp-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built artifacts and node_modules from builder
# We copy the whole /app for simplicity in monorepo, 
# but in production you might want to prune it.
COPY --from=builder /app /app

# Set the working directory to the specific package
WORKDIR /app/packages/linda-agent

# Default environment variables (can be overridden)
ENV NODE_ENV=production
ENV WHATSAPP_AUTH_DIR=./data/wa-auth

# Run the agent
CMD ["node", "dist/main.js"]
