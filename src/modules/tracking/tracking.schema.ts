import { z } from 'zod';

export const locationPingItemSchema = z.object({
  client_uuid: z.string().uuid('client_uuid must be a valid UUIDv4'),
  lat: z.number().min(-90).max(90, 'Latitude must be between -90 and 90'),
  lng: z.number().min(-180).max(180, 'Longitude must be between -180 and 180'),
  accuracy: z.number().positive('Accuracy must be positive'),
  speed: z.number().min(0, 'Speed must be non-negative').default(0),
  recorded_at: z.string().datetime('recorded_at must be an ISO 8601 string'),
});

export const batchIngestSchema = z.object({
  attendance_id: z.string().uuid().optional(),
  pings: z.array(locationPingItemSchema).min(1, 'Batch must contain at least 1 ping').max(500, 'Batch exceeds limit of 500 pings'),
});

export const routeParamSchema = z.object({
  id: z.string().uuid('Attendance ID must be a valid UUID'),
});

export type LocationPingItem = z.infer<typeof locationPingItemSchema>;
export type BatchIngestInput = z.infer<typeof batchIngestSchema>;
