#!/bin/sh
set -eu
mkdir -p /data /books
chown reader:reader /data /books
su-exec reader:reader chmod 0700 /data /books
exec node /all-in-one/supervisor.mjs "$@"
