import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import { DatabaseSchema } from '../types/database';
import { env } from './env';

// Configure PostgreSQL connection pool for high-throughput batch operations
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20, // Maintain up to 20 pooled connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// PostGIS-enabled Kysely Query Builder
export const db = new Kysely<DatabaseSchema>({
  dialect: new PostgresDialect({
    pool,
  }),
});

/**
 * Executes a parameterized SQL query against the connection pool.
 * PostGIS spatial calculations, aggregations, and ST_* functions can be run directly.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<QueryResult<T>> {
  const start = Date.now();
  try {
    const res = await pool.query<T>(text, params);
    const duration = Date.now() - start;
    if (env.NODE_ENV === 'development' && duration > 100) {
      console.warn(`⚠️ Slow query (${duration}ms):`, text.substring(0, 100));
    }
    return res;
  } catch (error) {
    console.error('❌ Database query error:', { text, params, error });
    throw error;
  }
}

/**
 * Executes a function within a database transaction, optionally setting
 * the tenant context for PostgreSQL Row-Level Security session variable.
 */
export async function withTenantTransaction<T>(
  tenantId: string,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Set local session variable for Row-Level Security policy matching
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Check if the database and PostGIS extension are reachable and active.
 */
export async function checkDatabaseConnection(): Promise<{ ok: boolean; postgisVersion?: string; error?: string }> {
  try {
    const res = await pool.query("SELECT PostGIS_Full_Version() as version");
    return { ok: true, postgisVersion: res.rows[0]?.version };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Also test simple SELECT 1 if PostGIS is not yet installed in active schema
    try {
      await pool.query('SELECT 1');
      return { ok: true, postgisVersion: 'Connected (PostGIS not yet enabled or not in search_path)' };
    } catch {
      return { ok: false, error: message };
    }
  }
}

/**
 * Gracefully close the connection pool on shutdown
 */
export async function closeDatabasePool(): Promise<void> {
  await db.destroy();
  await pool.end();
}
