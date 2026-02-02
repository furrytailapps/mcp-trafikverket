#!/usr/bin/env npx tsx
/**
 * Infrastructure Data Sync Script
 *
 * Syncs railway infrastructure data from available APIs:
 * - Stations: Trafikinfo API (TrainStation) - REAL DATA
 * - Tracks, tunnels, bridges: Lastkajen (when API available) - SAMPLE DATA for now
 *
 * Usage:
 *   npx tsx src/scripts/sync-lastkajen.ts
 *
 * Environment variables:
 *   TRAFIKVERKET_API_KEY - For Trafikinfo API (stations)
 *   LASTKAJEN_API_TOKEN - For Lastkajen API (infrastructure) - not yet implemented
 */

import { promises as fs } from 'fs';
import path from 'path';
import { type SyncStatus } from '@/types/sync-types';
import { type Station } from '@/types/njdb-api';

const DATA_DIR = path.join(process.cwd(), 'data');
const TRAFIKINFO_API = 'https://api.trafikinfo.trafikverket.se/v2/data.json';

async function writeJsonFile(filename: string, data: unknown): Promise<void> {
  const filePath = path.join(DATA_DIR, filename);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`[sync] Wrote ${filePath}`);
}

async function readJsonFile<T>(filename: string): Promise<T | null> {
  try {
    const filePath = path.join(DATA_DIR, filename);
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

async function ensureDataDir(): Promise<void> {
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
    console.log(`[sync] Created ${DATA_DIR}`);
  }
}

// ============================================================================
// TRAFIKINFO API - Real station data
// ============================================================================

interface TrafikinfoStation {
  LocationSignature: string;
  AdvertisedLocationName: string;
  AdvertisedShortLocationName?: string;
  Geometry?: {
    WGS84?: string;
  };
  PlatformLine?: string[];
  Advertised?: boolean;
  Deleted?: boolean;
}

interface TrafikinfoResponse {
  RESPONSE: {
    RESULT: Array<{
      TrainStation?: TrafikinfoStation[];
    }>;
  };
}

/**
 * Fetch all train stations from Trafikinfo API
 */
async function fetchStationsFromTrafikinfo(apiKey: string): Promise<Station[]> {
  console.log('[sync] Fetching stations from Trafikinfo API...');

  const xml = `
    <REQUEST>
      <LOGIN authenticationkey="${apiKey}" />
      <QUERY objecttype="TrainStation" schemaversion="1.0" limit="10000">
        <FILTER>
          <EQ name="Advertised" value="true" />
        </FILTER>
      </QUERY>
    </REQUEST>
  `;

  const response = await fetch(TRAFIKINFO_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body: xml,
  });

  if (!response.ok) {
    throw new Error(`Trafikinfo API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as TrafikinfoResponse;
  const trafikStations = data.RESPONSE?.RESULT?.[0]?.TrainStation || [];

  console.log(`[sync] Found ${trafikStations.length} stations from Trafikinfo API`);

  // Transform to our Station format
  return trafikStations
    .filter((s) => !s.Deleted && s.Geometry?.WGS84)
    .map((s, index) => {
      // Parse WGS84 POINT geometry: "POINT (lon lat)"
      const match = s.Geometry?.WGS84?.match(/POINT\s*\(\s*([\d.-]+)\s+([\d.-]+)\s*\)/);
      const lon = match ? parseFloat(match[1]) : 0;
      const lat = match ? parseFloat(match[2]) : 0;

      return {
        id: `STA-${String(index + 1).padStart(4, '0')}`,
        name: s.AdvertisedLocationName,
        signature: s.LocationSignature,
        type: 'station' as const,
        platforms: s.PlatformLine?.length || 0,
        tracks: Math.ceil((s.PlatformLine?.length || 0) / 2),
        accessible: true, // Assume accessible by default
        geometry: {
          type: 'Point' as const,
          coordinates: [lon, lat],
        },
      };
    });
}

// ============================================================================
// MAIN SYNC
// ============================================================================

async function syncFromLastkajen(): Promise<SyncStatus> {
  console.log('[sync] Starting infrastructure data sync...');

  const trafikverketKey = process.env.TRAFIKVERKET_API_KEY;
  let stationsCount = 0;
  let stationsSynced = false;

  // Sync stations from Trafikinfo API (real data!)
  if (trafikverketKey) {
    try {
      const stations = await fetchStationsFromTrafikinfo(trafikverketKey);
      if (stations.length > 0) {
        await writeJsonFile('stations.json', stations);
        stationsCount = stations.length;
        stationsSynced = true;
        console.log(`[sync] Synced ${stationsCount} stations from Trafikinfo API`);

        // Update metadata with station codes
        const existingMetadata = await readJsonFile<{
          managers: unknown[];
          trackDesignations: string[];
          stationCodes: { code: string; name: string }[];
        }>('metadata.json');

        const stationCodes = stations.map((s) => ({
          code: s.signature,
          name: s.name,
        }));

        const metadata = {
          managers: existingMetadata?.managers || [],
          trackDesignations: existingMetadata?.trackDesignations || [],
          stationCodes,
        };

        await writeJsonFile('metadata.json', metadata);
        console.log(`[sync] Updated metadata with ${stationCodes.length} station codes`);
      }
    } catch (error) {
      console.error('[sync] Failed to fetch stations:', error instanceof Error ? error.message : error);
    }
  } else {
    console.log('[sync] TRAFIKVERKET_API_KEY not set - skipping station sync');
  }

  // For tracks, tunnels, bridges, etc. - preserve existing sample data
  // (Lastkajen API endpoints not yet implemented)
  console.log('[sync] Tracks/tunnels/bridges: preserving existing sample data');
  console.log('[sync] (Lastkajen API endpoints not yet implemented)');

  const tracks = await readJsonFile<unknown[]>('tracks.json');
  const tunnels = await readJsonFile<unknown[]>('tunnels.json');
  const bridges = await readJsonFile<unknown[]>('bridges.json');
  const switches = await readJsonFile<unknown[]>('switches.json');
  const electrification = await readJsonFile<unknown[]>('electrification.json');
  const existingStations = stationsSynced ? null : await readJsonFile<unknown[]>('stations.json');

  const status: SyncStatus = {
    lastSync: new Date().toISOString(),
    source: stationsSynced ? 'trafikinfo' : 'manual',
    success: true,
    counts: {
      tracks: tracks?.length || 0,
      tunnels: tunnels?.length || 0,
      bridges: bridges?.length || 0,
      switches: switches?.length || 0,
      electrification: electrification?.length || 0,
      stations: stationsSynced ? stationsCount : existingStations?.length || 0,
    },
  };

  await writeJsonFile('sync-status.json', status);
  console.log('[sync] Sync complete');

  return status;
}

// Main entry point
async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Infrastructure Data Sync');
  console.log('='.repeat(60));

  await ensureDataDir();
  const status = await syncFromLastkajen();

  console.log('');
  console.log('Summary:');
  console.log(`  Success: ${status.success}`);
  console.log(`  Source: ${status.source}`);
  console.log(`  Tracks: ${status.counts.tracks} (sample)`);
  console.log(`  Tunnels: ${status.counts.tunnels} (sample)`);
  console.log(`  Bridges: ${status.counts.bridges} (sample)`);
  console.log(`  Switches: ${status.counts.switches} (sample)`);
  console.log(`  Electrification: ${status.counts.electrification} (sample)`);
  console.log(`  Stations: ${status.counts.stations} ${status.source === 'trafikinfo' ? '(REAL)' : '(sample)'}`);

  if (status.error) {
    console.log(`  Error: ${status.error}`);
  }

  console.log('='.repeat(60));
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

export { syncFromLastkajen };
