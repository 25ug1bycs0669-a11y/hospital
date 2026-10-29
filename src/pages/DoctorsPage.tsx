import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CalendarDays, Pencil, Plus, Stethoscope } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { Button, DataTable, ErrorState, FormActions, FormField, Modal, PageHeader, Pagination, SearchField, StatusBadge } from "../components/UI";
import { api } from "../lib/api";
import type { Doctor, PageResult } from "../types";

type DoctorForm = Omit<Doctor, "id">;
const blank: DoctorForm = { name: "", email: "", phone: "", specialization: "", department: "Cardiology", availability: "Available" };
const departments = ["Cardiology", "Neurology", "Pediatrics", "Orthopedics", "Emergency", "General Medicine"];

export function DoctorsPage({ notify }: { notify: (message: string) => void }) {
  const { user } = useAuth();
  const [result, setResult] = useState<PageResult<Doctor> | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Doctor | null>(null);
  const [form, setForm] = useState<DoctorForm>(blank);
  const [pending, setPending] = useState(false);
  const canWrite = user?.role === "admin";
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setResult(await api.doctors({ page, pageSize: 8, search: query })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load doctors."); }
    finally { setLoading(false); }
  }, [page, query]);
  useEffect(() => { void load(); }, [load]);

  function showForm(doctor?: Doctor) {
    setEditing(doctor ?? null);
    setForm(doctor ? {
      name: doctor.name, email: doctor.email, phone: doctor.phone,
      specialization: doctor.specialization, department: doctor.department, availability: doctor.availability
    } : blank);
    setOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError("");
    try {
      if (editing) await api.updateDoctor(editing.id, form);
      else await api.createDoctor(form);
      setOpen(false); notify(editing ? "Doctor profile updated." : "Doctor profile added.");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save doctor."); }
    finally { setPending(false); }
  }

  if (error && !result) return <ErrorState message={error} retry={() => void load()} />;
  return <div className="page-content">
    <PageHeader title="Doctor management" description="Browse your medical team, specialties, and availability."
      action={canWrite && <Button onClick={() => showForm()}><Plus size={16} /> Add doctor</Button>} />
    <section className="panel data-panel">
      <div className="toolbar"><SearchField value={query} onChange={value => { setPage(1); setQuery(value); }} placeholder="Search doctors or specialties..." /><span className="panel-note">{result?.total ?? 0} active doctors</span></div>
      {error && <div className="inline-warning">{error}<button onClick={() => void load()}>Retry</button></div>}
      <DataTable headers={["Doctor", "Specialization", "Department", "Contact", "Availability", "Actions"]} loading={loading} empty={!loading && !result?.data.length}>
        {result?.data.map(doctor => <tr key={doctor.id}>
          <td><span className="person-cell"><span className="doctor-avatar"><Stethoscope size={16} /></span><strong>{doctor.name}</strong></span></td>
          <td>{doctor.specialization}</td><td><span className="dept-chip">{doctor.department}</span></td>
          <td><span className="contact-cell">{doctor.phone}<small>{doctor.email}</small></span></td>
          <td><StatusBadge status={doctor.availability} /></td>
          <td>{canWrite && <button className="icon-button small" onClick={() => showForm(doctor)} aria-label={`Edit ${doctor.name}`}><Pencil size={14} /></button>}</td>
        </tr>)}
      </DataTable>
      {result && <Pagination page={result.page} pageSize={result.pageSize} total={result.total} onPage={setPage} />}
    </section>
    <section className="callout-note"><CalendarDays size={17} /><p><strong>Schedule management</strong><span>Appointments booked here update the doctor’s daily schedule automatically.</span></p></section>
    {open && <Modal title={editing ? "Update doctor profile" : "Add doctor profile"} onClose={() => setOpen(false)}>
      <form className="app-form" onSubmit={submit}>
        <FormField label="Full name" required><input required minLength={2} maxLength={100} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></FormField>
        <div className="form-grid"><FormField label="Email address" required><input type="email" required maxLength={254} value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></FormField>
          <FormField label="Phone number" required><input required minLength={7} maxLength={30} value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} /></FormField></div>
        <FormField label="Specialization" required><input required minLength={2} maxLength={100} value={form.specialization} onChange={event => setForm({ ...form, specialization: event.target.value })} placeholder="e.g. Cardiologist" /></FormField>
        <div className="form-grid"><FormField label="Department" required><select value={form.department} onChange={event => setForm({ ...form, department: event.target.value })}>{departments.map(item => <option key={item}>{item}</option>)}</select></FormField>
          <FormField label="Availability"><select value={form.availability} onChange={event => setForm({ ...form, availability: event.target.value })}><option>Available</option><option>In consultation</option><option>On leave</option></select></FormField></div>
        <FormActions onCancel={() => setOpen(false)} pending={pending} submit={editing ? "Save profile" : "Add doctor"} />
      </form>
    </Modal>}
  </div>;
}