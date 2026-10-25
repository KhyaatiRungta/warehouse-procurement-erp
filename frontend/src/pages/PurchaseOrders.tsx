import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CheckCircle2, Pencil, PackageCheck, Plus, Printer, Send, Undo2, Search } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dateOnly, dateTime, money, qty } from "../lib/format";
import type { Item, POSummary, PurchaseOrder, Supplier, Warehouse } from "../lib/types";
import { LineEditor, lineErrors, newLine, type DraftLine } from "../components/LineEditor";
import { Badge, Button, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Panel, Progress, StatusBadge, useToast } from "../components/ui";

const TABS = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Awaiting approval" },
  { value: "approved", label: "Approved" },
  { value: "sent", label: "Sent" },
  { value: "partially_received", label: "Partly received" },
  { value: "received", label: "Received" },
  { value: "cancelled", label: "Cancelled" },
];

export function PurchaseOrdersPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("status") ?? "";
  const [search, setSearch] = useState(params.get("q") ?? "");
  const navigate = useNavigate();
  const { can } = useAuth();
  const query = useQuery({
    queryKey: ["purchase-orders", tab],
    queryFn: () => api<POSummary[]>(`/purchase-orders${tab ? `?status=${tab}` : ""}`),
    placeholderData: (previous) => previous,
  });
  const rows = (query.data ?? []).filter((po) => {
    const needle = search.trim().toLowerCase();
    return !needle || po.number.toLowerCase().includes(needle) || po.supplier_name.toLowerCase().includes(needle);
  });

  return (
    <>
      <PageHeader
        title="Purchase orders"
        description="Orders sent to suppliers, from draft through to received."
        actions={can("purchase_orders:write") && <Link to="/purchase-orders/new" className="btn btn-primary btn-md"><Plus size={16} /> New purchase order</Link>}
      />
      <div className="toolbar">
        <div className="tabs tabs-inline" role="tablist" aria-label="Order status">
          {TABS.map((t) => (
            <button key={t.value} role="tab" aria-selected={tab === t.value} className={tab === t.value ? "on" : ""} onClick={() => setParams(t.value ? { status: t.value } : {})}>
              {t.label}
            </button>
          ))}
        </div>
        <label className="search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Search orders</span>
          <input className="input" placeholder="Order number or supplier" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
      </div>
      <Panel flush>
        {query.isPending && <Loading rows={7} label="Loading orders" />}
        {query.isError && <ErrorBox error={query.error} onRetry={() => query.refetch()} />}
        {query.data && rows.length === 0 && <Empty title="No orders match" body="Change the status or search, or create a new order." />}
        {query.data && rows.length > 0 && (
          <div className="table-scroll">
            <table className="table table-hover">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Supplier</th>
                  <th>Warehouse</th>
                  <th>Status</th>
                  <th>Expected</th>
                  <th className="num">Lines</th>
                  <th className="num">Received</th>
                  <th className="num">Value</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((po) => (
                  <tr key={po.id} className="clickable" onClick={() => navigate(`/purchase-orders/${po.id}`)}>
                    <td className="mono"><Link to={`/purchase-orders/${po.id}`} className="strong" onClick={(e) => e.stopPropagation()}>{po.number}</Link></td>
                    <td>{po.supplier_name}</td>
                    <td className="mono small">{po.warehouse_code}</td>
                    <td><StatusBadge status={po.status} /></td>
                    <td className="small">{dateOnly(po.expected_date)}</td>
                    <td className="num mono">{po.line_count}</td>
                    <td className="num mono">
                      <div className="cell-progress">
                        <span>{qty(po.units_received)} / {qty(po.units_ordered)}</span>
                        <Progress ordered={po.units_ordered} received={po.units_received} />
                      </div>
                    </td>
                    <td className="num mono">{money(po.total_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

const ACTION_PERMISSION: Record<string, string> = {
  submit: "purchase_orders:write",
  recall: "purchase_orders:write",
  approve: "purchase_orders:approve",
  send: "purchase_orders:write",
  cancel: "purchase_orders:write",
};

export function PurchaseOrderDetailPage() {
  const { id } = useParams();
  const poId = Number(id);
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const query = useQuery({ queryKey: ["purchase-order", poId], queryFn: () => api<PurchaseOrder>(`/purchase-orders/${poId}`) });

  const act = useMutation({
    mutationFn: (action: string) => api<PurchaseOrder>(`/purchase-orders/${poId}/${action}`, { body: {} }),
    onSuccess: (po, action) => {
      queryClient.setQueryData(["purchase-order", poId], po);
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setActionError(null);
      setConfirmCancel(false);
      const done: Record<string, string> = {
        submit: "submitted for approval",
        recall: "recalled to draft",
        approve: "approved",
        send: "sent to the supplier",
        cancel: "cancelled",
      };
      toast(`${po.number} ${done[action] ?? "updated"}`);
    },
    onError: (error) => setActionError(error instanceof ApiError ? error.message : "That action did not go through."),
  });

  if (query.isPending) return <Loading rows={6} label="Loading order" />;
  if (query.isError) return <ErrorBox error={query.error} onRetry={() => query.refetch()} />;
  const po = query.data;

  const available: { action: string; label: string; variant: "primary" | "secondary" | "danger"; icon: ReactNode }[] = [];
  if (po.status === "draft") available.push({ action: "submit", label: "Submit for approval", variant: "primary", icon: <Send size={15} /> });
  if (po.status === "submitted") {
    available.push({ action: "approve", label: "Approve order", variant: "primary", icon: <CheckCircle2 size={15} /> });
    available.push({ action: "recall", label: "Recall to draft", variant: "secondary", icon: <Undo2 size={15} /> });
  }
  if (po.status === "approved") available.push({ action: "send", label: "Mark as sent", variant: "primary", icon: <Send size={15} /> });
  const cancellable = ["draft", "submitted", "approved", "sent"].includes(po.status);

  return (
    <>
      <PageHeader
        title={`${po.number}`}
        description={`${po.supplier.name} · ${po.warehouse_name} · created by ${po.created_by}`}
        actions={
          <div className="no-print action-row">
            <StatusBadge status={po.status} />
            {po.status === "draft" && can("purchase_orders:write") && (
              <Link to={`/purchase-orders/${po.id}/edit`} className="btn btn-secondary btn-md"><Pencil size={15} /> Edit</Link>
            )}
            {available.filter((a) => can(ACTION_PERMISSION[a.action])).map((a) => (
              <Button key={a.action} variant={a.variant} onClick={() => act.mutate(a.action)} disabled={act.isPending}>
                {a.icon} {a.label}
              </Button>
            ))}
            {["sent", "partially_received"].includes(po.status) && can("receipts:write") && (
              <Link to={`/receipts/new?po=${po.id}`} className="btn btn-primary btn-md"><PackageCheck size={15} /> Receive goods</Link>
            )}
            {cancellable && can("purchase_orders:write") && (
              <Button variant="ghost" onClick={() => setConfirmCancel(true)}><Ban size={15} /> Cancel order</Button>
            )}
            <Button onClick={() => window.print()}><Printer size={15} /> Print</Button>
          </div>
        }
      />

      {actionError && <div className="error-box no-print" role="alert"><p>{actionError}</p></div>}

      <article className="print-sheet">
        <header className="print-only print-head">
          <p className="print-title">Purchase order {po.number}</p>
          <p>{po.warehouse_name}, {po.warehouse_location}</p>
        </header>

        <div className="grid-main-side">
          <Panel title="Lines" flush>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="num">Ordered</th>
                    <th className="num">Received</th>
                    <th className="num">Open</th>
                    <th className="num">Unit cost</th>
                    <th className="num">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {po.lines.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <Link to={`/inventory/${l.item_id}`} className="strong">{l.item_name}</Link>
                        <div className="muted small mono">{l.sku} · {l.uom}</div>
                      </td>
                      <td className="num mono">{qty(l.ordered_qty)}</td>
                      <td className="num">
                        <div className="cell-progress right">
                          <span className="mono">{qty(l.received_qty)}</span>
                          <Progress ordered={l.ordered_qty} received={l.received_qty} />
                        </div>
                      </td>
                      <td className={`num mono ${l.open_qty > 0 ? "strong" : "muted"}`}>{qty(l.open_qty)}</td>
                      <td className="num mono">{money(l.unit_cost)}</td>
                      <td className="num mono">{money(l.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5} className="num strong">Order total</td>
                    <td className="num mono strong">{money(po.total_amount)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Panel>

          <div className="stack-col">
            <Panel title="Supplier">
              <p className="strong">{po.supplier.name}</p>
              <p className="muted small mono">{po.supplier.code}</p>
              <dl className="facts compact">
                <dt>Address</dt><dd>{po.supplier.address ?? "None"}</dd>
                <dt>Contact</dt><dd>{po.supplier.email ?? "None"}</dd>
                <dt>Terms</dt><dd>{po.supplier.payment_terms ?? "None"}</dd>
                <dt>Lead time</dt><dd>{po.supplier.lead_time_days} days</dd>
              </dl>
            </Panel>
            <Panel title="Order details">
              <dl className="facts compact">
                <dt>Order date</dt><dd>{dateOnly(po.order_date)}</dd>
                <dt>Expected</dt><dd>{dateOnly(po.expected_date)}</dd>
                <dt>Deliver to</dt><dd>{po.warehouse_code} · {po.warehouse_name}</dd>
                <dt>Requisition</dt><dd>{po.requisition_number ? <Link to={`/requisitions/${po.requisition_id}`} className="mono">{po.requisition_number}</Link> : "None"}</dd>
                <dt>Approved</dt><dd>{po.approved_by ? `${po.approved_by}, ${dateTime(po.approved_at)}` : "Not yet"}</dd>
                <dt>Sent</dt><dd>{dateTime(po.sent_at)}</dd>
                <dt>Notes</dt><dd>{po.notes ?? "None"}</dd>
              </dl>
            </Panel>
            {po.status === "received" && <Badge tone="spruce">Fully received</Badge>}
          </div>
        </div>
      </article>

      <Modal
        open={confirmCancel}
        title={`Cancel ${po.number}?`}
        onClose={() => setConfirmCancel(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmCancel(false)}>Keep order</Button>
            <Button variant="danger" disabled={act.isPending} onClick={() => act.mutate("cancel")}>Cancel order</Button>
          </>
        }
      >
        <p>Cancelled orders stop accepting receipts. Orders with goods already received cannot be cancelled. Use a receipt for what arrived instead.</p>
      </Modal>
    </>
  );
}

export function PurchaseOrderFormPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const items = useQuery({ queryKey: ["items"], queryFn: () => api<Item[]>("/items") });
  const suppliers = useQuery({ queryKey: ["suppliers", "", "active"], queryFn: () => api<Supplier[]>("/suppliers?active=true") });
  const warehouses = useQuery({ queryKey: ["warehouses"], queryFn: () => api<Warehouse[]>("/warehouses") });
  const existing = useQuery({ queryKey: ["purchase-order", Number(id)], queryFn: () => api<PurchaseOrder>(`/purchase-orders/${id}`), enabled: editing });

  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [expected, setExpected] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [lines, setLines] = useState<DraftLine[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const seededLines: DraftLine[] = existing.data
    ? existing.data.lines.map((l) => newLine({ item_id: String(l.item_id), quantity: String(l.ordered_qty), unit_cost: String(l.unit_cost) }))
    : search.get("item")
      ? [newLine({ item_id: search.get("item")!, quantity: search.get("qty") ?? "" })]
      : [newLine()];

  const currentLines = lines ?? seededLines;
  const currentSupplier = supplierId ?? (existing.data ? String(existing.data.supplier_id) : "");
  const currentWarehouse = warehouseId ?? (existing.data ? String(existing.data.warehouse_id) : "");
  const currentExpected = expected ?? existing.data?.expected_date ?? "";
  const currentNotes = notes ?? existing.data?.notes ?? "";

  const save = useMutation({
    mutationFn: (submitAfter: boolean) => {
      const body = {
        supplier_id: Number(currentSupplier),
        warehouse_id: Number(currentWarehouse),
        expected_date: currentExpected || null,
        notes: currentNotes.trim() || null,
        lines: currentLines.map((l) => ({ item_id: Number(l.item_id), quantity: Number(l.quantity), unit_cost: l.unit_cost ? Number(l.unit_cost) : null })),
      };
      return (async () => {
        const saved = editing
          ? await api<PurchaseOrder>(`/purchase-orders/${id}`, { method: "PATCH", body })
          : await api<PurchaseOrder>("/purchase-orders", { body });
        if (submitAfter) return api<PurchaseOrder>(`/purchase-orders/${saved.id}/submit`, { body: {} });
        return saved;
      })();
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      toast(saved.status === "submitted" ? `${saved.number} sent for approval` : `${saved.number} saved as draft`);
      navigate(`/purchase-orders/${saved.id}`);
    },
    onError: (error) => setFormError(error instanceof ApiError ? error.message : "Could not save the order."),
  });

  if (items.isPending || suppliers.isPending || warehouses.isPending || (editing && existing.isPending)) return <Loading rows={6} label="Loading form" />;
  if (items.isError) return <ErrorBox error={items.error} onRetry={() => items.refetch()} />;

  const activeItems = items.data?.filter((i) => i.is_active) ?? [];
  const lineErr = lineErrors(currentLines);

  const submit = (submitAfter: boolean) => (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const next: Record<string, string> = {};
    if (!currentSupplier) next.supplier = "Choose a supplier";
    if (!currentWarehouse) next.warehouse = "Choose the receiving warehouse";
    if (currentLines.every((l) => !l.item_id)) next.lines = "Add at least one line";
    setErrors(next);
    if (Object.keys(next).length || Object.keys(lineErr).length) return;
    save.mutate(submitAfter);
  };

  return (
    <>
      <PageHeader
        title={editing ? `Edit ${existing.data?.number ?? "order"}` : "New purchase order"}
        description="Draft orders can be edited freely. Submitting sends them to an approver."
      />
      <form className="form-card" noValidate onSubmit={submit(false)}>
        <div className="form-grid">
          <Field label="Supplier" error={errors.supplier}>
            {(fid) => (
              <select id={fid} className="input" value={currentSupplier} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">Choose a supplier</option>
                {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
              </select>
            )}
          </Field>
          <Field label="Receiving warehouse" error={errors.warehouse}>
            {(fid) => (
              <select id={fid} className="input" value={currentWarehouse} onChange={(e) => setWarehouseId(e.target.value)}>
                <option value="">Choose a warehouse</option>
                {warehouses.data?.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
              </select>
            )}
          </Field>
          <Field label="Expected delivery">
            {(fid) => <input id={fid} type="date" className="input" value={currentExpected} onChange={(e) => setExpected(e.target.value)} />}
          </Field>
          <Field label="Notes to supplier" wide>
            {(fid) => <input id={fid} className="input" value={currentNotes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
        </div>
        <h2 className="section-title">Lines</h2>
        {errors.lines && <p className="form-error" role="alert">{errors.lines}</p>}
        <LineEditor lines={currentLines} items={activeItems} showCost errors={lineErr} onChange={setLines} />
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <div className="form-actions">
          <Button variant="ghost" onClick={() => navigate(-1)}>Cancel</Button>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving" : "Save draft"}</Button>
          <Button variant="primary" disabled={save.isPending} onClick={(e) => submit(true)(e as unknown as FormEvent)}>Save and submit</Button>
        </div>
      </form>
    </>
  );
}
