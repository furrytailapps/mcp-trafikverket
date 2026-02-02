/**
 * Vercel Cron endpoint for Lastkajen data sync
 *
 * Triggered daily at 3am UTC via Vercel Cron.
 * See vercel.json for cron schedule configuration.
 *
 * Manual trigger: GET /api/cron/sync
 */

import { NextResponse } from 'next/server';
import { syncFromLastkajen } from '@/scripts/sync-lastkajen';

export const runtime = 'nodejs';
export const maxDuration = 60; // 60 seconds max for sync

/**
 * Verify the request is from Vercel Cron or authorized
 */
function isAuthorized(request: Request): boolean {
  // Vercel Cron sends this header
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  // Allow if CRON_SECRET matches
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return true;
  }

  // Allow in development
  if (process.env.NODE_ENV === 'development') {
    return true;
  }

  // Allow Vercel Cron (they set a specific user-agent)
  const userAgent = request.headers.get('user-agent') || '';
  if (userAgent.includes('vercel-cron')) {
    return true;
  }

  return false;
}

export async function GET(request: Request): Promise<NextResponse> {
  // Check authorization
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('[cron] Starting scheduled Lastkajen sync...');

    const status = await syncFromLastkajen();

    console.log('[cron] Sync complete:', status.success ? 'SUCCESS' : 'FAILED');

    return NextResponse.json({
      success: status.success,
      lastSync: status.lastSync,
      source: status.source,
      counts: status.counts,
      error: status.error,
    });
  } catch (error) {
    console.error('[cron] Sync error:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
