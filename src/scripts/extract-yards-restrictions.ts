#!/usr/bin/env npx tsx
/**
 * Extract yards and access restrictions from INSPIRE Railway packages
 *
 * Usage:
 *   npx tsx src/scripts/extract-yards-restrictions.ts
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

    if (geom[0] === 0x47 && geom[1] === 0x50) {
      const envelopeType = (geom[3] >> 1) & 0x07;
      const envelopeSizes = [0, 32, 48, 48, 64];
      const envelopeSize = envelopeSizes[envelopeType] ?? 0;
      offset = 8 + envelopeSize;
    }

    const isLittleEndian = geom[offset] === 1;
    const typeBytes = geom.slice(offset + 1, offset + 5);
    const geomType = isLittleEndian ? typeBytes.readUInt32LE(0) : typeBytes.readUInt32BE(0);

    if (geomType !== 1) return null;

    const x = isLittleEndian ? geom.readDoubleLE(offset + 5) : geom.readDoubleBE(offset + 5);
    const y = isLittleEndian ? geom.readDoubleLE(offset + 13) : geom.readDoubleBE(offset + 13);

    const [longitude, latitude] = swerefToWgs84(x, y);
    return { longitude, latitude };
  } catch {
    return null;
  }
}

// Parse GeoPackage polygon geometry - extract centroid
function parsePolygonCentroid(geom: Buffer): { longitude: number; latitude: number } | null {
  if (!geom || geom.length < 30) return null;

  try {
    let offset = 0;

    if (geom[0] === 0x47 && geom[1] === 0x50) {
      const envelopeType = (geom[3] >> 1) & 0x07;
      const envelopeSizes = [0, 32, 48, 48, 64];
      const envelopeSize = envelopeSizes[envelopeType] ?? 0;
      offset = 8 + envelopeSize;
    }

    const isLittleEndian = geom[offset] === 1;
    const typeBytes = geom.slice(offset + 1, offset + 5);
    const geomType = isLittleEndian ? typeBytes.readUInt32LE(0) : typeBytes.readUInt32BE(0);

    // Polygon type = 3
    if (geomType !== 3) return null;

    // Read number of rings
    const numRings = isLittleEndian ? geom.readUInt32LE(offset + 5) : geom.readUInt32BE(offset + 5);
    if (numRings < 1) return null;

    // Read number of points in first ring (exterior)
    const numPoints = isLittleEndian ? geom.readUInt32LE(offset + 9) : geom.readUInt32BE(offset + 9);
    if (numPoints < 3) return null;

    // Calculate centroid from first ring points
    let sumX = 0,
      sumY = 0;
    let coordOffset = offset + 13;

    for (let i = 0; i < numPoints && coordOffset + 16 <= geom.length; i++) {
      const x = isLittleEndian ? geom.readDoubleLE(coordOffset) : geom.readDoubleBE(coordOffset);
      const y = isLittleEndian ? geom.readDoubleLE(coordOffset + 8) : geom.readDoubleBE(coordOffset + 8);
      sumX += x;
      sumY += y;
      coordOffset += 16;
    }

    const centroidX = sumX / numPoints;
    const centroidY = sumY / numPoints;
    const [longitude, latitude] = swerefToWgs84(centroidX, centroidY);

    return { longitude, latitude };
  } catch {
    return null;
  }
}

// Parse LineString geometry - get midpoint
function parseLineStringMidpoint(geom: Buffer): { longitude: number; latitude: number } | null {
  if (!geom || geom.length < 30) return null;

  try {
    let offset = 0;

    if (geom[0] === 0x47 && geom[1] === 0x50) {
      const envelopeType = (geom[3] >> 1) & 0x07;
      const envelopeSizes = [0, 32, 48, 48, 64];
      const envelopeSize = envelopeSizes[envelopeType] ?? 0;
      offset = 8 + envelopeSize;
    }

    const isLittleEndian = geom[offset] === 1;
    const typeBytes = geom.slice(offset + 1, offset + 5);
    const geomType = isLittleEndian ? typeBytes.readUInt32LE(0) : typeBytes.readUInt32BE(0);

    // LineString type = 2
    if (geomType !== 2) return null;

    const numPoints = isLittleEndian ? geom.readUInt32LE(offset + 5) : geom.readUInt32BE(offset + 5);
    if (numPoints < 1) return null;

    // Get midpoint
    const midIndex = Math.floor(numPoints / 2);
    const coordOffset = offset + 9 + midIndex * 16;

    if (coordOffset + 16 > geom.length) return null;

    const x = isLittleEndian ? geom.readDoubleLE(coordOffset) : geom.readDoubleBE(coordOffset);
    const y = isLittleEndian ? geom.readDoubleLE(coordOffset + 8) : geom.readDoubleBE(coordOffset + 8);

    const [longitude, latitude] = swerefToWgs84(x, y);
    return { longitude, latitude };
  } catch {
    return null;
  }
}

async function downloadAndExtract(packageId: number, fileName: string, gpkgName: string): Promise<string> {
  const gpkgPath = path.join(TEMP_DIR, gpkgName);

  try {
    await fs.access(gpkgPath);
    console.log(`Using existing ${gpkgName}`);
    return gpkgPath;
  } catch {
    console.log(`Downloading ${fileName}...`);
    const zipData = await downloadPackageFile(packageId, fileName);
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
          }
        })
        .on('close', resolve)
        .on('error', reject);
    });

    return gpkgPath;
  }
}

interface Yard {
  id: string;
  name: string;
  inspireId?: string;
  validFrom?: string;
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
}

interface AccessRestriction {
  id: string;
  restriction: 'public' | 'private' | 'physically_impossible';
  direction: string;
  inspireId?: string;
  validFrom?: string;
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
}

async function main() {
  console.log('='.repeat(60));
  console.log('Extract Yards and Access Restrictions');
  console.log('='.repeat(60));
  console.log('');

  await ensureDir(DATA_DIR);
  await ensureDir(TEMP_DIR);

  // ========== YARDS ==========
  console.log('\n--- Extracting Yards ---');
  const yardGpkgPath = await downloadAndExtract(10095, 'TN_RAILWAY_YARDAREA_gpkg.zip', 'TN_RAILWAY_YARDAREA.gpkg');

  const yardDb = new Database(yardGpkgPath, { readonly: true });
  const yardRows = yardDb.prepare('SELECT * FROM TN_RAILWAYYARDAREA').all() as Array<{
    id: number;
    geom: Buffer;
    inspireId: string;
    geographicalName: string | null;
    validFrom: string;
  }>;

  console.log(`Found ${yardRows.length} yard areas`);

  const yards: Yard[] = [];
  let yardParseErrors = 0;

  for (const row of yardRows) {
    const point = parsePolygonCentroid(row.geom);
    if (!point) {
      yardParseErrors++;
      continue;
    }

    yards.push({
      id: `YRD-${yards.length + 1}`,
      name: row.geographicalName || 'Unnamed Yard',
      inspireId: row.inspireId,
      validFrom: row.validFrom,
      geometry: {
        type: 'Point',
        coordinates: [point.longitude, point.latitude],
      },
    });
  }

  yardDb.close();
  console.log(`Extracted ${yards.length} yards (${yardParseErrors} parse errors)`);

  // ========== ACCESS RESTRICTIONS ==========
  console.log('\n--- Extracting Access Restrictions ---');
  const restrictionGpkgPath = await downloadAndExtract(
    10095,
    'TN_RAILWAY_ACCESSRESTRICTION_gpkg.zip',
    'TN_RAILWAY_ACCESSRESTRICTION.gpkg',
  );

  const restrictionDb = new Database(restrictionGpkgPath, { readonly: true });

  // Only extract private and physically impossible (public is the default)
  const restrictionRows = restrictionDb
    .prepare("SELECT * FROM TN_RAILWAY_ACCESSRESTRICTION WHERE restriction != 'public access'")
    .all() as Array<{
    id: number;
    geom: Buffer;
    inspireId: string;
    restriction: string;
    applicableDirection: string;
    validFrom: string;
  }>;

  console.log(`Found ${restrictionRows.length} non-public restrictions`);

  const restrictions: AccessRestriction[] = [];
  let restrictionParseErrors = 0;

  for (const row of restrictionRows) {
    const point = parseLineStringMidpoint(row.geom);
    if (!point) {
      restrictionParseErrors++;
      continue;
    }

    const restrictionType =
      row.restriction === 'private'
        ? 'private'
        : row.restriction === 'physically impossible'
          ? 'physically_impossible'
          : 'private';

    restrictions.push({
      id: `RST-${restrictions.length + 1}`,
      restriction: restrictionType,
      direction: row.applicableDirection,
      inspireId: row.inspireId,
      validFrom: row.validFrom,
      geometry: {
        type: 'Point',
        coordinates: [point.longitude, point.latitude],
      },
    });
  }

  restrictionDb.close();
  console.log(`Extracted ${restrictions.length} restrictions (${restrictionParseErrors} parse errors)`);

  // ========== WRITE FILES ==========
  console.log('\n--- Writing files ---');

  await fs.writeFile(path.join(DATA_DIR, 'yards.json'), JSON.stringify(yards, null, 2));
  console.log(`Wrote yards.json (${yards.length} yards)`);

  await fs.writeFile(path.join(DATA_DIR, 'access-restrictions.json'), JSON.stringify(restrictions, null, 2));
  console.log(`Wrote access-restrictions.json (${restrictions.length} restrictions)`);

  // Update sync-status.json
  const syncStatusPath = path.join(DATA_DIR, 'sync-status.json');
  try {
    const syncStatus = JSON.parse(await fs.readFile(syncStatusPath, 'utf-8'));
    syncStatus.counts.yards = yards.length;
    syncStatus.counts.accessRestrictions = restrictions.length;
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
