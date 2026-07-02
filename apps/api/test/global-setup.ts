import { Client } from 'pg';

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://cafe:cafe@localhost:5432/postgres';
const TEST_DB_NAME = 'cafe_de_app_test';

export default async function globalSetup(): Promise<void> {
  const client = new Client({ connectionString: ADMIN_URL });
  await client.connect();
  const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
    TEST_DB_NAME,
  ]);
  if (rowCount === 0) {
    await client.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  }
  await client.end();
}
