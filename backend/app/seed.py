"""Demo data. Idempotent: does nothing once any user exists.

Demo accounts are for local evaluation only. Change or remove them before any real deployment.
"""

import datetime as dt
from decimal import Decimal

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.db import SessionLocal, create_schema
from app.models import Item, MovementType, Supplier, User, Warehouse
from app.security import hash_password
from app.services import procurement
from app.services.receiving import ReceiptRequest, receive_goods
from app.services.stock import post_movement

DEMO_USERS = [
    ("admin@erp.test", "admin1234", "Avery Admin", "admin"),
    ("buyer@erp.test", "buyer1234", "Bianca Buyer", "buyer"),
    ("clerk@erp.test", "clerk1234", "Chris Clerk", "warehouse_clerk"),
]

SUPPLIERS = [
    # code, name, contact, email, phone, address, terms, lead time
    ("NWI", "Northwind Industrial Supply", "Mara Ellison", "orders@northwind.example", "+44 20 7946 0101", "Unit 4, Park Royal, London NW10", "Net 30", 10),
    ("APX", "Apex Packaging Co.", "Dev Raman", "sales@apexpack.example", "+44 121 496 0222", "Hollis Way, Birmingham B6", "Net 45", 14),
    ("MER", "Meridian Electrical Supply", "Lena Ortiz", "trade@meridianelec.example", "+44 113 496 0333", "Kirkstall Road, Leeds LS4", "Net 30", 7),
    ("HSP", "Harbor Safety & PPE", "Sam Whitfield", "desk@harborsafety.example", "+44 117 496 0444", "Avonmouth Dock, Bristol BS11", "Net 15", 5),
    ("CRS", "Crestline Office Supplies", "Priya Nair", "b2b@crestline.example", "+44 161 496 0555", "Trafford Park, Manchester M17", "Net 30", 3),
    ("IRB", "Ironbridge Tools & Fasteners", "Tom Hadley", "accounts@ironbridge.example", "+44 1952 496 066", "Hadley Park, Telford TF1", "Net 60", 21),
]

WAREHOUSES = [
    ("WH-NTH", "North Distribution Centre", "Park Royal, London"),
    ("WH-STH", "South Cross-Dock", "Avonmouth, Bristol"),
]

