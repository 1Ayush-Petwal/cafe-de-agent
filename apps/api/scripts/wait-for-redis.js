const Redis = require('ioredis');

const url = process.env.TEST_REDIS_URL || 'redis://localhost:6379';

async function main() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const client = new Redis(url, { lazyConnect: true, retryStrategy: () => null });
    try {
      await client.connect();
      await client.ping();
      client.disconnect();
      console.log('redis is ready');
      return;
    } catch {
      client.disconnect();
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  console.error('redis did not become ready in time');
  process.exit(1);
}

main();
