import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { handleLogin, handleGetMe } from './auth.controller';

const tenantSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    id: { type: 'string', format: 'uuid' },
    company_name: { type: 'string' },
    companyName: { type: 'string' },
    subdomain: { type: 'string' },
    slug: { type: 'string' },
    name: { type: 'string' },
  },
};

const userSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    id: { type: 'string', format: 'uuid' },
    userId: { type: 'string', format: 'uuid' },
    tenant_id: { type: 'string', format: 'uuid' },
    tenantId: { type: 'string', format: 'uuid' },
    email: { type: 'string' },
    full_name: { type: 'string' },
    fullName: { type: 'string' },
    role: { type: 'string' },
    is_active: { type: 'boolean' },
    isActive: { type: 'boolean' },
    tenant: tenantSchema,
  },
};

const authRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // ── 1. POST /login (Public endpoint) ────────────────────────────────────────
  fastify.post(
    '/login',
    {
      schema: {
        description:
          'Authenticate using email (or tenant credentials) to obtain a signed multi-tenant Bearer JWT for use in authorization headers.',
        tags: ['Authentication'],
        body: {
          type: 'object',
          additionalProperties: true,
          properties: {
            email: {
              type: 'string',
              format: 'email',
              description: 'Registered user email address (e.g. saurabh.admin@solanke.internal)',
            },
            password: {
              type: 'string',
              description: 'Password (optional in dev token generation)',
            },
            tenant_slug: {
              type: 'string',
              description: 'Tenant slug / subdomain identifier',
            },
            subdomain: {
              type: 'string',
              description: 'Tenant subdomain identifier',
            },
            sub: {
              type: 'string',
              format: 'uuid',
              description: 'User ID UUID (optional)',
            },
            tenant_id: {
              type: 'string',
              format: 'uuid',
              description: 'Tenant ID UUID (optional)',
            },
            role: {
              type: 'string',
              enum: ['ADMIN', 'EMPLOYEE'],
              description: 'User role (ADMIN or EMPLOYEE)',
            },
          },
        },
        response: {
          200: {
            description: 'Login successful. Returns Bearer token and user identity in universal client format.',
            type: 'object',
            additionalProperties: true,
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
              token: {
                type: 'string',
                description: 'JWT Bearer token',
              },
              accessToken: {
                type: 'string',
                description: 'Alias for JWT Bearer token',
              },
              user: userSchema,
              data: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  ...userSchema.properties,
                  user: userSchema,
                  token: { type: 'string' },
                  accessToken: { type: 'string' },
                },
              },
            },
          },
          400: {
            description: 'Validation Error',
            type: 'object',
            additionalProperties: true,
            properties: {
              statusCode: { type: 'number' },
              error: { type: 'string' },
              message: { type: 'string' },
            },
          },
          401: {
            description: 'Unauthorized / Authentication Failure',
            type: 'object',
            additionalProperties: true,
            properties: {
              statusCode: { type: 'number' },
              error: { type: 'string' },
              message: { type: 'string' },
            },
          },
          404: {
            description: 'User Not Found',
            type: 'object',
            additionalProperties: true,
            properties: {
              statusCode: { type: 'number' },
              error: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    handleLogin
  );

  // ── 2. GET /me (Protected endpoint) ─────────────────────────────────────────
  fastify.get(
    '/me',
    {
      preHandler: [fastify.authenticate],
      schema: {
        description: 'Get profile details and tenant information of the currently authenticated user.',
        tags: ['Authentication'],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            description: 'Current user profile and tenant information',
            type: 'object',
            additionalProperties: true,
            properties: {
              success: { type: 'boolean' },
              user: userSchema,
              data: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  ...userSchema.properties,
                  user: userSchema,
                },
              },
            },
          },
          401: {
            description: 'Unauthorized - Missing or invalid Bearer JWT',
            type: 'object',
            additionalProperties: true,
            properties: {
              statusCode: { type: 'number' },
              error: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    handleGetMe
  );
};

export default authRoutes;
