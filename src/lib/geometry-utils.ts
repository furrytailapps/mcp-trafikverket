/**
 * Geometry utilities for reducing MCP response size
 *
 * These utilities reduce coordinate data by 95-99% while preserving
 * the path shape that agents need for cross-MCP queries.
 */

import type { GeoJsonLineString, GeoJsonPoint } from '@/types/geojson';

/**
 * Douglas-Peucker line simplification algorithm
 *
 * Reduces points while preserving shape - keeps points that define curves,
 * removes points on straight sections.
 *
 * @param coords - Array of [lon, lat] coordinates
 * @param tolerance - Distance tolerance in degrees (~0.005 = ~500m at Swedish latitudes)
 * @returns Simplified coordinate array (typically 50-100 points for tracks)
 */
export function simplifyPath(coords: [number, number][], tolerance: number): [number, number][] {
  if (coords.length <= 2) return coords;

  // Find the point with maximum distance from the line between first and last
  let maxDist = 0;
  let maxIndex = 0;
  const first = coords[0];
  const last = coords[coords.length - 1];

  for (let i = 1; i < coords.length - 1; i++) {
    const dist = perpendicularDistance(coords[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }

  // If max distance is greater than tolerance, recursively simplify
  if (maxDist > tolerance) {
    const left = simplifyPath(coords.slice(0, maxIndex + 1), tolerance);
    const right = simplifyPath(coords.slice(maxIndex), tolerance);

    // Combine results (remove duplicate point at junction)
    return [...left.slice(0, -1), ...right];
  }

  // Otherwise, return just the endpoints
  return [first, last];
}

/**
 * Calculate perpendicular distance from point to line
 */
function perpendicularDistance(point: [number, number], lineStart: [number, number], lineEnd: [number, number]): number {
  const [x, y] = point;
  const [x1, y1] = lineStart;
  const [x2, y2] = lineEnd;

  // Line length squared
  const lineLengthSq = (x2 - x1) ** 2 + (y2 - y1) ** 2;

  // If line is actually a point
  if (lineLengthSq === 0) {
    return Math.sqrt((x - x1) ** 2 + (y - y1) ** 2);
  }

  // Calculate perpendicular distance using cross product
  const numerator = Math.abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1);
  const denominator = Math.sqrt(lineLengthSq);

  return numerator / denominator;
}

/**
 * Truncate coordinate precision to 6 decimals (~0.1m accuracy)
 * Reduces JSON size by removing unnecessary precision
 *
 * @param coords - Array of [lon, lat] coordinates
 * @returns Coordinates with truncated precision
 */
export function truncatePrecision(coords: [number, number][]): [number, number][] {
  return coords.map(([lon, lat]) => [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6]);
}

/**
 * Geometry detail levels for MCP responses
 */
export type GeometryDetail = 'metadata' | 'corridor' | 'precise';

/**
 * Default tolerance for Douglas-Peucker simplification
 * ~0.005 degrees = ~500m at Swedish latitudes
 * This produces ~50-100 points for typical track segments
 */
const DEFAULT_TOLERANCE = 0.005;

/**
 * Format a LineString geometry based on detail level
 *
 * @param geometry - Original geometry with full coordinates
 * @param detail - Level of detail: metadata, corridor, or precise
 * @returns Transformed geometry or undefined for metadata level
 */
export function formatLineGeometry(geometry: GeoJsonLineString, detail: GeometryDetail): GeoJsonLineString | undefined {
  switch (detail) {
    case 'metadata':
      return undefined;
    case 'corridor':
      return {
        type: 'LineString',
        coordinates: truncatePrecision(simplifyPath(geometry.coordinates, DEFAULT_TOLERANCE)),
      };
    case 'precise':
      return geometry;
  }
}

/**
 * Format a LineString structure (tunnel) geometry based on detail level
 * For structures, we simplify to just start and end points since they're short
 *
 * @param geometry - Original LineString geometry
 * @param detail - Level of detail
 * @returns Transformed geometry or undefined for metadata level
 */
export function formatLineStructureGeometry(
  geometry: GeoJsonLineString,
  detail: GeometryDetail,
): GeoJsonLineString | undefined {
  if (detail === 'metadata') return undefined;

  // For short LineStrings, return as-is
  const coords = geometry.coordinates;
  if (coords.length <= 2) {
    return geometry;
  }

  // Return just start and end points
  return {
    type: 'LineString',
    coordinates: [coords[0], coords[coords.length - 1]],
  };
}

/**
 * Format a structure (bridge) geometry based on detail level
 * Bridges can be either Point or LineString
 * For structures, we simplify to just start and end points since they're short
 *
 * @param geometry - Original geometry (Point or LineString)
 * @param detail - Level of detail
 * @returns Transformed geometry or undefined for metadata level
 */
export function formatStructureGeometry(
  geometry: GeoJsonLineString | GeoJsonPoint,
  detail: GeometryDetail,
): GeoJsonLineString | GeoJsonPoint | undefined {
  if (detail === 'metadata') return undefined;

  // For Point geometries, return as-is
  if (geometry.type === 'Point') {
    return geometry;
  }

  // For LineString, simplify to start/end
  const coords = geometry.coordinates;
  if (coords.length <= 2) {
    return geometry;
  }

  // Return just start and end points
  return {
    type: 'LineString',
    coordinates: [coords[0], coords[coords.length - 1]],
  };
}

/**
 * Format a Point geometry based on detail level
 *
 * @param geometry - Original point geometry
 * @param detail - Level of detail
 * @returns Geometry or undefined for metadata level
 */
export function formatPointGeometry(geometry: GeoJsonPoint, detail: GeometryDetail): GeoJsonPoint | undefined {
  if (detail === 'metadata') return undefined;
  return geometry;
}

// ============================================================================
// DISTANCE CALCULATIONS (for station filtering)
// ============================================================================

/**
 * Calculate distance from a point to a line segment using projection
 *
 * @param point - Point to measure from [lon, lat]
 * @param segStart - Start of line segment [lon, lat]
 * @param segEnd - End of line segment [lon, lat]
 * @returns Distance in degrees
 */
function pointToSegmentDistance(
  point: [number, number],
  segStart: [number, number],
  segEnd: [number, number],
): number {
  const [px, py] = point;
  const [x1, y1] = segStart;
  const [x2, y2] = segEnd;

  // Vector from segment start to end
  const dx = x2 - x1;
  const dy = y2 - y1;

  // Length squared of segment
  const lenSq = dx * dx + dy * dy;

  // If segment is a point, return distance to that point
  if (lenSq === 0) {
    return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
  }

  // Project point onto line, clamped to segment
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));

  // Closest point on segment
  const closestX = x1 + t * dx;
  const closestY = y1 + t * dy;

  // Distance to closest point
  return Math.sqrt((px - closestX) ** 2 + (py - closestY) ** 2);
}

