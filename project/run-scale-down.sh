#!/bin/bash
echo "=== SCALE DOWN TEST (4 -> 1) ==="

docker-compose up -d
sleep 5

k6 run --out json=results/scale-down.json load-test.js &
K6_PID=$!

echo "[0:00] Test started with 4 nodes"
sleep 75

echo "[1:15] Stopping node4..."
docker-compose stop node4
sleep 75

echo "[2:30] Stopping node3..."
docker-compose stop node3
sleep 75

echo "[3:45] Stopping node2..."
docker-compose stop node2

echo "Waiting for k6 to finish..."
wait $K6_PID

echo "=== SCALE DOWN TEST COMPLETE ==="