# sku, name, category, uom, reorder point, reorder qty, unit cost, supplier code
ITEMS = [
    ("FST-HEX-M6-20", "Hex bolt M6 x 20 mm, zinc (box 100)", "Fasteners", "BOX", 12, 30, "14.50", "IRB"),
    ("FST-HEX-M8-30", "Hex bolt M8 x 30 mm, zinc (box 100)", "Fasteners", "BOX", 10, 25, "19.80", "IRB"),
    ("FST-WSH-M6", "Flat washer M6, zinc (box 200)", "Fasteners", "BOX", 8, 20, "6.40", "IRB"),
    ("FST-NUT-M8", "Nyloc nut M8 (box 100)", "Fasteners", "BOX", 8, 20, "9.10", "IRB"),
    ("FST-SCR-WS35", "Wood screw 3.5 x 35 mm (box 200)", "Fasteners", "BOX", 10, 25, "5.25", "IRB"),
    ("TLS-DRL-18V", "Cordless drill 18 V, kit", "Tools", "EA", 3, 6, "189.00", "IRB"),
    ("TLS-TAP-SET", "Tap and die set, metric", "Tools", "EA", 2, 4, "74.50", "IRB"),
    ("TLS-TQ-WR", "Torque wrench 1/2 in, 40-200 Nm", "Tools", "EA", 2, 3, "142.00", "IRB"),
    ("TLS-GRN-125", "Angle grinder 125 mm", "Tools", "EA", 2, 4, "96.00", "IRB"),
    ("TLS-LDR-3M", "Aluminium ladder 3 m", "Tools", "EA", 1, 2, "118.00", "IRB"),
    ("ELC-CBL-2.5", "Twin and earth cable 2.5 mm2, 100 m", "Electrical", "RL", 6, 12, "88.00", "MER"),
    ("ELC-CBL-1.5", "Twin and earth cable 1.5 mm2, 100 m", "Electrical", "RL", 6, 12, "67.50", "MER"),
    ("ELC-MCB-16A", "Miniature circuit breaker 16 A", "Electrical", "EA", 20, 50, "8.75", "MER"),
    ("ELC-RCD-40", "RCD 40 A 30 mA", "Electrical", "EA", 4, 10, "34.20", "MER"),
    ("ELC-SKT-DBL", "Double socket outlet, white", "Electrical", "EA", 25, 60, "3.90", "MER"),
    ("ELC-LMP-9W", "LED lamp 9 W B22", "Electrical", "EA", 40, 100, "2.45", "MER"),
    ("ELC-DB-12W", "Consumer unit 12-way", "Electrical", "EA", 2, 4, "112.00", "MER"),
    ("PKG-CTN-S", "Shipping carton 200 x 150 x 100 mm", "Packaging", "EA", 100, 300, "0.62", "APX"),
    ("PKG-CTN-M", "Shipping carton 300 x 200 x 200 mm", "Packaging", "EA", 80, 240, "0.88", "APX"),
    ("PKG-CTN-L", "Shipping carton 450 x 350 x 300 mm", "Packaging", "EA", 40, 120, "1.35", "APX"),
    ("PKG-TAPE-48", "Packing tape 48 mm x 66 m", "Packaging", "ROL", 50, 120, "1.95", "APX"),
    ("PKG-STR-PET", "Pallet strapping PET 12 mm, 1000 m", "Packaging", "ROL", 4, 10, "58.00", "APX"),
    ("PKG-BUB-500", "Bubble wrap 500 mm x 50 m", "Packaging", "ROL", 6, 12, "24.50", "APX"),
    ("PKG-PAL-EUR", "Euro pallet, timber, new", "Packaging", "EA", 30, 60, "14.80", "APX"),
    ("PKG-LBL-A6", "Thermal label A6, 500 per roll", "Packaging", "ROL", 10, 20, "17.40", "APX"),
    ("PPE-GLV-NIT-M", "Nitrile gloves, medium (box 100)", "PPE", "BOX", 15, 40, "9.60", "HSP"),
    ("PPE-GLV-NIT-L", "Nitrile gloves, large (box 100)", "PPE", "BOX", 15, 40, "9.60", "HSP"),
    ("PPE-HLM-WHT", "Safety helmet, white, EN 397", "PPE", "EA", 30, 60, "7.90", "HSP"),
    ("PPE-VST-HV", "Hi-vis vest, class 2", "PPE", "EA", 25, 50, "4.20", "HSP"),
    ("PPE-GOG-CLR", "Safety goggles, clear", "PPE", "EA", 20, 40, "3.10", "HSP"),
    ("PPE-BOOT-S42", "Safety boots, size 42, S3", "PPE", "PR", 5, 15, "62.00", "HSP"),
    ("OFF-PPR-A4", "Copier paper A4, 80 gsm (ream 500)", "Office", "REM", 40, 100, "4.10", "CRS"),
    ("OFF-PEN-BLK", "Ballpoint pen, black (box 50)", "Office", "BOX", 6, 12, "11.20", "CRS"),
    ("OFF-TNR-HP", "Toner cartridge, black", "Office", "EA", 6, 12, "58.00", "CRS"),
    ("OFF-FLD-A4", "Manila folder A4 (pack 100)", "Office", "PK", 8, 15, "13.60", "CRS"),
    ("OFF-STP-MED", "Stapler, desktop", "Office", "EA", 4, 10, "6.80", "CRS"),
    ("OFF-LBL-ADH", "Address labels 99 x 38 mm (pack 1000)", "Office", "PK", 6, 12, "9.90", "CRS"),
    ("CLN-DEG-5L", "Degreaser 5 L", "Cleaning", "EA", 6, 12, "18.90", "NWI"),
    ("CLN-RAG-10KG", "Cleaning rags 10 kg", "Cleaning", "BAG", 4, 10, "21.00", "NWI"),
    ("CLN-MOP-HDL", "Mop handle, aluminium", "Cleaning", "EA", 10, 20, "7.40", "NWI"),
    ("CLN-BIN-120", "Wheelie bin 120 L", "Cleaning", "EA", 4, 8, "39.00", "NWI"),
]

