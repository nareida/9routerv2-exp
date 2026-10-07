import { useState, useEffect, useCallback } from "react";
import {
  Card,
  Button,
  Modal,
  Input,
  Select,
  Toggle,
  CardSkeleton,
  ModelSelectModal,
} from "@/shared/components";
import QuotaBar from "./QuotaBar";

// API key management. Every key belongs to a tier; the tier supplies the cost
// ratio and the per-minute request cap, and the key supplies the balance that
// gets charged. `unlimited` keys are metered for stats but never charged and
// never blocked.
//
// All values come from the API — nothing here recomputes quota.

const BLANK = {
  name: "",
  userGroup: "",
  balance: "100000",
  unlimited: false,
  isActive: true,
  // Model patterns this key may call. ["*"] is unrestricted and is also the
  // default for keys created before the allow-list existed, so an untouched
  // form saves back exactly the same thing it read.
  allowedModels: ["*"],
};

// Patterns a user may type by hand in the allow-list. The picker produces
// exact ids, so these only exist for "everything" and prefix families.
const WILDCARD = "*";

function isUnrestricted(patterns) {
  return !patterns || patterns.length === 0 || patterns.includes(WILDCARD);
}

function fmtBalance(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(v % 1 === 0 ? 0 : 2);
}

function maskKey(k) {
  if (!k) return "";
  return k.length <= 11 ? k : `${k.slice(0, 7)}…${k.slice(-4)}`;
}

