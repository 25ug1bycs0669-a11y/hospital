import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { authenticate, cookieOptions, createSession, deleteSession, sessionCookie } from "./auth";
import { pool } from "./db";
import { allow } from "./permissions";

export const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Try again in 15 minutes." }
});

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200)
});

router.post("/auth/login", loginLimiter, async (req, res, next) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid email address and password." });
    return;
  }
  try {
    const result = await pool.query<{
      id: string; name: string; email: string; role: "admin" | "doctor" | "receptionist" | "nurse" | "pharmacist" | "laboratory_technician" | "accountant";
      password_hash: string;
    }>("SELECT id, name, email, role, password_hash FROM users WHERE lower(email) = lower($1) AND active = true", [parsed.data.email]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(parsed.data.password, user.password_hash))) {
      res.status(401).json({ error: "Email or password is incorrect." });
      return;
    }
    const token = await createSession(user.id);
    res.cookie(sessionCookie, token, cookieOptions());
    await pool.query("INSERT INTO audit_logs (actor_id, action, resource_type) VALUES ($1, 'login', 'session')", [user.id]);
    res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (error) {
    next(error);
  }
});

router.post("/auth/logout", authenticate, async (req, res, next) => {
  try {
    const token = req.cookies?.[sessionCookie] as string | undefined;
    if (token) await deleteSession(token);
    res.clearCookie(sessionCookie, cookieOptions());
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.get("/auth/me", authenticate, (req, res) => res.json({ user: req.user }));

router.use(authenticate);

function pageParams(query: Record<string, unknown>) {
  const page = Math.max(1, Math.min(10_000, Number(query.page) || 1));
  const pageSize = Math.max(1, Math.min(100, Number(query.pageSize) || 8));
  const search = typeof query.search === "string" ? query.search.trim().slice(0, 100) : "";
  return { page, pageSize, search, offset: (page - 1) * pageSize };
}

async function recordAudit(actorId: string, action: string, resource: string, id?: string): Promise<void> {
  await pool.query(
    "INSERT INTO audit_logs (actor_id, action, resource_type, resource_id) VALUES ($1, $2, $3, $4)",
    [actorId, action, resource, id ?? null]
  );
}

router.get("/dashboard", allow("admin", "doctor", "receptionist", "nurse", "pharmacist", "laboratory_technician", "accountant"), async (_req, res, next) => {
  try {
    const [totals, visitTrend, revenueTrend] = await Promise.all([
      pool.query(
        `SELECT
          (SELECT count(*)::int FROM patients) AS "totalPatients",
          (SELECT count(*)::int FROM doctors WHERE active = true) AS "totalDoctors",
          (SELECT count(*)::int FROM beds WHERE status = 'Available') AS "availableBeds",
          (SELECT count(*)::int FROM beds WHERE status = 'Occupied') AS "occupiedBeds",
          (SELECT count(*)::int FROM beds) AS "totalBeds",
          (SELECT count(*)::int FROM appointments WHERE scheduled_at::date = current_date AND status = 'Scheduled') AS "appointmentsToday",
          (SELECT count(*)::int FROM admissions WHERE admitted_at::date = current_date) AS "admissionsToday",
          (SELECT count(*)::int FROM admissions WHERE discharged_at::date = current_date) AS "dischargesToday",
          (SELECT coalesce(sum(amount), 0)::float FROM bills WHERE status = 'Paid' AND created_at >= date_trunc('month', current_date)) AS "revenueThisMonth",
          (SELECT count(*)::int FROM bills WHERE status != 'Paid') AS "pendingBills"`
      ),
      pool.query(
        `SELECT to_char(days.day, 'Dy') AS label,
          (SELECT count(*)::int FROM appointments a WHERE a.scheduled_at::date = days.day) AS visits,
          (SELECT count(*)::int FROM admissions a WHERE a.admitted_at::date = days.day) AS admissions
         FROM generate_series(current_date - interval '6 days', current_date, interval '1 day') days(day)
         ORDER BY days.day`
      ),
      pool.query(
        `SELECT to_char(months.month, 'Mon') AS label,
          coalesce((SELECT sum(b.amount)::float FROM bills b WHERE b.status = 'Paid'
            AND date_trunc('month', b.created_at) = months.month), 0)::float AS revenue
         FROM generate_series(date_trunc('month', current_date) - interval '5 months',
           date_trunc('month', current_date), interval '1 month') months(month)
         ORDER BY months.month`
      )
    ]);
    res.json({ ...totals.rows[0], visitsTrend: visitTrend.rows, revenueTrend: revenueTrend.rows });
  } catch (error) {
    next(error);
  }
});

router.get("/patients", allow("admin", "doctor", "receptionist", "nurse", "pharmacist", "laboratory_technician"), async (req, res, next) => {
  try {
    const { page, pageSize, search, offset } = pageParams(req.query);
    const term = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    const [data, count] = await Promise.all([
      pool.query(
        `SELECT id, patient_id AS "patientId", name, email, phone,
          to_char(date_of_birth, 'YYYY-MM-DD') AS "dateOfBirth", gender, blood_group AS "bloodGroup",
          created_at AS "createdAt"
         FROM patients WHERE $1 = '' OR name ILIKE $2 ESCAPE '\\' OR patient_id ILIKE $2 ESCAPE '\\' OR phone ILIKE $2 ESCAPE '\\'
         ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
        [search, term, pageSize, offset]
      ),
      pool.query(
        "SELECT count(*)::int AS total FROM patients WHERE $1 = '' OR name ILIKE $2 ESCAPE '\\' OR patient_id ILIKE $2 ESCAPE '\\' OR phone ILIKE $2 ESCAPE '\\'",
        [search, term]
      )
    ]);
    res.json({ data: data.rows, page, pageSize, total: count.rows[0].total });
  } catch (error) {
    next(error);
  }
});

const patientSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.union([z.string().email().max(254), z.literal("")]).default(""),
  phone: z.string().trim().min(7).max(30),
  dateOfBirth: z.string().date(),
  gender: z.enum(["Female", "Male", "Other", "Prefer not to say"]),
  bloodGroup: z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Unknown"]).default("Unknown")
});

router.post("/patients", allow("admin", "receptionist"), async (req, res, next) => {
  const parsed = patientSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Check the patient details and try again." });
    return;
  }
  try {
    const patientId = `PT-${randomBytes(3).toString("hex").toUpperCase()}`;
    const { name, email, phone, dateOfBirth, gender, bloodGroup } = parsed.data;
    const result = await pool.query(
      `INSERT INTO patients (patient_id, name, email, phone, date_of_birth, gender, blood_group)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, patient_id AS "patientId", name, email, phone,
         to_char(date_of_birth, 'YYYY-MM-DD') AS "dateOfBirth", gender, blood_group AS "bloodGroup", created_at AS "createdAt"`,
      [patientId, name, email, phone, dateOfBirth, gender, bloodGroup]
    );
    await recordAudit(req.user!.id, "create", "patient", result.rows[0].id);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.patch("/patients/:id", allow("admin", "receptionist"), async (req, res, next) => {
  const parsed = patientSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Check the patient details and try again." });
    return;
  }
  try {
    const data = parsed.data;
    const result = await pool.query(
      `UPDATE patients SET name = $2, email = $3, phone = $4, date_of_birth = $5, gender = $6, blood_group = $7
       WHERE id = $1
       RETURNING id, patient_id AS "patientId", name, email, phone,
         to_char(date_of_birth, 'YYYY-MM-DD') AS "dateOfBirth", gender, blood_group AS "bloodGroup", created_at AS "createdAt"`,
      [req.params.id, data.name, data.email, data.phone, data.dateOfBirth, data.gender, data.bloodGroup]
    );
    if (!result.rows[0]) {
      res.status(404).json({ error: "Patient not found." });
      return;
    }
    await recordAudit(req.user!.id, "update", "patient", req.params.id);
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.get("/doctors", allow("admin", "doctor", "receptionist"), async (req, res, next) => {
  try {
    const { page, pageSize, search, offset } = pageParams(req.query);
    const term = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    const [data, count] = await Promise.all([
      pool.query(
        `SELECT d.id, d.name, d.email, d.phone, d.specialization, dep.name AS department, d.availability
         FROM doctors d JOIN departments dep ON dep.id = d.department_id
         WHERE d.active = true AND ($1 = '' OR d.name ILIKE $2 ESCAPE '\\' OR d.specialization ILIKE $2 ESCAPE '\\' OR dep.name ILIKE $2 ESCAPE '\\')
         ORDER BY d.name LIMIT $3 OFFSET $4`,
        [search, term, pageSize, offset]
      ),
      pool.query(
        `SELECT count(*)::int AS total FROM doctors d JOIN departments dep ON dep.id = d.department_id
         WHERE d.active = true AND ($1 = '' OR d.name ILIKE $2 ESCAPE '\\' OR d.specialization ILIKE $2 ESCAPE '\\' OR dep.name ILIKE $2 ESCAPE '\\')`,
        [search, term]
      )
    ]);
    res.json({ data: data.rows, page, pageSize, total: count.rows[0].total });
  } catch (error) {
    next(error);
  }
});

const doctorSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().email().max(254),
  phone: z.string().trim().min(7).max(30),
  specialization: z.string().trim().min(2).max(100),
  department: z.string().trim().min(2).max(80),
  availability: z.enum(["Available", "In consultation", "On leave"]).default("Available")
});

router.post("/doctors", allow("admin"), async (req, res, next) => {
  const parsed = doctorSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Check the doctor details and try again." });
    return;
  }
  try {
    const data = parsed.data;
    const result = await pool.query(
      `INSERT INTO doctors (name, email, phone, specialization, department_id, availability)
       SELECT $1, $2, $3, $4, dep.id, $6 FROM departments dep WHERE dep.name = $5
       RETURNING id, name, email, phone, specialization, availability`,
      [data.name, data.email, data.phone, data.specialization, data.department, data.availability]
    );
    if (!result.rows[0]) {
      res.status(400).json({ error: "Select a valid department." });
      return;
    }
    await recordAudit(req.user!.id, "create", "doctor", result.rows[0].id);
    res.status(201).json({ ...result.rows[0], department: data.department });
  } catch (error) {
    next(error);
  }
});

router.patch("/doctors/:id", allow("admin"), async (req, res, next) => {
  const parsed = doctorSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Check the doctor details and try again." });
    return;
  }
  try {
    const data = parsed.data;
    const result = await pool.query(
      `UPDATE doctors d SET name = $2, email = $3, phone = $4, specialization = $5,
        department_id = dep.id, availability = $7
       FROM departments dep WHERE d.id = $1 AND dep.name = $6
       RETURNING d.id, d.name, d.email, d.phone, d.specialization, dep.name AS department, d.availability`,
      [req.params.id, data.name, data.email, data.phone, data.specialization, data.department, data.availability]
    );
    if (!result.rows[0]) {
      res.status(404).json({ error: "Doctor or department not found." });
      return;
    }
    await recordAudit(req.user!.id, "update", "doctor", req.params.id);
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.get("/appointments", allow("admin", "doctor", "receptionist", "nurse"), async (req, res, next) => {
  try {
    const { page, pageSize, search, offset } = pageParams(req.query);
    const term = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    const [data, count] = await Promise.all([
      pool.query(
        `SELECT a.id, a.patient_id AS "patientId", p.name AS "patientName", a.doctor_id AS "doctorId",
          d.name AS "doctorName", dep.name AS department, a.scheduled_at AS "scheduledAt", a.status
         FROM appointments a JOIN patients p ON p.id = a.patient_id
         JOIN doctors d ON d.id = a.doctor_id JOIN departments dep ON dep.id = d.department_id
         WHERE $1 = '' OR p.name ILIKE $2 ESCAPE '\\' OR d.name ILIKE $2 ESCAPE '\\' OR dep.name ILIKE $2 ESCAPE '\\'
         ORDER BY a.scheduled_at DESC LIMIT $3 OFFSET $4`,
        [search, term, pageSize, offset]
      ),
      pool.query(
        `SELECT count(*)::int AS total FROM appointments a
         JOIN patients p ON p.id = a.patient_id JOIN doctors d ON d.id = a.doctor_id
         JOIN departments dep ON dep.id = d.department_id
         WHERE $1 = '' OR p.name ILIKE $2 ESCAPE '\\' OR d.name ILIKE $2 ESCAPE '\\' OR dep.name ILIKE $2 ESCAPE '\\'`,
        [search, term]
      )
    ]);
    res.json({ data: data.rows, page, pageSize, total: count.rows[0].total });
  } catch (error) {
    next(error);
  }
});

const appointmentSchema = z.object({
  patientId: z.string().uuid(),
  doctorId: z.string().uuid(),
  scheduledAt: z.string().datetime({ offset: true })
});

router.post("/appointments", allow("admin", "doctor", "receptionist"), async (req, res, next) => {
  const parsed = appointmentSchema.safeParse(req.body);
  if (!parsed.success || new Date(parsed.data?.scheduledAt ?? 0) <= new Date()) {
    res.status(400).json({ error: "Choose a patient, doctor, and future appointment time." });
    return;
  }
  try {
    const { patientId, doctorId, scheduledAt } = parsed.data;
    const result = await pool.query(
      `INSERT INTO appointments (patient_id, doctor_id, scheduled_at, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, patient_id AS "patientId", doctor_id AS "doctorId", scheduled_at AS "scheduledAt", status`,
      [patientId, doctorId, scheduledAt, req.user!.id]
    );
    await recordAudit(req.user!.id, "create", "appointment", result.rows[0].id);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.patch("/appointments/:id", allow("admin", "doctor", "receptionist"), async (req, res, next) => {
  const parsed = z.object({
    status: z.enum(["Scheduled", "Completed", "Cancelled"]).optional(),
    scheduledAt: z.string().datetime({ offset: true }).optional()
  }).refine(data => data.status !== undefined || data.scheduledAt !== undefined).safeParse(req.body);
  if (!parsed.success || (parsed.data?.scheduledAt && new Date(parsed.data.scheduledAt) <= new Date())) {
    res.status(400).json({ error: "Choose a valid appointment status or future time." });
    return;
  }
  try {
    const result = await pool.query(
      `UPDATE appointments SET status = coalesce($2, status), scheduled_at = coalesce($3::timestamptz, scheduled_at) WHERE id = $1
       RETURNING id, patient_id AS "patientId", doctor_id AS "doctorId", scheduled_at AS "scheduledAt", status`,
      [req.params.id, parsed.data.status ?? null, parsed.data.scheduledAt ?? null]
    );
    if (!result.rows[0]) {
      res.status(404).json({ error: "Appointment not found." });
      return;
    }
    await recordAudit(req.user!.id, "update", "appointment", req.params.id);
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.get("/departments", allow("admin", "doctor", "receptionist", "nurse"), async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT dep.id, dep.name, dep.description, count(d.id)::int AS "doctorCount"
       FROM departments dep LEFT JOIN doctors d ON d.department_id = dep.id AND d.active = true
       GROUP BY dep.id ORDER BY dep.name`
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.get("/beds", allow("admin", "doctor", "receptionist", "nurse"), async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT b.id, b.ward, b.room, b.bed_number AS "bedNumber", b.status,
        p.name AS "patientName"
       FROM beds b LEFT JOIN patients p ON p.id = b.patient_id ORDER BY b.ward, b.room, b.bed_number`
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.patch("/beds/:id", allow("admin", "nurse"), async (req, res, next) => {
  const parsed = z.object({
    status: z.enum(["Available", "Occupied", "Maintenance"]),
    patientId: z.string().uuid().optional()
  }).safeParse(req.body);
  if (!parsed.success || (parsed.data?.status === "Occupied" && !parsed.data.patientId)) {
    res.status(400).json({ error: "An occupied bed must be assigned to a patient." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await client.query<{ status: string; patient_id: string | null }>(
      "SELECT status, patient_id FROM beds WHERE id = $1 FOR UPDATE", [req.params.id]
    );
    if (!before.rows[0]) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Bed not found." });
      return;
    }
    const data = parsed.data;
    const patientId = data.status === "Occupied" ? data.patientId! : null;
    await client.query(
      `UPDATE beds SET status = $2, patient_id = $3 WHERE id = $1
       RETURNING id`,
      [req.params.id, data.status, patientId]
    );
    if (before.rows[0].status === "Occupied" && before.rows[0].patient_id) {
      await client.query(
        "UPDATE admissions SET discharged_at = now() WHERE bed_id = $1 AND discharged_at IS NULL",
        [req.params.id]
      );
    }
    if (data.status === "Occupied") {
      await client.query("INSERT INTO admissions (patient_id, bed_id) VALUES ($1, $2)", [patientId, req.params.id]);
    }
    await client.query(
      "INSERT INTO audit_logs (actor_id, action, resource_type, resource_id) VALUES ($1, 'update', 'bed', $2)",
      [req.user!.id, req.params.id]
    );
    const updated = await client.query(
      `SELECT b.id, b.ward, b.room, b.bed_number AS "bedNumber", b.status, p.name AS "patientName"
       FROM beds b LEFT JOIN patients p ON p.id = b.patient_id WHERE b.id = $1`,
      [req.params.id]
    );
    await client.query("COMMIT");
    res.json(updated.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

router.get("/bills", allow("admin", "accountant", "pharmacist"), async (req, res, next) => {
  try {
    const { page, pageSize, search, offset } = pageParams(req.query);
    const term = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    const [data, count] = await Promise.all([
      pool.query(
        `SELECT b.id, b.invoice_number AS "invoiceNumber", p.name AS "patientName", b.amount::float AS amount,
          b.status, b.created_at AS "createdAt"
         FROM bills b JOIN patients p ON p.id = b.patient_id
         WHERE $1 = '' OR b.invoice_number ILIKE $2 ESCAPE '\\' OR p.name ILIKE $2 ESCAPE '\\'
         ORDER BY b.created_at DESC LIMIT $3 OFFSET $4`,
        [search, term, pageSize, offset]
      ),
      pool.query(
        `SELECT count(*)::int AS total FROM bills b JOIN patients p ON p.id = b.patient_id
         WHERE $1 = '' OR b.invoice_number ILIKE $2 ESCAPE '\\' OR p.name ILIKE $2 ESCAPE '\\'`,
        [search, term]
      )
    ]);
    res.json({ data: data.rows, page, pageSize, total: count.rows[0].total });
  } catch (error) {
    next(error);
  }
});

router.get("/bills/:id", allow("admin", "accountant"), async (req, res, next) => {
  try {
    const [billResult, items] = await Promise.all([
      pool.query(
        `SELECT b.id, b.invoice_number AS "invoiceNumber", p.name AS "patientName", b.amount::float AS amount,
          b.status, b.created_at AS "createdAt"
         FROM bills b JOIN patients p ON p.id = b.patient_id WHERE b.id = $1`,
        [req.params.id]
      ),
      pool.query("SELECT description, amount::float AS amount FROM bill_items WHERE bill_id = $1 ORDER BY id", [req.params.id])
    ]);
    if (!billResult.rows[0]) {
      res.status(404).json({ error: "Invoice not found." });
      return;
    }
    res.json({ bill: billResult.rows[0], items: items.rows });
  } catch (error) {
    next(error);
  }
});

router.post("/bills", allow("admin", "accountant"), async (req, res, next) => {
  const parsed = z.object({
    patientId: z.string().uuid(),
    items: z.array(z.object({
      description: z.string().trim().min(1).max(120),
      amount: z.number().positive().max(1_000_000)
    })).min(1).max(20)
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Add at least one valid bill item and select a patient." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString("hex").toUpperCase()}`;
    const total = parsed.data.items.reduce((sum, item) => sum + item.amount, 0);
    const bill = await client.query(
      `INSERT INTO bills (invoice_number, patient_id, amount, status)
       VALUES ($1, $2, $3, 'Pending')
       RETURNING id, invoice_number AS "invoiceNumber", amount::float AS amount, status, created_at AS "createdAt"`,
      [invoiceNumber, parsed.data.patientId, total]
    );
    for (const item of parsed.data.items) {
      await client.query("INSERT INTO bill_items (bill_id, description, amount) VALUES ($1, $2, $3)", [bill.rows[0].id, item.description, item.amount]);
    }
    const patient = await client.query("SELECT name AS \"patientName\" FROM patients WHERE id = $1", [parsed.data.patientId]);
    await client.query(
      "INSERT INTO audit_logs (actor_id, action, resource_type, resource_id) VALUES ($1, 'create', 'bill', $2)",
      [req.user!.id, bill.rows[0].id]
    );
    await client.query("COMMIT");
    res.status(201).json({ ...bill.rows[0], patientName: patient.rows[0].patientName });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

router.patch("/bills/:id", allow("admin", "accountant"), async (req, res, next) => {
  const parsed = z.object({ status: z.enum(["Paid", "Pending", "Partially paid"]) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Select a valid payment status." });
    return;
  }
  try {
    const result = await pool.query(
      `UPDATE bills b SET status = $2 FROM patients p WHERE b.id = $1 AND b.patient_id = p.id
       RETURNING b.id, b.invoice_number AS "invoiceNumber", p.name AS "patientName", b.amount::float AS amount, b.status, b.created_at AS "createdAt"`,
      [req.params.id, parsed.data.status]
    );
    if (!result.rows[0]) {
      res.status(404).json({ error: "Invoice not found." });
      return;
    }
    await recordAudit(req.user!.id, "update", "bill", req.params.id);
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.get("/staff", allow("admin"), async (_req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT id, name, email, role, active FROM users ORDER BY name"
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.post("/staff", allow("admin"), async (req, res, next) => {
  const parsed = z.object({
    name: z.string().trim().min(2).max(100),
    email: z.string().email().max(254),
    password: z.string().min(12).max(200),
    role: z.enum(["admin", "doctor", "receptionist", "nurse", "pharmacist", "laboratory_technician", "accountant"])
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Provide a name, valid email, role, and password with at least 12 characters." });
    return;
  }
  try {
    const hash = await bcrypt.hash(parsed.data.password, 12);
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role, active`,
      [parsed.data.name, parsed.data.email, hash, parsed.data.role]
    );
    await recordAudit(req.user!.id, "create", "staff", result.rows[0].id);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.get("/inventory", allow("admin", "pharmacist"), async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, name, category, stock, reorder_level AS "reorderLevel", unit
       FROM inventory ORDER BY name`
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.post("/inventory", allow("admin", "pharmacist"), async (req, res, next) => {
  const parsed = z.object({
    name: z.string().trim().min(2).max(100),
    category: z.string().trim().min(2).max(60),
    stock: z.number().int().min(0).max(1_000_000),
    reorderLevel: z.number().int().min(0).max(1_000_000),
    unit: z.string().trim().min(1).max(30)
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Check the medicine details and stock quantities." });
    return;
  }
  try {
    const data = parsed.data;
    const result = await pool.query(
      `INSERT INTO inventory (name, category, stock, reorder_level, unit)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, category, stock, reorder_level AS "reorderLevel", unit`,
      [data.name, data.category, data.stock, data.reorderLevel, data.unit]
    );
    await recordAudit(req.user!.id, "create", "inventory", result.rows[0].id);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.patch("/inventory/:id", allow("admin", "pharmacist"), async (req, res, next) => {
  const parsed = z.object({ stock: z.number().int().min(0).max(1_000_000) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Stock must be a non-negative whole number." });
    return;
  }
  try {
    const result = await pool.query(
      `UPDATE inventory SET stock = $2 WHERE id = $1
       RETURNING id, name, category, stock, reorder_level AS "reorderLevel", unit`,
      [req.params.id, parsed.data.stock]
    );
    if (!result.rows[0]) {
      res.status(404).json({ error: "Medicine not found." });
      return;
    }
    await recordAudit(req.user!.id, "update", "inventory", req.params.id);
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.get("/lab-orders", allow("admin", "doctor", "nurse", "laboratory_technician"), async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT l.id, l.patient_id AS "patientId", p.name AS "patientName", l.test_name AS "testName",
        l.status, l.created_at AS "createdAt"
       FROM lab_orders l JOIN patients p ON p.id = l.patient_id ORDER BY l.created_at DESC LIMIT 200`
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.post("/lab-orders", allow("admin", "doctor", "nurse", "laboratory_technician"), async (req, res, next) => {
  const parsed = z.object({ patientId: z.string().uuid(), testName: z.string().trim().min(2).max(120) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Select a patient and provide a test name." });
    return;
  }
  try {
    const result = await pool.query(
      `INSERT INTO lab_orders (patient_id, test_name, requested_by) VALUES ($1, $2, $3)
       RETURNING id, patient_id AS "patientId", test_name AS "testName", status, created_at AS "createdAt"`,
      [parsed.data.patientId, parsed.data.testName, req.user!.id]
    );
    await recordAudit(req.user!.id, "create", "lab_order", result.rows[0].id);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.patch("/lab-orders/:id", allow("admin", "laboratory_technician"), async (req, res, next) => {
  const parsed = z.object({ status: z.enum(["Requested", "In progress", "Completed"]) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Select a valid laboratory status." });
    return;
  }
  try {
    const result = await pool.query(
      `UPDATE lab_orders l SET status = $2 FROM patients p WHERE l.id = $1 AND l.patient_id = p.id
       RETURNING l.id, l.patient_id AS "patientId", p.name AS "patientName", l.test_name AS "testName", l.status, l.created_at AS "createdAt"`,
      [req.params.id, parsed.data.status]
    );
    if (!result.rows[0]) {
      res.status(404).json({ error: "Laboratory order not found." });
      return;
    }
    await recordAudit(req.user!.id, "update", "lab_order", req.params.id);
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.get("/settings", allow("admin"), async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT hospital_name AS "hospitalName", phone, email, address, timezone
       FROM hospital_settings WHERE id = true`
    );
    res.json(result.rows[0] ?? { hospitalName: "CarePoint Hospital", phone: "", email: "", address: "", timezone: "America/New_York" });
  } catch (error) {
    next(error);
  }
});

router.put("/settings", allow("admin"), async (req, res, next) => {
  const parsed = z.object({
    hospitalName: z.string().trim().min(2).max(120),
    phone: z.string().trim().max(30),
    email: z.union([z.string().email().max(254), z.literal("")]),
    address: z.string().trim().max(300),
    timezone: z.string().trim().min(1).max(60)
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Check the hospital details and try again." });
    return;
  }
  try {
    const data = parsed.data;
    const result = await pool.query(
      `INSERT INTO hospital_settings (id, hospital_name, phone, email, address, timezone, updated_at)
       VALUES (true, $1, $2, $3, $4, $5, now())
       ON CONFLICT (id) DO UPDATE SET hospital_name = EXCLUDED.hospital_name, phone = EXCLUDED.phone,
         email = EXCLUDED.email, address = EXCLUDED.address, timezone = EXCLUDED.timezone, updated_at = now()
       RETURNING hospital_name AS "hospitalName", phone, email, address, timezone`,
      [data.hospitalName, data.phone, data.email, data.address, data.timezone]
    );
    await recordAudit(req.user!.id, "update", "settings");
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.get("/records/:patientId", allow("admin", "doctor", "nurse", "laboratory_technician"), async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, diagnosis, prescription, allergies, test_results AS "testResults",
        treatment, created_at AS "createdAt"
       FROM medical_records WHERE patient_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [req.params.patientId]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.post("/records/:patientId", allow("admin", "doctor", "nurse"), async (req, res, next) => {
  const parsed = z.object({
    diagnosis: z.string().trim().min(1).max(500),
    prescription: z.string().max(2000).default(""),
    allergies: z.string().max(1000).default(""),
    testResults: z.string().max(2000).default(""),
    treatment: z.string().max(2000).default("")
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Check the medical record details and try again." });
    return;
  }
  try {
    const data = parsed.data;
    const result = await pool.query(
      `INSERT INTO medical_records (patient_id, author_id, diagnosis, prescription, allergies, test_results, treatment)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, diagnosis, prescription, allergies, test_results AS "testResults", treatment, created_at AS "createdAt"`,
      [req.params.patientId, req.user!.id, data.diagnosis, data.prescription, data.allergies, data.testResults, data.treatment]
    );
    await recordAudit(req.user!.id, "create", "medical_record", result.rows[0].id);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});