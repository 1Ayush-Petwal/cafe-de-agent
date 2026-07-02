const { Client } = require('pg');

const url =
  process.env.TEST_DATABASE_ADMIN_URL || 'postgres://cafe:cafe@localhost:5432/postgres';

async function main() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const client = new Client({ connectionString: url });
    try {
      await client.connect();
      await client.end();
      console.log('postgres is ready');
      return;
    } catch {
      await client.end().catch(() => {});
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  console.error('postgres did not become ready in time');
  process.exit(1);
}

main();