export default function KeysPage() {
  const [keys, setKeys] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [revealed, setRevealed] = useState({});
  const [filterTier, setFilterTier] = useState("");
  const [tierLoadError, setTierLoadError] = useState("");
  const [showModelSelect, setShowModelSelect] = useState(false);
  // Provider/model lists the picker needs. Loaded with the keys, and a failure
  // is surfaced in the modal rather than leaving an empty picker that looks
  // like "this provider has no models".
  const [providers, setProviders] = useState([]);
  const [modelAliases, setModelAliases] = useState({});

  const load = useCallback(async () => {
    try {
      const [kr, gr, pr, ar] = await Promise.all([
        fetch("/api/keys"),
        fetch("/api/user-groups"),
        // Feeds the model allow-list picker. Loaded on the same pass so opening
        // the modal never has to wait on a second round of fetches.
        fetch("/api/providers"),
        fetch("/api/models/alias"),
      ]);
      const kj = await kr.json();
      const gj = await gr.json();
      const pj = pr.ok ? await pr.json().catch(() => ({})) : {};
      const aj = ar.ok ? await ar.json().catch(() => ({})) : {};
      if (pr.ok) setProviders(pj.connections || []);
      if (ar.ok) setModelAliases(aj.aliases || {});
      if (kr.ok) setKeys(kj.keys || []);
      // A failed or non-JSON tier fetch must not silently leave `tiers` empty:
      // every key then renders as "no tier" even though it has one. Fall back
      // to the userGroup string carried on the key itself so the tier name,
      // ratio and rate cap still show, and let the next refresh fix it.
      if (gr.ok && Array.isArray(gj.groups)) {
        setTiers(gj.groups);
        setTierLoadError("");
      } else {
        setTiers([]);
        setTierLoadError(`tier details unavailable (HTTP ${gr.status})`);
      }
    } catch (e) {
      console.log("Error fetching keys:", e);
      setTierLoadError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const tierBySymbol = new Map(tiers.map((t) => [t.symbol, t]));
  const tierOptions = [
    { value: "", label: "No tier (no quota)" },
    ...tiers.map((t) => {
      const full = t.maxKeys > 0 && (t.keyCount ?? 0) >= t.maxKeys;
      return {
        value: t.symbol,
        label:
          `${t.name} (${t.symbol}) · ratio ${t.ratio} · ` +
          `${t.apiRate > 0 ? `${t.apiRate}/min` : "no rate cap"}` +
          // Show the cap so a full tier is visible before submitting, rather
          // than only as a 409 after the fact.
          (t.maxKeys > 0 ? ` · keys ${t.keyCount ?? 0}/${t.maxKeys}` : "") +
          (full ? " — PENUH" : ""),
      };
    }),
  ];

  const openCreate = () => {
    setEditing(null);
    setForm({ ...BLANK, userGroup: tiers[0]?.symbol || "" });
    setError("");
    setModalOpen(true);
  };

  const openEdit = (k) => {
    setEditing(k);
    setForm({
      name: k.name,
      userGroup: k.userGroup || "",
      balance: String(k.balance ?? 0),
      unlimited: !!k.unlimited,
      isActive: !!k.isActive,
      // A key saved before the allow-list existed reads back as ["*"]; keep
      // that shape so an edit that does not touch models saves no change.
      allowedModels: k.allowedModels?.length ? k.allowedModels : [WILDCARD],
    });
    setError("");
    setModalOpen(true);
  };

  const handleAddModel = (model) => {
    setForm((f) => {
      // Selecting the first specific model drops the wildcard: leaving "*"
      // alongside real ids would make the restriction a no-op.
      const base = isUnrestricted(f.allowedModels) ? [] : f.allowedModels;
      if (base.includes(model.value)) return f;
      return { ...f, allowedModels: [...base, model.value] };
    });
  };

  const handleDeselectModel = (model) => {
    setForm((f) => {
      const next = (f.allowedModels || []).filter((m) => m !== model.value);
      // Emptying the list means "no models", which would lock the key out of
      // everything. Fall back to unrestricted, which is the least surprising
      // state for a key someone is actively editing.
      return { ...f, allowedModels: next.length ? next : [WILDCARD] };
    });
  };

  const save = async () => {
    if (!form.name.trim()) {
      setError("Name is required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        userGroup: form.userGroup || null,
        balance: Number(form.balance) || 0,
        unlimited: form.unlimited,
        isActive: form.isActive,
        allowedModels: form.allowedModels?.length ? form.allowedModels : [WILDCARD],
      };

      const url = editing ? `/api/keys/${editing.id}` : "/api/keys";
      const method = editing ? "PUT" : "POST";
      // The collection route names its create handler POST_handler.
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? { id: editing.id, ...payload } : payload),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || `Request failed (${res.status})`);
        return;
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      setError(e.message || "Network error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (k) => {
    if (!window.confirm(`Delete key "${k.name}"? Usage history is kept but will show as unattributed.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/keys/${k.id}`, { method: "DELETE" });
      if (res.ok) await load();
    } catch (e) {
      console.log("Error deleting key:", e);
    }
  };

  const toggleActive = async (k) => {
    try {
      const res = await fetch(`/api/keys/${k.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: k.id, isActive: !k.isActive }),
      });
      if (res.ok) await load();
    } catch (e) {
      console.log("Error toggling key:", e);
    }
  };

  const topUp = async (k, amount) => {
    try {
      const res = await fetch(`/api/keys/${k.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: k.id, balance: Number(k.balance || 0) + amount }),
      });
      if (res.ok) await load();
    } catch (e) {
      console.log("Error topping up:", e);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  const visible = filterTier ? keys.filter((k) => (k.userGroup || "") === filterTier) : keys;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">API Keys</h1>
          <p className="mt-1 text-sm text-text-muted">
            Each key belongs to a tier. The tier sets the cost ratio and per-minute cap; the
            key&apos;s balance is what gets charged. Unlimited keys are still metered but never
            charged.
          </p>
        </div>
        <Button onClick={openCreate} icon="add">New Key</Button>
      </div>

      {keys.length > 0 && tiers.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-muted">Filter tier:</span>
          <Select
            options={[{ value: "", label: "All tiers" }, ...tierOptions.slice(1)]}
            value={filterTier}
            onChange={(e) => setFilterTier(e.target.value)}
            className="max-w-sm"
          />
        </div>
      )}

      {keys.length === 0 ? (
        <Card>
          <div className="py-10 text-center">
            <p className="text-text-muted">No API keys yet.</p>
            <Button className="mt-4" onClick={openCreate} icon="add">New Key</Button>
          </div>
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <p className="py-6 text-center text-sm text-text-muted">No keys on this tier.</p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {visible.map((k) => {
            const tier = tierBySymbol.get(k.userGroup);
            const showFull = revealed[k.id];
            return (
              <Card key={k.id}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium text-text-primary">{k.name}</h3>
                      {tier ? (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                          {tier.name}
                        </span>
                      ) : k.userGroup ? (
                        // Tier details failed to load, but the key still names
                        // one. Showing "no tier" here would be a lie.
                        <span
                          className="rounded-full bg-warning/10 px-2 py-0.5 text-xs text-warning"
                          title="Tier details could not be loaded — showing the stored name only"
                        >
                          {k.userGroup}
                        </span>
                      ) : (
                        <span className="rounded-full bg-surface-secondary px-2 py-0.5 text-xs text-text-muted">
                          no tier
                        </span>
                      )}
                      {k.unlimited && (
                        <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs text-success">
                          unlimited
                        </span>
                      )}
                      {!k.isActive && (
                        <span className="rounded-full bg-surface-secondary px-2 py-0.5 text-xs text-text-muted">
                          disabled
                        </span>
                      )}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-xs text-text-muted">
                      <span>{showFull ? k.key : maskKey(k.key)}</span>
                      <button
                        onClick={() => setRevealed((r) => ({ ...r, [k.id]: !showFull }))}
                        className="material-symbols-outlined text-sm hover:text-text-primary"
                        title={showFull ? "Hide" : "Reveal"}
                      >
                        {showFull ? "visibility_off" : "visibility"}
                      </button>
                    </div>

                    <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                      <div className="flex gap-1.5">
                        <dt className="text-text-muted">Sisa</dt>
                        <dd className="font-mono text-text-primary">
                          {k.unlimited ? "∞ unlimited" : fmtBalance(k.balance)}
                        </dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt className="text-text-muted">Terpakai</dt>
                        <dd className="font-mono text-text-primary">
                          {fmtBalance(k.lifetimeCharge ?? 0)}
                        </dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt className="text-text-muted">Model</dt>
                        <dd
                          className="font-mono text-text-primary"
                          title={
                            isUnrestricted(k.allowedModels)
                              ? "This key may call any model the router exposes."
                              : k.allowedModels.join("\n")
                          }
                        >
                          {isUnrestricted(k.allowedModels)
                            ? "all"
                            : `${k.allowedModels.length} dipilih`}
                        </dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt className="text-text-muted">Status</dt>
                        <dd
                          className={`font-mono ${
                            !k.unlimited && (k.balance ?? 0) <= 0
                              ? "text-danger"
                              : "text-success"
                          }`}
                        >
                          {!k.isActive
                            ? "nonaktif"
                            : k.unlimited
                              ? "aktif"
                              : (k.balance ?? 0) <= 0
                                ? "habis — request ditolak"
                                : "aktif"}
                        </dd>
                      </div>
                      {!k.unlimited && (
                        <div className="basis-full">
                          <dt className="mb-1 text-text-muted">Sisa kuota</dt>
                          <dd>
                            <QuotaBar
                              balance={k.balance}
                              lifetimeCharge={k.lifetimeCharge}
                              unlimited={k.unlimited}
                            />
                          </dd>
                        </div>
                      )}
                      {tier && (
                        <>
                          <div className="flex gap-1.5">
                            <dt className="text-text-muted">Ratio</dt>
                            <dd className="font-mono text-text-primary">{tier.ratio}</dd>
                          </div>
                          <div className="flex gap-1.5">
                            <dt className="text-text-muted">Rate cap</dt>
                            <dd className="font-mono text-text-primary">
                              {tier.apiRate > 0 ? `${tier.apiRate}/min` : "none"}
                            </dd>
                          </div>
                          {tier.maxKeys > 0 && (
                            <div className="flex gap-1.5">
                              <dt className="text-text-muted">Tier keys</dt>
                              <dd className="font-mono text-text-primary">
                                {tier.keyCount ?? 0}/{tier.maxKeys}
                              </dd>
                            </div>
                          )}
                        </>
                      )}
                    </dl>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {!k.unlimited && (
                      <Button size="sm" icon="add" onClick={() => topUp(k, 100000)}>
                        +100K
                      </Button>
                    )}
                    <Button size="sm" onClick={() => openEdit(k)} icon="edit">
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant={k.isActive ? "ghost" : "primary"}
                      onClick={() => toggleActive(k)}
                    >
                      {k.isActive ? "Disable" : "Enable"}
                    </Button>
                    <Button size="sm" variant="danger" icon="delete" onClick={() => remove(k)}>
                      Delete
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {modalOpen && (
        <Modal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          title={editing ? `Edit key: ${editing.name}` : "New API key"}
        >
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-text-primary">Name</label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. laptop"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-text-primary">Tier</label>
              <Select
                options={tierOptions}
                value={form.userGroup}
                onChange={(e) => setForm({ ...form, userGroup: e.target.value })}
              />
              <p className="mt-1 text-xs text-text-muted">
                Without a tier the key has no cost ratio and no rate cap.
              </p>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-text-primary">
                Balance (internal credits)
              </label>
              <Input
                type="number"
                value={form.balance}
                onChange={(e) => setForm({ ...form, balance: e.target.value })}
                disabled={form.unlimited}
              />
              <p className="mt-1 text-xs text-text-muted">
                Charged as upstream price × tier ratio. Reaching zero blocks the key with 429.
              </p>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-text-primary">
                Allowed models
              </label>
              {isUnrestricted(form.allowedModels) ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border-primary bg-bg-secondary px-3 py-2">
                  <p className="text-xs text-text-muted">
                    All models. This key can call anything the router exposes.
                  </p>
                  <Button variant="ghost" size="sm" onClick={() => setShowModelSelect(true)}>
                    Restrict
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-text-muted">
                      {form.allowedModels.length} model
                      {form.allowedModels.length === 1 ? "" : "s"} allowed. Anything else is
                      refused with 403 before it reaches a provider.
                    </p>
                    <Button variant="ghost" size="sm" onClick={() => setShowModelSelect(true)}>
                      Edit
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {form.allowedModels.map((m) => (
                      <span
                        key={m}
                        className="inline-flex items-center gap-1 rounded-full bg-bg-tertiary px-2.5 py-1 text-xs text-text-primary"
                      >
                        <span className="max-w-[220px] truncate" title={m}>
                          {m}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDeselectModel({ value: m })}
                          className="text-text-muted hover:text-error"
                          aria-label={`Remove ${m}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, allowedModels: [WILDCARD] })}
                    className="text-xs text-text-muted underline hover:text-text-primary"
                  >
                    Allow all models again
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <Toggle
                checked={form.unlimited}
                onChange={(v) => setForm({ ...form, unlimited: v })}
                label="Unlimited"
                description="Never charged and never blocked. Still recorded in usage stats."
              />
              <Toggle
                checked={form.isActive}
                onChange={(v) => setForm({ ...form, isActive: v })}
                label="Active"
                description="A disabled key is rejected before any provider call."
              />
            </div>

            {error && <p className="text-sm text-error">{error}</p>}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button onClick={save} loading={saving}>
                {editing ? "Save" : "Create"}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Sits outside the key Modal on purpose: the picker is itself a modal
          and nesting two overlays hides the list behind the form. */}
      <ModelSelectModal
        isOpen={showModelSelect}
        onClose={() => setShowModelSelect(false)}
        onSelect={handleAddModel}
        onDeselect={handleDeselectModel}
        activeProviders={providers}
        modelAliases={modelAliases}
        title="Allowed models for this key"
        addedModelValues={isUnrestricted(form.allowedModels) ? [] : form.allowedModels}
        closeOnSelect={false}
      />
    </div>
  )
}
