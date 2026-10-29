import { useEffect, useState, type FormEvent } from "react";
import { FileHeart, FilePlus2, LockKeyhole, Plus } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { Button, DataTable, ErrorState, FormActions, FormField, Loading, Modal, PageHeader, Panel, PanelTitle, StatusBadge, formatDate } from "../components/UI";
import { api } from "../lib/api";
import type { Patient } from "../types";

type ClinicalRecord = { id: string; diagnosis: string; prescription: string; allergies: string; testResults: string; treatment: string; createdAt: string };
const emptyForm = { diagnosis: "", prescription: "", allergies: "", testResults: "", treatment: "" };

export function ClinicalPages({ notify }: { notify: (message: string) => void }) {
  const { user } = useAuth();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [records, setRecords] = useState<ClinicalRecord[]>([]);
  const [loadingPatients, setLoadingPatients] = useState(true);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const canWrite = ["admin", "doctor", "nurse"].includes(user?.role ?? "");

  useEffect(() => {
    api.patients({ pageSize: 100 }).then(result => {
      setPatients(result.data);
      if (result.data[0]) setSelectedId(result.data[0].id);
    }).catch(reason => setError(reason instanceof Error ? reason.message : "Unable to load patients.")).finally(() => setLoadingPatients(false));
  }, []);

  useEffect(() => {
    if (!selectedId) { setRecords([]); return; }
    let active = true;
    setLoadingRecords(true); setError("");
    api.medicalRecords(selectedId).then(result => { if (active) setRecords(result); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Unable to load medical records."); })
      .finally(() => { if (active) setLoadingRecords(false); });
    return () => { active = false; };
  }, [selectedId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId) return;
    setPending(true); setError("");
    try {
      await api.createMedicalRecord(selectedId, form);
      setOpen(false); setForm(emptyForm); notify("Clinical note saved securely.");
      const updated = await api.medicalRecords(selectedId); setRecords(updated);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save clinical note."); }
    finally { setPending(false); }
  }

  if (loadingPatients) return <Loading label="Loading patient records..." />;
  if (error && !patients.length) return <ErrorState message={error} />;
  const selected = patients.find(patient => patient.id === selectedId);
  return <div className="page-content">
    <PageHeader title="Electronic medical records" description="Review patient diagnoses, allergies, prescriptions, and treatment history."
      action={canWrite && selected && <Button onClick={() => setOpen(true)}><FilePlus2 size={16} /> Add clinical note</Button>} />
    <div className="privacy-banner"><LockKeyhole size={17} /><span><strong>Confidential clinical information.</strong> Access is restricted by role and recorded in the system audit log.</span><StatusBadge status={user?.role.replaceAll("_", " ") ?? "Staff"} /></div>
    {error && <div className="inline-warning">{error}<button onClick={() => setError("")}>Dismiss</button></div>}
    <section className="clinical-layout">
      <Panel className="clinical-patient-panel"><PanelTitle title="Patients" description="Select a record to review" />
        <div className="clinical-patient-list">{patients.map(patient => <button key={patient.id} className={`clinical-patient ${selectedId === patient.id ? "selected" : ""}`} onClick={() => setSelectedId(patient.id)}>
          <span className="person-avatar">{initials(patient.name)}</span><span><strong>{patient.name}</strong><small>{patient.patientId}</small></span></button>)}</div>
      </Panel>
      <Panel className="clinical-record-panel">{selected ? <>
        <div className="clinical-profile"><span className="person-avatar large">{initials(selected.name)}</span><div><h2>{selected.name}</h2><p>{selected.patientId} · {selected.gender} · {selected.bloodGroup || "Blood group not recorded"}</p></div></div>
        <div className="record-list-heading"><div><h3>Clinical history</h3><p>Diagnoses and treatment notes</p></div><span>{records.length} {records.length === 1 ? "entry" : "entries"}</span></div>
        {loadingRecords ? <Loading label="Loading clinical history..." /> : records.length ? <div className="record-list">
          {records.map(record => <article className="record-entry" key={record.id}><header><span className="record-entry-icon"><FileHeart size={16} /></span><div><strong>{record.diagnosis}</strong><small>{formatDate(record.createdAt, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</small></div></header>
            <div className="record-fields">{record.allergies && <RecordField label="Allergies" value={record.allergies} />}{record.prescription && <RecordField label="Prescription" value={record.prescription} />}{record.treatment && <RecordField label="Treatment" value={record.treatment} />}{record.testResults && <RecordField label="Test results" value={record.testResults} />}</div>
          </article>)}
        </div> : <div className="clinical-empty"><span><FileHeart size={22} /></span><strong>No clinical notes yet</strong><p>Authorized care team members can add diagnoses and treatment information.</p>{canWrite && <Button variant="secondary" onClick={() => setOpen(true)}><Plus size={15} /> Add first note</Button>}</div>}
      </> : <Loading label="Select a patient to view records..." />}</Panel>
    </section>
    {open && selected && <Modal title={`Add clinical note · ${selected.name}`} onClose={() => setOpen(false)} wide>
      <form className="app-form" onSubmit={submit}>
        <FormField label="Diagnosis" required><textarea required minLength={1} maxLength={500} rows={2} value={form.diagnosis} onChange={event => setForm({ ...form, diagnosis: event.target.value })} /></FormField>
        <div className="form-grid"><FormField label="Allergies"><textarea maxLength={1000} rows={2} value={form.allergies} onChange={event => setForm({ ...form, allergies: event.target.value })} /></FormField>
          <FormField label="Prescription"><textarea maxLength={2000} rows={2} value={form.prescription} onChange={event => setForm({ ...form, prescription: event.target.value })} /></FormField></div>
        <div className="form-grid"><FormField label="Treatment"><textarea maxLength={2000} rows={3} value={form.treatment} onChange={event => setForm({ ...form, treatment: event.target.value })} /></FormField>
          <FormField label="Test results"><textarea maxLength={2000} rows={3} value={form.testResults} onChange={event => setForm({ ...form, testResults: event.target.value })} /></FormField></div>
        <FormActions onCancel={() => setOpen(false)} pending={pending} submit="Save clinical note" />
      </form>
    </Modal>}
  </div>;
}

function RecordField({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><p>{value}</p></div>;
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
}