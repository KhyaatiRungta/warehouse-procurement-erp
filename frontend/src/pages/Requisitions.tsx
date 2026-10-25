import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Pencil, Plus, Send, XCircle, ArrowRightLeft } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dateOnly, money, qty } from "../lib/format";
import type { Item, Requisition, Supplier, Warehouse } from "../lib/types";
import { LineEditor, lineErrors, newLine, type DraftLine } from "../components/LineEditor";
import {
  Button,
  Empty,
  ErrorBox,
  Field,
  Loading,
  Modal,
  PageHeader,
  Panel,
  StatusBadge,
  useToast,
} from "../components/ui";

const TABS = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Awaiting approval" },
  { value: "approved", label: "Approved" },
  { value: "converted", label: "Converted" },
  { value: "rejected", label: "Rejected" },
];

export function RequisitionsPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState("");
  const query = useQuery({
    queryKey: ["requisitions", tab],
    queryFn: () => api<Requisition[]>(`/requisitions${tab ? `?status=${tab}` : ""}`),
    placeholderData: (previous) => previous,
  });
  const navigate = useNavigate();

  return (
    <>
      <PageHeader
        title="Requisitions"
        description="Internal requests for stock or services. Approved requests convert into purchase orders."
        actions={can("requisitions:write") && <Link to="/requisitions/new" className="btn btn-primary btn-md"><Plus size={16} /> New requisition</Link>}
      />
      <div className="tabs" role="tablist" aria-label="Requisition status">
        {TABS.map((t) => (
          <button key={t.value} role="tab" aria-selected={tab === t.value} className={tab === t.value ? "on" : ""} onClick={() => setTab(t.value)}>
            {t.label}
          </button>
        ))}
      </div>
      <Panel flush>
        {query.isPending && <Loading rows={6} label="Loading requisitions" />}
        {query.isError && <ErrorBox error={query.error} onRetry={() => query.refetch()} />}
        {query.data && query.data.length === 0 && (
          <Empty title="No requisitions here" body={tab ? "Nothing is in this state right now." : "Raise one when a team needs stock or services."} />
        )}
        {query.data && query.data.length > 0 && (
          <div className="table-scroll">
            <table className="table table-hover">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Title</th>
                  <th>Requester</th>
                  <th>Status</th>
                  <th>Needed by</th>
                  <th className="num">Estimate</th>
                  <th>Purchase order</th>
                </tr>
              </thead>
              <tbody>
                {query.data.map((r) => (
                  <tr key={r.id} className="clickable" onClick={() => navigate(`/requisitions/${r.id}`)}>
                    <td className="mono"><Link to={`/requisitions/${r.id}`} className="strong" onClick={(e) => e.stopPropagation()}>{r.number}</Link></td>
                    <td>{r.title}<div className="muted small">{r.lines.length} lines</div></td>
                    <td>{r.requester}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td className="small">{dateOnly(r.needed_by)}</td>
                    <td className="num mono">{money(r.total_estimate)}</td>
                    <td className="mono small">{r.purchase_order_number ?? "None"}</td>
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

export function RequisitionDetailPage() {
  const { id } = useParams();
  const reqId = Number(id);
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [converting, setConverting] = useState(false);
  const [note, setNote] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const req = useQuery({ queryKey: ["requisition", reqId], queryFn: () => api<Requisition>(`/requisitions/${reqId}`) });

  const act = useMutation({
    mutationFn: ({ action, body }: { action: "submit" | "approve" | "reject"; body?: unknown }) =>
      api<Requisition>(`/requisitions/${reqId}/${action}`, { body: body ?? {} }),
    onSuccess: (updated, vars) => {
      queryClient.invalidateQueries({ queryKey: ["requisitions"] });
      queryClient.setQueryData(["requisition", reqId], updated);
      setDecision(null);
      setNote("");
      setActionError(null);
      const verb = { submit: "submitted for approval", approve: "approved", reject: "rejected" }[vars.action];
      toast(`${updated.number} ${verb}`);
    },
    onError: (error) => setActionError(error instanceof ApiError ? error.message : "That action did not go through."),
  });

  if (req.isPending) return <Loading rows={6} label="Loading requisition" />;
  if (req.isError) return <ErrorBox error={req.error} onRetry={() => req.refetch()} />;
  const r = req.data;
  const decider = can("requisitions:decide");

  return (
    <>
      <PageHeader
        title={r.title}
        description={`${r.number} · requested by ${r.requester}${r.needed_by ? ` · needed ${dateOnly(r.needed_by)}` : ""}`}
        actions={
          <>
            {r.status === "draft" && can("requisitions:write") && (
              <Link to={`/requisitions/${r.id}/edit`} className="btn btn-secondary btn-md"><Pencil size={15} /> Edit</Link>
            )}
            {r.status === "draft" && can("requisitions:write") && (
              <Button variant="primary" onClick={() => act.mutate({ action: "submit" })} disabled={act.isPending}><Send size={15} /> Submit for approval</Button>
            )}
            {r.status === "submitted" && decider && (
              <>
                <Button variant="danger" onClick={() => { setDecision("reject"); setNote(""); }}><XCircle size={15} /> Reject</Button>
                <Button variant="primary" onClick={() => { setDecision("approve"); setNote(""); }}><CheckCircle2 size={15} /> Approve</Button>
              </>
            )}
            {r.status === "approved" && decider && (
              <Button variant="primary" onClick={() => setConverting(true)}><ArrowRightLeft size={15} /> Convert to purchase order</Button>
            )}
            {r.purchase_order_number && (
              <Link to={`/purchase-orders?q=${r.purchase_order_number}`} className="btn btn-secondary btn-md">Open {r.purchase_order_number}</Link>
            )}
          </>
        }
      />

      {actionError && <div className="error-box" role="alert"><p>{actionError}</p></div>}

      <div className="grid-main-side">
        <Panel title="Lines" flush>
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Quantity</th>
                <th className="num">Est. unit cost</th>
                <th className="num">Estimate</th>
              </tr>
            </thead>
            <tbody>
              {r.lines.map((l) => (
                <tr key={l.id}>
                  <td>
                    <Link to={`/inventory/${l.item_id}`} className="strong">{l.item_name}</Link>
                    <div className="muted small mono">{l.sku}</div>
                  </td>
                  <td className="num mono">{qty(l.quantity)} {l.uom}</td>
                  <td className="num mono">{money(l.estimated_unit_cost)}</td>
                  <td className="num mono">{money(l.line_total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="num strong">Estimated total</td>
                <td className="num mono strong">{money(r.total_estimate)}</td>
              </tr>
            </tfoot>
          </table>
        </Panel>

        <Panel title="Status">
          <dl className="facts">
            <dt>Status</dt><dd><StatusBadge status={r.status} /></dd>
            <dt>Notes</dt><dd>{r.notes ?? "None"}</dd>
            <dt>Raised</dt><dd>{dateOnly(r.created_at.slice(0, 10))}</dd>
            <dt>Decided by</dt><dd>{r.decided_by ?? "Not decided"}</dd>
            <dt>Decision note</dt><dd>{r.decision_note ?? "None"}</dd>
            <dt>Purchase order</dt><dd>{r.purchase_order_number ? <Link to="/purchase-orders" className="mono">{r.purchase_order_number}</Link> : "Not converted"}</dd>
          </dl>
          {r.status === "submitted" && !decider && <p className="muted small note-line">Waiting for a buyer or admin to decide.</p>}
          {r.status === "draft" && <p className="muted small note-line">Drafts can be edited. Submitting locks the lines until a decision is made.</p>}
        </Panel>
      </div>

      <Modal
        open={decision !== null}
        title={decision === "approve" ? `Approve ${r.number}` : `Reject ${r.number}`}
        onClose={() => setDecision(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDecision(null)}>Cancel</Button>
            <Button
              variant={decision === "approve" ? "primary" : "danger"}
              disabled={act.isPending}
              onClick={() => decision && act.mutate({ action: decision, body: { note: note.trim() || null } })}
            >
              {decision === "approve" ? "Approve requisition" : "Reject requisition"}
            </Button>
          </>
        }
      >
        <Field label={decision === "reject" ? "Reason for the requester" : "Note (optional)"} hint="Shown on the requisition's status">
          {(id) => <textarea id={id} className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
      </Modal>

      {converting && (
        <ConvertModal requisition={r} onClose={() => setConverting(false)} onConverted={(poId) => { setConverting(false); queryClient.invalidateQueries({ queryKey: ["requisitions"] }); navigate(`/purchase-orders/${poId}`); }} />
      )}
    </>
  );
}

function ConvertModal({ requisition, onClose, onConverted }: { requisition: Requisition; onClose: () => void; onConverted: (poId: number) => void }) {
  const suppliers = useQuery({ queryKey: ["suppliers", "", "active"], queryFn: () => api<Supplier[]>("/suppliers?active=true") });
  const warehouses = useQuery({ queryKey: ["warehouses"], queryFn: () => api<Warehouse[]>("/warehouses") });
  const [supplierId, setSupplierId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [expected, setExpected] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const convert = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<{ purchase_order_id: number }>(`/requisitions/${requisition.id}/convert`, { body }),
    onSuccess: (result) => onConverted(result.purchase_order_id),
    onError: (error) => setFormError(error instanceof ApiError ? error.message : "Conversion failed."),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const next: Record<string, string> = {};
    if (!supplierId) next.supplier = "Choose the supplier for this order";
    if (!warehouseId) next.warehouse = "Choose the receiving warehouse";
    if (expected && expected < new Date().toISOString().slice(0, 10)) next.expected = "Expected date is in the past";
    setErrors(next);
    if (Object.keys(next).length) return;
    convert.mutate({
      supplier_id: Number(supplierId),
      warehouse_id: Number(warehouseId),
      expected_date: expected || null,
      notes: notes.trim() || null,
    });
  };

  return (
    <Modal
      open
      title={`Convert ${requisition.number} to a purchase order`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="convert-form" disabled={convert.isPending}>{convert.isPending ? "Creating order" : "Create draft order"}</Button>
        </>
      }
    >
      <form id="convert-form" onSubmit={submit} noValidate className="stack">
        <p className="muted">Creates a draft with {requisition.lines.length} lines. Prices come from the requisition estimates, or the item's unit cost where no estimate was given.</p>
        <Field label="Supplier" error={errors.supplier}>
          {(id) => (
            <select id={id} className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Choose a supplier</option>
              {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
            </select>
          )}
        </Field>
        <Field label="Receiving warehouse" error={errors.warehouse}>
          {(id) => (
            <select id={id} className="input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">Choose a warehouse</option>
              {warehouses.data?.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
            </select>
          )}
        </Field>
        <Field label="Expected delivery" error={errors.expected}>
          {(id) => <input id={id} type="date" className="input" value={expected} onChange={(e) => setExpected(e.target.value)} />}
        </Field>
        <Field label="Notes to supplier">
          {(id) => <textarea id={id} className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
        {formError && <p className="form-error" role="alert">{formError}</p>}
      </form>
    </Modal>
  );
}

export function RequisitionFormPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const items = useQuery({ queryKey: ["items"], queryFn: () => api<Item[]>("/items") });
  const existing = useQuery({ queryKey: ["requisition", Number(id)], queryFn: () => api<Requisition>(`/requisitions/${id}`), enabled: editing });

  const [title, setTitle] = useState<string | null>(null);
  const [neededBy, setNeededBy] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [lines, setLines] = useState<DraftLine[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  // Prefill from a reorder alert: /requisitions/new?item=12&qty=40
  const prefill = useMemo<DraftLine[] | null>(() => {
    const item = search.get("item");
    return item ? [newLine({ item_id: item, quantity: search.get("qty") ?? "" })] : null;
  }, [search]);

  const currentTitle = title ?? existing.data?.title ?? (editing ? "" : "");
  const currentNeeded = neededBy ?? existing.data?.needed_by ?? "";
  const currentNotes = notes ?? existing.data?.notes ?? "";
  const currentLines: DraftLine[] =
    lines ??
    (existing.data
      ? existing.data.lines.map((l) => newLine({ item_id: String(l.item_id), quantity: String(l.quantity), unit_cost: String(l.estimated_unit_cost) }))
      : prefill ?? [newLine()]);

  const save = useMutation({
    mutationFn: async ({ submitAfter }: { submitAfter: boolean }) => {
      const body = {
        title: currentTitle.trim(),
        needed_by: currentNeeded || null,
        notes: currentNotes.trim() || null,
        lines: currentLines.map((l) => ({
          item_id: Number(l.item_id),
          quantity: Number(l.quantity),
          unit_cost: l.unit_cost ? Number(l.unit_cost) : null,
        })),
      };
      const saved = editing
        ? await api<Requisition>(`/requisitions/${id}`, { method: "PATCH", body })
        : await api<Requisition>("/requisitions", { body });
      if (submitAfter) return api<Requisition>(`/requisitions/${saved.id}/submit`, { body: {} });
      return saved;
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["requisitions"] });
      toast(saved.status === "submitted" ? `${saved.number} sent for approval` : `${saved.number} saved as draft`);
      navigate(`/requisitions/${saved.id}`);
    },
    onError: (error) => setFormError(error instanceof ApiError ? error.message : "Could not save the requisition."),
  });

  if (editing && existing.isPending) return <Loading rows={5} label="Loading requisition" />;
  if (items.isPending) return <Loading rows={5} label="Loading items" />;
  if (items.isError) return <ErrorBox error={items.error} onRetry={() => items.refetch()} />;

  const activeItems = items.data.filter((i) => i.is_active);

  const validateAll = (forSubmit: boolean) => {
    const next: Record<string, string> = {};
    if (currentTitle.trim().length < 3) next.title = "Give the request a short title, at least 3 characters";
    const lineErr = lineErrors(currentLines);
    if (forSubmit && currentLines.every((l) => !l.item_id)) next.lines = "Add at least one item before submitting";
    setErrors(next);
    return Object.keys(next).length === 0 && Object.keys(lineErr).length === 0;
  };

  const submit = (submitAfter: boolean) => (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (!validateAll(submitAfter)) return;
    save.mutate({ submitAfter });
  };

  const lineErr = lineErrors(currentLines);

  return (
    <>
      <PageHeader
        title={editing ? `Edit ${existing.data?.number ?? "requisition"}` : "New requisition"}
        description="Save as a draft while you work. Submitting sends it to a buyer or admin for approval."
      />
      <form className="form-card" noValidate onSubmit={submit(false)}>
        <div className="form-grid">
          <Field label="Title" error={errors.title} wide>
            {(fid) => (
              <input id={fid} className="input" value={currentTitle} placeholder="For example: Packaging for October dispatch" onChange={(e) => setTitle(e.target.value)} />
            )}
          </Field>
          <Field label="Needed by">
            {(fid) => <input id={fid} type="date" className="input" value={currentNeeded} onChange={(e) => setNeededBy(e.target.value)} />}
          </Field>
          <Field label="Notes">
            {(fid) => <input id={fid} className="input" value={currentNotes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
        </div>
        <h2 className="section-title">Items</h2>
        {errors.lines && <p className="form-error" role="alert">{errors.lines}</p>}
        <LineEditor
          lines={currentLines}
          items={activeItems}
          showCost
          errors={lineErr}
          onChange={(next) => setLines(next)}
        />
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
