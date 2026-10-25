import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Search } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dateTime, MOVEMENT_LABEL, money, qty, signed } from "../lib/format";
import type { Item, Movement, Supplier, Warehouse } from "../lib/types";
import { Button, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Panel, Badge, useToast } from "../components/ui";

type StatusFilter = "all" | "low" | "ok" | "inactive";

export function InventoryPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [creating, setCreating] = useState(false);

  const params = new URLSearchParams();
  if (search.trim()) params.set("q", search.trim());
  if (category) params.set("category", category);
  if (status !== "all") params.set("status", status);

  const items = useQuery({
    queryKey: ["items", search.trim(), category, status],
    queryFn: () => api<Item[]>(`/items?${params.toString()}`),
    placeholderData: (previous) => previous,
  });
  const categories = useQuery({ queryKey: ["item-categories"], queryFn: () => api<string[]>("/items/categories") });
  const warehouses = useQuery({ queryKey: ["warehouses"], queryFn: () => api<Warehouse[]>("/warehouses") });

  return (
    <>
      <PageHeader
        title="Items and stock"
        description="On-hand quantity by warehouse, reorder points and stock already on order."
        actions={can("items:write") && <Button variant="primary" onClick={() => setCreating(true)}><Plus size={16} /> New item</Button>}
      />
      <div className="toolbar">
        <label className="search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Search items</span>
          <input className="input" placeholder="Search by SKU, name or description" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <label className="select-inline">
          <span>Category</span>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {categories.data?.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <div className="segmented" role="group" aria-label="Filter by stock status">
          {(["all", "low", "ok", "inactive"] as StatusFilter[]).map((value) => (
            <button key={value} type="button" className={status === value ? "on" : ""} aria-pressed={status === value} onClick={() => setStatus(value)}>
              {{ all: "All", low: "Low stock", ok: "In stock", inactive: "Inactive" }[value]}
            </button>
          ))}
        </div>
      </div>

      <Panel flush>
        {(items.isPending || warehouses.isPending) && <Loading rows={8} label="Loading items" />}
        {items.isError && <ErrorBox error={items.error} onRetry={() => items.refetch()} />}
        {items.data && items.data.length === 0 && (
          <Empty title="No items match these filters" body="Clear the filters or add a new item." />
        )}
        {items.data && items.data.length > 0 && warehouses.data && (
          <div className="table-scroll">
            <table className="table table-hover table-dense">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Item</th>
                  <th>UoM</th>
                  {warehouses.data.map((w) => (
                    <th key={w.id} className="num" title={w.name}>{w.code}</th>
                  ))}
                  <th className="num">Total</th>
                  <th className="num">Reorder at</th>
                  <th className="num">On order</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {items.data.map((item) => (
                  <tr key={item.id} className="clickable" onClick={() => navigate(`/inventory/${item.id}`)}>
                    <td className="mono">{item.sku}</td>
                    <td>
                      <Link to={`/inventory/${item.id}`} className="strong" onClick={(e) => e.stopPropagation()}>{item.name}</Link>
                      <div className="muted small">{item.category}</div>
                    </td>
                    <td className="mono small">{item.uom}</td>
                    {warehouses.data.map((w) => {
                      const cell = item.stock.find((s) => s.warehouse_id === w.id);
                      return <td key={w.id} className="num mono">{cell ? qty(cell.on_hand) : "0"}</td>;
                    })}
                    <td className={`num mono strong ${item.is_low ? "alert-text" : ""}`}>{qty(item.total_on_hand)}</td>
                    <td className="num mono">{item.reorder_point ? qty(item.reorder_point) : "None"}</td>
                    <td className="num mono">{item.on_order ? qty(item.on_order) : "0"}</td>
                    <td>
                      {!item.is_active ? <Badge tone="neutral">Inactive</Badge> : item.is_low ? <Badge tone="amber">Low stock</Badge> : <Badge tone="spruce">In stock</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {creating && <ItemModal onClose={() => setCreating(false)} onSaved={(id) => navigate(`/inventory/${id}`)} />}
    </>
  );
}

export function ItemDetailPage() {
  const { id } = useParams();
  const itemId = Number(id);
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const item = useQuery({ queryKey: ["item", itemId], queryFn: () => api<Item>(`/items/${itemId}`) });
  const movements = useQuery({
    queryKey: ["movements", itemId],
    queryFn: () => api<Movement[]>(`/inventory/movements?item_id=${itemId}&limit=300`),
  });
  const warehouses = useQuery({ queryKey: ["warehouses"], queryFn: () => api<Warehouse[]>("/warehouses") });

  if (item.isPending) return <Loading rows={6} label="Loading item" />;
  if (item.isError) return <ErrorBox error={item.error} onRetry={() => item.refetch()} />;
  const it = item.data;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["item", itemId] });
    queryClient.invalidateQueries({ queryKey: ["movements", itemId] });
    queryClient.invalidateQueries({ queryKey: ["items"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["alerts"] });
  };

  return (
    <>
      <PageHeader
        title={it.name}
        description={`${it.sku} · ${it.category} · unit of measure ${it.uom}`}
        actions={
          <>
            {it.is_low && <Link to="/alerts" className="btn btn-secondary btn-md">View reorder alerts</Link>}
            {can("items:write") && <Button onClick={() => setEditing(true)}><Pencil size={15} /> Edit item</Button>}
          </>
        }
      />

      <div className="stock-cards">
        <div className={`stock-card ${it.is_low ? "is-low" : ""}`}>
          <span className="kpi-label">Total on hand</span>
          <span className="kpi-value">{qty(it.total_on_hand)} <span className="unit">{it.uom}</span></span>
          <span className="kpi-hint">
            Reorder at {qty(it.reorder_point)} · reorder qty {qty(it.reorder_quantity)} · {qty(it.on_order)} on order
          </span>
        </div>
        {it.stock.map((s) => (
          <div key={s.warehouse_id} className="stock-card">
            <span className="kpi-label">{s.warehouse_code}</span>
            <span className="kpi-value">{qty(s.on_hand)}</span>
            <span className="kpi-hint">{warehouses.data?.find((w) => w.id === s.warehouse_id)?.name ?? ""}</span>
          </div>
        ))}
        <div className="stock-card">
          <span className="kpi-label">Unit cost</span>
          <span className="kpi-value">{money(it.unit_cost)}</span>
          <span className="kpi-hint">Preferred supplier: {it.preferred_supplier_name ?? "None"}</span>
        </div>
      </div>

      <div className="grid-main-side">
        <Panel title="Stock ledger" flush>
          {movements.isPending && <Loading rows={6} label="Loading movements" />}
          {movements.isError && <ErrorBox error={movements.error} onRetry={() => movements.refetch()} />}
          {movements.data && movements.data.length === 0 && <Empty title="No stock movements yet" body="Receipts and adjustments will appear here." />}
          {movements.data && movements.data.length > 0 && (
            <div className="table-scroll">
              <table className="table table-dense ledger">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Type</th>
                    <th>Reference</th>
                    <th>Warehouse</th>
                    <th className="num">Change</th>
                    <th className="num">Balance</th>
                    <th>By</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.data.map((m) => (
                    <tr key={m.id}>
                      <td className="small">{dateTime(m.created_at)}</td>
                      <td><span className={`type type-${m.movement_type.toLowerCase()}`}>{MOVEMENT_LABEL[m.movement_type]}</span></td>
                      <td className="mono small">{m.reference}</td>
                      <td className="mono small">{m.warehouse_code}</td>
                      <td className={`num mono ${m.quantity < 0 ? "neg" : "pos"}`}>{signed(m.quantity)}</td>
                      <td className="num mono strong">{qty(m.balance_after)}</td>
                      <td className="small">
                        {m.created_by ?? "System"}
                        {m.note && <div className="muted small">{m.note}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {can("inventory:write") ? (
          <MovementForm itemId={itemId} warehouses={warehouses.data ?? []} onPosted={(msg) => { toast(msg); refresh(); }} />
        ) : (
          <Panel title="Post a stock adjustment">
            <p className="muted">Your role can view stock but cannot post adjustments or issues. Warehouse clerks and admins can.</p>
          </Panel>
        )}
      </div>

      {editing && <ItemModal item={it} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); refresh(); toast("Item saved"); }} />}
    </>
  );
}

function MovementForm({ itemId, warehouses, onPosted }: { itemId: number; warehouses: Warehouse[]; onPosted: (message: string) => void }) {
  const [warehouseId, setWarehouseId] = useState("");
  const [type, setType] = useState<"ADJUSTMENT" | "ISSUE">("ISSUE");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const post = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<Movement>("/inventory/movements", { body }),
    onSuccess: (m) => {
      setQuantity("");
      setNote("");
      setErrors({});
      onPosted(`${m.reference} posted. Balance is now ${qty(m.balance_after)}.`);
    },
    onError: (error) => setFormError(error instanceof ApiError ? error.message : "Could not post the movement."),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const next: Record<string, string> = {};
    if (!warehouseId) next.warehouse = "Choose a warehouse";
    if (!/^\d+$/.test(quantity) || Number(quantity) === 0) next.quantity = type === "ISSUE" ? "Enter a quantity above zero" : "Enter a whole number, not zero";
    if (note.trim().length < 3) next.note = "Say why, for example “cycle count” or “damaged pallet”";
    setErrors(next);
    if (Object.keys(next).length) return;
    post.mutate({ item_id: itemId, warehouse_id: Number(warehouseId), movement_type: type, quantity: Number(quantity), note: note.trim() });
  };

  return (
    <Panel title="Post a stock movement">
      <form onSubmit={submit} noValidate className="stack">
        <div className="segmented full" role="group" aria-label="Movement type">
          <button type="button" className={type === "ISSUE" ? "on" : ""} aria-pressed={type === "ISSUE"} onClick={() => setType("ISSUE")}>Issue out</button>
          <button type="button" className={type === "ADJUSTMENT" ? "on" : ""} aria-pressed={type === "ADJUSTMENT"} onClick={() => setType("ADJUSTMENT")}>Adjustment</button>
        </div>
        <Field label="Warehouse" error={errors.warehouse}>
          {(id) => (
            <select id={id} className="input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">Choose a warehouse</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
            </select>
          )}
        </Field>
        <Field
          label={type === "ISSUE" ? "Quantity to issue" : "Change (negative to reduce)"}
          error={errors.quantity}
          hint={type === "ISSUE" ? "Issues cannot take a warehouse below zero" : "Use a negative number to write stock down"}
        >
          {(id) => (
            <input id={id} className="input input-num" inputMode={type === "ISSUE" ? "numeric" : "text"} value={quantity} onChange={(e) => setQuantity(e.target.value.replace(type === "ISSUE" ? /[^\d]/g : /[^\d-]/g, ""))} />
          )}
        </Field>
        <Field label="Reason" error={errors.note}>
          {(id) => <input id={id} className="input" value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <Button variant="primary" type="submit" disabled={post.isPending}>{post.isPending ? "Posting" : "Post movement"}</Button>
      </form>
    </Panel>
  );
}

function ItemModal({ item, onClose, onSaved }: { item?: Item; onClose: () => void; onSaved: (id: number) => void }) {
  const editing = Boolean(item);
  const queryClient = useQueryClient();
  const suppliers = useQuery({ queryKey: ["suppliers", "", "active"], queryFn: () => api<Supplier[]>("/suppliers?active=true") });
  const categories = useQuery({ queryKey: ["item-categories"], queryFn: () => api<string[]>("/items/categories") });
  const [form, setForm] = useState({
    sku: item?.sku ?? "",
    name: item?.name ?? "",
    category: item?.category ?? "",
    uom: item?.uom ?? "EA",
    reorder_point: String(item?.reorder_point ?? 0),
    reorder_quantity: String(item?.reorder_quantity ?? 0),
    unit_cost: String(item?.unit_cost ?? "0"),
    preferred_supplier_id: item?.preferred_supplier_id ? String(item.preferred_supplier_id) : "",
    description: item?.description ?? "",
    is_active: item?.is_active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editing ? api<Item>(`/items/${item!.id}`, { method: "PATCH", body }) : api<Item>("/items", { body }),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["items"] });
      onSaved(saved.id);
    },
    onError: (error) => setFormError(error instanceof ApiError ? error.message : "Could not save the item."),
  });

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const next: Record<string, string> = {};
    if (!editing && !/^[A-Za-z0-9-_./]{2,40}$/.test(form.sku.trim())) next.sku = "Use 2 to 40 letters, digits, hyphens or dots";
    if (form.name.trim().length < 2) next.name = "Enter an item name";
    if (form.category.trim().length < 2) next.category = "Choose or type a category";
    if (!/^\d+$/.test(form.reorder_point)) next.reorder_point = "Whole number, zero for no alert";
    if (!/^\d+$/.test(form.reorder_quantity)) next.reorder_quantity = "Whole number";
    if (Number.isNaN(Number(form.unit_cost)) || Number(form.unit_cost) < 0) next.unit_cost = "Enter a price of zero or more";
    setErrors(next);
    if (Object.keys(next).length) return;
    const body: Record<string, unknown> = {
      name: form.name.trim(),
      category: form.category.trim(),
      uom: form.uom.trim() || "EA",
      reorder_point: Number(form.reorder_point),
      reorder_quantity: Number(form.reorder_quantity),
      unit_cost: Number(form.unit_cost),
      preferred_supplier_id: form.preferred_supplier_id ? Number(form.preferred_supplier_id) : null,
      description: form.description.trim() || null,
      is_active: form.is_active,
    };
    if (!editing) body.sku = form.sku.trim().toUpperCase();
    save.mutate(body);
  };

  return (
    <Modal
      open
      title={editing ? `Edit ${item!.sku}` : "New item"}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="item-form" disabled={save.isPending}>{save.isPending ? "Saving" : "Save item"}</Button>
        </>
      }
    >
      <form id="item-form" onSubmit={submit} noValidate className="form-grid form-grid-tight">
        <Field label="SKU" error={errors.sku} hint={editing ? "SKUs cannot change" : undefined}>
          {(id) => <input id={id} className="input mono" value={form.sku} disabled={editing} onChange={(e) => set({ sku: e.target.value })} />}
        </Field>
        <Field label="Name" error={errors.name}>
          {(id) => <input id={id} className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} />}
        </Field>
        <Field label="Category" error={errors.category}>
          {(id) => (
            <>
              <input id={id} className="input" list={`${id}-cats`} value={form.category} onChange={(e) => set({ category: e.target.value })} />
              <datalist id={`${id}-cats`}>{categories.data?.map((c) => <option key={c} value={c} />)}</datalist>
            </>
          )}
        </Field>
        <Field label="Unit of measure">
          {(id) => <input id={id} className="input" value={form.uom} onChange={(e) => set({ uom: e.target.value })} />}
        </Field>
        <Field label="Reorder point" error={errors.reorder_point} hint="Alert when on hand is at or below this">
          {(id) => <input id={id} className="input input-num" inputMode="numeric" value={form.reorder_point} onChange={(e) => set({ reorder_point: e.target.value.replace(/\D/g, "") })} />}
        </Field>
        <Field label="Reorder quantity" error={errors.reorder_quantity} hint="Usual order size">
          {(id) => <input id={id} className="input input-num" inputMode="numeric" value={form.reorder_quantity} onChange={(e) => set({ reorder_quantity: e.target.value.replace(/\D/g, "") })} />}
        </Field>
        <Field label="Unit cost (GBP)" error={errors.unit_cost}>
          {(id) => <input id={id} className="input input-num" inputMode="decimal" value={form.unit_cost} onChange={(e) => set({ unit_cost: e.target.value })} />}
        </Field>
        <Field label="Preferred supplier">
          {(id) => (
            <select id={id} className="input" value={form.preferred_supplier_id} onChange={(e) => set({ preferred_supplier_id: e.target.value })}>
              <option value="">None</option>
              {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
        </Field>
        <Field label="Description" wide>
          {(id) => <textarea id={id} className="input" rows={2} value={form.description} onChange={(e) => set({ description: e.target.value })} />}
        </Field>
        {editing && (
          <Field label="Status" wide>
            {(id) => (
              <label htmlFor={id} className="check">
                <input id={id} type="checkbox" checked={form.is_active} onChange={(e) => set({ is_active: e.target.checked })} />
                <span>Active. Inactive items cannot be added to new orders.</span>
              </label>
            )}
          </Field>
        )}
        {formError && <p className="form-error wide" role="alert">{formError}</p>}
      </form>
    </Modal>
  );
}
