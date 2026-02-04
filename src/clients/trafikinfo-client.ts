import { createHttpClient } from '@/lib/http-client';
import { buildTrafikinfoRequest, withinFilter, likeFilter, type XmlFilter, type XmlQuery } from '@/lib/xml-builder';
import { ValidationError } from '@/lib/errors';
import {
  type TrafikinfoResponse,
  type RawRailCrossing,
  type RawSituation,
  type RawRoadCondition,
  type RawParking,
  type LevelCrossing,
  type TrainIncident,
  type RoadCondition,
  type Parking,
  transformRailCrossing,
  transformSituation,
  transformRoadCondition,
  transformParking,
  extractResults,
} from '@/types/trafikinfo-api';

const TRAFIKINFO_API_BASE = 'https://api.trafikinfo.trafikverket.se/v2';

const client = createHttpClient({
  baseUrl: TRAFIKINFO_API_BASE,
  timeout: 30000,
});

function getApiKey(): string {
  const key = process.env.TRAFIKVERKET_API_KEY;
  if (!key) {
    throw new ValidationError('TRAFIKVERKET_API_KEY environment variable is not set');
  }
  return key;
}

/**
 * Execute a Trafikinfo API query
 */
async function query<T>(queries: XmlQuery[]): Promise<TrafikinfoResponse<T>> {
  const apiKey = getApiKey();
  const xml = buildTrafikinfoRequest(apiKey, queries);

  return client.request<TrafikinfoResponse<T>>('/data.json', {
    method: 'POST',
    body: xml,
    bodyType: 'xml',
  });
}

// ============================================================================
// LEVEL CROSSINGS
// ============================================================================

/**
 * Get level crossings by track segment ID
 */
export async function getLevelCrossingsByTrack(trackId: string, limit?: number): Promise<LevelCrossing[]> {
  const filters: XmlFilter[] = [likeFilter('TrackPortion', `*${trackId}*`)];

  const response = await query<RawRailCrossing>([
    {
      objectType: 'RailCrossing',
      schemaVersion: '1.5',
      limit: limit || 50,
      filters,
    },
  ]);

  const results = extractResults(response, 'RailCrossing');
  return results.filter((r) => !r.Deleted).map(transformRailCrossing);
}

/**
 * Get level crossings by geographic location
 */
export async function getLevelCrossingsByLocation(
  latitude: number,
  longitude: number,
  radiusKm: number,
  limit?: number,
): Promise<LevelCrossing[]> {
  const filters: XmlFilter[] = [withinFilter(longitude, latitude, radiusKm)];

  const response = await query<RawRailCrossing>([
    {
      objectType: 'RailCrossing',
      schemaVersion: '1.5',
      limit: limit || 50,
      filters,
    },
  ]);

  const results = extractResults(response, 'RailCrossing');
  return results.filter((r) => !r.Deleted).map(transformRailCrossing);
}

/**
 * Get level crossings by road number
 */
export async function getLevelCrossingsByRoad(roadNumber: string, limit?: number): Promise<LevelCrossing[]> {
  const filters: XmlFilter[] = [likeFilter('RoadName', `*${roadNumber}*`)];

  const response = await query<RawRailCrossing>([
    {
      objectType: 'RailCrossing',
      schemaVersion: '1.5',
      limit: limit || 50,
      filters,
    },
  ]);

  const results = extractResults(response, 'RailCrossing');
  return results.filter((r) => !r.Deleted).map(transformRailCrossing);
}

/**
 * Filter crossings by protection type
 */
export function filterCrossingsByProtection(
  crossings: LevelCrossing[],
  protectionType: 'barriers' | 'lights' | 'signs' | 'all',
): LevelCrossing[] {
  if (protectionType === 'all') return crossings;

  return crossings.filter((c) => {
    const prot = ((c.protectionBase || '') + ' ' + (c.protectionAddition || '')).toLowerCase();
    switch (protectionType) {
      case 'barriers':
        return prot.includes('bom') || prot.includes('helbom') || prot.includes('halvbom');
      case 'lights':
        return prot.includes('ljus') || prot.includes('signal');
      case 'signs':
        return prot.includes('skylt') || prot.includes('märk') || prot.includes('oskyddad');
      default:
        return true;
    }
  });
}

// ============================================================================
// SITUATIONS (TRAFFIC INCIDENTS/DEVIATIONS)
// ============================================================================

/**
 * Get active traffic situations (incidents/deviations)
 * Uses the Situation object type which contains Deviation array
 */
export async function getTrainMessages(limit?: number): Promise<TrainIncident[]> {
  const response = await query<RawSituation>([
    {
      objectType: 'Situation',
      schemaVersion: '1.5',
      limit: limit || 50,
    },
  ]);

  const situations = extractResults(response, 'Situation');
  // Flatten all deviations from all situations into a single array
  const incidents = situations.filter((s) => !s.Deleted).flatMap(transformSituation);

  return incidents;
}

