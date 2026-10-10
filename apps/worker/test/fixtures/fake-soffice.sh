#!/bin/sh
# Test double: spawns a grandchild and records its PID in $FAKE_PIDFILE, then waits.
sleep 30 &
echo $! > "$FAKE_PIDFILE"
wait
