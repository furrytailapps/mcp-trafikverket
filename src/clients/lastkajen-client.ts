import { ValidationError } from '@/lib/errors';
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

// In-memory cache for infrastructure data (24-hour TTL)
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;

  if (Date.now() - entry.timestamp > CACHE_TTL) {
    cache.delete(key);
    return null;
  }

  return entry.data as T;
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() });
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

// ============================================================================
// MOCK DATA
// Note: The Lastkajen API requires registration and authentication.
// This mock data demonstrates the expected response structure.
// Once API access is obtained, replace with actual API calls.
// ============================================================================

/**
 * Mock track data for demonstration
 * In production, this would query Lastkajen's NJDB API
 */
function getMockTracks(): Track[] {
  return [
    {
      id: '182',
      designation: '182',
      name: 'Västra Stambanan',
      gauge: 1435,
      speedLimit: 160,
      electrified: true,
      electrificationType: '15kV 16.7Hz AC',
      infrastructureManager: 'Trafikverket',
      trackClass: 'A',
      numberOfTracks: 2,
      length: 45000,
      geometry: {
        type: 'LineString',
        coordinates: [
          [18.07, 59.33],
          [17.95, 59.4],
          [17.85, 59.5],
        ],
      },
    },
    {
      id: '421',
      designation: '421',
      name: 'Dalabanan',
      gauge: 1435,
      speedLimit: 130,
      electrified: true,
      electrificationType: '15kV 16.7Hz AC',
      infrastructureManager: 'Trafikverket',
      trackClass: 'B',
      numberOfTracks: 1,
      length: 120000,
      geometry: {
        type: 'LineString',
        coordinates: [
          [15.6, 60.5],
          [15.5, 60.6],
          [15.4, 60.7],
        ],
      },
    },
  ];
}

function getMockTunnels(): Tunnel[] {
  return [
    {
      id: 'TUN-001',
      name: 'Citytunneln',
      trackId: '182',
      length: 2500,
      width: 12,
      height: 8,
      builtYear: 2010,
      geometry: {
        type: 'LineString',
        coordinates: [
          [18.06, 59.32],
          [18.08, 59.34],
        ],
      },
    },
  ];
}

function getMockBridges(): Bridge[] {
  return [
    {
      id: 'BRG-001',
      name: 'Årstaviksbron',
      trackId: '182',
      type: 'beam',
      length: 350,
      width: 14,
      clearanceHeight: 6,
      builtYear: 1927,
      loadCapacity: 200,
      crossesOver: 'Årstaviken',
      geometry: {
        type: 'LineString',
        coordinates: [
          [18.04, 59.3],
          [18.06, 59.31],
        ],
      },
    },
  ];
}

function getMockSwitches(): Switch[] {
  return [
    {
      id: 'SW-001',
      trackId: '182',
      type: 'left',
      controlType: 'remote',
      maxSpeed: 80,
      geometry: {
        type: 'Point',
        coordinates: [18.07, 59.33],
      },
    },
  ];
}

function getMockElectrification(): ElectrificationSection[] {
  return [
    {
      id: 'ELEC-001',
      trackId: '182',
      systemType: '15kV 16.7Hz AC',
      voltage: 15000,
      frequency: 16.7,
      catenary: true,
      thirdRail: false,
      startKm: 0,
      endKm: 45,
      geometry: {
        type: 'LineString',
        coordinates: [
          [18.07, 59.33],
          [17.85, 59.5],
        ],
      },
    },
  ];
}

function getMockStations(): Station[] {
  return [
    {
      id: 'STA-001',
      name: 'Stockholm Central',
      signature: 'Cst',
      type: 'station',
      platforms: 19,
      tracks: 12,
      accessible: true,
      geometry: {
        type: 'Point',
        coordinates: [18.0589, 59.3303],
      },
    },
    {
      id: 'STA-002',
      name: 'Göteborg Central',
      signature: 'G',
      type: 'station',
      platforms: 16,
      tracks: 10,
      accessible: true,
      geometry: {
        type: 'Point',
        coordinates: [11.9733, 57.7089],
      },
    },
  ];
}

function getMockInfrastructureManagers(): InfrastructureManager[] {
  return [
    { id: 'TV', name: 'Trafikverket', shortName: 'Trafikverket' },
    { id: 'IB', name: 'Inlandsbanan AB', shortName: 'Inlandsbanan' },
    { id: 'APT', name: 'A-Train AB (Arlanda Express)', shortName: 'A-Train' },
    { id: 'ORE', name: 'Öresundståg AB', shortName: 'Öresundståg' },
    { id: 'SL', name: 'Storstockholms Lokaltrafik', shortName: 'SL' },
  ];
}

function getMockTrackDesignations(): string[] {
  return [
    '111',
    '182',
    '401',
    '411',
    '421',
    '421',
    '511',
    '520',
    '611',
    '701',
    '801',
    '900',
    '901',
    '902',
    '903',
    '904',
    '905',
  ];
}

