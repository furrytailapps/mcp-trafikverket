# mcp-trafikverket - Claude Code Guide

> **Keep this file up to date.** When tools, API endpoints, or project structure change, update this file. For shared patterns and design decisions, see `../CLAUDE.md`.

MCP server wrapping Trafikverket APIs for Swedish railway infrastructure and real-time traffic data.

## Production URL

```
https://mcp-trafikverket.vercel.app/mcp
```

## Target Audience

Construction/infrastructure companies (NRC, COWI) using yesper.ai who need:

- Railway infrastructure data for maintenance planning
- Track segment information (tunnels, bridges, electrification)
- Level crossing locations for road-rail interface work
- Real-time incident data for scheduling around disruptions
- Road conditions for heavy equipment transport

## Two-API Architecture

This MCP uses two different Trafikverket data sources:

| Source         | Endpoint                            | Type            | Data                | Status        |
| -------------- | ----------------------------------- | --------------- | ------------------- | ------------- |
| **Lastkajen**  | `lastkajen.trafikverket.se`         | Download portal | NJDB infrastructure | Sample data\* |
| **Trafikinfo** | `api.trafikinfo.trafikverket.se/v2` | API (XML POST)  | Real-time data      | Live data     |

\* Lastkajen is a bulk download portal for NJDB files, not a queryable API. Infrastructure tool uses sample data.

## Available Tools (4)

| Tool                              | Description                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------ |
| `trafikverket_get_infrastructure` | Railway infrastructure from NJDB (tracks, tunnels, bridges, switches, electrification, stations) |
| `trafikverket_get_crossings`      | Level crossings from Trafikinfo API                                                              |
| `trafikverket_get_operations`     | Real-time data: incidents, road conditions, parking                                              |
| `trafikverket_describe_data`      | Metadata discovery: track IDs, station codes, infrastructure managers                            |

## Project Structure

```
src/
├── app/[transport]/route.ts      # MCP endpoint
├── cache/
│   └── infrastructure-cache.ts   # Cache utilities
├── clients/
│   ├── lastkajen-client.ts       # NJDB infrastructure (REST + Bearer)
│   └── trafikinfo-client.ts      # Real-time data (XML POST)
├── lib/
│   ├── concurrency.ts            # Rate limiting (max 2 concurrent)
│   ├── errors.ts                 # Error classes
│   ├── http-client.ts            # HTTP wrapper with XML support
│   ├── response.ts               # Response formatting
│   └── xml-builder.ts            # Trafikinfo XML query builder
├── tools/
│   ├── index.ts                  # Tool registry (4 tools)
│   ├── get-infrastructure.ts     # NJDB infrastructure queries
│   ├── get-crossings.ts          # Level crossings
│   ├── get-operations.ts         # Incidents, road conditions, parking
│   └── describe-data.ts          # Metadata discovery
└── types/
    ├── common-schemas.ts         # Shared Zod schemas
    ├── njdb-api.ts               # NJDB/Lastkajen types
    └── trafikinfo-api.ts         # Trafikinfo types + transforms
```

## Environment Variables

```bash
# .env.local

# Trafikinfo API (for real-time data: incidents, crossings, road conditions)
TRAFIKVERKET_API_KEY=xxx

# Lastkajen API (for NJDB infrastructure data)
LASTKAJEN_API_TOKEN=xxx
```

**Getting API Keys:**

- Trafikinfo: https://api.trafikinfo.trafikverket.se/Account/Register
- Lastkajen: https://lastkajen.trafikverket.se (create account)

## Coordinate System

All tools use **WGS84 (EPSG:4326)** coordinates:

- Standard GPS/map coordinates (lat/lon)
- Sweden bounds: 55-69°N latitude, 11-24°E longitude
- Stockholm example: `latitude: 59.33, longitude: 18.07`

## Primary Query Pattern: Track Segment ID

The primary use case is querying by track segment ID for maintenance planning:

```json
// "We need to do maintenance on segment 182 this week"
{ "queryType": "all", "trackId": "182" }
// Returns: track geometry, all tunnels, bridges, switches, electrification on segment 182
```

Use `trafikverket_describe_data` with `dataType="track_designations"` to discover valid track IDs.

## Trafikinfo XML Query Format

The Trafikinfo API uses XML POST requests:

