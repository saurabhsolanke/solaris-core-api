import { pool, closeDatabasePool } from '../config/database';
import { signJwt } from '../utils/token';
import { env } from '../config/env';

async function seed(): Promise<void> {
  console.log('🌱 Preparing SOLARIS demo tenant, credentials, and JWT tokens...');

  const demoTenantId = '11111111-1111-1111-1111-111111111111';
  const demoAdminId = '22222222-2222-2222-2222-222222222222';
  const demoEmployeeId = '33333333-3333-3333-3333-333333333333';

  const adminEmail = 'saurabh.admin@solanke.internal';
  const employeeEmail = 'agent.rahul@solanke.internal';

  // 1. Generate multi-tenant JWT tokens
  const adminToken = signJwt({
    sub: demoAdminId,
    tenant_id: demoTenantId,
    role: 'ADMIN',
    email: adminEmail,
  });

  const employeeToken = signJwt({
    sub: demoEmployeeId,
    tenant_id: demoTenantId,
    role: 'EMPLOYEE',
    email: employeeEmail,
  });

  // 2. Attempt to seed into PostgreSQL database if reachable
  let dbConnected = false;
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Insert or update Tenant
      await client.query(`
        INSERT INTO tenants (id, company_name, subdomain)
        VALUES ($1, 'Solanke Logistics & Operations', 'solanke')
        ON CONFLICT (subdomain) DO UPDATE SET company_name = EXCLUDED.company_name
      `, [demoTenantId]);

      // Insert or update Admin User
      await client.query(`
        INSERT INTO users (id, tenant_id, email, full_name, role)
        VALUES ($1, $2, $3, 'Saurabh Solanke (Admin)', 'ADMIN')
        ON CONFLICT (tenant_id, email) DO UPDATE SET full_name = EXCLUDED.full_name
      `, [demoAdminId, demoTenantId, adminEmail]);

      // Insert or update Employee User
      await client.query(`
        INSERT INTO users (id, tenant_id, email, full_name, role)
        VALUES ($1, $2, $3, 'Rahul Deshmukh (Field Agent)', 'EMPLOYEE')
        ON CONFLICT (tenant_id, email) DO UPDATE SET full_name = EXCLUDED.full_name
      `, [demoEmployeeId, demoTenantId, employeeEmail]);

      await client.query('COMMIT');
      dbConnected = true;
    } catch (err) {
      await client.query('ROLLBACK');
      console.warn('⚠️ Database query error during seeding:', err);
    } finally {
      client.release();
    }
  } catch (connErr: unknown) {
    console.warn(`\n⚠️ Database not reachable at DATABASE_URL:`);
    console.warn(`   ${connErr instanceof Error ? connErr.message : String(connErr)}`);
    if (env.DATABASE_URL.includes('localhost') || env.DATABASE_URL.includes('127.0.0.1')) {
      console.warn(`\n👉 NOTE: You have configured Supabase (${env.SUPABASE_URL}).`);
      console.warn(`   To connect to your Supabase database, update DATABASE_URL in .env:`);
      console.warn(`   DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.cfvpbtdpdwgmejhcgweb.supabase.co:5432/postgres\n`);
    }
  } finally {
    await closeDatabasePool();
  }

  console.log(`
======================================================================
${dbConnected ? '🎉 DATABASE SEEDED & TOKENS GENERATED' : '🔑 DEMO TOKENS READY (STANDALONE / OFFLINE MODE)'}
======================================================================
🏢 Tenant:     Solanke Logistics & Operations (ID: ${demoTenantId})
👤 Admin:      Saurabh Solanke (${adminEmail})
🔑 Admin Token (Bearer):
${adminToken}

👤 Employee:   Rahul Deshmukh (${employeeEmail})
🔑 Employee Token (Bearer):
${employeeToken}

👉 Test in Swagger UI (http://localhost:3000/docs) or cURL:
curl -H "Authorization: Bearer ${employeeToken}" http://localhost:3000/api/v1/attendance/punch-in
======================================================================
  `);
}

seed();
