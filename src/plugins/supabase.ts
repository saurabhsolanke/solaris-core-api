import fp from 'fastify-plugin';
import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env';

export interface LocationBroadcastPayload {
  userId: string;
  tenantId: string;
  lat: number;
  lng: number;
  speed: number;
  accuracy: number;
  recordedAt: string;
}

export class RealtimeBroadcaster {
  private client: SupabaseClient | null = null;
  private isConfigured = false;

  constructor() {
    if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && !env.SUPABASE_URL.includes('mock-solaris')) {
      try {
        this.client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        });
        this.isConfigured = true;
      } catch (err) {
        console.warn('⚠️ Supabase Realtime client failed to initialize:', err);
      }
    } else {
      console.log('ℹ️ Supabase Realtime running in simulated/mock mode (local development).');
    }
  }

  /**
   * Broadcasts latest telemetry coordinate to the tenant's admin dashboard channel.
   * Mobile admin dashboards subscribe to: supabase.channel(`tenant:${tenantId}`)
   */
  async broadcastLocation(tenantId: string, payload: LocationBroadcastPayload): Promise<void> {
    if (!this.isConfigured || !this.client) {
      // Mock broadcasting in development: log output for visibility
      if (env.NODE_ENV === 'development') {
        console.log(`📡 [Realtime Mock] Channel [tenant:${tenantId}] broadcast -> user ${payload.userId} at (${payload.lat}, ${payload.lng})`);
      }
      return;
    }

    try {
      const channel = this.client.channel(`tenant:${tenantId}`);
      await channel.send({
        type: 'broadcast',
        event: 'location:update',
        payload,
      });
    } catch (error) {
      console.error(`❌ Failed to broadcast to channel [tenant:${tenantId}]:`, error);
    }
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    realtime: RealtimeBroadcaster;
  }
}

const supabasePlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const broadcaster = new RealtimeBroadcaster();
  fastify.decorate('realtime', broadcaster);
};

export default fp(supabasePlugin, {
  name: 'supabase-realtime-plugin',
});
