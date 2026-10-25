import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Search } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dateOnly, money, qty } from "../lib/format";
import type { POSummary, Supplier } from "../lib/types";
import { Button, Empty, ErrorBox, Field, Loading, PageHeader, Panel, StatusBadge, useToast } from "../components/ui";

interface SupplierForm {
  code: string;
  name: string;
  contact_name: string;
  email: string;
  phone: string;
  address: string;
  payment_terms: string;
  lead_time_days: string;
  is_active: boolean;
}

const EMPTY_FORM: SupplierForm = {
  code: "",
  name: "",
  contact_name: "",
  email: "",
  phone: "",
  address: "",
  payment_terms: "",
  lead_time_days: "7",
  is_active: true,
};

export function SuppliersPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
  const params = new URLSearchParams();
  if (search.trim()) params.set("q", search.trim());
  if (status !== "all") params.set("active", String(status === "active"));
  const query = useQuery({
    queryKey: ["suppliers", search.trim(), status],
    queryFn: () => api<Supplier[]>(`/suppliers?${params.toString()}`),
    placeholderData: (previous) => previous,
  });

  return (
    <>
      <PageHeader
        title="Suppliers"
        description="Who you buy from, how fast they deliver, and what is still open with them."
        actions={can("suppliers:write") && <Link to="/suppliers/new" className="btn btn-primary btn-md"><Plus size={16} /> New supplier</Link>}
      />
      <div className="toolbar">
        <label className="search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Search suppliers</span>
          <input className="input" placeholder="Search by name, code or contact" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <div className="segmented" role="group" aria-label="Filter by status">
          {(["all", "active", "inactive"] as const).map((value) => (
            <button key={value} type="button" className={status === value ? "on" : ""} aria-pressed={status === value} onClick={() => setStatus(value)}>
              {value === "all" ? "All" : value === "active" ? "Active" : "Inactive"}
            </button>
          ))}
        </div>
      </div>

      <Panel flush>
        {query.isPending && <Loading rows={6} label="Loading suppliers" />}
        {query.isError && <ErrorBox error={query.error} onRetry={() => query.refetch()} />}
        {query.data && query.data.length === 0 && (
          <Empty title={search ? "No suppliers match that search" : "No suppliers yet"} body={search ? "Try a shorter name or clear the filter." : "Add a supplier before raising orders."} />
        )}
        {query.data && query.data.length > 0 && (
          <div className="table-scroll">
            <table className="table table-hover">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Supplier</th>
                  <th>Contact</th>
                  <th>Terms</th>
                  <th className="num">Lead time</th>
                  <th className="num">Open orders</th>
                  <th className="num">Open value</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {query.data.map((s) => (
                  <tr key={s.id} onClick={() => navigate(`/suppliers/${s.id}`)} className="clickable">
                    <td className="mono">{s.code}</td>
                    <td>
                      <Link to={`/suppliers/${s.id}`} className="strong" onClick={(e) => e.stopPropagation()}>{s.name}</Link>
                    </td>
                    <td>{s.contact_name ?? <span className="muted">None</span>}</td>
                    <td>{s.payment_terms ?? "None"}</td>
                    <td className="num mono">{s.lead_time_days} d</td>
                    <td className="num mono">{qty(s.open_po_count)}</td>
                    <td className="num mono">{money(s.open_po_value)}</td>
                    <td>{s.is_active ? <span className="badge badge-spruce">Active</span> : <span className="badge badge-neutral">Inactive</span>}</td>
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

export function SupplierDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const supplierId = Number(id);
  const supplier = useQuery({ queryKey: ["supplier", supplierId], queryFn: () => api<Supplier>(`/suppliers/${supplierId}`) });
  const orders = useQuery({
    queryKey: ["supplier-orders", supplierId],
    queryFn: () => api<POSummary[]>(`/purchase-orders?supplier_id=${supplierId}`),
  });

  if (supplier.isPending) return <Loading rows={5} label="Loading supplier" />;
  if (supplier.isError) return <ErrorBox error={supplier.error} onRetry={() => supplier.refetch()} />;
  const s = supplier.data;

  return (
    <>
      <PageHeader
        title={s.name}
        description={`${s.code} · ${s.is_active ? "Active supplier" : "Inactive: cannot be used on new orders"}`}
        actions={
          can("suppliers:write") && (
            <Link to={`/suppliers/${s.id}/edit`} className="btn btn-secondary btn-md"><Pencil size={15} /> Edit supplier</Link>
          )
        }
      />
      <div className="grid-main-side">
        <Panel title="Orders with this supplier" flush>
          {orders.isPending && <Loading rows={4} />}
          {orders.isError && <ErrorBox error={orders.error} onRetry={() => orders.refetch()} />}
          {orders.data && orders.data.length === 0 && <Empty title="No orders yet" body="Raise a purchase order from a requisition or a new draft." />}
          {orders.data && orders.data.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Status</th>
                  <th>Expected</th>
                  <th className="num">Received</th>
                  <th className="num">Value</th>
                </tr>
              </thead>
              <tbody>
                {orders.data.map((po) => (
                  <tr key={po.id}>
                    <td><Link to={`/purchase-orders/${po.id}`} className="mono strong">{po.number}</Link></td>
                    <td><StatusBadge status={po.status} /></td>
                    <td className="small">{dateOnly(po.expected_date)}</td>
                    <td className="num mono">{qty(po.units_received)} / {qty(po.units_ordered)}</td>
                    <td className="num mono">{money(po.total_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        <Panel title="Contact and terms">
          <dl className="facts">
            <dt>Contact</dt><dd>{s.contact_name ?? "None"}</dd>
            <dt>Email</dt><dd>{s.email ?? "None"}</dd>
            <dt>Phone</dt><dd>{s.phone ?? "None"}</dd>
            <dt>Address</dt><dd>{s.address ?? "None"}</dd>
            <dt>Payment terms</dt><dd>{s.payment_terms ?? "None"}</dd>
            <dt>Lead time</dt><dd>{s.lead_time_days} days</dd>
            <dt>Open value</dt><dd className="mono">{money(s.open_po_value)} across {s.open_po_count} orders</dd>
          </dl>
        </Panel>
      </div>
    </>
  );
}

function validate(form: SupplierForm, editing: boolean): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!editing && !/^[A-Za-z0-9-]{2,20}$/.test(form.code.trim())) errors.code = "Use 2 to 20 letters, digits or hyphens";
  if (form.name.trim().length < 2) errors.name = "Enter the supplier's legal or trading name";
  if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = "Enter a valid email address";
  const lead = Number(form.lead_time_days);
  if (!/^\d+$/.test(form.lead_time_days) || lead < 0 || lead > 365) errors.lead_time_days = "Whole days between 0 and 365";
  return errors;
}

export function SupplierFormPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const existing = useQuery({
    queryKey: ["supplier", Number(id)],
    queryFn: () => api<Supplier>(`/suppliers/${id}`),
    enabled: editing,
  });
  const [form, setForm] = useState<SupplierForm | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const current = useMemo<SupplierForm>(() => {
    if (form) return form;
    if (existing.data) {
      const s = existing.data;
      return {
        code: s.code,
        name: s.name,
        contact_name: s.contact_name ?? "",
        email: s.email ?? "",
        phone: s.phone ?? "",
        address: s.address ?? "",
        payment_terms: s.payment_terms ?? "",
        lead_time_days: String(s.lead_time_days),
        is_active: s.is_active,
      };
    }
    return EMPTY_FORM;
  }, [form, existing.data]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editing ? api<Supplier>(`/suppliers/${id}`, { method: "PATCH", body }) : api<Supplier>("/suppliers", { body }),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["supplier", saved.id] });
      toast(editing ? `Saved ${saved.name}` : `Created ${saved.name}`);
      navigate(`/suppliers/${saved.id}`);
    },
    onError: (error) => setFormError(error instanceof ApiError ? error.message : "Could not save the supplier."),
  });

  if (editing && existing.isPending) return <Loading rows={6} label="Loading supplier" />;
  if (editing && existing.isError) return <ErrorBox error={existing.error} onRetry={() => existing.refetch()} />;

  const set = (patch: Partial<SupplierForm>) => setForm({ ...current, ...patch });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const found = validate(current, editing);
    setErrors(found);
    if (Object.keys(found).length) return;
    const body: Record<string, unknown> = {
      name: current.name.trim(),
      contact_name: current.contact_name.trim() || null,
      email: current.email.trim() || null,
      phone: current.phone.trim() || null,
      address: current.address.trim() || null,
      payment_terms: current.payment_terms.trim() || null,
      lead_time_days: Number(current.lead_time_days),
      is_active: current.is_active,
    };
    if (!editing) body.code = current.code.trim().toUpperCase();
    save.mutate(body);
  };

  return (
    <>
      <PageHeader title={editing ? "Edit supplier" : "New supplier"} description={editing ? "Changes apply to new orders. Existing orders keep their terms." : "Suppliers need a code before they can receive orders."} />
      <form className="form-card" onSubmit={submit} noValidate>
        <div className="form-grid">
          <Field label="Supplier code" error={errors.code} hint={editing ? "Codes cannot change once issued" : "Shown on orders and receipts"}>
            {(fid) => (
              <input id={fid} className="input mono" value={current.code} disabled={editing} onChange={(e) => set({ code: e.target.value })} />
            )}
          </Field>
          <Field label="Supplier name" error={errors.name}>
            {(fid) => <input id={fid} className="input" value={current.name} onChange={(e) => set({ name: e.target.value })} />}
          </Field>
          <Field label="Contact person">
            {(fid) => <input id={fid} className="input" value={current.contact_name} onChange={(e) => set({ contact_name: e.target.value })} />}
          </Field>
          <Field label="Email" error={errors.email}>
            {(fid) => <input id={fid} className="input" type="email" value={current.email} onChange={(e) => set({ email: e.target.value })} />}
          </Field>
          <Field label="Phone">
            {(fid) => <input id={fid} className="input" value={current.phone} onChange={(e) => set({ phone: e.target.value })} />}
          </Field>
          <Field label="Payment terms" hint="For example Net 30">
            {(fid) => <input id={fid} className="input" value={current.payment_terms} onChange={(e) => set({ payment_terms: e.target.value })} />}
          </Field>
          <Field label="Lead time (days)" error={errors.lead_time_days} hint="Used for expected dates on new orders">
            {(fid) => (
              <input id={fid} className="input input-num" inputMode="numeric" value={current.lead_time_days} onChange={(e) => set({ lead_time_days: e.target.value })} />
            )}
          </Field>
          <Field label="Status" wide>
            {(fid) => (
              <label htmlFor={fid} className="check">
                <input id={fid} type="checkbox" checked={current.is_active} onChange={(e) => set({ is_active: e.target.checked })} />
                <span>Active. Inactive suppliers cannot be used on new purchase orders.</span>
              </label>
            )}
          </Field>
          <Field label="Address" wide>
            {(fid) => <textarea id={fid} className="input" rows={3} value={current.address} onChange={(e) => set({ address: e.target.value })} />}
          </Field>
        </div>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <div className="form-actions">
          <Button variant="ghost" onClick={() => navigate(-1)}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving" : editing ? "Save changes" : "Create supplier"}
          </Button>
        </div>
      </form>
    </>
  );
}
