# Multi-Region Property Listing Backend

A distributed property listing backend simulating US and EU regions, featuring NGINX for global routing/failover and Kafka for asynchronous bi-directional replication.

## Architecture

- **NGINX**: Reverse proxy handling routing (`/us`, `/eu`) and automatic failover.
- **Node.js/Express**: Backend services implementing the API, optimistic locking, and idempotency.
- **PostgreSQL**: Regional databases (US, EU).
- **Kafka**: Message broker for asynchronous property update replication between regions.

## Features

- **Global Routing**: Request routing based on URL path prefix (`/us/`, `/eu/`).
- **High Availability**: Automatic failover to the healthy region if one region's backend goes down.
- **Data Consistency**: Optimistic locking using version numbers to prevent race conditions.
- **Event-Driven Replication**: Real-time cross-region data synchronization using Kafka.
- **Idempotency**: `X-Request-ID` handling to prevent duplicate operations.

## Prerequisites

- Docker & Docker Compose

## Getting Started

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd multi-region-property-backend
   ```

2. **Copy and configure environment variables**

   ```bash
   cp .env.example .env
   ```

3. **Start the services**

   ```bash
   docker-compose up -d --build
   ```

   Wait ~60 seconds for all services to become healthy.

4. **Verify API**
   ```bash
   curl -I http://localhost:8080/us/health
   curl -I http://localhost:8080/eu/health
   ```

## API Documentation

### Get Property

`GET /:region/properties/:id`

**Example**: `curl http://localhost:8080/us/properties/1`

### Update Property

`PUT /:region/properties/:id`

**Headers**: `X-Request-ID: <uuid>` (Required)

**Body**:

```json
{
  "price": 500000.0,
  "version": 1
}
```

**Responses**:
| Code | Meaning |
|------|---------|
| `200 OK` | Update successful. Returns updated property. |
| `400 Bad Request` | Missing `X-Request-ID` header. |
| `404 Not Found` | Property ID does not exist. |
| `409 Conflict` | Version mismatch — optimistic lock violation. |
| `422 Unprocessable Entity` | Duplicate `X-Request-ID` (idempotency). |

### Check Replication Lag

`GET /:region/replication-lag`

**Response**: `{ "lag_seconds": 2.5 }`

---

## Conflict Resolution (409 Conflict)

When two clients attempt to update the same property concurrently, the system uses **optimistic locking** to detect this:

1. Each property has a `version` field (integer).
2. A PUT request must include the current `version` it read.
3. If the version no longer matches the database record, it means another update was applied first.
4. The server returns **`409 Conflict`** with: `{ "error": "Conflict: Version mismatch" }`

**How to resolve as a client:**

1. Re-fetch the latest property state with `GET /:region/properties/:id`.
2. Apply your desired changes on top of the latest data.
3. Re-submit the PUT request with the new `version` value from step 1.

This ensures no updates are silently lost in a concurrent environment.

---

## Testing

### Integration Tests (Concurrent Updates, Idempotency, Replication)

```bash
# Requires Node.js installed locally
node tests/test_concurrent.js
```

### Failover Demonstration

**Bash (Linux/macOS/WSL/Git Bash):**

```bash
bash tests/demonstrate_failover.sh
```

**Node.js (Cross-platform, including native Windows):**

```bash
node tests/demonstrate_failover.js
```

> **Note for Windows users**: The `.sh` script requires a bash-compatible shell (WSL, Git Bash, or Cygwin). Use the Node.js version for native Windows environments.

---

## Environment Variables

See [`.env.example`](.env.example) for all required variables.

| Variable      | Description         |
| ------------- | ------------------- |
| `DB_USER`     | PostgreSQL username |
| `DB_PASSWORD` | PostgreSQL password |
