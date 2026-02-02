import { lastkajenClient } from '@/clients/lastkajen-client';
import { trafikinfoClient } from '@/clients/trafikinfo-client';
import { withErrorHandling } from '@/lib/response';
import { ValidationError } from '@/lib/errors';
import { describeDataTypeSchema, largeLimitSchema } from '@/types/common-schemas';
import { z } from 'zod';

export const describeDataInputSchema = {
  dataType: describeDataTypeSchema.describe(
    'Type of metadata to retrieve. ' +
      'infrastructure_managers = list of track owners (Trafikverket, Inlandsbanan, etc.), ' +
      'track_designations = list of track segment IDs, ' +
      'station_codes = list of station codes with names, ' +
      'road_numbers = list of road identifiers, ' +
      'data_freshness = cache timestamps and last update times.',
  ),

  nameFilter: z.string().optional().describe('Partial match filter for names (case-insensitive).'),

  limit: largeLimitSchema.optional().describe('Maximum number of results. Default: 100.'),
};

export const describeDataTool = {
  name: 'trafikverket_describe_data',
  description:
    'Get metadata and discovery information for Trafikverket infrastructure. ' +
    'Use this tool to find valid track segment IDs, station codes, road numbers, and infrastructure managers ' +
    'before querying the other tools. ' +
    'Also provides data freshness information for cache status.',
  inputSchema: describeDataInputSchema,
};

type DescribeDataInput = {
  dataType: 'infrastructure_managers' | 'track_designations' | 'station_codes' | 'road_numbers' | 'data_freshness';
  nameFilter?: string;
  limit?: number;
};

export const describeDataHandler = withErrorHandling(async (args: DescribeDataInput) => {
  const { dataType, nameFilter, limit = 100 } = args;

  switch (dataType) {
    case 'infrastructure_managers': {
      let managers = await lastkajenClient.getInfrastructureManagers();

      if (nameFilter) {
        const filterLower = nameFilter.toLowerCase();
        managers = managers.filter(
          (m) => m.name.toLowerCase().includes(filterLower) || m.shortName?.toLowerCase().includes(filterLower),
        );
      }

      return {
        dataType,
        count: managers.length,
        description: 'Organizations that own/manage railway infrastructure in Sweden',
        managers: managers.slice(0, limit),
      };
    }

    case 'track_designations': {
      let designations = await lastkajenClient.getTrackDesignations();

      if (nameFilter) {
        designations = designations.filter((d) => d.includes(nameFilter));
      }

      return {
        dataType,
        count: designations.length,
        description: 'Track segment IDs used to query infrastructure (e.g., "182" for Västra Stambanan)',
        designations: designations.slice(0, limit),
      };
    }

    case 'station_codes': {
      let codes = await lastkajenClient.getStationCodes();

      if (nameFilter) {
        const filterLower = nameFilter.toLowerCase();
        codes = codes.filter((c) => c.code.toLowerCase().includes(filterLower) || c.name.toLowerCase().includes(filterLower));
      }

      return {
        dataType,
        count: codes.length,
        description: 'Railway station codes (signature) and names',
        stations: codes.slice(0, limit),
      };
    }

    case 'road_numbers': {
      let roadNumbers = await trafikinfoClient.getRoadNumbers();

      if (nameFilter) {
        const filterLower = nameFilter.toLowerCase();
        roadNumbers = roadNumbers.filter((r) => r.toLowerCase().includes(filterLower));
      }

      return {
        dataType,
        count: roadNumbers.length,
        description: 'Road identifiers used to query road conditions and level crossings',
        roadNumbers: roadNumbers.slice(0, limit),
      };
    }

    case 'data_freshness': {
      const cacheStatus = lastkajenClient.getCacheStatus();

      return {
        dataType,
        description: 'Information about data freshness and cache status',
        infrastructure: {
          source: 'NJDB (Nationella Järnvägsdatabasen) via Lastkajen API',
          cacheTTL: '24 hours',
          cacheEntries: cacheStatus.entries,
          oldestCacheEntry: cacheStatus.oldestEntry,
          note: 'Infrastructure data rarely changes; 24-hour cache is appropriate',
        },
        realtime: {
          source: 'Trafikinfo API',
          cached: false,
          note: 'Incidents, road conditions, and level crossings are fetched live',
        },
      };
    }

    default:
      throw new ValidationError(`Unknown data type: ${dataType}`);
  }
});
