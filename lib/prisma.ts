import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "缺少环境变量 DATABASE_URL。请将 .env.example 复制为 .env 并填写 PostgreSQL 连接串。"
    );
  }
  // 连接池上限可配（默认沿用 pg 的 10），避免多实例/任务高峰时打满数据库连接
  const poolMax = Number(process.env.DATABASE_POOL_MAX);
  const adapter = new PrismaPg({
    connectionString,
    ...(Number.isInteger(poolMax) && poolMax > 0 ? { max: poolMax } : {}),
  });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

function getPrismaClient(): PrismaClient {
  const cached = globalForPrisma.prisma;
  // 开发环境：schema 新增模型后若未重启，global 里仍是旧 Client，会出现 prisma.noteLink 等为 undefined
  const stale =
    process.env.NODE_ENV !== "production" &&
    cached &&
    typeof (cached as unknown as { noteLink?: { findMany?: unknown } }).noteLink?.findMany !==
      "function";
  if (stale) {
    globalForPrisma.prisma = undefined;
  }
  const client = globalForPrisma.prisma ?? createPrismaClient();
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = client;
  }
  return client;
}

export const prisma = getPrismaClient();
