/**
 * Shared types for Lastkajen data sync
 */

export interface SyncStatus {
  lastSync: string;
  source: 'lastkajen' | 'manual' | 'initial';
  success: boolean;
  error?: string;
  counts: {
    tracks: number;
    tunnels: number;
    bridges: number;
    switches: number;
    electrification: number;
    stations: number;
  };
}