```xml
<REQUEST>
  <LOGIN authenticationkey="${API_KEY}" />
  <QUERY objecttype="RailCrossing" schemaversion="1.5" limit="50">
    <FILTER>
      <WITHIN name="Geometry.WGS84" shape="center" value="18.07 59.33" radius="10000m" />
    </FILTER>
    <INCLUDE>LevelCrossingId</INCLUDE>
    <INCLUDE>Geometry</INCLUDE>
  </QUERY>
</REQUEST>
```

The `xml-builder.ts` module handles this construction.

## Caching Strategy

- **Infrastructure data (NJDB):** 24-hour in-memory cache
- **Real-time data (Trafikinfo):** No caching, fetched live

Infrastructure data is appropriate for 24-hour caching because tracks, tunnels, and bridges rarely change.

## Development

```bash
npm run dev          # Start dev server (localhost:3000)
npm run typecheck    # Type check
npm run lint         # Lint
npm run prettier:fix # Format code
```

## Testing

```bash
# Basic connectivity
~/.claude/scripts/test-mcp.sh https://mcp-trafikverket.vercel.app/mcp

# All tools with verbose output
node ~/.claude/scripts/mcp-test-runner.cjs https://mcp-trafikverket.vercel.app/mcp --all -v

# LLM compatibility simulation
node ~/.claude/scripts/mcp-test-runner.cjs https://mcp-trafikverket.vercel.app/mcp --all --llm-sim -v
```

## Sample Tool Inputs

```json
// ========== SEGMENT-BASED QUERIES (Primary Use Case) ==========

// "We need to do maintenance on segment 182 this week"
// Returns ALL infrastructure (track, tunnels, bridges, switches, electrification)
{ "queryType": "all", "trackId": "182" }

// Get only tunnels on segment 182
{ "queryType": "tunnels", "trackId": "182" }

// Get only bridges on segment 421
{ "queryType": "bridges", "trackId": "421" }

// Get all level crossings on segment 182
{ "trackId": "182" }

// ========== GEOGRAPHIC QUERIES (Secondary) ==========

// Tracks near Stockholm (for area planning)
{ "queryType": "tracks", "latitude": 59.33, "longitude": 18.07, "radiusKm": 20 }

// All tunnels in a bounding box
{ "queryType": "tunnels", "bbox": "17.5,59.0,18.5,59.5" }

// Level crossings near Malmö
{ "latitude": 55.6, "longitude": 13.0, "radiusKm": 15 }

// Level crossings on E4 road
{ "roadNumber": "E4", "protectionType": "barriers" }

// ========== OPERATIONAL DATA ==========

// Current train incidents (for work scheduling)
{ "queryType": "incidents", "severity": "high" }

// Road conditions for heavy equipment access
{ "queryType": "road_conditions", "latitude": 59.33, "longitude": 18.07, "radiusKm": 10 }

// Parking near Stockholm Central for staging
{ "queryType": "parking", "nearStation": "Stockholm Central" }

// ========== DISCOVERY ==========

// List all track segment IDs
{ "dataType": "track_designations" }

// List infrastructure managers
{ "dataType": "infrastructure_managers" }

// List station codes
{ "dataType": "station_codes" }

// Check cache status
{ "dataType": "data_freshness" }
```

## Data Value for Infrastructure Companies

| Data                        | Priority | Use Case                                      |
| --------------------------- | -------- | --------------------------------------------- |
| Track geometries/properties | HIGH     | Route planning, work zone identification      |
| Tunnels/bridges             | HIGH     | Clearance verification, structure maintenance |
| Electrification sections    | HIGH     | Safety zones, power outage planning           |
| Level crossings             | HIGH     | Road-rail interface work                      |
| Train incidents             | MEDIUM   | Work scheduling around disruptions            |
| Road conditions             | MEDIUM   | Heavy equipment transport                     |
| Parking                     | LOW      | Staging areas near stations                   |

## Notes

- **Infrastructure tool uses sample data**: Lastkajen is a bulk download portal, not a queryable REST API. The NJDB infrastructure data (tracks, tunnels, bridges, etc.) is only available via file downloads from https://lastkajen.trafikverket.se. The `trafikverket_get_infrastructure` and `trafikverket_describe_data` tools return representative sample data to demonstrate the expected structure.
- **Trafikinfo tools use real data**: The `trafikverket_get_crossings` and `trafikverket_get_operations` tools query the live Trafikinfo API and return real data for level crossings, traffic incidents, road conditions, and parking.
- All tools follow the flat schema pattern (no nested objects)
- Trafikinfo API uses XML POST requests, handled by `xml-builder.ts`
