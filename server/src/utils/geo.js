export const CITY_COORDS = {
  "Bengaluru": [12.9716, 77.5946],
  "Bangalore": [12.9716, 77.5946],
  "Mumbai": [19.0760, 72.8777],
  "Delhi": [28.7041, 77.1025],
  "New Delhi": [28.7041, 77.1025],
  "Hyderabad": [17.3850, 78.4867],
  "Chennai": [13.0827, 80.2707],
  "Kolkata": [22.5726, 88.3639],
  "Pune": [18.5204, 73.8567],
};

/**
 * Calculates Haversine distance between two coordinates in meters.
 */
export function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Resolves coordinates for a city.
 * Checks CITY_COORDS first, then accepts custom lat/lon, or attempts geocoding fallback.
 */
export async function resolveCityCoordinates(cityName, customLat = null, customLon = null) {
  if (customLat != null && customLon != null && !isNaN(customLat) && !isNaN(customLon)) {
    return { lat: Number(customLat), lon: Number(customLon) };
  }

  if (!cityName || typeof cityName !== "string") return null;

  const normalized = Object.keys(CITY_COORDS).find(
    (c) => c.toLowerCase() === cityName.trim().toLowerCase()
  );
  if (normalized) {
    const [lat, lon] = CITY_COORDS[normalized];
    return { lat, lon };
  }

  // Geocoding fallback
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cityName.trim())}&format=json&limit=1`,
      {
        headers: { "User-Agent": "LogiTrust-SupplyChain/1.0" },
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
      }
    }
  } catch (err) {
    // Ignore fallback failures and return null
  }

  return null;
}
