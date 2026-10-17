import { query } from '../../config/database';
import { UserActivityLogsTable } from '../../types/database';

export type ActivityEventType = UserActivityLogsTable['event_type'];

export interface ActivityLogEntry {
  id: number;
  tenant_id: string;
  user_id: string;
  event_type: ActivityEventType;
  ip_address: string | null;
  user_agent: string | null;
  endpoint: string | null;
  method: string | null;
  status_code: number | null;
  metadata: Record<string, unknown>;
  logged_at: Date;
}

export interface LoginSummaryRow {
  user_id: string;
  activity_date: string;
  login_count: number;
  punch_in_count: number;
  punch_out_count: number;
  batch_ingest_count: number;
  first_login_at: Date | null;
  last_login_at: Date | null;
}

export interface ActivityLogFilters {
  userId?: string;
  eventType?: ActivityEventType;
  from?: string; // ISO date string
  to?: string;   // ISO date string
  limit?: number;
  offset?: number;
}

export class ActivityService {
  /**
   * Writes a single activity log entry asynchronously.
   * Non-throwing — errors are printed but never propagate to the caller.
   */
  async log(entry: {
    tenantId: string;
    userId: string;
    eventType: ActivityEventType;
    ipAddress?: string | null;
    userAgent?: string | null;
    endpoint?: string | null;
    method?: string | null;
    statusCode?: number | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await query(
        `INSERT INTO user_activity_logs
           (tenant_id, user_id, event_type, ip_address, user_agent, endpoint, method, status_code, metadata)
         VALUES ($1, $2, $3, $4::inet, $5, $6, $7, $8, $9)`,
        [
          entry.tenantId,
          entry.userId,
          entry.eventType,
          entry.ipAddress ?? null,
          entry.userAgent ?? null,
          entry.endpoint ?? null,
          entry.method ?? null,
          entry.statusCode ?? null,
          JSON.stringify(entry.metadata ?? {}),
        ]
      );
    } catch (err) {
      // Fire-and-forget — never block API responses due to logging failures
      console.error('⚠️ Activity log write failed (non-critical):', err);
    }
  }

  /**
   * Returns paginated activity logs for the authenticated tenant.
   * Admins can query any user; employees can only query themselves.
   */
  async getLogs(
    tenantId: string,
    filters: ActivityLogFilters
  ): Promise<{ logs: ActivityLogEntry[]; total: number }> {
    const { userId, eventType, from, to, limit = 50, offset = 0 } = filters;
    const params: unknown[] = [tenantId];
    const conditions: string[] = ['tenant_id = $1'];

    if (userId) {
      params.push(userId);
      conditions.push(`user_id = $${params.length}`);
    }
    if (eventType) {
      params.push(eventType);
      conditions.push(`event_type = $${params.length}`);
    }
    if (from) {
      params.push(from);
      conditions.push(`logged_at >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      conditions.push(`logged_at <= $${params.length}`);
    }

    const where = conditions.join(' AND ');

    // Count total matching records
    const { rows: countRows } = await query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM user_activity_logs WHERE ${where}`,
      params
    );
    const total = parseInt(countRows[0]?.total ?? '0', 10);

    // Fetch page
    params.push(limit, offset);
    const { rows: logs } = await query<ActivityLogEntry>(
      `SELECT
         id, tenant_id, user_id, event_type,
         host(ip_address) AS ip_address,
         user_agent, endpoint, method, status_code, metadata, logged_at
       FROM user_activity_logs
       WHERE ${where}
       ORDER BY logged_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return { logs, total };
  }

  /**
   * Returns per-user daily login & activity summary (Admin only).
   * Aggregates LOGIN, PUNCH_IN, PUNCH_OUT, BATCH_INGEST counts per day.
   */
  async getSummary(
    tenantId: string,
    opts: { userId?: string; from?: string; to?: string; limit?: number; offset?: number }
  ): Promise<{ summary: LoginSummaryRow[]; total: number }> {
    const { userId, from, to, limit = 50, offset = 0 } = opts;
    const params: unknown[] = [tenantId];
    const conditions: string[] = ['tenant_id = $1'];

    if (userId) {
      params.push(userId);
      conditions.push(`user_id = $${params.length}`);
    }
    if (from) {
      params.push(from);
      conditions.push(`logged_at >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      conditions.push(`logged_at <= $${params.length}`);
    }

    const where = conditions.join(' AND ');

    const { rows: countRows } = await query<{ total: string }>(
      `SELECT COUNT(DISTINCT (user_id, DATE(logged_at))) AS total
       FROM user_activity_logs
       WHERE ${where}`,
      params
    );
    const total = parseInt(countRows[0]?.total ?? '0', 10);

    params.push(limit, offset);
    const { rows: summary } = await query<LoginSummaryRow>(
      `SELECT
         user_id,
         DATE(logged_at)::text AS activity_date,
         COUNT(*) FILTER (WHERE event_type = 'LOGIN')        AS login_count,
         COUNT(*) FILTER (WHERE event_type = 'PUNCH_IN')     AS punch_in_count,
         COUNT(*) FILTER (WHERE event_type = 'PUNCH_OUT')    AS punch_out_count,
         COUNT(*) FILTER (WHERE event_type = 'BATCH_INGEST') AS batch_ingest_count,
         MIN(logged_at) FILTER (WHERE event_type = 'LOGIN')  AS first_login_at,
         MAX(logged_at) FILTER (WHERE event_type = 'LOGIN')  AS last_login_at
       FROM user_activity_logs
       WHERE ${where}
       GROUP BY user_id, DATE(logged_at)
       ORDER BY activity_date DESC, user_id
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return { summary, total };
  }
}

export const activityService = new ActivityService();
