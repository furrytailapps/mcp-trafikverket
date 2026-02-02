/**
 * Lastkajen client for NJDB infrastructure data
 *
 * Reads infrastructure data from JSON files in /data directory.
 * Data is synced from Lastkajen API via the sync script.
 */

import { ValidationError } from '@/lib/errors';
import {
  loadTracks,
  loadTunnels,
  loadBridges,
  loadSwitches,
  loadElectrification,
  loadStations,
  loadInfrastructureManagers,
  loadTrackDesignations,
  loadStationCodes,
  loadSyncStatus,
  clearDataCache,
} from '@/lib/data-loader';
import {
  type Track,
  type Tunnel,
  type Bridge,
  type Switch,
  type ElectrificationSection,
  type Station,
  type SegmentInfrastructure,
  type InfrastructureManager,
} from '@/types/njdb-api';

// In-memory cache for computed results (24-hour TTL)
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const resultCache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = resultCache.get(key);
  if (!entry) return null;

  if (Date.now() - entry.timestamp > CACHE_TTL) {
    resultCache.delete(key);
    return null;
  }

  return entry.data as T;
}

function setCache<T>(key: string, data: T): void {
  resultCache.set(key, { data, timestamp: Date.now() });
}

/**
 * Bounding box for geographic queries
 */
interface BBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/**
 * Parse bbox string to object
 */
function parseBBox(bbox: string): BBox {
  const parts = bbox.split(',').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) {
    throw new ValidationError('Invalid bbox format. Use "minLon,minLat,maxLon,maxLat"');
  }
  return {
    minLon: parts[0],
    minLat: parts[1],
    maxLon: parts[2],
    maxLat: parts[3],
  };
}

/**
 * Calculate bounding box from center point and radius
 */
function bboxFromPoint(lat: number, lon: number, radiusKm: number): BBox {
  // Approximate degrees per km at Swedish latitudes
  const latDegPerKm = 1 / 111; // ~111 km per degree latitude
  const lonDegPerKm = 1 / (111 * Math.cos((lat * Math.PI) / 180)); // varies with latitude

  const latDelta = radiusKm * latDegPerKm;
  const lonDelta = radiusKm * lonDegPerKm;

  return {
    minLon: lon - lonDelta,
    minLat: lat - latDelta,
    maxLon: lon + lonDelta,
    maxLat: lat + latDelta,
  };
}

/**
 * Check if a point is within a bounding box
 */
function isPointInBBox(lon: number, lat: number, bbox: BBox): boolean {
  return lon >= bbox.minLon && lon <= bbox.maxLon && lat >= bbox.minLat && lat <= bbox.maxLat;
}

/**
 * Check if a geometry intersects a bounding box
 */
