import { useCallback, useState } from "react";
import {
  BedDouble, Bell, BriefcaseMedical, CalendarDays, ClipboardList,
  CreditCard, FlaskConical, HeartPulse, LayoutDashboard, LogOut, Menu, Pill, Settings,
  ShieldCheck, Stethoscope, UsersRound, X, Building2, FileHeart, ChartNoAxesCombined
} from "lucide-react";
import { useAuth } from "./auth/AuthContext";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { PatientsPage } from "./pages/PatientsPage";
import { DoctorsPage } from "./pages/DoctorsPage";
import { AppointmentsPage } from "./pages/AppointmentsPage";
import { DepartmentsPage } from "./pages/DepartmentsPage";
import { BedsPage } from "./pages/BedsPage";
import { ClinicalPages } from "./pages/ClinicalPages";
import {
  BillingPage, LaboratoryPage, PharmacyPage, ReportsPage, SettingsPage, StaffPage
} from "./pages/OperationsPages";
import { Loading, Toast } from "./components/UI";
import type { Role } from "./types";

type PageId = "dashboard" | "patients" | "doctors" | "appointments" | "departments" | "staff" | "beds" | "records" | "pharmacy" | "laboratory" | "billing" | "reports" | "settings";

const navigation: { id: PageId; label: string; icon: typeof LayoutDashboard; roles: Role[] }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["admin", "doctor", "receptionist", "nurse", "pharmacist", "laboratory_technician", "accountant"] },
  { id: "patients", label: "Patient management", icon: UsersRound, roles: ["admin", "doctor", "receptionist", "nurse", "pharmacist", "laboratory_technician"] },
  { id: "doctors", label: "Doctor management", icon: Stethoscope, roles: ["admin", "doctor", "receptionist"] },
  { id: "appointments", label: "Appointments", icon: CalendarDays, roles: ["admin", "doctor", "receptionist", "nurse"] },
  { id: "departments", label: "Departments", icon: Building2, roles: ["admin", "doctor", "receptionist", "nurse"] },
  { id: "staff", label: "Staff management", icon: BriefcaseMedical, roles: ["admin"] },
  { id: "beds", label: "Beds & wards", icon: BedDouble, roles: ["admin", "doctor", "receptionist", "nurse"] },
  { id: "records", label: "Medical records", icon: FileHeart, roles: ["admin", "doctor", "nurse", "laboratory_technician"] },
  { id: "pharmacy", label: "Pharmacy", icon: Pill, roles: ["admin", "pharmacist"] },
  { id: "laboratory", label: "Laboratory", icon: FlaskConical, roles: ["admin", "doctor", "nurse", "laboratory_technician"] },
  { id: "billing", label: "Billing & payments", icon: CreditCard, roles: ["admin", "pharmacist", "accountant"] },
  { id: "reports", label: "Reports & analytics", icon: ChartNoAxesCombined, roles: ["admin", "doctor", "nurse", "accountant"] },
  { id: "settings", label: "Hospital settings", icon: Settings, roles: ["admin"] }
];

const pageTitles: Record<PageId, string> = {
  dashboard: "Dashboard", patients: "Patient management", doctors: "Doctor management",
  appointments: "Appointments", departments: "Departments", staff: "Staff management",
  beds: "Bed & ward management", records: "Electronic medical records", pharmacy: "Pharmacy management",
  laboratory: "Laboratory management", billing: "Billing & payments", reports: "Reports & analytics",
  settings: "Hospital settings"
};

