import type {
  Appointment,
  Bed,
  BillItem,
  Bill,
  DashboardSummary,
  Department,
  Doctor,
  HospitalSettings,
  InventoryItem,
  LabOrder,
  PageResult,
  Patient,
  Role,
  StaffMember,
  User
} from "../types";

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) {
    throw new ApiError(payload.error ?? "The request could not be completed.", response.status);
  }
  return payload;
}

function queryString(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") query.set(key, String(value));
  });
  const text = query.toString();
  return text ? `?${text}` : "";
}

export const api = {
  login: (email: string, password: string) =>
    request<{ user: User }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<{ success: boolean }>("/auth/logout", { method: "POST" }),
  me: () => request<{ user: User }>("/auth/me"),
  dashboard: () => request<DashboardSummary>("/dashboard"),
  patients: (params: { page?: number; pageSize?: number; search?: string } = {}) =>
    request<PageResult<Patient>>(`/patients${queryString(params)}`),
  createPatient: (data: Omit<Patient, "id" | "patientId" | "createdAt">) =>
    request<Patient>("/patients", { method: "POST", body: JSON.stringify(data) }),
  updatePatient: (id: string, data: Omit<Patient, "id" | "patientId" | "createdAt">) =>
    request<Patient>(`/patients/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(data) }),
  doctors: (params: { page?: number; pageSize?: number; search?: string } = {}) =>
    request<PageResult<Doctor>>(`/doctors${queryString(params)}`),
  createDoctor: (data: Omit<Doctor, "id">) =>
    request<Doctor>("/doctors", { method: "POST", body: JSON.stringify(data) }),
  updateDoctor: (id: string, data: Omit<Doctor, "id">) =>
    request<Doctor>(`/doctors/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(data) }),
  appointments: (params: { page?: number; pageSize?: number; search?: string } = {}) =>
    request<PageResult<Appointment>>(`/appointments${queryString(params)}`),
  createAppointment: (data: { patientId: string; doctorId: string; scheduledAt: string }) =>
    request<Appointment>("/appointments", { method: "POST", body: JSON.stringify(data) }),
  updateAppointment: (id: string, update: { status?: Appointment["status"]; scheduledAt?: string }) =>
    request<Appointment>(`/appointments/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(update)
    }),
  departments: () => request<Department[]>("/departments"),
  beds: () => request<Bed[]>("/beds"),
  updateBed: (id: string, status: Bed["status"], patientId?: string) =>
    request<Bed>(`/beds/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status, ...(patientId ? { patientId } : {}) }) }),
  medicalRecords: (patientId: string) =>
    request<{ id: string; diagnosis: string; prescription: string; allergies: string; testResults: string; treatment: string; createdAt: string }[]>(
      `/records/${encodeURIComponent(patientId)}`
    ),
  bills: (params: { page?: number; pageSize?: number; search?: string } = {}) =>
    request<PageResult<Bill>>(`/bills${queryString(params)}`),
  billDetails: (id: string) => request<{ bill: Bill; items: BillItem[] }>(`/bills/${encodeURIComponent(id)}`),
  createBill: (data: { patientId: string; items: BillItem[] }) =>
    request<Bill>("/bills", { method: "POST", body: JSON.stringify(data) }),
  updateBill: (id: string, status: Bill["status"]) =>
    request<Bill>(`/bills/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status }) }),
  staff: () => request<StaffMember[]>("/staff"),
  createStaff: (data: { name: string; email: string; password: string; role: Role }) =>
    request<StaffMember>("/staff", { method: "POST", body: JSON.stringify(data) }),
  inventory: () => request<InventoryItem[]>("/inventory"),
  createInventory: (data: Omit<InventoryItem, "id">) =>
    request<InventoryItem>("/inventory", { method: "POST", body: JSON.stringify(data) }),
  updateInventory: (id: string, stock: number) =>
    request<InventoryItem>(`/inventory/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ stock }) }),
  labOrders: () => request<LabOrder[]>("/lab-orders"),
  createLabOrder: (data: { patientId: string; testName: string }) =>
    request<LabOrder>("/lab-orders", { method: "POST", body: JSON.stringify(data) }),
  updateLabOrder: (id: string, status: LabOrder["status"]) =>
    request<LabOrder>(`/lab-orders/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status }) }),
  settings: () => request<HospitalSettings>("/settings"),
  updateSettings: (settings: HospitalSettings) =>
    request<HospitalSettings>("/settings", { method: "PUT", body: JSON.stringify(settings) }),
  createMedicalRecord: (patientId: string, data: { diagnosis: string; prescription: string; allergies: string; testResults: string; treatment: string }) =>
    request(`/records/${encodeURIComponent(patientId)}`, { method: "POST", body: JSON.stringify(data) })
};