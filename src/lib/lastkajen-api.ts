/**
 * Lastkajen REST API client
 *
 * Low-level client for fetching infrastructure data from the Lastkajen API.
 * Used by the sync script to download NJDB data.
 *
 * API Documentation: https://lastkajen.trafikverket.se/assets/Lastkajen2_API_Information.pdf
 *
 * Authentication: Bearer token from LASTKAJEN_API_TOKEN environment variable
 * Token expires ~24 hours (86399 seconds), refresh via POST /api/Identity/Login
 *
 * Correct API Endpoints (verified from PDF v1.4, 2023-01-24):
 * - POST /api/Identity/Login - Get access token
 * - GET /api/DataPackage/GetPublishedDataPackages - List all data packages
 * - GET /api/DataPackage/GetDataPackageFiles/{id} - Get files in a package
 * - GET /api/file/GetDataPackageDownloadToken?id=&fileName= - Get download token (60s validity)
 * - GET /api/File/GetDataPackageFile?token= - Download file (no auth needed)
 */

import { ValidationError, UpstreamApiError } from './errors';

const LASTKAJEN_API_BASE = 'https://lastkajen.trafikverket.se';

// ============================================================================
// TOKEN MANAGEMENT (Auto-refresh for production deployment)
// ============================================================================

/**
 * Cached token with expiry tracking
 * Token is stored in memory and auto-refreshed when expired
 */
let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Get a valid API token, auto-refreshing if needed
 *
 * Priority:
 * 1. Cached token if still valid (5 minute buffer)
 * 2. Auto-refresh using LASTKAJEN_USERNAME + LASTKAJEN_PASSWORD
 * 3. Fall back to LASTKAJEN_API_TOKEN (for manual override/testing)
 *
 * @returns Valid access token
 * @throws Error if no valid credentials available
 */
export async function getValidToken(): Promise<string> {
  // Check if we have a valid cached token (with 5 minute buffer)
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  // Try auto-refresh with username/password
  const username = process.env.LASTKAJEN_USERNAME;
  const password = process.env.LASTKAJEN_PASSWORD;

  if (username && password) {
    try {
      const response = await refreshToken(username, password);
      // Cache with 5 minute buffer before expiry
      cachedToken = {
        token: response.access_token,
        expiresAt: Date.now() + (response.expires_in - 300) * 1000,
      };
      return cachedToken.token;
    } catch {
      // Fall through to try LASTKAJEN_API_TOKEN
    }
  }

  // Fall back to manual token (for testing or override)
  const envToken = process.env.LASTKAJEN_API_TOKEN;
  if (envToken) {
    return envToken;
  }

  throw new ValidationError(
    'No Lastkajen credentials available. Set LASTKAJEN_USERNAME + LASTKAJEN_PASSWORD ' +
      'for auto-refresh, or LASTKAJEN_API_TOKEN for manual override.',
  );
}

/**
 * @deprecated Use getValidToken() for auto-refresh support
 */
function getApiToken(): string {
  const token = process.env.LASTKAJEN_API_TOKEN;
  if (!token) {
    throw new ValidationError('LASTKAJEN_API_TOKEN environment variable is not set');
  }
  return token;
}

/**
 * Make an authenticated request to the Lastkajen API
 * Note: The API returns data directly, not wrapped in { data, success, message }
 *
 * Uses getValidToken() for automatic token management and refresh.
 */
