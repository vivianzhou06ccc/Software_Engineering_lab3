#!/bin/sh
set -eu
base_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "${STAY_PYTHON:-python3}" "$base_dir/code/main.py" "$@"
