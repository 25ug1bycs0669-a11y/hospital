import { useEffect, useState } from "react";
import { ArrowUpRight, HeartPulse, Brain, Baby, Bone, Siren, Stethoscope } from "lucide-react";
import { ErrorState, Loading, PageHeader, Panel } from "../components/UI";
import { api } from "../lib/api";
import type { Department } from "../types";

const icons = [HeartPulse, Brain, Baby, Bone, Siren, Stethoscope];
const tones = ["tone-blue", "tone-violet", "tone-rose", "tone-amber", "tone-red", "tone-teal"];

export function DepartmentsPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    api.departments().then(setDepartments)
      .catch(reason => setError(reason instanceof Error ? reason.message : "Unable to load departments."))
      .finally(() => setLoading(false));
  }, []);
  if (loading) return <Loading label="Loading departments..." />;
  if (error) return <ErrorState message={error} retry={() => window.location.reload()} />;
  return <div className="page-content">
    <PageHeader title="Departments" description="Explore the specialist teams supporting patient care." />
    <div className="department-grid">
      {departments.map((department, index) => {
        const Icon = icons[index % icons.length];
        return <Panel className="department-card" key={department.id}>
          <div className={`department-icon ${tones[index % tones.length]}`}><Icon size={20} /></div>
          <h2>{department.name}</h2><p>{department.description}</p>
          <div className="department-footer"><span>{department.doctorCount} {department.doctorCount === 1 ? "doctor" : "doctors"}</span><ArrowUpRight size={16} /></div>
        </Panel>;
      })}
    </div>
  </div>;
}