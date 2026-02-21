#!/bin/bash

echo "============================================="
echo "  NGINX Failover Demonstration Script"
echo "============================================="

# 1. Check US Health (normal operation)
echo ""
echo "[Step 1] Checking US Backend Health (normal operation)..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/us/health)
if [ "$HTTP_CODE" == "200" ]; then
    echo "  ✔ US Backend is UP. Status: $HTTP_CODE"
else
    echo "  ✘ US Backend is DOWN or unreachable. Status: $HTTP_CODE"
    echo "  Make sure all services are running: docker-compose up -d"
    exit 1
fi

# 2. Stop US Backend to simulate regional failure
echo ""
echo "[Step 2] Stopping backend-us container to simulate US region failure..."
docker stop backend-us
echo "  ✔ backend-us stopped."

# 3. Wait a moment
echo ""
echo "[Step 3] Waiting 2 seconds for NGINX to detect the failure..."
sleep 2

# 4. Check US Health again - should failover to EU
echo ""
echo "[Step 4] Checking US endpoint again (expecting NGINX to route to EU backend)..."
HTTP_CODE_FAILOVER=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/us/health)

if [ "$HTTP_CODE_FAILOVER" == "200" ]; then
    echo "  ✔ SUCCESS: /us/health returned $HTTP_CODE_FAILOVER after backend-us stopped."
    echo "  ✔ Failover to EU backend verified!"
else
    echo "  ✘ FAILURE: /us/health returned $HTTP_CODE_FAILOVER. Failover did NOT work."
    echo "  Restarting backend-us before exiting..."
    docker start backend-us
    exit 1
fi

# 5. Print EU backend logs to confirm it handled the /us/ request
echo ""
echo "[Step 5] Showing last 5 lines of backend-eu logs to confirm it served the /us/ request:"
echo "---"
docker logs --tail 5 backend-eu
echo "---"

# 6. Restart US Backend to restore state
echo ""
echo "[Step 6] Restarting backend-us to restore the cluster..."
docker start backend-us
echo "  ✔ backend-us restarted."

echo ""
echo "============================================="
echo "  Failover demonstration COMPLETE."
echo "============================================="
