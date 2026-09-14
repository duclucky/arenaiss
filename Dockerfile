# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS api-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-bookworm-slim AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=api-deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY packages ./packages
COPY services ./services
COPY scripts/ops ./scripts/ops
COPY docs/evidence/live/trusted-operator-lifecycle-settlement-2.json ./docs/evidence/live/trusted-operator-lifecycle-settlement-2.json
USER node
EXPOSE 8787
CMD ["node", "services/api/src/server.ts"]

FROM node:24-bookworm-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend ./
ARG VITE_ARC_CHAIN_ID=5042002
ARG VITE_ARC_NETWORK_NAME="Arc Testnet"
ARG VITE_ARC_RPC_URL
ARG VITE_ARC_USDC_ADDRESS
ARG VITE_ARC_ESCROW_ADDRESS
ARG VITE_ARENA_API_URL=/
ARG VITE_GENLAYER_CHAIN_ID=61997
ARG VITE_GENLAYER_NETWORK_NAME="GenLayer Studio Next"
ARG VITE_GENLAYER_RPC_URL=https://studio-next.genlayer.com/api
ARG VITE_GENLAYER_EXPLORER_URL=https://explorer-studio-dev.genlayer.com
ARG VITE_GENLAYER_MATCH_JUDGE_ADDRESS=0xbd5592dc0A45B78614cd5d1c2f29F6F35dabB679
ARG VITE_GENLAYER_EVALUATION_JUDGE_ADDRESS=0x0aA2B27D04BAa4438f2c3B9560eb7989de5a934d
ENV VITE_ARC_CHAIN_ID=$VITE_ARC_CHAIN_ID \
    VITE_ARC_NETWORK_NAME=$VITE_ARC_NETWORK_NAME \
    VITE_ARC_RPC_URL=$VITE_ARC_RPC_URL \
    VITE_ARC_USDC_ADDRESS=$VITE_ARC_USDC_ADDRESS \
    VITE_ARC_ESCROW_ADDRESS=$VITE_ARC_ESCROW_ADDRESS \
    VITE_ARENA_API_URL=$VITE_ARENA_API_URL \
    VITE_GENLAYER_CHAIN_ID=$VITE_GENLAYER_CHAIN_ID \
    VITE_GENLAYER_NETWORK_NAME=$VITE_GENLAYER_NETWORK_NAME \
    VITE_GENLAYER_RPC_URL=$VITE_GENLAYER_RPC_URL \
    VITE_GENLAYER_EXPLORER_URL=$VITE_GENLAYER_EXPLORER_URL \
    VITE_GENLAYER_MATCH_JUDGE_ADDRESS=$VITE_GENLAYER_MATCH_JUDGE_ADDRESS \
    VITE_GENLAYER_EVALUATION_JUDGE_ADDRESS=$VITE_GENLAYER_EVALUATION_JUDGE_ADDRESS
RUN npm run build

FROM caddy:2.10-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=frontend-build /app/frontend/dist /srv
EXPOSE 8080
