#!/bin/bash
set -eo pipefail

framework="Vendor/Python.xcframework"
# Use ad-hoc signing for simulator and unsigned device build verification.
export EXPANDED_CODE_SIGN_IDENTITY="${EXPANDED_CODE_SIGN_IDENTITY:--}"
if [[ "$EFFECTIVE_PLATFORM_NAME" == "-iphonesimulator" && "$ARCHS" == *" "* ]]; then
    # A generic simulator destination can report both architectures without a running device.
    export ARCHS="$(uname -m)"
fi
source "$SRCROOT/$framework/build/utils.sh"
install_python "$framework"