function getMockStationCodes(): { code: string; name: string }[] {
  return [
    { code: 'Cst', name: 'Stockholm Central' },
    { code: 'G', name: 'Göteborg Central' },
    { code: 'M', name: 'Malmö Central' },
    { code: 'U', name: 'Uppsala Central' },
    { code: 'Lp', name: 'Linköping Central' },
    { code: 'Nr', name: 'Norrköping Central' },
    { code: 'Hpbg', name: 'Helsingborg Central' },
    { code: 'Vs', name: 'Västerås Central' },
    { code: 'Öb', name: 'Örebro Central' },
    { code: 'Jn', name: 'Jönköping Central' },
  ];
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

  // In production, this would make parallel API calls to Lastkajen
  // For now, return mock data filtered by trackId
  const allTracks = getMockTracks();
  const track = allTracks.find((t) => t.id === trackId || t.designation === trackId);

  const result: SegmentInfrastructure = {
    trackId,
    track: track || undefined,
    tunnels: getMockTunnels().filter((t) => t.trackId === trackId),
    bridges: getMockBridges().filter((b) => b.trackId === trackId),
    switches: getMockSwitches().filter((s) => s.trackId === trackId),
    electrification: getMockElectrification().filter((e) => e.trackId === trackId),
    stations: getMockStations(), // Stations are associated differently
  };

  setCache(cacheKey, result);
  return result;
}

/**
 * Get tracks by geographic bounding box
 */
async function getTracksByBBox(bbox: BBox, limit?: number): Promise<Track[]> {
  const cacheKey = `tracks:bbox:${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`;
  const cached = getCached<Track[]>(cacheKey);
  if (cached) return cached.slice(0, limit);

  // In production, query Lastkajen with WFS bbox filter
  // For now, return mock tracks
  const tracks = getMockTracks();
  setCache(cacheKey, tracks);
  return tracks.slice(0, limit || 100);
}

/**
 * Get tunnels by geographic bounding box
 */
async function getTunnelsByBBox(bbox: BBox, limit?: number): Promise<Tunnel[]> {
  // In production, query Lastkajen
  return getMockTunnels().slice(0, limit || 100);
}

/**
 * Get bridges by geographic bounding box
 */
async function getBridgesByBBox(bbox: BBox, limit?: number): Promise<Bridge[]> {
  return getMockBridges().slice(0, limit || 100);
}

/**
 * Get switches by geographic bounding box
 */
async function getSwitchesByBBox(bbox: BBox, limit?: number): Promise<Switch[]> {
  return getMockSwitches().slice(0, limit || 100);
}

/**
 * Get electrification sections by geographic bounding box
 */
async function getElectrificationByBBox(bbox: BBox, limit?: number): Promise<ElectrificationSection[]> {
  return getMockElectrification().slice(0, limit || 100);
}

/**
 * Get stations by geographic bounding box
 */
async function getStationsByBBox(bbox: BBox, limit?: number): Promise<Station[]> {
  return getMockStations().slice(0, limit || 100);
}

// ============================================================================
// METADATA
// ============================================================================

/**
 * Get list of all infrastructure managers
 */
async function getInfrastructureManagers(): Promise<InfrastructureManager[]> {
  const cacheKey = 'metadata:infrastructure_managers';
  const cached = getCached<InfrastructureManager[]>(cacheKey);
  if (cached) return cached;

  const managers = getMockInfrastructureManagers();
  setCache(cacheKey, managers);
  return managers;
}

/**
 * Get list of all track designations
 */
async function getTrackDesignations(): Promise<string[]> {
  const cacheKey = 'metadata:track_designations';
  const cached = getCached<string[]>(cacheKey);
  if (cached) return cached;

  const designations = getMockTrackDesignations();
  setCache(cacheKey, designations);
  return designations;
}

/**
 * Get list of station codes
 */
async function getStationCodes(): Promise<{ code: string; name: string }[]> {
  const cacheKey = 'metadata:station_codes';
  const cached = getCached<{ code: string; name: string }[]>(cacheKey);
  if (cached) return cached;

  const codes = getMockStationCodes();
  setCache(cacheKey, codes);
  return codes;
}

/**
 * Get cache status
 */
function getCacheStatus(): { entries: number; oldestEntry: string | null } {
  let oldestTimestamp = Infinity;
  let oldestKey: string | null = null;

  cache.forEach((entry, key) => {
    if (entry.timestamp < oldestTimestamp) {
      oldestTimestamp = entry.timestamp;
      oldestKey = key;
    }
  });

  return {
    entries: cache.size,
    oldestEntry: oldestKey ? new Date(oldestTimestamp).toISOString() : null,
  };
}

/**
 * Clear the cache
 */
function clearCache(): void {
  cache.clear();
}

// ============================================================================
// EXPORTED CLIENT
// ============================================================================

export const lastkajenClient = {
  // Segment queries (primary use case)
  getSegmentInfrastructure,

  // Geographic queries (use bboxFromPoint to convert lat/lon to bbox)
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

  // Utility (use bboxFromPoint to convert lat/lon/radius to bbox)
  parseBBox,
  bboxFromPoint,
};
