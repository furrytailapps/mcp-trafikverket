import { z } from 'zod';

/**
 * Common Zod schemas for Trafikverket MCP tools
 * These are raw shapes (not wrapped in z.object()) for use with mcp-handler
 */

/**
 * WGS84 coordinate validation
 * Sweden bounds: roughly 55-69°N latitude, 11-24°E longitude
 */
export const latitudeSchema = z
  .number()
  .min(55)
  .max(69)
  .describe('Latitude in WGS84 (decimal degrees). Sweden range: 55-69. Example: 59.33 for Stockholm.');

export const longitudeSchema = z
  .number()
  .min(11)
  .max(24)
  .describe('Longitude in WGS84 (decimal degrees). Sweden range: 11-24. Example: 18.07 for Stockholm.');

/**
 * Search radius for geographic queries
 */
export const radiusKmSchema = z.number().min(1).max(50).describe('Search radius in kilometers. Default: 10, max: 50.');

/**
 * Larger search radius for road conditions
 */
export const largeRadiusKmSchema = z
  .number()
  .min(1)
  .max(100)
  .describe('Search radius in kilometers. Default: 25 for roads, 10 for parking.');

/**
 * Bounding box as comma-separated string
 */
export const bboxSchema = z
  .string()
  .regex(/^[\d.-]+,[\d.-]+,[\d.-]+,[\d.-]+$/)
  .describe('Bounding box as "minLon,minLat,maxLon,maxLat". Alternative to center point query.');

/**
 * Infrastructure query types
 */
export const infrastructureQueryTypeSchema = z
  .enum(['tracks', 'tunnels', 'bridges', 'switches', 'electrification', 'stations', 'yards', 'access_restrictions', 'all'])
  .describe('Type of infrastructure to query');

/**
 * Level crossing protection types
 */
export const crossingProtectionSchema = z
  .enum(['barriers', 'lights', 'signs', 'all'])
  .describe('Type of level crossing protection');

/**
 * Operations query types
 */
export const operationsQueryTypeSchema = z
  .enum(['incidents', 'road_conditions', 'parking'])
  .describe('Type of operational data to query');

/**
 * Incident severity levels
 */
export const severitySchema = z.enum(['low', 'medium', 'high']).describe('Incident severity level');

/**
 * Describe data types for metadata discovery
 */
export const describeDataTypeSchema = z
  .enum(['infrastructure_managers', 'track_designations', 'station_codes', 'road_numbers', 'data_freshness'])
  .describe('Type of metadata to retrieve');

/**
 * Common limit schemas for result pagination
 */
export const limitSchema = z.number().min(1).max(100).describe('Maximum number of results. Default: 20.');

export const largeLimitSchema = z.number().min(1).max(500).describe('Maximum number of results. Default: 100, max: 500.');

export const crossingsLimitSchema = z.number().min(1).max(200).describe('Maximum number of results. Default: 50, max: 200.');

/**
 * Geometry detail levels for controlling response size
 * Reduces response tokens by 95-99% with 'corridor' (default) vs 'precise'
 */
export const geometryDetailSchema = z.enum(['metadata', 'corridor', 'precise']).describe(
  `Level of coordinate detail in response:
- "metadata": Properties only, no coordinates. Use when you only need track info (speed, electrification, length).
- "corridor": Simplified path (~50-100 points). Use for querying weather/geology along the track. (Default)
- "precise": All coordinates. Use only when you need to draw the track accurately on a map.`,
);
