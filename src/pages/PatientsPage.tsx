import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Eye, Pencil, Plus } from "lucide-react";
import { api } from "../lib/api";
import type { PageResult, Patient } from "../types";
import { useAuth } from "../auth/AuthContext";
import {
  Button, DataTable, ErrorState, FormActions, FormField, Loading, Modal,
  PageHeader, Pagination, SearchField, StatusBadge, formatDate
} from "../components/UI";

type PatientFormValue = Omit<Patient, "id" | "patientId" | "createdAt">;
type Notify = (message: string) => void;

const emptyForm: PatientFormValue = {
  name: "", email: "", phone: "", dateOfBirth: "", gender: "Prefer not to say", bloodGroup: "Unknown"
};

export function PatientsPage({ notify }: { notify: Notify }) {
  const { user } = useAuth();
  const [result, setResult] = useState<PageResult<Patient> | null>(null);
  const [selected, setSelected] = useState<Patient | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Patient | null>(null);
  const [form, setForm] = useState<PatientFormValue>(emptyForm);
  const [pending, setPending] = useState(false);
  const canWrite = user?.role === "admin" || user?.role === "receptionist";

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try { setResult(await api.patients({ page, pageSize: 8, search: query })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load patients."); }
    finally { setLoading(false); }
  }, [page, query]);
  useEffect(() => { void load(); }, [load]);

  function startForm(patient?: Patient) {
    setEditing(patient ?? null);
    setForm(patient ? {
      name: patient.name, email: patient.email, phone: patient.phone,
      dateOfBirth: patient.dateOfBirth, gender: patient.gender, bloodGroup: patient.bloodGroup || "Unknown"
    } : emptyForm);
    setModal(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      if (editing) await api.updatePatient(editing.id, form);
      else await api.createPatient(form);
      setModal(false);
      notify(editing ? "Patient details updated." : "Patient registered successfully.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save patient.");
    } finally { setPending(false); }
  }

  if (error && !result) return <ErrorState message={error} retry={() => void load()} />;
  const canReadRecords = ["admin", "doctor", "nurse"].includes(user?.role ?? "");

  return <div className="page-content">
    <PageHeader title="Patient management" description="Register, search and manage patient information."
      action={canWrite && <Button onClick={() => startForm()}><Plus size={16} /> Register patient</Button>} />
    <section className="panel data-panel">
      <div className="toolbar"><SearchField value={query} onChange={value => { setPage(1); setQuery(value); }} placeholder="Search patients by name, ID, or phone..." />
        <span className="panel-note">{result?.total ?? 0} patient records</span></div>
      {error && <div className="inline-warning">{error}<button onClick={() => void load()}>Retry</button></div>}
      <DataTable headers={["Patient", "Patient ID", "Contact", "Date of birth", "Blood group", "Registered", "Actions"]} loading={loading} empty={!loading && !result?.data.length}>
        {result?.data.map(patient => <tr key={patient.id}>
          <td><span className="person-cell"><span className="person-avatar">{initials(patient.name)}</span><strong>{patient.name}</strong></span></td>
          <td><span className="id-chip">{patient.patientId}</span></td><td><span className="contact-cell">{patient.phone}<small>{patient.email || "No email provided"}</small></span></td>
          <td>{formatDate(patient.dateOfBirth)}</td><td><span className="blood-chip">{patient.bloodGroup || "—"}</span></td><td>{formatDate(patient.createdAt)}</td>
          <td><div className="row-actions"><button className="icon-button small" onClick={() => setSelected(patient)} aria-label={`View ${patient.name}`}><Eye size={15} /></button>
            {canWrite && <button className="icon-button small" onClick={() => startForm(patient)} aria-label={`Edit ${patient.name}`}><Pencil size={14} /></button>}</div></td>
        </tr>)}
      </DataTable>
      {result && <Pagination page={result.page} pageSize={result.pageSize} total={result.total} onPage={setPage} />}
    </section>

    {modal && <Modal title={editing ? "Update patient" : "Register new patient"} onClose={() => setModal(false)}>
      <form className="app-form" onSubmit={submit}>
        <FormField label="Full name" required><input required minLength={2} maxLength={100} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></FormField>
        <div className="form-grid"><FormField label="Phone number" required><input required minLength={7} maxLength={30} autoComplete="tel" value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} /></FormField>
          <FormField label="Email address"><input type="email" maxLength={254} autoComplete="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></FormField></div>
        <div className="form-grid"><FormField label="Date of birth" required><input type="date" required max={new Date().toISOString().slice(0, 10)} value={form.dateOfBirth} onChange={event => setForm({ ...form, dateOfBirth: event.target.value })} /></FormField>
          <FormField label="Gender"><select value={form.gender} onChange={event => setForm({ ...form, gender: event.target.value })}><option>Prefer not to say</option><option>Female</option><option>Male</option><option>Other</option></select></FormField></div>
        <FormField label="Blood group"><select value={form.bloodGroup} onChange={event => setForm({ ...form, bloodGroup: event.target.value })}><option>Unknown</option>{["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map(value => <option key={value}>{value}</option>)}</select></FormField>
        <FormActions onCancel={() => setModal(false)} pending={pending} submit={editing ? "Save patient" : "Register patient"} />
      </form>
    </Modal>}

    {selected && <PatientDetail patient={selected} canReadRecords={canReadRecords} onClose={() => setSelected(null)} onEdit={canWrite ? () => { const patient = selected; setSelected(null); startForm(patient); } : undefined} />}
  </div>;
}

function PatientDetail({ patient, canReadRecords, onClose, onEdit }: { patient: Patient; canReadRecords: boolean; onClose: () => void; onEdit?: () => void }) {
  const [records, setRecords] = useState<{ id: string; diagnosis: string; prescription: string; allergies: string; testResults: string; treatment: string; createdAt: string }[] | null>(null);
  const [recordError, setRecordError] = useState("");
  useEffect(() => {
    if (!canReadRecords) return;
    api.medicalRecords(patient.id).then(setRecords).catch(reason => setRecordError(reason instanceof Error ? reason.message : "Unable to load medical records."));
  }, [patient.id, canReadRecords]);
  return <Modal title="Patient profile" onClose={onClose} wide>
    <div className="patient-profile">
      <div className="profile-hero"><span className="person-avatar large">{initials(patient.name)}</span><div><h3>{patient.name}</h3><span>{patient.patientId} <StatusBadge status="Registered" /></span></div>{onEdit && <Button variant="secondary" onClick={onEdit}><Pencil size={14} /> Edit details</Button>}</div>
      <div className="detail-grid"><Detail label="Phone" value={patient.phone} /><Detail label="Email" value={patient.email || "Not provided"} /><Detail label="Date of birth" value={formatDate(patient.dateOfBirth)} /><Detail label="Gender" value={patient.gender} /><Detail label="Blood group" value={patient.bloodGroup || "Not recorded"} /><Detail label="Patient since" value={formatDate(patient.createdAt)} /></div>
      <div className="record-section"><h3>Medical history</h3>
        {!canReadRecords ? <p className="privacy-note">Your role does not have access to clinical notes.</p>
          : recordError ? <p className="error-copy">{recordError}</p>
            : records === null ? <Loading label="Loading clinical history..." />
              : records.length ? records.map(record => <article className="record-card" key={record.id}><span>{formatDate(record.createdAt)}</span><strong>{record.diagnosis}</strong>{record.allergies && <p><b>Allergies:</b> {record.allergies}</p>}{record.prescription && <p><b>Prescription:</b> {record.prescription}</p>}{record.treatment && <p><b>Treatment:</b> {record.treatment}</p>}{record.testResults && <p><b>Test results:</b> {record.testResults}</p>}</article>)
                : <p className="privacy-note">No clinical notes have been added to this patient profile.</p>}
      </div>
    </div>
  </Modal>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="detail-item"><span>{label}</span><strong>{value}</strong></div>;
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
}