function geometryIntersectsBBox(
  geometry: { type: string; coordinates: number[] | number[][] | number[][][] },
  bbox: BBox,
): boolean {
  if (geometry.type === 'Point') {
    const [lon, lat] = geometry.coordinates as number[];
    return isPointInBBox(lon, lat, bbox);
  }

  if (geometry.type === 'LineString') {
    const coords = geometry.coordinates as number[][];
    return coords.some(([lon, lat]) => isPointInBBox(lon, lat, bbox));
  }

  if (geometry.type === 'Polygon') {
    const coords = (geometry.coordinates as number[][][])[0];
    return coords.some(([lon, lat]) => isPointInBBox(lon, lat, bbox));
  }

  return false;
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Get all infrastructure for a track segment
 */
async function getSegmentInfrastructure(trackId: string): Promise<SegmentInfrastructure> {
  const cacheKey = `segment:${trackId}`;
  const cached = getCached<SegmentInfrastructure>(cacheKey);
  if (cached) return cached;

  // Load all data from JSON files
  const [allTracks, allTunnels, allBridges, allSwitches, allElectrification, allStations] = await Promise.all([
    loadTracks(),
    loadTunnels(),
    loadBridges(),
    loadSwitches(),
    loadElectrification(),
    loadStations(),
  ]);

  const track = allTracks.find((t) => t.id === trackId || t.designation === trackId);

  const result: SegmentInfrastructure = {
    trackId,
    track: track || undefined,
    tunnels: allTunnels.filter((t) => t.trackId === trackId),
    bridges: allBridges.filter((b) => b.trackId === trackId),
    switches: allSwitches.filter((s) => s.trackId === trackId),
    electrification: allElectrification.filter((e) => e.trackId === trackId),
    stations: allStations, // Stations are associated differently - return all for now
  };

  setCache(cacheKey, result);
  return result;
}

/**
 * Factory function for creating bbox query functions
 */
function createBBoxQuery<T extends { geometry?: { type: string; coordinates: number[] | number[][] | number[][][] } }>(
  loadFn: () => Promise<T[]>,
  cachePrefix?: string,
): (bbox: BBox, limit?: number) => Promise<T[]> {
  return async function (bbox: BBox, limit?: number): Promise<T[]> {
    if (cachePrefix) {
      const cacheKey = `${cachePrefix}:bbox:${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`;
      const cached = getCached<T[]>(cacheKey);
      if (cached) return cached.slice(0, limit);
    }

    const allItems = await loadFn();
    const filtered = allItems.filter((item) => item.geometry && geometryIntersectsBBox(item.geometry, bbox));

    if (cachePrefix) {
      const cacheKey = `${cachePrefix}:bbox:${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`;
      setCache(cacheKey, filtered);
    }

    return filtered.slice(0, limit || 100);
  };
}

const getTracksByBBox = createBBoxQuery<Track>(loadTracks, 'tracks');
const getTunnelsByBBox = createBBoxQuery<Tunnel>(loadTunnels);
const getBridgesByBBox = createBBoxQuery<Bridge>(loadBridges);
const getSwitchesByBBox = createBBoxQuery<Switch>(loadSwitches);
const getElectrificationByBBox = createBBoxQuery<ElectrificationSection>(loadElectrification);
const getStationsByBBox = createBBoxQuery<Station>(loadStations);

// ============================================================================
// METADATA
// ============================================================================

/**
 * Factory function for creating cached metadata loaders
 */
function createCachedLoader<T>(cacheKey: string, loadFn: () => Promise<T>): () => Promise<T> {
  return async function (): Promise<T> {
    const cached = getCached<T>(cacheKey);
    if (cached) return cached;

    const data = await loadFn();
    setCache(cacheKey, data);
    return data;
  };
}

const getInfrastructureManagers = createCachedLoader<InfrastructureManager[]>(
  'metadata:infrastructure_managers',
  loadInfrastructureManagers,
);

const getTrackDesignations = createCachedLoader<string[]>('metadata:track_designations', loadTrackDesignations);

const getStationCodes = createCachedLoader<{ code: string; name: string }[]>('metadata:station_codes', loadStationCodes);

/**
 * Get cache/sync status
 */
async function getCacheStatus(): Promise<{
  entries: number;
  oldestEntry: string | null;
  syncStatus: { lastSync: string; source: string; success: boolean } | null;
}> {
  let oldestTimestamp = Infinity;
  let oldestKey: string | null = null;

  resultCache.forEach((entry, key) => {
    if (entry.timestamp < oldestTimestamp) {
      oldestTimestamp = entry.timestamp;
      oldestKey = key;
    }
  });

  const syncStatus = await loadSyncStatus();

  return {
    entries: resultCache.size,
    oldestEntry: oldestKey ? new Date(oldestTimestamp).toISOString() : null,
    syncStatus: syncStatus
      ? {
          lastSync: syncStatus.lastSync,
          source: syncStatus.source,
          success: syncStatus.success,
        }
      : null,
  };
}

/**
 * Clear all caches
 */
function clearCache(): void {
  resultCache.clear();
  clearDataCache();
}

// ============================================================================
// EXPORTED CLIENT
// ============================================================================

export const lastkajenClient = {
  // Segment queries (primary use case)
  getSegmentInfrastructure,

  // Geographic queries
  getTracksByBBox,
  getTunnelsByBBox,
  getBridgesByBBox,
  getSwitchesByBBox,
  getElectrificationByBBox,
  getStationsByBBox,

  // Metadata
  getInfrastructureManagers,
  getTrackDesignations,
  getStationCodes,

  // Cache management
  getCacheStatus,
  clearCache,

  // Utility
  parseBBox,
  bboxFromPoint,
};
