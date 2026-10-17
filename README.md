# SOLARIS Core API
### Solanke Operations, Leave, Attendance, Route & Intelligence System

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![Fastify](https://img.shields.io/badge/Fastify-5.2-black.svg)](https://fastify.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-336791.svg)](https://www.postgresql.org/)
[![PostGIS](https://img.shields.io/badge/PostGIS-Spatial_Extension-green.svg)](https://postgis.net/)
[![Supabase](https://img.shields.io/badge/Supabase-Realtime_Broadcast-3ECF8E.svg)](https://supabase.com/)

SOLARIS is an enterprise multi-tenant field workforce backend engineered for high-throughput continuous location telemetry, PostGIS spatial analytics, automated stopover (dwell-time) detection, and live admin dashboard broadcasting.

---

## Architecture Overview

```
                      +---------------------------------------+
                      | Mobile Workforce Device (Field Agent) |
                      +---------------------------------------+
                                  |                 |
                   (Offline / Sync)                 | (Punch In / Out)
                                  v                 v
                 +-----------------------------------------------+
                 |  Fastify API Gateway (TypeScript Strict Mode) |
                 |  - Bearer JWT Multi-Tenant Auth Guard         |
                 |  - GPS Accuracy & Drift Filtering (<=30m)     |
                 |  - Reverse Geocoding (OSM Nominatim / Fallback|
                 +-----------------------------------------------+
                                  |                 |
     (Idempotent Batch Bulk Insert|                 | (Live Position Event)
      ON CONFLICT DO NOTHING)     v                 v
           +-----------------------------+   +-----------------------------+
           | PostgreSQL 15+ with PostGIS |   |  Supabase Realtime Channel  |
           | - PostGIS Point(4326)       |   |  - tenant:${tenantId}       |
           | - Spatial GIST Indexes      |   |  - live location:update     |
           | - Tenant Row-Level Security |   +-----------------------------+
           | - ST_Length / ST_MakeLine   |                  |
           | - ST_DWithin Stop Detection |                  v
           +-----------------------------+   +-----------------------------+
                          |                  | Admin Live Tracking Map UI  |
                          v                  | (Leaflet Polyline & Markers)|
           +-----------------------------+   +-----------------------------+
           | Background Stopover Service |
           | - Radius <= 50m             |
           | - Dwell Time > 10 mins      |
           | - Speed < 2 km/h            |
           +-----------------------------+
```

---

## Key Features

1. **High-Throughput Batch Ingestion:** Optimized Fastify handlers capable of ingesting batches of up to 500 pings per request with multi-row SQL generation.
2. **Offline Idempotency:** Uses client-generated `client_uuid` with `ON CONFLICT (client_uuid) DO NOTHING` to prevent duplicate points during network drops and mobile retries.
3. **GPS Drift Elimination:** Rejects inaccurate points where `accuracy > 30m` during continuous tracking, while enforcing `accuracy <= 100m` on punch check-ins.
4. **PostGIS Road Distance Calculation:** Computes geodesic travel distance using:
   ```sql
   ST_Length(ST_MakeLine(geom ORDER BY recorded_at ASC)::geography) / 1000.0
   ```
5. **Automated Stopover / Dwell Detection:** Identifies dwell periods when sequential readings remain within a 50-meter radius (`ST_DWithin`) for > 10 minutes at `speed < 2 km/h`, saving centroid coordinates and reverse-geocoded addresses.
6. **Supabase Realtime Live Streaming:** Dispatches updates on channel `tenant:${tenantId}` for live agent marker movement on admin maps.
7. **Multi-Tenant Row-Level Security (RLS):** Isolate tenant records using JWT claims (`tenant_id = (auth.jwt() ->> 'tenant_id')::uuid`) and session variable `app.current_tenant_id`.

---

## Tech Stack

- **Runtime & Language:** Node.js (v20+ / v26+) with TypeScript in strict mode
- **Web Framework:** Fastify v5 (low overhead, high JSON throughput)
- **Database:** Supabase / PostgreSQL 15+ with PostGIS spatial extension
- **Database Access:** `pg` connection pool with PostGIS spatial queries & Kysely query builder
- **Realtime:** `@supabase/supabase-js`
- **Validation:** Zod schemas
- **API Documentation:** Swagger / OpenAPI via `@fastify/swagger` and `@fastify/swagger-ui`

---

## Directory Structure

```
solaris-core-api/
├── migrations/
│   └── 001_initial_schema.sql     # PostGIS schema, indexes, tables, & RLS policies
├── src/
│   ├── config/
│   │   ├── env.ts                 # Zod-validated environment variables
│   │   └── database.ts            # pg connection pool & PostGIS helpers
│   ├── plugins/
│   │   ├── auth.ts                # Fastify JWT multi-tenant claim verification
│   │   └── supabase.ts            # Supabase Realtime broadcast client
│   ├── modules/
│   │   ├── attendance/            # Punch-in, punch-out, reverse geocoding
│   │   │   ├── attendance.controller.ts
│   │   │   ├── attendance.routes.ts
│   │   │   ├── attendance.schema.ts
│   │   │   └── attendance.service.ts
│   │   ├── tracking/              # Batch telemetry ingestion & Leaflet route analytics
│   │   │   ├── tracking.controller.ts
│   │   │   ├── tracking.routes.ts
│   │   │   ├── tracking.schema.ts
│   │   │   └── tracking.service.ts
│   │   └── stopover/              # Stopover & dwell time detection algorithm
│   │       └── stopover.service.ts
│   ├── utils/
│   │   ├── geocoding.ts           # OpenStreetMap Nominatim reverse geocoder
│   │   └── token.ts               # Multi-tenant JWT signing utility
│   ├── types/
│   │   ├── database.ts            # Schema and Kysely type definitions
│   │   └── fastify.d.ts           # Request context type augmentation
│   ├── scripts/
│   │   ├── migrate.ts             # Migration runner
│   │   ├── seed.ts                # Demo tenant & user seeder
│   │   └── generate-token.ts      # Token generation CLI
│   ├── app.ts                     # Fastify application builder
│   └── server.ts                  # Server entry point
├── .env.example                   # Environment configuration template
├── package.json
└── tsconfig.json
```

---

## Getting Started

### 1. Environment Configuration

Copy `.env.example` to `.env` and set your credentials:

```bash
cp .env.example .env
```

Configure:
```ini
NODE_ENV=development
PORT=3000
HOST=0.0.0.0

# PostgreSQL Connection with PostGIS
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/solaris_db

# Supabase Realtime Broadcasts (optional for local mock testing)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

# JWT Multi-Tenant Secret Key
JWT_SECRET=solaris-secure-multi-tenant-jwt-signing-secret-key-32chars
```

### 2. Database Migration

Run the migration script to enable PostGIS, create tables, spatial indexes, and configure RLS:

```bash
npm run migrate
```

### 3. Seed Demo Data & Generate JWT Tokens

Run the seed script to create a demo tenant, an Admin, an Employee, and print valid Bearer tokens:

```bash
npm run seed
```

You can also generate custom JWTs at any time:
```bash
npm run generate-token <userId> <tenantId> <ADMIN|EMPLOYEE> <email>
```

### 4. Run Development Server

```bash
npm run dev
```

The server starts at `http://localhost:3000`.
- **Interactive Swagger UI:** [http://localhost:3000/docs](http://localhost:3000/docs)
- **Health Check:** [http://localhost:3000/health](http://localhost:3000/health)

---

## API Endpoints & cURL Examples

Replace `<TOKEN>` with the token generated from `npm run seed` or `npm run generate-token`.

### 1. Punch In
```bash
curl -X POST http://localhost:3000/api/v1/attendance/punch-in \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "lat": 18.5204,
    "lng": 73.8567,
    "accuracy": 15.5
  }'
```

### 2. Batch Telemetry Ingestion (Offline Idempotent)
```bash
curl -X POST http://localhost:3000/api/v1/tracking/batch \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "attendance_id": "attendance-uuid-here",
    "pings": [
      {
        "client_uuid": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        "lat": 18.5204,
        "lng": 73.8567,
        "accuracy": 12.0,
        "speed": 18.5,
        "recorded_at": "2026-10-15T09:00:00.000Z"
      },
      {
        "client_uuid": "f47ac10b-58cc-4372-a567-0e02b2c3d480",
        "lat": 18.5220,
        "lng": 73.8580,
        "accuracy": 14.2,
        "speed": 22.0,
        "recorded_at": "2026-10-15T09:02:00.000Z"
      }
    ]
  }'
```

### 3. Punch Out
```bash
curl -X POST http://localhost:3000/api/v1/attendance/punch-out \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "lat": 18.5300,
    "lng": 73.8650,
    "accuracy": 18.0
  }'
```

### 4. Fetch Route & Stopovers (Leaflet Map Ready)
```bash
curl -X GET http://localhost:3000/api/v1/attendance/<ATTENDANCE_ID>/route \
  -H "Authorization: Bearer <TOKEN>"
```

**Example Response:**
```json
{
  "success": true,
  "data": {
    "attendanceId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "totalRoadDistanceKm": 14.82,
    "pointCount": 420,
    "polyline": [
      [18.5204, 73.8567],
      [18.5220, 73.8580],
      [18.5255, 73.8612]
    ],
    "stopovers": [
      {
        "id": "e3b0c442-98fc-1c14-9afb-4c72e04f9011",
        "lat": 18.5230,
        "lng": 73.8590,
        "address": "Shivaji Nagar, Pune, Maharashtra",
        "arrivedAt": "2026-10-15T09:30:00.000Z",
        "departedAt": "2026-10-15T09:45:00.000Z",
        "dwellMinutes": 15
      }
    ]
  }
}
```

---

## Frontend Integration Snippets

### Leaflet Route Rendering (Admin Dashboard)
```javascript
// Render GPS polyline trail
const polylineLayer = L.polyline(response.data.polyline, {
  color: '#2563eb',
  weight: 5,
  opacity: 0.8
}).addTo(map);

// Add stopover markers with dwell info
response.data.stopovers.forEach(stop => {
  L.marker([stop.lat, stop.lng], { icon: stopoverIcon })
    .bindPopup(`<b>Stopover</b><br>${stop.address}<br>Dwell: ${stop.dwellMinutes} mins`)
    .addTo(map);
});

map.fitBounds(polylineLayer.getBounds());
```

### Supabase Realtime Live Subscription (Admin Dashboard)
```javascript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const channel = supabase
  .channel(`tenant:${tenantId}`)
  .on('broadcast', { event: 'location:update' }, (event) => {
    const { userId, lat, lng, speed } = event.payload;
    updateAgentMapMarker(userId, lat, lng, speed);
  })
  .subscribe();
```

---

## Production Build

```bash
npm run build
npm start
```
