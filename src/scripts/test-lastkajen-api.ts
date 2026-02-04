#!/usr/bin/env npx tsx
/**
 * Test script for Lastkajen API
 *
 * Tests the corrected API endpoints against the live Lastkajen service.
 *
 * Usage:
 *   npx tsx src/scripts/test-lastkajen-api.ts
 *
 * Environment variables:
 *   LASTKAJEN_API_TOKEN - Bearer token for authentication
 */

import { getPublishedDataPackages, getDataPackageFiles, RAILWAY_PACKAGE_IDS } from '../lib/lastkajen-api';

async function main() {
  console.log('='.repeat(60));
  console.log('Lastkajen API Test');
  console.log('='.repeat(60));
  console.log('');

  // Check token
  if (!process.env.LASTKAJEN_API_TOKEN) {
    console.error('ERROR: LASTKAJEN_API_TOKEN not set');
    console.error('Please set the token in .env.local');
    process.exit(1);
  }

  console.log('Token length:', process.env.LASTKAJEN_API_TOKEN.length);
  console.log('');

  // Test 1: List all published data packages
  console.log('Test 1: List published data packages');
  console.log('-'.repeat(40));

  try {
    const packages = await getPublishedDataPackages();
    console.log(`Found ${packages.length} packages`);

    // Show first 10 packages
    packages.slice(0, 10).forEach((pkg, i) => {
      console.log(`  ${i + 1}. ID=${pkg.id} "${pkg.name}"`);
      console.log(`     Path: ${pkg.targetFolder.path}`);
    });

    if (packages.length > 10) {
      console.log(`  ... and ${packages.length - 10} more`);
    }

    // Find railway packages
    const railwayPackages = packages.filter(
      (pkg) => pkg.name.toLowerCase().includes('järnväg') || pkg.targetFolder.path.toLowerCase().includes('järnväg'),
    );

    console.log('');
    console.log(`Railway packages: ${railwayPackages.length}`);
    railwayPackages.forEach((pkg) => {
      console.log(`  - ID=${pkg.id} "${pkg.name}"`);
    });
  } catch (error) {
    console.error('FAILED:', error instanceof Error ? error.message : error);
  }

  console.log('');

  // Test 2: Get files in railway basic properties package
  console.log('Test 2: Get files in railway package');
  console.log('-'.repeat(40));

  try {
    const files = await getDataPackageFiles(RAILWAY_PACKAGE_IDS.BASIC_PROPERTIES);
    console.log(`Package ID ${RAILWAY_PACKAGE_IDS.BASIC_PROPERTIES} has ${files.length} files:`);

    files.forEach((file) => {
      console.log(`  - ${file.name} (${file.size}) [${file.dateTime}]`);
    });
  } catch (error) {
    console.error('FAILED:', error instanceof Error ? error.message : error);
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('Test complete');
  console.log('='.repeat(60));
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
