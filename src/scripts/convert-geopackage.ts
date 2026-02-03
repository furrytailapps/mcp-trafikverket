#!/usr/bin/env npx tsx
/**
 * Convert GeoPackage railway data to JSON format
 *
 * Reads the downloaded GeoPackage and converts to our data format.
 *
 * Usage:
 *   npx tsx src/scripts/convert-geopackage.ts
 */

import { promises as fs } from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const DATA_DIR = path.join(process.cwd(), 'data');
const TEMP_DIR = path.join(DATA_DIR, 'temp');

// Find the .gpkg file in temp directory
async function findGpkgFile(): Promise<string> {
  const files = await fs.readdir(TEMP_DIR);
  const gpkg = files.find((f) => f.endsWith('.gpkg'));
  if (!gpkg) throw new Error('No .gpkg file found in data/temp/');
  return path.join(TEMP_DIR, gpkg);
}

// Parse WKB (Well-Known Binary) geometry to GeoJSON coordinates
// GeoPackage uses standard WKB format for geometry storage
function parseWkbToCoordinates(wkb: Buffer): number[][] | null {
  if (!wkb || wkb.length < 5) return null;

  try {
    // GeoPackage WKB has a header: byte order, type, SRID, envelope
    // Standard WKB: 1 byte order + 4 byte type + coordinates

    let offset = 0;

    // Check for GeoPackage header (starts with 'GP')
    const hasGpkgHeader = wkb[0] === 0x47 && wkb[1] === 0x50;

    if (hasGpkgHeader) {
      // GeoPackage Binary Geometry header
      // Bytes 0-1: Magic (GP)
      // Byte 2: Version
      // Byte 3: Flags
      const flags = wkb[3];
      const envelopeType = (flags >> 1) & 0x07;

      // Calculate envelope size
      let envelopeSize = 0;
      if (envelopeType === 1) envelopeSize = 32; // [minX, maxX, minY, maxY]
      else if (envelopeType === 2) envelopeSize = 48; // + [minZ, maxZ]
      else if (envelopeType === 3) envelopeSize = 48; // + [minM, maxM]
      else if (envelopeType === 4) envelopeSize = 64; // + [minZ, maxZ, minM, maxM]

      offset = 8 + envelopeSize; // 8 byte header + envelope
    }

    // Now read WKB
    const byteOrder = wkb[offset]; // 0 = big endian, 1 = little endian
    const isLittleEndian = byteOrder === 1;

    // Read geometry type (4 bytes)
    const typeBytes = wkb.slice(offset + 1, offset + 5);
    const geomType = isLittleEndian ? typeBytes.readUInt32LE(0) : typeBytes.readUInt32BE(0);

    // Type 2 = LineString, Type 1 = Point
    if (geomType !== 2 && geomType !== 1) {
      // Could be MultiLineString (5) or other
      return null;
    }

    if (geomType === 1) {
      // Point
      const x = isLittleEndian
        ? wkb.readDoubleLE(offset + 5)
        : wkb.readDoubleBE(offset + 5);
      const y = isLittleEndian
        ? wkb.readDoubleLE(offset + 13)
        : wkb.readDoubleBE(offset + 13);
      return [[x, y]];
    }

    // LineString
    const numPointsOffset = offset + 5;
    const numPoints = isLittleEndian
      ? wkb.readUInt32LE(numPointsOffset)
      : wkb.readUInt32BE(numPointsOffset);

    const coords: number[][] = [];
    let coordOffset = numPointsOffset + 4;

    for (let i = 0; i < numPoints && coordOffset + 16 <= wkb.length; i++) {
      const x = isLittleEndian
        ? wkb.readDoubleLE(coordOffset)
        : wkb.readDoubleBE(coordOffset);
      const y = isLittleEndian
        ? wkb.readDoubleLE(coordOffset + 8)
        : wkb.readDoubleBE(coordOffset + 8);
      coords.push([x, y]);
      coordOffset += 16;
    }

    return coords.length > 0 ? coords : null;
  } catch {
    return null;
  }
}

