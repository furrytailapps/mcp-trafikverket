import { z } from 'zod';
import { lastkajenClient } from '@/clients/lastkajen-client';
import { withErrorHandling } from '@/lib/response';
import { ValidationError } from '@/lib/errors';
import { loadSyncStatus } from '@/lib/data-loader';
import {
  latitudeSchema,
  longitudeSchema,
  radiusKmSchema,
  bboxSchema,
  infrastructureQueryTypeSchema,
  largeLimitSchema,
  geometryDetailSchema,
} from '@/types/common-schemas';
import type { InfrastructureQueryResult } from '@/types/njdb-api';

export const getInfrastructureInputSchema = {
  queryType: infrastructureQueryTypeSchema.describe(
    'Type of infrastructure to query. Use "all" to get complete infrastructure for a track segment. ' +
      'Options: tracks, tunnels, bridges, switches, electrification, stations, all',
  ),

  // PRIMARY: Query by track segment ID
  trackId: z
    .string()
    .optional()
    .describe(
      'Track segment ID (e.g., "182", "421"). Returns all infrastructure on that segment. ' +
        'This is the primary query method for maintenance planning.',
    ),

  // ALTERNATIVE: Geographic query
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
  radiusKm: radiusKmSchema
    .optional()
    .describe('Search radius in kilometers. Default: 10, max: 50. Only used with latitude/longitude.'),
  bbox: bboxSchema.optional(),

  // Optional filters
  electrified: z.boolean().optional().describe('Filter tracks by electrification status (true = electrified only).'),

  infrastructureManager: z
    .string()
    .optional()
    .describe('Filter by infrastructure manager name. Examples: "Trafikverket", "Inlandsbanan".'),

  limit: largeLimitSchema.optional().describe('Maximum number of results. Default: 100, max: 500.'),

  geometryDetail: geometryDetailSchema.default('corridor').describe(
    `Level of coordinate detail in response (reduces tokens by 95-99%):
- "metadata": Properties only (length, speed, electrification). Use when you don't need location.
- "corridor": Simplified path (~50-100 points). Use for querying weather/geology along the track. (Default)
- "precise": All coordinates. Use only for accurate map visualization.`,
  ),
};

export const getInfrastructureTool = {
  name: 'trafikverket_get_infrastructure',
  description:
    'Get railway infrastructure data from NJDB (Nationella Järnvägsdatabasen). ' +
    'PRIMARY: Query by track segment ID for maintenance planning (e.g., trackId="182"). ' +
    'SECONDARY: Query by geographic location (latitude/longitude with radius, or bbox). ' +
    'Returns track geometries, tunnels, bridges, switches, electrification sections, and stations. ' +
    'Responses include lastSync timestamp indicating data freshness. ' +
    'Note: electrified filter only applies to tracks queryType.',
  inputSchema: getInfrastructureInputSchema,
};

type GetInfrastructureInput = {
  queryType: 'tracks' | 'tunnels' | 'bridges' | 'switches' | 'electrification' | 'stations' | 'all';
  trackId?: string;
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  bbox?: string;
  electrified?: boolean;
  infrastructureManager?: string;
  limit?: number;
  geometryDetail?: 'metadata' | 'corridor' | 'precise';
};

