#!/bin/bash
# Start both Cam Tracker backend and Lx.Studio dev server for local development.
# Usage: ./start-with-tracker.sh

set -e

echo "=== Starting Cam Tracker backend (port 8000) ==="
cd /Users/perry/Documents/Code/Cam_tracker/backend
source venv/bin/activate
python run.py &
TRACKER_PID=$!

echo "=== Starting Lx.Studio dev server ==="
cd /Users/perry/Documents/Code/Lx.Studio
npx vite &
VITE_PID=$!

echo ""
echo "Tracker backend: http://localhost:8000"
echo "Lx.Studio:       http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop both services"

trap "kill $TRACKER_PID $VITE_PID 2>/dev/null; exit 0" INT TERM
wait