interface Track {
  id: string;
  designation: string;
  name: string;
  gauge: number;
  speedLimit: number;
  electrified: boolean;
  electrificationType: string;
  infrastructureManager: string;
  trackClass: string;
  numberOfTracks: number;
  length: number;
  geometry: {
    type: 'LineString';
    coordinates: number[][];
  };
}

interface Tunnel {
  id: string;
  name: string;
  trackId: string;
  length: number;
  geometry: {
    type: 'LineString';
    coordinates: number[][];
  };
}

interface Bridge {
  id: string;
  name: string;
  trackId: string;
  type: string;
  length: number;
  geometry: {
    type: 'LineString';
    coordinates: number[][];
  };
}

interface Station {
  id: string;
  name: string;
  signature: string;
  type: string;
  platforms: number;
  tracks: number;
  accessible: boolean;
  geometry: {
    type: 'Point';
    coordinates: number[];
  };
}

async function main() {
  console.log('='.repeat(60));
  console.log('GeoPackage to JSON Conversion');
  console.log('='.repeat(60));
  console.log('');

  const gpkgPath = await findGpkgFile();
  console.log(`Reading: ${gpkgPath}`);

  const db = new Database(gpkgPath, { readonly: true });

  // Get all records
  const rows = db
    .prepare('SELECT * FROM Järnvägsnät_med_grundegenskaper3_0')
    .all() as Record<string, unknown>[];

  console.log(`Total records: ${rows.length}`);

  // Collect unique tracks, tunnels, bridges, stations
  const tracksMap = new Map<string, Track>();
  const tunnelsMap = new Map<string, Tunnel>();
  const bridgesMap = new Map<string, Bridge>();
  const stationsMap = new Map<string, Station>();

  let processedCount = 0;
  let geometryErrors = 0;

  for (const row of rows) {
    processedCount++;
    if (processedCount % 10000 === 0) {
      console.log(`Processing: ${processedCount}/${rows.length}`);
    }

    const coords = parseWkbToCoordinates(row.geom as Buffer);
    if (!coords || coords.length === 0) {
      geometryErrors++;
      continue;
    }

    const bandel = row.Bandel as string || '';
    const bandelNamn = row.Bandelnamn as string || '';
    const elementId = row.ELEMENT_ID as string || '';
    const segmentLength = row.SEGMENT_LENGTH as number || 0;
    const elektrifi = row.Elektrifi as string || '';
    const infraCode = row.InfrafKod as string || '';
    const infraName = row.Infrafnam as string || '';
    const sthMed = row.STH_A_med as number || 0;

    // Track: aggregate by Bandel
    if (bandel && bandel !== 'null') {
      const existing = tracksMap.get(bandel);
      if (existing) {
        // Add coordinates to existing track
        existing.length += segmentLength;
        // Extend geometry (simplified: just add coords)
        if (existing.geometry.coordinates.length > 0 && coords.length > 0) {
          existing.geometry.coordinates.push(...coords);
        }
      } else {
        tracksMap.set(bandel, {
          id: `TRK-${bandel}`,
          designation: bandel,
          name: bandelNamn,
          gauge: 1435, // Standard gauge
          speedLimit: sthMed,
          electrified: elektrifi !== 'ej el',
          electrificationType: elektrifi,
          infrastructureManager: infraName || infraCode || 'Unknown',
          trackClass: 'standard',
          numberOfTracks: 1,
          length: segmentLength,
          geometry: {
            type: 'LineString' as const,
            coordinates: coords,
          },
        });
      }
    }

    // Tunnel - uses -1 for true in GeoPackage
    if ((row.Tunnel as number) === -1) {
      const tunnelName = row.Tunnelnam as string || '';
      const tunnelKey = tunnelName || elementId;
      if (!tunnelsMap.has(tunnelKey)) {
        tunnelsMap.set(tunnelKey, {
          id: `TUN-${tunnelsMap.size + 1}`,
          name: tunnelName || 'Unnamed Tunnel',
          trackId: bandel,
          length: segmentLength,
          geometry: {
            type: 'LineString' as const,
            coordinates: coords,
          },
        });
      }
    }

    // Bridge - uses -1 for true in GeoPackage
    if ((row.Bro as number) === -1) {
      const bridgeName = row.Bronamn as string || '';
      const bridgeFunc = row.Brofunk as string || '';
      const bridgeKey = bridgeName || elementId;
      if (!bridgesMap.has(bridgeKey)) {
        bridgesMap.set(bridgeKey, {
          id: `BRG-${bridgesMap.size + 1}`,
          name: bridgeName || 'Unnamed Bridge',
          trackId: bandel,
          type: bridgeFunc || 'railway',
          length: segmentLength,
          geometry: {
            type: 'LineString' as const,
            coordinates: coords,
          },
        });
      }
    }

    // Station (from PlNamn)
    const plNamn = row.PlNamn as string || '';
    const plForb = row.Pl_Forb as string || '';
    if (plNamn && plNamn !== 'null' && !stationsMap.has(plNamn)) {
      // Use first coordinate as station point
      stationsMap.set(plNamn, {
        id: `STA-${stationsMap.size + 1}`,
        name: plNamn,
        signature: plForb || '',
        type: 'station',
        platforms: 0,
        tracks: 0,
        accessible: true,
        geometry: {
          type: 'Point' as const,
          coordinates: coords[0],
        },
      });
    }
  }

  db.close();

  console.log('');
  console.log('Conversion Summary:');
  console.log('-'.repeat(40));
  console.log(`  Tracks: ${tracksMap.size}`);
  console.log(`  Tunnels: ${tunnelsMap.size}`);
  console.log(`  Bridges: ${bridgesMap.size}`);
  console.log(`  Stations (from PlNamn): ${stationsMap.size}`);
  console.log(`  Geometry errors: ${geometryErrors}`);

  // Write to JSON files
  console.log('');
  console.log('Writing JSON files...');

  const tracks = Array.from(tracksMap.values());
  const tunnels = Array.from(tunnelsMap.values());
  const bridges = Array.from(bridgesMap.values());
  // Note: We keep existing stations from Trafikinfo, just log these for reference

  await fs.writeFile(
    path.join(DATA_DIR, 'tracks.json'),
    JSON.stringify(tracks, null, 2)
  );
  console.log(`  Wrote tracks.json (${tracks.length} tracks)`);

  await fs.writeFile(
    path.join(DATA_DIR, 'tunnels.json'),
    JSON.stringify(tunnels, null, 2)
  );
  console.log(`  Wrote tunnels.json (${tunnels.length} tunnels)`);

  await fs.writeFile(
    path.join(DATA_DIR, 'bridges.json'),
    JSON.stringify(bridges, null, 2)
  );
  console.log(`  Wrote bridges.json (${bridges.length} bridges)`);

  // Write stations from GeoPackage for reference (as njdb-stations.json)
  const njdbStations = Array.from(stationsMap.values());
  await fs.writeFile(
    path.join(DATA_DIR, 'njdb-stations.json'),
    JSON.stringify(njdbStations, null, 2)
  );
  console.log(`  Wrote njdb-stations.json (${njdbStations.length} stations from NJDB)`);

  // Update metadata
  const metadata = {
    managers: Array.from(new Set(tracks.map((t) => t.infrastructureManager))).map((name) => ({
      code: name.substring(0, 3).toUpperCase(),
      name,
    })),
    trackDesignations: tracks.map((t) => t.designation),
    stationCodes: njdbStations.map((s) => ({ code: s.signature, name: s.name })),
  };
  await fs.writeFile(
    path.join(DATA_DIR, 'metadata.json'),
    JSON.stringify(metadata, null, 2)
  );
  console.log(`  Wrote metadata.json`);

  // Update sync status
  const syncStatus = {
    lastSync: new Date().toISOString(),
    source: 'lastkajen',
    success: true,
    counts: {
      tracks: tracks.length,
      tunnels: tunnels.length,
      bridges: bridges.length,
      switches: 0,
      electrification: 0,
      stations: njdbStations.length,
    },
  };
  await fs.writeFile(
    path.join(DATA_DIR, 'sync-status.json'),
    JSON.stringify(syncStatus, null, 2)
  );
  console.log(`  Wrote sync-status.json`);

  console.log('');
  console.log('='.repeat(60));
  console.log('Conversion complete!');
  console.log('='.repeat(60));
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
