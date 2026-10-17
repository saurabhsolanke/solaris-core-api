import { query } from '../../config/database';
import { reverseGeocode } from '../../utils/geocoding';

interface PingRow {
  id: number;
  lat: number;
  lng: number;
  speed: number;
  accuracy: number;
  recorded_at: Date;
}

interface StopoverCluster {
  anchorLat: number;
  anchorLng: number;
  lats: number[];
  lngs: number[];
  arrivedAt: Date;
  departedAt: Date;
  pingCount: number;
}

/**
 * Calculates Great-Circle distance in meters between two WGS-84 coordinates
 */
export function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export class StopoverService {
  /**
   * Evaluates consecutive pings for an employee session to detect stopovers (dwell time).
   * Sequential readings within a 50-meter radius for > 10 minutes at speed < 2 km/h
   * are upserted into stopover_events.
   */
  async evaluateStopovers(
    tenantId: string,
    userId: string,
    attendanceId?: string | null
  ): Promise<number> {
    // 1. Fetch sequential pings for the employee / attendance session ordered chronologically
    let pingsQuery = `
      SELECT 
        id, 
        ST_Y(geom) as lat, 
        ST_X(geom) as lng, 
        COALESCE(speed, 0.0) as speed, 
        accuracy, 
        recorded_at
      FROM location_pings
      WHERE tenant_id = $1 AND user_id = $2
    `;
    const params: unknown[] = [tenantId, userId];

    if (attendanceId) {
      pingsQuery += ` AND attendance_id = $3`;
      params.push(attendanceId);
    }

    pingsQuery += ` ORDER BY recorded_at ASC`;

    const { rows: pings } = await query<PingRow>(pingsQuery, params);

    if (pings.length < 2) {
      return 0; // Not enough points to detect a duration
    }

    const clusters: StopoverCluster[] = [];
    let currentCluster: StopoverCluster | null = null;

    // 2. Cluster sequential pings
    for (const ping of pings) {
      const pingTime = new Date(ping.recorded_at);
      const isSlow = ping.speed < 2.0; // speed < 2 km/h

      if (!currentCluster) {
        if (isSlow) {
          // Initialize candidate cluster
          currentCluster = {
            anchorLat: ping.lat,
            anchorLng: ping.lng,
            lats: [ping.lat],
            lngs: [ping.lng],
            arrivedAt: pingTime,
            departedAt: pingTime,
            pingCount: 1,
          };
        }
      } else {
        // Evaluate distance from cluster anchor
        const distFromAnchor = calculateDistanceMeters(
          currentCluster.anchorLat,
          currentCluster.anchorLng,
          ping.lat,
          ping.lng
        );

        // Within 50-meter bounding radius and speed < 2 km/h
        if (distFromAnchor <= 50.0 && isSlow) {
          currentCluster.lats.push(ping.lat);
          currentCluster.lngs.push(ping.lng);
          currentCluster.departedAt = pingTime;
          currentCluster.pingCount += 1;
        } else {
          // Point broke the stopover radius or exceeded speed limit.
          // Evaluate current cluster dwell duration.
          const dwellMs = currentCluster.departedAt.getTime() - currentCluster.arrivedAt.getTime();
          const dwellMinutes = dwellMs / (1000 * 60);

          if (dwellMinutes >= 10.0) {
            clusters.push(currentCluster);
          }

          // Reset cluster
          currentCluster = isSlow
            ? {
                anchorLat: ping.lat,
                anchorLng: ping.lng,
                lats: [ping.lat],
                lngs: [ping.lng],
                arrivedAt: pingTime,
                departedAt: pingTime,
                pingCount: 1,
              }
            : null;
        }
      }
    }

    // Check trailing cluster
    if (currentCluster) {
      const dwellMs = currentCluster.departedAt.getTime() - currentCluster.arrivedAt.getTime();
      const dwellMinutes = dwellMs / (1000 * 60);
      if (dwellMinutes >= 10.0) {
        clusters.push(currentCluster);
      }
    }

    if (clusters.length === 0) {
      return 0;
    }

    let detectedCount = 0;

    // 3. Upsert detected clusters into stopover_events using PostGIS ST_DWithin check
    for (const cluster of clusters) {
      const centroidLat =
        cluster.lats.reduce((sum, lat) => sum + lat, 0) / cluster.lats.length;
      const centroidLng =
        cluster.lngs.reduce((sum, lng) => sum + lng, 0) / cluster.lngs.length;
      const dwellMinutes = Math.max(
        10,
        Math.round((cluster.departedAt.getTime() - cluster.arrivedAt.getTime()) / (1000 * 60))
      );

      // Check if an existing stopover event overlaps this spatial position and time window
      const existingQuery = `
        SELECT id, arrived_at, departed_at 
        FROM stopover_events
        WHERE tenant_id = $1 
          AND user_id = $2
          AND ST_DWithin(
            geom::geography, 
            ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, 
            50.0
          )
          AND arrived_at <= $5
          AND departed_at >= $6
        LIMIT 1
      `;

      const { rows: existing } = await query<{ id: string; arrived_at: Date; departed_at: Date }>(
        existingQuery,
        [tenantId, userId, centroidLng, centroidLat, cluster.departedAt, cluster.arrivedAt]
      );

      if (existing.length > 0 && existing[0]) {
        // Update existing stopover event's departure time and dwell minutes
        const existingEvent = existing[0];
        const newDeparted = cluster.departedAt > new Date(existingEvent.departed_at) 
          ? cluster.departedAt 
          : existingEvent.departed_at;
        const newArrived = cluster.arrivedAt < new Date(existingEvent.arrived_at) 
          ? cluster.arrivedAt 
          : existingEvent.arrived_at;
        const updatedDwell = Math.round(
          (new Date(newDeparted).getTime() - new Date(newArrived).getTime()) / (1000 * 60)
        );

        await query(
          `UPDATE stopover_events 
           SET departed_at = $1, dwell_minutes = $2
           WHERE id = $3`,
          [newDeparted, updatedDwell, existingEvent.id]
        );
      } else {
        // Reverse-geocode address for the stopover centroid
        const address = await reverseGeocode(centroidLat, centroidLng);

        // Insert new stopover event
        await query(
          `INSERT INTO stopover_events (
            tenant_id, 
            user_id, 
            attendance_id, 
            geom, 
            address, 
            arrived_at, 
            departed_at, 
            dwell_minutes
          ) VALUES (
            $1, $2, $3, 
            ST_SetSRID(ST_MakePoint($4, $5), 4326), 
            $6, $7, $8, $9
          )`,
          [
            tenantId,
            userId,
            attendanceId || null,
            centroidLng,
            centroidLat,
            address,
            cluster.arrivedAt,
            cluster.departedAt,
            dwellMinutes,
          ]
        );
        detectedCount++;
      }
    }

    return detectedCount;
  }
}

export const stopoverService = new StopoverService();
