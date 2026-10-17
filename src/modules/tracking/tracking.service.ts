import { query } from '../../config/database';
import { RealtimeBroadcaster } from '../../plugins/supabase';
import { stopoverService } from '../stopover/stopover.service';
import { BatchIngestInput, LocationPingItem } from './tracking.schema';
import { UserRole } from '../../types/database';

export interface IngestBatchResult {
  receivedCount: number;
  acceptedCount: number;
  rejectedDriftCount: number;
  insertedCount: number;
  latestPing?: {
    lat: number;
    lng: number;
    speed: number;
    accuracy: number;
    recordedAt: string;
  };
}

export interface RouteAnalysisResult {
  attendanceId: string;
  userId: string;
  tenantId: string;
  punchInAt: Date;
  punchOutAt: Date | null;
  totalRoadDistanceKm: number;
  pointCount: number;
  polyline: [number, number][]; // Leaflet format: [[lat, lng], ...]
  points: Array<{
    lat: number;
    lng: number;
    speed: number;
    accuracy: number;
    recordedAt: Date;
  }>;
  stopovers: Array<{
    id: string;
    lat: number;
    lng: number;
    address: string | null;
    arrivedAt: Date;
    departedAt: Date;
    dwellMinutes: number;
  }>;
}

export class TrackingService {
  /**
   * High-throughput idempotent ingestion of batch GPS pings.
   * Filters out drift points (accuracy > 30m), writes to PostGIS with ON CONFLICT DO NOTHING,
   * dispatches real-time position to Supabase channel, and triggers stopover evaluation.
   */
  async ingestBatch(
    userId: string,
    tenantId: string,
    payload: BatchIngestInput,
    realtime?: RealtimeBroadcaster
  ): Promise<IngestBatchResult> {
    const { pings, attendance_id: attendanceId } = payload;
    const receivedCount = pings.length;

    // 1. Filter out invalid drift points where accuracy > 30 meters
    const validPings: LocationPingItem[] = [];
    let rejectedDriftCount = 0;

    for (const ping of pings) {
      if (ping.accuracy > 30.0) {
        rejectedDriftCount++;
      } else {
        validPings.push(ping);
      }
    }

    if (validPings.length === 0) {
      return {
        receivedCount,
        acceptedCount: 0,
        rejectedDriftCount,
        insertedCount: 0,
      };
    }

    // 2. Build high-performance multi-row parameterized SQL query
    // ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326), $7, $8, $9)
    const valuePlaceholders: string[] = [];
    const queryParams: unknown[] = [];
    let paramIndex = 1;

    for (const ping of validPings) {
      valuePlaceholders.push(
        `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, ST_SetSRID(ST_MakePoint($${paramIndex + 4}, $${paramIndex + 5}), 4326), $${paramIndex + 6}, $${paramIndex + 7}, $${paramIndex + 8})`
      );

      queryParams.push(
        ping.client_uuid,
        tenantId,
        userId,
        attendanceId || null,
        ping.lng,
        ping.lat,
        ping.accuracy,
        ping.speed ?? 0.0,
        new Date(ping.recorded_at)
      );

      paramIndex += 8;
    }

    const bulkInsertQuery = `
      INSERT INTO location_pings (
        client_uuid,
        tenant_id,
        user_id,
        attendance_id,
        geom,
        accuracy,
        speed,
        recorded_at
      )
      VALUES ${valuePlaceholders.join(', ')}
      ON CONFLICT (client_uuid) DO NOTHING
      RETURNING id, client_uuid
    `;

    const { rows: insertedRows } = await query<{ id: number; client_uuid: string }>(
      bulkInsertQuery,
      queryParams
    );

    // 3. Find the chronologically latest ping in this batch for live broadcasting
    const latestPing = validPings.reduce((latest, current) => {
      return new Date(current.recorded_at) > new Date(latest.recorded_at) ? current : latest;
    }, validPings[0]!);

    // 4. Trigger Supabase Realtime broadcast on channel `tenant:${tenantId}`
    if (realtime) {
      realtime.broadcastLocation(tenantId, {
        userId,
        tenantId,
        lat: latestPing.lat,
        lng: latestPing.lng,
        speed: latestPing.speed,
        accuracy: latestPing.accuracy,
        recordedAt: latestPing.recorded_at,
      }).catch((err) => {
        console.error('⚠️ Realtime broadcast error:', err);
      });
    }

    // 5. Asynchronously trigger stop detection logic in background
    stopoverService.evaluateStopovers(tenantId, userId, attendanceId).catch((err) => {
      console.error('⚠️ Background stopover detection error:', err);
    });

    return {
      receivedCount,
      acceptedCount: validPings.length,
      rejectedDriftCount,
      insertedCount: insertedRows.length,
      latestPing: {
        lat: latestPing.lat,
        lng: latestPing.lng,
        speed: latestPing.speed,
        accuracy: latestPing.accuracy,
        recordedAt: latestPing.recorded_at,
      },
    };
  }

