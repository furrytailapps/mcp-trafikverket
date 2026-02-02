#!/usr/bin/env npx tsx
/**
 * Lastkajen Data Sync Script
 *
 * Downloads NJDB infrastructure data from Lastkajen API and saves to JSON files.
 * Run manually or via Vercel Cron.
 *
 * Usage:
 *   npx tsx src/scripts/sync-lastkajen.ts
 *
 * Environment variables:
 *   LASTKAJEN_API_TOKEN - Bearer token for authentication (required)
 *
 * Output files (in /data directory):
 *   - tracks.json
 *   - tunnels.json
 *   - bridges.json
 *   - switches.json
 *   - electrification.json
 *   - stations.json
 *   - metadata.json
 *   - sync-status.json
 */

import { promises as fs } from 'fs';
import path from 'path';
import { type SyncStatus } from '@/types/sync-types';

// Data directory path
const DATA_DIR = path.join(process.cwd(), 'data');

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

/**
 * Main sync function
 *
 * Currently a placeholder that preserves existing data.
 * Once Lastkajen API endpoints are verified, this will fetch real data.
 */
async function syncFromLastkajen(): Promise<SyncStatus> {
  console.log('[sync] Starting Lastkajen data sync...');

  const token = process.env.LASTKAJEN_API_TOKEN;
  if (!token) {
    console.warn('[sync] LASTKAJEN_API_TOKEN not set - skipping API fetch');
    return {
      lastSync: new Date().toISOString(),
      source: 'manual',
      success: false,
      error: 'LASTKAJEN_API_TOKEN not configured',
      counts: { tracks: 0, tunnels: 0, bridges: 0, switches: 0, electrification: 0, stations: 0 },
    };
  }

  try {
    // TODO: Implement actual Lastkajen API calls once endpoints are verified
    //
    // The Lastkajen API workflow is:
    // 1. GET /api/Products - List available data products
    // 2. POST /api/Products/{id}/Download - Request download, get token
    // 3. GET /api/Download/{token} - Download file (token valid 60 seconds)
    //
    // For now, we preserve existing data files and just update sync status

    console.log('[sync] Lastkajen API endpoints not yet implemented');
    console.log('[sync] Preserving existing data files');

    // Read existing counts
    const existingStatus = await readJsonFile<SyncStatus>('sync-status.json');
    const tracks = await readJsonFile<unknown[]>('tracks.json');
    const tunnels = await readJsonFile<unknown[]>('tunnels.json');
    const bridges = await readJsonFile<unknown[]>('bridges.json');
    const switches = await readJsonFile<unknown[]>('switches.json');
    const electrification = await readJsonFile<unknown[]>('electrification.json');
    const stations = await readJsonFile<unknown[]>('stations.json');

    const status: SyncStatus = {
      lastSync: new Date().toISOString(),
      source: 'manual',
      success: true,
      counts: {
        tracks: tracks?.length || existingStatus?.counts.tracks || 0,
        tunnels: tunnels?.length || existingStatus?.counts.tunnels || 0,
        bridges: bridges?.length || existingStatus?.counts.bridges || 0,
        switches: switches?.length || existingStatus?.counts.switches || 0,
        electrification: electrification?.length || existingStatus?.counts.electrification || 0,
        stations: stations?.length || existingStatus?.counts.stations || 0,
      },
    };

    await writeJsonFile('sync-status.json', status);
    console.log('[sync] Sync complete (data preserved, status updated)');

    return status;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[sync] Error:', errorMessage);

    const status: SyncStatus = {
      lastSync: new Date().toISOString(),
      source: 'lastkajen',
      success: false,
      error: errorMessage,
      counts: { tracks: 0, tunnels: 0, bridges: 0, switches: 0, electrification: 0, stations: 0 },
    };

    await writeJsonFile('sync-status.json', status);
    return status;
  }
}

// Main entry point
async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Lastkajen Data Sync');
  console.log('='.repeat(60));

  await ensureDataDir();
  const status = await syncFromLastkajen();

  console.log('');
  console.log('Summary:');
  console.log(`  Success: ${status.success}`);
  console.log(`  Source: ${status.source}`);
  console.log(`  Tracks: ${status.counts.tracks}`);
  console.log(`  Tunnels: ${status.counts.tunnels}`);
  console.log(`  Bridges: ${status.counts.bridges}`);
  console.log(`  Switches: ${status.counts.switches}`);
  console.log(`  Electrification: ${status.counts.electrification}`);
  console.log(`  Stations: ${status.counts.stations}`);

  if (status.error) {
    console.log(`  Error: ${status.error}`);
  }

  console.log('='.repeat(60));
}

// Run if executed directly
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

export { syncFromLastkajen };
