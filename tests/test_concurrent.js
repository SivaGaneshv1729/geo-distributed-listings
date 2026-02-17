const http = require('http');
const crypto = require('crypto');

// Helper to make a PUT request
function makeRequest(region, id, price, version, requestId) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({ price, version });
        
        const options = {
            hostname: 'localhost',
            port: 8080,
            path: `/${region}/properties/${id}`,
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length,
                'X-Request-ID': requestId || crypto.randomUUID()
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                resolve({ status: res.statusCode, body: body ? JSON.parse(body) : {} });
            });
        });

        req.on('error', (e) => reject(e));
        req.write(data);
        req.end();
    });
}

async function testConcurrentUpdates() {
    console.log('Starting Concurrent Update Test...');
    
    // Pick a property, e.g., ID 1 (US region)
    // First, get its current version? The seed says version starts at 1.
    // We assume version is 1.
    const propertyId = 1;
    const initialVersion = 1;

    console.log(`Sending two concurrent requests for Property ${propertyId} with version ${initialVersion}...`);

    const req1 = makeRequest('us', propertyId, 200000, initialVersion, crypto.randomUUID());
    const req2 = makeRequest('us', propertyId, 300000, initialVersion, crypto.randomUUID());

    try {
        const results = await Promise.all([req1, req2]);
        
        console.log('Results:', results);

        const successes = results.filter(r => r.status === 200);
        const conflicts = results.filter(r => r.status === 409);

        if (successes.length === 1 && conflicts.length === 1) {
            console.log('SUCCESS: Optimistic locking worked! One request succeeded, one failed with 409.');
        } else {
            console.error('FAILURE: Unexpected outcome.', results);
            process.exit(1);
        }

    } catch (err) {
        console.error('Test Error:', err);
    }
}

async function testIdempotency() {
    console.log('\nStarting Idempotency Test...');
    const propertyId = 2; // Use a different property
    const version = 1;
    const reqId = crypto.randomUUID();

    console.log(`Sending first request with ID ${reqId}...`);
    const res1 = await makeRequest('us', propertyId, 250000, version, reqId);
    console.log(`Response 1: ${res1.status}`);

    if (res1.status !== 200) {
        console.error('FAILURE: First request failed.');
        return;
    }

    console.log(`Sending second request with SAME ID ${reqId}...`);
    const res2 = await makeRequest('us', propertyId, 250000, version, reqId);
    console.log(`Response 2: ${res2.status}`);

    if (res2.status === 422) {
        console.log('SUCCESS: Duplicate request rejected with 422.');
    } else {
        console.error(`FAILURE: Expected 422, got ${res2.status}`);
    }
}

// Run tests
(async () => {
    // Wait for services to be ready
    console.log('Waiting 10s for services to stabilize...');
    await new Promise(r => setTimeout(r, 10000));

    await testConcurrentUpdates();
    await testIdempotency();
    
    // Test Replication
    console.log('\nStarting Replication Test...');
    // Update Property 3 in US
    const propId = 3;
    const reqId = crypto.randomUUID();
    console.log(`Updating Property ${propId} in US...`);
    const res = await makeRequest('us', propId, 400000, 1, reqId);
    if (res.status === 200) {
        console.log('Update successful. Waiting for replication (5s)...');
        await new Promise(r => setTimeout(r, 5000));
        
        // Check EU directly via DB? Or via API? 
        // We implemented GET /:region/replication-lag but not GET /:region/properties/:id
        // We can't easily check EU prop value via API unless we add GET endpoint.
        // But the requirement didn't ask for GET properties endpoint.
        // We can check logs or assume if lag is small/zero it worked, or check `demonstrate_failover` which shows EU handling requests.
        // Actually, let's just log that we can't automatically verify replication value without GET endpoint or DB access here.
        // But we can check replication lag.
        
        // Check replication lag on EU
        // Using http to get /eu/replication-lag
        // We need to implement a simple GET helper or use makeRequest with GET
        const getLag = (region) => {
             return new Promise((resolve) => {
                http.get(`http://localhost:8080/${region}/replication-lag`, (res) => {
                    let body = '';
                    res.on('data', c => body += c);
                    res.on('end', () => resolve(JSON.parse(body)));
                });
             });
        };
        
        const lagRes = await getLag('eu');
        console.log('EU Replication Lag:', lagRes);
        if (lagRes && typeof lagRes.lag_seconds === 'number') {
            console.log('SUCCESS: Replication lag endpoint works.');
        } else {
             console.error('FAILURE: Replication lag endpoint failed or returned invalid data.');
        }
    } else {
        console.error('FAILURE: Update for replication test failed.');
    }

})();
