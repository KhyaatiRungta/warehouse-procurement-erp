import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  BellRing,
  Boxes,
  ClipboardList,
  FileText,
  LayoutDashboard,
  LogOut,
  PackageCheck,
  ScrollText,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { ROLE_LABEL } from "../lib/format";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  permission?: string;
}

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/suppliers", label: "Suppliers", icon: Truck },
  { to: "/inventory", label: "Items and stock", icon: Boxes },
  { to: "/requisitions", label: "Requisitions", icon: ClipboardList },
  { to: "/purchase-orders", label: "Purchase orders", icon: FileText },
  { to: "/receipts", label: "Goods receipts", icon: PackageCheck },
  { to: "/alerts", label: "Reorder alerts", icon: BellRing },
  { to: "/audit", label: "Audit log", icon: ScrollText, permission: "audit:read" },
];

export function Layout() {
  const { user, can, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="26" height="26">
              <rect width="32" height="32" rx="6" fill="#24523F" />
              <path d="M7 9h18M7 16h12M7 23h18" stroke="#BFE3CF" strokeWidth="2.6" strokeLinecap="round" />
              <circle cx="23" cy="16" r="2.6" fill="#E3B65C" />
            </svg>
          </span>
          <div>
            <p className="brand-name">Depot ERP</p>
            <p className="brand-sub">Procurement and stock</p>
          </div>
        </div>

        <nav className="nav" aria-label="Main">
          {NAV.filter((item) => !item.permission || can(item.permission)).map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === "/"} className="nav-link">
              <item.icon size={17} strokeWidth={1.8} aria-hidden="true" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-foot">
          {user && (
            <div className="whoami">
              <p className="whoami-name">{user.full_name}</p>
              <p className="whoami-role">{ROLE_LABEL[user.role]}</p>
            </div>
          )}
          <button
            type="button"
            className="nav-link nav-button"
            onClick={() => {
              logout();
              navigate("/login");
            }}
          >
            <LogOut size={17} strokeWidth={1.8} aria-hidden="true" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      <main className="content" id="main">
        <div className="demo-banner" role="note">
          Demo data for evaluation. Accounts and records are fictional.
        </div>
        <Outlet />
      </main>
    </div>
  );
}
