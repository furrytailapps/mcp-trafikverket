/**
 * Run async functions with limited concurrency to avoid overwhelming upstream APIs.
 *
 * Example: With 6 functions and concurrency of 2, runs 3 batches of 2 calls each.
 */
export async function runWithConcurrency<T>(fns: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < fns.length; i += concurrency) {
    const batch = fns.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((fn) => fn()));
    results.push(...batchResults);
  }
  return results;
}

/** Max concurrent API calls to Trafikverket to avoid rate limiting */
export const TRAFIKVERKET_API_CONCURRENCY = 2;
