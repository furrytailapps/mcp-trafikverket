# Trafikverket MCP Test Suite

Comprehensive test suite for the Trafikverket MCP server. These tests verify all 4 tools work correctly with the Trafikverket APIs (Trafikinfo for real-time data, NJDB sample data for infrastructure).

## Prerequisites

The MCP development server must be running:

```bash
npm run dev
```

The server will start at `http://localhost:3000`

## Running Tests

All test files are CommonJS scripts that can be run directly with Node.js:

```bash
# Run individual test files
node tests/basic.cjs
node tests/comprehensive.cjs
node tests/use-cases.cjs
node tests/edge-cases.cjs

# Test against production
MCP_URL=https://mcp-trafikverket.vercel.app/mcp node tests/basic.cjs
```

## Test Files

### basic.cjs

Basic connectivity and tool availability test.

**Tests:**

- MCP server connectivity
- Tools list endpoint (verify 4 tools)
- Basic tool invocation
- Response format validation

**Usage:**

```bash
node tests/basic.cjs
```

### comprehensive.cjs

Comprehensive test of all 4 tools with various scenarios.

**Tests:**

- `trafikverket_get_infrastructure` - by trackId, by location, by bbox
- `trafikverket_get_crossings` - by location, by trackId, by road number, with filters
- `trafikverket_get_operations` - incidents, road_conditions, parking
- `trafikverket_describe_data` - all dataTypes

**Usage:**

```bash
node tests/comprehensive.cjs
```

**Expected Output:**

```
✅ Get Infrastructure (by trackId): Found infrastructure
✅ Get Crossings (by location): Found crossings
✅ Get Operations (incidents): Found incidents
...
All comprehensive tests passed!
```

### use-cases.cjs

Real-world user scenarios simulating how an AI agent (yesper.ai) would use the MCP.

**Scenarios:**

1. **Track Maintenance Planning** - Query infrastructure for a track segment
2. **Level Crossing Safety Inspection** - Find barrier-protected crossings on E4
3. **Emergency Response Coordination** - Find affected infrastructure near incident
4. **Heavy Equipment Transport Planning** - Check crossings and road conditions
5. **Station Area Work Planning** - Plan maintenance near Stockholm Central

**Usage:**

```bash
node tests/use-cases.cjs
```

### edge-cases.cjs

Error handling and edge case validation.

**Tests:**

- Invalid trackId
- Out of bounds coordinates
- Missing required parameters
- Empty results handling

**Usage:**

```bash
node tests/edge-cases.cjs
```

## Test Data

The tests use real data from the Trafikverket APIs:

**Coordinates (WGS84):**

- Stockholm: lat `59.33`, lon `18.07`
- Uppsala: lat `59.86`, lon `17.64`
- Sodertälje: lat `59.20`, lon `17.63`

**Sample Data:**

- Track segment: `"182"` (Västra Stambanan)
- Road: `"E4"`
- Station: Stockholm Central (code: `Cst`)

## Environment Variable

```bash
# Default (localhost)
node tests/basic.cjs

# Production
MCP_URL=https://mcp-trafikverket.vercel.app/mcp node tests/basic.cjs
```

## Common Issues

### Server Not Running

**Error:**

```
Error: connect ECONNREFUSED 127.0.0.1:3000
```

**Solution:**

```bash
# Start the dev server in a separate terminal
npm run dev
```

### API Rate Limiting

**Error:**

```
Error: API request failed: 429 Too Many Requests
```

**Solution:**

- Wait a few seconds between test runs
- The Trafikinfo API has rate limits

### Missing API Key

**Error:**

```
Error: TRAFIKVERKET_API_KEY is not set
```

**Solution:**

- Ensure `.env.local` has valid API keys
- See CLAUDE.md for API key registration links

## Writing New Tests

Example test structure:

```javascript
async function testMyFeature() {
  const response = await testMCP('tools/call', {
    name: 'trafikverket_get_infrastructure',
    arguments: { queryType: 'all', trackId: '182' },
  });

  const data = JSON.parse(response.result?.content?.[0]?.text || '{}');

  if (data.error) {
    console.error('Test failed:', data.message);
    return false;
  }

  console.log('Test passed:', data.count);
  return true;
}
```

## Test Coverage

Current test coverage includes:

- All 4 MCP tools
- Happy path scenarios
- Error handling
- Edge cases
- Parameter validation
- Response format validation
- Real-world user workflows

## Contributing

When adding new tools or features:

1. Add test cases to `comprehensive.cjs`
2. Add error scenarios to `edge-cases.cjs`
3. Add user workflow tests to `use-cases.cjs`
4. Update this README with new test descriptions
5. Verify all existing tests still pass
