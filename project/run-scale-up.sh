#!/bin/bash
echo "=== SCALE UP TEST (1 -> 4) ==="

docker-compose up -d
sleep 5
docker-compose stop node2 node3 node4
sleep 2

k6 run --out json=results/scale-up.json load-test.js &
K6_PID=$!

echo "[0:00] Test started with 1 node"
sleep 75

echo "[1:15] Starting node2..."
docker-compose start node2
sleep 75

echo "[2:30] Starting node3..."
docker-compose start node3
sleep 75

echo "[3:45] Starting node4..."
docker-compose start node4

echo "Waiting for k6 to finish..."
wait $K6_PID

echo "=== SCALE UP TEST COMPLETE ==="
