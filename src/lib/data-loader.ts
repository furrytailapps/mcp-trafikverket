/**
 * Data loader for NJDB infrastructure data
 *
 * Loads JSON data files from /data directory. These files are populated
 * by the sync script (src/scripts/sync-lastkajen.ts) which fetches data
 * from the Lastkajen API.
 *
 * Data files are git-tracked for reliability - if sync fails, the MCP
 * continues working with the last known good data.
 */

import { promises as fs } from 'fs';
import path from 'path';
import {
  type Track,
  type Tunnel,
  type Bridge,
  type Switch,
  type ElectrificationSection,
  type Station,
  type InfrastructureManager,
  type Yard,
  type AccessRestriction,
} from '@/types/njdb-api';
import { type SyncStatus } from '@/types/sync-types';

// Data directory path - works in both development and production
const DATA_DIR = path.join(process.cwd(), 'data');

// In-memory cache to avoid repeated file reads
interface DataCache {
  tracks?: Track[];
  tunnels?: Tunnel[];
  bridges?: Bridge[];
  switches?: Switch[];
  electrification?: ElectrificationSection[];
  stations?: Station[];
  yards?: Yard[];
  accessRestrictions?: AccessRestriction[];
  managers?: InfrastructureManager[];
  trackDesignations?: string[];
  stationCodes?: { code: string; name: string }[];
  syncStatus?: SyncStatus;
  loadedAt?: number;
}

const cache: DataCache = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes - refresh from files periodically

function isCacheValid(): boolean {
  return cache.loadedAt !== undefined && Date.now() - cache.loadedAt < CACHE_TTL;
}

async function loadJsonFile<T>(filename: string): Promise<T | null> {
  try {
    const filePath = path.join(DATA_DIR, filename);
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch (error) {
    // File doesn't exist or is invalid - return null
    console.warn(`Failed to load ${filename}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

async function ensureCacheLoaded(): Promise<void> {
  if (isCacheValid()) return;

  // Load all data files in parallel
  const [tracks, tunnels, bridges, switches, electrification, stations, yards, accessRestrictions, metadata, syncStatus] =
    await Promise.all([
      loadJsonFile<Track[]>('tracks.json'),
      loadJsonFile<Tunnel[]>('tunnels.json'),
      loadJsonFile<Bridge[]>('bridges.json'),
      loadJsonFile<Switch[]>('switches.json'),
      loadJsonFile<ElectrificationSection[]>('electrification.json'),
      loadJsonFile<Station[]>('stations.json'),
      loadJsonFile<Yard[]>('yards.json'),
      loadJsonFile<AccessRestriction[]>('access-restrictions.json'),
      loadJsonFile<{
        managers: InfrastructureManager[];
        trackDesignations: string[];
        stationCodes: { code: string; name: string }[];
      }>('metadata.json'),
      loadJsonFile<SyncStatus>('sync-status.json'),
    ]);

  cache.tracks = tracks || [];
  cache.tunnels = tunnels || [];
  cache.bridges = bridges || [];
  cache.switches = switches || [];
  cache.electrification = electrification || [];
  cache.stations = stations || [];
  cache.yards = yards || [];
  cache.accessRestrictions = accessRestrictions || [];
  cache.managers = metadata?.managers || [];
  cache.trackDesignations = metadata?.trackDesignations || [];
  cache.stationCodes = metadata?.stationCodes || [];
  cache.syncStatus = syncStatus || undefined;
  cache.loadedAt = Date.now();
}

// Public API

export async function loadTracks(): Promise<Track[]> {
  await ensureCacheLoaded();
  return cache.tracks || [];
}

export async function loadTunnels(): Promise<Tunnel[]> {
  await ensureCacheLoaded();
  return cache.tunnels || [];
}

export async function loadBridges(): Promise<Bridge[]> {
  await ensureCacheLoaded();
  return cache.bridges || [];
}

export async function loadSwitches(): Promise<Switch[]> {
  await ensureCacheLoaded();
  return cache.switches || [];
}

export async function loadElectrification(): Promise<ElectrificationSection[]> {
  await ensureCacheLoaded();
  return cache.electrification || [];
}

export async function loadStations(): Promise<Station[]> {
  await ensureCacheLoaded();
  return cache.stations || [];
}

export async function loadYards(): Promise<Yard[]> {
  await ensureCacheLoaded();
  return cache.yards || [];
}

export async function loadAccessRestrictions(): Promise<AccessRestriction[]> {
  await ensureCacheLoaded();
  return cache.accessRestrictions || [];
}

export async function loadInfrastructureManagers(): Promise<InfrastructureManager[]> {
  await ensureCacheLoaded();
  return cache.managers || [];
}

export async function loadTrackDesignations(): Promise<string[]> {
  await ensureCacheLoaded();
  return cache.trackDesignations || [];
}

export async function loadStationCodes(): Promise<{ code: string; name: string }[]> {
  await ensureCacheLoaded();
  return cache.stationCodes || [];
}

export async function loadSyncStatus(): Promise<SyncStatus | undefined> {
  await ensureCacheLoaded();
  return cache.syncStatus;
}

export function clearDataCache(): void {
  const keys = Object.keys(cache) as (keyof DataCache)[];
  keys.forEach((key) => {
    cache[key] = undefined;
  });
}
