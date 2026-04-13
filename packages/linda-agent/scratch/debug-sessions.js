
import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
import path from 'path';

// Загружаем .env из корня проекта psf-engine-v2
dotenv.config({ path: 'd:/Work/Projects/2026/psf-engine-v2/.env' });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
    console.error("DATABASE_URL is not set in .env");
    process.exit(1);
}

const sql = neon(databaseUrl);
const firmId = "default-clinic";

async function debug() {
    try {
        console.log("Testing SQL query...");
        const rows = await sql`
            WITH latest_log_per_thread AS (
                SELECT DISTINCT ON (thread_id)
                    thread_id,
                    action_type,
                    payload_json,
                    created_at
                FROM psf_clinic_agent_action_logs
                ORDER BY thread_id, created_at DESC
            )
            SELECT 
                t.client_id as "sessionId",
                ll.created_at as "createdAt",
                c.full_name as "clientName",
                COALESCE(p.next_step, ll.payload_json->>'activeSkill') as "currentStep",
                COALESCE(ll.payload_json->>'conversationGoal', p.main_goal, '...') as "lastUtterance"
            FROM latest_log_per_thread ll
            JOIN psf_clinic_conversation_threads t ON ll.thread_id = t.id
            JOIN psf_clinic_clients c ON t.client_id = c.client_id
            LEFT JOIN psf_clinic_client_profiles p ON t.client_id = p.client_id
            WHERE t.firm_id = ${firmId}
            ORDER BY ll.created_at DESC
            LIMIT 20
        `;
        console.log("Success! Rows found:", rows.length);
        console.log("First row sample:", rows[0]);
    } catch (error) {
        console.error("SQL Error details:");
        console.error(error);
    }
}

debug();