async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = await getValidToken();
  const url = `${LASTKAJEN_API_BASE}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new UpstreamApiError(
      `Lastkajen API error: ${response.statusText}${errorText ? ` - ${errorText}` : ''}`,
      response.status,
      'lastkajen.trafikverket.se',
    );
  }

  return response.json() as Promise<T>;
}

// ============================================================================
// API TYPES (based on API documentation v1.4)
// ============================================================================

/** Response from /api/Identity/Login */
export interface LoginResponse {
  access_token: string;
  expires_in: number; // 86399 (~24 hours)
  is_external: boolean;
}

/** Data package from /api/DataPackage/GetPublishedDataPackages */
export interface DataPackage {
  id: number;
  targetFolder: {
    id: number;
    name: string;
    path: string;
  };
  sourceFolder: string;
  name: string;
  description: string;
  published: boolean;
}

/** File link from GetDataPackageFiles response */
export interface FileLink {
  href: string;
  rel: string;
  method: string;
  isTemplated: boolean;
}

/** File in a data package from /api/DataPackage/GetDataPackageFiles/{id} */
export interface DataPackageFile {
  isFolder: boolean;
  name: string;
  size: string;
  dateTime: string;
  links: FileLink[];
}

// ============================================================================
// API ENDPOINTS (verified from PDF documentation)
// ============================================================================

/**
 * Refresh the API token using username/password credentials
 *
 * POST /api/Identity/Login
 *
 * @param username - Lastkajen username (email)
 * @param password - Lastkajen password
 * @returns Login response with access_token
 */
export async function refreshToken(username: string, password: string): Promise<LoginResponse> {
  const response = await fetch(`${LASTKAJEN_API_BASE}/api/Identity/Login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ UserName: username, Password: password }),
  });

  if (!response.ok) {
    throw new UpstreamApiError(`Token refresh failed: ${response.statusText}`, response.status, 'lastkajen.trafikverket.se');
  }

  return response.json() as Promise<LoginResponse>;
}

/**
 * Get list of all published data packages
 *
 * GET /api/DataPackage/GetPublishedDataPackages
 *
 * Known railway packages (as of 2026-02):
 * - ID 10144: "Järnvägsnät med grundegenskaper" (Railway network with basic properties)
 */
export async function getPublishedDataPackages(): Promise<DataPackage[]> {
  return apiRequest<DataPackage[]>('/api/DataPackage/GetPublishedDataPackages');
}

/**
 * Get files in a specific data package
 *
 * GET /api/DataPackage/GetDataPackageFiles/{id}
 *
 * @param packageId - ID of the data package (e.g., 10144 for railway basic properties)
 */
export async function getDataPackageFiles(packageId: number): Promise<DataPackageFile[]> {
  return apiRequest<DataPackageFile[]>(`/api/DataPackage/GetDataPackageFiles/${packageId}`);
}

/**
 * Get a download token for a specific file
 *
 * GET /api/file/GetDataPackageDownloadToken?id={id}&fileName={fileName}
 *
 * Token is single-use and expires after 60 seconds!
 *
 * @param packageId - ID of the data package
 * @param fileName - Name of the file to download
 * @returns Download token (GUID string)
 */
export async function getDownloadToken(packageId: number, fileName: string): Promise<string> {
  const params = new URLSearchParams({
    id: packageId.toString(),
    fileName: fileName,
  });

  return apiRequest<string>(`/api/file/GetDataPackageDownloadToken?${params}`);
}

/**
 * Download a file using a download token
 *
 * GET /api/File/GetDataPackageFile?token={token}
 *
 * Note: This endpoint does NOT require authentication (token-based)
 *
 * @param downloadToken - Token from getDownloadToken (valid for 60 seconds, single use)
 * @returns File content as ArrayBuffer (usually a ZIP file)
 */
export async function downloadFile(downloadToken: string): Promise<ArrayBuffer> {
  const response = await fetch(`${LASTKAJEN_API_BASE}/api/File/GetDataPackageFile?token=${encodeURIComponent(downloadToken)}`);

  if (!response.ok) {
    throw new UpstreamApiError(`Download failed: ${response.statusText}`, response.status, 'lastkajen.trafikverket.se');
  }

  return response.arrayBuffer();
}

// ============================================================================
// HIGH-LEVEL CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Download a data package file by package ID and filename
 *
 * Combines getDownloadToken + downloadFile into one call.
 * Note: Token expires after 60 seconds, so this downloads immediately.
 *
 * @param packageId - ID of the data package
 * @param fileName - Name of the file to download
 * @returns File content as ArrayBuffer
 */
