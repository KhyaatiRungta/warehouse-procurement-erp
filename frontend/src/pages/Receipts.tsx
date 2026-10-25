import { Fragment, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, PackageCheck } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dateTime, qty } from "../lib/format";
import type { POSummary, PurchaseOrder, Receipt } from "../lib/types";
import { Button, Empty, ErrorBox, Field, Loading, PageHeader, Panel, useToast } from "../components/ui";

export function ReceiptsPage() {
  const { can } = useAuth();
  const [open, setOpen] = useState<number | null>(null);
  const query = useQuery({ queryKey: ["receipts"], queryFn: () => api<Receipt[]>("/goods-receipts") });

  return (
    <>
      <PageHeader
        title="Goods receipts"
        description="Every delivery checked against an order. Each receipt has already updated stock."
        actions={can("receipts:write") && <Link to="/receipts/new" className="btn btn-primary btn-md"><PackageCheck size={16} /> Receive goods</Link>}
      />
      <Panel flush>
        {query.isPending && <Loading rows={6} label="Loading receipts" />}
        {query.isError && <ErrorBox error={query.error} onRetry={() => query.refetch()} />}
        {query.data && query.data.length === 0 && (
          <Empty title="No goods received yet" body="When a supplier delivers, receive against the order it belongs to." action={can("receipts:write") && <Link to="/receipts/new" className="btn btn-secondary btn-sm">Receive goods</Link>} />
        )}
        {query.data && query.data.length > 0 && (
          <div className="table-scroll">
            <table className="table table-hover">
              <thead>
                <tr>
                  <th style={{ width: 36 }}><span className="sr-only">Expand</span></th>
                  <th>Receipt</th>
                  <th>Against</th>
                  <th>Supplier</th>
                  <th>Warehouse</th>
                  <th>Received</th>
                  <th>By</th>
                  <th className="num">Units</th>
                </tr>
              </thead>
              <tbody>
                {query.data.map((r) => {
                  const expanded = open === r.id;
                  return (
                    <Fragment key={r.id}>
                      <tr className="clickable" onClick={() => setOpen(expanded ? null : r.id)} aria-expanded={expanded}>
                        <td>{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</td>
                        <td className="mono strong">{r.number}</td>
                        <td><Link to={`/purchase-orders/${r.po_id}`} className="mono" onClick={(e) => e.stopPropagation()}>{r.po_number}</Link></td>
                        <td>{r.supplier_name}</td>
                        <td className="mono small">{r.warehouse_code}</td>
                        <td className="small">{dateTime(r.received_at)}</td>
                        <td className="small">{r.received_by}</td>
                        <td className="num mono">{qty(r.total_units)}</td>
                      </tr>
                      {expanded && (
                        <tr className="detail-row">
                          <td />
                          <td colSpan={7}>
                            <table className="table table-dense inner">
                              <thead>
                                <tr>
                                  <th>Item</th>
                                  <th className="num">Received</th>
                                </tr>
                              </thead>
                              <tbody>
                                {r.lines.map((l) => (
                                  <tr key={l.id}>
                                    <td>{l.item_name} <span className="muted mono small">{l.sku}</span></td>
                                    <td className="num mono">{qty(l.quantity)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {r.notes && <p className="muted small">Note: {r.notes}</p>}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

export function ReceiveGoodsPage() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const openOrders = useQuery({
    queryKey: ["purchase-orders", "open-for-receipt"],
    queryFn: async () => {
      const [sent, partial] = await Promise.all([
        api<POSummary[]>("/purchase-orders?status=sent"),
        api<POSummary[]>("/purchase-orders?status=partially_received"),
      ]);
      return [...sent, ...partial];
    },
  });
  const [poId, setPoId] = useState<string | null>(search.get("po"));
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const selectedId = poId && poId !== "" ? Number(poId) : null;
  const order = useQuery({
    queryKey: ["purchase-order", selectedId],
    queryFn: () => api<PurchaseOrder>(`/purchase-orders/${selectedId}`),
    enabled: selectedId !== null,
  });

  const outstanding = useMemo(() => order.data?.lines.map((l) => ({ ...l, open: l.ordered_qty - l.received_qty })) ?? [], [order.data]);

  const receive = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<Receipt>("/goods-receipts", { body }),
    onSuccess: (receipt) => {
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-order"] });
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast(`${receipt.number} posted. Stock updated at ${receipt.warehouse_code}.`);
      navigate("/receipts");
    },
    onError: (error) => setFormError(error instanceof ApiError ? error.message : "The receipt was not posted. Nothing changed."),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const next: Record<number, string> = {};
    const lines: { po_line_id: number; quantity: number }[] = [];
    for (const line of outstanding) {
      const raw = quantities[line.id] ?? "";
      if (raw === "" || Number(raw) === 0) continue;
      if (!/^\d+$/.test(raw)) next[line.id] = "Whole numbers only";
      else if (Number(raw) > line.open) next[line.id] = `Only ${line.open} still outstanding`;
      else lines.push({ po_line_id: line.id, quantity: Number(raw) });
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    if (lines.length === 0) {
      setFormError("Enter a quantity for at least one line.");
      return;
    }
    receive.mutate({ po_id: selectedId, lines, notes: notes.trim() || null });
  };

  const fillAll = () => {
    const filled: Record<number, string> = {};
    outstanding.forEach((l) => {
      if (l.open > 0) filled[l.id] = String(l.open);
    });
    setQuantities(filled);
    setErrors({});
  };

  return (
    <>
      <PageHeader title="Receive goods" description="Pick the order the delivery belongs to. Quantities cannot exceed what is still outstanding." />
      <form className="form-card" noValidate onSubmit={submit}>
        <Field label="Purchase order">
          {(fid) => (
            <select
              id={fid}
              className="input"
              value={poId ?? ""}
              onChange={(e) => {
                setPoId(e.target.value || null);
                setQuantities({});
                setErrors({});
              }}
            >
              <option value="">Choose an order awaiting delivery</option>
              {openOrders.data?.map((po) => (
                <option key={po.id} value={po.id}>{po.number} · {po.supplier_name} · {po.warehouse_code}</option>
              ))}
            </select>
          )}
        </Field>

        {openOrders.isPending && <Loading rows={2} label="Loading orders" />}
        {openOrders.isError && <ErrorBox error={openOrders.error} onRetry={() => openOrders.refetch()} />}
        {openOrders.data && openOrders.data.length === 0 && (
          <Empty title="No orders are awaiting delivery" body="Only orders marked as sent can receive goods. Send an approved order first." action={<Link to="/purchase-orders" className="btn btn-secondary btn-sm">View orders</Link>} />
        )}

        {order.isPending && selectedId && <Loading rows={3} label="Loading order lines" />}
        {order.data && (
          <>
            <div className="order-strip">
              <span className="mono strong">{order.data.number}</span>
              <span>{order.data.supplier.name}</span>
              <span>Deliver to {order.data.warehouse_code} · {order.data.warehouse_name}</span>
              <Button size="sm" onClick={fillAll}>Receive everything outstanding</Button>
            </div>
            <table className="table receive-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Ordered</th>
                  <th className="num">Already received</th>
                  <th className="num">Outstanding</th>
                  <th className="num">Receive now</th>
                </tr>
              </thead>
              <tbody>
                {outstanding.map((l) => (
                  <tr key={l.id} className={l.open === 0 ? "is-done" : ""}>
                    <td>
                      <span className="strong">{l.item_name}</span>
                      <div className="muted small mono">{l.sku} · {l.uom}</div>
                    </td>
                    <td className="num mono">{qty(l.ordered_qty)}</td>
                    <td className="num mono">{qty(l.received_qty)}</td>
                    <td className="num mono strong">{qty(l.open)}</td>
                    <td className="num">
                      {l.open === 0 ? (
                        <span className="muted small">Complete</span>
                      ) : (
                        <div className="field">
                          <input
                            className="input input-num input-compact"
                            inputMode="numeric"
                            aria-label={`Quantity to receive for ${l.sku}`}
                            aria-invalid={errors[l.id] ? true : undefined}
                            value={quantities[l.id] ?? ""}
                            onChange={(e) => setQuantities((q) => ({ ...q, [l.id]: e.target.value.replace(/\D/g, "") }))}
                          />
                          {errors[l.id] && <p className="field-error" role="alert">{errors[l.id]}</p>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="remarks">
            <Field label="Delivery note or remarks" wide>
              {(fid) => <input id={fid} className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Pallet count, damage, carrier" />}
            </Field>
            </div>
          </>
        )}

        {formError && <p className="form-error" role="alert">{formError}</p>}
        <div className="form-actions">
          <Button variant="ghost" onClick={() => navigate("/receipts")}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={receive.isPending || !selectedId}>
            {receive.isPending ? "Posting receipt" : "Post receipt"}
          </Button>
        </div>
      </form>
    </>
  );
}
