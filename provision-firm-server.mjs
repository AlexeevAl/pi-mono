import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const port = Number(process.env.PROVISION_PORT || 3037);
const sharedSecret = (process.env.PROVISION_SHARED_SECRET || process.env.BRIDGE_SHARED_SECRET || '').trim();
const repoRoot = process.cwd();
const addFirmScript = resolve(repoRoot, 'add-firm.sh');

createServer(async (req, res) => {
    try {
        if (req.method === 'OPTIONS') {
            res.writeHead(204, corsHeaders());
            res.end();
            return;
        }

        const url = new URL(req.url || '/', `http://localhost:${port}`);
        if (req.method === 'GET' && url.pathname === '/health') {
            writeJson(res, 200, { ok: true });
            return;
        }

        if (req.method !== 'POST' || url.pathname !== '/api/admin/firms/provision') {
            writeJson(res, 404, { error: 'not_found', path: url.pathname });
            return;
        }

        if (sharedSecret) {
            const auth = req.headers.authorization || '';
            const headerSecret = req.headers['x-bridge-shared-secret'];
            const resolvedHeaderSecret = Array.isArray(headerSecret) ? headerSecret[0] : headerSecret;
            if (auth !== `Bearer ${sharedSecret}` && auth !== sharedSecret && resolvedHeaderSecret !== sharedSecret) {
                writeJson(res, 403, { error: 'forbidden' });
                return;
            }
        }

        const body = await readJson(req);
        const firmId = normalizeFirmId(body?.firm?.id || body?.firmId);
        if (!firmId) {
            writeJson(res, 400, { error: 'missing_firm_id' });
            return;
        }

        const result = await runAddFirm(firmId);
        if (result.exitCode !== 0) {
            writeJson(res, 500, {
                error: 'add_firm_failed',
                firmId,
                exitCode: result.exitCode,
                stdout: result.stdout,
                stderr: result.stderr,
            });
            return;
        }

        writeJson(res, 200, {
            ok: true,
            firmId,
            stdout: result.stdout,
            stderr: result.stderr,
        });
    } catch (error) {
        writeJson(res, 500, {
            error: 'provision_failed',
            message: error instanceof Error ? error.message : String(error),
        });
    }
}).listen(port, () => {
    console.log(`[Provision] listening on http://localhost:${port}`);
    console.log(`[Provision] endpoint POST /api/admin/firms/provision`);
});

function normalizeFirmId(value) {
    if (typeof value !== 'string') return '';
    return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 64);
}

function runAddFirm(firmId) {
    return new Promise((resolvePromise) => {
        const child = spawn('bash', [addFirmScript, firmId], {
            cwd: repoRoot,
            env: process.env,
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        child.on('close', (exitCode) => {
            resolvePromise({ exitCode, stdout, stderr });
        });
    });
}

function readJson(req) {
    return new Promise((resolvePromise, reject) => {
        let raw = '';
        req.on('data', (chunk) => {
            raw += chunk;
            if (raw.length > 1_000_000) {
                req.destroy(new Error('body_too_large'));
            }
        });
        req.on('end', () => {
            if (!raw.trim()) {
                resolvePromise({});
                return;
            }
            try {
                resolvePromise(JSON.parse(raw));
            } catch (error) {
                reject(error);
            }
        });
        req.on('error', reject);
    });
}

function writeJson(res, status, payload) {
    res.writeHead(status, {
        ...corsHeaders(),
        'Content-Type': 'application/json; charset=utf-8',
    });
    res.end(JSON.stringify(payload));
}

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-bridge-shared-secret',
    };
}
