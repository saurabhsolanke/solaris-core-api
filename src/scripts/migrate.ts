import fs from 'fs';
import path from 'path';
import { pool, closeDatabasePool } from '../config/database';
import { env } from '../config/env';

async function runMigration(): Promise<void> {
  const migrationsDir = path.resolve(__dirname, '../../migrations');
  console.log(`🚀 Starting database migrations from: ${migrationsDir}`);

  if (!fs.existsSync(migrationsDir)) {
    console.error(`❌ Migrations directory not found at: ${migrationsDir}`);
    process.exit(1);
  }

  // Discover all .sql files, sorted numerically (001_, 002_, ...)
  const sqlFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (sqlFiles.length === 0) {
    console.warn('⚠️ No SQL migration files found.');
    return;
  }

  let client;
  try {
    client = await pool.connect();
  } catch (connError: unknown) {
    console.error('\n❌ Could not establish connection to the database:');
    console.error(`   ${connError instanceof Error ? connError.message : String(connError)}\n`);

    if (env.DATABASE_URL.includes('localhost') || env.DATABASE_URL.includes('127.0.0.1')) {
      console.log('----------------------------------------------------------------------');
      console.log('💡 TIP FOR SUPABASE USERS:');
      console.log(`It looks like you have Supabase configured (${env.SUPABASE_URL}).`);
      console.log('To run migrations against Supabase, set your DATABASE_URL in .env:');
      console.log('DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.cfvpbtdpdwgmejhcgweb.supabase.co:5432/postgres');
      console.log('\nAlternatively, paste the SQL files from migrations/ into the Supabase SQL Editor:');
      console.log('https://supabase.com/dashboard/project/cfvpbtdpdwgmejhcgweb/sql/new');
      console.log('----------------------------------------------------------------------\n');
    }
    process.exit(1);
  }

  try {
    for (const file of sqlFiles) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      console.log(`\n⏳ Running migration: ${file} ...`);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('COMMIT');
        console.log(`  ✅ ${file} — completed`);
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`  ❌ ${file} — FAILED:`, error);
        process.exit(1);
      }
    }
    console.log('\n🎉 All migrations executed successfully!');
  } finally {
    client.release();
    await closeDatabasePool();
  }
}

runMigration();
