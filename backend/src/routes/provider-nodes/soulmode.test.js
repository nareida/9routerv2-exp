import { describe, it, expect, vi, beforeEach } from "vitest";

// Route under test: PUT /api/provider-nodes/[id]
const updateProviderNode = vi.fn();
const getProviderNodeById = vi.fn();
const getProviderConnections = vi.fn();
const updateProviderConnection = vi.fn();
const deleteProviderConnectionsByProvider = vi.fn();
const deleteProviderNode = vi.fn();

vi.mock("../../models/index.js", () => ({
  deleteProviderConnectionsByProvider,
  deleteProviderNode,
  getProviderConnections,
  getProviderNodeById,
  updateProviderConnection,
  updateProviderNode,
}));

const NODE = {
  id: "node-1",
  type: "openai-compatible",
  name: "dahono",
  prefix: "dahono",
  apiType: "chat",
  baseUrl: "https://gateway.dahono.com/v1",
};

function makeRes() {
  return {
    _status: 200,
    status(c) { this._status = c; return this; },
    json(b) { this._body = b; return this; },
  };
}

async function invoke(body) {
  const mod = await import("./[id]/route.ts");
  const res = makeRes();
  await mod.PUT_handler({ body }, res, { params: Promise.resolve({ id: NODE.id }) });
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  getProviderNodeById.mockResolvedValue({ ...NODE });
  getProviderConnections.mockResolvedValue([]);
  updateProviderNode.mockImplementation(async (id, data) => ({ ...NODE, ...data }));
});

describe("PUT /api/provider-nodes/[id] — soulMode", () => {
  it("persists soulMode:true onto the node", async () => {
    const res = await invoke({ name: "dahono", prefix: "dahono", apiType: "chat", baseUrl: NODE.baseUrl, soulMode: true });
    expect(res._status).toBe(200);
    expect(updateProviderNode).toHaveBeenCalledWith(NODE.id, expect.objectContaining({ soulMode: true }));
  });

  it("persists soulMode:false so the toggle can be turned back off", async () => {
    await invoke({ name: "dahono", prefix: "dahono", apiType: "chat", baseUrl: NODE.baseUrl, soulMode: false });
    expect(updateProviderNode).toHaveBeenCalledWith(NODE.id, expect.objectContaining({ soulMode: false }));
  });

  it("propagates soulMode into the existing connection's providerSpecificData", async () => {
    getProviderConnections.mockResolvedValue([
      { id: "conn-1", providerSpecificData: { prefix: "dahono", baseUrl: NODE.baseUrl, nodeName: "dahono" } },
    ]);
    await invoke({ name: "dahono", prefix: "dahono", apiType: "chat", baseUrl: NODE.baseUrl, soulMode: true });
    expect(updateProviderConnection).toHaveBeenCalledWith("conn-1", {
      providerSpecificData: expect.objectContaining({ soulMode: true }),
    });
  });

  it("leaves soulMode untouched when the caller omits it", async () => {
    getProviderConnections.mockResolvedValue([
      { id: "conn-1", providerSpecificData: { soulMode: true } },
    ]);
    await invoke({ name: "dahono", prefix: "dahono", apiType: "chat", baseUrl: NODE.baseUrl });
    const [, patch] = updateProviderConnection.mock.calls[0];
    expect(patch.providerSpecificData.soulMode).toBe(true);
  });

  it("ignores soulMode on non openai-compatible node types", async () => {
    getProviderNodeById.mockResolvedValue({ ...NODE, type: "anthropic-compatible" });
    await invoke({ name: "cl", prefix: "cl", baseUrl: "https://x/v1", soulMode: true });
    expect(updateProviderNode.mock.calls[0][1]).not.toHaveProperty("soulMode");
  });
});
