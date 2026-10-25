import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { qty } from "../lib/format";
import type { ReorderAlert } from "../lib/types";
import { Badge, Empty, ErrorBox, Loading, PageHeader, Panel } from "../components/ui";
import { useAuth } from "../lib/auth";

export function AlertsPage() {
  const { can } = useAuth();
  const query = useQuery({ queryKey: ["alerts"], queryFn: () => api<ReorderAlert[]>("/alerts/reorder") });

  return (
    <>
      <PageHeader
        title="Reorder alerts"
        description="Active items at or below their reorder point. Suggested quantity tops stock back up to the point plus one order, net of stock already on order."
      />
      <Panel flush>
        {query.isPending && <Loading rows={6} label="Loading alerts" />}
        {query.isError && <ErrorBox error={query.error} onRetry={() => query.refetch()} />}
        {query.data && query.data.length === 0 && <Empty title="Nothing needs ordering" body="Every item is above its reorder point." />}
        {query.data && query.data.length > 0 && (
          <div className="table-scroll">
            <table className="table table-hover">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Category</th>
                  <th className="num">On hand</th>
                  <th className="num">Reorder at</th>
                  <th className="num">On order</th>
                  <th className="num">Suggested</th>
                  <th>Cover</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {query.data.map((a) => (
                  <tr key={a.item_id}>
                    <td>
                      <Link to={`/inventory/${a.item_id}`} className="strong">{a.name}</Link>
                      <div className="muted small mono">{a.sku}</div>
                    </td>
                    <td className="small">{a.category}</td>
                    <td className="num mono alert-text strong">{qty(a.total_on_hand)} {a.uom}</td>
                    <td className="num mono">{qty(a.reorder_point)}</td>
                    <td className="num mono">{qty(a.on_order)}</td>
                    <td className="num mono strong">{qty(a.suggested_qty)}</td>
                    <td>{a.covered_by_open_po ? <Badge tone="spruce">On order</Badge> : <Badge tone="amber">Not on order</Badge>}</td>
                    <td className="num">
                      {can("requisitions:write") && (
                        <Link to={`/requisitions/new?item=${a.item_id}&qty=${a.suggested_qty || a.reorder_quantity}`} className="btn btn-secondary btn-sm">
                          Raise requisition
                        </Link>
                      )}
                    </td>
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
