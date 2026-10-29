import "dotenv/config";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { pool, initializeDatabase } from "./db.js";
await initializeDatabase();
const adminEmail = process.env.DEMO_ADMIN_EMAIL?.trim().toLowerCase();
const adminPassword = process.env.DEMO_ADMIN_PASSWORD;
if (!adminEmail || !adminPassword || adminPassword.length < 12) {
    throw new Error("Set DEMO_ADMIN_EMAIL and a DEMO_ADMIN_PASSWORD of at least 12 characters in your local environment.");
}
const admin = await pool.query("SELECT id FROM staff WHERE email=$1", [adminEmail]);
let adminId = admin.rows[0]?.id;
if (!adminId) {
    adminId = randomUUID();
    await pool.query("INSERT INTO staff (id,name,email,password_hash,role) VALUES ($1,$2,$3,$4,'admin')", [adminId, "Hospital Administrator", adminEmail, await bcrypt.hash(adminPassword, 12)]);
    console.info(`Created administrator account ${adminEmail}.`);
}
else {
    console.info(`Administrator account ${adminEmail} already exists; its password was not changed.`);
}
const departments = ["Cardiology", "Neurology", "Pediatrics", "Orthopedics", "Emergency", "General Medicine"];
for (const name of departments) {
    await pool.query("INSERT INTO departments (id,name,head) VALUES ($1,$2,NULL) ON CONFLICT (name) DO NOTHING", [randomUUID(), name]);
}
if (process.env.SEED_SYNTHETIC_DATA !== "true") {
    console.info("Synthetic demo records were not added. Set SEED_SYNTHETIC_DATA=true only for a non-production test database.");
    await pool.end();
    process.exit(0);
}
const doctorsCount = await pool.query("SELECT COUNT(*) AS count FROM doctors");
if (Number(doctorsCount.rows[0].count) === 0) {
    const doctors = [
        ["Dr. Emily Chen", "Cardiology", "Cardiology", "+1-555-0101", "emily.chen@carepoint.example", "Mon–Fri, 09:00–17:00"],
        ["Dr. James Patel", "Neurology", "Neurology", "+1-555-0102", "james.patel@carepoint.example", "Mon–Thu, 09:00–16:00"],
        ["Dr. Sophia Rivera", "Pediatrics", "Pediatrics", "+1-555-0103", "sophia.rivera@carepoint.example", "Tue–Sat, 08:00–16:00"],
        ["Dr. Michael Lee", "Orthopedics", "Orthopedics", "+1-555-0104", "michael.lee@carepoint.example", "Mon–Fri, 10:00–18:00"],
        ["Dr. Asha Rao", "General Medicine", "General Medicine", "+1-555-0105", "asha.rao@carepoint.example", "Mon–Fri, 08:00–16:00"]
    ];
    for (const [name, specialization, department, phone, email, availability] of doctors) {
        await pool.query("INSERT INTO doctors (id,name,specialization,department,phone,email,availability) VALUES ($1,$2,$3,$4,$5,$6,$7)", [randomUUID(), name, specialization, department, phone, email, availability]);
    }
}
const patientsCount = await pool.query("SELECT COUNT(*) AS count FROM patients");
if (Number(patientsCount.rows[0].count) === 0) {
    const patients = [
        ["Morgan Demo", "Female", "+1-555-0111", "morgan@carepoint.example", "A+"],
        ["Taylor Sample", "Male", "+1-555-0112", "taylor@carepoint.example", "O-"],
        ["Alex Fiction", "Non-binary", "+1-555-0113", null, "B+"],
        ["Casey Example", "Prefer not to say", "+1-555-0114", "casey@carepoint.example", null]
    ];
    const patientIds = [];
    for (const [index, patient] of patients.entries()) {
        const id = randomUUID();
        patientIds.push(id);
        await pool.query(`INSERT INTO patients (id,patient_id,name,date_of_birth,gender,phone,email,blood_group,address)
       VALUES ($1,$2,$3,CURRENT_DATE - ($4::int * INTERVAL '1 year'),$5,$6,$7,$8,'Demo data only')`, [id, `DEMO-${index + 1}`, patient[0], 24 + index * 9, patient[1], patient[2], patient[3], patient[4]]);
    }
    const doctorRows = await pool.query("SELECT id,name,department FROM doctors ORDER BY name");
    for (const [index, doctor] of doctorRows.rows.slice(0, 3).entries()) {
        const startsAt = new Date(Date.now() + (index + 1) * 60 * 60 * 1000).toISOString();
        await pool.query(`INSERT INTO appointments (id,patient_id,doctor_id,department,starts_at,status,created_by)
       VALUES ($1,$2,$3,$4,$5,'Scheduled',$6)`, [randomUUID(), patientIds[index], doctor.id, doctor.department, startsAt, adminId]);
    }
    await pool.query(`INSERT INTO medical_records (id,patient_id,author_id,diagnosis,allergies,treatment)
     VALUES ($1,$2,$3,'Synthetic demo record — not for clinical use','None recorded','Example only; replace with verified clinical data')`, [randomUUID(), patientIds[0], adminId]);
}
const bedsCount = await pool.query("SELECT COUNT(*) AS count FROM beds");
if (Number(bedsCount.rows[0].count) === 0) {
    const wards = ["General Medicine", "Cardiology", "Pediatrics", "Orthopedics"];
    for (let index = 0; index < 32; index++) {
        const ward = wards[index % wards.length];
        const status = index % 8 === 0 ? "Maintenance" : "Available";
        await pool.query("INSERT INTO beds (id,ward,bed_number,status) VALUES ($1,$2,$3,$4)", [randomUUID(), ward, `${String.fromCharCode(65 + (index % 4))}-${String(Math.floor(index / 4) + 1).padStart(2, "0")}`, status]);
    }
    const availableBeds = await pool.query("SELECT id FROM beds WHERE status='Available' ORDER BY id LIMIT 2");
    const patientRows = await pool.query("SELECT id FROM patients ORDER BY created_at LIMIT 2");
    for (let index = 0; index < Math.min(availableBeds.rows.length, patientRows.rows.length); index++) {
        const bed = availableBeds.rows[index];
        const patient = patientRows.rows[index];
        const admissionId = randomUUID();
        await pool.query("UPDATE beds SET status='Occupied',patient_id=$2 WHERE id=$1", [bed.id, patient.id]);
        await pool.query("INSERT INTO admissions (id,patient_id,bed_id) VALUES ($1,$2,$3)", [admissionId, patient.id, bed.id]);
    }
}
const inventoryCount = await pool.query("SELECT COUNT(*) AS count FROM inventory");
if (Number(inventoryCount.rows[0].count) === 0) {
    const stock = [
        ["Demo medication A", "DEMO-MED-001", "General", 3, 10, 4.5],
        ["Demo medication B", "DEMO-MED-002", "General", 54, 15, 8.25],
        ["Demo medical supplies", "DEMO-SUP-001", "Supplies", 24, 8, 2.75]
    ];
    for (const item of stock) {
        await pool.query("INSERT INTO inventory (id,name,sku,category,quantity,reorder_level,unit_price) VALUES ($1,$2,$3,$4,$5,$6,$7)", [randomUUID(), ...item]);
    }
}
const billsCount = await pool.query("SELECT COUNT(*) AS count FROM bills");
if (Number(billsCount.rows[0].count) === 0) {
    const patientRows = await pool.query("SELECT id FROM patients ORDER BY created_at LIMIT 2");
    if (patientRows.rows.length > 0) {
        const billId = randomUUID();
        const billItems = [{ description: "Consultation", amount: 180 }, { description: "Laboratory", amount: 65 }];
        await pool.query("INSERT INTO bills (id,patient_id,description,items,amount,paid,status) VALUES ($1,$2,$3,$4::jsonb,245,245,'Paid')", [billId, patientRows.rows[0].id, "Consultation, Laboratory", JSON.stringify(billItems)]);
        await pool.query("INSERT INTO payments (id,bill_id,amount,received_by) VALUES ($1,$2,245,$3)", [randomUUID(), billId, adminId]);
        if (patientRows.rows[1]) {
            const partialBillId = randomUUID();
            const partialItems = [{ description: "Room charges", amount: 300 }, { description: "Consultation", amount: 120 }];
            await pool.query("INSERT INTO bills (id,patient_id,description,items,amount,paid,status) VALUES ($1,$2,$3,$4::jsonb,420,150,'Partially paid')", [partialBillId, patientRows.rows[1].id, "Room charges, Consultation", JSON.stringify(partialItems)]);
            await pool.query("INSERT INTO payments (id,bill_id,amount,received_by) VALUES ($1,$2,150,$3)", [randomUUID(), partialBillId, adminId]);
        }
        await pool.query("INSERT INTO lab_orders (id,patient_id,ordered_by,test_name,status,completed_at) VALUES ($1,$2,$3,'Complete blood count','Completed',NOW())", [randomUUID(), patientRows.rows[0].id, adminId]);
    }
}
const settings = await pool.query("SELECT setting_key FROM hospital_settings WHERE setting_key='organization'");
if (!settings.rows[0]) {
    await pool.query("INSERT INTO hospital_settings (setting_key,setting_value,updated_by) VALUES ('organization',$1::jsonb,$2)", [JSON.stringify({ hospital_name: "CarePoint Community Hospital", address: "100 Example Avenue", phone: "+1-555-0100", timezone: "UTC" }), adminId]);
}
console.info("Synthetic CarePoint records are ready. All sample names and details are fictional.");
await pool.end();
