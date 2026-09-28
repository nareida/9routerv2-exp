
import { deleteApiKey, getApiKeyById, updateApiKey } from "../../../lib/localDb.js";
import { getAdapter } from "../../../lib/db/driver.js";

/**
 * Reject a tier that does not exist, so a key can never point at a dangling
 * tier and silently lose quota enforcement. Also enforces the tier's max-key
 * cap; `excludeKeyId` keeps a key from counting itself when it is re-saved.
 */
async function assertTierAcceptsKey(symbol, excludeKeyId = null) {
  if (!symbol) return;
  const db = await getAdapter();
  const tier = db.get("SELECT symbol FROM userGroups WHERE symbol = ?", [symbol]);
  if (!tier) {
    const err = new Error(`Unknown tier: ${symbol}`) as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }
  const { checkGroupCapacity } = await import("../../../lib/billing/userGroupRepo.js");
  const capacity = await checkGroupCapacity(symbol, { excludeKeyId });
  if (!capacity.ok) {
    const err = new Error(capacity.reason) as Error & { statusCode?: number };
    err.statusCode = 409;
    throw err;
  }
}

// GET /api/keys/[id] - Get single key
export async function GET_handler(req, res, { params }) {
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) {
      return res.status(404).json({ error: "Key not found" });
    }
    return res.json({ key });
  } catch (error) {
    console.log("Error fetching key:", error);
    return res.status(500).json({ error: "Failed to fetch key" });
  }
}

// PUT /api/keys/[id] - Update key (name / active / balance / tier / unlimited)
export async function PUT_handler(req, res, { params }) {
  try {
    const { id } = await params;
    const body = req.body || {};
    const { name, isActive, balance, userGroup, unlimited } = body;

    const existing = await getApiKeyById(id);
    if (!existing) {
      return res.status(404).json({ error: "Key not found" });
    }

    await assertTierAcceptsKey(userGroup, id);

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (isActive !== undefined) updateData.isActive = !!isActive;
    if (balance !== undefined) updateData.balance = Number(balance);
    if (userGroup !== undefined) updateData.userGroup = userGroup || null;
    if (unlimited !== undefined) updateData.unlimited = !!unlimited;

    const updated = await updateApiKey(id, updateData);

    return res.json({ key: updated });
  } catch (error) {
    console.log("Error updating key:", error);
    const code = error?.statusCode || 500;
    return res
      .status(code)
      .json({ error: code === 400 ? error.message : "Failed to update key" });
  }
}

// DELETE /api/keys/[id] - Delete API key
export async function DELETE_handler(req, res, { params }) {
  try {
    const { id } = await params;

    const deleted = await deleteApiKey(id);
    if (!deleted) {
      return res.status(404).json({ error: "Key not found" });
    }

    return res.json({ message: "Key deleted successfully" });
  } catch (error) {
    console.log("Error deleting key:", error);
    return res.status(500).json({ error: "Failed to delete key" });
  }
}