  /**
   * Retrieves route analytics, PostGIS road distance, Leaflet-ready polyline coordinates,
   * and all stopover events for a given attendance session.
   */
  async getAttendanceRoute(
    attendanceId: string,
    tenantId: string,
    requestingUserId: string,
    requestingRole: UserRole
  ): Promise<RouteAnalysisResult> {
    // 1. Verify attendance session exists and belongs to the caller's tenant
    const attendanceQuery = `
      SELECT id, user_id, tenant_id, punch_in_at, punch_out_at, total_distance_km::float as total_distance_km
      FROM attendance
      WHERE id = $1 AND tenant_id = $2
    `;
    const { rows: attRows } = await query<{
      id: string;
      user_id: string;
      tenant_id: string;
      punch_in_at: Date;
      punch_out_at: Date | null;
      total_distance_km: number;
    }>(attendanceQuery, [attendanceId, tenantId]);

    if (attRows.length === 0 || !attRows[0]) {
      const err = new Error('Attendance record not found');
      (err as { statusCode?: number }).statusCode = 404;
      throw err;
    }

    const attendance = attRows[0];

    // Restrict employees to only viewing their own routes
    if (requestingRole !== 'ADMIN' && attendance.user_id !== requestingUserId) {
      const err = new Error('Unauthorized to view route for another employee');
      (err as { statusCode?: number }).statusCode = 403;
      throw err;
    }

    // 2. Calculate accurate road mileage via PostGIS
    // ST_Length(ST_MakeLine(geom ORDER BY recorded_at ASC)::geography) / 1000.0
    const distanceQuery = `
      SELECT 
        COALESCE(
          ROUND((ST_Length(ST_MakeLine(geom ORDER BY recorded_at ASC)::geography) / 1000.0)::numeric, 2),
          0.00
        ) AS road_km
      FROM location_pings
      WHERE attendance_id = $1
      HAVING count(geom) >= 2
    `;
    const { rows: distRows } = await query<{ road_km: number }>(distanceQuery, [attendanceId]);
    const roadKm = distRows.length > 0 && distRows[0] ? Number(distRows[0].road_km) : attendance.total_distance_km;

    // 3. Fetch ordered coordinates for Leaflet polyline rendering
    const pointsQuery = `
      SELECT 
        ST_Y(geom) as lat, 
        ST_X(geom) as lng, 
        COALESCE(speed, 0.0) as speed, 
        accuracy, 
        recorded_at
      FROM location_pings
      WHERE attendance_id = $1
      ORDER BY recorded_at ASC
    `;
    const { rows: points } = await query<{
      lat: number;
      lng: number;
      speed: number;
      accuracy: number;
      recorded_at: Date;
    }>(pointsQuery, [attendanceId]);

    // Format coordinates for Leaflet: [[lat, lng], [lat, lng], ...]
    const polyline: [number, number][] = points.map((p) => [p.lat, p.lng]);

    // 4. Retrieve all associated stopover events
    const stopoverQuery = `
      SELECT 
        id, 
        ST_Y(geom) as lat, 
        ST_X(geom) as lng, 
        address, 
        arrived_at, 
        departed_at, 
        dwell_minutes
      FROM stopover_events
      WHERE attendance_id = $1
      ORDER BY arrived_at ASC
    `;
    const { rows: stopovers } = await query<{
      id: string;
      lat: number;
      lng: number;
      address: string | null;
      arrived_at: Date;
      departed_at: Date;
      dwell_minutes: number;
    }>(stopoverQuery, [attendanceId]);

    return {
      attendanceId: attendance.id,
      userId: attendance.user_id,
      tenantId: attendance.tenant_id,
      punchInAt: attendance.punch_in_at,
      punchOutAt: attendance.punch_out_at,
      totalRoadDistanceKm: roadKm,
      pointCount: points.length,
      polyline,
      points: points.map((p) => ({
        lat: p.lat,
        lng: p.lng,
        speed: p.speed,
        accuracy: p.accuracy,
        recordedAt: p.recorded_at,
      })),
      stopovers: stopovers.map((s) => ({
        id: s.id,
        lat: s.lat,
        lng: s.lng,
        address: s.address,
        arrivedAt: s.arrived_at,
        departedAt: s.departed_at,
        dwellMinutes: s.dwell_minutes,
      })),
    };
  }
}

export const trackingService = new TrackingService();
