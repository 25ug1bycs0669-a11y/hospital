export type Role =
  | "admin"
  | "doctor"
  | "receptionist"
  | "nurse"
  | "pharmacist"
  | "laboratory_technician"
  | "accountant";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface Patient {
  id: string;
  patientId: string;
  name: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  gender: string;
  bloodGroup: string;
  createdAt: string;
}

export interface Doctor {
  id: string;
  name: string;
  email: string;
  phone: string;
  specialization: string;
  department: string;
  availability: string;
}

export interface Appointment {
  id: string;
  patientId: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  department: string;
  scheduledAt: string;
  status: "Scheduled" | "Completed" | "Cancelled";
}

export interface Bed {
  id: string;
  ward: string;
  room: string;
  bedNumber: string;
  status: "Available" | "Occupied" | "Maintenance";
  patientName: string | null;
}

export interface Bill {
  id: string;
  invoiceNumber: string;
  patientName: string;
  amount: number;
  status: "Paid" | "Pending" | "Partially paid";
  createdAt: string;
}

export interface DashboardSummary {
  totalPatients: number;
  totalDoctors: number;
  availableBeds: number;
  occupiedBeds: number;
  totalBeds: number;
  appointmentsToday: number;
  admissionsToday: number;
  dischargesToday: number;
  revenueThisMonth: number;
  pendingBills: number;
  visitsTrend: { label: string; visits: number; admissions: number }[];
  revenueTrend: { label: string; revenue: number }[];
}

export interface PageResult<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface Department {
  id: string;
  name: string;
  description: string;
  doctorCount: number;
}

export interface StaffMember extends User {
  active: boolean;
}

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  stock: number;
  reorderLevel: number;
  unit: string;
}

export interface LabOrder {
  id: string;
  patientId: string;
  patientName: string;
  testName: string;
  status: "Requested" | "In progress" | "Completed";
  createdAt: string;
}

export interface HospitalSettings {
  hospitalName: string;
  phone: string;
  email: string;
  address: string;
  timezone: string;
}

export interface BillItem {
  description: string;
  amount: number;
}