# Items deliberately seeded at or below their reorder point so the alerts page is alive.
LOW_STOCK_SKUS = {
    "FST-HEX-M8-30", "TLS-TQ-WR", "ELC-RCD-40", "PKG-STR-PET",
    "PPE-BOOT-S42", "OFF-TNR-HP", "CLN-BIN-120", "ELC-DB-12W",
}


def seed_demo_data() -> None:
    create_schema()
    with SessionLocal() as db:
        if db.execute(select(User.id)).first():
            return
        try:
            _seed(db)
        except Exception:
            # Services commit as they go, so a failure leaves partial demo data behind.
            # Clear it so the next start can seed cleanly.
            db.rollback()
            with db.begin():
                db.execute(text(
                    "TRUNCATE audit_log, goods_receipt_lines, goods_receipts, po_lines, purchase_orders, "
                    "requisition_lines, requisitions, stock_movements, stock_levels, items, warehouses, "
                    "suppliers, users RESTART IDENTITY CASCADE"
                ))
            raise


def _seed(db: Session) -> None:
    for email, password, name, role in DEMO_USERS:
        db.add(User(email=email, full_name=name, role=role, password_hash=hash_password(password), is_active=True))
    db.flush()
    users = {u.role: u for u in db.execute(select(User)).scalars()}
    admin, buyer, clerk = users["admin"], users["buyer"], users["warehouse_clerk"]

    suppliers = {}
    for code, name, contact, email, phone, address, terms, lead in SUPPLIERS:
        s = Supplier(code=code, name=name, contact_name=contact, email=email, phone=phone,
                     address=address, payment_terms=terms, lead_time_days=lead, is_active=True)
        db.add(s)
        suppliers[code] = s
    warehouses = {}
    for code, name, location in WAREHOUSES:
        w = Warehouse(code=code, name=name, location=location, is_active=True)
        db.add(w)
        warehouses[code] = w
    db.flush()

    items = {}
    for index, (sku, name, category, uom, rp, rq, cost, supplier_code) in enumerate(ITEMS):
        item = Item(
            sku=sku, name=name, category=category, uom=uom, reorder_point=rp, reorder_quantity=rq,
            unit_cost=Decimal(cost), preferred_supplier_id=suppliers[supplier_code].id, is_active=True,
            description=f"Stocked for {category.lower()} replenishment",
        )
        db.add(item)
        items[sku] = item
    db.commit()

    # Opening balances, written through the ledger so every on-hand figure has a history.
    north, south = warehouses["WH-NTH"], warehouses["WH-STH"]
    for index, (sku, *_rest) in enumerate(ITEMS):
        item = db.get(Item, items[sku].id)
        rp = item.reorder_point
        if sku in LOW_STOCK_SKUS:
            north_qty, south_qty = max(0, rp - 2), 0
        else:
            base = rp * 3 + (index * 37) % 90
            north_qty, south_qty = base, base // 3
        for wh, qty in ((north, north_qty), (south, south_qty)):
            if qty > 0:
                post_movement(
                    db, item=item, warehouse=db.get(Warehouse, wh.id), movement_type=MovementType.ADJUSTMENT,
                    quantity_delta=qty, reference_prefix="ADJ", actor=admin, note="Opening balance",
                )
    db.commit()

    today = dt.date.today()
    lines = lambda pairs: [{"item_id": items[s].id, "quantity": q, "unit_cost": None} for s, q in pairs]  # noqa: E731

    # PR-1: fasteners restock, fully received through PO-1.
    po1 = procurement.create_purchase_order(
        db, buyer, supplier_id=suppliers["IRB"].id, warehouse_id=north.id,
        expected_date=today - dt.timedelta(days=2), notes="Fixings restock for North bays",
        lines=lines([("FST-HEX-M6-20", 40), ("FST-WSH-M6", 30), ("FST-NUT-M8", 25)]),
    )
    for action, actor in (("submit", buyer), ("approve", admin), ("send", buyer)):
        procurement.transition_purchase_order(db, actor, po1, action)
    receive_goods(db, clerk, po_id=po1.id, lines=[ReceiptRequest(l.id, l.ordered_qty) for l in po1.lines], notes="Full delivery, pallets intact")

    # PO-2: electrical cable, partially received.
    po2 = procurement.create_purchase_order(
        db, buyer, supplier_id=suppliers["MER"].id, warehouse_id=north.id,
        expected_date=today + dt.timedelta(days=3), notes="Cable for Level 3 refit",
        lines=lines([("ELC-CBL-2.5", 14), ("ELC-CBL-1.5", 10), ("ELC-MCB-16A", 60)]),
    )
    for action, actor in (("submit", buyer), ("approve", admin), ("send", buyer)):
        procurement.transition_purchase_order(db, actor, po2, action)
    first, second, third = po2.lines
    receive_goods(db, clerk, po_id=po2.id, lines=[ReceiptRequest(first.id, 8), ReceiptRequest(third.id, 60)], notes="Cable reel 2 of 3 still in transit")

    # PO-3: office supplies, sent and awaiting delivery.
    po3 = procurement.create_purchase_order(
        db, buyer, supplier_id=suppliers["CRS"].id, warehouse_id=south.id,
        expected_date=today + dt.timedelta(days=5), notes="Monthly office top-up",
        lines=lines([("OFF-PPR-A4", 60), ("OFF-TNR-HP", 6), ("OFF-FLD-A4", 10)]),
    )
    for action, actor in (("submit", buyer), ("approve", admin), ("send", buyer)):
        procurement.transition_purchase_order(db, actor, po3, action)

    # PO-4: submitted, waiting on an approver.
    po4 = procurement.create_purchase_order(
        db, buyer, supplier_id=suppliers["HSP"].id, warehouse_id=north.id,
        expected_date=today + dt.timedelta(days=6), notes="PPE for contractor induction",
        lines=lines([("PPE-GLV-NIT-M", 20), ("PPE-HLM-WHT", 12), ("PPE-BOOT-S42", 6)]),
    )
    procurement.transition_purchase_order(db, buyer, po4, "submit")

    # PO-5: draft, still being built.
    procurement.create_purchase_order(
        db, buyer, supplier_id=suppliers["NWI"].id, warehouse_id=south.id,
        expected_date=None, notes="Cleaning consumables, to confirm with site",
        lines=lines([("CLN-DEG-5L", 10), ("CLN-MOP-HDL", 12)]),
    )

    # Requisitions in each state.
    prs = []
    prs.append(procurement.create_requisition(
        db, clerk, title="Packaging for October dispatch", needed_by=today + dt.timedelta(days=4),
        notes="Peak dispatch week", lines=lines([("PKG-CTN-M", 150), ("PKG-TAPE-48", 40), ("PKG-BUB-500", 8)]),
    ))
    procurement.submit_requisition(db, clerk, prs[-1])
    procurement.decide_requisition(db, buyer, prs[-1], approve=True, note="Within budget")

    prs.append(procurement.create_requisition(
        db, clerk, title="Electrical stock for North refit", needed_by=today + dt.timedelta(days=10),
        notes=None, lines=lines([("ELC-RCD-40", 6), ("ELC-SKT-DBL", 30), ("ELC-LMP-9W", 50)]),
    ))
    procurement.submit_requisition(db, clerk, prs[-1])

    prs.append(procurement.create_requisition(
        db, clerk, title="Office consumables top-up", needed_by=None,
        notes="Draft, add stapler once confirmed", lines=lines([("OFF-PEN-BLK", 5)]),
    ))

    prs.append(procurement.create_requisition(
        db, clerk, title="Duplicate PPE order", needed_by=None, notes=None,
        lines=lines([("PPE-VST-HV", 40)]),
    ))
    procurement.submit_requisition(db, clerk, prs[-1])
    procurement.decide_requisition(db, buyer, prs[-1], approve=False, note="Covered by PO-4 hi-vis line already on order")

    prs.append(procurement.create_requisition(
        db, buyer, title="Tools for Level 3 maintenance", needed_by=today + dt.timedelta(days=12),
        notes="Replace worn torque wrench and add grinder", lines=lines([("TLS-TQ-WR", 3), ("TLS-GRN-125", 2)]),
    ))
    procurement.submit_requisition(db, buyer, prs[-1])
    procurement.decide_requisition(db, admin, prs[-1], approve=True, note=None)
    procurement.convert_requisition(
        db, buyer, prs[-1], supplier_id=suppliers["IRB"].id, warehouse_id=north.id,
        expected_date=today + dt.timedelta(days=12), notes=None,
    )
