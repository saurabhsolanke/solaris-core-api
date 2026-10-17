import crypto from 'crypto';
import { query } from '../../config/database';
import { reverseGeocode } from '../../utils/geocoding';
import { stopoverService } from '../stopover/stopover.service';
import { PunchInInput, PunchOutInput } from './attendance.schema';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Enriched user + tenant context attached to every attendance response */
export interface AttendanceActor {
  user_id: string;
  full_name: string;
  email: string;
  role: string;
  tenant_id: string;
  tenant_name: string;    // e.g. "Solanke Logistics & Operations"
  tenant_subdomain: string; // e.g. "solanke"
}

export interface AttendanceRecord {
  id: string;
  tenant_id: string;
  user_id: string;
  punch_in_at: Date;
  punch_in_address: string | null;
  punch_in_lat: number;
  punch_in_lng: number;
  punch_out_at: Date | null;
  punch_out_address: string | null;
  punch_out_lat: number | null;
  punch_out_lng: number | null;
  total_distance_km: number;
  created_at: Date;
  // Enriched identity fields joined from users + tenants tables
  full_name: string;
  email: string;
  role: string;
  tenant_name: string;
  tenant_subdomain: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

export class AttendanceService {
  /**
   * Records employee punch-in with geospatial validation and reverse geocoding.
   * The response includes full user identity (name, email, role) and tenant
   * info (company_name, subdomain) so consumers can immediately identify
   * who logged in from which organisation.
   */
  async punchIn(userId: string, tenantId: string, input: PunchInInput): Promise<AttendanceRecord> {
    // 1. Check if user already has an active attendance session
    const activeQuery = `
      SELECT id, punch_in_at 
      FROM attendance 
      WHERE tenant_id = $1 AND user_id = $2 AND punch_out_at IS NULL 
      LIMIT 1
    `;
    const { rows: existing } = await query<{ id: string; punch_in_at: Date }>(activeQuery, [tenantId, userId]);

    if (existing.length > 0 && existing[0]) {
      const err = new Error(`An active punch-in session already exists (ID: ${existing[0].id}, punched in at ${existing[0].punch_in_at})`);
      (err as { statusCode?: number }).statusCode = 409;
      throw err;
    }

    // 2. Reverse geocode location
    const address = await reverseGeocode(input.lat, input.lng);
    const punchInTime = input.timestamp ? new Date(input.timestamp) : new Date();

    // 3. Insert attendance record, then JOIN users + tenants to enrich response
    //    in a single round-trip using a CTE.
    const insertQuery = `
      WITH inserted AS (
        INSERT INTO attendance (
          tenant_id, 
          user_id, 
          punch_in_at, 
          punch_in_location, 
          punch_in_address
        ) VALUES (
          $1, $2, $3, 
          ST_SetSRID(ST_MakePoint($4, $5), 4326), 
          $6
        )
        RETURNING 
          id, 
          tenant_id, 
          user_id, 
          punch_in_at, 
          punch_in_address, 
          ST_Y(punch_in_location) AS punch_in_lat, 
          ST_X(punch_in_location) AS punch_in_lng, 
          punch_out_at, 
          punch_out_address, 
          total_distance_km::float AS total_distance_km, 
          created_at
      )
      SELECT
        a.*,
        u.full_name,
        u.email,
        u.role,
        t.company_name  AS tenant_name,
        t.subdomain     AS tenant_subdomain
      FROM inserted a
      JOIN users   u ON u.id = a.user_id
      JOIN tenants t ON t.id = a.tenant_id
    `;

    const { rows } = await query<AttendanceRecord>(insertQuery, [
      tenantId,
      userId,
      punchInTime,
      input.lng,
      input.lat,
      address,
    ]);

    const record = rows[0]!;

    // 4. Also register the punch-in coordinate as the first location ping
    const clientUuid = crypto.randomUUID();
    await query(
      `INSERT INTO location_pings (
        client_uuid, tenant_id, user_id, attendance_id, geom, accuracy, speed, recorded_at
      ) VALUES (
        $1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326), $7, 0.0, $8
      ) ON CONFLICT (client_uuid) DO NOTHING`,
      [clientUuid, tenantId, userId, record.id, input.lng, input.lat, input.accuracy, punchInTime]
    );

    return record;
  }

