#!/bin/sh
set -eu

task_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
module_cache=$(mktemp -d /private/tmp/angellive-swift-cache.XXXXXX)
trap 'rm -rf "$module_cache"' EXIT HUP INT TERM

SWIFT_MODULECACHE_PATH="$module_cache" \
CLANG_MODULE_CACHE_PATH="$module_cache" \
  /usr/bin/swift "$task_root/scripts/generate_assets.swift" "$task_root"
