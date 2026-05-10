import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
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

        if (req.method === 'GET' && url.pathname === '/api/admin/firms/runtime') {
            if (!isAuthorized(req)) {
                writeJson(res, 403, { error: 'forbidden' });
                return;
            }

            writeJson(res, 200, await listRuntimeFirms());
            return;
        }

        if (req.method !== 'POST' || url.pathname !== '/api/admin/firms/provision') {
            writeJson(res, 404, { error: 'not_found', path: url.pathname });
            return;
        }

        if (!isAuthorized(req)) {
            writeJson(res, 403, { error: 'forbidden' });
            return;
        }

        const body = await readJson(req);
        const firmId = normalizeFirmId(body?.firm?.id || body?.firmId);
        const firmName = normalizeFirmName(body?.firm?.name || body?.firmName || firmId);
        if (!firmId) {
            writeJson(res, 400, { error: 'missing_firm_id' });
            return;
        }

        const result = await runAddFirm(firmId, firmName);
        if (result.exitCode !== 0) {
            writeJson(res, 500, {
                error: 'add_firm_failed',
                firmId,
                firmName,
                exitCode: result.exitCode,
                stdout: result.stdout,
                stderr: result.stderr,
            });
            return;
        }
        const startResult = startFirmAsync(firmId);

        writeJson(res, 200, {
            ok: true,
            status: startResult.started ? 'started' : 'registered',
            firmId,
            firmName,
            serviceName: `linda-${firmId}`,
            stdout: result.stdout,
            stderr: result.stderr,
            start: startResult,
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

function normalizeFirmName(value) {
    if (typeof value !== 'string') return '';
    return value.trim().replace(/[\r\n]/g, ' ').replace(/\s+/g, ' ').slice(0, 120);
}

function isAuthorized(req) {
    if (!sharedSecret) return true;
    const auth = req.headers.authorization || '';
    const headerSecret = req.headers['x-bridge-shared-secret'];
    const resolvedHeaderSecret = Array.isArray(headerSecret) ? headerSecret[0] : headerSecret;
    return auth === `Bearer ${sharedSecret}` || auth === sharedSecret || resolvedHeaderSecret === sharedSecret;
}

function runAddFirm(firmId, firmName) {
    return new Promise((resolvePromise) => {
        const child = spawn('bash', [addFirmScript, firmId, firmName || firmId], {
            cwd: repoRoot,
            env: {
                ...process.env,
                AUTO_START: '0',
            },
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

function startFirmAsync(firmId) {
    const serviceName = `linda-${firmId}`;
    const command = [
        'if docker compose version >/dev/null 2>&1; then',
        `docker compose up -d --build ${shellQuote(serviceName)};`,
        'elif command -v docker-compose >/dev/null 2>&1; then',
        `docker-compose up -d --build ${shellQuote(serviceName)};`,
        'else',
        'echo "docker compose is not available" >&2;',
        'exit 127;',
        'fi',
    ].join(' ');

    try {
        const child = spawn('bash', ['-lc', command], {
            cwd: repoRoot,
            env: process.env,
            detached: true,
            stdio: 'ignore',
        });
        child.unref();
        return {
            started: true,
            serviceName,
        };
    } catch (error) {
        return {
            started: false,
            serviceName,
            message: error instanceof Error ? error.message : String(error),
        };
    }
}

function shellQuote(value) {
    return `'${String(value).replaceAll("'", "'\\''")}'`;
}

async function listRuntimeFirms() {
    const composeServices = await readLindaServices();
    const composeStatus = await readDockerComposePs();
    const folderIds = await readFirmFolderIds();
    const firmIds = new Set([
        ...folderIds,
        ...composeServices.map((service) => service.firmId),
        ...composeStatus.map((service) => service.firmId).filter(Boolean),
    ]);

    return {
        ok: true,
        generatedAt: new Date().toISOString(),
        firms: [...firmIds].sort().map((firmId) => {
            const serviceName = `linda-${firmId}`;
            const composeService = composeServices.find((service) => service.firmId === firmId);
            const runningService = composeStatus.find((service) => service.service === serviceName || service.firmId === firmId);
            return {
                firmId,
                folderExists: folderIds.includes(firmId),
                serviceName,
                serviceExists: Boolean(composeService),
                containerName: runningService?.name || composeService?.containerName || serviceName,
                state: runningService?.state || 'missing',
                status: runningService?.status || '',
                ports: runningService?.ports || '',
                running: runningService?.state === 'running',
            };
        }),
    };
}

async function readFirmFolderIds() {
    const firmsPath = resolve(repoRoot, 'firms');
    if (!existsSync(firmsPath)) return [];
    const entries = await readdir(firmsPath, { withFileTypes: true });
    return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => normalizeFirmId(entry.name))
        .filter(Boolean);
}

async function readLindaServices() {
    const composeTexts = await Promise.all(['docker-compose.yml', 'docker-compose.override.yml'].map(readComposeFile));
    const text = composeTexts.filter(Boolean).join('\n');
    if (!text) return [];

    return readComposeServiceBlocks(text)
        .map((serviceBlock) => {
            const firmId = normalizeFirmId(serviceBlock.serviceName.replace(/^linda-/, ''));
            return {
                firmId,
                serviceName: `linda-${firmId}`,
                containerName: readContainerName(serviceBlock.block) || `linda-${firmId}`,
            };
        })
        .filter((service) => service.firmId && service.firmId !== 'provisioner');
}

async function readComposeFile(fileName) {
    const composePath = resolve(repoRoot, fileName);
    if (!existsSync(composePath)) return '';
    return readFile(composePath, 'utf8');
}

function readComposeServiceBlocks(text) {
    const lines = text.split(/\r?\n/);
    const blocks = [];
    let current = null;

    for (const line of lines) {
        const serviceMatch = line.match(/^  (linda-[a-z0-9_-]+):\s*$/);
        const nextServiceMatch = line.match(/^  [a-zA-Z0-9_-]+:\s*$/);

        if (serviceMatch) {
            if (current) blocks.push(current);
            current = {
                serviceName: serviceMatch[1],
                block: `${line}\n`,
            };
            continue;
        }

        if (nextServiceMatch && current) {
            blocks.push(current);
            current = null;
            continue;
        }

        if (current) {
            current.block += `${line}\n`;
        }
    }

    if (current) blocks.push(current);
    return blocks;
}

function readContainerName(serviceBlock) {
    const match = serviceBlock.match(/container_name:\s*([^\s]+)/);
    return match?.[1]?.trim() || '';
}

async function readDockerComposePs() {
    const result = await runCommand('docker', ['ps', '-a', '--filter', 'name=^linda-', '--format', '{{json .}}']);
    if (result.exitCode !== 0) return [];
    const trimmed = result.stdout.trim();
    if (!trimmed) return [];

    try {
        return trimmed
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line))
            .map(normalizeDockerPsItem)
            .filter((item) => item.service.startsWith('linda-') && item.firmId !== 'provisioner');
    } catch (error) {
        console.warn('[Provision] failed to parse docker ps output', error);
        return [];
    }
}

function normalizeDockerPsItem(item) {
    const name = String(item.Names || item.names || item.Name || item.name || '').replace(/^\//, '');
    const service = name.startsWith('linda-') ? name : String(item.Service || item.service || '');
    const state = String(item.State || item.state || item.Status || item.status || '').toLowerCase();
    return {
        service,
        firmId: normalizeFirmId(service.replace(/^linda-/, '')),
        name,
        state: state.includes('up') ? 'running' : state,
        status: String(item.Status || item.status || ''),
        ports: String(item.Ports || item.ports || ''),
    };
}

function runCommand(command, args) {
    return new Promise((resolvePromise) => {
        const child = spawn(command, args, {
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
