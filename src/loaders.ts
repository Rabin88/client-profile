import DataLoader from "dataloader";
import { AdviserService } from "./services/adviserService";
import type { AdviserRecord, Loaders } from "./types";

/**
 * Batch function: DataLoader collects every adviser key requested in one tick,
 * de-duplicates them, and hands us the unique set. One downstream call per
 * unique adviser, failures isolated per key (an Error in the result array
 * rejects only that key's promise, not the whole batch).
 *
 * If AdviserService exposed a bulk endpoint (getMany(ids)), this is the single
 * place to swap it in — resolvers wouldn't change.
 */
async function batchAdvisers(
  ids: readonly string[]
): Promise<Array<AdviserRecord | Error>> {
  const settled = await Promise.allSettled(
    ids.map((id) => AdviserService.getDetails(id))
  );
  return settled.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : r.reason instanceof Error
        ? r.reason
        : new Error("Unknown adviser lookup failure")
  );
}

/** Must be called once per request — never share loaders across requests. */
export function createLoaders(): Loaders {
  return { adviser: new DataLoader<string, AdviserRecord>(batchAdvisers) };
}
