import { useState, useEffect } from "react";
import { Card, Button, Modal, Input, Toggle, CardSkeleton } from "@/shared/components";

const BLANK = {
  symbol: "",
  name: "",
  ratio: 1,
  apiRate: 600,
  public: false,
  promotion: false,
  min: 0,
  max: 0,
  // Key-count cap. Separate from min/max above, which are a spend window.
  maxKeys: 0,
  enable: true,
};

export default function UserGroupsPage() {
  const [groups, setGroups] = useState([]);
  const [orphans, setOrphans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const res = await fetch("/api/user-groups");
      const data = await res.json();
      if (res.ok) {
        setGroups(data.groups || []);
        setOrphans(data.orphanedGroups || []);
      }
    } catch (e) {
      console.log("Error fetching user groups:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openCreate = () => {
    setEditing(null);
    setForm(BLANK);
    setError("");
    setModalOpen(true);
  };

  const openEdit = (g) => {
    setEditing(g);
    setForm({
      symbol: g.symbol,
      name: g.name,
      ratio: g.ratio,
      apiRate: g.apiRate,
      public: g.public,
      promotion: g.promotion,
      min: g.min,
      max: g.max,
      maxKeys: g.maxKeys,
      enable: g.enable,
    });
    setError("");
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.symbol.trim()) {
      setError("Symbol wajib diisi");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/user-groups", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        await load();
        setModalOpen(false);
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.error || "Gagal menyimpan tier");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (symbol) => {
    if (!window.confirm(`Hapus tier "${symbol}"?`)) return;
    try {
      const res = await fetch(`/api/user-groups?symbol=${encodeURIComponent(symbol)}`, {
        method: "DELETE",
      });
      if (res.ok) await load();
    } catch (e) {
      console.log("Error deleting:", e);
    }
  };

  const toggleFlag = async (g, field) => {
    try {
      const res = await fetch("/api/user-groups", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...g, [field]: !g[field] }),
      });
      if (res.ok) await load();
    } catch (e) {
      console.log("Error toggling:", e);
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">User Tiers</h1>
          <p className="mt-1 text-sm text-text-muted">
            Rasio biaya dan batas request per menit untuk tiap level pengguna.
            Kosongkan daftar ini untuk menonaktifkan enforcement.
          </p>
        </div>
        <Button onClick={openCreate} icon="add">Add Tier</Button>
      </div>

      {orphans.length > 0 && (
        <Card>
          <div className="flex items-start gap-2 text-sm text-text-muted">
            <span className="material-symbols-outlined text-lg text-error">warning</span>
            <div>
              <strong className="text-text-primary">
                {orphans.length} key(s) point at a tier that no longer exists
              </strong>
              <p className="mt-1">
                {orphans.join(", ")} — those keys are still charged, but at ratio 1 with no
                requests-per-minute cap. Reassign them on the API Keys page, or recreate the
                tier.
              </p>
            </div>
          </div>
        </Card>
      )}

      {groups.length === 0 ? (
        <Card>
          <div className="py-10 text-center">
            <p className="text-text-muted">Belum ada tier.</p>
            <p className="mt-1 text-sm text-text-muted">
              Tanpa tier, quota enforcement dimatikan dan semua key behave seperti sekarang.
            </p>
            <Button className="mt-4" onClick={openCreate} icon="add">Add Tier</Button>
          </div>
        </Card>
      ) : (
        <div className="grid gap-3">
          {groups.map((g) => (
            <Card key={g.symbol}>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium text-text-primary">{g.name}</h3>
                    <code className="rounded bg-surface-secondary px-1.5 py-0.5 text-xs text-text-muted">
                      {g.symbol}
                    </code>
                    {!g.enable && (
                      <span className="rounded-full bg-surface-secondary px-2 py-0.5 text-xs text-text-muted">
                        disabled
                      </span>
                    )}
                    {g.public && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                        public
                      </span>
                    )}
                    {g.promotion && (
                      <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs text-success">
                        auto-upgrade
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-4 text-sm text-text-muted">
                    <span>ratio <b className="text-text-primary">{g.ratio}x</b></span>
                    <span>rate <b className="text-text-primary">{g.apiRate || "∞"}</b> req/menit</span>
                    <span>
                      keys <b className="text-text-primary">{g.keyCount ?? 0}</b>
                      {g.maxKeys ? `/${g.maxKeys}` : ""}
                      {g.maxKeys && (g.keyCount ?? 0) >= g.maxKeys && (
                        <span className="ml-1 text-danger">penuh</span>
                      )}
                    </span>
                    {g.promotion && (
                      <span>naik saat total <b className="text-text-primary">{g.min}</b>
                        {g.max ? `–${g.max}` : "+"}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" icon="edit" onClick={() => openEdit(g)}>Edit</Button>
                  <Button size="sm" color="danger" icon="delete" onClick={() => remove(g.symbol)}>Delete</Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit Tier — ${editing.symbol}` : "Add Tier"}
        size="lg"
      >
        <div className="space-y-4">
          {error && (
            <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}

          <Input
            label="Symbol"
            value={form.symbol}
            disabled={!!editing}
            onChange={(e) => setForm({ ...form, symbol: e.target.value })}
            placeholder="free, pro, elite"
            hint="Dipakai oleh apiKeys.userGroup. Unik, tidak bisa diubah setelah dibuat."
          />

          <Input
            label="Display name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Free Tier"
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Ratio"
              type="number"
              step="0.1"
              min="0"
              value={form.ratio}
              onChange={(e) => setForm({ ...form, ratio: Number(e.target.value) })}
              hint="Pengali biaya. 1 = harga normal, 0.5 = setengah, 2 = dobel."
            />
            <Input
              label="Rate limit (req/menit)"
              type="number"
              min="0"
              value={form.apiRate}
              onChange={(e) => setForm({ ...form, apiRate: Number(e.target.value) })}
              hint="0 = tanpa batas."
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Min (total pemakaian)"
              hint="Tier ini aktif mulai total tagihan kumulatif ini. 0 = dari awal."
              type="number"
              value={form.min}
              onChange={(e) => setForm({ ...form, min: Number(e.target.value) })}
            />
            <Input
              label="Max (total pemakaian)"
              hint="Batas atas rentang. 0 = tanpa batas atas."
              type="number"
              value={form.max}
              onChange={(e) => setForm({ ...form, max: Number(e.target.value) })}
            />
          </div>

          <Input
            label="Max Keys (batas jumlah key)"
            hint="Jumlah key aktif maksimum di tier ini. 0 = tanpa batas. Berbeda dari Min/Max di atas yang memakai total pemakaian."
            type="number"
            value={form.maxKeys}
            onChange={(e) => setForm({ ...form, maxKeys: Number(e.target.value) })}
          />

          <div className="space-y-3 rounded-md border border-border p-3">
            <Toggle
              label="Public"
              description="Tier ini boleh dipilih user saat membuat key."
              checked={form.public}
              onChange={(v) => setForm({ ...form, public: v })}
            />
            <Toggle
              label="Auto-upgrade"
              description="Naikkan user ke tier ini otomatis saat total pemakaiannya masuk rentang min–max."
              checked={form.promotion}
              onChange={(v) => setForm({ ...form, promotion: v })}
            />
            <Toggle
              label="Enabled"
              description="Tier nonaktif diabaikan saat enforcement."
              checked={form.enable}
              onChange={(v) => setForm({ ...form, enable: v })}
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button color="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
