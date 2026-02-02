/**
 * Types for Trafikinfo API responses
 * API Endpoint: https://api.trafikinfo.trafikverket.se/v2/data.json
 * Documentation: https://api.trafikinfo.trafikverket.se/
 */

import type { GeoJsonPoint, GeoJsonLineString, GeoJsonPolygon, GeoJsonGeometry } from './geojson';

// Re-export GeoJSON types for convenience
export type { GeoJsonPoint, GeoJsonLineString, GeoJsonPolygon, GeoJsonGeometry };

// ============================================================================
// BASE TYPES
// ============================================================================

/**
 * Standard Trafikinfo API response wrapper
 */
export interface TrafikinfoResponse<T> {
  RESPONSE: {
    RESULT: {
      [key: string]: T[];
    }[];
  };
}

/**
 * Geometry wrapper used by Trafikinfo
 */
export interface TrafikinfoGeometry {
  WGS84?: string; // GeoJSON as string
  SWEREF99TM?: string;
}

// ============================================================================
// RAIL CROSSING (LEVEL CROSSINGS)
// ============================================================================

export interface RawRailCrossing {
  LevelCrossingId: number;
  Geometry?: TrafikinfoGeometry;
  RoadName?: string;
  RoadNameOfficial?: string;
  NumberOfTracks?: number;
  OperatingMode?: string;
  TrackPortion?: string;
  Kilometer?: number;
  Meter?: number;
  RoadProtectionBase?: { Code: string; Description: string }[];
  RoadProtectionAddition?: { Code: string; Description: string }[];
  PortalHeightLeft?: number;
  PortalHeightRight?: number;
  ModifiedTime?: string;
  Deleted?: boolean;
}

export interface LevelCrossing {
  id: number;
  geometry?: GeoJsonPoint | GeoJsonLineString;
  roadName?: string;
  roadNameOfficial?: string;
  numberOfTracks?: number;
  operatingMode?: string;
  trackPortion?: string;
  kilometer?: number;
  meter?: number;
  protectionBase?: string;
  protectionAddition?: string;
  portalHeightLeft?: number;
  portalHeightRight?: number;
  modifiedTime?: string;
}

// ============================================================================
// SITUATION (TRAFFIC INCIDENTS/DEVIATIONS)
// ============================================================================

export interface RawSituationDeviation {
  Id: string;
  Header?: string;
  MessageType?: string;
  MessageTypeValue?: string;
  MessageCode?: string;
  MessageCodeValue?: string;
  AffectedDirection?: string;
  LocationDescriptor?: string;
  RoadNumber?: string;
  RoadNumberNumeric?: number;
  CountyNo?: number[];
  StartTime?: string;
  EndTime?: string;
  CreationTime?: string;
  VersionTime?: string;
  ValidUntilFurtherNotice?: boolean;
  Geometry?: {
    Point?: TrafikinfoGeometry;
    Line?: TrafikinfoGeometry;
  };
  WebLink?: string;
  TrafficRestrictionType?: string;
}

export interface RawSituation {
  Id: string;
  CountryCode?: string;
  Deviation?: RawSituationDeviation[];
  PublicationTime?: string;
  VersionTime?: string;
  ModifiedTime?: string;
  Deleted?: boolean;
}

export interface TrainIncident {
  id: string;
  header?: string;
  description?: string;
  messageType?: string;
  messageCode?: string;
  roadNumber?: string;
  affectedDirection?: string;
  startTime?: string;
  endTime?: string;
  validUntilFurtherNotice?: boolean;
  counties?: number[];
  geometry?: GeoJsonPoint | GeoJsonLineString;
  webLink?: string;
  trafficRestrictionType?: string;
}

// ============================================================================
// ROAD CONDITION
// ============================================================================

export interface RawRoadCondition {
  Id: string;
  RoadNumber?: string;
  RoadNumberNumeric?: number;
  County?: string;
  CountyNo?: number;
  Geometry?: TrafikinfoGeometry;
  Condition?: string;
  ConditionText?: string;
  RoadTemperature?: number;
  AirTemperature?: number;
  Humidity?: number;
  WindSpeed?: number;
  MeasureTime?: string;
  ModifiedTime?: string;
}

export interface RoadCondition {
  id: string;
  roadNumber?: string;
  county?: string;
  countyNumber?: number;
  geometry?: GeoJsonPoint;
  condition?: string;
  conditionText?: string;
  roadTemperature?: number;
  airTemperature?: number;
  humidity?: number;
  windSpeed?: number;
  measureTime?: string;
}

// ============================================================================
// PARKING
// ============================================================================

