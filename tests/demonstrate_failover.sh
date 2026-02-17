#!/bin/bash

echo "Starting Failover Demonstration..."

# 1. Check US Health
echo "Checking US Backend Health..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/us/health)
if [ "$HTTP_CODE" == "200" ]; then
    echo "US Backend is UP."
else
    echo "US Backend is DOWN or unreachable. Output: $HTTP_CODE"
    exit 1
fi

# 2. Stop US Backend
echo "Stopping backend-us container..."
docker stop backend-us

# 3. Wait a moment for NGINX to detect/fail
sleep 2

# 4. Check US Health again (should be routed to EU)
echo "Checking US Backend Health (expecting failover to EU)..."
# We expect 200 OK because NGINX proxies to EU
HTTP_CODE_FAILOVER=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/us/health)

if [ "$HTTP_CODE_FAILOVER" == "200" ]; then
    echo "SUCCESS: Request to /us/health returned 200 OK after US backend stopped."
    echo "Failover verified."
else
    echo "FAILURE: Request to /us/health returned $HTTP_CODE_FAILOVER"
    exit 1
fi

# 5. Restart US Backend
echo "Restarting backend-us..."
docker start backend-us
