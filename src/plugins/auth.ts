import fp from 'fastify-plugin';
import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { env } from '../config/env';
import { UserRole } from '../types/database';
import { activityService } from '../modules/activity/activity.service';

export interface DecodedJwtClaims {
  sub: string;
  tenant_id: string;
  role: UserRole;
  email?: string;
  iat?: number;
  exp?: number;
}

const authPlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // Register @fastify/jwt
  await fastify.register(fastifyJwt, {
    secret: env.JWT_SECRET,
  });

  // Authentication preHandler hook
  fastify.decorate(
    'authenticate',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      try {
        // Verify Bearer JWT
        const decoded = await request.jwtVerify<DecodedJwtClaims>();

        // Ensure mandatory multi-tenant claims exist
        if (!decoded.sub || !decoded.tenant_id || !decoded.role) {
          return reply.status(401).send({
            statusCode: 401,
            error: 'Unauthorized',
            message: 'Invalid JWT claims: sub, tenant_id, and role are required',
          });
        }

        // Validate role
        if (decoded.role !== 'ADMIN' && decoded.role !== 'EMPLOYEE') {
          return reply.status(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: `Invalid role claim: ${decoded.role}`,
          });
        }

        // Attach verified user context to Fastify request
        request.user = {
          id: decoded.sub,
          tenantId: decoded.tenant_id,
          role: decoded.role,
          email: decoded.email,
        };

        // Fire-and-forget activity log — records every authenticated API call
        activityService.log({
          tenantId: decoded.tenant_id,
          userId: decoded.sub,
          eventType: 'LOGIN',
          ipAddress: request.ip ?? null,
          userAgent: request.headers['user-agent'] ?? null,
          endpoint: request.url ?? null,
          method: request.method ?? null,
          statusCode: null, // Response code not yet known at preHandler stage
          metadata: { role: decoded.role, email: decoded.email },
        }).catch(() => { /* non-blocking */ });
      } catch (err: unknown) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: err instanceof Error ? err.message : 'Invalid or expired authentication token',
        });
      }
    }
  );

  // Role authorization hook factory
  fastify.decorate(
    'requireRole',
    (requiredRole: UserRole) => {
      return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
        // First ensure request is authenticated
        if (!request.user) {
          await fastify.authenticate(request, reply);
          if (reply.sent) return;
        }

        if (request.user.role !== requiredRole && request.user.role !== 'ADMIN') {
          return reply.status(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: `Access denied. Requires ${requiredRole} privileges`,
          });
        }
      };
    }
  );
};

export default fp(authPlugin, {
  name: 'auth-plugin',
});