export interface RawParking {
  Id: string;
  Name?: string;
  Geometry?: TrafikinfoGeometry;
  OperatorName?: string;
  Usage?: string;
  NumberOfSpaces?: number;
  PhotoUrl?: string;
  ModifiedTime?: string;
}

export interface Parking {
  id: string;
  name?: string;
  geometry?: GeoJsonPoint;
  operator?: string;
  usage?: string;
  numberOfSpaces?: number;
  photoUrl?: string;
}

// ============================================================================
// TRANSFORM FUNCTIONS
// ============================================================================

/**
 * Parse GeoJSON from Trafikinfo geometry string
 */
export function parseGeometry(geo?: TrafikinfoGeometry): GeoJsonGeometry | undefined {
  if (!geo?.WGS84) return undefined;

  try {
    return JSON.parse(geo.WGS84) as GeoJsonGeometry;
  } catch {
    return undefined;
  }
}

/**
 * Transform raw rail crossing to clean format
 */
export function transformRailCrossing(raw: RawRailCrossing): LevelCrossing {
  return {
    id: raw.LevelCrossingId,
    geometry: parseGeometry(raw.Geometry) as GeoJsonPoint | GeoJsonLineString | undefined,
    roadName: raw.RoadName,
    roadNameOfficial: raw.RoadNameOfficial,
    numberOfTracks: raw.NumberOfTracks,
    operatingMode: raw.OperatingMode,
    trackPortion: raw.TrackPortion,
    kilometer: raw.Kilometer,
    meter: raw.Meter,
    protectionBase: raw.RoadProtectionBase?.[0]?.Description,
    protectionAddition: raw.RoadProtectionAddition?.[0]?.Description,
    portalHeightLeft: raw.PortalHeightLeft,
    portalHeightRight: raw.PortalHeightRight,
    modifiedTime: raw.ModifiedTime,
  };
}

/**
 * Parse geometry from Situation deviation (different structure)
 */
function parseDeviationGeometry(geo?: { Point?: TrafikinfoGeometry; Line?: TrafikinfoGeometry }): GeoJsonGeometry | undefined {
  if (!geo) return undefined;
  // Try Point first, then Line
  if (geo.Point?.WGS84) return parseGeometry(geo.Point);
  if (geo.Line?.WGS84) return parseGeometry(geo.Line);
  return undefined;
}

/**
 * Transform raw situation to clean incident format
 * Flattens the Deviation array into individual incidents
 */
export function transformSituation(raw: RawSituation): TrainIncident[] {
  if (!raw.Deviation || raw.Deviation.length === 0) {
    return [];
  }

  return raw.Deviation.map((dev) => ({
    id: dev.Id,
    header: dev.Header,
    description: dev.LocationDescriptor,
    messageType: dev.MessageType,
    messageCode: dev.MessageCode,
    roadNumber: dev.RoadNumber,
    affectedDirection: dev.AffectedDirection,
    startTime: dev.StartTime,
    endTime: dev.EndTime,
    validUntilFurtherNotice: dev.ValidUntilFurtherNotice,
    counties: dev.CountyNo,
    geometry: parseDeviationGeometry(dev.Geometry) as GeoJsonPoint | GeoJsonLineString | undefined,
    webLink: dev.WebLink,
    trafficRestrictionType: dev.TrafficRestrictionType,
  }));
}

/**
 * Transform raw road condition to clean format
 */
export function transformRoadCondition(raw: RawRoadCondition): RoadCondition {
  return {
    id: raw.Id,
    roadNumber: raw.RoadNumber,
    county: raw.County,
    countyNumber: raw.CountyNo,
    geometry: parseGeometry(raw.Geometry) as GeoJsonPoint | undefined,
    condition: raw.Condition,
    conditionText: raw.ConditionText,
    roadTemperature: raw.RoadTemperature,
    airTemperature: raw.AirTemperature,
    humidity: raw.Humidity,
    windSpeed: raw.WindSpeed,
    measureTime: raw.MeasureTime,
  };
}

/**
 * Transform raw parking to clean format
 */
export function transformParking(raw: RawParking): Parking {
  return {
    id: raw.Id,
    name: raw.Name,
    geometry: parseGeometry(raw.Geometry) as GeoJsonPoint | undefined,
    operator: raw.OperatorName,
    usage: raw.Usage,
    numberOfSpaces: raw.NumberOfSpaces,
    photoUrl: raw.PhotoUrl,
  };
}

/**
 * Extract results from Trafikinfo API response
 */
export function extractResults<T>(response: TrafikinfoResponse<T>, objectType: string): T[] {
  const result = response.RESPONSE?.RESULT?.[0];
  if (!result) return [];

  // The key in RESULT matches the objecttype from the query
  return result[objectType] || [];
}
