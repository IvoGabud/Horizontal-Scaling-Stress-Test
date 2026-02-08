const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

let config = {
    mu: 4.5,
    sigma: 0.8,
    minDelay: 10,
    maxDelay: 5000,
    cpuWork: true,
    diskWrite: false
};

const INSTANCE_ID = process.env.INSTANCE_ID || `node-${process.pid}`;
const PORT = process.env.PORT || 3000;

function boxMuller() {
    let u1 = Math.random();
    let u2 = Math.random();
    while (u1 === 0) u1 = Math.random();
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return z0;
}

function generateLogNormalDelay() {
    const normalValue = boxMuller();
    const logNormalValue = Math.exp(config.mu + config.sigma * normalValue);
    return Math.max(config.minDelay, Math.min(config.maxDelay, logNormalValue));
}

function doCpuWork(iterations) {
    let result = 0;
    for (let i = 0; i < iterations; i++) {
        result += Math.sin(i) * Math.cos(i) * Math.tan(i % 1000 + 1);
        result = Math.sqrt(Math.abs(result) + 1);
    }
    return result;
}

function doDiskWork(bytes) {
    const tempFile = path.join('/tmp', `ping-${INSTANCE_ID}-${Date.now()}.tmp`);
    const data = Buffer.alloc(bytes, 'x');
    try {
        fs.writeFileSync(tempFile, data);
        fs.unlinkSync(tempFile);
    } catch (err) {
        console.error('Disk write error:', err.message);
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function handlePing(res) {
    const startTime = Date.now();
    const targetDelay = generateLogNormalDelay();

    if (config.cpuWork) {
        const cpuIterations = Math.floor(targetDelay * 500);
        doCpuWork(cpuIterations);
    }

    if (config.diskWrite) {
        const bytesToWrite = Math.floor(targetDelay * 100);
        doDiskWork(bytesToWrite);
    }

    const elapsed = Date.now() - startTime;
    const remainingDelay = Math.max(0, targetDelay - elapsed);

    if (remainingDelay > 0) {
        await sleep(remainingDelay);
    }

    const actualDelay = Date.now() - startTime;

    res.writeHead(200, {
        'Content-Type': 'application/json',
        'X-Instance-ID': INSTANCE_ID,
        'X-Response-Time': actualDelay.toString()
    });

    res.end(JSON.stringify({
        message: 'pong',
        instance: INSTANCE_ID,
        targetDelay: Math.round(targetDelay),
        actualDelay: actualDelay,
        timestamp: new Date().toISOString()
    }));

    console.log(`[${INSTANCE_ID}] /ping - target: ${Math.round(targetDelay)}ms, actual: ${actualDelay}ms`);
}

function handleConfig(req, res, query) {
    if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            instance: INSTANCE_ID,
            config: config,
            description: {
                mu: 'Srednja vrijednost ln(vrijeme) - veća vrijednost = duže vrijeme',
                sigma: 'Standardna devijacija - veća vrijednost = veća varijanca',
                minDelay: 'Minimalno kašnjenje u ms',
                maxDelay: 'Maksimalno kašnjenje u ms',
                cpuWork: 'Da li raditi CPU intenzivan posao',
                diskWrite: 'Da li pisati na disk'
            }
        }));
        return;
    }

    if (query.mu !== undefined) config.mu = parseFloat(query.mu);
    if (query.sigma !== undefined) config.sigma = parseFloat(query.sigma);
    if (query.minDelay !== undefined) config.minDelay = parseInt(query.minDelay);
    if (query.maxDelay !== undefined) config.maxDelay = parseInt(query.maxDelay);
    if (query.cpuWork !== undefined) config.cpuWork = query.cpuWork === 'true';
    if (query.diskWrite !== undefined) config.diskWrite = query.diskWrite === 'true';

    console.log(`[${INSTANCE_ID}] Config updated:`, config);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        message: 'Configuration updated',
        instance: INSTANCE_ID,
        config: config
    }));
}

function handleHealth(res) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status: 'healthy',
        instance: INSTANCE_ID,
        uptime: process.uptime(),
        memory: process.memoryUsage()
    }));
}

let requestCount = 0;
let totalResponseTime = 0;
let responseTimes = [];

function handleStats(res) {
    const avgResponseTime = requestCount > 0 ? totalResponseTime / requestCount : 0;

    const sorted = [...responseTimes].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
    const p90 = sorted[Math.floor(sorted.length * 0.9)] || 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
    const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        instance: INSTANCE_ID,
        requestCount: requestCount,
        avgResponseTime: Math.round(avgResponseTime),
        percentiles: { p50, p90, p95, p99 }
    }));
}

const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const query = parsedUrl.query;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const startTime = Date.now();

    try {
        switch (pathname) {
            case '/ping':
                await handlePing(res);
                const responseTime = Date.now() - startTime;
                requestCount++;
                totalResponseTime += responseTime;
                responseTimes.push(responseTime);
                if (responseTimes.length > 10000) {
                    responseTimes = responseTimes.slice(-10000);
                }
                break;

            case '/config':
                handleConfig(req, res, query);
                break;

            case '/health':
                handleHealth(res);
                break;

            case '/stats':
                handleStats(res);
                break;

            case '/reset':
                requestCount = 0;
                totalResponseTime = 0;
                responseTimes = [];
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: 'Stats reset', instance: INSTANCE_ID }));
                break;

            default:
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: 'Not Found',
                    availableEndpoints: ['/ping', '/config', '/health', '/stats', '/reset']
                }));
        }
    } catch (err) {
        console.error(`[${INSTANCE_ID}] Error:`, err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
});

server.listen(PORT, () => {
    console.log(`[${INSTANCE_ID}] Server running on port ${PORT}`);
    console.log(`[${INSTANCE_ID}] Initial config:`, config);
    console.log(`[${INSTANCE_ID}] Endpoints: /ping, /config, /health, /stats, /reset`);
});

process.on('SIGTERM', () => {
    console.log(`[${INSTANCE_ID}] Received SIGTERM, shutting down...`);
    server.close(() => {
        console.log(`[${INSTANCE_ID}] Server closed`);
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log(`[${INSTANCE_ID}] Received SIGINT, shutting down...`);
    server.close(() => {
        console.log(`[${INSTANCE_ID}] Server closed`);
        process.exit(0);
    });
});
