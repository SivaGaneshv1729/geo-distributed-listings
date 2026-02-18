# Multi-Region Property Listing Backend - Technical Documentation

## 1. Executive Summary

This project implements a resilient, distributed property listing backend designed to simulate a multi-region environment (US and EU). It leverages **NGINX** for intelligent traffic routing and failover, **PostgreSQL** for regional data persistence, and **Apache Kafka** for asynchronous, bi-directional data replication. The system ensures high availability, data consistency through optimistic locking, and reliability via idempotency checks.

## 2. System Architecture

### 2.1 High-Level Overview

The system consists of two identical backend clusters (US and EU), each with its own application service and database. A global NGINX reverse proxy sits in front, directing traffic based on URL path prefixes and handling failover if a region becomes unresponsive.

```mermaid
graph TD
    Client[Client / User] --> Nginx[NGINX Reverse Proxy]

    subgraph "US Region"
        Nginx -->|/us/*| BackendUS[Backend Service US]
        BackendUS -->|Reads/Writes| DB_US[(PostgreSQL US)]
        BackendUS -->|Produces Updates| Kafka[Kafka Broker]
    end

    subgraph "EU Region"
        Nginx -->|/eu/*| BackendEU[Backend Service EU]
        BackendEU -->|Reads/Writes| DB_EU[(PostgreSQL EU)]
        BackendEU -->|Produces Updates| Kafka
    end

    Kafka -->|Consumes Updates (Replication)| BackendUS
    Kafka -->|Consumes Updates (Replication)| BackendEU

    BackendUS -.->|Failover| BackendEU
    BackendEU -.->|Failover| BackendUS
```

### 2.2 Component Description

| Component           | Technology        | Role                                                                                                 |
| ------------------- | ----------------- | ---------------------------------------------------------------------------------------------------- |
| **Reverse Proxy**   | NGINX             | Entry point. Routes requests (`/us`, `/eu`), performs health checks, and manages failover switching. |
| **Backend Service** | Node.js / Express | Handles API requests. Implements logic for optimistic locking, idempotency, and DB interactions.     |
| **Database**        | PostgreSQL 14     | Stores property listings and processed request IDs (for idempotency).                                |
| **Message Broker**  | Apache Kafka      | Facilitates asynchronous data replication between regions.                                           |
| **Coordination**    | Zookeeper         | Manages Kafka cluster state.                                                                         |

## 3. Core Features & Implementation Details

### 3.1 Global Routing & Failover

- **Routing**: NGINX maps `/us/` requests to `backend-us` and `/eu/` requests to `backend-eu`.
- **Health Checks**: Passive health checks monitor upstream responses. If a backend returns 5xx errors or times out, NGINX marks it as unavailable.
- **Failover**: Traffic destined for a failed region is automatically rerouted to the backup upstream (the other region's backend).
- **Configuration**: `proxy_next_upstream` directive controls the failover triggers (error, timeout, 500/502/503/504).

### 3.2 Data Consistency (Optimistic Locking)

To prevent lost updates during concurrent edits:

1. Each property record has a `version` column.
2. Updates must include the `version` of the record being modified.
3. The backend checks: `UPDATE properties ... WHERE id = $id AND version = $version`.
4. If the row count is 0, it means the version has changed (conflict), and a `409 Conflict` is returned.

### 3.3 Asynchronous Replication

- **Producer**: When a property is successfully updated in the local DB, the new state is published to the `property-updates` Kafka topic.
- **Consumer**: Both services subscribe to the topic.
- **Filtering**: Consumers discard messages originating from their own region (checked via `region_origin` field) to prevent loops.
- **Application**: Updates from remote regions are applied to the local DB using `ON CONFLICT DO UPDATE`.

### 3.4 Idempotency

To ensure exactly-once processing effects for retried requests:

- Clients must send a unique `X-Request-ID` header.
- The backend checks a `processed_requests` table.
- If the ID exists, the previous successful response is returned (or a `422 Unprocessable Entity` as per specific requirements).
- If new, the request is processed, and the ID is stored atomically within the same database transaction.

## 4. API Reference

### 4.1 Global Health Check

**Endpoint**: `GET /health` inside container, or region-specific externally.

- **Description**: Used by Docker/NGINX to verify service status.
- **Response**: `200 OK`

### 4.2 Update Property

**Endpoint**: `PUT /:region/properties/:id`

- **Description**: Updates property details.
- **Headers**: `X-Request-ID: <uuid>` (Required)
- **Body**:
  ```json
  {
    "price": 500000.0,
    "version": 1
  }
  ```
- **Responses**:
  - `200 OK`: Update successful. Returns updated object.
  - `400 Bad Request`: Missing header.
  - `404 Not Found`: Property ID does not exist.
  - `409 Conflict`: Version mismatch (optimistic lock failure).
  - `422 Unprocessable Entity`: Duplicate request ID.

### 4.3 Check Replication Lag

**Endpoint**: `GET /:region/replication-lag`

- **Description**: Returns the latency of the replication consumer.
- **Response**:
  ```json
  {
    "lag_seconds": 1.25
  }
  ```

## 5. Deployment & Operations

### 5.1 Docker Compose Parameters

The entire stack is defined in `docker-compose.yml`. Key environment variables:

- `REGION`: `us` or `eu` (sets backend identity).
- `DATABASE_URL`: Connection string for the regional DB.
- `KAFKA_BROKER`: Address of the Kafka broker.
- `PORT`: Service listening port (default 8000).

### 5.2 Database Seeding

- **Mechanism**: Docker entrypoint scripts (`/docker-entrypoint-initdb.d/`).
- **Files**: `seeds/us_seed.sql` and `seeds/eu_seed.sql`.
- **Data**: Pre-populates 1000 properties (500 per region) to simulate an active environment.

## 6. Testing Strategy

### 6.1 Integration Tests (`tests/test_concurrent.js`)

A Node.js script designed to stress-test the concurrency controls:

- **Scenario**: Simulates two parallel requests (Race Condition).
- **Validation**: Asserts that only one request succeeds (200) and the other fails (409).

### 6.2 Failover Verification (`tests/demonstrate_failover.js`)

An automated script to prove high availability:

1. Pings US region (Success).
2. Hard-stops the `backend-us` container.
3. Pings US region again.
4. Validates that the response is `200 OK` (served by EU via NGINX failover).

## 7. Future Improvements

- **Redis Integration**: Move idempotency storage to Redis with TTL for better performance and automatic cleanup.
- **Circuit Breakers**: Implement circuit breakers in the application layer to handle downstream failures more gracefully.
- **Dead Letter Queues (DLQ)**: Handle Kafka message processing failures robustly.
- **Secure Communication**: Enable TLS/SSL for all inter-service communication.
