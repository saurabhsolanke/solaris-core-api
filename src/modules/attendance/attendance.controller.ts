import { FastifyRequest, FastifyReply } from 'fastify';
import { punchInSchema, punchOutSchema } from './attendance.schema';
import { attendanceService, AttendanceRecord } from './attendance.service';

/**
 * Shapes a raw AttendanceRecord into the enriched API response format.
 * Separates identity (actor) from attendance session data for clarity.
 */
function buildPayload(record: AttendanceRecord) {
  return {
    // ── Who performed this action ──────────────────────────────────────────
    actor: {
      user_id:          record.user_id,
      full_name:        record.full_name,
      email:            record.email,
      role:             record.role,
      tenant_id:        record.tenant_id,
      tenant_name:      record.tenant_name,
      tenant_subdomain: record.tenant_subdomain,
    },
    // ── Attendance session data ────────────────────────────────────────────
    session: {
      id:                record.id,
      punch_in_at:       record.punch_in_at,
      punch_in_address:  record.punch_in_address,
      punch_in_lat:      record.punch_in_lat,
      punch_in_lng:      record.punch_in_lng,
      punch_out_at:      record.punch_out_at,
      punch_out_address: record.punch_out_address,
      punch_out_lat:     record.punch_out_lat,
      punch_out_lng:     record.punch_out_lng,
      total_distance_km: record.total_distance_km,
      created_at:        record.created_at,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/attendance/punch-in
// ─────────────────────────────────────────────────────────────────────────────
export async function handlePunchIn(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const parseResult = punchInSchema.safeParse(request.body);
  if (!parseResult.success) {
    return reply.status(400).send({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Validation failed for punch-in payload',
      details: parseResult.error.format(),
    });
  }

  const { id: userId, tenantId } = request.user;
  const record = await attendanceService.punchIn(userId, tenantId, parseResult.data);

  return reply.status(201).send({
    success: true,
    message: `${record.full_name} (${record.email}) punched in from tenant "${record.tenant_name}"`,
    data: buildPayload(record),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/attendance/punch-out
// ─────────────────────────────────────────────────────────────────────────────
export async function handlePunchOut(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const parseResult = punchOutSchema.safeParse(request.body);
  if (!parseResult.success) {
    return reply.status(400).send({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Validation failed for punch-out payload',
      details: parseResult.error.format(),
    });
  }

  const { id: userId, tenantId } = request.user;
  const record = await attendanceService.punchOut(userId, tenantId, parseResult.data);

  return reply.status(200).send({
    success: true,
    message: `${record.full_name} (${record.email}) punched out from tenant "${record.tenant_name}" — ${record.total_distance_km} km covered`,
    data: buildPayload(record),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/attendance/history
// ─────────────────────────────────────────────────────────────────────────────
export async function handleGetHistory(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id: userId, tenantId, role } = request.user;
  const records = await attendanceService.getHistory(tenantId, userId, role);

  return reply.status(200).send({
    success: true,
    data: records,
  });
}
