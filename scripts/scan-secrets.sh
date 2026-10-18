#!/usr/bin/env bash
set -euo pipefail
scan_dir=$(mktemp -d)
trap 'rm -rf "$scan_dir"' EXIT
git ls-files -z --cached --others --exclude-standard | while IFS= read -r -d '' source_path; do
  if [[ -e "$source_path" || -L "$source_path" ]]; then
    printf '%s\0' "$source_path"
  fi
done | tar --null -T - -cf - | tar -xf - -C "$scan_dir"
gitleaks dir "$scan_dir" --redact --no-banner
