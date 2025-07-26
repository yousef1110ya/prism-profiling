
import { createClient } from 'redis';

const client = createClient({
  url: 'redis://localhost:6379'
});

client.on('error', (err) => console.error('Redis Client Error', err));

export async function connect() {
  await client.connect();
}

export async function getCache(key) {
  return await client.get(key);
}

export async function setCache(key, value, ttlSeconds) {
  await client.setEx(key, ttlSeconds, value);
}

export async function disconnect() {
  await client.quit();
}
