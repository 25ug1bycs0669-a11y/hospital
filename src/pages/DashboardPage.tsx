import { useCallback, useEffect, useState } from "react";
import {
  Activity, BedDouble, CalendarDays, CalendarPlus, CircleDollarSign,
  ClipboardPlus, DoorOpen, UsersRound, UserRound, AlertTriangle
} from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
  Bar, BarChart
} from "recharts";
import { api } from "../lib/api";
import type { Appointment, DashboardSummary, PageResult, Patient } from "../types";
import { Button, ErrorState, formatCurrency, formatDate, Loading, Panel, PanelTitle, StatusBadge } from "../components/UI";

interface DashboardData {
  summary: DashboardSummary;
  patients: PageResult<Patient>;
  appointments: PageResult<Appointment>;
}

export function DashboardPage({ onNewAppointment }: { onNewAppointment?: () => void }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [summary, patients, appointments] = await Promise.all([
        api.dashboard(),
        api.patients({ page: 1, pageSize: 5 }),
        api.appointments({ page: 1, pageSize: 5 })
      ]);
      setData({ summary, patients, appointments });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load dashboard.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  if (loading && !data) return <Loading label="Loading your dashboard..." />;
  if (error && !data) return <ErrorState message={error} retry={() => void load()} />;
  if (!data) return null;

  const { summary, patients, appointments } = data;
  const occupancy = summary.totalBeds ? Math.round((summary.occupiedBeds / summary.totalBeds) * 100) : 0;
  const metrics = [
    { title: "Total patients", value: summary.totalPatients.toLocaleString(), detail: "Registered patient records", icon: UsersRound, tone: "blue" },
    { title: "Medical team", value: summary.totalDoctors.toLocaleString(), detail: "Active doctors", icon: UserRound, tone: "teal" },
    { title: "Available beds", value: summary.availableBeds.toLocaleString(), detail: `${occupancy}% ward occupancy`, icon: BedDouble, tone: "violet" },
    { title: "Appointments today", value: summary.appointmentsToday.toLocaleString(), detail: "Scheduled for today", icon: CalendarDays, tone: "amber" }
  ];

  return <div className="page-content">
    <header className="welcome-strip">
      <div><p className="eyebrow">{new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(new Date())}</p>
        <h1>Good morning, care team <span aria-hidden="true">✦</span></h1>
        <p>Here is your hospital at a glance.</p></div>
      {onNewAppointment && <Button onClick={onNewAppointment}><CalendarPlus size={16} /> New appointment</Button>}
    </header>

    {error && <div className="inline-warning"><AlertTriangle size={15} />{error}<button onClick={() => void load()}>Retry</button></div>}
    <section className="metric-grid" aria-label="Hospital overview">
      {metrics.map(({ title, value, detail, icon: Icon, tone }) => <article className="metric-card" key={title}>
        <div className={`metric-icon ${tone}`}><Icon size={19} strokeWidth={1.8} /></div>
        <p>{title}</p><strong>{value}</strong><span>{detail}</span>
      </article>)}
    </section>

    <section className="summary-strip">
      <div><span className="summary-icon green"><ClipboardPlus size={17} /></span><span>Admissions today</span><strong>{summary.admissionsToday}</strong></div>
      <div><span className="summary-icon blue"><DoorOpen size={17} /></span><span>Discharges today</span><strong>{summary.dischargesToday}</strong></div>
      <div><span className="summary-icon amber"><CircleDollarSign size={17} /></span><span>Revenue this month</span><strong>{formatCurrency(summary.revenueThisMonth)}</strong></div>
      <div><span className="summary-icon red"><Activity size={17} /></span><span>Pending invoices</span><strong>{summary.pendingBills}</strong></div>
    </section>

    <section className="dashboard-grid">
      <Panel>
        <PanelTitle title="Patient activity" description="Visits and admissions across the last 7 days" action={<span className="chart-period">Last 7 days</span>} />
        <div className="chart-legend"><span><i className="legend-blue" /> Patient visits</span><span><i className="legend-teal" /> Admissions</span></div>
        <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%">
          <AreaChart data={summary.visitsTrend} margin={{ top: 8, right: 4, bottom: 0, left: -20 }}>
            <defs><linearGradient id="visitFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#5285e8" stopOpacity={0.17} /><stop offset="95%" stopColor="#5285e8" stopOpacity={0} /></linearGradient></defs>
            <CartesianGrid stroke="#eef1f5" strokeDasharray="3 4" vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#95a0b1", fontSize: 11 }} />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: "#95a0b1", fontSize: 10 }} allowDecimals={false} />
            <Tooltip contentStyle={{ border: "1px solid #e8edf4", borderRadius: 10, fontSize: 12, boxShadow: "0 6px 20px #19314d14" }} />
            <Area type="monotone" dataKey="visits" name="Patient visits" stroke="#5285e8" fill="url(#visitFill)" strokeWidth={2.5} />
            <Area type="monotone" dataKey="admissions" name="Admissions" stroke="#50b99c" fill="transparent" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer></div>
      </Panel>
      <Panel>
        <PanelTitle title="Revenue overview" description="Paid invoices, last 6 months" />
        <div className="chart-wrap compact-chart"><ResponsiveContainer width="100%" height="100%">
          <BarChart data={summary.revenueTrend} margin={{ top: 12, right: 1, left: -23, bottom: 0 }}>
            <CartesianGrid stroke="#eef1f5" strokeDasharray="3 4" vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#95a0b1", fontSize: 10 }} />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: "#95a0b1", fontSize: 9 }} />
            <Tooltip formatter={(value) => formatCurrency(Number(value))} contentStyle={{ border: "1px solid #e8edf4", borderRadius: 10, fontSize: 12 }} />
            <Bar dataKey="revenue" name="Revenue" fill="#50b99c" radius={[5, 5, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer></div>
        <div className="revenue-total"><span>This month</span><strong>{formatCurrency(summary.revenueThisMonth)}</strong></div>
      </Panel>
    </section>

    <section className="dashboard-grid lower-grid">
      <Panel className="table-panel">
        <PanelTitle title="Recent registrations" description="Newest patient records" action={<span className="panel-note">{patients.total} patients</span>} />
        <div className="mini-list">
          {patients.data.map(patient => <div className="mini-row" key={patient.id}>
            <span className="person-avatar">{initials(patient.name)}</span><span className="mini-person"><strong>{patient.name}</strong><small>{patient.patientId} · {patient.gender}</small></span><span className="mini-date">{formatDate(patient.createdAt)}</span>
          </div>)}
          {!patients.data.length && <div className="mini-empty">No patient registrations yet.</div>}
        </div>
      </Panel>
      <Panel className="table-panel">
        <PanelTitle title="Upcoming appointments" description="Next scheduled patient visits" action={<span className="panel-note">{appointments.total} total</span>} />
        <div className="mini-list">
          {appointments.data.filter(appointment => appointment.status === "Scheduled").slice(0, 4).map(appointment => <div className="appointment-row" key={appointment.id}>
            <div className="appointment-date"><strong>{new Intl.DateTimeFormat("en", { day: "2-digit" }).format(new Date(appointment.scheduledAt))}</strong><small>{new Intl.DateTimeFormat("en", { month: "short" }).format(new Date(appointment.scheduledAt))}</small></div>
            <span className="mini-person"><strong>{appointment.patientName}</strong><small>{appointment.doctorName} · {new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(appointment.scheduledAt))}</small></span>
            <StatusBadge status={appointment.status} />
          </div>)}
          {!appointments.data.some(appointment => appointment.status === "Scheduled") && <div className="mini-empty">No upcoming appointments to show.</div>}
        </div>
      </Panel>
    </section>
  </div>;
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
}
