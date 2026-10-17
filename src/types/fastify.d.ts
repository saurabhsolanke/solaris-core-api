import { FastifyRequest, FastifyReply } from 'fastify';
import { UserRole } from './database';

export interface AuthUserContext {
  id: string; // user id (sub in JWT)
  tenantId: string; // tenant_id in JWT
  role: UserRole; // 'ADMIN' | 'EMPLOYEE'
  email?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUserContext;
  }

  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (role: UserRole) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string;
      tenant_id: string;
      role: UserRole;
      email?: string;
      iat?: number;
      exp?: number;
    };
    user: AuthUserContext;
  }
}
