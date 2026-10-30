import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CalendarPlus, Check, Clock3, Pencil, XCircle } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { Button, DataTable, ErrorState, FormActions, FormField, Modal, PageHeader, Pagination, SearchField, StatusBadge, formatDate } from "../components/UI";
import { api } from "../lib/api";
import type { Appointment, Doctor, PageResult, Patient } from "../types";

type Notify = (message: string) => void;
type Booking = { patientId: string; doctorId: string; date: string; time: string };
const emptyBooking: Booking = { patientId: "", doctorId: "", date: "", time: "" };

export function AppointmentsPage({ notify }: { notify: Notify }) {
  const { user } = useAuth();
  const [result, setResult] = useState<PageResult<Appointment> | null>(null);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [rescheduling, setRescheduling] = useState<Appointment | null>(null);
  const [form, setForm] = useState<Booking>(emptyBooking);
  const [pending, setPending] = useState(false);
  const canWrite = ["admin", "doctor", "receptionist"].includes(user?.role ?? "");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setResult(await api.appointments({ page, pageSize: 8, search: query })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load appointments."); }
    finally { setLoading(false); }
  }, [page, query]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!canWrite) return;
    Promise.all([api.patients({ pageSize: 100 }), api.doctors({ pageSize: 100 })])
      .then(([patientData, doctorData]) => { setPatients(patientData.data); setDoctors(doctorData.data); })
      .catch(reason => setError(reason instanceof Error ? reason.message : "Unable to load booking lists."));
  }, [canWrite]);

  function showBooking(appointment?: Appointment) {
    setRescheduling(appointment ?? null);
    if (appointment) {
      const local = new Date(appointment.scheduledAt);
      setForm({ patientId: appointment.patientId, doctorId: appointment.doctorId, date: localDate(local), time: `${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}` });
    } else setForm(emptyBooking);
    setOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError("");
    try {
      const scheduledAt = new Date(`${form.date}T${form.time}`).toISOString();
      if (rescheduling) await api.updateAppointment(rescheduling.id, { scheduledAt });
      else await api.createAppointment({ patientId: form.patientId, doctorId: form.doctorId, scheduledAt });
      setOpen(false);
      notify(rescheduling ? "Appointment rescheduled." : "Appointment booked successfully.");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save appointment."); }
    finally { setPending(false); }
  }

  async function changeStatus(appointment: Appointment, status: Appointment["status"]) {
    const message = status === "Cancelled" ? "Cancel this appointment?" : "Mark this appointment as completed?";
    if (!window.confirm(message)) return;
    try {
      await api.updateAppointment(appointment.id, { status });
      notify(status === "Cancelled" ? "Appointment cancelled." : "Appointment completed.");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update appointment."); }
  }

  if (error && !result) return <ErrorState message={error} retry={() => void load()} />;
  return <div className="page-content">
    <PageHeader title="Appointments" description="Book and coordinate visits across your care team."
      action={canWrite && <Button onClick={() => showBooking()}><CalendarPlus size={16} /> Book appointment</Button>} />
    <section className="panel data-panel">
      <div className="toolbar"><SearchField value={query} onChange={value => { setPage(1); setQuery(value); }} placeholder="Search patient, doctor, or department..." />
        <div className="status-key"><StatusBadge status="Scheduled" /><StatusBadge status="Completed" /><StatusBadge status="Cancelled" /></div></div>
      {error && <div className="inline-warning">{error}<button onClick={() => void load()}>Retry</button></div>}
      <DataTable headers={["Patient", "Doctor", "Department", "Date & time", "Status", "Actions"]} loading={loading} empty={!loading && !result?.data.length}>
        {result?.data.map(appointment => <tr key={appointment.id}>
          <td><span className="person-cell"><span className="person-avatar">{initials(appointment.patientName)}</span><strong>{appointment.patientName}</strong></span></td>
          <td>{appointment.doctorName}</td><td><span className="dept-chip">{appointment.department}</span></td>
          <td><span className="contact-cell">{formatDate(appointment.scheduledAt)}<small>{new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(appointment.scheduledAt))}</small></span></td>
          <td><StatusBadge status={appointment.status} /></td>
          <td>{canWrite && appointment.status === "Scheduled" && <div className="row-actions">
            <button className="icon-button small" onClick={() => showBooking(appointment)} aria-label={`Reschedule appointment for ${appointment.patientName}`}><Pencil size={14} /></button>
            <button className="icon-button small success-action" onClick={() => void changeStatus(appointment, "Completed")} aria-label="Mark appointment complete"><Check size={15} /></button>
            <button className="icon-button small danger-action" onClick={() => void changeStatus(appointment, "Cancelled")} aria-label="Cancel appointment"><XCircle size={15} /></button>
          </div>}</td>
        </tr>)}
      </DataTable>
      {result && <Pagination page={result.page} pageSize={result.pageSize} total={result.total} onPage={setPage} />}
    </section>
    <div className="schedule-tip"><Clock3 size={17} /><span><strong>Keep your schedule in sync.</strong> Reschedule or update a visit right from this list.</span></div>
    {open && <Modal title={rescheduling ? "Reschedule appointment" : "Book an appointment"} onClose={() => setOpen(false)}>
      <form className="app-form" onSubmit={submit}>
        <FormField label="Patient" required><select required disabled={Boolean(rescheduling)} value={form.patientId} onChange={event => setForm({ ...form, patientId: event.target.value })}><option value="">Select a patient</option>{patients.map(patient => <option value={patient.id} key={patient.id}>{patient.name} · {patient.patientId}</option>)}</select></FormField>
        <FormField label="Doctor" required><select required disabled={Boolean(rescheduling)} value={form.doctorId} onChange={event => setForm({ ...form, doctorId: event.target.value })}><option value="">Select a doctor</option>{doctors.map(doctor => <option value={doctor.id} key={doctor.id}>{doctor.name} · {doctor.specialization}</option>)}</select></FormField>
        <div className="form-grid"><FormField label="Date" required><input type="date" required min={new Date().toISOString().slice(0, 10)} value={form.date} onChange={event => setForm({ ...form, date: event.target.value })} /></FormField>
          <FormField label="Time" required><input type="time" required value={form.time} onChange={event => setForm({ ...form, time: event.target.value })} /></FormField></div>
        <FormActions onCancel={() => setOpen(false)} pending={pending} submit={rescheduling ? "Save new time" : "Book appointment"} />
      </form>
    </Modal>}
  </div>;
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
}

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}