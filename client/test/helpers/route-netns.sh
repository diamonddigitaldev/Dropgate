#!/usr/bin/env bash
# Two adapters for the network service's Linux route check, on this machine
# only: each a veth pair with its far end in a network namespace of its own,
# where the test's server and DNS responder run.
#   dga0 10.201.0.1  <->  dg-a's dga1 10.201.0.2   (the adapter chosen)
#   dgb0 10.202.0.1  <->  dg-b's dgb1 10.202.0.2   (another adapter)
# dg-b routes 10.201.0.0/24 back through dgb0, so a connection bound to
# dga0's address that the kernel sends out of dgb0 (Linux's weak host model)
# is answered, and the test sees it reach dg-b's server.
# Run as root (sudo); `down` removes it all.
set -euo pipefail

if [ "${1:-}" = "down" ]; then
    ip netns del dg-a 2>/dev/null || true
    ip netns del dg-b 2>/dev/null || true
    exit 0
fi

for side in a b; do
    net="10.20$([ "$side" = a ] && echo 1 || echo 2).0"
    ip netns add "dg-$side"
    ip link add "dg${side}0" type veth peer name "dg${side}1" netns "dg-$side"
    ip addr add "$net.1/24" dev "dg${side}0"
    ip link set "dg${side}0" up
    ip -n "dg-$side" addr add "$net.2/24" dev "dg${side}1"
    ip -n "dg-$side" link set "dg${side}1" up
    ip -n "dg-$side" link set lo up
done
ip -n dg-b route add 10.201.0.0/24 via 10.202.0.1
