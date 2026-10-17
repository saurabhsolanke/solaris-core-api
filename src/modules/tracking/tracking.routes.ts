import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { handleBatchIngest, handleGetRoute } from './tracking.controller';

const trackingRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // All tracking endpoints require multi-tenant JWT authentication
  fastify.addHook('preHandler', fastify.authenticate);

  // POST /api/v1/tracking/batch
  fastify.post('/batch', {
    schema: {
      description: 'High-throughput idempotent batch ingestion of mobile GPS pings',
      tags: ['Tracking'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['pings'],
        properties: {
          attendance_id: { type: 'string', format: 'uuid', description: 'Optional attendance session ID' },
          pings: {
            type: 'array',
            minItems: 1,
            maxItems: 500,
            description: 'Array of telemetry pings recorded offline or online',
            items: {
              type: 'object',
              required: ['client_uuid', 'lat', 'lng', 'accuracy', 'recorded_at'],
              properties: {
                client_uuid: { type: 'string', format: 'uuid', description: 'Unique device ping UUID for idempotency' },
                lat: { type: 'number', minimum: -90, maximum: 90, description: 'Latitude' },
                lng: { type: 'number', minimum: -180, maximum: 180, description: 'Longitude' },
                accuracy: { type: 'number', description: 'GPS Accuracy in meters (points > 30m filtered out)' },
                speed: { type: 'number', default: 0, description: 'Device speed in km/h' },
                recorded_at: { type: 'string', format: 'date-time', description: 'Timestamp when ping was recorded on device' },
              },
            },
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
                receivedCount: { type: 'number' },
                acceptedCount: { type: 'number' },
                rejectedDriftCount: { type: 'number' },
                insertedCount: { type: 'number' },
                latestPing: {
                  type: 'object',
                  properties: {
                    lat: { type: 'number' },
                    lng: { type: 'number' },
                    speed: { type: 'number' },
                    accuracy: { type: 'number' },
                    recordedAt: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    handler: handleBatchIngest,
  });

  // GET /api/v1/attendance/:id/route
  // Also registered under /api/v1/attendance/:id/route in app.ts for route hierarchy
  fastify.get('/attendance/:id/route', {
    schema: {
      description: 'Fetch road mileage, Leaflet polyline coordinates, and dwell stopovers for an attendance session',
      tags: ['Analytics & Maps'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Attendance session ID' },
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
                attendanceId: { type: 'string', format: 'uuid' },
                userId: { type: 'string', format: 'uuid' },
                tenantId: { type: 'string', format: 'uuid' },
                punchInAt: { type: 'string' },
                punchOutAt: { type: 'string', nullable: true },
                totalRoadDistanceKm: { type: 'number' },
                pointCount: { type: 'number' },
                polyline: {
                  type: 'array',
                  items: {
                    type: 'array',
                    items: { type: 'number' },
                  },
                },
                stopovers: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      lat: { type: 'number' },
                      lng: { type: 'number' },
                      address: { type: 'string', nullable: true },
                      arrivedAt: { type: 'string' },
                      departedAt: { type: 'string' },
                      dwellMinutes: { type: 'number' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    handler: handleGetRoute,
  });
};

export default trackingRoutes;
