import { query } from '../../config/database';
import { signJwt } from '../../utils/token';
import { UserRole } from '../../types/database';
import { activityService } from '../activity/activity.service';
import { LoginInput } from './auth.schema';

export interface AuthenticatedUserPayload {
  id: string;
  userId: string;
  tenant_id: string;
  tenantId: string;
  email: string;
  full_name: string;
  fullName: string;
  role: UserRole;
  is_active: boolean;
  isActive: boolean;
  tenant: {
    id: string;
    company_name: string;
    companyName: string;
    subdomain: string;
    slug: string;
    name: string;
  };
}

export interface LoginResult {
  token: string;
  user: AuthenticatedUserPayload;
}

interface UserDbRow {
  id: string;
  tenant_id: string;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  company_name: string;
  subdomain: string;
}

function buildUserPayload(row: UserDbRow): AuthenticatedUserPayload {
  return {
    id: row.id,
    userId: row.id,
    tenant_id: row.tenant_id,
    tenantId: row.tenant_id,
    email: row.email,
    full_name: row.full_name,
    fullName: row.full_name,
    role: row.role,
    is_active: row.is_active,
    isActive: row.is_active,
    tenant: {
      id: row.tenant_id,
      company_name: row.company_name,
      companyName: row.company_name,
      subdomain: row.subdomain,
      slug: row.subdomain,
      name: row.company_name,
    },
  };
}

export class AuthService {
  /**
   * Authenticates a user strictly against the database (public.users + public.tenants).
   * Rejects if email does not exist in the database or if tenant/sub claims mismatch.
   */
  async login(
    input: LoginInput,
    context: {
      ip?: string | null;
      userAgent?: string | null;
      endpoint?: string | null;
    }
  ): Promise<LoginResult> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const userIdInput = input.sub || input.user_id;

    // 1. Query user from database by email
    const res = await query<UserDbRow>(
      `SELECT u.id, u.tenant_id, u.email, u.full_name, u.role, u.is_active,
              t.company_name, t.subdomain
       FROM users u
       JOIN tenants t ON u.tenant_id = t.id
       WHERE LOWER(u.email) = $1
       LIMIT 1`,
      [normalizedEmail]
    );

    // 2. Reject if email does not exist in public.users
    if (res.rows.length === 0) {
      throw new Error(`User with email "${input.email}" not found in database.`);
    }

    const userRow = res.rows[0];

    // 3. Verify active status
    if (!userRow.is_active) {
      throw new Error('User account is deactivated. Please contact your tenant administrator.');
    }

    // 4. If tenant_id was supplied in payload, verify it matches user's tenant in DB
    if (input.tenant_id && input.tenant_id !== userRow.tenant_id) {
      throw new Error(
        `Tenant mismatch: User "${input.email}" belongs to tenant ${userRow.tenant_id}, not ${input.tenant_id}.`
      );
    }

    // 5. If sub/user_id was supplied in payload, verify it matches user's id in DB
    if (userIdInput && userIdInput !== userRow.id) {
      throw new Error(
        `User ID mismatch: Provided sub "${userIdInput}" does not match database user id "${userRow.id}".`
      );
    }

    // 6. If role was supplied in payload, verify it matches user's role in DB
    if (input.role && input.role !== userRow.role) {
      throw new Error(
        `Role mismatch: User role in database is "${userRow.role}", but "${input.role}" was provided.`
      );
    }

    // 7. Issue authentic multi-tenant JWT
    const token = signJwt({
      sub: userRow.id,
      tenant_id: userRow.tenant_id,
      role: userRow.role,
      email: userRow.email,
    });

    // 8. Record LOGIN event in user_activity_logs (fire-and-forget)
    activityService
      .log({
        tenantId: userRow.tenant_id,
        userId: userRow.id,
        eventType: 'LOGIN',
        ipAddress: context.ip ?? null,
        userAgent: context.userAgent ?? null,
        endpoint: context.endpoint ?? '/api/v1/auth/login',
        method: 'POST',
        statusCode: 200,
        metadata: {
          role: userRow.role,
          email: userRow.email,
          source: 'auth_login_api',
        },
      })
      .catch(() => {});

    return {
      token,
      user: buildUserPayload(userRow),
    };
  }

  /**
   * Retrieves user profile details and associated tenant info.
   */
  async getMe(userId: string, tenantId: string): Promise<AuthenticatedUserPayload> {
    const res = await query<UserDbRow>(
      `SELECT u.id, u.tenant_id, u.email, u.full_name, u.role, u.is_active,
              t.company_name, t.subdomain
       FROM users u
       JOIN tenants t ON u.tenant_id = t.id
       WHERE u.id = $1 AND u.tenant_id = $2
       LIMIT 1`,
      [userId, tenantId]
    );

    if (res.rows.length === 0) {
      throw new Error('User not found in tenant database');
    }

    return buildUserPayload(res.rows[0]);
  }
}

export const authService = new AuthService();
