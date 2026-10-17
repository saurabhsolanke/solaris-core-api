import { env } from '../config/env';

interface NominatimResponse {
  display_name?: string;
  address?: {
    road?: string;
    suburb?: string;
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    country?: string;
    postcode?: string;
  };
}

/**
 * Reverse geocodes coordinates (lat, lng) to a human-readable street address.
 * Uses OpenStreetMap Nominatim with timeout protection and reliable fallback.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const fallbackAddress = `Location (${lat.toFixed(5)}, ${lng.toFixed(5)})`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500); // 2.5 second timeout

    const url = new URL('/reverse', env.NOMINATIM_BASE_URL);
    url.searchParams.set('lat', lat.toString());
    url.searchParams.set('lon', lng.toString());
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('zoom', '18');
    url.searchParams.set('addressdetails', '1');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'User-Agent': env.NOMINATIM_USER_AGENT,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[Geocoding] Nominatim HTTP ${response.status}: Falling back to coordinates.`);
      return fallbackAddress;
    }

    const data = (await response.json()) as NominatimResponse;

    if (data.display_name) {
      return data.display_name;
    }

    if (data.address) {
      const parts = [
        data.address.road,
        data.address.suburb || data.address.village || data.address.town || data.address.city,
        data.address.state,
        data.address.country,
      ].filter(Boolean);

      if (parts.length > 0) {
        return parts.join(', ');
      }
    }

    return fallbackAddress;
  } catch (error: unknown) {
    // Graceful fallback on network timeout, DNS failure, or rate limiting
    console.warn(`[Geocoding] Reverse geocoding failed (${error instanceof Error ? error.message : String(error)}). Using coordinate fallback.`);
    return fallbackAddress;
  }
}
