# Host activation boundary

This is an operator instruction, not an automatically applied configuration.

To advertise `device-wide-enforced`, the host custodian must create a provider-owned systemd slice with cgroup-v2 `io` delegation for block device `8:48`, bind the service account/worktree permissions so governed clients cannot execute `/usr/bin/git` against the mounted territory outside the provider, and retain a tested emergency override. Record the resulting unit, cgroup path, device identity, permitted principals, and independent denial witness in this node's `data/` ledger. Until then, the executable service advertises only cooperative Git serialization.
