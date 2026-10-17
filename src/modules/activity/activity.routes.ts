import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { handleGetLogs, handleGetSummary } from './activity.controller';

const activityRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // All activity endpoints require authentication
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /api/v1/activity/logs
  fastify.get('/logs', {
    schema: {
      description:
        'Retrieve paginated user activity logs. ADMIN sees all users; EMPLOYEE sees only their own.',
      tags: ['Activity & Audit Logs'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          user_id: {
            type: 'string',
            format: 'uuid',
            description: 'Filter by user ID (ADMIN only)',
          },
          event_type: {
            type: 'string',
            enum: ['LOGIN', 'PUNCH_IN', 'PUNCH_OUT', 'BATCH_INGEST', 'ROUTE_VIEW'],
            description: 'Filter by activity event type',
          },
          from: {
            type: 'string',
            format: 'date-time',
            description: 'Start of time range (ISO 8601)',
          },
          to: {
            type: 'string',
            format: 'date-time',
            description: 'End of time range (ISO 8601)',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 200,
            default: 50,
            description: 'Max records per page',
          },
          offset: {
            type: 'integer',
            minimum: 0,
            default: 0,
            description: 'Pagination offset',
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            data: {
              type: 'object',
              properties: {
                total: { type: 'integer' },
                limit: { type: 'integer' },
                offset: { type: 'integer' },
                logs: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'integer' },
                      tenant_id: { type: 'string', format: 'uuid' },
                      user_id: { type: 'string', format: 'uuid' },
                      event_type: { type: 'string' },
                      ip_address: { type: 'string', nullable: true },
                      user_agent: { type: 'string', nullable: true },
                      endpoint: { type: 'string', nullable: true },
                      method: { type: 'string', nullable: true },
                      status_code: { type: 'integer', nullable: true },
                      metadata: { type: 'object' },
                      logged_at: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    handler: handleGetLogs,
  });

  // GET /api/v1/activity/summary  — ADMIN only
  fastify.get('/summary', {
    schema: {
      description:
        'Admin-only: get per-user daily login and activity summary. Shows login counts, first/last login times, punch-in/out counts.',
      tags: ['Activity & Audit Logs'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          user_id: {
            type: 'string',
            format: 'uuid',
            description: 'Filter summary for a specific user',
          },
          from: {
            type: 'string',
            format: 'date-time',
            description: 'Start of date range (ISO 8601)',
          },
          to: {
            type: 'string',
            format: 'date-time',
            description: 'End of date range (ISO 8601)',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 200,
            default: 50,
          },
          offset: {
            type: 'integer',
            minimum: 0,
            default: 0,
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            data: {
              type: 'object',
              properties: {
                total: { type: 'integer' },
                summary: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      user_id: { type: 'string', format: 'uuid' },
                      activity_date: { type: 'string' },
                      login_count: { type: 'integer' },
                      punch_in_count: { type: 'integer' },
                      punch_out_count: { type: 'integer' },
                      batch_ingest_count: { type: 'integer' },
                      first_login_at: { type: 'string', nullable: true },
                      last_login_at: { type: 'string', nullable: true },
                    },
                  },
                },
              },
            },
          },
        },
        403: {
          type: 'object',
          properties: {
            statusCode: { type: 'integer' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    preHandler: [fastify.requireRole('ADMIN')],
    handler: handleGetSummary,
  });
};

export default activityRoutes;
