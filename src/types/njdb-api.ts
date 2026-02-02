/**
 * Types for NJDB (Nationella Järnvägsdatabasen) via Lastkajen API
 * API Endpoint: https://lastkajen.trafikverket.se
 * Documentation: https://lastkajen.trafikverket.se/api
 *
 * Note: The actual Lastkajen API structure needs to be discovered.
 * These types are based on typical Swedish railway infrastructure data.
 */

import type { GeoJsonFeature, GeoJsonFeatureCollection, GeoJsonPoint, GeoJsonLineString } from './geojson';

// Re-export GeoJSON types for convenience
export type { GeoJsonFeature, GeoJsonFeatureCollection, GeoJsonPoint, GeoJsonLineString };

// ============================================================================
// TRACK DATA
// ============================================================================

export interface TrackProperties {
  trackId?: string;
  designation?: string;
  name?: string;
  gauge?: number; // mm
  speedLimit?: number; // km/h
  electrified?: boolean;
  electrificationType?: string; // e.g., "15kV AC"
  infrastructureManager?: string;
  trackClass?: string;
  numberOfTracks?: number;
  length?: number; // meters
}

export type TrackFeature = GeoJsonFeature<GeoJsonLineString, TrackProperties>;

export interface Track {
  id: string;
  designation?: string;
  name?: string;
  gauge?: number;
  speedLimit?: number;
  electrified?: boolean;
  electrificationType?: string;
  infrastructureManager?: string;
  trackClass?: string;
  numberOfTracks?: number;
  length?: number;
  geometry: GeoJsonLineString;
}

// ============================================================================
// TUNNEL DATA
// ============================================================================

export interface TunnelProperties {
  tunnelId?: string;
  name?: string;
  trackId?: string;
  length?: number; // meters
  width?: number;
  height?: number;
  builtYear?: number;
  renovatedYear?: number;
}

export type TunnelFeature = GeoJsonFeature<GeoJsonLineString, TunnelProperties>;

export interface Tunnel {
  id: string;
  name?: string;
  trackId?: string;
  length?: number;
  width?: number;
  height?: number;
  builtYear?: number;
  renovatedYear?: number;
  geometry: GeoJsonLineString;
}

// ============================================================================
// BRIDGE DATA
// ============================================================================

export interface BridgeProperties {
  bridgeId?: string;
  name?: string;
  trackId?: string;
  type?: string; // e.g., "beam", "arch", "truss"
  length?: number;
  width?: number;
  clearanceHeight?: number;
  builtYear?: number;
  loadCapacity?: number; // tons
  crossesOver?: string; // road, river, etc.
}

export type BridgeFeature = GeoJsonFeature<GeoJsonLineString | GeoJsonPoint, BridgeProperties>;

export interface Bridge {
  id: string;
  name?: string;
  trackId?: string;
  type?: string;
  length?: number;
  width?: number;
  clearanceHeight?: number;
  builtYear?: number;
  loadCapacity?: number;
  crossesOver?: string;
  geometry: GeoJsonLineString | GeoJsonPoint;
}

// ============================================================================
// SWITCH DATA
// ============================================================================

export interface SwitchProperties {
  switchId?: string;
  trackId?: string;
  type?: string; // e.g., "left", "right", "double"
  controlType?: string; // "manual", "remote", "automatic"
  maxSpeed?: number;
}

export type SwitchFeature = GeoJsonFeature<GeoJsonPoint, SwitchProperties>;

export interface Switch {
  id: string;
  trackId?: string;
  type?: string;
  controlType?: string;
  maxSpeed?: number;
  geometry: GeoJsonPoint;
}

// ============================================================================
// ELECTRIFICATION DATA
// ============================================================================

export interface ElectrificationProperties {
  sectionId?: string;
  trackId?: string;
  systemType?: string; // e.g., "15kV 16.7Hz AC"
  voltage?: number;
  frequency?: number;
  catenary?: boolean;
  thirdRail?: boolean;
  startKm?: number;
  endKm?: number;
}

export type ElectrificationFeature = GeoJsonFeature<GeoJsonLineString, ElectrificationProperties>;

