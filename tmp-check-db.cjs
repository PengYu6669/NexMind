require('dotenv/config');
const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  const cols = await prisma.$queryRaw`select column_name from information_schema.columns where table_schema='public' and table_name='KnowledgeSource' and column_name='conversationId'`;
  const idx = await prisma.$queryRaw`select indexname from pg_indexes where schemaname='public' and tablename='KnowledgeSource' and indexname='KnowledgeSource_conversationId_idx'`;
  const fk = await prisma.$queryRaw`select conname from pg_constraint where conname='KnowledgeSource_conversationId_fkey'`;
  console.log(JSON.stringify({ conversationIdColumn: cols.length > 0, index: idx.length > 0, fk: fk.length > 0 }, null, 2));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
