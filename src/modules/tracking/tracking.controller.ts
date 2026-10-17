import { FastifyRequest, FastifyReply } from 'fastify';
import { batchIngestSchema, routeParamSchema } from './tracking.schema';
import { trackingService } from './tracking.service';

export async function handleBatchIngest(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const parseResult = batchIngestSchema.safeParse(request.body);
  if (!parseResult.success) {
    return reply.status(400).send({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Validation failed for batch ingestion payload',
      details: parseResult.error.format(),
    });
  }

  const { id: userId, tenantId } = request.user;
  const result = await trackingService.ingestBatch(
    userId,
    tenantId,
    parseResult.data,
    request.server.realtime
  );

  return reply.status(200).send({
    success: true,
    message: `Batch ingested: ${result.insertedCount} inserted, ${result.rejectedDriftCount} rejected for drift, ${result.receivedCount - result.acceptedCount - result.rejectedDriftCount} duplicates skipped`,
    data: result,
  });
}

export async function handleGetRoute(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const paramResult = routeParamSchema.safeParse(request.params);
  if (!paramResult.success) {
    return reply.status(400).send({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Invalid attendance session ID parameter',
      details: paramResult.error.format(),
    });
  }

  const { id: attendanceId } = paramResult.data;
  const { id: requestingUserId, tenantId, role: requestingRole } = request.user;

  const result = await trackingService.getAttendanceRoute(
    attendanceId,
    tenantId,
    requestingUserId,
    requestingRole
  );

  return reply.status(200).send({
    success: true,
    message: 'Attendance route and stopovers retrieved successfully',
    data: result,
  });
}