export function App() {
  const { user, loading, logout } = useAuth();
  const [activePage, setActivePage] = useState<PageId>("dashboard");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [toast, setToast] = useState("");

  const notify = useCallback((message: string) => setToast(message), []);
  const closeToast = useCallback(() => setToast(""), []);
  const signOut = async () => {
    try { await logout(); setActivePage("dashboard"); }
    catch (reason) { notify(reason instanceof Error ? reason.message : "Unable to sign out."); }
  };
  if (loading) return <Loading label="Checking your secure session..." />;
  if (!user) return <LoginPage />;

  const allowedNavigation = navigation.filter(item => item.roles.includes(user.role));
  if (!allowedNavigation.some(item => item.id === activePage)) setActivePage("dashboard");
  const selectPage = (page: PageId) => { setActivePage(page); setMobileOpen(false); setNotificationsOpen(false); };

  return <div className="app-shell">
    {mobileOpen && <button className="mobile-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
      <a className="brand" href="#" onClick={event => { event.preventDefault(); selectPage("dashboard"); }}>
        <span className="brand-mark"><HeartPulse size={20} /></span><span className="brand-name">care<span>point</span></span>
      </a>
      <div className="workspace-label">HOSPITAL WORKSPACE</div>
      <nav className="sidebar-nav" aria-label="Main navigation">
        {allowedNavigation.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-link ${activePage === id ? "active" : ""}`} onClick={() => selectPage(id)} aria-current={activePage === id ? "page" : undefined}>
          <Icon size={17} strokeWidth={1.8} /><span>{label}</span>{id === "appointments" && activePage === id && <span className="nav-active-mark" />}
        </button>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-support"><span className="support-icon"><ShieldCheck size={17} /></span><strong>Care, with confidence</strong><p>Access is tailored to your role and recorded for accountability.</p></div>
        <div className="user-profile">
          <span className="user-avatar">{initials(user.name)}</span><span className="user-profile-copy"><strong>{user.name}</strong><small>{roleLabel(user.role)}</small></span>
          <button className="profile-menu-button" onClick={() => void signOut()} aria-label="Log out" title="Log out"><LogOut size={15} /></button>
        </div>
      </div>
    </aside>

    <main className="main-area">
      <header className="topbar">
        <button className="mobile-menu-button" aria-label={mobileOpen ? "Close menu" : "Open menu"} aria-expanded={mobileOpen} onClick={() => setMobileOpen(!mobileOpen)}>{mobileOpen ? <X size={20} /> : <Menu size={20} />}</button>
        <div className="topbar-title"><span>CarePoint Hospital</span><span className="topbar-divider">/</span><strong>{pageTitles[activePage]}</strong></div>
        <div className="topbar-right">
          <span className="top-date">{new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" }).format(new Date())}</span>
          <div className="notification-wrap"><button className={`icon-button notification-button ${notificationsOpen ? "is-open" : ""}`} onClick={() => setNotificationsOpen(!notificationsOpen)} aria-label="Notifications" aria-expanded={notificationsOpen}><Bell size={17} /><span className="notification-indicator" /></button>
            {notificationsOpen && <div className="notification-popover"><div className="notification-heading"><strong>Hospital pulse</strong><button onClick={() => setNotificationsOpen(false)} aria-label="Close notifications"><X size={15} /></button></div>
              <div className="notification-item"><span className="notification-symbol blue"><CalendarDays size={15} /></span><span><strong>Daily schedule</strong><small>Review today's appointment list.</small></span><button onClick={() => selectPage("appointments")}>Open</button></div>
              <div className="notification-item"><span className="notification-symbol amber"><BedDouble size={15} /></span><span><strong>Bed availability</strong><small>Check ward occupancy and admissions.</small></span><button onClick={() => selectPage("beds")}>Open</button></div>
              {user.role === "admin" && <div className="notification-item"><span className="notification-symbol teal"><ClipboardList size={15} /></span><span><strong>Access review</strong><small>Manage staff roles and access.</small></span><button onClick={() => selectPage("staff")}>Open</button></div>}
            </div>}
          </div>
          <span className="top-user-avatar">{initials(user.name)}</span>
          <button className="top-logout" onClick={() => void signOut()}><span>Log out</span><LogOut size={15} /></button>
        </div>
      </header>
      <div className="content-scroll">
        {activePage === "dashboard" && <DashboardPage onNewAppointment={allowedNavigation.some(item => item.id === "appointments") ? () => selectPage("appointments") : undefined} />}
        {activePage === "patients" && <PatientsPage notify={notify} />}
        {activePage === "doctors" && <DoctorsPage notify={notify} />}
        {activePage === "appointments" && <AppointmentsPage notify={notify} />}
        {activePage === "departments" && <DepartmentsPage />}
        {activePage === "staff" && <StaffPage notify={notify} />}
        {activePage === "beds" && <BedsPage notify={notify} />}
        {activePage === "records" && <ClinicalPages notify={notify} />}
        {activePage === "pharmacy" && <PharmacyPage notify={notify} />}
        {activePage === "laboratory" && <LaboratoryPage notify={notify} />}
        {activePage === "billing" && <BillingPage notify={notify} />}
        {activePage === "reports" && <ReportsPage />}
        {activePage === "settings" && <SettingsPage notify={notify} />}
      </div>
    </main>
    <Toast message={toast} onClose={closeToast} />
  </div>;
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
}

function roleLabel(role: Role) {
  return role.split("_").map(part => part[0].toUpperCase() + part.slice(1)).join(" ");
}