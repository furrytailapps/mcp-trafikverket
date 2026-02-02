import { z } from 'zod';
import { trafikinfoClient } from '@/clients/trafikinfo-client';
import { withErrorHandling } from '@/lib/response';
import { ValidationError } from '@/lib/errors';
import {
  latitudeSchema,
  longitudeSchema,
  largeRadiusKmSchema,
  operationsQueryTypeSchema,
  severitySchema,
  limitSchema,
} from '@/types/common-schemas';

export const getOperationsInputSchema = {
  queryType: operationsQueryTypeSchema.describe(
    'Type of operational data to query. ' +
      'incidents = train delays/disruptions, road_conditions = road surface status, parking = parking facilities.',
  ),

  // For incidents
  severity: severitySchema
    .optional()
    .describe('Filter incidents by severity. high = major disruptions, medium = delays, low = all messages.'),

  // For road_conditions and parking
  latitude: latitudeSchema.optional().describe('Latitude in WGS84. Required for road_conditions and parking queries.'),
  longitude: longitudeSchema.optional().describe('Longitude in WGS84. Required for road_conditions and parking.'),
  radiusKm: largeRadiusKmSchema.optional(),

  roadNumber: z
    .string()
    .optional()
    .describe('Road number for road conditions (e.g., "E4", "rv 55"). Alternative to location query.'),

  // For parking
  nearStation: z.string().optional().describe('Station name to find parking near (e.g., "Stockholm Central").'),

  limit: limitSchema.optional(),
};

export const getOperationsTool = {
  name: 'trafikverket_get_operations',
  description:
    'Get real-time operational data for work planning. ' +
    'Query types: ' +
    '(1) incidents - train delays, disruptions, and traffic messages for scheduling work around disruptions. ' +
    '(2) road_conditions - road surface status, ice/snow, temperature for heavy equipment transport. ' +
    '(3) parking - parking facilities near stations for staging areas. ' +
    'Data is fetched live from Trafikinfo API.',
  inputSchema: getOperationsInputSchema,
};

type GetOperationsInput = {
  queryType: 'incidents' | 'road_conditions' | 'parking';
  severity?: 'low' | 'medium' | 'high';
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  roadNumber?: string;
  nearStation?: string;
  limit?: number;
};

export const getOperationsHandler = withErrorHandling(async (args: GetOperationsInput) => {
  const { queryType, severity, latitude, longitude, radiusKm, roadNumber, nearStation, limit = 20 } = args;

  switch (queryType) {
    case 'incidents': {
      let incidents = await trafikinfoClient.getTrainMessages(limit);

      if (severity) {
        incidents = trafikinfoClient.filterIncidentsBySeverity(incidents, severity);
      }

      return {
        queryType,
        count: incidents.length,
        query: { severity },
        incidents,
      };
    }

    case 'road_conditions': {
      // Query by road number
      if (roadNumber) {
        const conditions = await trafikinfoClient.getRoadConditionsByRoad(roadNumber, limit);
        return {
          queryType,
          count: conditions.length,
          query: { roadNumber },
          conditions,
        };
      }

      // Query by location
      if (latitude !== undefined && longitude !== undefined) {
        const radius = radiusKm || 25;
        const conditions = await trafikinfoClient.getRoadConditionsByLocation(latitude, longitude, radius, limit);
        return {
          queryType,
          count: conditions.length,
          query: { latitude, longitude, radiusKm: radius },
          conditions,
        };
      }

      throw new ValidationError('Either roadNumber or latitude/longitude is required for road_conditions queries.');
    }

    case 'parking': {
      // Query by station name
      if (nearStation) {
        const parking = await trafikinfoClient.getParkingByName(nearStation, limit);
        return {
          queryType,
          count: parking.length,
          query: { nearStation },
          parking,
        };
      }

      // Query by location
      if (latitude !== undefined && longitude !== undefined) {
        const radius = radiusKm || 10;
        const parking = await trafikinfoClient.getParkingByLocation(latitude, longitude, radius, limit);
        return {
          queryType,
          count: parking.length,
          query: { latitude, longitude, radiusKm: radius },
          parking,
        };
      }

      throw new ValidationError('Either nearStation or latitude/longitude is required for parking queries.');
    }

    default:
      throw new ValidationError(`Unknown query type: ${queryType}`);
  }
});
