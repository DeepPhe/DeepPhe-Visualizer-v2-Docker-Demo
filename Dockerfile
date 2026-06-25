# syntax=docker/dockerfile:1
#
# Single Dockerfile for the DeepPhe demo stack.
#
# Compose builds two targets from this file:
#   - data-api: clones and runs DeepPhe/dphe-data-api
#   - viz: clones and runs DeepPhe/DeepPhe-Visualizer-v2

FROM node:24-bookworm-slim AS data-api-source

ARG DATA_API_REPO=https://github.com/DeepPhe/dphe-data-api.git
ARG DATA_API_REF=main

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 --branch "${DATA_API_REF}" "${DATA_API_REPO}" /src \
    && rm -rf /src/.git

FROM node:24-bookworm-slim AS data-api-dependencies

WORKDIR /app

COPY --from=data-api-source /src/package*.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force

FROM node:24-bookworm-slim AS data-api

ENV NODE_ENV=production \
    PORT=3333 \
    DB_PATH=./test/resources/deepphe.sqlite3

WORKDIR /app

COPY --from=data-api-dependencies /app/node_modules ./node_modules
COPY --from=data-api-source /src/package*.json ./
COPY --from=data-api-source /src/server.js ./
COPY --from=data-api-source /src/src ./src
COPY --from=data-api-source /src/test/resources ./test/resources

RUN chown -R node:node /app

USER node

EXPOSE 3333

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "const http = require('http'); const port = process.env.PORT || 3333; const req = http.get({ host: '127.0.0.1', port, path: '/openapi.json', timeout: 4000 }, (res) => process.exit(res.statusCode >= 200 && res.statusCode < 500 ? 0 : 1)); req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', () => process.exit(1));"

CMD ["npm", "start"]

FROM node:20-alpine AS viz-source

ARG VIZ_REPO=https://github.com/DeepPhe/DeepPhe-Visualizer-v2.git
ARG VIZ_REF=main

RUN apk add --no-cache git

RUN git clone --depth 1 --branch "${VIZ_REF}" "${VIZ_REPO}" /src \
    && rm -rf /src/.git

FROM node:20-alpine AS viz

WORKDIR /app

COPY --from=viz-source /src/ ./

# Install all dependencies because CRACO build tools live in devDependencies.
RUN npm install --legacy-peer-deps \
    && REACT_APP_DEEPPHE_API_LOCATION=/ npm run build

COPY viz-server.js ./docker-viz-server.js

ENV NODE_ENV=production \
    PORT=3000 \
    DEEPPHE_API_LOCATION=http://data-api:3333

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000),r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "docker-viz-server.js"]
