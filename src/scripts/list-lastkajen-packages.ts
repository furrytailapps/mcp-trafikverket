#!/usr/bin/env npx tsx
/**
 * List all available packages from Lastkajen API
 *
 * Used to discover packages that might contain switches, signals, etc.
 *
 * Usage:
 *   npx tsx src/scripts/list-lastkajen-packages.ts
 */

import { getPublishedDataPackages, getDataPackageFiles } from '../lib/lastkajen-api';

async function main() {
  console.log('='.repeat(70));
  console.log('Lastkajen Data Packages Explorer');
  console.log('='.repeat(70));
  console.log('');

  const packages = await getPublishedDataPackages();

  console.log(`Found ${packages.length} published packages:\n`);

  // Group by folder path
  const byFolder = new Map<string, typeof packages>();
  for (const pkg of packages) {
    const folder = pkg.targetFolder.path || 'Root';
    if (!byFolder.has(folder)) {
      byFolder.set(folder, []);
    }
    byFolder.get(folder)!.push(pkg);
  }

  // Sort folders and print
  const sortedFolders = Array.from(byFolder.keys()).sort();

  for (const folder of sortedFolders) {
    const folderPackages = byFolder.get(folder)!;
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`📁 ${folder}`);
    console.log('─'.repeat(70));

    for (const pkg of folderPackages) {
      console.log(`\n  ID: ${pkg.id}`);
      console.log(`  Name: ${pkg.name}`);
      if (pkg.description) {
        console.log(`  Description: ${pkg.description.substring(0, 200)}${pkg.description.length > 200 ? '...' : ''}`);
      }
    }
  }

  // Search for railway/switch-related packages
  console.log('\n' + '='.repeat(70));
  console.log('🔍 Railway-related packages (searching for järnväg, växel, spår):');
  console.log('='.repeat(70));

  const keywords = ['järnväg', 'växel', 'spår', 'switch', 'signal', 'railway', 'ban'];
  const railwayPackages = packages.filter((pkg) => {
    const searchText = `${pkg.name} ${pkg.description || ''} ${pkg.targetFolder.path}`.toLowerCase();
    return keywords.some((kw) => searchText.includes(kw));
  });

  console.log(`\nFound ${railwayPackages.length} railway-related packages:\n`);

  for (const pkg of railwayPackages) {
    console.log(`\n  ID: ${pkg.id}`);
    console.log(`  Name: ${pkg.name}`);
    console.log(`  Path: ${pkg.targetFolder.path}`);
    if (pkg.description) {
      console.log(`  Description: ${pkg.description}`);
    }

    // Get files in this package
    try {
      const files = await getDataPackageFiles(pkg.id);
      console.log(`  Files (${files.length}):`);
      for (const file of files.slice(0, 5)) {
        console.log(`    - ${file.name} (${file.size})`);
      }
      if (files.length > 5) {
        console.log(`    ... and ${files.length - 5} more`);
      }
    } catch (error) {
      console.log(`  Files: Could not fetch (${error})`);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('Done!');
  console.log('='.repeat(70));
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
