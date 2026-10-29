import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { BedDouble, Check, Construction, Plus, UserRound, X } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { Button, DataTable, ErrorState, FormActions, FormField, Modal, PageHeader, Panel, PanelTitle, StatusBadge } from "../components/UI";
import { api } from "../lib/api";
import type { Bed, Patient } from "../types";

export function BedsPage({ notify }: { notify: (message: string) => void }) {
  const { user } = useAuth();
  const [beds, setBeds] = useState<Bed[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selected, setSelected] = useState<Bed | null>(null);
  const [patientId, setPatientId] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const canManage = user?.role === "admin" || user?.role === "nurse";

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setBeds(await api.beds()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load beds."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (canManage) api.patients({ pageSize: 100 }).then(result => setPatients(result.data))
      .catch(reason => setError(reason instanceof Error ? reason.message : "Unable to load patients."));
  }, [canManage]);

  const counts = useMemo(() => ({
    Available: beds.filter(bed => bed.status === "Available").length,
    Occupied: beds.filter(bed => bed.status === "Occupied").length,
    Maintenance: beds.filter(bed => bed.status === "Maintenance").length
  }), [beds]);

  function openBed(bed: Bed, status: Bed["status"]) {
    if (status === "Available" && bed.status === "Occupied" && !window.confirm(`Discharge ${bed.patientName ?? "the patient"} and make this bed available?`)) return;
    if (status === "Maintenance" && bed.status === "Occupied") {
      setError("Discharge the patient before marking this bed for maintenance.");
      return;
    }
    setSelected({ ...bed, status });
    setPatientId(status === "Occupied" ? patients[0]?.id ?? "" : "");
  }

  async function saveBed(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setPending(true); setError("");
    try {
      const updated = await api.updateBed(selected.id, selected.status, selected.status === "Occupied" ? patientId : undefined);
      setBeds(current => current.map(bed => bed.id === updated.id ? updated : bed));
      setSelected(null);
      notify(updated.status === "Occupied" ? "Patient admission recorded." : updated.status === "Available" ? "Bed made available and discharge recorded." : "Bed marked for maintenance.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update bed."); }
    finally { setPending(false); }
  }

  if (error && !beds.length && !loading) return <ErrorState message={error} retry={() => void load()} />;
  return <div className="page-content">
    <PageHeader title="Beds & wards" description="Monitor bed occupancy, patient admissions, and ward availability." />
    {error && <div className="inline-warning">{error}<button onClick={() => setError("")}>Dismiss</button></div>}
    <section className="metric-grid bed-metrics">
      <BedMetric label="Total beds" value={beds.length} icon={<BedDouble size={18} />} tone="blue" />
      <BedMetric label="Available" value={counts.Available} icon={<Check size={18} />} tone="teal" />
      <BedMetric label="Occupied" value={counts.Occupied} icon={<UserRound size={18} />} tone="amber" />
      <BedMetric label="Maintenance" value={counts.Maintenance} icon={<Construction size={18} />} tone="red" />
    </section>
    <Panel className="data-panel">
      <PanelTitle title="Ward bed list" description="Select a bed action to admit, discharge, or flag it for maintenance." />
      <DataTable headers={["Bed", "Ward", "Room", "Patient", "Status", "Actions"]} loading={loading} empty={!loading && !beds.length}>
        {beds.map(bed => <tr key={bed.id}>
          <td><span className="bed-number">{bed.bedNumber}</span></td><td>{bed.ward}</td><td>{bed.room}</td>
          <td>{bed.patientName ?? <span className="muted-cell">Unassigned</span>}</td><td><StatusBadge status={bed.status} /></td>
          <td>{canManage && <div className="row-actions">
            {bed.status !== "Occupied" && <button className="icon-button small success-action" onClick={() => openBed(bed, "Occupied")} aria-label={`Admit patient to ${bed.bedNumber}`}><UserRound size={14} /></button>}
            {bed.status === "Occupied" && <button className="icon-button small" onClick={() => openBed(bed, "Available")} aria-label={`Discharge from ${bed.bedNumber}`}><Check size={14} /></button>}
            {bed.status !== "Maintenance" && bed.status !== "Occupied" && <button className="icon-button small danger-action" onClick={() => openBed(bed, "Maintenance")} aria-label={`Mark ${bed.bedNumber} for maintenance`}><Construction size={14} /></button>}
          </div>}</td>
        </tr>)}
      </DataTable>
    </Panel>
    {selected && <Modal title={selected.status === "Occupied" ? "Admit patient" : selected.status === "Available" ? "Discharge patient" : "Mark for maintenance"} onClose={() => setSelected(null)}>
      <form className="app-form" onSubmit={saveBed}>
        <div className="bed-summary"><BedDouble size={18} /><span><strong>{selected.bedNumber}</strong>{selected.ward} · Room {selected.room}</span></div>
        {selected.status === "Occupied"
          ? <FormField label="Patient to admit" required><select required value={patientId} onChange={event => setPatientId(event.target.value)}><option value="">Select a patient</option>{patients.map(patient => <option value={patient.id} key={patient.id}>{patient.name} · {patient.patientId}</option>)}</select></FormField>
          : <p className="confirm-copy">{selected.status === "Available" ? `Discharge ${selected.patientName ?? "the current patient"} from this bed?` : "This bed will be unavailable until maintenance is completed."}</p>}
        <FormActions onCancel={() => setSelected(null)} pending={pending} submit={selected.status === "Occupied" ? "Confirm admission" : selected.status === "Available" ? "Confirm discharge" : "Confirm maintenance"} />
      </form>
    </Modal>}
  </div>;
}

function BedMetric({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone: string }) {
  return <article className="metric-card"><div className={`metric-icon ${tone}`}>{icon}</div><p>{label}</p><strong>{value}</strong><span>Current hospital capacity</span></article>;
}