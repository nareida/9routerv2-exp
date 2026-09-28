
import { getApiKeys, createApiKey } from "../../lib/localDb.js";
import { getConsistentMachineId } from "../../shared/utils/machineId.js";
import { getAdapter } from "../../lib/db/driver.js";

export const dynamic = "force-dynamic";

// GET /api/keys - List API keys
export async function GET(req, res) {
  try {
    const keys = await getApiKeys();

    // Attach live per-tier occupancy so the UI can show "3/5 keys" and warn
    // before the user hits the cap.
    const byGroup: Record<string, number> = {};
    for (const k of keys) {
      if (!k.userGroup) continue;
      byGroup[k.userGroup] = (byGroup[k.userGroup] || 0) + (k.isActive ? 1 : 0);
    }

    let tiers: any[] = [];
    try {
      const db = await getAdapter();
      tiers = db.all("SELECT symbol, maxKeys FROM userGroups");
    } catch { tiers = []; }
    const tierMeta: Record<string, { maxKeys: number }> = {};
    for (const t of tiers) {
      tierMeta[t.symbol] = { maxKeys: Number(t.maxKeys ?? 0) };
    }

    return res.json({
      keys: keys.map((k) => {
        if (!k.userGroup) return k;
        const meta = tierMeta[k.userGroup];
        return {
          ...k,
          groupUsed: byGroup[k.userGroup] || 0,
          groupMaxKeys: meta?.maxKeys ?? 0,
        };
      }),
    });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return res.status(500).json({ error: "Failed to fetch keys" });
  }
}

// POST /api/keys - Create new API key
export async function POST_handler(req, res) {
  try {
    const body = req.body || {};
    const { name, balance, userGroup, unlimited, allowedModels } = body;

    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }

    // Reject an unknown tier rather than storing a dangling reference that
    // would silently leave the key without quota enforcement.
    if (userGroup) {
      const db = await getAdapter();
      const tier = db.get("SELECT symbol FROM userGroups WHERE symbol = ?", [userGroup]);
      if (!tier) {
        return res.status(400).json({ error: `Unknown tier: ${userGroup}` });
      }
      const { checkGroupCapacity } = await import("../../lib/billing/userGroupRepo.js");
      const capacity = await checkGroupCapacity(userGroup);
      if (!capacity.ok) {
        return res.status(409).json({ error: capacity.reason });
      }
    }

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(name, machineId, { balance, userGroup, unlimited, allowedModels });

    return res.status(201).json({ key: apiKey.key, ...apiKey });
  } catch (error) {
    console.log("Error creating key:", error);
    return res.status(500).json({ error: "Failed to create key" });
  }
}

// Per-key updates and deletes live in /api/keys/[id] so there is a single
// implementation of each, including the tier-exists check.
