#!/usr/bin/env npx tsx
/**
 * Extract switches from TN_RAILWAY_NODE GeoPackage
 *
 * In INSPIRE TN terminology, "junction" nodes represent where tracks split,
 * which is where switches (spårväxlar) are located.
 *
 * Usage:
 *   npx tsx src/scripts/extract-switches.ts
 */

import { promises as fs, createWriteStream } from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import proj4 from 'proj4';
import unzipper from 'unzipper';
import { Readable } from 'stream';
import { downloadPackageFile } from '../lib/lastkajen-api';

// Define SWEREF99TM (EPSG:3006)
proj4.defs('EPSG:3006', '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');

const DATA_DIR = path.join(process.cwd(), 'data');
const TEMP_DIR = path.join(DATA_DIR, 'temp');

async function ensureDir(dir: string) {
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
}

function swerefToWgs84(x: number, y: number): [number, number] {
  return proj4('EPSG:3006', 'EPSG:4326', [x, y]) as [number, number];
}

// Parse GeoPackage point geometry
function parsePointGeometry(geom: Buffer): { longitude: number; latitude: number } | null {
  if (!geom || geom.length < 21) return null;

  try {
    let offset = 0;

    // Check for GeoPackage header (magic bytes 'GP')
    if (geom[0] === 0x47 && geom[1] === 0x50) {
      const envelopeType = (geom[3] >> 1) & 0x07;
      const envelopeSizes = [0, 32, 48, 48, 64];
      const envelopeSize = envelopeSizes[envelopeType] ?? 0;
      offset = 8 + envelopeSize;
    }

    const isLittleEndian = geom[offset] === 1;
    const typeBytes = geom.slice(offset + 1, offset + 5);
    const geomType = isLittleEndian ? typeBytes.readUInt32LE(0) : typeBytes.readUInt32BE(0);

    // Point type = 1
    if (geomType !== 1) return null;

    const x = isLittleEndian ? geom.readDoubleLE(offset + 5) : geom.readDoubleBE(offset + 5);
    const y = isLittleEndian ? geom.readDoubleLE(offset + 13) : geom.readDoubleBE(offset + 13);

    const [longitude, latitude] = swerefToWgs84(x, y);
    return { longitude, latitude };
  } catch {
    return null;
  }
}

interface Switch {
  id: string;
  type: string;
  inspireId?: string;
  validFrom?: string;
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
}

async function main() {
  console.log('='.repeat(60));
  console.log('Extract Switches from Railway Nodes');
  console.log('='.repeat(60));
  console.log('');

  await ensureDir(DATA_DIR);
  await ensureDir(TEMP_DIR);

  // Check if we have the node file, if not download it
  const nodeGpkgPath = path.join(TEMP_DIR, 'TN_RAILWAY_NODE.gpkg');
  try {
    await fs.access(nodeGpkgPath);
    console.log('Using existing TN_RAILWAY_NODE.gpkg');
  } catch {
    console.log('Downloading TN_RAILWAY_NODE.gpkg...');
    const zipData = await downloadPackageFile(10095, 'TN_RAILWAY_NODE_gpkg.zip');
    console.log(`Downloaded ${(zipData.byteLength / 1024 / 1024).toFixed(2)} MB`);

    const buffer = Buffer.from(zipData);
    const readable = Readable.from(buffer);

    await new Promise<void>((resolve, reject) => {
      readable
        .pipe(unzipper.Parse())
        .on('entry', async (entry) => {
          const filePath = path.join(TEMP_DIR, entry.path);
          if (entry.type === 'Directory') {
            await ensureDir(filePath);
            entry.autodrain();
          } else {
            await ensureDir(path.dirname(filePath));
            const ws = createWriteStream(filePath);
            entry.pipe(ws);
            console.log('Extracted:', entry.path);
          }
        })
        .on('close', resolve)
        .on('error', reject);
    });
  }

  console.log('\nExtracting junction nodes (switches)...');
  const db = new Database(nodeGpkgPath, { readonly: true });

  // Get all junction nodes (these are switch locations)
  const junctionNodes = db.prepare("SELECT * FROM TN_RAILWAYNODE WHERE formOfNode = 'junction'").all() as Array<{
    id: number;
    geom: Buffer;
    inspireId: string;
    validFrom: string;
    formOfNode: string;
  }>;

  console.log(`Found ${junctionNodes.length} junction nodes`);

  const switches: Switch[] = [];
  let parseErrors = 0;

  for (const node of junctionNodes) {
    const point = parsePointGeometry(node.geom);
    if (!point) {
      parseErrors++;
      continue;
    }

    switches.push({
      id: `SWT-${switches.length + 1}`,
      type: 'junction',
      inspireId: node.inspireId,
      validFrom: node.validFrom,
      geometry: {
        type: 'Point',
        coordinates: [point.longitude, point.latitude],
      },
    });
  }

  db.close();

  console.log(`\nExtracted ${switches.length} switches (${parseErrors} parse errors)`);

  // Write to switches.json
  await fs.writeFile(path.join(DATA_DIR, 'switches.json'), JSON.stringify(switches, null, 2));
  console.log(`Wrote switches.json (${switches.length} switches)`);

  // Update sync-status.json
  const syncStatusPath = path.join(DATA_DIR, 'sync-status.json');
  try {
    const syncStatus = JSON.parse(await fs.readFile(syncStatusPath, 'utf-8'));
    syncStatus.counts.switches = switches.length;
    syncStatus.lastSync = new Date().toISOString();
    await fs.writeFile(syncStatusPath, JSON.stringify(syncStatus, null, 2));
    console.log('Updated sync-status.json');
  } catch {
    console.log('Could not update sync-status.json');
  }

  console.log('\n' + '='.repeat(60));
  console.log('Done!');
  console.log('='.repeat(60));
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
