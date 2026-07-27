# syntax=docker/dockerfile:1
# 生产镜像：完整源码 + 生产依赖。
# 注意：不能用 next 的 standalone 输出——MCP 子进程在运行时通过
# `npx tsx mcp-servers/nextclaw-bridge/run.ts` 启动，并动态 import lib/* 源码，
# standalone 裁剪会破坏这条链路。

FROM node:22-alpine AS deps
WORKDIR /app
# 国内服务器构建加速（可选）：默认官方源；.env 设
#   NPM_REGISTRY=https://registry.npmmirror.com
#   PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma
ARG NPM_REGISTRY=https://registry.npmjs.org/
ARG PRISMA_ENGINES_MIRROR=https://binaries.prisma.sh
ENV PRISMA_ENGINES_MIRROR=${PRISMA_ENGINES_MIRROR}
# postinstall 会执行 prisma generate，需要 schema 与 prisma.config.ts
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# prisma.config.ts 在 generate 时要求 DATABASE_URL 存在，构建期给占位值即可
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=public"
RUN npm config set registry "${NPM_REGISTRY}" && npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 构建期不连库；占位连接串仅用于模块求值（lib/prisma.ts 缺 DATABASE_URL 会 throw）
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=public"
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
# prisma migrate CLI 依赖 openssl
RUN apk add --no-cache openssl
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=builder /app/package.json /app/package-lock.json /app/next.config.ts /app/tsconfig.json /app/prisma.config.ts ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
# MCP stdio 子进程运行所需源码（tsx 直接执行 TS）
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/mcp-servers ./mcp-servers
# 裁剪 devDependencies；--ignore-scripts 避免重跑 postinstall（client 已生成）
RUN npm prune --omit=dev --ignore-scripts
EXPOSE 3000
# 启动前应用迁移（AGENTS.md：生产只用 migrate deploy）
CMD ["sh", "-c", "npx prisma migrate deploy && npx next start -p 3000"]
