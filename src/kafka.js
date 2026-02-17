const { Kafka } = require('kafkajs');
const db = require('./db');

const kafka = new Kafka({
  clientId: `backend-${process.env.REGION}`,
  brokers: [process.env.KAFKA_BROKER],
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: `property-group-${process.env.REGION}` });

let lastConsumedUpdatedAt = null;

const startProducer = async () => {
  await producer.connect();
  console.log('Kafka Producer connected');
};

const produceUpdate = async (property) => {
  await producer.send({
    topic: 'property-updates',
    messages: [
      { value: JSON.stringify(property) },
    ],
  });
};

const startConsumer = async () => {
    await consumer.connect();
    await consumer.subscribe({ topic: 'property-updates', fromBeginning: true });
  
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const property = JSON.parse(message.value.toString());
        
        // Skip updates from own region
        if (property.region_origin === process.env.REGION) {
            return;
        }

        console.log(`Received update for property ${property.id} from ${property.region_origin}`);
  
        try {
            // Apply update to local DB
            // We just overwrite with the replicated data. 
            // In a real system, we might handle conflicts, but here we just replicate.
            // Requirement says "apply changes originating from the other region".
            // We should use the version from the message.
            const query = `
                INSERT INTO properties (id, price, bedrooms, bathrooms, region_origin, version, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (id) DO UPDATE SET
                    price = EXCLUDED.price,
                    bedrooms = EXCLUDED.bedrooms,
                    bathrooms = EXCLUDED.bathrooms,
                    region_origin = EXCLUDED.region_origin,
                    version = EXCLUDED.version,
                    updated_at = EXCLUDED.updated_at;
            `;
            const values = [
                property.id,
                property.price, 
                property.bedrooms, 
                property.bathrooms, 
                property.region_origin, 
                property.version, 
                property.updated_at
            ];
            await db.query(query, values);
            
            lastConsumedUpdatedAt = new Date(property.updated_at);
        } catch (err) {
            console.error('Error processing Kafka message:', err);
        }
      },
    });
    console.log('Kafka Consumer started');
};

const getReplicationLag = () => {
    if (!lastConsumedUpdatedAt) {
        return 0; // Or null? Requirement implies returning a number. 0 if no messages consumed?
    }
    const now = new Date();
    const lagSeconds = (now - lastConsumedUpdatedAt) / 1000;
    return lagSeconds;
};

module.exports = {
  startProducer,
  produceUpdate,
  startConsumer,
  getReplicationLag
};
