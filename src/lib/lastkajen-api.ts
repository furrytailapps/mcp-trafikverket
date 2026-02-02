/**
 * Lastkajen REST API client
 *
 * Low-level client for fetching infrastructure data from the Lastkajen API.
 * Used by the sync script to download NJDB data.
 *
 * API Documentation: https://lastkajen.trafikverket.se/assets/Lastkajen2_API_Information.pdf
 *
 * Authentication: Bearer token from LASTKAJEN_API_TOKEN environment variable
 * Token expires ~24 hours, refresh via POST /api/Identity/Login
 */

const LASTKAJEN_API_BASE = 'https://lastkajen.trafikverket.se/api';

function getApiToken(): string {
  const token = process.env.LASTKAJEN_API_TOKEN;
  if (!token) {
    throw new Error('LASTKAJEN_API_TOKEN environment variable is not set');
  }
  return token;
}

interface ApiResponse<T> {
  data: T;
  success: boolean;
  message?: string;
}

/**
 * Make an authenticated request to the Lastkajen API
 */
async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getApiToken();
  const url = `${LASTKAJEN_API_BASE}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Lastkajen API error: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as ApiResponse<T>;

  if (!json.success) {
    throw new Error(`Lastkajen API error: ${json.message || 'Unknown error'}`);
  }

  return json.data;
}

// ============================================================================
// API ENDPOINTS
// ============================================================================

// NOTE: The exact endpoint paths need to be verified from the API documentation.
// These are placeholder implementations based on common REST API patterns.
// Update these once we have access to the actual API documentation.

/**
 * Refresh the API token using username/password credentials
 *
 * @param username - Lastkajen username
 * @param password - Lastkajen password
 * @returns New API token
 */
export async function refreshToken(username: string, password: string): Promise<string> {
  const response = await fetch(`${LASTKAJEN_API_BASE}/Identity/Login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as { token: string };
  return json.token;
}

/**
 * Get list of available NJDB products/datasets
 */
export async function getAvailableProducts(): Promise<
  Array<{
    id: string;
    name: string;
    description: string;
    format: string;
  }>
> {
  return apiRequest<
    Array<{
      id: string;
      name: string;
      description: string;
      format: string;
    }>
  >('/Products');
}

/**
 * Request a data download for a specific product
 *
 * @param productId - ID of the product to download
 * @returns Download token (valid for 60 seconds)
 */
export async function requestDownload(productId: string): Promise<{ downloadToken: string; expiresIn: number }> {
  return apiRequest<{ downloadToken: string; expiresIn: number }>(`/Products/${productId}/Download`, {
    method: 'POST',
  });
}

/**
 * Download a file using a download token
 *
 * @param downloadToken - Token from requestDownload
 * @returns File content as string (JSON/GeoJSON)
 */
export async function downloadFile(downloadToken: string): Promise<string> {
  const response = await fetch(`${LASTKAJEN_API_BASE}/Download/${downloadToken}`, {
    headers: {
      Authorization: `Bearer ${getApiToken()}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

// ============================================================================
// NJDB-SPECIFIC ENDPOINTS (to be verified with API docs)
// ============================================================================

// These endpoints are placeholders. The actual Lastkajen API structure
// needs to be verified from the official documentation.

export interface NJDBTrackData {
  id: string;
  designation: string;
  name: string;
  gauge: number;
  speedLimit: number;
  electrified: boolean;
  electrificationType?: string;
  infrastructureManager: string;
  trackClass: string;
  numberOfTracks: number;
  length: number;
  geometry: {
    type: 'LineString';
    coordinates: number[][];
  };
}

export interface NJDBTunnelData {
  id: string;
  name: string;
  trackId: string;
  length: number;
  width?: number;
  height?: number;
  builtYear?: number;
  geometry: {
    type: 'LineString';
    coordinates: number[][];
  };
}

export interface NJDBBridgeData {
  id: string;
  name: string;
  trackId: string;
  type: string;
  length: number;
  width?: number;
  clearanceHeight?: number;
  builtYear?: number;
  loadCapacity?: number;
  crossesOver?: string;
  geometry: {
    type: 'LineString';
    coordinates: number[][];
  };
}

/**
 * Fetch all tracks from NJDB
 *
 * NOTE: This is a placeholder. The actual endpoint needs to be determined
 * from Lastkajen API documentation.
 */
export async function fetchTracks(): Promise<NJDBTrackData[]> {
  // TODO: Replace with actual Lastkajen API endpoint
  // The API might use WFS, REST, or a custom query format

  // For now, return empty array - sync script will skip if API unavailable
  console.log('[lastkajen-api] fetchTracks() - API endpoint not yet implemented');
  return [];
}

/**
 * Fetch all tunnels from NJDB
 */
export async function fetchTunnels(): Promise<NJDBTunnelData[]> {
  console.log('[lastkajen-api] fetchTunnels() - API endpoint not yet implemented');
  return [];
}

/**
 * Fetch all bridges from NJDB
 */
export async function fetchBridges(): Promise<NJDBBridgeData[]> {
  console.log('[lastkajen-api] fetchBridges() - API endpoint not yet implemented');
  return [];
}

// Export client for testing
export const lastkajenApi = {
  refreshToken,
  getAvailableProducts,
  requestDownload,
  downloadFile,
  fetchTracks,
  fetchTunnels,
  fetchBridges,
};
