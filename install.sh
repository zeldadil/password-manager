#!/bin/bash
set -e
cd /home/sap/.hermes/kanban/workspaces/t_3b58b7ef/apps/web
npm install --legacy-peer-deps 2>&1 | tail -20
echo "EXIT: $?"
