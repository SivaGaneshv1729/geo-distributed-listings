# Multi-Region Property Listing Backend

A distributed property listing backend simulating US and EU regions, featuring NGINX for global routing/failover and Kafka for asynchronous bi-directional replication.

## Architecture

- **NGINX**: Reverse proxy handling routing (`/us`, `/eu`) and automatic failover.
- **Node.js/Express**: Backend services implementing the API, optimistic locking, and idempotency.
- **PostgreSQL**: Regional databases (US, EU).
- **Kafka**: Message broker for asynchronous property update replication between regions.

## Features

- **Global Routing**: Request routing based on URL path.
- **High Availability**: Automatic failover to the healthy region if one region goes down.
- **Data Consistency**: Optimistic locking using version numbers to prevent race conditions.
- **Event-Driven Replication**: Real-time data synchronization using Kafka.
- **Idempotency**: `X-Request-ID` handling to prevent duplicate operations.

## Prerequisites

- Docker & Docker Compose

## Getting Started

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd multi-region-property-backend
   ```

2. **Start the services**

   ```bash
   docker-compose up -d --build
   ```

   Wait for all services to become healthy.

3. **Verify API**
   ```bash
   # Check US health
   curl -I http://localhost:8080/us/health
   ```

## Development

### Running Tests

Integration tests verifying concurrent updates and idempotency:

```bash
# Requires Node.js installed locally
node tests/test_concurrent.js
```

### Demonstrating Failover

Run the automated failover demonstration:

```bash
# Node.js version (Cross-platform)
node tests/demonstrate_failover.js
# Bash version (Linux/Mac/WSL)
bash tests/demonstrate_failover.sh
```

## API Documentation

### Update Property

`PUT /:region/properties/:id`

**Headers**:

- `X-Request-ID`: <uuid> (Required)

**Body**:

```json
{
  "price": 500000.0,
  "version": 1
}
```

### Check Replication Lag

`GET /:region/replication-lag`

**Response**:

```json
{
  "lag_seconds": 2.5
}
```
