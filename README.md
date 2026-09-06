# Plausible Deniability

An experimental fixed-capacity encrypted container. Different passwords derive different payload identities and deterministic pseudorandom slot locations. Every physical slot is the same size and unused space is filled with cryptographically random bytes.

This is research software, not a formally proven deniable-encryption system.

## Architecture

The project is split into a cryptographic core, a container format, a placement engine, and user-facing adapters:

```text
React web UI
	 |
	 | local JSON API
	 v
Node API / CLI
	 |
	 +-------------------+-------------------+
	 v                   v                   v
 packages/crypto   packages/container   packages/placement
	 |                   |                   |
	 +---------- derived keys / slots ------+
						 |
						 v
					   vault.pd
```

### Package boundaries

* `packages/crypto` owns Argon2id, HKDF key separation, ChaCha20-Poly1305, HMAC-based deterministic bytes, salts, nonces, and authentication tags.
* `packages/placement` maps a password-derived placement key and chunk index to pseudorandom slot candidates. Probe values resolve collisions among chunks being written in one operation.
* `packages/container` owns the binary header, fixed-size slots, encrypted chunk metadata, random filler, payload reconstruction, and validation.
* `apps/cli` exposes filesystem-oriented create, add, extract, and inspect commands.
* `apps/api` provides a loopback-only HTTP adapter for the browser. Uploaded bytes are written to temporary files while the shared container package performs the work.
* `apps/web` is a presentation layer. It generates passwords with the browser CSPRNG, uploads file bytes to the local API, and downloads the resulting container or recovered payload.

The React application does not implement cryptography. CLI, API, and UI workflows all use the same container and crypto packages.

### Encryption flow

```text
password + public container salt
			  |
			  v
		  Argon2id
			  |
		  master key
		  /         \
		 v           v
	  HKDF        HKDF
   placement    encryption
	  key           key
		 |           |
		 v           v
   slot candidates  ChaCha20-Poly1305
						 |
						 v
				   authenticated chunk
```

Each payload is split into fixed-capacity chunks. A chunk contains an encrypted metadata record followed by payload bytes and random padding. The metadata includes the payload identifier, chunk index, total chunk count, actual plaintext length, a format marker, and the original filename. The filename is therefore recoverable but is not visible in the public header or slot bytes.

### Recovery flow

1. Read and strictly validate the public header.
2. Derive the master, placement, and encryption keys from the supplied password.
3. Calculate the password's deterministic candidate slots.
4. Attempt AEAD authentication on candidate-looking slots.
5. Validate the decrypted metadata, filename, payload identifier, chunk indexes, lengths, and total count.
6. Require every chunk before returning any plaintext.
7. Reassemble the payload and return its encrypted filename metadata to the CLI or UI.

Wrong passwords and malformed candidates produce the same public error: `Unable to recover payload.`

## Container format

The physical file is:

```text
[88-byte public header][slot 0][slot 1]...[slot N-1]
```

Every slot has exactly `slotSize` bytes. An unused slot is filled entirely with `crypto.randomBytes`. A populated slot contains a nonce, authenticated ciphertext, authentication tag, and random slot padding. The slot itself never contains a plaintext filename, password, payload count, or allocation table.

The current public header is binary and big-endian:

| Offset | Size | Field |
| ---: | ---: | --- |
| 0 | 8 | Magic: `PDENY001` |
| 8 | 2 | Format version |
| 10 | 2 | Flags |
| 12 | 4 | Slot size |
| 16 | 4 | Slot count |
| 20 | 4 | Argon2id memory cost |
| 24 | 4 | Argon2id iteration cost |
| 28 | 4 | Argon2id parallelism |
| 32 | 32 | Container salt |
| 64 | 24 | Container identifier |

The header exposes geometry and KDF parameters because readers need them to parse the file and derive keys. It intentionally does not expose payload metadata. The encrypted chunk metadata currently reserves 256 bytes, including up to 222 UTF-8 filename bytes.

## Placement and collision behavior

For chunk index `i`, the placement key is used as an HMAC key over a domain-separated label such as `slot:i:probe:p`. The digest is reduced into the slot range. If two chunks from the same add operation select the same slot, the probe value advances until an unused candidate is found.

This does not solve the deeper multi-password allocation problem: a writer cannot know whether a random-looking slot was previously selected using another unknown password. A public allocation table would make allocation reliable but would reveal hidden structure. The current implementation therefore documents this limitation and recommends generous fixed capacity. It does not claim perfect multi-payload deniability.

## Local API

The API listens on `127.0.0.1:8787` and is intended for local use only:

| Endpoint | Purpose |
| --- | --- |
| `POST /api/container/encrypt` | Accept two base64 file payloads and passwords, create a fixed-capacity container, and return base64 `.pd` bytes |
| `POST /api/container/recover` | Accept base64 `.pd` bytes and a password, then return the recovered bytes and encrypted filename metadata |
| `POST /api/container/create` | Create a filesystem container |
| `POST /api/container/add` | Add a filesystem payload |
| `POST /api/container/extract` | Extract a filesystem payload |
| `GET /api/container/info` | Read non-secret public geometry and KDF information |

The browser endpoints use temporary files so the API can reuse the same filesystem-oriented container implementation. Temporary files are removed in `finally` blocks. Passwords and payloads are not logged or persisted by the API.

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

Argon2id derives a master key from the password and public container salt. HKDF separates placement and encryption keys. ChaCha20-Poly1305 authenticates every chunk. Chunk metadata, including the original filename and extension, is encrypted, and physical slots have equal size.

The current allocator is deterministic per password and resolves collisions within one add operation. Because a writer cannot identify another password's occupied random-looking slots, cross-password collision avoidance cannot be guaranteed without a discoverable allocation structure. The implementation documents this limitation rather than claiming stronger deniability. Use generous capacity and treat mutation/version comparison as observable.

## Security limitations

The container size, public KDF parameters, slot geometry, and changes between versions are observable. A compromised machine, password reuse, weak passwords, offline guessing, and backups remain outside the protection boundary. The code currently reads a container into memory during add/extract; streaming I/O is a required next hardening step for large containers.
