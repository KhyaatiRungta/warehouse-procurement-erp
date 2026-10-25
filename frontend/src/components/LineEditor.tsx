import { Plus, Trash2 } from "lucide-react";
import { money } from "../lib/format";
import type { Item } from "../lib/types";
import { Button, Field } from "./ui";

export interface DraftLine {
  key: number;
  item_id: string;
  quantity: string;
  unit_cost: string;
}

export function newLine(seed: Partial<DraftLine> = {}): DraftLine {
  return { key: Date.now() + Math.random(), item_id: "", quantity: "", unit_cost: "", ...seed };
}

export function lineErrors(lines: DraftLine[]): Record<number, string> {
  const errors: Record<number, string> = {};
  const seen = new Set<string>();
  for (const line of lines) {
    if (!line.item_id) errors[line.key] = "Choose an item";
    else if (seen.has(line.item_id)) errors[line.key] = "This item is already on the list. Merge the quantities.";
    else if (!/^\d+$/.test(line.quantity) || Number(line.quantity) <= 0) errors[line.key] = "Enter a whole quantity above zero";
    else if (line.unit_cost && (Number.isNaN(Number(line.unit_cost)) || Number(line.unit_cost) < 0))
      errors[line.key] = "Unit cost cannot be negative";
    if (line.item_id) seen.add(line.item_id);
  }
  return errors;
}

export function LineEditor({
  lines,
  items,
  onChange,
  showCost,
  errors = {},
}: {
  lines: DraftLine[];
  items: Item[];
  onChange: (lines: DraftLine[]) => void;
  showCost: boolean;
  errors?: Record<number, string>;
}) {
  const update = (key: number, patch: Partial<DraftLine>) =>
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const total = lines.reduce((sum, line) => {
    const item = items.find((i) => String(i.id) === line.item_id);
    const cost = line.unit_cost ? Number(line.unit_cost) : item?.unit_cost ?? 0;
    return sum + (Number(line.quantity) || 0) * cost;
  }, 0);

  return (
    <div className="line-editor">
      <div className="line-grid line-grid-head" aria-hidden="true">
        <span>Item</span>
        <span>Quantity</span>
        {showCost && <span>Unit cost (GBP)</span>}
        <span />
      </div>
      {lines.map((line) => {
        const item = items.find((i) => String(i.id) === line.item_id);
        return (
          <div key={line.key} className="line-row">
            <div className="line-grid">
              <Field label="Item" error={errors[line.key]}>
                {(id) => (
                  <select id={id} className="input" value={line.item_id} onChange={(e) => {
                    const picked = items.find((i) => String(i.id) === e.target.value);
                    update(line.key, { item_id: e.target.value, unit_cost: showCost && picked ? String(picked.unit_cost) : line.unit_cost });
                  }}>
                    <option value="">Choose an item</option>
                    {items.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.sku} · {i.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Quantity" error={undefined}>
                {(id) => (
                  <input
                    id={id}
                    className="input input-num"
                    inputMode="numeric"
                    value={line.quantity}
                    placeholder={item ? item.uom : "0"}
                    onChange={(e) => update(line.key, { quantity: e.target.value.replace(/[^\d]/g, "") })}
                  />
                )}
              </Field>
              {showCost && (
                <Field label="Unit cost (GBP)" error={undefined}>
                  {(id) => (
                    <input
                      id={id}
                      className="input input-num"
                      inputMode="decimal"
                      value={line.unit_cost}
                      placeholder={item ? item.unit_cost.toFixed(2) : "0.00"}
                      onChange={(e) => update(line.key, { unit_cost: e.target.value })}
                    />
                  )}
                </Field>
              )}
              <div className="line-remove">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Remove line"
                  disabled={lines.length === 1}
                  onClick={() => onChange(lines.filter((l) => l.key !== line.key))}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          </div>
        );
      })}
      <div className="line-foot">
        <Button size="sm" onClick={() => onChange([...lines, newLine()])}>
          <Plus size={15} /> Add line
        </Button>
        {showCost && <p className="line-total">Estimated total <strong>{money(total)}</strong></p>}
      </div>
    </div>
  );
}
