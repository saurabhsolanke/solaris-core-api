import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { handleLogin, handleGetMe } from './auth.controller';

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
          properties: {
            email: {
              type: 'string',
              format: 'email',
              description: 'Registered user email address (e.g. agent.rahul@solanke.internal)',
            },
            password: {
              type: 'string',
              description: 'Password (optional in dev token generation)',
            },
            sub: {
              type: 'string',
              format: 'uuid',
              description: 'User ID UUID (optional, can be passed directly for dev token generation)',
            },
            tenant_id: {
              type: 'string',
              format: 'uuid',
              description: 'Tenant ID UUID (optional if email is unique)',
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
            description: 'Login successful. Returns Bearer token and user identity.',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
              token: {
                type: 'string',
                description: 'JWT Bearer token to include in Authorization header',
              },
              data: {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  tenant_id: { type: 'string', format: 'uuid' },
                  email: { type: 'string' },
                  full_name: { type: 'string' },
                  role: { type: 'string' },
                  is_active: { type: 'boolean' },
                  tenant: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      company_name: { type: 'string' },
                      subdomain: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
          400: {
            description: 'Validation Error',
            type: 'object',
            properties: {
              statusCode: { type: 'number' },
              error: { type: 'string' },
              message: { type: 'string' },
            },
          },
          401: {
            description: 'Unauthorized / Authentication Failure',
            type: 'object',
            properties: {
              statusCode: { type: 'number' },
              error: { type: 'string' },
              message: { type: 'string' },
            },
          },
          404: {
            description: 'User Not Found',
            type: 'object',
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
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  tenant_id: { type: 'string', format: 'uuid' },
                  email: { type: 'string' },
                  full_name: { type: 'string' },
                  role: { type: 'string' },
                  is_active: { type: 'boolean' },
                  tenant: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      company_name: { type: 'string' },
                      subdomain: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
          401: {
            description: 'Unauthorized - Missing or invalid Bearer JWT',
            type: 'object',
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
