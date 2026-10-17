import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { handlePunchIn, handlePunchOut } from './attendance.controller';

// ── Shared actor schema (user + tenant identity) ──────────────────────────────
const actorSchema = {
  type: 'object',
  description: 'Identity of the user and tenant who performed the action',
  properties: {
    user_id:          { type: 'string', format: 'uuid',  description: 'Employee user UUID' },
    full_name:        { type: 'string',                   description: 'Employee full name' },
    email:            { type: 'string', format: 'email',  description: 'Employee email address' },
    role:             { type: 'string', enum: ['ADMIN', 'EMPLOYEE'], description: 'User role' },
    tenant_id:        { type: 'string', format: 'uuid',  description: 'Tenant UUID' },
    tenant_name:      { type: 'string',                   description: 'Tenant company name' },
    tenant_subdomain: { type: 'string',                   description: 'Tenant subdomain identifier' },
  },
};

// ── Shared session schema (attendance record data) ────────────────────────────
const sessionSchema = {
  type: 'object',
  description: 'Attendance session details',
  properties: {
    id:                { type: 'string', format: 'uuid' },
    punch_in_at:       { type: 'string', description: 'Punch-in timestamp (ISO 8601)' },
    punch_in_address:  { type: 'string', nullable: true, description: 'Reverse-geocoded punch-in address' },
    punch_in_lat:      { type: 'number', description: 'Punch-in latitude' },
    punch_in_lng:      { type: 'number', description: 'Punch-in longitude' },
    punch_out_at:      { type: 'string', nullable: true, description: 'Punch-out timestamp (ISO 8601)' },
    punch_out_address: { type: 'string', nullable: true, description: 'Reverse-geocoded punch-out address' },
    punch_out_lat:     { type: 'number', nullable: true, description: 'Punch-out latitude' },
    punch_out_lng:     { type: 'number', nullable: true, description: 'Punch-out longitude' },
    total_distance_km: { type: 'number', description: 'Total road distance in km (PostGIS ST_Length)' },
    created_at:        { type: 'string', description: 'Record creation timestamp' },
  },
};

const attendanceRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // All attendance endpoints require multi-tenant JWT authentication
  fastify.addHook('preHandler', fastify.authenticate);

  // ── POST /api/v1/attendance/punch-in ─────────────────────────────────────
  fastify.post('/punch-in', {
    schema: {
      description: 'Employee punch-in with GPS validation and reverse geocoding. Response includes full user identity (name, email, role) and tenant info (company name, subdomain) so you can immediately identify who logged in from which organisation.',
      tags: ['Attendance'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['lat', 'lng', 'accuracy'],
        properties: {
          lat:       { type: 'number', minimum: -90,  maximum: 90,  description: 'Latitude' },
          lng:       { type: 'number', minimum: -180, maximum: 180, description: 'Longitude' },
          accuracy:  { type: 'number', maximum: 100,               description: 'GPS accuracy in meters (must be ≤ 100m)' },
          timestamp: { type: 'string', format: 'date-time',         description: 'Punch-in timestamp (optional ISO string, defaults to now)' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string', description: 'Human-readable summary e.g. "Rahul Deshmukh (rahul@...) punched in from tenant Solanke Logistics"' },
            data: {
              type: 'object',
              properties: {
                actor:   actorSchema,
                session: sessionSchema,
              },
            },
          },
        },
      },
    },
    handler: handlePunchIn,
  });

  // ── POST /api/v1/attendance/punch-out ────────────────────────────────────
  fastify.post('/punch-out', {
    schema: {
      description: 'Employee punch-out with final road mileage calculation and address stamping. Response includes the same actor identity block as punch-in.',
      tags: ['Attendance'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['lat', 'lng', 'accuracy'],
        properties: {
          attendance_id: { type: 'string', format: 'uuid',  description: 'Optional: target a specific attendance session ID' },
          lat:           { type: 'number', minimum: -90,  maximum: 90,  description: 'Latitude' },
          lng:           { type: 'number', minimum: -180, maximum: 180, description: 'Longitude' },
          accuracy:      { type: 'number', maximum: 100,               description: 'GPS accuracy in meters (must be ≤ 100m)' },
          timestamp:     { type: 'string', format: 'date-time',         description: 'Punch-out timestamp (optional ISO string, defaults to now)' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string', description: 'Human-readable summary e.g. "Rahul Deshmukh punched out — 14.8 km covered"' },
            data: {
              type: 'object',
              properties: {
                actor:   actorSchema,
                session: sessionSchema,
              },
            },
          },
        },
      },
    },
    handler: handlePunchOut,
  });
};

export default attendanceRoutes;