export const getInfrastructureHandler = withErrorHandling(async (args: GetInfrastructureInput) => {
  const {
    queryType,
    trackId,
    latitude,
    longitude,
    radiusKm = 10,
    bbox,
    electrified,
    infrastructureManager,
    limit = 100,
    geometryDetail = 'corridor',
  } = args;

  // Get sync status for data freshness info
  const syncStatus = await loadSyncStatus();
  const lastSync = syncStatus?.lastSync || null;

  // PRIMARY: Query by track segment ID
  if (trackId) {
    const segmentData = await lastkajenClient.getSegmentInfrastructure(trackId, geometryDetail);

    if (queryType === 'all') {
      return {
        queryType: 'all',
        trackId,
        lastSync,
        count:
          (segmentData.track ? 1 : 0) +
          segmentData.tunnels.length +
          segmentData.bridges.length +
          segmentData.switches.length +
          segmentData.electrification.length +
          segmentData.stations.length,
        track: segmentData.track,
        tunnels: segmentData.tunnels,
        bridges: segmentData.bridges,
        switches: segmentData.switches,
        electrification: segmentData.electrification,
        stations: segmentData.stations,
      };
    }

    // Return specific infrastructure type
    switch (queryType) {
      case 'tracks':
        return {
          queryType,
          trackId,
          lastSync,
          count: segmentData.track ? 1 : 0,
          tracks: segmentData.track ? [segmentData.track] : [],
        };
      case 'tunnels':
        return { queryType, trackId, lastSync, count: segmentData.tunnels.length, tunnels: segmentData.tunnels };
      case 'bridges':
        return { queryType, trackId, lastSync, count: segmentData.bridges.length, bridges: segmentData.bridges };
      case 'switches':
        return { queryType, trackId, lastSync, count: segmentData.switches.length, switches: segmentData.switches };
      case 'electrification':
        return {
          queryType,
          trackId,
          lastSync,
          count: segmentData.electrification.length,
          electrification: segmentData.electrification,
        };
      case 'stations':
        return { queryType, trackId, lastSync, count: segmentData.stations.length, stations: segmentData.stations };
    }
  }

  // SECONDARY: Geographic query
  let parsedBBox;
  if (bbox) {
    parsedBBox = lastkajenClient.parseBBox(bbox);
  } else if (latitude !== undefined && longitude !== undefined) {
    parsedBBox = lastkajenClient.bboxFromPoint(latitude, longitude, radiusKm);
  } else {
    throw new ValidationError('Either trackId, latitude/longitude, or bbox is required for infrastructure queries.');
  }

  // Query specific infrastructure types
  const result: InfrastructureQueryResult = { queryType, count: 0, lastSync };

  switch (queryType) {
    case 'tracks': {
      let tracks = await lastkajenClient.getTracksByBBox(parsedBBox, limit, geometryDetail);
      if (electrified !== undefined) {
        tracks = tracks.filter((t) => t.electrified === electrified);
      }
      if (infrastructureManager) {
        const managerLower = infrastructureManager.toLowerCase();
        tracks = tracks.filter((t) => t.infrastructureManager?.toLowerCase().includes(managerLower));
      }
      result.tracks = tracks;
      result.count = tracks.length;
      break;
    }
    case 'tunnels': {
      const tunnels = await lastkajenClient.getTunnelsByBBox(parsedBBox, limit, geometryDetail);
      result.tunnels = tunnels;
      result.count = tunnels.length;
      break;
    }
    case 'bridges': {
      const bridges = await lastkajenClient.getBridgesByBBox(parsedBBox, limit, geometryDetail);
      result.bridges = bridges;
      result.count = bridges.length;
      break;
    }
    case 'switches': {
      const switches = await lastkajenClient.getSwitchesByBBox(parsedBBox, limit, geometryDetail);
      result.switches = switches;
      result.count = switches.length;
      break;
    }
    case 'electrification': {
      const electrification = await lastkajenClient.getElectrificationByBBox(parsedBBox, limit, geometryDetail);
      result.electrification = electrification;
      result.count = electrification.length;
      break;
    }
    case 'stations': {
      const stations = await lastkajenClient.getStationsByBBox(parsedBBox, limit, geometryDetail);
      result.stations = stations;
      result.count = stations.length;
      break;
    }
    case 'all': {
      const [tracks, tunnels, bridges, switches, electrification, stations] = await Promise.all([
        lastkajenClient.getTracksByBBox(parsedBBox, limit, geometryDetail),
        lastkajenClient.getTunnelsByBBox(parsedBBox, limit, geometryDetail),
        lastkajenClient.getBridgesByBBox(parsedBBox, limit, geometryDetail),
        lastkajenClient.getSwitchesByBBox(parsedBBox, limit, geometryDetail),
        lastkajenClient.getElectrificationByBBox(parsedBBox, limit, geometryDetail),
        lastkajenClient.getStationsByBBox(parsedBBox, limit, geometryDetail),
      ]);

      let filteredTracks = tracks;
      if (electrified !== undefined) {
        filteredTracks = tracks.filter((t) => t.electrified === electrified);
      }
      if (infrastructureManager) {
        const managerLower = infrastructureManager.toLowerCase();
        filteredTracks = filteredTracks.filter((t) => t.infrastructureManager?.toLowerCase().includes(managerLower));
      }

      result.tracks = filteredTracks;
      result.tunnels = tunnels;
      result.bridges = bridges;
      result.switches = switches;
      result.electrification = electrification;
      result.stations = stations;
      result.count =
        filteredTracks.length + tunnels.length + bridges.length + switches.length + electrification.length + stations.length;
      break;
    }
  }

  return result;
});
