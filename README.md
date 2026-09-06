# Plausible Deniability

An experimental fixed-capacity encrypted container. Different passwords derive different payload identities and deterministic pseudorandom slot locations. Every physical slot is the same size and unused space is filled with cryptographically random bytes.

This is research software, not a formally proven deniable-encryption system.

## Quick start

```text
npm install
npx tsx apps/cli/src/index.ts create vault.pd --size 64M --slot-size 4K
$env:PD_PASSWORD = 'decoy-password'
npx tsx apps/cli/src/index.ts add vault.pd decoy.txt
$env:PD_PASSWORD = 'real-password'
npx tsx apps/cli/src/index.ts add vault.pd secret.bin
npx tsx apps/cli/src/index.ts extract vault.pd recovered.bin
```

Use `PD_PASSWORD` or `--password-env`; passwords are never command-line arguments.

## Design

Argon2id derives a master key from the password and public container salt. HKDF separates placement and encryption keys. ChaCha20-Poly1305 authenticates every chunk. Chunk metadata is encrypted, and physical slots have equal size.

The current allocator is deterministic per password and resolves collisions within one add operation. Because a writer cannot identify another password's occupied random-looking slots, cross-password collision avoidance cannot be guaranteed without a discoverable allocation structure. The implementation documents this limitation rather than claiming stronger deniability. Use generous capacity and treat mutation/version comparison as observable.

## Security limitations

The container size, public KDF parameters, slot geometry, and changes between versions are observable. A compromised machine, password reuse, weak passwords, offline guessing, and backups remain outside the protection boundary. The code currently reads a container into memory during add/extract; streaming I/O is a required next hardening step for large containers.
