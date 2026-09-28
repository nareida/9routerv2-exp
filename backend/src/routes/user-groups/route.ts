import {
  listUserGroups,
  createUserGroup,
  updateUserGroup,
  deleteUserGroup,
} from "../../lib/billing/userGroupRepo.js";

export const dynamic = "force-dynamic";

function shape(g) {
  return {
    symbol: g.symbol,
    name: g.name,
    ratio: Number(g.ratio),
    apiRate: Number(g.apiRate),
    public: !!g.public,
    promotion: !!g.promotion,
    // Consumption window, in lifetime-charge units (see pickPromotionGroup).
    min: Number(g.min),
    max: Number(g.max),
    // Key-count cap. Separate from min/max on purpose.
    maxKeys: Number(g.maxKeys ?? 0),
    enable: !!g.enable,
  };
}

// GET /api/user-groups - list tiers
export async function GET(req, res) {
  try {
    const groups = await listUserGroups();
    const known = new Set(groups.map((g) => g.symbol));

    // Keys can be left pointing at a tier that was deleted. Those keys are
    // still charged, but at ratio 1 with no rate cap — which is invisible
    // unless it is called out, so surface them as orphans.
    let orphans = [];
    let keyCounts: Record<string, number> = {};
    try {
      const { getAdapter } = await import("../../lib/db/driver.js");
      const db = await getAdapter();
      const rows = db.all(
        "SELECT userGroup, COUNT(*) AS c FROM apiKeys WHERE userGroup IS NOT NULL AND userGroup != '' GROUP BY userGroup",
      );
      keyCounts = Object.fromEntries(rows.map((r) => [r.userGroup, Number(r.c)]));
      orphans = rows.map((r) => r.userGroup).filter((s) => !known.has(s));
    } catch {
      orphans = [];
      keyCounts = {};
    }

    return res.json({
      // keyCount lets the page show "1/3 keys" against the tier's maxKeys cap
      // without a second request.
      groups: groups.map((g) => ({ ...shape(g), keyCount: keyCounts[g.symbol] || 0 })),
      orphanedGroups: orphans,
    });
  } catch (e) {
    console.log("Error fetching user groups:", e);
    return res.status(500).json({ error: "Failed to fetch user groups" });
  }
}

// POST /api/user-groups - create a tier
export async function POST(req, res) {
  try {
    const body = req.body || {};
    const symbol = String(body.symbol || "").trim();
    if (!symbol) return res.status(400).json({ error: "symbol required" });

    const existing = await listUserGroups();
    if (existing.some((g) => g.symbol === symbol)) {
      return res.status(409).json({ error: `group ${symbol} already exists` });
    }

    const group = await createUserGroup({
      symbol,
      name: String(body.name || symbol),
      ratio: Number(body.ratio ?? 1),
      apiRate: Number(body.apiRate ?? 600),
      public: !!body.public,
      promotion: !!body.promotion,
      min: Number(body.min ?? 0),
      max: Number(body.max ?? 0),
      maxKeys: Number(body.maxKeys ?? 0),
      enable: body.enable === undefined ? true : !!body.enable,
    });
    return res.status(201).json({ group: shape(group) });
  } catch (e) {
    console.log("Error creating user group:", e);
    return res.status(500).json({ error: "Failed to create user group" });
  }
}

// PUT /api/user-groups - update a tier
export async function PUT(req, res) {
  try {
    const body = req.body || {};
    const symbol = String(body.symbol || "").trim();
    if (!symbol) return res.status(400).json({ error: "symbol required" });
    const updated = await updateUserGroup(symbol, body);
    if (!updated) return res.status(404).json({ error: `group ${symbol} not found` });
    return res.json({ group: shape(updated) });
  } catch (e) {
    console.log("Error updating user group:", e);
    return res.status(500).json({ error: "Failed to update user group" });
  }
}

// DELETE /api/user-groups?symbol=pro
export async function DELETE(req, res) {
  try {
    // Accept the symbol from either the query string or the body, so a client
    // that posts JSON (the shape used for every other verb here) is not
    // silently rejected.
    const symbol =
      req.query?.symbol ||
      req.body?.symbol ||
      (req.url ? new URL(req.url).searchParams.get("symbol") : null);
    if (!symbol) return res.status(400).json({ error: "symbol required" });
    await deleteUserGroup(symbol);
    return res.json({ ok: true, deleted: symbol });
  } catch (e) {
    console.log("Error deleting user group:", e);
    return res.status(500).json({ error: "Failed to delete user group" });
  }
}
