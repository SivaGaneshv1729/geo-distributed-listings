const express = require('express');
const db = require('./db');
const kafka = require('./kafka');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8000;
const REGION = process.env.REGION;

const router = express.Router({ mergeParams: true });

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

router.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// GET /:region/replication-lag
router.get('/replication-lag', (req, res) => {
    const lag = kafka.getReplicationLag();
    res.json({ lag_seconds: lag });
});

// PUT /:region/properties/:id
router.put('/properties/:id', async (req, res) => {
    const propertyId = req.params.id;
    // req.params.region is available if needed, but we use process.env.REGION for logic
    // const region = req.params.region; 
    
    const { price, version } = req.body;
    const requestId = req.header('X-Request-ID');

    if (!requestId) {
        return res.status(400).json({ error: 'X-Request-ID header is required' });
    }

    try {
        // 1. Idempotency Check
        const idempotencyCheck = await db.query(
            'SELECT response_body FROM processed_requests WHERE request_id = $1', 
            [requestId]
        );

        if (idempotencyCheck.rows.length > 0) {
            // Already processed -> 422 Unprocessable Entity
            return res.status(422).json({ error: 'Duplicate request' });
        }

        // 2. Optimistic Locking and Update
        // We use a transaction to ensure atomicity of update + idempotency record
        await db.query('BEGIN');

        const currentPropRes = await db.query('SELECT * FROM properties WHERE id = $1 FOR UPDATE', [propertyId]);
        if (currentPropRes.rows.length === 0) {
            await db.query('ROLLBACK');
            return res.status(404).json({ error: 'Property not found' });
        }

        const currentProp = currentPropRes.rows[0];
        if (currentProp.version !== version) {
            await db.query('ROLLBACK');
            return res.status(409).json({ error: 'Conflict: Version mismatch' });
        }

        const newVersion = currentProp.version + 1;
        const updateRes = await db.query(
            `UPDATE properties 
             SET price = $1, version = $2, updated_at = NOW(), region_origin = $3
             WHERE id = $4 
             RETURNING *`,
            [price, newVersion, REGION, propertyId]
        );
        const updatedProperty = updateRes.rows[0];

        // 3. Record Idempotency
        // We store the success response (or just a marker). 
        // Requirement says fail with 422 if duplicate.
        await db.query(
            'INSERT INTO processed_requests (request_id, response_body) VALUES ($1, $2)',
            [requestId, updatedProperty] 
        );

        await db.query('COMMIT');

        // 4. Publish to Kafka
        await kafka.produceUpdate(updatedProperty);

        res.json(updatedProperty);

    } catch (err) {
        await db.query('ROLLBACK');
        console.error('Error processing update:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.use('/:region', router);

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const startServer = async () => {
    let retries = 5;
    while (retries > 0) {
        try {
            await kafka.startProducer();
            // Start consumer to replicate from other region
            await kafka.startConsumer(); 
            
            app.listen(PORT, () => {
                console.log(`Server handling ${REGION} requests on port ${PORT}`);
            });
            break; // Success
        } catch (err) {
            console.error(`Failed to start server (retries left: ${retries}):`, err);
            retries--;
            if (retries === 0) {
                console.error('Max retries reached. Exiting.');
                process.exit(1);
            }
            await wait(5000); // Wait 5 seconds before retrying
        }
    }
};

startServer();
