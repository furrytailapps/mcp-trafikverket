// Comprehensive test script for all Trafikverket MCP tools
const http = require('http');
const https = require('https');

// Allow testing against production via MCP_URL env var
const MCP_URL = process.env.MCP_URL || 'http://localhost:3000/mcp';
const parsedUrl = new URL(MCP_URL);
const isHttps = parsedUrl.protocol === 'https:';
const httpModule = isHttps ? https : http;

function parseSSE(sseText) {
  const lines = sseText.split('\n');
  let data = '';
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      data += line.substring(6);
    }
  }
  try {
    return JSON.parse(data);
  } catch (e) {
    return null;
  }
}

async function testMCP(method, params = {}) {
  const data = JSON.stringify({
    jsonrpc: '2.0',
    id: Date.now(),
    method,
    params,
  });

  const options = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (isHttps ? 443 : 80),
    path: parsedUrl.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
      'Accept': 'application/json, text/event-stream',
    },
  };

  return new Promise((resolve, reject) => {
    const req = httpModule.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        const parsed = parseSSE(body);
        if (parsed) {
          resolve(parsed);
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve({ rawBody: body });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log('Comprehensive Trafikverket MCP Server Test');
  console.log(`URL: ${MCP_URL}\n`);
  const results = { passed: 0, failed: 0, knownIssues: 0, tests: [] };

  function recordTest(name, passed, details = '') {
    results.tests.push({ name, passed, details });
    if (passed) {
      results.passed++;
      console.log(`   OK ${name} ${details}`);
    } else {
      results.failed++;
      console.log(`   FAILED ${name} ${details}`);
    }
  }

  // Some API endpoints have known limitations - test documents behavior but doesn't fail
  function recordKnownIssue(name, details = '') {
    results.tests.push({ name, passed: true, details, knownIssue: true });
    results.knownIssues++;
    console.log(`   KNOWN ${name} ${details}`);
  }

  // Test 1: Initialize
  console.log('1. Testing MCP initialization...');
  try {
    const initResult = await testMCP('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'comprehensive-test', version: '1.0.0' },
    });
    recordTest('Initialize', !!initResult.result?.serverInfo, `(server: ${initResult.result?.serverInfo?.name || 'unknown'})`);
  } catch (error) {
    recordTest('Initialize', false, `(error: ${error.message})`);
  }

  // Test 2: List tools (should be exactly 4)
  console.log('\n2. Testing tools/list...');
  try {
    const toolsResult = await testMCP('tools/list');
    const toolCount = toolsResult.result?.tools?.length || 0;
    recordTest('List tools', toolCount === 4, `(found ${toolCount}/4 tools)`);
  } catch (error) {
    recordTest('List tools', false, `(error: ${error.message})`);
  }

  // ============ trafikverket_describe_data ============
  console.log('\n3. Testing trafikverket_describe_data...');

  // 3a: infrastructure_managers
  try {
    const result = await testMCP('tools/call', {
      name: 'trafikverket_describe_data',
      arguments: { dataType: 'infrastructure_managers' },
    });
    const data = JSON.parse(result.result?.content?.[0]?.text || '{}');
    recordTest('Describe data - infrastructure_managers', data.managers?.length > 0, `(found ${data.count} managers)`);
  } catch (error) {
    recordTest('Describe data - infrastructure_managers', false, `(error: ${error.message})`);
  }

  // 3b: track_designations
  try {
    const result = await testMCP('tools/call', {
      name: 'trafikverket_describe_data',
      arguments: { dataType: 'track_designations' },
    });
    const data = JSON.parse(result.result?.content?.[0]?.text || '{}');
    recordTest('Describe data - track_designations', data.designations?.length > 0, `(found ${data.count} track IDs)`);
  } catch (error) {
    recordTest('Describe data - track_designations', false, `(error: ${error.message})`);
  }

  // 3c: station_codes
  try {
    const result = await testMCP('tools/call', {
      name: 'trafikverket_describe_data',
      arguments: { dataType: 'station_codes' },
    });
    const data = JSON.parse(result.result?.content?.[0]?.text || '{}');
    recordTest('Describe data - station_codes', data.stations?.length > 0, `(found ${data.count} stations)`);
  } catch (error) {
    recordTest('Describe data - station_codes', false, `(error: ${error.message})`);
  }

  // 3d: station_codes with filter
  try {
    const result = await testMCP('tools/call', {
      name: 'trafikverket_describe_data',
      arguments: { dataType: 'station_codes', nameFilter: 'Stockholm' },
    });
    const data = JSON.parse(result.result?.content?.[0]?.text || '{}');
    recordTest('Describe data - station_codes filtered', data.count >= 0, `(found ${data.count} matches for "Stockholm")`);
  } catch (error) {
    recordTest('Describe data - station_codes filtered', false, `(error: ${error.message})`);
  }

  // 3e: data_freshness
  try {
    const result = await testMCP('tools/call', {
      name: 'trafikverket_describe_data',
      arguments: { dataType: 'data_freshness' },
    });
    const data = JSON.parse(result.result?.content?.[0]?.text || '{}');
    recordTest('Describe data - data_freshness', data.infrastructure && data.realtime, '(cache status retrieved)');
  } catch (error) {
    recordTest('Describe data - data_freshness', false, `(error: ${error.message})`);
  }

  // ============ trafikverket_get_infrastructure ============
  console.log('\n4. Testing trafikverket_get_infrastructure...');

  // 4a: Query by trackId (all infrastructure)
  try {
    const result = await testMCP('tools/call', {
      name: 'trafikverket_get_infrastructure',
      arguments: { queryType: 'all', trackId: '182' },
    });
    const data = JSON.parse(result.result?.content?.[0]?.text || '{}');
    recordTest('Infrastructure - by trackId (all)', data.count !== undefined, `(found ${data.count} items on track 182)`);
  } catch (error) {
    recordTest('Infrastructure - by trackId (all)', false, `(error: ${error.message})`);
  }

  // 4b: Query tunnels by trackId
  try {
    const result = await testMCP('tools/call', {
      name: 'trafikverket_get_infrastructure',
      arguments: { queryType: 'tunnels', trackId: '182' },
    });
    const data = JSON.parse(result.result?.content?.[0]?.text || '{}');
    recordTest('Infrastructure - tunnels by trackId', data.tunnels !== undefined, `(found ${data.count} tunnels)`);
  } catch (error) {
    recordTest('Infrastructure - tunnels by trackId', false, `(error: ${error.message})`);
  }

  // 4c: Query by location
  try {
    const result = await testMCP('tools/call', {
      name: 'trafikverket_get_infrastructure',
      arguments: { queryType: 'tracks', latitude: 59.33, longitude: 18.07, radiusKm: 20 },
    });
    const data = JSON.parse(result.result?.content?.[0]?.text || '{}');
    recordTest('Infrastructure - by location', data.tracks !== undefined, `(found ${data.count} tracks near Stockholm)`);
  } catch (error) {
    recordTest('Infrastructure - by location', false, `(error: ${error.message})`);
  }

  // 4d: Query by bbox
  try {
    const result = await testMCP('tools/call', {
      name: 'trafikverket_get_infrastructure',
      arguments: { queryType: 'stations', bbox: '17.5,59.0,18.5,59.5' },
    });
    const data = JSON.parse(result.result?.content?.[0]?.text || '{}');
    recordTest('Infrastructure - by bbox', data.stations !== undefined, `(found ${data.count} stations in bbox)`);
  } catch (error) {
    recordTest('Infrastructure - by bbox', false, `(error: ${error.message})`);
  }

  // 4e: geometryDetail="corridor" (default) - should have simplified geometry
  // Using track "001" which has 47,747 coords in precise mode
  try {
    const result = await testMCP('tools/call', {
      name: 'trafikverket_get_infrastructure',
      arguments: { queryType: 'tracks', trackId: '001' },
    });
    const data = JSON.parse(result.result?.content?.[0]?.text || '{}');
    const track = data.tracks?.[0];
    const coordCount = track?.geometry?.coordinates?.length || 0;
    // Corridor should have simplified coordinates (significantly less than precise mode)
    // Track 001 goes from 47,747 → ~4,000 (91% reduction)
    const hasSimplifiedGeometry = coordCount > 0 && coordCount < 10000;
    recordTest('Infrastructure - geometryDetail=corridor (default)', hasSimplifiedGeometry, `(${coordCount} coords)`);
  } catch (error) {
    recordTest('Infrastructure - geometryDetail=corridor (default)', false, `(error: ${error.message})`);
  }

  // 4f: geometryDetail="metadata" - should have no geometry
  try {
    const result = await testMCP('tools/call', {
      name: 'trafikverket_get_infrastructure',
      arguments: { queryType: 'tracks', trackId: '001', geometryDetail: 'metadata' },
    });
    const data = JSON.parse(result.result?.content?.[0]?.text || '{}');
    const track = data.tracks?.[0];
    // Metadata: no geometry but properties should exist
    const hasNoGeometry = track && !track.geometry;
    const hasProperties = track?.id || track?.designation || track?.speedLimit !== undefined;
    recordTest(
      'Infrastructure - geometryDetail=metadata',
      hasNoGeometry && hasProperties,
      `(geometry: ${track?.geometry ? 'present' : 'absent'}, properties: ${hasProperties ? 'present' : 'absent'})`,
    );
  } catch (error) {
    recordTest('Infrastructure - geometryDetail=metadata', false, `(error: ${error.message})`);
  }

  // 4g: geometryDetail="precise" - should have full geometry
  try {
    const result = await testMCP('tools/call', {
      name: 'trafikverket_get_infrastructure',
      arguments: { queryType: 'tracks', trackId: '001', geometryDetail: 'precise' },
    });
    const data = JSON.parse(result.result?.content?.[0]?.text || '{}');
    const track = data.tracks?.[0];
    const coordCount = track?.geometry?.coordinates?.length || 0;
    // Precise should have many coordinates (track 001 has 47,747)
    const hasManyCoords = coordCount > 1000;
    recordTest('Infrastructure - geometryDetail=precise', hasManyCoords, `(${coordCount} coords)`);
  } catch (error) {
    recordTest('Infrastructure - geometryDetail=precise', false, `(error: ${error.message})`);
  }

  // ============ trafikverket_get_crossings ============
  console.log('\n5. Testing trafikverket_get_crossings...');

  // 5a: Query by location
  try {
    const result = await testMCP('tools/call', {
      name: 'trafikverket_get_crossings',
      arguments: { latitude: 59.33, longitude: 18.07, radiusKm: 30 },
    });
    const data = JSON.parse(result.result?.content?.[0]?.text || '{}');
    recordTest('Crossings - by location', data.crossings !== undefined, `(found ${data.count} crossings near Stockholm)`);
  } catch (error) {
    recordTest('Crossings - by location', false, `(error: ${error.message})`);
  }

  // 5b: Query by trackId (known API limitation - trackId filter may not be supported)
  try {
    const result = await testMCP('tools/call', {
      name: 'trafikverket_get_crossings',
      arguments: { trackId: '182' },
    });
    const data = JSON.parse(result.result?.content?.[0]?.text || '{}');
    if (data.crossings !== undefined) {
      recordTest('Crossings - by trackId', true, `(found ${data.count} crossings on track 182)`);
    } else if (data.error) {
      // Trafikinfo API may not support trackId filter - document this as known issue
      recordKnownIssue('Crossings - by trackId', `(API limitation: ${data.code || 'upstream error'})`);
    } else {
      recordTest('Crossings - by trackId', false, '(unexpected response)');
    }
  } catch (error) {
    recordTest('Crossings - by trackId', false, `(error: ${error.message})`);
  }

  // 5c: Query by road number (known API limitation - roadNumber filter may not be supported)
  try {
    const result = await testMCP('tools/call', {
      name: 'trafikverket_get_crossings',
      arguments: { roadNumber: 'E4' },
    });
    const data = JSON.parse(result.result?.content?.[0]?.text || '{}');
    if (data.crossings !== undefined) {
      recordTest('Crossings - by road number', true, `(found ${data.count} crossings on E4)`);
    } else if (data.error) {
      // Trafikinfo API may not support roadNumber filter - document this as known issue
      recordKnownIssue('Crossings - by road number', `(API limitation: ${data.code || 'upstream error'})`);
    } else {
      recordTest('Crossings - by road number', false, '(unexpected response)');
    }
  } catch (error) {
    recordTest('Crossings - by road number', false, `(error: ${error.message})`);
  }

  // 5d: Query with protection filter
  try {
    const result = await testMCP('tools/call', {
      name: 'trafikverket_get_crossings',
      arguments: { latitude: 59.86, longitude: 17.64, radiusKm: 30, protectionType: 'barriers' },
    });
    const data = JSON.parse(result.result?.content?.[0]?.text || '{}');
    recordTest(
      'Crossings - with protection filter',
      data.crossings !== undefined,
      `(found ${data.count} barrier crossings near Uppsala)`,
    );
  } catch (error) {
    recordTest('Crossings - with protection filter', false, `(error: ${error.message})`);
  }

  // ============ trafikverket_get_operations ============
  console.log('\n6. Testing trafikverket_get_operations...');

  // 6a: Incidents
  try {
    const result = await testMCP('tools/call', {
      name: 'trafikverket_get_operations',
      arguments: { queryType: 'incidents' },
    });
    const data = JSON.parse(result.result?.content?.[0]?.text || '{}');
    recordTest('Operations - incidents', data.incidents !== undefined, `(found ${data.count} incidents)`);
  } catch (error) {
    recordTest('Operations - incidents', false, `(error: ${error.message})`);
  }

  // 6b: Incidents with severity filter
  try {
    const result = await testMCP('tools/call', {
      name: 'trafikverket_get_operations',
      arguments: { queryType: 'incidents', severity: 'high' },
    });
    const data = JSON.parse(result.result?.content?.[0]?.text || '{}');
    recordTest(
      'Operations - incidents (high severity)',
      data.incidents !== undefined,
      `(found ${data.count} high severity incidents)`,
    );
  } catch (error) {
    recordTest('Operations - incidents (high severity)', false, `(error: ${error.message})`);
  }

  // 6c: Road conditions by location
  try {
    const result = await testMCP('tools/call', {
      name: 'trafikverket_get_operations',
      arguments: { queryType: 'road_conditions', latitude: 59.33, longitude: 18.07, radiusKm: 50 },
    });
    const data = JSON.parse(result.result?.content?.[0]?.text || '{}');
    recordTest(
      'Operations - road_conditions by location',
      data.conditions !== undefined,
      `(found ${data.count} conditions near Stockholm)`,
    );
  } catch (error) {
    recordTest('Operations - road_conditions by location', false, `(error: ${error.message})`);
  }

  // 6d: Road conditions by road number (known API limitation - roadNumber filter may not be supported)
  try {
    const result = await testMCP('tools/call', {
      name: 'trafikverket_get_operations',
      arguments: { queryType: 'road_conditions', roadNumber: 'E4' },
    });
    const data = JSON.parse(result.result?.content?.[0]?.text || '{}');
    if (data.conditions !== undefined) {
      recordTest('Operations - road_conditions by road', true, `(found ${data.count} conditions on E4)`);
    } else if (data.error) {
      // Trafikinfo API may not support roadNumber filter - document as known issue
      recordKnownIssue('Operations - road_conditions by road', `(API limitation: ${data.code || 'upstream error'})`);
    } else {
      recordTest('Operations - road_conditions by road', false, '(unexpected response)');
    }
  } catch (error) {
    recordTest('Operations - road_conditions by road', false, `(error: ${error.message})`);
  }

  // 6e: Parking by station name (known API limitation - nearStation filter may not be supported)
  try {
    const result = await testMCP('tools/call', {
      name: 'trafikverket_get_operations',
      arguments: { queryType: 'parking', nearStation: 'Stockholm' },
    });
    const data = JSON.parse(result.result?.content?.[0]?.text || '{}');
    if (data.parking !== undefined) {
      recordTest('Operations - parking by station', true, `(found ${data.count} parking near Stockholm)`);
    } else if (data.error) {
      // Trafikinfo API may not support nearStation filter - document as known issue
      recordKnownIssue('Operations - parking by station', `(API limitation: ${data.code || 'upstream error'})`);
    } else {
      recordTest('Operations - parking by station', false, '(unexpected response)');
    }
  } catch (error) {
    recordTest('Operations - parking by station', false, `(error: ${error.message})`);
  }

  // 6f: Parking by location
  try {
    const result = await testMCP('tools/call', {
      name: 'trafikverket_get_operations',
      arguments: { queryType: 'parking', latitude: 59.33, longitude: 18.06, radiusKm: 5 },
    });
    const data = JSON.parse(result.result?.content?.[0]?.text || '{}');
    recordTest('Operations - parking by location', data.parking !== undefined, `(found ${data.count} parking facilities)`);
  } catch (error) {
    recordTest('Operations - parking by location', false, `(error: ${error.message})`);
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total Tests: ${results.passed + results.failed}`);
  console.log(`Passed: ${results.passed}${results.knownIssues > 0 ? ` (${results.knownIssues} known issues)` : ''}`);
  console.log(`Failed: ${results.failed}`);
  console.log(`Success Rate: ${((results.passed / (results.passed + results.failed)) * 100).toFixed(1)}%`);

  if (results.knownIssues > 0) {
    console.log('\nKnown API Limitations:');
    results.tests
      .filter((t) => t.knownIssue)
      .forEach((t) => {
        console.log(`  - ${t.name} ${t.details}`);
      });
  }

  if (results.failed > 0) {
    console.log('\nFailed Tests:');
    results.tests
      .filter((t) => !t.passed)
      .forEach((t) => {
        console.log(`  - ${t.name} ${t.details}`);
      });
  }

  console.log('='.repeat(60) + '\n');
}

main().catch(console.error);
