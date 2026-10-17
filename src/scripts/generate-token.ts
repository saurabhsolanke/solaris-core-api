import { signJwt } from '../utils/token';
import { UserRole } from '../types/database';

// Read arguments or use sensible defaults
const userId = process.argv[2] || 'a0000000-0000-0000-0000-000000000001';
const tenantId = process.argv[3] || 'b0000000-0000-0000-0000-000000000001';
const role = (process.argv[4] as UserRole) || 'EMPLOYEE';
const email = process.argv[5] || 'worker@solaris.internal';

const token = signJwt({
  sub: userId,
  tenant_id: tenantId,
  role,
  email,
});

console.log(`
======================================================================
🔑 SOLARIS JWT TOKEN GENERATED
======================================================================
User ID:   ${userId}
Tenant ID: ${tenantId}
Role:      ${role}
Email:     ${email}

Bearer Token:
${token}

Usage with cURL:
curl -H "Authorization: Bearer ${token}" http://localhost:3000/api/v1/attendance/punch-in
======================================================================
`);
