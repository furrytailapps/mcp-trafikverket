/**
 * Shared GeoJSON types for Trafikverket MCP
 * Used by both NJDB (Lastkajen) and Trafikinfo APIs
 */

export interface GeoJsonPoint {
  type: 'Point';
  coordinates: [number, number]; // [longitude, latitude] in WGS84
}

export interface GeoJsonLineString {
  type: 'LineString';
  coordinates: [number, number][];
}

export interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: [number, number][][];
}

export type GeoJsonGeometry = GeoJsonPoint | GeoJsonLineString | GeoJsonPolygon;

export interface GeoJsonFeature<G, P> {
  type: 'Feature';
  geometry: G;
  properties: P;
}

export interface GeoJsonFeatureCollection<G, P> {
  type: 'FeatureCollection';
  features: GeoJsonFeature<G, P>[];
}
