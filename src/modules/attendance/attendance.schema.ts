import { z } from 'zod';

export const punchInSchema = z.object({
  lat: z.number().min(-90).max(90, 'Latitude must be between -90 and 90'),
  lng: z.number().min(-180).max(180, 'Longitude must be between -180 and 180'),
  accuracy: z.number().positive('Accuracy must be positive').max(100, 'GPS accuracy too low (accuracy must be <= 100m)'),
  timestamp: z.string().datetime().optional(),
});

export const punchOutSchema = z.object({
  attendance_id: z.string().uuid().optional(),
  lat: z.number().min(-90).max(90, 'Latitude must be between -90 and 90'),
  lng: z.number().min(-180).max(180, 'Longitude must be between -180 and 180'),
  accuracy: z.number().positive('Accuracy must be positive').max(100, 'GPS accuracy too low (accuracy must be <= 100m)'),
  timestamp: z.string().datetime().optional(),
});

export type PunchInInput = z.infer<typeof punchInSchema>;
export type PunchOutInput = z.infer<typeof punchOutSchema>;
