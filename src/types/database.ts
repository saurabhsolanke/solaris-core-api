import { Generated } from 'kysely';

export type UserRole = 'ADMIN' | 'EMPLOYEE';

export interface TenantsTable {
  id: Generated<string>;
  company_name: string;
  subdomain: string;
  created_at: Generated<Date>;
}

export interface UsersTable {
  id: Generated<string>;
  tenant_id: string;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
}

export interface AttendanceTable {
  id: Generated<string>;
  tenant_id: string;
  user_id: string;
  punch_in_at: Generated<Date>;
  punch_in_location: unknown; // PostGIS Point geometry
  punch_in_address: string | null;
  punch_out_at: Date | null;
  punch_out_location: unknown | null; // PostGIS Point geometry
  punch_out_address: string | null;
  total_distance_km: Generated<number>;
  created_at: Generated<Date>;
}

export interface LocationPingsTable {
  id: Generated<number>;
  client_uuid: string;
  tenant_id: string;
  user_id: string;
  attendance_id: string | null;
  recorded_at: Date;
  geom: unknown; // PostGIS Point geometry
  accuracy: number;
  speed: number | null;
  created_at: Generated<Date>;
}

export interface StopoverEventsTable {
  id: Generated<string>;
  tenant_id: string;
  user_id: string;
  attendance_id: string | null;
  geom: unknown; // PostGIS Point geometry
  address: string | null;
  arrived_at: Date;
  departed_at: Date;
  dwell_minutes: number;
  created_at: Generated<Date>;
}

export interface UserActivityLogsTable {
  id: Generated<number>;
  tenant_id: string;
  user_id: string;
  event_type: 'LOGIN' | 'PUNCH_IN' | 'PUNCH_OUT' | 'BATCH_INGEST' | 'ROUTE_VIEW';
  ip_address: string | null;
  user_agent: string | null;
  endpoint: string | null;
  method: string | null;
  status_code: number | null;
  metadata: Record<string, unknown>;
  logged_at: Generated<Date>;
}

export interface DatabaseSchema {
  tenants: TenantsTable;
  users: UsersTable;
  attendance: AttendanceTable;
  location_pings: LocationPingsTable;
  stopover_events: StopoverEventsTable;
  user_activity_logs: UserActivityLogsTable;
}
