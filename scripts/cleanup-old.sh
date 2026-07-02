#!/bin/bash
# Script de curățenie - șterge vansrouter și bazele de date vechi
set -e

echo "=== Curățenie vansrouter ==="

# Oprește și șterge din pm2 (dacă mai există)
pm2 stop vansrouter 2>/dev/null || true
pm2 delete vansrouter 2>/dev/null || true

# Șterge binare și module
rm -f /usr/local/bin/vansrouter
rm -rf /usr/local/lib/node_modules/vansrouter
rm -rf /root/vansrouter
rm -rf /root/router

# Șterge bazele de date
rm -rf /root/.vansrouter
rm -rf /root/.9router

echo "=== Curățenie completă ==="
