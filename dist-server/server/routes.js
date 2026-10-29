import { randomUUID } from "node:crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { pool } from "./db.js";
import { requirePermission } from "./auth.js";
import { can } from "./permissions.js";
export const apiRouter = Router();
function httpError(message, status) {
    return Object.assign(new Error(message), { status, expose: true });
}
function route(handler) {
    return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}
function pagination(request) {
    const parsedPage = Number(request.query.page ?? 1);
    const parsedLimit = Number(request.query.limit ?? 8);
    const page = Number.isInteger(parsedPage) && parsedPage > 0 ? Math.min(parsedPage, 1_000_000) : 1;
    const limit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 8;
    const search = typeof request.query.search === "string" ? request.query.search.trim().slice(0, 100) : "";
    return { page, limit, offset: (page - 1) * limit, search };
}
function pageResult(items, total, page, limit) {
    return { items, total: Number(total), page, pages: Math.max(1, Math.ceil(Number(total) / limit)) };
}
async function audit(request, action, resource, resourceId) {
    await pool.query("INSERT INTO audit_logs (staff_id, action, resource, resource_id) VALUES ($1, $2, $3, $4)", [request.user.id, action, resource, resourceId ?? null]);
}
async function transaction(callback) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await callback(client);
        await client.query("COMMIT");
        return result;
    }
    catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
    finally {
        client.release();
    }
}
function validated(schema, request, response) {
    const result = schema.safeParse(request.body);
    if (!result.success) {
        response.status(400).json({ error: "Please check the submitted information and try again." });
        return null;
    }
    return result.data;
}
const uuid = z.string().uuid();
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === value &&
        value <= new Date().toISOString().slice(0, 10);
});
const patientSchema = z.object({
    name: z.string().trim().min(2).max(100),
    date_of_birth: dateOnly,
    gender: z.enum(["Female", "Male", "Non-binary", "Prefer not to say"]),
    phone: z.string().trim().min(7).max(25),
    email: z.union([z.string().trim().email().max(254), z.literal("")]).optional(),
    blood_group: z.union([z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]), z.literal("")]).optional(),
    address: z.string().trim().max(300).optional()
});
const doctorSchema = z.object({
    name: z.string().trim().min(2).max(100),
    specialization: z.string().trim().min(2).max(100),
    department: z.string().trim().min(2).max(100),
    phone: z.string().trim().min(7).max(25),
    email: z.string().trim().email().max(254),
    availability: z.string().trim().min(2).max(100)
});
const appointmentSchema = z.object({
    patient_id: uuid,
    doctor_id: uuid,
    starts_at: z.string().datetime({ offset: true }),
    notes: z.string().trim().max(500).optional().default("")
});
const medicalRecordSchema = z.object({
    patient_id: uuid,
    diagnosis: z.string().trim().min(2).max(300),
    prescription: z.string().trim().max(2000).optional().default(""),
    allergies: z.string().trim().max(500).optional().default(""),
    test_results: z.string().trim().max(3000).optional().default(""),
    treatment: z.string().trim().max(3000).optional().default("")
});
const moneyItemsSchema = z.object({
    patient_id: uuid,
    items: z.array(z.object({
        description: z.string().trim().min(2).max(100),
        amount: z.number().positive().max(1_000_000)
    })).min(1).max(20)
});
const inventorySchema = z.object({
    name: z.string().trim().min(2).max(150),
    sku: z.string().trim().min(2).max(50),
    category: z.string().trim().min(2).max(80),
    quantity: z.coerce.number().int().min(0).max(100_000),
    reorder_level: z.coerce.number().int().min(0).max(100_000),
    unit_price: z.coerce.number().min(0).max(1_000_000)
});
const settingsSchema = z.object({
    hospital_name: z.string().trim().min(2).max(150),
    address: z.string().trim().min(2).max(300),
    phone: z.string().trim().min(7).max(30),
    timezone: z.enum(["UTC", "America/New_York", "America/Chicago", "America/Los_Angeles", "Europe/London", "Asia/Kolkata"])
});
apiRouter.get("/health", (_request, response) => response.json({ status: "ok" }));
apiRouter.get("/dashboard", requirePermission("dashboard:read"), route(async (_request, response) => {
    const billingAccess = can(_request.user.role, "billing:read");
    const patientReadAccess = can(_request.user.role, "patients:read");
    const appointmentReadAccess = can(_request.user.role, "appointments:read");
    const revenueTrendQuery = billingAccess
        ? pool.query(`SELECT TO_CHAR(months.month, 'Mon') AS month, COALESCE(SUM(p.amount),0) AS revenue
       FROM generate_series(date_trunc('month', CURRENT_DATE) - INTERVAL '5 months', date_trunc('month', CURRENT_DATE), INTERVAL '1 month') AS months(month)
       LEFT JOIN payments p ON p.received_at >= months.month AND p.received_at < months.month + INTERVAL '1 month'
       GROUP BY months.month ORDER BY months.month`)
        : Promise.resolve({ rows: [] });
    const [patientCount, doctorCount, bedCount, appointmentCount, admissionsCount, dischargesCount, patientTrend, revenueTrend, appointmentTrend, recentPatients, upcomingAppointments] = await Promise.all([
        pool.query("SELECT COUNT(*) AS count FROM patients"),
        pool.query("SELECT COUNT(*) AS count FROM doctors"),
        pool.query("SELECT COUNT(*) AS count, COUNT(*) FILTER (WHERE status='Available') AS available, COUNT(*) FILTER (WHERE status='Occupied') AS occupied FROM beds"),
        pool.query("SELECT COUNT(*) AS count FROM appointments WHERE starts_at >= CURRENT_DATE AND starts_at < CURRENT_DATE + INTERVAL '1 day' AND status = 'Scheduled'"),
        pool.query("SELECT COUNT(*) AS count FROM admissions WHERE admitted_at >= CURRENT_DATE AND admitted_at < CURRENT_DATE + INTERVAL '1 day'"),
        pool.query("SELECT COUNT(*) AS count FROM admissions WHERE discharged_at >= CURRENT_DATE AND discharged_at < CURRENT_DATE + INTERVAL '1 day'"),
        pool.query(`SELECT TO_CHAR(days.day, 'Dy') AS day,
              COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'Completed') AS visits,
              COUNT(DISTINCT ad.id) AS admissions
       FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, INTERVAL '1 day') AS days(day)
       LEFT JOIN appointments a ON a.starts_at >= days.day AND a.starts_at < days.day + INTERVAL '1 day'
       LEFT JOIN admissions ad ON ad.admitted_at >= days.day AND ad.admitted_at < days.day + INTERVAL '1 day'
       GROUP BY days.day ORDER BY days.day`),
        revenueTrendQuery,
        pool.query(`SELECT TO_CHAR(days.day,'Dy') AS day,COUNT(a.id) AS appointments
       FROM generate_series(CURRENT_DATE - INTERVAL '6 days',CURRENT_DATE,INTERVAL '1 day') AS days(day)
       LEFT JOIN appointments a ON a.starts_at >= days.day AND a.starts_at < days.day + INTERVAL '1 day'
         AND a.status <> 'Cancelled'
       GROUP BY days.day ORDER BY days.day`),
        patientReadAccess ? pool.query(`SELECT p.id,p.patient_id,p.name,p.date_of_birth,p.gender,p.phone,p.email,p.blood_group,p.created_at
       FROM patients p
       WHERE ($1::text <> 'doctor' OR EXISTS (
         SELECT 1 FROM appointments ap JOIN doctors doc ON doc.id=ap.doctor_id
         WHERE ap.patient_id=p.id AND doc.staff_id=$2
       ))
       ORDER BY p.created_at DESC LIMIT 5`, [_request.user.role, _request.user.id]) : Promise.resolve({ rows: [] }),
        appointmentReadAccess ? pool.query(`SELECT a.id, a.patient_id, p.name AS patient_name, a.doctor_id, d.name AS doctor_name,
              a.department, a.starts_at, a.status
       FROM appointments a JOIN patients p ON p.id=a.patient_id JOIN doctors d ON d.id=a.doctor_id
       WHERE a.starts_at >= NOW() AND a.status='Scheduled'
         AND ($1::text <> 'doctor' OR d.staff_id=$2)
       ORDER BY a.starts_at LIMIT 5`, [_request.user.role, _request.user.id]) : Promise.resolve({ rows: [] })
    ]);
    const [currentRevenue, previousRevenue] = billingAccess ? await Promise.all([
        pool.query("SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE received_at >= date_trunc('month', CURRENT_DATE)"),
        pool.query("SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE received_at >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month') AND received_at < date_trunc('month', CURRENT_DATE)")
    ]) : [null, null];
    if (can(_request.user.role, "patients:read") || can(_request.user.role, "appointments:read")) {
        await audit(_request, "read_dashboard", "dashboard");
    }
    const beds = bedCount.rows[0];
    const revenue = currentRevenue ? Number(currentRevenue.rows[0].total) : null;
    const prior = previousRevenue ? Number(previousRevenue.rows[0].total) : null;
    response.json({
        metrics: {
            patients: Number(patientCount.rows[0].count),
            doctors: Number(doctorCount.rows[0].count),
            bedsAvailable: Number(beds.available),
            appointmentsToday: Number(appointmentCount.rows[0].count),
            admissionsToday: Number(admissionsCount.rows[0].count),
            dischargesToday: Number(dischargesCount.rows[0].count),
            revenueThisMonth: revenue,
            revenueChange: revenue !== null && prior !== null ? prior ? Math.round(((revenue - prior) / prior) * 1000) / 10 : 0 : null,
            occupancy: Number(beds.count) ? Math.round((Number(beds.occupied) / Number(beds.count)) * 100) : 0
        },
        patientTrend: patientTrend.rows.map(row => ({ day: row.day, visits: Number(row.visits), admissions: Number(row.admissions) })),
        revenueTrend: billingAccess ? revenueTrend.rows.map(row => ({ month: row.month, revenue: Number(row.revenue) })) : [],
        appointmentsTrend: appointmentTrend.rows.map(row => ({ day: row.day, appointments: Number(row.appointments) })),
        recentPatients: recentPatients.rows,
        upcomingAppointments: upcomingAppointments.rows
    });
}));
apiRouter.get("/alerts", requirePermission("alerts:read"), route(async (request, response) => {
    const [beds, stock, appointments] = await Promise.all([
        pool.query("SELECT COUNT(*) AS count FROM beds WHERE status='Available'"),
        pool.query("SELECT COUNT(*) AS count FROM inventory WHERE quantity <= reorder_level"),
        pool.query("SELECT COUNT(*) AS count FROM appointments WHERE starts_at >= NOW() AND starts_at < NOW() + INTERVAL '2 hours' AND status='Scheduled'")
    ]);
    const alerts = [];
    if (["admin", "nurse", "receptionist"].includes(request.user.role) && Number(beds.rows[0].count) < 10) {
        alerts.push({ title: "Limited bed availability", detail: `${beds.rows[0].count} beds are currently available.`, severity: "warning", page: "beds" });
    }
    if (["admin", "pharmacist"].includes(request.user.role) && Number(stock.rows[0].count) > 0) {
        alerts.push({ title: "Low pharmacy stock", detail: `${stock.rows[0].count} inventory items are at or below reorder level.`, severity: "warning", page: "pharmacy" });
    }
    if (["admin", "doctor", "receptionist", "nurse"].includes(request.user.role) && Number(appointments.rows[0].count) > 0) {
        alerts.push({ title: "Upcoming appointments", detail: `${appointments.rows[0].count} appointments begin within two hours.`, severity: "info", page: "appointments" });
    }
    response.json(alerts);
}));
apiRouter.get("/patients", requirePermission("patients:read"), route(async (request, response) => {
    const { page, limit, offset, search } = pagination(request);
    const term = `%${search}%`;
    const [items, count] = await Promise.all([
        pool.query(`SELECT p.id,p.patient_id,p.name,p.date_of_birth,p.gender,p.phone,p.email,p.blood_group,p.created_at
       FROM patients p
       WHERE ($1='' OR p.name ILIKE $2 OR p.patient_id ILIKE $2 OR p.phone ILIKE $2)
         AND ($5::text <> 'doctor' OR EXISTS (
           SELECT 1 FROM appointments ap JOIN doctors doc ON doc.id=ap.doctor_id
           WHERE ap.patient_id=p.id AND doc.staff_id=$6
         ))
       ORDER BY p.created_at DESC LIMIT $3 OFFSET $4`, [search, term, limit, offset, request.user.role, request.user.id]),
        pool.query(`SELECT COUNT(*) AS count FROM patients p
       WHERE ($1='' OR p.name ILIKE $2 OR p.patient_id ILIKE $2 OR p.phone ILIKE $2)
         AND ($3::text <> 'doctor' OR EXISTS (
           SELECT 1 FROM appointments ap JOIN doctors doc ON doc.id=ap.doctor_id
           WHERE ap.patient_id=p.id AND doc.staff_id=$4
         ))`, [search, term, request.user.role, request.user.id])
    ]);
    await audit(request, "list", "patient");
    response.json(pageResult(items.rows, count.rows[0].count, page, limit));
}));
apiRouter.post("/patients", requirePermission("patients:write"), route(async (request, response) => {
    const input = validated(patientSchema, request, response);
    if (!input)
        return;
    const id = randomUUID();
    const result = await pool.query(`INSERT INTO patients (id, patient_id, name, date_of_birth, gender, phone, email, blood_group, address)
     VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7,''), NULLIF($8,''), NULLIF($9,''))
     RETURNING id, patient_id, name, date_of_birth, gender, phone, email, blood_group, created_at`, [id, `CP-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`, input.name, input.date_of_birth, input.gender, input.phone, input.email ?? "", input.blood_group ?? "", input.address ?? ""]);
    await audit(request, "create", "patient", id);
    response.status(201).json(result.rows[0]);
}));
apiRouter.patch("/patients/:id", requirePermission("patients:write"), route(async (request, response) => {
    const parsedId = uuid.safeParse(request.params.id);
    const input = patientSchema.safeParse(request.body);
    if (!parsedId.success || !input.success) {
        response.status(400).json({ error: "Please check the patient information and try again." });
        return;
    }
    const result = await pool.query(`UPDATE patients SET name=$2,date_of_birth=$3,gender=$4,phone=$5,email=NULLIF($6,''),
       blood_group=NULLIF($7,''),address=CASE WHEN $8='' THEN address ELSE $8 END,updated_at=NOW()
     WHERE id=$1
     RETURNING id,patient_id,name,date_of_birth,gender,phone,email,blood_group,created_at`, [parsedId.data, input.data.name, input.data.date_of_birth, input.data.gender, input.data.phone, input.data.email ?? "", input.data.blood_group ?? "", input.data.address ?? ""]);
    if (!result.rows[0]) {
        response.status(404).json({ error: "Patient record not found." });
        return;
    }
    await audit(request, "update", "patient", parsedId.data);
    response.json(result.rows[0]);
}));
apiRouter.get("/patients/:id", requirePermission("medical-records:read"), route(async (request, response) => {
    const parsedId = uuid.safeParse(request.params.id);
    if (!parsedId.success) {
        response.status(400).json({ error: "Invalid patient ID." });
        return;
    }
    const [patient, records] = await Promise.all([
        pool.query(`SELECT p.id,p.patient_id,p.name,p.date_of_birth,p.gender,p.phone,p.email,p.blood_group,p.address,p.created_at
       FROM patients p WHERE p.id=$1 AND ($2::text <> 'doctor' OR EXISTS (
         SELECT 1 FROM appointments ap JOIN doctors doc ON doc.id=ap.doctor_id
         WHERE ap.patient_id=p.id AND doc.staff_id=$3
       ))`, [parsedId.data, request.user.role, request.user.id]),
        pool.query("SELECT id, diagnosis, prescription, allergies, test_results, treatment, created_at FROM medical_records WHERE patient_id=$1 ORDER BY created_at DESC LIMIT 50", [parsedId.data])
    ]);
    if (!patient.rows[0]) {
        response.status(404).json({ error: "Patient record not found." });
        return;
    }
    await audit(request, "read_clinical_record", "patient", parsedId.data);
    response.json({ patient: patient.rows[0], records: records.rows });
}));
apiRouter.get("/doctors", requirePermission("doctors:read"), route(async (request, response) => {
    const { page, limit, offset, search } = pagination(request);
    const term = `%${search}%`;
    const [items, count] = await Promise.all([
        pool.query(`SELECT id, name, specialization, department, phone, email, availability
       FROM doctors WHERE ($1='' OR name ILIKE $2 OR specialization ILIKE $2 OR department ILIKE $2)
         AND ($5::text <> 'doctor' OR staff_id=$6)
       ORDER BY name LIMIT $3 OFFSET $4`, [search, term, limit, offset, request.user.role, request.user.id]),
        pool.query(`SELECT COUNT(*) AS count FROM doctors
       WHERE ($1='' OR name ILIKE $2 OR specialization ILIKE $2 OR department ILIKE $2)
         AND ($3::text <> 'doctor' OR staff_id=$4)`, [search, term, request.user.role, request.user.id])
    ]);
    response.json(pageResult(items.rows, count.rows[0].count, page, limit));
}));
apiRouter.post("/doctors", requirePermission("*"), route(async (request, response) => {
    if (request.user.role !== "admin") {
        response.status(403).json({ error: "Only administrators can add clinicians." });
        return;
    }
    const input = validated(doctorSchema, request, response);
    if (!input)
        return;
    const id = randomUUID();
    const result = await pool.query(`INSERT INTO doctors (id,staff_id,name,specialization,department,phone,email,availability)
     VALUES ($1,(SELECT id FROM staff WHERE lower(email)=lower($6) AND role='doctor'),$2,$3,$4,$5,$6,$7)
     RETURNING id, name, specialization, department, phone, email, availability`, [id, input.name, input.specialization, input.department, input.phone, input.email.toLowerCase(), input.availability]);
    await audit(request, "create", "doctor", id);
    response.status(201).json(result.rows[0]);
}));
apiRouter.patch("/doctors/:id", requirePermission("*"), route(async (request, response) => {
    if (request.user.role !== "admin") {
        response.status(403).json({ error: "Only administrators can update clinician profiles." });
        return;
    }
    const parsedId = uuid.safeParse(request.params.id);
    const input = doctorSchema.safeParse(request.body);
    if (!parsedId.success || !input.success) {
        response.status(400).json({ error: "Please check the doctor information and try again." });
        return;
    }
    const updated = await transaction(async (client) => {
        const result = await client.query(`UPDATE doctors SET name=$2,specialization=$3,department=$4,phone=$5,email=$6,availability=$7
       WHERE id=$1 RETURNING id,staff_id,name,specialization,department,phone,email,availability`, [parsedId.data, input.data.name, input.data.specialization, input.data.department, input.data.phone, input.data.email.toLowerCase(), input.data.availability]);
        if (!result.rows[0])
            return null;
        const { staff_id: staffId, ...doctor } = result.rows[0];
        if (staffId)
            await client.query("UPDATE staff SET email=$2 WHERE id=$1", [staffId, input.data.email.toLowerCase()]);
        return doctor;
    });
    if (!updated) {
        response.status(404).json({ error: "Doctor profile not found." });
        return;
    }
    await audit(request, "update", "doctor", parsedId.data);
    response.json(updated);
}));
apiRouter.get("/appointments", requirePermission("appointments:read"), route(async (request, response) => {
    const { page, limit, offset, search } = pagination(request);
    const term = `%${search}%`;
    const [items, count] = await Promise.all([
        pool.query(`SELECT a.id,a.patient_id,p.name AS patient_name,a.doctor_id,d.name AS doctor_name,
              a.department,a.starts_at,a.status
       FROM appointments a JOIN patients p ON p.id=a.patient_id JOIN doctors d ON d.id=a.doctor_id
       WHERE ($1='' OR p.name ILIKE $2 OR d.name ILIKE $2 OR a.department ILIKE $2)
         AND ($5::text <> 'doctor' OR d.staff_id=$6)
       ORDER BY a.starts_at DESC LIMIT $3 OFFSET $4`, [search, term, limit, offset, request.user.role, request.user.id]),
        pool.query(`SELECT COUNT(*) AS count FROM appointments a
       JOIN patients p ON p.id=a.patient_id JOIN doctors d ON d.id=a.doctor_id
       WHERE ($1='' OR p.name ILIKE $2 OR d.name ILIKE $2 OR a.department ILIKE $2)
         AND ($3::text <> 'doctor' OR d.staff_id=$4)`, [search, term, request.user.role, request.user.id])
    ]);
    await audit(request, "list", "appointment");
    response.json(pageResult(items.rows, count.rows[0].count, page, limit));
}));
apiRouter.post("/appointments", requirePermission("appointments:write"), route(async (request, response) => {
    const input = validated(appointmentSchema, request, response);
    if (!input)
        return;
    if (new Date(input.starts_at) < new Date()) {
        response.status(400).json({ error: "Appointments must be scheduled for a future time." });
        return;
    }
    const doctor = await pool.query("SELECT id,department FROM doctors WHERE id=$1 AND ($2::text <> 'doctor' OR staff_id=$3)", [input.doctor_id, request.user.role, request.user.id]);
    if (!doctor.rows[0]) {
        response.status(403).json({ error: "Select a clinician assigned to your account." });
        return;
    }
    const id = randomUUID();
    try {
        const result = await pool.query(`INSERT INTO appointments (id, patient_id, doctor_id, department, starts_at, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, patient_id, doctor_id, department, starts_at, status`, [id, input.patient_id, input.doctor_id, doctor.rows[0].department, input.starts_at, input.notes, request.user.id]);
        await audit(request, "create", "appointment", id);
        response.status(201).json(result.rows[0]);
    }
    catch (error) {
        if (error instanceof Error && "code" in error && error.code === "23503") {
            response.status(400).json({ error: "Select a valid patient and doctor." });
            return;
        }
        throw error;
    }
}));
apiRouter.patch("/appointments/:id", requirePermission("appointments:write"), route(async (request, response) => {
    const parsedId = uuid.safeParse(request.params.id);
    const input = z.object({
        status: z.enum(["Completed", "Cancelled"]).optional(),
        starts_at: z.string().datetime({ offset: true }).optional()
    }).refine(value => Boolean(value.status || value.starts_at)).safeParse(request.body);
    if (!parsedId.success || !input.success) {
        response.status(400).json({ error: "Choose a valid status or appointment time." });
        return;
    }
    if (input.data.starts_at && new Date(input.data.starts_at) < new Date()) {
        response.status(400).json({ error: "Appointments must be scheduled for a future time." });
        return;
    }
    const result = await pool.query(`UPDATE appointments SET status=COALESCE($2,status),starts_at=COALESCE($3,starts_at) WHERE id=$1 AND status='Scheduled'
     AND ($4::text <> 'doctor' OR doctor_id IN (SELECT id FROM doctors WHERE staff_id=$5))
     RETURNING id`, [parsedId.data, input.data.status ?? null, input.data.starts_at ?? null, request.user.role, request.user.id]);
    if (!result.rowCount) {
        response.status(404).json({ error: "Scheduled appointment not found or not assigned to you." });
        return;
    }
    await audit(request, "update_status", "appointment", parsedId.data);
    response.status(204).end();
}));
apiRouter.get("/departments", requirePermission("departments:read"), route(async (_request, response) => {
    const result = await pool.query(`SELECT d.id,d.name,d.head,COUNT(DISTINCT doc.id)::int AS doctors,
      COUNT(DISTINCT b.id)::int AS beds,
      CASE WHEN COUNT(DISTINCT b.id)=0 THEN 0
           ELSE ROUND(100.0 * COUNT(DISTINCT b.id) FILTER (WHERE b.status='Occupied') / COUNT(DISTINCT b.id))::int END AS occupancy
     FROM departments d
     LEFT JOIN doctors doc ON lower(doc.department)=lower(d.name)
     LEFT JOIN beds b ON lower(b.ward)=lower(d.name)
     GROUP BY d.id ORDER BY d.name`);
    response.json(result.rows);
}));
apiRouter.get("/beds", requirePermission("beds:read"), route(async (_request, response) => {
    const result = await pool.query(`SELECT b.id,b.ward,b.bed_number,b.status,p.name AS patient_name
     FROM beds b LEFT JOIN patients p ON p.id=b.patient_id
     ORDER BY b.ward,b.bed_number`);
    await audit(_request, "list", "bed");
    response.json(result.rows);
}));
apiRouter.post("/beds", requirePermission("*"), route(async (request, response) => {
    if (request.user.role !== "admin") {
        response.status(403).json({ error: "Only administrators can add beds." });
        return;
    }
    const input = z.object({
        ward: z.string().trim().min(2).max(100),
        bed_number: z.string().trim().min(1).max(30)
    }).safeParse(request.body);
    if (!input.success) {
        response.status(400).json({ error: "Enter a valid ward and bed number." });
        return;
    }
    const id = randomUUID();
    const result = await pool.query("INSERT INTO beds (id,ward,bed_number) VALUES ($1,$2,$3) RETURNING id,ward,bed_number,status", [id, input.data.ward, input.data.bed_number]);
    await audit(request, "create", "bed", id);
    response.status(201).json(result.rows[0]);
}));
apiRouter.post("/beds/:id/admit", requirePermission("beds:write"), route(async (request, response) => {
    const bedId = uuid.safeParse(request.params.id);
    const input = z.object({ patient_id: uuid }).safeParse(request.body);
    if (!bedId.success || !input.success) {
        response.status(400).json({ error: "Select a valid bed and patient." });
        return;
    }
    await transaction(async (client) => {
        const bed = await client.query("SELECT id,status FROM beds WHERE id=$1 FOR UPDATE", [bedId.data]);
        if (!bed.rows[0] || bed.rows[0].status !== "Available")
            throw httpError("This bed is no longer available.", 409);
        const patient = await client.query("SELECT id FROM patients WHERE id=$1 FOR UPDATE", [input.data.patient_id]);
        if (!patient.rows[0])
            throw httpError("Patient record not found.", 404);
        const existing = await client.query("SELECT id FROM admissions WHERE patient_id=$1 AND discharged_at IS NULL", [input.data.patient_id]);
        if (existing.rows[0])
            throw httpError("This patient already has an active admission.", 409);
        const admissionId = randomUUID();
        await client.query("UPDATE beds SET status='Occupied',patient_id=$2 WHERE id=$1", [bedId.data, input.data.patient_id]);
        await client.query("INSERT INTO admissions (id,patient_id,bed_id) VALUES ($1,$2,$3)", [admissionId, input.data.patient_id, bedId.data]);
    });
    await audit(request, "admit", "bed", bedId.data);
    response.status(204).end();
}));
apiRouter.post("/beds/:id/discharge", requirePermission("beds:write"), route(async (request, response) => {
    const bedId = uuid.safeParse(request.params.id);
    if (!bedId.success) {
        response.status(400).json({ error: "Invalid bed ID." });
        return;
    }
    const discharged = await transaction(async (client) => {
        const bed = await client.query("SELECT id,status FROM beds WHERE id=$1 FOR UPDATE", [bedId.data]);
        if (!bed.rows[0] || bed.rows[0].status !== "Occupied")
            return false;
        await client.query("UPDATE admissions SET discharged_at=NOW() WHERE bed_id=$1 AND discharged_at IS NULL", [bedId.data]);
        await client.query("UPDATE beds SET status='Available',patient_id=NULL WHERE id=$1", [bedId.data]);
        return true;
    });
    if (!discharged) {
        response.status(409).json({ error: "This bed is not currently occupied." });
        return;
    }
    await audit(request, "discharge", "bed", bedId.data);
    response.status(204).end();
}));
apiRouter.post("/beds/:id/transfer", requirePermission("beds:write"), route(async (request, response) => {
    const fromId = uuid.safeParse(request.params.id);
    const input = z.object({ target_bed_id: uuid }).safeParse(request.body);
    if (!fromId.success || !input.success || fromId.data === input.data.target_bed_id) {
        response.status(400).json({ error: "Choose a different destination bed." });
        return;
    }
    const moved = await transaction(async (client) => {
        const locked = await client.query("SELECT id,status,patient_id FROM beds WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE", [[fromId.data, input.data.target_bed_id]]);
        const current = locked.rows.find(bed => bed.id === fromId.data);
        const destination = locked.rows.find(bed => bed.id === input.data.target_bed_id);
        if (!current || current.status !== "Occupied" || !destination || destination.status !== "Available")
            return false;
        const admission = await client.query("SELECT id FROM admissions WHERE bed_id=$1 AND patient_id=$2 AND discharged_at IS NULL FOR UPDATE", [fromId.data, current.patient_id]);
        if (!admission.rows[0])
            return false;
        await client.query("UPDATE beds SET status='Available',patient_id=NULL WHERE id=$1", [fromId.data]);
        await client.query("UPDATE beds SET status='Occupied',patient_id=$2 WHERE id=$1", [input.data.target_bed_id, current.patient_id]);
        await client.query("UPDATE admissions SET bed_id=$2 WHERE id=$1", [admission.rows[0].id, input.data.target_bed_id]);
        await client.query("INSERT INTO bed_transfers (id,admission_id,from_bed_id,to_bed_id,transferred_by) VALUES ($1,$2,$3,$4,$5)", [randomUUID(), admission.rows[0].id, fromId.data, input.data.target_bed_id, request.user.id]);
        return true;
    });
    if (!moved) {
        response.status(409).json({ error: "The patient or destination bed status has changed. Refresh and try again." });
        return;
    }
    await audit(request, "transfer", "bed", fromId.data);
    response.status(204).end();
}));
apiRouter.patch("/beds/:id/maintenance", requirePermission("beds:write"), route(async (request, response) => {
    const bedId = uuid.safeParse(request.params.id);
    const input = z.object({ maintenance: z.boolean() }).safeParse(request.body);
    if (!bedId.success || !input.success) {
        response.status(400).json({ error: "Invalid bed status." });
        return;
    }
    const status = input.data.maintenance ? "Maintenance" : "Available";
    const result = await pool.query("UPDATE beds SET status=$2 WHERE id=$1 AND status <> 'Occupied' RETURNING id", [bedId.data, status]);
    if (!result.rowCount) {
        response.status(409).json({ error: "Occupied beds cannot be marked for maintenance." });
        return;
    }
    await audit(request, "update_status", "bed", bedId.data);
    response.status(204).end();
}));
apiRouter.get("/medical-records", requirePermission("medical-records:read"), route(async (request, response) => {
    const { page, limit, offset, search } = pagination(request);
    const term = `%${search}%`;
    const [items, count] = await Promise.all([
        pool.query(`SELECT mr.id,p.name AS patient_name,p.patient_id,mr.diagnosis,mr.prescription,mr.allergies,
              mr.test_results,mr.treatment,mr.created_at
       FROM medical_records mr JOIN patients p ON p.id=mr.patient_id
       WHERE ($1='' OR p.name ILIKE $2 OR p.patient_id ILIKE $2 OR mr.diagnosis ILIKE $2)
         AND ($5::text <> 'doctor' OR EXISTS (
           SELECT 1 FROM appointments ap JOIN doctors doc ON doc.id=ap.doctor_id
           WHERE ap.patient_id=p.id AND doc.staff_id=$6
         ))
       ORDER BY mr.created_at DESC LIMIT $3 OFFSET $4`, [search, term, limit, offset, request.user.role, request.user.id]),
        pool.query(`SELECT COUNT(*) AS count FROM medical_records mr JOIN patients p ON p.id=mr.patient_id
       WHERE ($1='' OR p.name ILIKE $2 OR p.patient_id ILIKE $2 OR mr.diagnosis ILIKE $2)
         AND ($3::text <> 'doctor' OR EXISTS (
           SELECT 1 FROM appointments ap JOIN doctors doc ON doc.id=ap.doctor_id
           WHERE ap.patient_id=p.id AND doc.staff_id=$4
         ))`, [search, term, request.user.role, request.user.id])
    ]);
    await audit(request, "list", "medical_records");
    response.json(pageResult(items.rows, count.rows[0].count, page, limit));
}));
apiRouter.post("/medical-records", requirePermission("medical-records:write"), route(async (request, response) => {
    const input = validated(medicalRecordSchema, request, response);
    if (!input)
        return;
    const id = randomUUID();
    const result = await pool.query(`INSERT INTO medical_records (id,patient_id,author_id,diagnosis,prescription,allergies,test_results,treatment)
     VALUES ($1,$2,$3,$4,NULLIF($5,''),NULLIF($6,''),NULLIF($7,''),NULLIF($8,''))
     RETURNING id,patient_id,diagnosis,created_at`, [id, input.patient_id, request.user.id, input.diagnosis, input.prescription, input.allergies, input.test_results, input.treatment]);
    await audit(request, "create_clinical_record", "medical_record", id);
    response.status(201).json(result.rows[0]);
}));
apiRouter.get("/inventory", requirePermission("pharmacy:read"), route(async (request, response) => {
    const { page, limit, offset, search } = pagination(request);
    const term = `%${search}%`;
    const [items, count] = await Promise.all([
        pool.query(`SELECT id,name,sku,category,quantity,reorder_level,unit_price FROM inventory
       WHERE ($1='' OR name ILIKE $2 OR sku ILIKE $2 OR category ILIKE $2)
       ORDER BY name LIMIT $3 OFFSET $4`, [search, term, limit, offset]),
        pool.query("SELECT COUNT(*) AS count FROM inventory WHERE ($1='' OR name ILIKE $2 OR sku ILIKE $2 OR category ILIKE $2)", [search, term])
    ]);
    response.json(pageResult(items.rows, count.rows[0].count, page, limit));
}));
apiRouter.post("/inventory", requirePermission("pharmacy:write"), route(async (request, response) => {
    const input = validated(inventorySchema, request, response);
    if (!input)
        return;
    const id = randomUUID();
    const result = await pool.query(`INSERT INTO inventory (id,name,sku,category,quantity,reorder_level,unit_price)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id,name,sku,category,quantity,reorder_level,unit_price`, [id, input.name, input.sku, input.category, input.quantity, input.reorder_level, input.unit_price]);
    await audit(request, "create", "inventory", id);
    response.status(201).json(result.rows[0]);
}));
apiRouter.post("/inventory/:id/restock", requirePermission("pharmacy:write"), route(async (request, response) => {
    const id = uuid.safeParse(request.params.id);
    const input = z.object({ quantity: z.number().int().min(1).max(10_000) }).safeParse(request.body);
    if (!id.success || !input.success) {
        response.status(400).json({ error: "Enter a valid restock quantity." });
        return;
    }
    const result = await pool.query("UPDATE inventory SET quantity=quantity+$2,updated_at=NOW() WHERE id=$1 RETURNING id,quantity", [id.data, input.data.quantity]);
    if (!result.rows[0]) {
        response.status(404).json({ error: "Inventory item not found." });
        return;
    }
    await audit(request, "restock", "inventory", id.data);
    response.json(result.rows[0]);
}));
apiRouter.get("/clinical-patients", requirePermission("laboratory:write"), route(async (request, response) => {
    const result = await pool.query(`SELECT p.id,p.patient_id,p.name FROM patients p
     WHERE ($1::text <> 'doctor' OR EXISTS (
       SELECT 1 FROM appointments ap JOIN doctors doc ON doc.id=ap.doctor_id
       WHERE ap.patient_id=p.id AND doc.staff_id=$2
     ))
     ORDER BY p.name LIMIT 500`, [request.user.role, request.user.id]);
    await audit(request, "list_for_lab", "patient");
    response.json({ items: result.rows });
}));
apiRouter.get("/lab-orders", requirePermission("laboratory:read"), route(async (request, response) => {
    const { page, limit, offset, search } = pagination(request);
    const term = `%${search}%`;
    const [items, count] = await Promise.all([
        pool.query(`SELECT l.id,p.name AS patient_name,l.test_name,l.status,l.ordered_at
       FROM lab_orders l JOIN patients p ON p.id=l.patient_id
       WHERE ($1='' OR p.name ILIKE $2 OR p.patient_id ILIKE $2 OR l.test_name ILIKE $2)
         AND ($5::text <> 'doctor' OR l.ordered_by=$6)
       ORDER BY l.ordered_at DESC LIMIT $3 OFFSET $4`, [search, term, limit, offset, request.user.role, request.user.id]),
        pool.query(`SELECT COUNT(*) AS count FROM lab_orders l JOIN patients p ON p.id=l.patient_id
       WHERE ($1='' OR p.name ILIKE $2 OR p.patient_id ILIKE $2 OR l.test_name ILIKE $2)
         AND ($3::text <> 'doctor' OR l.ordered_by=$4)`, [search, term, request.user.role, request.user.id])
    ]);
    await audit(request, "list", "lab_order");
    response.json(pageResult(items.rows, count.rows[0].count, page, limit));
}));
apiRouter.post("/lab-orders", requirePermission("laboratory:write"), route(async (request, response) => {
    const input = z.object({ patient_id: uuid, test_name: z.string().trim().min(2).max(150) }).safeParse(request.body);
    if (!input.success) {
        response.status(400).json({ error: "Select a patient and provide a valid test name." });
        return;
    }
    const id = randomUUID();
    const result = await pool.query(`INSERT INTO lab_orders (id,patient_id,ordered_by,test_name) VALUES ($1,$2,$3,$4)
     RETURNING id,patient_id,test_name,status,ordered_at`, [id, input.data.patient_id, request.user.id, input.data.test_name]);
    await audit(request, "create", "lab_order", id);
    response.status(201).json(result.rows[0]);
}));
apiRouter.patch("/lab-orders/:id", requirePermission("laboratory:write"), route(async (request, response) => {
    const id = uuid.safeParse(request.params.id);
    const input = z.object({ status: z.enum(["Completed", "Cancelled"]) }).safeParse(request.body);
    if (!id.success || !input.success) {
        response.status(400).json({ error: "Select a valid lab order status." });
        return;
    }
    const result = await pool.query("UPDATE lab_orders SET status=$2,completed_at=CASE WHEN $2='Completed' THEN NOW() ELSE NULL END WHERE id=$1 AND status='Pending' RETURNING id", [id.data, input.data.status]);
    if (!result.rows[0]) {
        response.status(404).json({ error: "Pending lab order not found." });
        return;
    }
    await audit(request, "update_status", "lab_order", id.data);
    response.status(204).end();
}));
apiRouter.get("/staff", requirePermission("*"), route(async (request, response) => {
    if (request.user.role !== "admin") {
        response.status(403).json({ error: "Administrator access is required." });
        return;
    }
    const { page, limit, offset, search } = pagination(request);
    const term = `%${search}%`;
    const [items, count] = await Promise.all([
        pool.query(`SELECT id,name,email,role,created_at FROM staff
       WHERE is_active AND ($1='' OR name ILIKE $2 OR email ILIKE $2 OR role ILIKE $2)
       ORDER BY name LIMIT $3 OFFSET $4`, [search, term, limit, offset]),
        pool.query("SELECT COUNT(*) AS count FROM staff WHERE is_active AND ($1='' OR name ILIKE $2 OR email ILIKE $2 OR role ILIKE $2)", [search, term])
    ]);
    response.json(pageResult(items.rows, count.rows[0].count, page, limit));
}));
apiRouter.post("/staff", requirePermission("*"), route(async (request, response) => {
    if (request.user.role !== "admin") {
        response.status(403).json({ error: "Administrator access is required." });
        return;
    }
    const input = z.object({
        name: z.string().trim().min(2).max(100),
        email: z.string().trim().email().max(254),
        password: z.string().min(12).max(200),
        role: z.enum(["doctor", "receptionist", "nurse", "pharmacist", "lab_technician", "accountant"])
    }).safeParse(request.body);
    if (!input.success) {
        response.status(400).json({ error: "Provide a name, valid email, 12-character password, and permitted role." });
        return;
    }
    const id = randomUUID();
    const passwordHash = await bcrypt.hash(input.data.password, 12);
    try {
        const staffRecord = await transaction(async (client) => {
            const result = await client.query(`INSERT INTO staff (id,name,email,password_hash,role)
         VALUES ($1,$2,$3,$4,$5) RETURNING id,name,email,role,created_at`, [id, input.data.name, input.data.email.toLowerCase(), passwordHash, input.data.role]);
            if (input.data.role === "doctor") {
                await client.query("UPDATE doctors SET staff_id=$1 WHERE lower(email)=$2", [id, input.data.email.toLowerCase()]);
            }
            return result.rows[0];
        });
        await audit(request, "create", "staff", id);
        response.status(201).json(staffRecord);
    }
    catch (error) {
        if (error instanceof Error && "code" in error && error.code === "23505") {
            response.status(409).json({ error: "An account with that email already exists." });
            return;
        }
        throw error;
    }
}));
apiRouter.get("/billing-patients", requirePermission("billing:write"), route(async (_request, response) => {
    const result = await pool.query("SELECT id,patient_id,name FROM patients ORDER BY name LIMIT 500");
    await audit(_request, "list_for_billing", "patient");
    response.json({ items: result.rows });
}));
apiRouter.get("/bills", requirePermission("billing:read"), route(async (request, response) => {
    const { page, limit, offset, search } = pagination(request);
    const term = `%${search}%`;
    const [items, count] = await Promise.all([
        pool.query(`SELECT b.id,p.name AS patient_name,b.description,b.items,b.amount,b.paid,b.status,b.issued_at
       FROM bills b JOIN patients p ON p.id=b.patient_id
       WHERE ($1='' OR p.name ILIKE $2 OR p.patient_id ILIKE $2 OR b.description ILIKE $2)
       ORDER BY b.issued_at DESC LIMIT $3 OFFSET $4`, [search, term, limit, offset]),
        pool.query(`SELECT COUNT(*) AS count FROM bills b JOIN patients p ON p.id=b.patient_id
       WHERE ($1='' OR p.name ILIKE $2 OR p.patient_id ILIKE $2 OR b.description ILIKE $2)`, [search, term])
    ]);
    await audit(request, "list", "bill");
    response.json(pageResult(items.rows, count.rows[0].count, page, limit));
}));
apiRouter.post("/bills", requirePermission("billing:write"), route(async (request, response) => {
    const input = moneyItemsSchema.safeParse(request.body);
    if (!input.success) {
        response.status(400).json({ error: "Select a patient and provide at least one valid charge." });
        return;
    }
    const amount = Math.round(input.data.items.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
    if (amount <= 0 || amount > 1_000_000) {
        response.status(400).json({ error: "The bill total must be between $0.01 and $1,000,000." });
        return;
    }
    const description = input.data.items.map(item => item.description).join(", ");
    const id = randomUUID();
    const result = await pool.query(`INSERT INTO bills (id,patient_id,description,items,amount)
     VALUES ($1,$2,$3,$4::jsonb,$5)
     RETURNING id,patient_id,description,amount,paid,status,issued_at`, [id, input.data.patient_id, description, JSON.stringify(input.data.items), amount]);
    await audit(request, "create", "bill", id);
    response.status(201).json(result.rows[0]);
}));
apiRouter.post("/bills/:id/payments", requirePermission("billing:write"), route(async (request, response) => {
    const billId = uuid.safeParse(request.params.id);
    const input = z.object({ amount: z.number().positive().max(1_000_000) }).safeParse(request.body);
    if (!billId.success || !input.success) {
        response.status(400).json({ error: "Enter a valid payment amount." });
        return;
    }
    const paymentId = randomUUID();
    let result = null;
    await transaction(async (client) => {
        const bill = await client.query("SELECT amount,paid FROM bills WHERE id=$1 FOR UPDATE", [billId.data]);
        if (!bill.rows[0])
            throw httpError("Bill not found.", 404);
        const balance = Number(bill.rows[0].amount) - Number(bill.rows[0].paid);
        if (input.data.amount > balance + 0.0001)
            throw httpError("Payment exceeds the outstanding balance.", 400);
        const paid = Math.round((Number(bill.rows[0].paid) + input.data.amount) * 100) / 100;
        const status = paid >= Number(bill.rows[0].amount) ? "Paid" : "Partially paid";
        await client.query("INSERT INTO payments (id,bill_id,amount,received_by) VALUES ($1,$2,$3,$4)", [paymentId, billId.data, input.data.amount, request.user.id]);
        await client.query("UPDATE bills SET paid=$2,status=$3 WHERE id=$1", [billId.data, paid, status]);
        result = { status, paid: String(paid) };
    });
    await audit(request, "record_payment", "bill", billId.data);
    response.status(201).json(result);
}));
apiRouter.get("/reports", requirePermission("reports:read"), route(async (request, response) => {
    const days = Number(request.query.days);
    const period = Number.isInteger(days) && [7, 30, 90].includes(days) ? days : 30;
    const billingAccess = can(request.user.role, "billing:read");
    const revenueQuery = billingAccess
        ? pool.query(`SELECT TO_CHAR(days.day,'Mon DD') AS period,COALESCE(SUM(p.amount),0) AS revenue
       FROM generate_series(CURRENT_DATE - ($1::int - 1) * INTERVAL '1 day',CURRENT_DATE,INTERVAL '1 day') AS days(day)
       LEFT JOIN payments p ON p.received_at >= days.day AND p.received_at < days.day + INTERVAL '1 day'
       GROUP BY days.day ORDER BY days.day`, [period])
        : Promise.resolve({ rows: [] });
    const [activity, revenue, beds] = await Promise.all([
        pool.query(`SELECT TO_CHAR(days.day,'Mon DD') AS period,
        COUNT(DISTINCT a.id) FILTER (WHERE a.status='Completed') AS visits,
        COUNT(DISTINCT admitted.id) AS admissions,
        COUNT(DISTINCT discharged.id) AS discharges
       FROM generate_series(CURRENT_DATE - ($1::int - 1) * INTERVAL '1 day',CURRENT_DATE,INTERVAL '1 day') AS days(day)
       LEFT JOIN appointments a ON a.starts_at >= days.day AND a.starts_at < days.day + INTERVAL '1 day'
       LEFT JOIN admissions admitted ON admitted.admitted_at >= days.day AND admitted.admitted_at < days.day + INTERVAL '1 day'
       LEFT JOIN admissions discharged ON discharged.discharged_at >= days.day AND discharged.discharged_at < days.day + INTERVAL '1 day'
       GROUP BY days.day ORDER BY days.day`, [period]),
        revenueQuery,
        pool.query("SELECT status,COUNT(*) AS count FROM beds GROUP BY status ORDER BY status")
    ]);
    const bedOccupancy = ["Occupied", "Available", "Maintenance"].map(status => ({
        status,
        count: Number(beds.rows.find(row => row.status === status)?.count ?? 0)
    }));
    const patientVisits = activity.rows.map(row => ({
        period: row.period,
        visits: Number(row.visits),
        admissions: Number(row.admissions),
        discharges: Number(row.discharges)
    }));
    const revenueRows = revenue.rows.map(row => ({ period: row.period, revenue: Number(row.revenue) }));
    const totalBeds = bedOccupancy.reduce((sum, item) => sum + item.count, 0);
    response.json({
        patientVisits,
        revenue: revenueRows,
        bedOccupancy,
        totals: {
            patients: patientVisits.reduce((sum, row) => sum + row.visits, 0),
            admissions: patientVisits.reduce((sum, row) => sum + row.admissions, 0),
            discharges: patientVisits.reduce((sum, row) => sum + row.discharges, 0),
            revenue: billingAccess ? revenueRows.reduce((sum, row) => sum + row.revenue, 0) : null,
            occupancy: totalBeds ? Math.round((bedOccupancy[0].count / totalBeds) * 100) : 0
        }
    });
}));
apiRouter.get("/settings", requirePermission("*"), route(async (request, response) => {
    if (request.user.role !== "admin") {
        response.status(403).json({ error: "Administrator access is required." });
        return;
    }
    const result = await pool.query("SELECT setting_value FROM hospital_settings WHERE setting_key='organization'");
    response.json(result.rows[0]?.setting_value ?? { hospital_name: "CarePoint Hospital", address: "", phone: "", timezone: "UTC" });
}));
apiRouter.put("/settings", requirePermission("*"), route(async (request, response) => {
    if (request.user.role !== "admin") {
        response.status(403).json({ error: "Administrator access is required." });
        return;
    }
    const input = validated(settingsSchema, request, response);
    if (!input)
        return;
    await pool.query(`INSERT INTO hospital_settings (setting_key,setting_value,updated_by,updated_at)
     VALUES ('organization',$1::jsonb,$2,NOW())
     ON CONFLICT (setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_by=EXCLUDED.updated_by,updated_at=NOW()`, [JSON.stringify(input), request.user.id]);
    await audit(request, "update", "hospital_settings", "organization");
    response.json(input);
}));
