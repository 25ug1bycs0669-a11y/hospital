import "dotenv/config";
import bcrypt from "bcryptjs";
import { pool } from "./db.js";

async function seed(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password || password.length < 12) {
    throw new Error("Set ADMIN_EMAIL and a SEED_ADMIN_PASSWORD of at least 12 characters.");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ('Hospital Administrator', $1, $2, 'admin')
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, active = true`,
      [email, passwordHash]
    );
    const departments = [
      ["Cardiology", "Heart and cardiovascular care"],
      ["Neurology", "Brain and nervous system care"],
      ["Pediatrics", "Medical care for children"],
      ["Orthopedics", "Bone and joint care"],
      ["Emergency", "Urgent and emergency care"],
      ["General Medicine", "Primary and general medical care"]
    ];
    for (const [name, description] of departments) {
      await client.query(
        "INSERT INTO departments (name, description) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING",
        [name, description]
      );
    }

    const patients = [
      ["PT-1001", "Olivia Bennett", "olivia@example.test", "555-0101", "1987-04-12", "Female", "O+"],
      ["PT-1002", "Ethan Parker", "ethan@example.test", "555-0102", "1979-09-26", "Male", "A+"],
      ["PT-1003", "Ava Thompson", "ava@example.test", "555-0103", "2014-02-08", "Female", "B+"],
      ["PT-1004", "Noah Williams", "noah@example.test", "555-0104", "1991-11-17", "Male", "AB+"],
      ["PT-1005", "Mia Robinson", "mia@example.test", "555-0105", "1968-06-03", "Female", "O-"],
      ["PT-1006", "Lucas Garcia", "lucas@example.test", "555-0106", "2000-01-21", "Male", "A-"]
    ];
    for (const patient of patients) {
      await client.query(
        `INSERT INTO patients (patient_id, name, email, phone, date_of_birth, gender, blood_group)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (patient_id) DO NOTHING`,
        patient
      );
    }

    const doctorData = [
      ["Dr. Emily Chen", "emily.chen@example.test", "555-0201", "Cardiologist", "Cardiology"],
      ["Dr. James Patel", "james.patel@example.test", "555-0202", "Neurologist", "Neurology"],
      ["Dr. Sophia Rivera", "sophia.rivera@example.test", "555-0203", "Pediatrician", "Pediatrics"],
      ["Dr. Michael Lee", "michael.lee@example.test", "555-0204", "Orthopedic surgeon", "Orthopedics"],
      ["Dr. Amina Yusuf", "amina.yusuf@example.test", "555-0205", "Emergency physician", "Emergency"]
    ];
    for (const [name, doctorEmail, phone, specialization, department] of doctorData) {
      await client.query(
        `INSERT INTO doctors (name, email, phone, specialization, department_id)
         SELECT $1, $2, $3, $4, id FROM departments WHERE name = $5
         ON CONFLICT (email) DO NOTHING`,
        [name, doctorEmail, phone, specialization, department]
      );
    }
    const bedCount = await client.query<{ count: string }>("SELECT count(*) FROM beds");
    if (Number(bedCount.rows[0].count) === 0) {
      for (let index = 1; index <= 36; index++) {
        const status = index <= 24 ? "Occupied" : index <= 34 ? "Available" : "Maintenance";
        const patientResult = status === "Occupied"
          ? await client.query<{ id: string }>("SELECT id FROM patients ORDER BY patient_id LIMIT 1 OFFSET $1", [index % patients.length])
          : null;
        const patientId = patientResult?.rows[0]?.id ?? null;
        const result = await client.query<{ id: string }>(
          `INSERT INTO beds (ward, room, bed_number, status, patient_id)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [index <= 12 ? "North Ward" : index <= 24 ? "South Ward" : "East Ward", String(Math.ceil(index / 4)).padStart(2, "0"), `B${String(index).padStart(2, "0")}`, status, patientId]
        );
        if (patientId) await client.query("INSERT INTO admissions (patient_id, bed_id) VALUES ($1, $2)", [patientId, result.rows[0].id]);
      }
    }
    const appointmentCount = await client.query<{ count: string }>("SELECT count(*) FROM appointments");
    if (Number(appointmentCount.rows[0].count) === 0) {
      await client.query(
        `INSERT INTO appointments (patient_id, doctor_id, scheduled_at, status)
         SELECT p.id, d.id, now() + schedule.offset_value, schedule.status
         FROM (VALUES
           ('PT-1001', 'emily.chen@example.test', interval '45 minutes', 'Scheduled'),
           ('PT-1002', 'james.patel@example.test', interval '2 hours', 'Scheduled'),
           ('PT-1003', 'sophia.rivera@example.test', interval '1 day', 'Scheduled'),
           ('PT-1004', 'michael.lee@example.test', interval '-1 day', 'Completed'),
           ('PT-1005', 'amina.yusuf@example.test', interval '4 hours', 'Scheduled')
         ) AS schedule(patient_key, doctor_email, offset_value, status)
         JOIN patients p ON p.patient_id = schedule.patient_key
         JOIN doctors d ON d.email = schedule.doctor_email`
      );
    }
    const billsCount = await client.query<{ count: string }>("SELECT count(*) FROM bills");
    if (Number(billsCount.rows[0].count) === 0) {
      await client.query(
        `INSERT INTO bills (invoice_number, patient_id, amount, status)
         SELECT 'INV-' || lpad(row_number() OVER ()::text, 4, '0'), id,
           CASE WHEN row_number() OVER () = 1 THEN 680.00 ELSE 245.00 END,
           CASE WHEN row_number() OVER () = 1 THEN 'Pending' ELSE 'Paid' END
         FROM patients ORDER BY patient_id LIMIT 6`
      );
    }
    await client.query("COMMIT");
    console.log(`Seeded CarePoint data. Admin account: ${email}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(error => {
  console.error("Database seed failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});