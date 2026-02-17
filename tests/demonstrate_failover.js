const http = require('http');
const { exec } = require('child_process');

function runCommand(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                console.warn(`Command failed: ${cmd}`, error.message);
                // resolve anyway as verification step might want to check failure
                resolve({ error, stdout, stderr });
            } else {
                resolve({ stdout, stderr });
            }
        });
    });
}

function checkHealth(region) {
    return new Promise((resolve) => {
        const req = http.get(`http://localhost:8080/${region}/health`, (res) => {
            resolve(res.statusCode);
        });
        req.on('error', (e) => resolve(null));
    });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function demonstrateFailover() {
    console.log('Starting Failover Demonstration (Node.js)...');

    // 1. Check US Health
    console.log('Checking US Backend Health...');
    const status1 = await checkHealth('us');
    if (status1 === 200) {
        console.log('US Backend is UP (200 OK).');
    } else {
        console.error(`US Backend is DOWN or unreachable (${status1}).`);
        process.exit(1);
    }

    // 2. Stop US Backend
    console.log('Stopping backend-us container...');
    await runCommand('docker stop backend-us');
    
    // 3. Wait for NGINX to detect failure (or just try immediately as NGINX tries next upstream on error)
    console.log('Waiting 2s...');
    await sleep(2000);

    // 4. Check US Health again (failover to EU expected)
    console.log('Checking US Backend Health (expecting failover to EU)...');
    const status2 = await checkHealth('us');
    
    if (status2 === 200) {
        console.log('SUCCESS: Request to /us/health returned 200 OK after US backend stopped.');
        console.log('Failover verified.');
    } else {
        console.error(`FAILURE: Request to /us/health returned ${status2}`);
        // We do not exit 1 here yet, we want to restart the container first to restore state
    }

    // 5. Restart US Backend
    console.log('Restarting backend-us...');
    await runCommand('docker start backend-us');
    
    if (status2 !== 200) process.exit(1);
}

demonstrateFailover();