/**
 * Filter incidents by severity based on message type
 */
export function filterIncidentsBySeverity(incidents: TrainIncident[], severity: 'low' | 'medium' | 'high'): TrainIncident[] {
  // Severity classification based on message types
  // High: Major disruptions, closures, accidents
  // Medium: Restrictions, roadwork, delays
  // Low: Informational messages, ferries, etc.
  const highSeverityTypes = ['Olycka', 'Vägarbete', 'Hinder', 'Avstängd'];
  const mediumSeverityTypes = ['Begränsad', 'Körfält', 'Varning'];

  return incidents.filter((i) => {
    const msgType = (i.messageType || '').toLowerCase();
    const restriction = (i.trafficRestrictionType || '').toLowerCase();

    switch (severity) {
      case 'high':
        return highSeverityTypes.some((t) => msgType.includes(t.toLowerCase()) || restriction.includes(t.toLowerCase()));
      case 'medium':
        // Return medium severity items only (exclude high severity)
        return (
          mediumSeverityTypes.some((t) => msgType.includes(t.toLowerCase()) || restriction.includes(t.toLowerCase())) &&
          !highSeverityTypes.some((t) => msgType.includes(t.toLowerCase()) || restriction.includes(t.toLowerCase()))
        );
      case 'low':
      default:
        return true;
    }
  });
}

// ============================================================================
// ROAD CONDITIONS
// ============================================================================

/**
 * Get road conditions by geographic location
 */
export async function getRoadConditionsByLocation(
  latitude: number,
  longitude: number,
  radiusKm: number,
  limit?: number,
): Promise<RoadCondition[]> {
  const filters: XmlFilter[] = [withinFilter(longitude, latitude, radiusKm)];

  const response = await query<RawRoadCondition>([
    {
      objectType: 'RoadCondition',
      schemaVersion: '1.2',
      limit: limit || 20,
      filters,
    },
  ]);

  const results = extractResults(response, 'RoadCondition');
  return results.map(transformRoadCondition);
}

/**
 * Get road conditions by road number
 */
export async function getRoadConditionsByRoad(roadNumber: string, limit?: number): Promise<RoadCondition[]> {
  const filters: XmlFilter[] = [likeFilter('RoadNumber', `*${roadNumber}*`)];

  const response = await query<RawRoadCondition>([
    {
      objectType: 'RoadCondition',
      schemaVersion: '1.2',
      limit: limit || 20,
      filters,
    },
  ]);

  const results = extractResults(response, 'RoadCondition');
  return results.map(transformRoadCondition);
}

// ============================================================================
// PARKING
// ============================================================================

/**
 * Get parking facilities by location
 */
export async function getParkingByLocation(
  latitude: number,
  longitude: number,
  radiusKm: number,
  limit?: number,
): Promise<Parking[]> {
  const filters: XmlFilter[] = [withinFilter(longitude, latitude, radiusKm)];

  const response = await query<RawParking>([
    {
      objectType: 'Parking',
      schemaVersion: '1.0',
      limit: limit || 20,
      filters,
    },
  ]);

  const results = extractResults(response, 'Parking');
  return results.map(transformParking);
}

/**
 * Get parking facilities by name (for finding near stations)
 */
export async function getParkingByName(name: string, limit?: number): Promise<Parking[]> {
  const filters: XmlFilter[] = [likeFilter('Name', `*${name}*`)];

  const response = await query<RawParking>([
    {
      objectType: 'Parking',
      schemaVersion: '1.0',
      limit: limit || 20,
      filters,
    },
  ]);

  const results = extractResults(response, 'Parking');
  return results.map(transformParking);
}

// ============================================================================
// METADATA
// ============================================================================

/**
 * Get list of available road numbers from Trafikinfo
 */
export async function getRoadNumbers(): Promise<string[]> {
  const response = await query<RawRoadCondition>([
    {
      objectType: 'RoadCondition',
      schemaVersion: '1.2',
      limit: 1000,
    },
  ]);

  const results = extractResults(response, 'RoadCondition');
  const roadNumberSet = new Set(results.map((r) => r.RoadNumber).filter(Boolean) as string[]);
  const roadNumbers = Array.from(roadNumberSet);
  return roadNumbers.sort();
}

// ============================================================================
// EXPORTED CLIENT
// ============================================================================

export const trafikinfoClient = {
  // Level crossings
  getLevelCrossingsByTrack,
  getLevelCrossingsByLocation,
  getLevelCrossingsByRoad,
  filterCrossingsByProtection,

  // Train messages
  getTrainMessages,
  filterIncidentsBySeverity,

  // Road conditions
  getRoadConditionsByLocation,
  getRoadConditionsByRoad,

  // Parking
  getParkingByLocation,
  getParkingByName,

  // Metadata
  getRoadNumbers,
};
