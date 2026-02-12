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
  loadYards,
  loadAccessRestrictions,
  loadInfrastructureManagers,
  loadTrackDesignations,
  loadStationCodes,
  loadSyncStatus,
  clearDataCache,
} from '@/lib/data-loader';
import {
  type GeometryDetail,
  formatLineGeometry,
  formatLineStructureGeometry,
  formatStructureGeometry,
  formatPointGeometry,
  simplifyTrackForStationFilter,
  isPointNearSimplifiedTrack,
} from '@/lib/geometry-utils';
import {
  type Track,
  type Tunnel,
  type Bridge,
  type Switch,
  type ElectrificationSection,
  type Station,
  type Yard,
  type AccessRestriction,
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
// GEOMETRY TRANSFORMATION
// ============================================================================

/**
 * Transform a track's geometry based on detail level
 */
function transformTrackGeometry(track: Track, detail: GeometryDetail): Track {
  const transformedGeometry = formatLineGeometry(track.geometry, detail);
  if (!transformedGeometry) {
    // For metadata level, return track without geometry
    const { geometry: _, ...trackWithoutGeometry } = track;
    return trackWithoutGeometry as Track;
  }
  return { ...track, geometry: transformedGeometry };
}

/**
 * Transform a tunnel's geometry based on detail level
 */
function transformTunnelGeometry(tunnel: Tunnel, detail: GeometryDetail): Tunnel {
  const transformedGeometry = formatLineStructureGeometry(tunnel.geometry, detail);
  if (!transformedGeometry) {
    const { geometry: _, ...tunnelWithoutGeometry } = tunnel;
    return tunnelWithoutGeometry as Tunnel;
  }
  return { ...tunnel, geometry: transformedGeometry };
}

/**
 * Transform a bridge's geometry based on detail level
 */
function transformBridgeGeometry(bridge: Bridge, detail: GeometryDetail): Bridge {
  const transformedGeometry = formatStructureGeometry(bridge.geometry, detail);
  if (!transformedGeometry) {
    const { geometry: _, ...bridgeWithoutGeometry } = bridge;
    return bridgeWithoutGeometry as Bridge;
  }
  return { ...bridge, geometry: transformedGeometry };
}

/**
 * Transform a switch's geometry based on detail level
 */
function transformSwitchGeometry(sw: Switch, detail: GeometryDetail): Switch {
  const transformedGeometry = formatPointGeometry(sw.geometry, detail);
  if (!transformedGeometry) {
    const { geometry: _, ...switchWithoutGeometry } = sw;
    return switchWithoutGeometry as Switch;
  }
  return { ...sw, geometry: transformedGeometry };
}

/**
 * Transform an electrification section's geometry based on detail level
 */
function transformElectrificationGeometry(section: ElectrificationSection, detail: GeometryDetail): ElectrificationSection {
  const transformedGeometry = formatLineGeometry(section.geometry, detail);
  if (!transformedGeometry) {
    const { geometry: _, ...sectionWithoutGeometry } = section;
    return sectionWithoutGeometry as ElectrificationSection;
  }
  return { ...section, geometry: transformedGeometry };
}

/**
 * Transform a station's geometry based on detail level
 */
function transformStationGeometry(station: Station, detail: GeometryDetail): Station {
  const transformedGeometry = formatPointGeometry(station.geometry, detail);
  if (!transformedGeometry) {
    const { geometry: _, ...stationWithoutGeometry } = station;
    return stationWithoutGeometry as Station;
  }
  return { ...station, geometry: transformedGeometry };
}

/**
 * Transform a yard's geometry based on detail level
 */
function transformYardGeometry(yard: Yard, detail: GeometryDetail): Yard {
  const transformedGeometry = formatPointGeometry(yard.geometry, detail);
  if (!transformedGeometry) {
    const { geometry: _, ...yardWithoutGeometry } = yard;
    return yardWithoutGeometry as Yard;
  }
  return { ...yard, geometry: transformedGeometry };
}

/**
 * Transform an access restriction's geometry based on detail level
 */
function transformAccessRestrictionGeometry(restriction: AccessRestriction, detail: GeometryDetail): AccessRestriction {
  const transformedGeometry = formatPointGeometry(restriction.geometry, detail);
  if (!transformedGeometry) {
    const { geometry: _, ...restrictionWithoutGeometry } = restriction;
    return restrictionWithoutGeometry as AccessRestriction;
  }
  return { ...restriction, geometry: transformedGeometry };
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Get all infrastructure for a track segment
 */
async function getSegmentInfrastructure(
  trackId: string,
  geometryDetail: GeometryDetail = 'corridor',
): Promise<SegmentInfrastructure> {
  // Cache the raw data, not the transformed data (to allow different detail levels)
  const cacheKey = `segment:${trackId}`;
  let rawResult = getCached<SegmentInfrastructure>(cacheKey);

  if (!rawResult) {
    // Load all data from JSON files
    const [allTracks, allTunnels, allBridges, allSwitches, allElectrification, allStations, allYards, allAccessRestrictions] =
      await Promise.all([
        loadTracks(),
        loadTunnels(),
        loadBridges(),
        loadSwitches(),
        loadElectrification(),
        loadStations(),
        loadYards(),
        loadAccessRestrictions(),
      ]);

    const track = allTracks.find((t) => t.id === trackId || t.designation === trackId);

    // Filter point data by proximity to track geometry
    // Simplify track once for performance, then check each point
    let nearbySwitches: Switch[] = [];
    let nearbyStations: Station[] = [];
    let nearbyYards: Yard[] = [];
    let nearbyRestrictions: AccessRestriction[] = [];

    if (track && track.geometry) {
      const simplifiedTrack = simplifyTrackForStationFilter(track.geometry);
      nearbySwitches = allSwitches.filter((sw) => sw.geometry && isPointNearSimplifiedTrack(sw.geometry, simplifiedTrack));
      nearbyStations = allStations.filter(
        (station) => station.geometry && isPointNearSimplifiedTrack(station.geometry, simplifiedTrack),
      );
      nearbyYards = allYards.filter((yard) => yard.geometry && isPointNearSimplifiedTrack(yard.geometry, simplifiedTrack));
      nearbyRestrictions = allAccessRestrictions.filter(
        (r) => r.geometry && isPointNearSimplifiedTrack(r.geometry, simplifiedTrack),
      );
    }

    rawResult = {
      trackId,
      track: track || undefined,
      tunnels: allTunnels.filter((t) => t.trackId === trackId),
      bridges: allBridges.filter((b) => b.trackId === trackId),
      switches: nearbySwitches,
      electrification: allElectrification.filter((e) => e.trackId === trackId),
      stations: nearbyStations,
      yards: nearbyYards,
      accessRestrictions: nearbyRestrictions,
    };

    setCache(cacheKey, rawResult);
  }

  // Transform geometries based on detail level
  return {
    trackId,
    track: rawResult.track ? transformTrackGeometry(rawResult.track, geometryDetail) : undefined,
    tunnels: rawResult.tunnels.map((t) => transformTunnelGeometry(t, geometryDetail)),
    bridges: rawResult.bridges.map((b) => transformBridgeGeometry(b, geometryDetail)),
    switches: rawResult.switches.map((s) => transformSwitchGeometry(s, geometryDetail)),
    electrification: rawResult.electrification.map((e) => transformElectrificationGeometry(e, geometryDetail)),
    stations: rawResult.stations.map((s) => transformStationGeometry(s, geometryDetail)),
    yards: rawResult.yards.map((y) => transformYardGeometry(y, geometryDetail)),
    accessRestrictions: rawResult.accessRestrictions.map((r) => transformAccessRestrictionGeometry(r, geometryDetail)),
  };
}

/**
 * Factory function for creating bbox query functions with geometry transformation
 */
function createBBoxQuery<T extends { geometry?: { type: string; coordinates: number[] | number[][] | number[][][] } }>(
  loadFn: () => Promise<T[]>,
  transformFn: (item: T, detail: GeometryDetail) => T,
  cachePrefix?: string,
): (bbox: BBox, limit?: number, geometryDetail?: GeometryDetail) => Promise<T[]> {
  return async function (bbox: BBox, limit?: number, geometryDetail: GeometryDetail = 'corridor'): Promise<T[]> {
    // Cache raw data only
    const cacheKey = cachePrefix ? `${cachePrefix}:bbox:${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}` : null;
    let filtered: T[];

    if (cacheKey) {
      const cached = getCached<T[]>(cacheKey);
      if (cached) {
        filtered = cached;
      } else {
        const allItems = await loadFn();
        filtered = allItems.filter((item) => item.geometry && geometryIntersectsBBox(item.geometry, bbox));
        setCache(cacheKey, filtered);
      }
    } else {
      const allItems = await loadFn();
      filtered = allItems.filter((item) => item.geometry && geometryIntersectsBBox(item.geometry, bbox));
    }

    // Apply limit then transform (transform is more expensive, so limit first)
    const limited = filtered.slice(0, limit || 100);
    return limited.map((item) => transformFn(item, geometryDetail));
  };
}

const getTracksByBBox = createBBoxQuery<Track>(loadTracks, transformTrackGeometry, 'tracks');
const getTunnelsByBBox = createBBoxQuery<Tunnel>(loadTunnels, transformTunnelGeometry);
const getBridgesByBBox = createBBoxQuery<Bridge>(loadBridges, transformBridgeGeometry);
const getSwitchesByBBox = createBBoxQuery<Switch>(loadSwitches, transformSwitchGeometry);
const getElectrificationByBBox = createBBoxQuery<ElectrificationSection>(loadElectrification, transformElectrificationGeometry);
const getStationsByBBox = createBBoxQuery<Station>(loadStations, transformStationGeometry);
const getYardsByBBox = createBBoxQuery<Yard>(loadYards, transformYardGeometry);
const getAccessRestrictionsByBBox = createBBoxQuery<AccessRestriction>(
  loadAccessRestrictions,
  transformAccessRestrictionGeometry,
);

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
  getYardsByBBox,
  getAccessRestrictionsByBBox,

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
