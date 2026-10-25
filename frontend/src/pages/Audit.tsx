import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { api } from "../lib/api";
import { dateTime } from "../lib/format";
import type { AuditEntry } from "../lib/types";
import { Empty, ErrorBox, Loading, PageHeader, Panel } from "../components/ui";

const ENTITY_TYPES = ["", "requisition", "purchase_order", "goods_receipt", "supplier", "item", "warehouse"];

export function AuditPage() {
  const [entity, setEntity] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const query = useQuery({
    queryKey: ["audit", entity],
    queryFn: () => api<AuditEntry[]>(`/audit?limit=300${entity ? `&entity_type=${entity}` : ""}`),
    placeholderData: (previous) => previous,
  });

  return (
    <>
      <PageHeader title="Audit log" description="Who changed what, and the values before and after. Entries are written in the same transaction as the change." />
      <div className="toolbar">
        <label className="select-inline">
          <span>Record type</span>
          <select className="input" value={entity} onChange={(e) => setEntity(e.target.value)}>
            {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t ? t.replace("_", " ") : "All records"}</option>)}
          </select>
        </label>
      </div>
      <Panel flush>
        {query.isPending && <Loading rows={8} label="Loading audit log" />}
        {query.isError && <ErrorBox error={query.error} onRetry={() => query.refetch()} />}
        {query.data && query.data.length === 0 && <Empty title="No audit entries" body="Changes will be recorded here as people work in the system." />}
        {query.data && query.data.length > 0 && (
          <div className="table-scroll">
            <table className="table table-hover table-dense">
              <thead>
                <tr>
                  <th style={{ width: 36 }}><span className="sr-only">Expand</span></th>
                  <th>When</th>
                  <th>Who</th>
                  <th>Action</th>
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody>
                {query.data.map((a) => {
                  const expanded = open === a.id;
                  return (
                    <Fragment key={a.id}>
                      <tr className="clickable" onClick={() => setOpen(expanded ? null : a.id)} aria-expanded={expanded}>
                        <td>{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</td>
                        <td className="small">{dateTime(a.created_at)}</td>
                        <td className="small">{a.actor_email}</td>
                        <td className="mono small">{a.action}</td>
                        <td>{a.summary}</td>
                      </tr>
                      {expanded && (
                        <tr className="detail-row">
                          <td />
                          <td colSpan={4}>
                            <div className="diff">
                              <div>
                                <p className="kpi-label">Before</p>
                                <pre>{a.before ? JSON.stringify(a.before, null, 2) : "No prior state"}</pre>
                              </div>
                              <div>
                                <p className="kpi-label">After</p>
                                <pre>{a.after ? JSON.stringify(a.after, null, 2) : "No data"}</pre>
                              </div>
                            </div>
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
