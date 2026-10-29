CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'doctor', 'receptionist', 'nurse', 'pharmacist', 'laboratory_technician', 'accountant')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text NOT NULL UNIQUE,
  name text NOT NULL,
  email text NOT NULL DEFAULT '',
  phone text NOT NULL,
  date_of_birth date NOT NULL,
  gender text NOT NULL,
  blood_group text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS patients_name_idx ON patients (lower(name));

CREATE TABLE IF NOT EXISTS doctors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  phone text NOT NULL DEFAULT '',
  specialization text NOT NULL,
  department_id uuid NOT NULL REFERENCES departments(id),
  availability text NOT NULL DEFAULT 'Available',
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id),
  doctor_id uuid NOT NULL REFERENCES doctors(id),
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'Scheduled' CHECK (status IN ('Scheduled', 'Completed', 'Cancelled')),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS appointments_scheduled_idx ON appointments (scheduled_at);

CREATE TABLE IF NOT EXISTS beds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ward text NOT NULL,
  room text NOT NULL,
  bed_number text NOT NULL,
  status text NOT NULL DEFAULT 'Available' CHECK (status IN ('Available', 'Occupied', 'Maintenance')),
  patient_id uuid REFERENCES patients(id),
  UNIQUE (ward, room, bed_number)
);

CREATE TABLE IF NOT EXISTS admissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id),
  bed_id uuid NOT NULL REFERENCES beds(id),
  admitted_at timestamptz NOT NULL DEFAULT now(),
  discharged_at timestamptz
);

CREATE TABLE IF NOT EXISTS bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL UNIQUE,
  patient_id uuid NOT NULL REFERENCES patients(id),
  amount numeric(12, 2) NOT NULL CHECK (amount >= 0),
  status text NOT NULL CHECK (status IN ('Paid', 'Pending', 'Partially paid')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bill_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id uuid NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  description text NOT NULL,
  amount numeric(12, 2) NOT NULL CHECK (amount >= 0)
);

CREATE TABLE IF NOT EXISTS inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  category text NOT NULL,
  stock integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  reorder_level integer NOT NULL DEFAULT 10 CHECK (reorder_level >= 0),
  unit text NOT NULL DEFAULT 'units'
);

CREATE TABLE IF NOT EXISTS lab_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id),
  test_name text NOT NULL,
  status text NOT NULL DEFAULT 'Requested' CHECK (status IN ('Requested', 'In progress', 'Completed')),
  requested_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hospital_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  hospital_name text NOT NULL DEFAULT 'CarePoint Hospital',
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  timezone text NOT NULL DEFAULT 'America/New_York',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS medical_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id),
  diagnosis text NOT NULL,
  prescription text NOT NULL DEFAULT '',
  allergies text NOT NULL DEFAULT '',
  test_results text NOT NULL DEFAULT '',
  treatment text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS records_patient_idx ON medical_records (patient_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id bigserial PRIMARY KEY,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs (created_at DESC);