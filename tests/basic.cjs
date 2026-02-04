// Basic test script for the Trafikverket MCP server
const http = require('http');
const https = require('https');

// Allow testing against production via MCP_URL env var
const MCP_URL = process.env.MCP_URL || 'http://localhost:3000/mcp';
const parsedUrl = new URL(MCP_URL);
const isHttps = parsedUrl.protocol === 'https:';
const httpModule = isHttps ? https : http;

function parseSSE(sseText) {
  // Parse Server-Sent Events format
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
        // Try to parse as SSE first
        const parsed = parseSSE(body);
        if (parsed) {
          resolve(parsed);
          return;
        }

        // Try as plain JSON
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
  console.log('Testing Trafikverket MCP Server');
  console.log(`URL: ${MCP_URL}\n`);

  // Test 1: Initialize
  console.log('1. Testing initialization...');
  const initResult = await testMCP('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' },
  });
  console.log('   ' + (initResult.result ? 'OK' : 'FAILED') + ' Initialize');
  if (initResult.result?.serverInfo) {
    console.log(`   Server: ${initResult.result.serverInfo.name}`);
  }

  // Test 2: List tools
  console.log('\n2. Listing available tools...');
  const toolsResult = await testMCP('tools/list');
  if (toolsResult.result?.tools) {
    const toolCount = toolsResult.result.tools.length;
    console.log(`   ${toolCount === 4 ? 'OK' : 'FAILED'} Found ${toolCount}/4 tools:`);
    toolsResult.result.tools.forEach((t) => console.log(`      - ${t.name}`));
  } else {
    console.log('   FAILED to list tools');
  }

  // Test 3: Call describe_data tool (simplest tool to test)
  console.log('\n3. Testing trafikverket_describe_data with "infrastructure_managers"...');
  const describeResult = await testMCP('tools/call', {
    name: 'trafikverket_describe_data',
    arguments: { dataType: 'infrastructure_managers' },
  });

  if (describeResult.result?.content?.[0]?.text) {
    const data = JSON.parse(describeResult.result.content[0].text);
    if (data.managers) {
      console.log(`   OK Found ${data.count} infrastructure managers`);
      if (data.managers.length > 0) {
        console.log(`   Example: ${data.managers[0].name}`);
      }
    } else if (data.error) {
      console.log('   FAILED:', data.message);
    }
  } else {
    console.log('   FAILED:', describeResult.error?.message || 'Unknown error');
  }

  // Test 4: Call get_infrastructure (uses NJDB data from Lastkajen)
  console.log('\n4. Testing trafikverket_get_infrastructure with trackId="182"...');
  const infraResult = await testMCP('tools/call', {
    name: 'trafikverket_get_infrastructure',
    arguments: { queryType: 'all', trackId: '182' },
  });

  if (infraResult.result?.content?.[0]?.text) {
    const data = JSON.parse(infraResult.result.content[0].text);
    if (data.count !== undefined) {
      console.log(`   OK Found ${data.count} infrastructure items on track 182`);
    } else if (data.error) {
      console.log('   FAILED:', data.message);
    }
  } else {
    console.log('   FAILED:', infraResult.error?.message || 'Unknown error');
  }

  console.log('\nTests complete!\n');
}

main().catch(console.error);
