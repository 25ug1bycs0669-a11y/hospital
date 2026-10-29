import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ArrowDown, ArrowUp, Building2, ClipboardList, CreditCard, FlaskConical,
  Plus, ReceiptText, Settings2, ShieldCheck, UsersRound, Wallet
} from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import {
  Button, DataTable, ErrorState, FormActions, FormField, formatCurrency, formatDate,
  Modal, PageHeader, Panel, PanelTitle, SearchField, StatusBadge
} from "../components/UI";
import { api } from "../lib/api";
import type {
  Bill, BillItem, HospitalSettings, InventoryItem, LabOrder, PageResult,
  Patient, Role, StaffMember
} from "../types";

type Notify = (message: string) => void;

export function BillingPage({ notify }: { notify: Notify }) {
  const { user } = useAuth();
  const [result, setResult] = useState<PageResult<Bill> | null>(null);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<{ bill: Bill; items: BillItem[] } | null>(null);
  const [patientId, setPatientId] = useState("");
  const [items, setItems] = useState<BillItem[]>([{ description: "Consultation fee", amount: 0 }]);
  const [pending, setPending] = useState(false);
  const canWrite = user?.role === "admin" || user?.role === "accountant";
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setResult(await api.bills({ page, pageSize: 8, search: query })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load invoices."); }
    finally { setLoading(false); }
  }, [page, query]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (canWrite) api.patients({ pageSize: 100 }).then(result => setPatients(result.data))
      .catch(reason => setError(reason instanceof Error ? reason.message : "Unable to load patient list."));
  }, [canWrite]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError("");
    try {
      await api.createBill({ patientId, items: items.filter(item => item.description.trim() && item.amount > 0) });
      setOpen(false); setItems([{ description: "Consultation fee", amount: 0 }]); setPatientId("");
      notify("Itemized invoice generated."); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to create invoice."); }
    finally { setPending(false); }
  }

  async function changeStatus(bill: Bill, status: Bill["status"]) {
    if (!window.confirm(`Update ${bill.invoiceNumber} to ${status.toLowerCase()}?`)) return;
    try { await api.updateBill(bill.id, status); notify(`Invoice marked ${status.toLowerCase()}.`); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update invoice."); }
  }

  async function showDetails(bill: Bill) {
    try { setDetail(await api.billDetails(bill.id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load invoice details."); }
  }

  if (error && !result) return <ErrorState message={error} retry={() => void load()} />;
  return <div className="page-content">
    <PageHeader title="Billing & payments" description="Create itemized invoices and track outstanding patient payments."
      action={canWrite && <Button onClick={() => setOpen(true)}><Plus size={16} /> Generate invoice</Button>} />
    {error && <div className="inline-warning">{error}<button onClick={() => void load()}>Dismiss</button></div>}
    <Panel className="data-panel">
      <div className="toolbar"><SearchField value={query} onChange={value => { setPage(1); setQuery(value); }} placeholder="Search invoice or patient..." /><span className="panel-note">{result?.total ?? 0} invoices</span></div>
      <DataTable headers={["Invoice", "Patient", "Amount", "Date", "Payment status", "Actions"]} loading={loading} empty={!loading && !result?.data.length}>
        {result?.data.map(bill => <tr key={bill.id}><td><button className="text-button" onClick={() => void showDetails(bill)}><ReceiptText size={14} />{bill.invoiceNumber}</button></td>
          <td>{bill.patientName}</td><td className="amount-cell">{formatCurrency(bill.amount)}</td><td>{formatDate(bill.createdAt)}</td><td><StatusBadge status={bill.status} /></td>
          <td>{canWrite && bill.status !== "Paid" && <button className="text-button" onClick={() => void changeStatus(bill, "Paid")}><CreditCard size={14} /> Mark paid</button>}</td></tr>)}
      </DataTable>
      {result && <div className="pagination"><span>Showing {result.data.length} of {result.total} invoices</span><div className="pager-buttons">
        <button className="button button-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
        <button className="button button-secondary" disabled={page * 8 >= result.total} onClick={() => setPage(page + 1)}>Next</button></div></div>}
    </Panel>
    {open && <Modal title="Generate itemized invoice" onClose={() => setOpen(false)}>
      <form className="app-form" onSubmit={submit}>
        <FormField label="Patient" required><select required value={patientId} onChange={event => setPatientId(event.target.value)}><option value="">Select a patient</option>{patients.map(patient => <option key={patient.id} value={patient.id}>{patient.name} · {patient.patientId}</option>)}</select></FormField>
        <div className="invoice-items"><div className="invoice-items-title"><strong>Bill items</strong><span>Amount (USD)</span></div>
          {items.map((item, index) => <div className="invoice-line" key={index}><select aria-label="Charge type" value={item.description} onChange={event => updateItem(setItems, items, index, "description", event.target.value)}>
            <option>Consultation fee</option><option>Laboratory charges</option><option>Medicines</option><option>Room charges</option><option>Other</option></select>
            <input aria-label="Charge amount" type="number" min="0.01" step="0.01" value={item.amount || ""} onChange={event => updateItem(setItems, items, index, "amount", Number(event.target.value))} required />
            {items.length > 1 && <button type="button" className="icon-button small danger-action" aria-label="Remove charge" onClick={() => setItems(items.filter((_, itemIndex) => itemIndex !== index))}>×</button>}</div>)}
          <button type="button" className="text-button add-line" onClick={() => setItems([...items, { description: "Laboratory charges", amount: 0 }])}><Plus size={14} /> Add bill item</button>
          <div className="invoice-total"><span>Total due</span><strong>{formatCurrency(items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0))}</strong></div>
        </div>
        <FormActions onCancel={() => setOpen(false)} pending={pending} submit="Create invoice" />
      </form>
    </Modal>}
    {detail && <Modal title={`Invoice ${detail.bill.invoiceNumber}`} onClose={() => setDetail(null)}>
      <div className="invoice-detail"><div className="invoice-detail-top"><span>{detail.bill.patientName}</span><StatusBadge status={detail.bill.status} /></div>
        <p>Generated {formatDate(detail.bill.createdAt)}</p>{detail.items.map((item, index) => <div className="invoice-detail-row" key={index}><span>{item.description}</span><strong>{formatCurrency(item.amount)}</strong></div>)}
        <div className="invoice-detail-row invoice-detail-total"><span>Total</span><strong>{formatCurrency(detail.bill.amount)}</strong></div>
      </div>
    </Modal>}
  </div>;
}

function updateItem(setItems: (items: BillItem[]) => void, items: BillItem[], index: number, key: keyof BillItem, value: string | number) {
  setItems(items.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item));
}

export function StaffPage({ notify }: { notify: Notify }) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState<{ name: string; email: string; password: string; role: Role }>({ name: "", email: "", password: "", role: "receptionist" });
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setStaff(await api.staff()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load staff."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError("");
    try { await api.createStaff(form); setOpen(false); setForm({ name: "", email: "", password: "", role: "receptionist" }); notify("Staff account created."); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to create account."); }
    finally { setPending(false); }
  }
  if (error && !staff.length && !loading) return <ErrorState message={error} retry={() => void load()} />;
  return <div className="page-content">
    <PageHeader title="Staff management" description="Manage staff access using least-privilege roles."
      action={<Button onClick={() => setOpen(true)}><Plus size={16} /> Invite staff</Button>} />
    <div className="role-notice"><ShieldCheck size={18} /><span><strong>Role-based access is enforced by the API.</strong> Staff only see records and tools permitted to their role.</span></div>
    <Panel className="data-panel"><PanelTitle title="Staff accounts" description={`${staff.length} team members`} />
      <DataTable headers={["Team member", "Email", "Role", "Access"]} loading={loading} empty={!loading && !staff.length}>
        {staff.map(member => <tr key={member.id}><td><span className="person-cell"><span className="person-avatar">{member.name.split(/\s+/).map(part => part[0]).slice(0, 2).join("")}</span><strong>{member.name}</strong></span></td><td>{member.email}</td>
          <td><span className="role-chip">{roleLabel(member.role)}</span></td><td><StatusBadge status={member.active ? "Active" : "Disabled"} /></td></tr>)}
      </DataTable>
    </Panel>
    {error && <div className="inline-warning">{error}</div>}
    {open && <Modal title="Create staff account" onClose={() => setOpen(false)}><form className="app-form" onSubmit={submit}>
      <FormField label="Full name" required><input required minLength={2} maxLength={100} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></FormField>
      <FormField label="Work email" required><input required type="email" autoComplete="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></FormField>
      <FormField label="Temporary password" required><input required type="password" autoComplete="new-password" minLength={12} value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} /><small>Use at least 12 characters. Share it securely.</small></FormField>
      <FormField label="Role" required><select value={form.role} onChange={event => setForm({ ...form, role: event.target.value as Role })}>
        {(["doctor", "receptionist", "nurse", "pharmacist", "laboratory_technician", "accountant", "admin"] as Role[]).map(role => <option value={role} key={role}>{roleLabel(role)}</option>)}</select></FormField>
      <FormActions onCancel={() => setOpen(false)} pending={pending} submit="Create account" />
    </form></Modal>}
  </div>;
}

