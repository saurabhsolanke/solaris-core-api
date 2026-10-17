import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import authPlugin from './plugins/auth';
import supabasePlugin from './plugins/supabase';
import attendanceRoutes from './modules/attendance/attendance.routes';
import trackingRoutes from './modules/tracking/tracking.routes';
import activityRoutes from './modules/activity/activity.routes';
import authRoutes from './modules/auth/auth.routes';
import { handleGetRoute } from './modules/tracking/tracking.controller';
import { checkDatabaseConnection } from './config/database';
import { env } from './config/env';

export async function buildApp(): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: {
      level: env.NODE_ENV === 'test' ? 'silent' : env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
    bodyLimit: 10 * 1024 * 1024, // 10MB limit for bulk telemetry pings
  });

  // 1. Cross-Origin Resource Sharing (CORS)
  await fastify.register(cors, {
    origin: true, // Allow all origins in dev, configurable for dashboards
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  // 2. OpenAPI / Swagger Documentation
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'SOLARIS Core API',
        description:
          'Solanke Operations, Leave, Attendance, Route & Intelligence System - High-Throughput Geospatial Telemetry & Workforce Backend',
        version: '1.0.0',
        contact: {
          name: 'Saurabh Solanke',
          email: 'solaris@solanke.internal',
        },
      },
      servers: [
        {
          url: `http://${env.HOST}:${env.PORT}`,
          description: 'Current Environment Server',
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Enter multi-tenant JWT with sub, tenant_id, and role claims',
          },
        },
      },
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });

  // 3. Register Core Plugins
  await fastify.register(authPlugin);
  await fastify.register(supabasePlugin);

  // 4. Health Check Endpoint
  fastify.get('/health', async (_request, reply) => {
    const dbStatus = await checkDatabaseConnection();
    const isHealthy = dbStatus.ok;
    return reply.status(isHealthy ? 200 : 503).send({
      status: isHealthy ? 'healthy' : 'degraded',
      service: 'SOLARIS Core API',
      timestamp: new Date().toISOString(),
      database: dbStatus,
      uptimeSeconds: process.uptime(),
    });
  });

  // 5. Register API v1 Module Routes
  await fastify.register(
    async (v1) => {
      // Auth routes (login, me)
      await v1.register(authRoutes, { prefix: '/auth' });

      // Attendance routes
      await v1.register(attendanceRoutes, { prefix: '/attendance' });

      // Tracking batch ingestion
      await v1.register(trackingRoutes, { prefix: '/tracking' });

      // Activity / Audit log routes
      await v1.register(activityRoutes, { prefix: '/activity' });

      // Explicit route for GET /api/v1/attendance/:id/route matching spec
      v1.get(
        '/attendance/:id/route',
        {
          preHandler: [fastify.authenticate],
          schema: {
            description: 'Get calculated road kilometers, Leaflet coordinates, and stopovers for an attendance session',
            tags: ['Attendance', 'Analytics & Maps'],
            security: [{ bearerAuth: [] }],
            params: {
              type: 'object',
              required: ['id'],
              properties: {
                id: { type: 'string', format: 'uuid' },
              },
            },
          },
        },
        handleGetRoute
      );
    },
    { prefix: '/api/v1' }
  );

  // 6. Global Error Handler
  fastify.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    const statusCode = error.statusCode || 500;
    fastify.log.error(error);

    return reply.status(statusCode).send({
      statusCode,
      error: error.name || 'InternalServerError',
      message: error.message || 'An unexpected internal server error occurred',
    });
  });

  return fastify;
}