/**
 * Calculate minimum distance from point to any segment of a LineString
 *
 * @param point - Point to measure from [lon, lat]
 * @param lineCoords - Array of [lon, lat] coordinates forming the line
 * @returns Minimum distance in degrees
 */
export function pointToLineStringDistance(point: [number, number], lineCoords: [number, number][]): number {
  if (lineCoords.length === 0) return Infinity;
  if (lineCoords.length === 1) {
    return Math.sqrt((point[0] - lineCoords[0][0]) ** 2 + (point[1] - lineCoords[0][1]) ** 2);
  }

  let minDist = Infinity;
  for (let i = 0; i < lineCoords.length - 1; i++) {
    const dist = pointToSegmentDistance(point, lineCoords[i], lineCoords[i + 1]);
    if (dist < minDist) {
      minDist = dist;
    }
  }
  return minDist;
}

/**
 * Default threshold for station proximity to track
 * ~0.005 degrees = ~500m at Swedish latitudes
 */
const DEFAULT_STATION_THRESHOLD = 0.005;

/**
 * Simplification tolerance for station filtering
 * 0.01 degrees = ~1km, produces ~50-100 points for typical tracks
 */
const STATION_FILTER_SIMPLIFICATION_TOLERANCE = 0.01;

/**
 * Check if a station is within threshold distance of a track
 *
 * Uses simplified track geometry for performance (Douglas-Peucker with 0.01 tolerance)
 * to reduce segment checks from ~50,000 to ~50-100.
 *
 * @param stationGeometry - Station point geometry
 * @param trackGeometry - Track LineString geometry
 * @param thresholdDegrees - Distance threshold in degrees (default ~500m)
 * @returns true if station is within threshold of track
 */
export function isStationNearTrack(
  stationGeometry: GeoJsonPoint,
  trackGeometry: GeoJsonLineString,
  thresholdDegrees: number = DEFAULT_STATION_THRESHOLD,
): boolean {
  // Simplify track for performance (0.01 tolerance → ~50-100 points)
  const simplifiedCoords = simplifyPath(trackGeometry.coordinates, STATION_FILTER_SIMPLIFICATION_TOLERANCE);

  const stationPoint: [number, number] = [stationGeometry.coordinates[0], stationGeometry.coordinates[1]];

  const distance = pointToLineStringDistance(stationPoint, simplifiedCoords);

  return distance <= thresholdDegrees;
}

/**
 * Simplify a track's coordinates for station filtering
 * Call once per track, then use with isPointNearSimplifiedTrack for each station
 *
 * @param trackGeometry - Track LineString geometry
 * @returns Simplified coordinate array
 */
export function simplifyTrackForStationFilter(trackGeometry: GeoJsonLineString): [number, number][] {
  return simplifyPath(trackGeometry.coordinates, STATION_FILTER_SIMPLIFICATION_TOLERANCE);
}

/**
 * Check if a station is within threshold distance of a pre-simplified track
 * More efficient than isStationNearTrack when checking multiple stations
 *
 * @param stationGeometry - Station point geometry
 * @param simplifiedTrackCoords - Pre-simplified track coordinates
 * @param thresholdDegrees - Distance threshold in degrees (default ~500m)
 * @returns true if station is within threshold of track
 */
export function isPointNearSimplifiedTrack(
  stationGeometry: GeoJsonPoint,
  simplifiedTrackCoords: [number, number][],
  thresholdDegrees: number = DEFAULT_STATION_THRESHOLD,
): boolean {
  const stationPoint: [number, number] = [stationGeometry.coordinates[0], stationGeometry.coordinates[1]];
  const distance = pointToLineStringDistance(stationPoint, simplifiedTrackCoords);
  return distance <= thresholdDegrees;
}
