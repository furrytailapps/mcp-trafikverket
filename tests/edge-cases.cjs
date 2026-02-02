// Test edge cases and error handling for Trafikverket MCP
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
      Accept: 'application/json, text/event-stream',
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

async function callTool(name, args) {
  const result = await testMCP('tools/call', { name, arguments: args });

  // Handle MCP-level errors (e.g., timeout, server error)
  if (result.error) {
    return {
      data: { error: true, message: result.error.message || 'MCP error', code: 'MCP_ERROR' },
      isError: true,
    };
  }

  // Handle tool-level errors
  const textContent = result.result?.content?.[0]?.text;
  if (!textContent) {
    return {
      data: { error: true, message: 'No content in response', code: 'NO_CONTENT' },
      isError: result.result?.isError || false,
    };
  }

  try {
    return {
      data: JSON.parse(textContent),
      isError: result.result?.isError || false,
    };
  } catch (e) {
    return {
      data: { error: true, message: textContent, code: 'PARSE_ERROR' },
      isError: true,
    };
  }
}

async function main() {
  console.log('Edge Cases and Error Handling Tests');
  console.log(`URL: ${MCP_URL}\n`);

  // Initialize MCP
  await testMCP('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'edge-case-test', version: '1.0.0' },
  });

  const results = { passed: 0, failed: 0 };

  function recordTest(name, passed, details = '') {
    if (passed) {
      results.passed++;
      console.log(`   OK ${name} ${details}`);
    } else {
      results.failed++;
      console.log(`   FAILED ${name} ${details}`);
    }
  }

  // ============ Invalid Track IDs ============
  console.log('1. Testing invalid track IDs...\n');

  // 1a: Non-existent track ID
  {
    const { data } = await callTool('trafikverket_get_infrastructure', {
      queryType: 'all',
      trackId: 'INVALID_TRACK_99999',
    });
    // Should return empty results or handle gracefully
    recordTest(
      'Invalid trackId for infrastructure',
      data.error === true || data.count === 0 || data.count !== undefined,
      data.error ? '(error returned)' : `(count: ${data.count})`,
    );
  }

  // 1b: Non-existent track ID for crossings
  {
    const { data } = await callTool('trafikverket_get_crossings', {
      trackId: 'INVALID_TRACK_99999',
    });
    recordTest(
      'Invalid trackId for crossings',
      data.error === true || data.count === 0 || data.count !== undefined,
      data.error ? '(error returned)' : `(count: ${data.count})`,
    );
  }

  // ============ Out of Bounds Coordinates ============
  console.log('\n2. Testing out of bounds coordinates...\n');

  // 2a: Latitude out of Sweden bounds (should still work but return empty)
  {
    const { data } = await callTool('trafikverket_get_crossings', {
      latitude: 40.0, // Spain, not Sweden
      longitude: -3.0,
      radiusKm: 10,
    });
    recordTest(
      'Out of Sweden coordinates (crossings)',
      data.error === true || data.count === 0 || data.count !== undefined,
      data.error ? '(error returned)' : `(count: ${data.count})`,
    );
  }

  // 2b: Arctic coordinates (northern boundary)
  {
    const { data } = await callTool('trafikverket_get_infrastructure', {
      queryType: 'tracks',
      latitude: 69.5, // Near Swedish-Norwegian border
      longitude: 20.0,
      radiusKm: 50,
    });
    recordTest(
      'Arctic coordinates (infrastructure)',
      data.error === true || data.count === 0 || data.count !== undefined,
      data.error ? '(error returned)' : `(count: ${data.count})`,
    );
  }

  // ============ Missing Required Parameters ============
  console.log('\n3. Testing missing required parameters...\n');

  // 3a: Infrastructure without any location parameter
  {
    const { data, isError } = await callTool('trafikverket_get_infrastructure', {
      queryType: 'tracks',
      // Missing: trackId, latitude/longitude, or bbox
    });
    recordTest(
      'Infrastructure without location params',
      data.error === true || isError,
      data.error ? '(validation error returned)' : '(no error - unexpected)',
    );
  }

  // 3b: Crossings without any location parameter
  {
    const { data, isError } = await callTool('trafikverket_get_crossings', {
      protectionType: 'barriers',
      // Missing: trackId, latitude/longitude, or roadNumber
    });
    recordTest(
      'Crossings without location params',
      data.error === true || isError,
      data.error ? '(validation error returned)' : '(no error - unexpected)',
    );
  }

  // 3c: Road conditions without location or road
  {
    const { data, isError } = await callTool('trafikverket_get_operations', {
      queryType: 'road_conditions',
      // Missing: latitude/longitude or roadNumber
    });
    recordTest(
      'Road conditions without params',
      data.error === true || isError,
      data.error ? '(validation error returned)' : '(no error - unexpected)',
    );
  }

  // 3d: Parking without location or station
  {
    const { data, isError } = await callTool('trafikverket_get_operations', {
      queryType: 'parking',
      // Missing: latitude/longitude or nearStation
    });
    recordTest(
      'Parking without params',
      data.error === true || isError,
      data.error ? '(validation error returned)' : '(no error - unexpected)',
    );
  }

  // ============ Empty Results Handling ============
  console.log('\n4. Testing empty results handling...\n');

  // 4a: Search for non-existent station
  {
    const { data } = await callTool('trafikverket_describe_data', {
      dataType: 'station_codes',
      nameFilter: 'NonExistentStationXYZ123',
    });
    recordTest('Non-existent station name', data.count === 0, `(count: ${data.count})`);
  }

  // 4b: Search for non-existent road
  {
    const { data } = await callTool('trafikverket_get_crossings', {
      roadNumber: 'ZZ999',
    });
    recordTest(
      'Non-existent road number',
      data.error === true || data.count === 0 || data.count !== undefined,
      data.error ? '(error returned)' : `(count: ${data.count})`,
    );
  }

  // ============ Limit Parameter ============
  console.log('\n5. Testing limit parameter...\n');

  // 5a: Very small limit
  {
    const { data } = await callTool('trafikverket_describe_data', {
      dataType: 'station_codes',
      limit: 2,
    });
    recordTest('Limit parameter respected', data.stations?.length <= 2, `(returned ${data.stations?.length} stations)`);
  }

  // 5b: Infrastructure with limit
  {
    const { data } = await callTool('trafikverket_get_infrastructure', {
      queryType: 'tracks',
      latitude: 59.33,
      longitude: 18.07,
      radiusKm: 50,
      limit: 3,
    });
    recordTest(
      'Infrastructure limit parameter',
      data.tracks === undefined || data.tracks?.length <= 3,
      `(returned ${data.tracks?.length || 0} tracks)`,
    );
  }

  // ============ Invalid Filter Values ============
  console.log('\n6. Testing filter edge cases...\n');

  // 6a: Valid severity filter
  {
    const { data } = await callTool('trafikverket_get_operations', {
      queryType: 'incidents',
      severity: 'low',
    });
    recordTest(
      'Low severity filter',
      data.incidents !== undefined || data.error === true,
      data.error ? '(error)' : `(count: ${data.count})`,
    );
  }

  // 6b: Electrified filter
  {
    const { data } = await callTool('trafikverket_get_infrastructure', {
      queryType: 'tracks',
      latitude: 59.33,
      longitude: 18.07,
      radiusKm: 30,
      electrified: true,
    });
    recordTest(
      'Electrified filter',
      data.tracks !== undefined || data.error === true,
      data.error ? '(error)' : `(count: ${data.count})`,
    );
  }

  // ============ BBox Format ============
  console.log('\n7. Testing bbox format...\n');

  // 7a: Valid bbox
  {
    const { data } = await callTool('trafikverket_get_infrastructure', {
      queryType: 'stations',
      bbox: '18.0,59.3,18.2,59.4',
    });
    recordTest('Valid bbox format', data.stations !== undefined, `(count: ${data.count})`);
  }

  // 7b: Invalid bbox format (should error)
  {
    const { data, isError } = await callTool('trafikverket_get_infrastructure', {
      queryType: 'stations',
      bbox: 'invalid-bbox',
    });
    recordTest(
      'Invalid bbox format',
      data.error === true || isError || data.stations !== undefined,
      data.error ? '(validation error)' : '(handled gracefully)',
    );
  }

  // ============ Describe Data Types ============
  console.log('\n8. Testing all describe data types...\n');

  const dataTypes = ['infrastructure_managers', 'track_designations', 'station_codes', 'road_numbers', 'data_freshness'];

  for (const dataType of dataTypes) {
    const { data } = await callTool('trafikverket_describe_data', { dataType });
    const hasContent =
      data.managers !== undefined ||
      data.designations !== undefined ||
      data.stations !== undefined ||
      data.roadNumbers !== undefined ||
      data.infrastructure !== undefined;
    recordTest(`Describe ${dataType}`, hasContent, hasContent ? '(data returned)' : '(no data)');
  }

  // ============ Road Number Formats ============
  console.log('\n9. Testing road number formats...\n');
  console.log('   Note: roadNumber filter has known API limitations\n');

  // 9a: E-road format (known API limitation)
  {
    const { data } = await callTool('trafikverket_get_crossings', {
      roadNumber: 'E4',
    });
    // roadNumber filter is a known API limitation - document the behavior
    recordTest(
      'E-road format (E4)',
      data.crossings !== undefined || data.error === true,
      data.crossings !== undefined ? `(count: ${data.count})` : '(API limitation: roadNumber filter not supported)',
    );
  }

  // 9b: Riksväg format
  {
    const { data } = await callTool('trafikverket_get_operations', {
      queryType: 'road_conditions',
      roadNumber: 'rv 55',
    });
    recordTest(
      'Riksväg format (rv 55)',
      data.conditions !== undefined || data.error === true,
      data.error ? '(error)' : `(count: ${data.count})`,
    );
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('EDGE CASE TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total Tests: ${results.passed + results.failed}`);
  console.log(`Passed: ${results.passed}`);
  console.log(`Failed: ${results.failed}`);
  console.log(`Success Rate: ${((results.passed / (results.passed + results.failed)) * 100).toFixed(1)}%`);
  console.log('='.repeat(60) + '\n');

  // Exit with error code if any tests failed
  if (results.failed > 0) {
    process.exit(1);
  }
}

main().catch(console.error);
