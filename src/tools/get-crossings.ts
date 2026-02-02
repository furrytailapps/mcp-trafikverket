import { z } from 'zod';
import { trafikinfoClient } from '@/clients/trafikinfo-client';
import { withErrorHandling } from '@/lib/response';
import { ValidationError } from '@/lib/errors';
import {
  latitudeSchema,
  longitudeSchema,
  radiusKmSchema,
  crossingProtectionSchema,
  crossingsLimitSchema,
} from '@/types/common-schemas';

export const getCrossingsInputSchema = {
  // PRIMARY: Query by track segment
  trackId: z
    .string()
    .optional()
    .describe('Track segment ID (e.g., "182", "421"). Returns all level crossings on that segment.'),

  // ALTERNATIVE: Geographic query
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
  radiusKm: radiusKmSchema.optional(),

  // Road-based query
  roadNumber: z.string().optional().describe('Road number to filter by (e.g., "E4", "rv 55", "66").'),

  // Optional filters
  protectionType: crossingProtectionSchema
    .optional()
    .describe('Filter by protection type: barriers (bommar), lights (ljussignal), signs (skyltar), or all.'),

  limit: crossingsLimitSchema.optional().describe('Maximum number of results. Default: 50, max: 200.'),
};

export const getCrossingsTool = {
  name: 'trafikverket_get_crossings',
  description:
    'Get level crossing (plankorsning) data from Trafikinfo API. ' +
    'Level crossings are where roads intersect railway tracks. ' +
    'Query by track segment ID, geographic location, or road number. ' +
    'Returns protection type (barriers, lights, signs), road info, and track details. ' +
    'Essential for road-rail interface work and safety planning.',
  inputSchema: getCrossingsInputSchema,
};

type GetCrossingsInput = {
  trackId?: string;
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  roadNumber?: string;
  protectionType?: 'barriers' | 'lights' | 'signs' | 'all';
  limit?: number;
};

export const getCrossingsHandler = withErrorHandling(async (args: GetCrossingsInput) => {
  const { trackId, latitude, longitude, radiusKm = 10, roadNumber, protectionType = 'all', limit = 50 } = args;

  let crossings;

  // Query by track segment ID
  if (trackId) {
    crossings = await trafikinfoClient.getLevelCrossingsByTrack(trackId, limit);
  }
  // Query by road number
  else if (roadNumber) {
    crossings = await trafikinfoClient.getLevelCrossingsByRoad(roadNumber, limit);
  }
  // Query by geographic location
  else if (latitude !== undefined && longitude !== undefined) {
    crossings = await trafikinfoClient.getLevelCrossingsByLocation(latitude, longitude, radiusKm, limit);
  }
  // No valid query provided
  else {
    throw new ValidationError('Either trackId, roadNumber, or latitude/longitude is required for crossing queries.');
  }

  // Apply protection type filter
  if (protectionType !== 'all') {
    crossings = trafikinfoClient.filterCrossingsByProtection(crossings, protectionType);
  }

  return {
    count: crossings.length,
    query: {
      trackId,
      roadNumber,
      location: latitude !== undefined ? { latitude, longitude, radiusKm } : undefined,
      protectionType,
    },
    crossings,
  };
});
