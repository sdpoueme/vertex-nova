#!/bin/bash
set -e
prompt=$(curl -sL https://raw.githubusercontent.com/jason-c-dev/synapse/main/setup.md)
exec claude "$prompt"