export interface ElectrificationSection {
  id: string;
  trackId?: string;
  systemType?: string;
  voltage?: number;
  frequency?: number;
  catenary?: boolean;
  thirdRail?: boolean;
  startKm?: number;
  endKm?: number;
  geometry: GeoJsonLineString;
}

// ============================================================================
// STATION DATA
// ============================================================================

export interface StationProperties {
  stationId?: string;
  name?: string;
  signature?: string; // 3-4 letter station code
  type?: string; // "station", "halt", "junction"
  platforms?: number;
  tracks?: number;
  accessible?: boolean;
  latitude?: number;
  longitude?: number;
}

export type StationFeature = GeoJsonFeature<GeoJsonPoint, StationProperties>;

export interface Station {
  id: string;
  name?: string;
  signature?: string;
  type?: string;
  platforms?: number;
  tracks?: number;
  accessible?: boolean;
  geometry: GeoJsonPoint;
}

// ============================================================================
// COMBINED INFRASTRUCTURE RESPONSE
// ============================================================================

export interface SegmentInfrastructure {
  trackId: string;
  track?: Track;
  tunnels: Tunnel[];
  bridges: Bridge[];
  switches: Switch[];
  electrification: ElectrificationSection[];
  stations: Station[];
}

export interface InfrastructureQueryResult {
  queryType: string;
  count: number;
  tracks?: Track[];
  tunnels?: Tunnel[];
  bridges?: Bridge[];
  switches?: Switch[];
  electrification?: ElectrificationSection[];
  stations?: Station[];
}

// ============================================================================
// INFRASTRUCTURE MANAGERS
// ============================================================================

export interface InfrastructureManager {
  id: string;
  name: string;
  shortName?: string;
}

// ============================================================================
// TRANSFORM FUNCTIONS
// ============================================================================

export function transformTrack(feature: TrackFeature): Track {
  const { properties, geometry } = feature;
  return {
    id: properties.trackId || 'unknown',
    designation: properties.designation,
    name: properties.name,
    gauge: properties.gauge,
    speedLimit: properties.speedLimit,
    electrified: properties.electrified,
    electrificationType: properties.electrificationType,
    infrastructureManager: properties.infrastructureManager,
    trackClass: properties.trackClass,
    numberOfTracks: properties.numberOfTracks,
    length: properties.length,
    geometry,
  };
}

export function transformTunnel(feature: TunnelFeature): Tunnel {
  const { properties, geometry } = feature;
  return {
    id: properties.tunnelId || 'unknown',
    name: properties.name,
    trackId: properties.trackId,
    length: properties.length,
    width: properties.width,
    height: properties.height,
    builtYear: properties.builtYear,
    renovatedYear: properties.renovatedYear,
    geometry,
  };
}

export function transformBridge(feature: BridgeFeature): Bridge {
  const { properties, geometry } = feature;
  return {
    id: properties.bridgeId || 'unknown',
    name: properties.name,
    trackId: properties.trackId,
    type: properties.type,
    length: properties.length,
    width: properties.width,
    clearanceHeight: properties.clearanceHeight,
    builtYear: properties.builtYear,
    loadCapacity: properties.loadCapacity,
    crossesOver: properties.crossesOver,
    geometry,
  };
}

export function transformSwitch(feature: SwitchFeature): Switch {
  const { properties, geometry } = feature;
  return {
    id: properties.switchId || 'unknown',
    trackId: properties.trackId,
    type: properties.type,
    controlType: properties.controlType,
    maxSpeed: properties.maxSpeed,
    geometry,
  };
}

export function transformElectrification(feature: ElectrificationFeature): ElectrificationSection {
  const { properties, geometry } = feature;
  return {
    id: properties.sectionId || 'unknown',
    trackId: properties.trackId,
    systemType: properties.systemType,
    voltage: properties.voltage,
    frequency: properties.frequency,
    catenary: properties.catenary,
    thirdRail: properties.thirdRail,
    startKm: properties.startKm,
    endKm: properties.endKm,
    geometry,
  };
}

export function transformStation(feature: StationFeature): Station {
  const { properties, geometry } = feature;
  return {
    id: properties.stationId || 'unknown',
    name: properties.name,
    signature: properties.signature,
    type: properties.type,
    platforms: properties.platforms,
    tracks: properties.tracks,
    accessible: properties.accessible,
    geometry,
  };
}
