CREATE TABLE IF NOT EXISTS properties (
    id BIGINT PRIMARY KEY,
    price DECIMAL NOT NULL,
    bedrooms INTEGER,
    bathrooms INTEGER,
    region_origin VARCHAR(2) NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS processed_requests (
    request_id VARCHAR(255) PRIMARY KEY,
    response_body JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Generate 500 rows for US
INSERT INTO properties (id, price, bedrooms, bathrooms, region_origin)
SELECT
    generate_series(1, 500) as id,
    (random() * 500000 + 100000)::decimal(10, 2) as price,
    (random() * 5 + 1)::int as bedrooms,
    (random() * 3 + 1)::int as bathrooms,
    'us' as region_origin
ON CONFLICT (id) DO NOTHING;

-- Generate 500 rows for EU
INSERT INTO properties (id, price, bedrooms, bathrooms, region_origin)
SELECT
    generate_series(501, 1000) as id,
    (random() * 500000 + 100000)::decimal(10, 2) as price,
    (random() * 5 + 1)::int as bedrooms,
    (random() * 3 + 1)::int as bathrooms,
    'eu' as region_origin
ON CONFLICT (id) DO NOTHING;
