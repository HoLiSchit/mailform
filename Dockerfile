# Build stage
FROM node:lts-alpine AS builder

RUN mkdir /app
WORKDIR /app

# copy configs folder
COPY package*.json ./
COPY tsconfig.json ./
# copy source code to /app/src folder
COPY src src

# install dependencies (https://docs.npmjs.com/cli/v7/commands/npm-ci)
RUN npm ci

# build
RUN npm run build

# Production stage
FROM node:lts-alpine
ENV NODE_ENV=production

RUN mkdir /app
WORKDIR /app

COPY package*.json ./
COPY --from=builder /app/dist dist

RUN mkdir targets

# install production dependencies
RUN npm ci --omit=dev && npm cache clean --force

ENV PORT=3000
EXPOSE 3000

# Not root. Override with `user:` in docker-compose to match the owner of the (0600) target files.
USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:${PORT}/healthz || exit 1

# Run node directly (not via npm) so SIGHUP/SIGTERM reach the process
CMD ["node", "dist/main.js"]
