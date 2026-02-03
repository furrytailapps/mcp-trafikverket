#!/usr/bin/env npx tsx
/**
 * Download and parse railway infrastructure data from Lastkajen
 *
 * Downloads the GeoPackage file and explores its structure.
 *
 * Usage:
 *   npx tsx src/scripts/download-railway-data.ts
 */

import { promises as fs, createWriteStream } from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import unzipper from 'unzipper';
import { Readable } from 'stream';
import {
  getDataPackageFiles,
  downloadPackageFile,
  RAILWAY_PACKAGE_IDS,
} from '../lib/lastkajen-api';

const DATA_DIR = path.join(process.cwd(), 'data');
const TEMP_DIR = path.join(process.cwd(), 'data', 'temp');

async function ensureDir(dir: string): Promise<void> {
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
    console.log(`Created directory: ${dir}`);
  }
}

async function extractZipToDir(zipBuffer: ArrayBuffer, targetDir: string): Promise<string[]> {
  const extractedFiles: string[] = [];

  // Convert ArrayBuffer to Buffer
  const buffer = Buffer.from(zipBuffer);

  // Create a readable stream from buffer
  const readable = Readable.from(buffer);

  // Extract using unzipper
  await new Promise<void>((resolve, reject) => {
    readable
      .pipe(unzipper.Parse())
      .on('entry', async (entry) => {
        const fileName = entry.path;
        const filePath = path.join(targetDir, fileName);

        if (entry.type === 'Directory') {
          await ensureDir(filePath);
          entry.autodrain();
        } else {
          await ensureDir(path.dirname(filePath));
          const writeStream = createWriteStream(filePath);
          entry.pipe(writeStream);
          extractedFiles.push(filePath);
          console.log(`  Extracted: ${fileName}`);
        }
      })
      .on('close', resolve)
      .on('error', reject);
  });

  return extractedFiles;
}

async function exploreGeoPackage(gpkgPath: string): Promise<void> {
  console.log(`\nExploring GeoPackage: ${gpkgPath}`);
  console.log('='.repeat(60));

  const db = new Database(gpkgPath, { readonly: true });

  // Get list of tables
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  console.log(`\nTables (${tables.length}):`);
  tables.forEach((t) => console.log(`  - ${t.name}`));

  // Check GeoPackage contents table
  try {
    const contents = db
      .prepare('SELECT table_name, data_type, identifier, description FROM gpkg_contents')
      .all() as { table_name: string; data_type: string; identifier: string; description: string }[];

    console.log(`\nGeoPackage Contents (layers):`);
    contents.forEach((c) => {
      console.log(`  - ${c.table_name} (${c.data_type})`);
      console.log(`    Identifier: ${c.identifier}`);
      if (c.description) console.log(`    Description: ${c.description}`);
    });

    // Explore each layer
    for (const layer of contents) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`Layer: ${layer.table_name}`);
      console.log('='.repeat(60));

      // Get column info
      const columns = db.prepare(`PRAGMA table_info(${layer.table_name})`).all() as {
        name: string;
        type: string;
      }[];
      console.log(`\nColumns (${columns.length}):`);
      columns.forEach((c) => console.log(`  - ${c.name}: ${c.type}`));

      // Get row count
      const countResult = db.prepare(`SELECT COUNT(*) as count FROM ${layer.table_name}`).get() as { count: number };
      console.log(`\nRow count: ${countResult.count}`);

      // Sample first row
      if (countResult.count > 0) {
        const sample = db.prepare(`SELECT * FROM ${layer.table_name} LIMIT 1`).get() as Record<string, unknown>;
        console.log(`\nSample row (first record):`);
        Object.entries(sample).forEach(([key, value]) => {
          if (key === 'geom' || key === 'geometry') {
            console.log(`  ${key}: [GEOMETRY BLOB - ${(value as Buffer)?.length || 0} bytes]`);
          } else {
            const strValue = String(value);
            console.log(`  ${key}: ${strValue.length > 100 ? strValue.substring(0, 100) + '...' : strValue}`);
          }
        });
      }
    }
  } catch (error) {
    console.error('Error reading GeoPackage contents:', error);
  }

  db.close();
}

async function main() {
  console.log('='.repeat(60));
  console.log('Railway Data Download & Exploration');
  console.log('='.repeat(60));
  console.log('');

  await ensureDir(DATA_DIR);
  await ensureDir(TEMP_DIR);

  // Get available files in the package
  console.log('Step 1: Get available files');
  console.log('-'.repeat(40));

  const files = await getDataPackageFiles(RAILWAY_PACKAGE_IDS.BASIC_PROPERTIES);
  console.log(`Package 10144 has ${files.length} files:`);
  files.forEach((f) => console.log(`  - ${f.name} (${f.size})`));

  // Find the latest GeoPackage ZIP
  const geoPackageFile = files
    .filter((f) => f.name.endsWith('_GeoPackage.zip') || f.name.endsWith('_geopackage.zip'))
    .sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime())[0];

  if (!geoPackageFile) {
    console.error('No GeoPackage file found!');
    process.exit(1);
  }

  console.log(`\nLatest GeoPackage: ${geoPackageFile.name}`);
  console.log(`Size: ${geoPackageFile.size}`);
  console.log(`Date: ${geoPackageFile.dateTime}`);

  // Download the file
  console.log('\nStep 2: Download GeoPackage');
  console.log('-'.repeat(40));

  console.log('Downloading (this may take a moment)...');
  const zipData = await downloadPackageFile(RAILWAY_PACKAGE_IDS.BASIC_PROPERTIES, geoPackageFile.name);
  console.log(`Downloaded ${(zipData.byteLength / 1024 / 1024).toFixed(2)} MB`);

  // Save ZIP for reference
  const zipPath = path.join(TEMP_DIR, geoPackageFile.name);
  await fs.writeFile(zipPath, Buffer.from(zipData));
  console.log(`Saved to: ${zipPath}`);

  // Extract ZIP
  console.log('\nStep 3: Extract ZIP');
  console.log('-'.repeat(40));

  const extractedFiles = await extractZipToDir(zipData, TEMP_DIR);
  console.log(`Extracted ${extractedFiles.length} files`);

  // Find the .gpkg file
  const gpkgFile = extractedFiles.find((f) => f.endsWith('.gpkg'));
  if (!gpkgFile) {
    console.error('No .gpkg file found in ZIP!');
    process.exit(1);
  }

  // Explore the GeoPackage
  console.log('\nStep 4: Explore GeoPackage Structure');
  console.log('-'.repeat(40));

  await exploreGeoPackage(gpkgFile);

  console.log('\n' + '='.repeat(60));
  console.log('Download and exploration complete!');
  console.log('='.repeat(60));
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
