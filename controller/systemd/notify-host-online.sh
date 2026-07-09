#!/bin/bash
# Step 4.5: fires the instant playground-controller.service itself
# successfully starts (ExecStartPost), pinging Vercel's push-notification
# endpoint. This is only a hint -- the endpoint never trusts it and always
# does its own real health check through the public tunnel before sending
# anything (see web/src/app/api/host-online/route.ts). Must never fail or
# block the service from being considered started: always exits 0, and a
# bounded timeout keeps a broken network from hanging startup.
#
# Deploy: /usr/local/bin/notify-host-online.sh on CT 105, chmod +x.
# HOST_ONLINE_SECRET is inherited from playground-controller.service's own
# EnvironmentFile (ExecStartPost commands share the unit's environment).
#
# No separate log file: ExecStartPost runs as the unprivileged
# playground-ctrl user (inherited from the unit's User= directive), which
# can't write to /var/log/ -- found this the hard way (silent permission
# failure, swallowed by this script's own exit 0). Output goes to stdout/
# stderr instead, captured in the journal like everything else in this
# unit (`journalctl -u playground-controller`).
set -u
wget -q -O- --timeout=15 --tries=1 \
  --header="Authorization: Bearer ${HOST_ONLINE_SECRET}" \
  --post-data="" \
  https://jslnode.anujajay.com/api/host-online
exit 0