  /**
   * Records employee punch-out, computes road mileage via PostGIS, and updates the record.
   * Response is enriched with user + tenant identity same as punch-in.
   */
  async punchOut(userId: string, tenantId: string, input: PunchOutInput): Promise<AttendanceRecord> {
    // 1. Locate the active attendance session
    let targetId = input.attendance_id;

    if (!targetId) {
      const activeQuery = `
        SELECT id FROM attendance 
        WHERE tenant_id = $1 AND user_id = $2 AND punch_out_at IS NULL 
        ORDER BY punch_in_at DESC 
        LIMIT 1
      `;
      const { rows } = await query<{ id: string }>(activeQuery, [tenantId, userId]);
      if (rows.length === 0 || !rows[0]) {
        const err = new Error('No active attendance punch-in session found to punch out from');
        (err as { statusCode?: number }).statusCode = 404;
        throw err;
      }
      targetId = rows[0].id;
    } else {
      // Verify attendance exists and belongs to this user and tenant
      const checkQuery = `SELECT id FROM attendance WHERE id = $1 AND tenant_id = $2 AND user_id = $3`;
      const { rows } = await query<{ id: string }>(checkQuery, [targetId, tenantId, userId]);
      if (rows.length === 0) {
        const err = new Error('Attendance session not found or does not belong to this employee');
        (err as { statusCode?: number }).statusCode = 404;
        throw err;
      }
    }

    const punchOutTime = input.timestamp ? new Date(input.timestamp) : new Date();

    // 2. Reverse geocode punch-out location
    const address = await reverseGeocode(input.lat, input.lng);

    // 3. Insert the final punch-out ping into location_pings
    const closingUuid = crypto.randomUUID();
    await query(
      `INSERT INTO location_pings (
        client_uuid, tenant_id, user_id, attendance_id, geom, accuracy, speed, recorded_at
      ) VALUES (
        $1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326), $7, 0.0, $8
      ) ON CONFLICT (client_uuid) DO NOTHING`,
      [closingUuid, tenantId, userId, targetId, input.lng, input.lat, input.accuracy, punchOutTime]
    );

    // 4. Calculate total distance traveled via PostGIS
    const distanceQuery = `
      SELECT 
        COALESCE(
          ROUND((ST_Length(ST_MakeLine(geom ORDER BY recorded_at ASC)::geography) / 1000.0)::numeric, 2),
          0.00
        ) AS total_distance_km
      FROM location_pings 
      WHERE attendance_id = $1
      HAVING count(geom) >= 2
    `;

    const { rows: distRows } = await query<{ total_distance_km: number }>(distanceQuery, [targetId]);
    const totalDistanceKm = distRows.length > 0 && distRows[0] ? Number(distRows[0].total_distance_km) : 0.00;

    // 5. Update attendance record, then JOIN users + tenants to enrich response
    const updateQuery = `
      WITH updated AS (
        UPDATE attendance 
        SET 
          punch_out_at       = $1, 
          punch_out_location = ST_SetSRID(ST_MakePoint($2, $3), 4326), 
          punch_out_address  = $4, 
          total_distance_km  = $5
        WHERE id = $6 AND tenant_id = $7
        RETURNING 
          id, 
          tenant_id, 
          user_id, 
          punch_in_at, 
          punch_in_address, 
          ST_Y(punch_in_location)  AS punch_in_lat, 
          ST_X(punch_in_location)  AS punch_in_lng, 
          punch_out_at, 
          punch_out_address, 
          ST_Y(punch_out_location) AS punch_out_lat, 
          ST_X(punch_out_location) AS punch_out_lng, 
          total_distance_km::float AS total_distance_km, 
          created_at
      )
      SELECT
        a.*,
        u.full_name,
        u.email,
        u.role,
        t.company_name  AS tenant_name,
        t.subdomain     AS tenant_subdomain
      FROM updated a
      JOIN users   u ON u.id = a.user_id
      JOIN tenants t ON t.id = a.tenant_id
    `;

    const { rows: updatedRows } = await query<AttendanceRecord>(updateQuery, [
      punchOutTime,
      input.lng,
      input.lat,
      address,
      totalDistanceKm,
      targetId,
      tenantId,
    ]);

    // 6. Trigger final stopover evaluation for any remaining unfinalized clusters
    stopoverService.evaluateStopovers(tenantId, userId, targetId).catch((err) => {
      console.error('⚠️ Background stopover detection error on punch-out:', err);
    });

    return updatedRows[0]!;
  }
}

export const attendanceService = new AttendanceService();
