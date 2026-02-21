const http = require('http');
const crypto = require('crypto');

const BASE_URL = 'http://localhost:8080';

// Helper: make a PUT request
function putProperty(region, id, price, version, requestId) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({ price, version });
        const options = {
            hostname: 'localhost',
            port: 8080,
            path: `/${region}/properties/${id}`,
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
                'X-Request-ID': requestId || crypto.randomUUID()
            }
        };
        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: body ? JSON.parse(body) : {} }); }
                catch (e) { resolve({ status: res.statusCode, body: {} }); }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

// Helper: GET a property
function getProperty(region, id) {
    return new Promise((resolve, reject) => {
        http.get(`${BASE_URL}/${region}/properties/${id}`, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
                catch (e) { resolve({ status: res.statusCode, body: {} }); }
            });
        }).on('error', reject);
    });
}

// Helper: GET replication lag
function getReplicationLag(region) {
    return new Promise((resolve, reject) => {
        http.get(`${BASE_URL}/${region}/replication-lag`, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                try { resolve(JSON.parse(body)); }
                catch (e) { resolve({}); }
            });
        }).on('error', reject);
    });
}

// ─── Test 1: Optimistic Locking (Concurrent Updates) ─────────────────────────
async function testConcurrentUpdates() {
    console.log('\n=== TEST 1: Optimistic Locking (Concurrent Updates) ===');

    // Dynamically fetch current version
    const prop = await getProperty('us', 1);
    if (prop.status !== 200) {
        console.error('  ✘ SKIP: Could not fetch property 1 to get current version.');
        return;
    }
    const currentVersion = prop.body.version;
    console.log(`  Property 1 current version: ${currentVersion}`);
    console.log('  Sending two concurrent PUT requests with the same version...');

    const [r1, r2] = await Promise.all([
        putProperty('us', 1, 200000, currentVersion, crypto.randomUUID()),
        putProperty('us', 1, 300000, currentVersion, crypto.randomUUID()),
    ]);

    console.log(`  Request 1: ${r1.status}`, r1.body);
    console.log(`  Request 2: ${r2.status}`, r2.body);

    const successes = [r1, r2].filter(r => r.status === 200);
    const conflicts = [r1, r2].filter(r => r.status === 409);

    if (successes.length === 1 && conflicts.length === 1) {
        console.log('  ✔ SUCCESS: Optimistic locking worked — 1 success (200), 1 conflict (409).');
    } else {
        console.error('  ✘ FAILURE: Unexpected outcome. Both may have succeeded or both failed.');
        process.exitCode = 1;
    }
}

// ─── Test 2: Idempotency ──────────────────────────────────────────────────────
async function testIdempotency() {
    console.log('\n=== TEST 2: Idempotency (X-Request-ID) ===');

    // Dynamically fetch current version for property 2
    const prop = await getProperty('us', 2);
    if (prop.status !== 200) {
        console.error('  ✘ SKIP: Could not fetch property 2.');
        return;
    }
    const currentVersion = prop.body.version;
    const reqId = crypto.randomUUID();

    console.log(`  Property 2 current version: ${currentVersion}`);
    console.log(`  Sending first request with X-Request-ID: ${reqId}...`);
    const r1 = await putProperty('us', 2, 250000, currentVersion, reqId);
    console.log(`  Response 1: ${r1.status}`);

    if (r1.status !== 200) {
        console.error('  ✘ FAILURE: First request did not succeed.', r1.body);
        process.exitCode = 1;
        return;
    }

    console.log(`  Sending second (duplicate) request with SAME X-Request-ID...`);
    const r2 = await putProperty('us', 2, 250000, currentVersion, reqId);
    console.log(`  Response 2: ${r2.status}`);

    if (r2.status === 422) {
        console.log('  ✔ SUCCESS: Duplicate request rejected with 422 Unprocessable Entity.');
    } else {
        console.error(`  ✘ FAILURE: Expected 422, got ${r2.status}.`);
        process.exitCode = 1;
    }
}

// ─── Test 3: Cross-Region Replication ────────────────────────────────────────
async function testReplication() {
    console.log('\n=== TEST 3: Cross-Region Replication via Kafka ===');

    // Fetch current version of property 3 in US
    const prop = await getProperty('us', 3);
    if (prop.status !== 200) {
        console.error('  ✘ SKIP: Could not fetch property 3 from US.');
        return;
    }
    const currentVersion = prop.body.version;
    const newPrice = 999999;
    console.log(`  Property 3 (US) current version: ${currentVersion}, updating price to ${newPrice}...`);

    const updateRes = await putProperty('us', 3, newPrice, currentVersion, crypto.randomUUID());
    if (updateRes.status !== 200) {
        console.error('  ✘ FAILURE: Update to US property 3 failed.', updateRes.body);
        process.exitCode = 1;
        return;
    }
    console.log(`  ✔ US update successful. New version: ${updateRes.body.version}`);

    // Wait for Kafka replication
    const waitSec = 5;
    console.log(`  Waiting ${waitSec}s for Kafka replication to EU...`);
    await new Promise(r => setTimeout(r, waitSec * 1000));

    // Verify via GET on EU endpoint
    const euProp = await getProperty('eu', 3);
    if (euProp.status === 200 && parseFloat(euProp.body.price) === newPrice) {
        console.log(`  ✔ SUCCESS: EU now shows property 3 with price ${euProp.body.price} (version ${euProp.body.version}).`);
    } else {
        console.error(`  ✘ FAILURE: EU property 3 not replicated correctly.`, euProp.body);
        process.exitCode = 1;
    }

    // Check replication lag
    const lag = await getReplicationLag('eu');
    console.log(`  EU Replication Lag: ${lag.lag_seconds}s`);
    if (typeof lag.lag_seconds === 'number') {
        console.log('  ✔ Replication lag endpoint is working.');
    }
}

// ─── Run All Tests ────────────────────────────────────────────────────────────
(async () => {
    console.log('Waiting 5s for services to stabilize...');
    await new Promise(r => setTimeout(r, 5000));

    await testConcurrentUpdates();
    await testIdempotency();
    await testReplication();

    console.log('\n=== All tests complete. ===');
})();