function roleLabel(role: Role) {
  return role.split("_").map(part => part[0].toUpperCase() + part.slice(1)).join(" ");
}

export function PharmacyPage({ notify }: { notify: Notify }) {
  const { user } = useAuth();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", category: "Medication", stock: 0, reorderLevel: 10, unit: "units" });
  const [pending, setPending] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setItems(await api.inventory()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load pharmacy stock."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError("");
    try { await api.createInventory(form); setOpen(false); setForm({ name: "", category: "Medication", stock: 0, reorderLevel: 10, unit: "units" }); notify("Inventory item added."); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to add stock item."); }
    finally { setPending(false); }
  }
  async function adjust(item: InventoryItem, delta: number) {
    const stock = Math.max(0, item.stock + delta);
    try { const updated = await api.updateInventory(item.id, stock); setItems(current => current.map(value => value.id === item.id ? updated : value)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update stock."); }
  }
  if (error && !items.length && !loading) return <ErrorState message={error} retry={() => void load()} />;
  const lowStock = items.filter(item => item.stock <= item.reorderLevel).length;
  return <div className="page-content"><PageHeader title="Pharmacy" description="Review medicine inventory and keep an eye on low stock."
    action={<Button onClick={() => setOpen(true)}><Plus size={16} /> Add stock item</Button>} />
    <div className="pharmacy-callout"><span className="summary-icon amber"><Wallet size={17} /></span><span>{lowStock ? `${lowStock} item${lowStock === 1 ? "" : "s"} at or below reorder level.` : "All stock levels are currently above reorder thresholds."}</span></div>
    {error && <div className="inline-warning">{error}</div>}
    <Panel className="data-panel"><PanelTitle title="Medicine inventory" description="Stock adjustments are recorded in the system audit log." />
      <DataTable headers={["Medicine", "Category", "In stock", "Reorder at", "Stock level", "Adjust"]} loading={loading} empty={!loading && !items.length}>
        {items.map(item => <tr key={item.id}><td><strong className="table-strong">{item.name}</strong></td><td>{item.category}</td><td><strong>{item.stock}</strong> {item.unit}</td><td>{item.reorderLevel} {item.unit}</td>
          <td><StatusBadge status={item.stock <= item.reorderLevel ? "Low stock" : "In stock"} /></td><td><div className="row-actions">
            <button className="icon-button small" disabled={item.stock <= 0} onClick={() => void adjust(item, -1)} aria-label={`Decrease ${item.name} stock`}><ArrowDown size={14} /></button>
            <button className="icon-button small success-action" onClick={() => void adjust(item, 1)} aria-label={`Increase ${item.name} stock`}><ArrowUp size={14} /></button></div></td></tr>)}
      </DataTable>
    </Panel>
    {open && <Modal title="Add inventory item" onClose={() => setOpen(false)}><form className="app-form" onSubmit={saveItem}>
      <FormField label="Medicine name" required><input required minLength={2} maxLength={100} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></FormField>
      <div className="form-grid"><FormField label="Category" required><input required value={form.category} onChange={event => setForm({ ...form, category: event.target.value })} /></FormField><FormField label="Unit" required><input required value={form.unit} onChange={event => setForm({ ...form, unit: event.target.value })} /></FormField></div>
      <div className="form-grid"><FormField label="Opening stock" required><input required type="number" min="0" step="1" value={form.stock} onChange={event => setForm({ ...form, stock: Number(event.target.value) })} /></FormField><FormField label="Reorder level" required><input required type="number" min="0" step="1" value={form.reorderLevel} onChange={event => setForm({ ...form, reorderLevel: Number(event.target.value) })} /></FormField></div>
      <FormActions onCancel={() => setOpen(false)} pending={pending} submit="Add to inventory" />
    </form></Modal>}
  </div>;
}

export function LaboratoryPage({ notify }: { notify: Notify }) {
  const { user } = useAuth();
  const [orders, setOrders] = useState<LabOrder[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [patientId, setPatientId] = useState("");
  const [testName, setTestName] = useState("");
  const [pending, setPending] = useState(false);
  const canRequest = ["admin", "doctor", "nurse", "laboratory_technician"].includes(user?.role ?? "");
  const canUpdate = user?.role === "admin" || user?.role === "laboratory_technician";
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setOrders(await api.labOrders()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load lab orders."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (canRequest) api.patients({ pageSize: 100 }).then(result => setPatients(result.data)).catch(reason => setError(reason instanceof Error ? reason.message : "Unable to load patients.")); }, [canRequest]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError("");
    try { await api.createLabOrder({ patientId, testName }); setOpen(false); setPatientId(""); setTestName(""); notify("Laboratory test requested."); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to request test."); }
    finally { setPending(false); }
  }
  async function update(order: LabOrder, status: LabOrder["status"]) {
    try { const changed = await api.updateLabOrder(order.id, status); setOrders(current => current.map(item => item.id === changed.id ? changed : item)); notify("Laboratory order updated."); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update test."); }
  }
  if (error && !orders.length && !loading) return <ErrorState message={error} retry={() => void load()} />;
  return <div className="page-content"><PageHeader title="Laboratory" description="Track diagnostic requests and results across the care team."
    action={canRequest && <Button onClick={() => setOpen(true)}><Plus size={16} /> Request test</Button>} />
    {error && <div className="inline-warning">{error}</div>}
    <Panel className="data-panel"><PanelTitle title="Laboratory orders" description="Recent patient test requests" />
      <DataTable headers={["Patient", "Test", "Requested", "Status", "Next step"]} loading={loading} empty={!loading && !orders.length}>
        {orders.map(order => <tr key={order.id}><td>{order.patientName}</td><td><strong className="table-strong">{order.testName}</strong></td><td>{formatDate(order.createdAt)}</td><td><StatusBadge status={order.status} /></td>
          <td>{canUpdate && order.status !== "Completed" && <button className="text-button" onClick={() => void update(order, order.status === "Requested" ? "In progress" : "Completed")}>{order.status === "Requested" ? "Start test" : "Mark complete"} <ArrowUp size={13} /></button>}</td></tr>)}
      </DataTable>
    </Panel>
    {open && <Modal title="Request laboratory test" onClose={() => setOpen(false)}><form className="app-form" onSubmit={submit}>
      <FormField label="Patient" required><select required value={patientId} onChange={event => setPatientId(event.target.value)}><option value="">Select a patient</option>{patients.map(patient => <option key={patient.id} value={patient.id}>{patient.name} · {patient.patientId}</option>)}</select></FormField>
      <FormField label="Test name" required><input required minLength={2} maxLength={120} value={testName} onChange={event => setTestName(event.target.value)} placeholder="e.g. Complete blood count" /></FormField>
      <FormActions onCancel={() => setOpen(false)} pending={pending} submit="Request test" />
    </form></Modal>}
  </div>;
}

export function SettingsPage({ notify }: { notify: Notify }) {
  const [settings, setSettings] = useState<HospitalSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api.settings().then(setSettings).catch(reason => setError(reason instanceof Error ? reason.message : "Unable to load settings.")).finally(() => setLoading(false));
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!settings) return;
    setPending(true); setError("");
    try { setSettings(await api.updateSettings(settings)); notify("Hospital settings saved."); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save settings."); }
    finally { setPending(false); }
  }
  if (loading) return <div className="loading-state">Loading hospital settings...</div>;
  if (error && !settings) return <ErrorState message={error} />;
  if (!settings) return null;
  return <div className="page-content"><PageHeader title="Hospital settings" description="Manage the facility contact information shown across your workspace." />
    {error && <div className="inline-warning">{error}</div>}
    <Panel className="settings-panel"><PanelTitle title="Facility profile" description="These details are stored securely with your hospital workspace." />
      <form className="app-form settings-form" onSubmit={submit}>
        <FormField label="Hospital name" required><input required minLength={2} maxLength={120} value={settings.hospitalName} onChange={event => setSettings({ ...settings, hospitalName: event.target.value })} /></FormField>
        <div className="form-grid"><FormField label="Contact phone"><input maxLength={30} value={settings.phone} onChange={event => setSettings({ ...settings, phone: event.target.value })} /></FormField><FormField label="Contact email"><input type="email" value={settings.email} onChange={event => setSettings({ ...settings, email: event.target.value })} /></FormField></div>
        <FormField label="Address"><textarea rows={3} maxLength={300} value={settings.address} onChange={event => setSettings({ ...settings, address: event.target.value })} /></FormField>
        <FormField label="Reporting time zone"><select value={settings.timezone} onChange={event => setSettings({ ...settings, timezone: event.target.value })}>{["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Asia/Kolkata", "UTC"].map(timezone => <option key={timezone}>{timezone}</option>)}</select></FormField>
        <div className="settings-save"><span><Building2 size={15} /> Settings apply to this hospital workspace.</span><FormActions onCancel={() => window.location.reload()} pending={pending} submit="Save settings" /></div>
      </form>
    </Panel>
    <div className="security-note"><ShieldCheck size={17} /><span><strong>Security & privacy</strong> Patient data is limited by staff role. Clinical notes are visible only to authorized care team members.</span></div>
  </div>;
}

export function ReportsPage() {
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof api.dashboard>> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api.dashboard().then(setSummary).catch(reason => setError(reason instanceof Error ? reason.message : "Unable to load reports.")); }, []);
  if (error) return <ErrorState message={error} />;
  if (!summary) return <div className="loading-state">Preparing hospital analytics...</div>;
  return <div className="page-content"><PageHeader title="Reports & analytics" description="Operational snapshots for patient visits, admissions, and revenue." />
    <div className="report-intro"><ClipboardList size={20} /><div><strong>Live operational report</strong><span>Statistics are calculated from current hospital records.</span></div><span className="report-stamp">Updated {new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></div>
    <div className="report-kpis"><ReportKpi title="Total patient visits" value={summary.totalPatients.toLocaleString()} helper="Registered patient records" icon={<UsersRound size={18} />} />
      <ReportKpi title="Admissions today" value={String(summary.admissionsToday)} helper="New admissions" icon={<ArrowDown size={18} />} />
      <ReportKpi title="Discharges today" value={String(summary.dischargesToday)} helper="Completed discharges" icon={<ArrowUp size={18} />} />
      <ReportKpi title="Monthly revenue" value={formatCurrency(summary.revenueThisMonth)} helper={`${summary.pendingBills} unpaid invoices`} icon={<Wallet size={18} />} /></div>
    <div className="report-footnote">For date range exports or regulated reporting, verify the selected reporting period and access permissions with your administrator.</div>
  </div>;
}

function ReportKpi({ title, value, helper, icon }: { title: string; value: string; helper: string; icon: React.ReactNode }) {
  return <Panel className="report-kpi"><span className="report-kpi-icon">{icon}</span><span>{title}</span><strong>{value}</strong><small>{helper}</small></Panel>;
}