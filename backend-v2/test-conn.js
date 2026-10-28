const { PrismaClient } = require('@prisma/client');
const { createClient } = require('redis');
require('dotenv').config();

async function testConnections() {
  console.log('Testing Database URL:', process.env.DATABASE_URL?.substring(0, 30) + '...');
  const prisma = new PrismaClient();
  try {
    const userCount = await prisma.user.count();
    console.log('SUCCESS: Database connected! User count:', userCount);
  } catch (err) {
    console.error('FAILURE: Database connection failed:', err.message);
  } finally {
    await prisma.$disconnect();
  }

  console.log('Testing Redis URL:', process.env.REDIS_URL?.substring(0, 30) + '...');
  if (process.env.REDIS_URL) {
    const redis = createClient({ url: process.env.REDIS_URL });
    redis.on('error', (err) => console.error('Redis Client Error', err.message));
    try {
      await redis.connect();
      await redis.ping();
      console.log('SUCCESS: Redis connected and PING succeeded!');
      await redis.disconnect();
    } catch (err) {
      console.error('FAILURE: Redis connection failed:', err.message);
    }
  }
}

testConnections();
