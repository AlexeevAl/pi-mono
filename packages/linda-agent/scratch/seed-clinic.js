
import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: 'd:/Work/Projects/2026/psf-engine-v2/products/clinic-profile-os/.env' });

if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not found in .env");
    process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

async function seed() {
    const now = new Date().toISOString();
    const firmId = 'linda-clinic';
    
    try {
        console.log(`Checking if firm ${firmId} exists...`);
        
        await sql`
            INSERT INTO psf_clinic_firms (id, name, slug, status, created_at, updated_at)
            VALUES (${firmId}, 'Linda Clinic', 'linda-clinic', 'active', ${now}, ${now})
            ON CONFLICT (id) DO UPDATE SET updated_at = ${now}
        `;
        
        console.log(`✅ Firm ${firmId} ensured in database.`);
        
        // Также создадим аккаунт для админа, если его нет (чтобы авторизация проходила)
        // Но это опционально, главное — фирма.
        
    } catch (e) {
        console.error("Seed failed:", e.message);
    }
}

seed();
