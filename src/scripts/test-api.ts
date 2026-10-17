import { buildApp } from '../app';
import { signJwt } from '../utils/token';
import { calculateDistanceMeters } from '../modules/stopover/stopover.service';

async function runTests(): Promise<void> {
  console.log('🧪 Starting SOLARIS Core API integration smoke test suite...');
  const app = await buildApp();
  await app.ready();

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: unknown) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName}`, detail || '');
      failed++;
    }
  }

  try {
    // Test 1: Health check endpoint
    const healthRes = await app.inject({
      method: 'GET',
      url: '/health',
    });
    assert(
      healthRes.statusCode === 200 || healthRes.statusCode === 503,
      'GET /health responds with structured JSON',
      healthRes.json()
    );

    // Test 2: Unauthenticated punch-in rejected
    const unauthRes = await app.inject({
      method: 'POST',
      url: '/api/v1/attendance/punch-in',
      payload: { lat: 18.5204, lng: 73.8567, accuracy: 10 },
    });
    assert(unauthRes.statusCode === 401, 'Unauthenticated punch-in returns 401 Unauthorized');

    // Test 3: Generate valid token & test accuracy validation (> 100m rejected)
    const testToken = signJwt({
      sub: '99999999-9999-9999-9999-999999999999',
      tenant_id: '88888888-8888-8888-8888-888888888888',
      role: 'EMPLOYEE',
      email: 'test@solaris.internal',
    });

    const badAccuracyRes = await app.inject({
      method: 'POST',
      url: '/api/v1/attendance/punch-in',
      headers: {
        authorization: `Bearer ${testToken}`,
      },
      payload: { lat: 18.5204, lng: 73.8567, accuracy: 150 }, // > 100m
    });
    assert(badAccuracyRes.statusCode === 400, 'Punch-in with accuracy > 100m returns 400 Bad Request');

    // Test 4: Batch tracking validation (empty pings rejected)
    const emptyBatchRes = await app.inject({
      method: 'POST',
      url: '/api/v1/tracking/batch',
      headers: {
        authorization: `Bearer ${testToken}`,
      },
      payload: { pings: [] },
    });
    assert(emptyBatchRes.statusCode === 400, 'Empty batch pings returns 400 Bad Request');

    // Test 5: Distance calculation utility test
    // Distance between Pune Station (18.5284, 73.8739) and Shaniwar Wada (18.5196, 73.8553) is ~2.2 km
    const dist = calculateDistanceMeters(18.5284, 73.8739, 18.5196, 73.8553);
    assert(dist > 2000 && dist < 2500, `Haversine distance calculation is accurate (${dist.toFixed(0)}m)`);

    console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Test execution error:', err);
    process.exit(1);
  } finally {
    await app.close();
  }
}

runTests();
