export interface User {
  id: number;
  email: string;
  full_name: string;
  role: "admin" | "buyer" | "warehouse_clerk";
  permissions: string[];
}

export interface Supplier {
  id: number;
  code: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  payment_terms: string | null;
  lead_time_days: number;
  is_active: boolean;
  open_po_count: number;
  open_po_value: number;
}

export interface Warehouse {
  id: number;
  code: string;
  name: string;
  location: string | null;
  is_active: boolean;
}

export interface StockByWarehouse {
  warehouse_id: number;
  warehouse_code: string;
  on_hand: number;
}

export interface Item {
  id: number;
  sku: string;
  name: string;
  description: string | null;
  category: string;
  uom: string;
  reorder_point: number;
  reorder_quantity: number;
  unit_cost: number;
  preferred_supplier_id: number | null;
  preferred_supplier_name: string | null;
  is_active: boolean;
  total_on_hand: number;
  on_order: number;
  is_low: boolean;
  stock: StockByWarehouse[];
}

export interface Movement {
  id: number;
  item_id: number;
  sku: string;
  item_name: string;
  warehouse_id: number;
  warehouse_code: string;
  movement_type: "RECEIPT" | "ADJUSTMENT" | "ISSUE";
  quantity: number;
  balance_after: number;
  reference: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface RequisitionLine {
  id: number;
  item_id: number;
  sku: string;
  item_name: string;
  uom: string;
  quantity: number;
  estimated_unit_cost: number;
  line_total: number;
}

export interface Requisition {
  id: number;
  number: string;
  title: string;
  status: "draft" | "submitted" | "approved" | "rejected" | "converted";
  needed_by: string | null;
  notes: string | null;
  requester: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  total_estimate: number;
  purchase_order_number: string | null;
  lines: RequisitionLine[];
}

export type POStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "sent"
  | "partially_received"
  | "received"
  | "cancelled";

export interface POSummary {
  id: number;
  number: string;
  status: POStatus;
  supplier_id: number;
  supplier_name: string;
  warehouse_id: number;
  warehouse_code: string;
  order_date: string;
  expected_date: string | null;
  line_count: number;
  units_ordered: number;
  units_received: number;
  total_amount: number;
  created_at: string;
}

export interface POLine {
  id: number;
  item_id: number;
  sku: string;
  item_name: string;
  uom: string;
  ordered_qty: number;
  received_qty: number;
  open_qty: number;
  unit_cost: number;
  line_total: number;
}

export interface PurchaseOrder extends POSummary {
  supplier: {
    id: number;
    code: string;
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    payment_terms: string | null;
    lead_time_days: number;
  };
  warehouse_name: string;
  warehouse_location: string | null;
  requisition_id: number | null;
  requisition_number: string | null;
  notes: string | null;
  created_by: string;
  approved_by: string | null;
  approved_at: string | null;
  sent_at: string | null;
  lines: POLine[];
}

export interface ReceiptLine {
  id: number;
  po_line_id: number;
  item_id: number;
  sku: string;
  item_name: string;
  quantity: number;
}

export interface Receipt {
  id: number;
  number: string;
  po_id: number;
  po_number: string;
  supplier_name: string;
  warehouse_id: number;
  warehouse_code: string;
  received_by: string;
  received_at: string;
  notes: string | null;
  total_units: number;
  lines: ReceiptLine[];
}

export interface AuditEntry {
  id: number;
  actor_email: string;
  action: string;
  entity_type: string;
  entity_id: string;
  summary: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
}

export interface ReorderAlert {
  item_id: number;
  sku: string;
  name: string;
  category: string;
  uom: string;
  total_on_hand: number;
  reorder_point: number;
  reorder_quantity: number;
  on_order: number;
  suggested_qty: number;
  covered_by_open_po: boolean;
}

export interface Dashboard {
  kpis: {
    open_po_count: number;
    open_po_value: number;
    pending_po_approvals: number;
    pending_requisitions: number;
    low_stock_items: number;
    receipts_this_week: number;
    units_received_this_week: number;
  };
  spend_by_supplier: { supplier: string; total: number }[];
  recent_orders: POSummary[];
  recent_receipts: Receipt[];
  alerts: ReorderAlert[];
}

export interface TokenResponse {
  access_token: string;
  token_type: "bearer";
  user: User;
}
