#!/usr/bin/env bash
set -euo pipefail
scan_dir=$(mktemp -d)
trap 'rm -rf "$scan_dir"' EXIT
git ls-files -z --cached --others --exclude-standard | tar --null -T - -cf - | tar -xf - -C "$scan_dir"
gitleaks dir "$scan_dir" --redact --no-banner