export async function downloadPackageFile(packageId: number, fileName: string): Promise<ArrayBuffer> {
  // Get download token (valid for 60 seconds)
  const token = await getDownloadToken(packageId, fileName);

  // Download immediately (token is single-use)
  return downloadFile(token);
}

/**
 * List all railway-related data packages
 *
 * Filters published packages to only return railway (Järnväg) packages.
 */
export async function getRailwayDataPackages(): Promise<DataPackage[]> {
  const packages = await getPublishedDataPackages();

  // Filter for railway packages (path contains Järnväg or railway-related terms)
  return packages.filter(
    (pkg) =>
      pkg.name.toLowerCase().includes('järnväg') ||
      pkg.name.toLowerCase().includes('järnvägsnät') ||
      pkg.targetFolder.path.toLowerCase().includes('järnväg'),
  );
}

// ============================================================================
// KNOWN PACKAGE IDS (discovered via browser exploration)
// ============================================================================

/**
 * Known railway data package IDs from Lastkajen
 * These may change over time - verify via getPublishedDataPackages()
 */
export const RAILWAY_PACKAGE_IDS = {
  /** Railway network with basic properties (tracks, geometry, etc.) - 18.5MB GeoPackage */
  BASIC_PROPERTIES: 10144,
} as const;

// ============================================================================
// LEGACY EXPORTS (for backwards compatibility with old code)
// ============================================================================

// These match the old interface but use the new implementation

/** @deprecated Use getPublishedDataPackages instead */
export async function getAvailableProducts(): Promise<
  Array<{
    id: string;
    name: string;
    description: string;
    format: string;
  }>
> {
  const packages = await getPublishedDataPackages();
  return packages.map((pkg) => ({
    id: pkg.id.toString(),
    name: pkg.name,
    description: pkg.description,
    format: 'geopackage', // Lastkajen primarily uses GeoPackage format
  }));
}

/** @deprecated Use getDownloadToken + downloadFile instead */
export async function requestDownload(productId: string): Promise<{ downloadToken: string; expiresIn: number }> {
  // This would need a filename - the old API assumed direct product download
  // For now, throw an error to indicate the API has changed
  throw new Error(
    'requestDownload is deprecated. Lastkajen API requires a filename. ' +
      'Use getDataPackageFiles() to list files, then getDownloadToken(packageId, fileName).',
  );
}

// ============================================================================
// NJDB DATA TYPES (for future GeoPackage parsing)
// ============================================================================

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
 * NJDB Data Access
 *
 * Infrastructure data (tracks, tunnels, bridges) is stored in /data/*.json files.
 * These are synced from Lastkajen GeoPackage via:
 *   1. download-railway-data.ts - Downloads GeoPackage from Lastkajen API
 *   2. convert-geopackage.ts - Converts GeoPackage to JSON format
 *
 * The MCP tools read directly from JSON files via data-loader.ts.
 * These fetch functions are kept for backward compatibility but return empty arrays.
 * Use the data-loader module to access the actual infrastructure data.
 */
/** @deprecated Use data-loader.ts to read from /data/tracks.json */
export async function fetchTracks(): Promise<NJDBTrackData[]> {
  return [];
}

/** @deprecated Use data-loader.ts to read from /data/tunnels.json */
export async function fetchTunnels(): Promise<NJDBTunnelData[]> {
  return [];
}

/** @deprecated Use data-loader.ts to read from /data/bridges.json */
export async function fetchBridges(): Promise<NJDBBridgeData[]> {
  return [];
}

// Export client for testing and data sync
export const lastkajenApi = {
  refreshToken,
  getPublishedDataPackages,
  getDataPackageFiles,
  getDownloadToken,
  downloadFile,
  downloadPackageFile,
  getRailwayDataPackages,
  // Legacy (kept for backward compatibility)
  getAvailableProducts,
  requestDownload,
  fetchTracks,
  fetchTunnels,
  fetchBridges,
};
