#!/bin/sh
# Test double: records each invocation in $SOFFICE_COUNT_FILE, then runs real soffice.
echo call >> "$SOFFICE_COUNT_FILE"
exec soffice "$@"
