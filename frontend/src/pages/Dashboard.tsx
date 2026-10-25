import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { dateTime, money, qty } from "../lib/format";
import type { Dashboard } from "../lib/types";
import { Empty, ErrorBox, Kpi, Loading, PageHeader, Panel, StatusBadge } from "../components/ui";

export function DashboardPage() {
  const query = useQuery({ queryKey: ["dashboard"], queryFn: () => api<Dashboard>("/dashboard") });

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Open procurement, stock risk and receiving for the current week."
      />
      {query.isPending && <Loading rows={6} label="Loading dashboard" />}
      {query.isError && <ErrorBox error={query.error} onRetry={() => query.refetch()} />}
      {query.data && (
        <>
          <div className="kpi-grid">
            <Kpi label="Open purchase orders" value={qty(query.data.kpis.open_po_count)} hint={`${money(query.data.kpis.open_po_value)} committed`} />
            <Kpi
              label="Awaiting approval"
              value={qty(query.data.kpis.pending_po_approvals)}
              hint={`${qty(query.data.kpis.pending_requisitions)} ${query.data.kpis.pending_requisitions === 1 ? "requisition" : "requisitions"} to decide`}
              tone={query.data.kpis.pending_po_approvals > 0 ? "alert" : undefined}
            />
            <Kpi
              label="Low-stock items"
              value={qty(query.data.kpis.low_stock_items)}
              hint="At or below reorder point"
              tone={query.data.kpis.low_stock_items > 0 ? "alert" : "ok"}
            />
            <Kpi
              label="Receipts this week"
              value={qty(query.data.kpis.receipts_this_week)}
              hint={`${qty(query.data.kpis.units_received_this_week)} units received`}
            />
          </div>

          <div className="grid-2">
            <Panel
              title="Recent purchase orders"
              flush
              actions={<Link to="/purchase-orders" className="link">All orders</Link>}
            >
              {query.data.recent_orders.length === 0 ? (
                <Empty title="No purchase orders yet" body="Create one from a requisition or start a draft." />
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Supplier</th>
                      <th>Status</th>
                      <th className="num">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.recent_orders.map((po) => (
                      <tr key={po.id}>
                        <td>
                          <Link to={`/purchase-orders/${po.id}`} className="mono strong">{po.number}</Link>
                        </td>
                        <td>{po.supplier_name}</td>
                        <td><StatusBadge status={po.status} /></td>
                        <td className="num mono">{money(po.total_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>

            <Panel title="Spend by supplier">
              {query.data.spend_by_supplier.length === 0 ? (
                <Empty title="No committed spend yet" body="Spend appears once an order is approved." />
              ) : (
                <ul className="bars">
                  {query.data.spend_by_supplier.map((row) => {
                    const max = query.data.spend_by_supplier[0]?.total || 1;
                    return (
                      <li key={row.supplier}>
                        <div className="bar-label">
                          <span>{row.supplier}</span>
                          <span className="mono">{money(row.total)}</span>
                        </div>
                        <div className="bar-track">
                          <span style={{ width: `${Math.max(3, (row.total / max) * 100)}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          </div>

          <div className="grid-2">
            <Panel title="Reorder alerts" flush actions={<Link to="/alerts" className="link">Open alerts</Link>}>
              {query.data.alerts.length === 0 ? (
                <Empty title="Every item is above its reorder point" body="Nothing needs ordering right now." />
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="num">On hand</th>
                      <th className="num">Reorder at</th>
                      <th className="num">Suggest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.alerts.map((a) => (
                      <tr key={a.item_id}>
                        <td>
                          <Link to={`/inventory/${a.item_id}`} className="strong">{a.name}</Link>
                          <div className="muted mono small">{a.sku}</div>
                        </td>
                        <td className="num mono alert-text">{qty(a.total_on_hand)}</td>
                        <td className="num mono">{qty(a.reorder_point)}</td>
                        <td className="num mono">{qty(a.suggested_qty)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>

            <Panel title="Latest goods receipts" flush actions={<Link to="/receipts" className="link">All receipts</Link>}>
              {query.data.recent_receipts.length === 0 ? (
                <Empty title="No goods received yet" />
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Receipt</th>
                      <th>Against</th>
                      <th>When</th>
                      <th className="num">Units</th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.recent_receipts.map((r) => (
                      <tr key={r.id}>
                        <td className="mono strong">{r.number}</td>
                        <td>
                          <Link to={`/purchase-orders/${r.po_id}`} className="mono">{r.po_number}</Link>
                          <div className="muted small">{r.supplier_name}</div>
                        </td>
                        <td className="small">{dateTime(r.received_at)}</td>
                        <td className="num mono">{qty(r.total_units)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
