/**
 * Nareida layer: soul compliance counters.
 * GET /api/soul/stats → { scanned, ok, leaks, canarySeen, errors, persisted }
 */
import { soulStats } from "../../../soul/monitor.js";
import { getPersistedSoulStats } from "../../../soul/history.js";

export async function GET(req, res) {
  const merged = await getPersistedSoulStats();
  return res.json(merged);
}

export { soulStats };
