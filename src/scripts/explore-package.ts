#!/usr/bin/env npx tsx
/**
 * Explore a Lastkajen data package
 */

import { downloadPackageFile } from '../lib/lastkajen-api';
import { promises as fs, createWriteStream } from 'fs';
import path from 'path';
import unzipper from 'unzipper';
import { Readable } from 'stream';
import Database from 'better-sqlite3';

async function ensureDir(dir: string) {
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
}

async function main() {
  const packageId = parseInt(process.argv[2] || '10091');
  const fileName = process.argv[3] || 'Trafikplats_järnväg_GeoPackage.zip';

  const TEMP_DIR = './data/temp';
  await ensureDir(TEMP_DIR);

  console.log(`Downloading package ${packageId}: ${fileName}...`);
  const zipData = await downloadPackageFile(packageId, fileName);
  console.log('Downloaded', (zipData.byteLength / 1024).toFixed(2), 'KB');

  // Extract
  const buffer = Buffer.from(zipData);
  const readable = Readable.from(buffer);
  let gpkgPath = '';

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
          if (entry.path.endsWith('.gpkg')) gpkgPath = filePath;
          console.log('Extracted:', entry.path);
        }
      })
      .on('close', resolve)
      .on('error', reject);
  });

  await new Promise((r) => setTimeout(r, 500));

  if (!gpkgPath) {
    console.log('No GeoPackage found in archive');
    return;
  }

  console.log('\nExploring:', gpkgPath);
  const db = new Database(gpkgPath, { readonly: true });

  const contents = db.prepare('SELECT table_name, data_type FROM gpkg_contents').all() as {
    table_name: string;
    data_type: string;
  }[];

  for (const layer of contents) {
    console.log('\n' + '='.repeat(60));
    console.log('Layer:', layer.table_name);
    console.log('='.repeat(60));

    const columns = db.prepare(`PRAGMA table_info("${layer.table_name}")`).all() as { name: string }[];
    console.log('Columns:', columns.map((c) => c.name).join(', '));

    // Check for switch-related columns
    const switchCols = columns.filter((c) =>
      ['växel', 'switch', 'vxl', 'point', 'turnout'].some((kw) => c.name.toLowerCase().includes(kw)),
    );
    if (switchCols.length > 0) {
      console.log('🎯 SWITCH COLUMNS FOUND:', switchCols.map((c) => c.name).join(', '));
    }

    const count = db.prepare(`SELECT COUNT(*) as c FROM "${layer.table_name}"`).get() as { c: number };
    console.log('Rows:', count.c);

    // Sample one row
    const sample = db.prepare(`SELECT * FROM "${layer.table_name}" LIMIT 1`).get() as Record<string, unknown>;
    if (sample) {
      console.log('\nSample row:');
      Object.entries(sample).forEach(([k, v]) => {
        if (k !== 'geom') {
          const str = String(v);
          console.log(`  ${k}: ${str.length > 80 ? str.substring(0, 80) + '...' : str}`);
        }
      });
    }
  }

  db.close();
}

main().catch(console.error);
