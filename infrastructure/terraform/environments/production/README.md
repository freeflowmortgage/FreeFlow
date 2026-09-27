# Production Terraform contract

This directory is a validation contract, not a deployable production stack.
It intentionally creates no resources. Production deployment remains blocked
until the dev foundation is promoted into an independently reviewed module and
wired to these guardrails in a separate AWS account and state backend.

The contract rejects unsafe production values for Multi-AZ, backup retention,
deletion protection, point-in-time recovery, service counts, WAF, TLS, private
compute, KMS, queue/DLQ encryption, Secrets Manager, monitoring, alerts, and
account separation. Do not copy dev defaults into production.
