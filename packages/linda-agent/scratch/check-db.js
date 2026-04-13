
import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';

dotenv.config({ path: 'd:/Work/Projects/2026/psf-engine-v2/products/clinic-profile-os/.env' });
const sql = neon(process.env.DATABASE_URL);

async function check() {
    try {
        console.log("--- DB CONTENTS ---");
        const clients = await sql`SELECT count(*), firm_id FROM psf_clinic_clients GROUP BY firm_id`;
        console.log("Clients count by firm:", clients);

        const logs = await sql`SELECT count(*), firm_id FROM psf_clinic_agent_action_logs GROUP BY firm_id`;
        console.log("Logs count by firm:", logs);

        const threads = await sql`SELECT count(*), firm_id FROM psf_clinic_conversation_threads GROUP BY firm_id`;
        console.log("Threads count by firm:", threads);
        
        const firms = await sql`SELECT id, name FROM psf_clinic_firms`;
        console.log("Registered firms:", firms);

    } catch (e) {
        console.error("Check failed:", e.message);
    }
}
check();
