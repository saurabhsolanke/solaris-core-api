import { FastifyRequest, FastifyReply } from 'fastify';
import { activityService } from './activity.service';
import { UserActivityLogsTable } from '../../types/database';

type EventType = UserActivityLogsTable['event_type'];

// ────────────────────────────────────────────────────────────────────────────
// GET /api/v1/activity/logs
// Returns raw activity log entries, paginated. Admins see all users;
// employees are restricted to their own logs.
// ────────────────────────────────────────────────────────────────────────────
export async function handleGetLogs(
  request: FastifyRequest<{
    Querystring: {
      user_id?: string;
      event_type?: EventType;
      from?: string;
      to?: string;
      limit?: string;
      offset?: string;
    };
  }>,
  reply: FastifyReply
): Promise<void> {
  const { id: requestingUserId, tenantId, role } = request.user;
  const { user_id, event_type, from, to, limit, offset } = request.query;

  // Employees can only view their own logs
  const effectiveUserId =
    role === 'EMPLOYEE' ? requestingUserId : user_id ?? undefined;

  const result = await activityService.getLogs(tenantId, {
    userId: effectiveUserId,
    eventType: event_type,
    from,
    to,
    limit: limit ? parseInt(limit, 10) : 50,
    offset: offset ? parseInt(offset, 10) : 0,
  });

  return reply.status(200).send({
    success: true,
    message: `Found ${result.total} activity log entries`,
    data: {
      total: result.total,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
      logs: result.logs,
    },
  });
}

// ────────────────────────────────────────────────────────────────────────────
// GET /api/v1/activity/summary
// Returns per-user daily login & punch activity summary.
// ADMIN only.
// ────────────────────────────────────────────────────────────────────────────
export async function handleGetSummary(
  request: FastifyRequest<{
    Querystring: {
      user_id?: string;
      from?: string;
      to?: string;
      limit?: string;
      offset?: string;
    };
  }>,
  reply: FastifyReply
): Promise<void> {
  const { tenantId } = request.user;
  const { user_id, from, to, limit, offset } = request.query;

  const result = await activityService.getSummary(tenantId, {
    userId: user_id,
    from,
    to,
    limit: limit ? parseInt(limit, 10) : 50,
    offset: offset ? parseInt(offset, 10) : 0,
  });

  return reply.status(200).send({
    success: true,
    message: `Found activity summaries for ${result.total} user-day combinations`,
    data: {
      total: result.total,
      summary: result.summary,
    },
  });
}
