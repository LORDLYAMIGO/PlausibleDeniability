# Plausible Deniability

## 1. Project Overview

Build a local-first encrypted file container called **Plausible Deniability**.

The container stores one or more independently encrypted payloads in a collection of fixed-size slots.

A password deterministically derives the keys and placement information necessary to recover one payload.

Example:

```text
vault.pd
   │
   ├── Password A → File A
   ├── Password B → Decoy File B
   ├── Password C → Decoy File C
   └── Password D → Decoy File D
```

The physical container should not contain a plaintext manifest identifying:

* filenames
* number of payloads
* payload locations
* passwords
* file types
* payload boundaries

The goal is for the physical slots to look like uniformly random encrypted data.

This is an **experimental cryptographic project**, not a claim of formally proven deniable encryption.

---

# 2. Goals

### Primary goals

1. Create an encrypted container file.
2. Support multiple independently accessible payloads.
3. Allow different passwords to recover different payloads.
4. Split payloads into fixed-size chunks.
5. Scatter chunks throughout the container.
6. Encrypt every chunk with authenticated encryption.
7. Use random filler for unused slots.
8. Avoid plaintext metadata describing the hidden payloads.
9. Make all physical slots the same size.
10. Make the system deterministic enough that a password can locate its chunks without a database.
11. Provide a CLI and React UI.
12. Include adversarial/security tests demonstrating what information leaks.

### Non-goals

Do NOT attempt to:

* invent a new encryption algorithm
* implement custom cryptographic primitives
* claim mathematical proof of plausible deniability
* hide the fact that a container exists
* protect against a compromised operating system
* protect against malware/keyloggers
* provide secure deletion guarantees
* provide cloud synchronization
* use a database

---

# 3. Tech Stack

## Backend / Core

* Node.js
* TypeScript
* Node.js `crypto`
* Argon2id through a well-maintained Node package
* ChaCha20-Poly1305 or AES-256-GCM
* HKDF-SHA-256
* Vitest for tests
* Commander.js for CLI

Prefer:

```text
Node.js
TypeScript
```

over plain JavaScript.

## Frontend

* React
* TypeScript
* Vite
* Minimal CSS
* No heavy UI framework required

The UI should be deliberately simple.

## Storage

No database.

Everything is represented by:

```text
.pd container file
```

Temporary files should be handled carefully and deleted after use where practical.

---

# 4. Repository Structure

Use a monorepo-style structure:

```text
plausible-deniability/
│
├── apps/
│   ├── cli/
│   │   └── src/
│   │
│   └── web/
│       └── src/
│
├── packages/
│   ├── crypto/
│   │   └── src/
│   │
│   ├── container/
│   │   └── src/
│   │
│   ├── placement/
│   │   └── src/
│   │
│   └── shared/
│       └── src/
│
├── tests/
│   ├── crypto/
│   ├── container/
│   ├── placement/
│   ├── attacks/
│   └── integration/
│
├── docs/
│   ├── architecture.md
│   ├── threat-model.md
│   ├── security.md
│   └── format.md
│
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
└── README.md
```

Use `pnpm` workspaces.

---

# 5. High-Level Architecture

```text
                    ┌──────────────────┐
                    │      React       │
                    │       UI         │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │      Node        │
                    │    Application   │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
         Crypto Engine   Placement       Container
              │              │              │
              └──────────────┼──────────────┘
                             ▼
                         vault.pd
```

The cryptographic/container libraries must be independent of React.

The CLI should use the same core libraries.

---

# 6. Cryptographic Design

Use established primitives only.

Recommended:

```text
Password
   │
   ▼
Argon2id
   │
   ▼
Master Key
   │
   ├── HKDF → Placement Key
   ├── HKDF → Encryption Key
   └── HKDF → Authentication/Domain key
```

Do not reuse one derived key for every purpose.

Use domain separation.

For example:

```text
K_master = Argon2id(password, salt)

K_place = HKDF(
    K_master,
    info = "plausible-deniability/placement/v1"
)

K_encrypt = HKDF(
    K_master,
    info = "plausible-deniability/encryption/v1"
)
```

The exact implementation should use a cryptographically secure library rather than hand-written cryptography.

---

# 7. Container Format

The container consists of:

```text
[Public Header][Fixed-Size Slot Region]
```

The public header must contain only information that is acceptable to reveal.

Do NOT store:

```text
password
filename
file count
file type
payload locations
chunk count
```

The header may contain:

```text
magic
version
slot size
number of slots
KDF parameters
container salt
container identifier
```

However, carefully consider which fields leak information.

The implementation must document every public field and why it is acceptable.

---

# 8. Header

Define a binary header rather than JSON.

Example conceptual structure:

```text
MAGIC              8 bytes
VERSION            2 bytes
FLAGS              2 bytes
SLOT_SIZE          8 bytes
SLOT_COUNT         8 bytes
KDF_MEMORY         4 bytes
KDF_ITERATIONS     4 bytes
KDF_PARALLELISM    4 bytes
CONTAINER_SALT     32 bytes
CONTAINER_ID       32 bytes
```

The exact layout can change during implementation.

Use explicit endianness.

Implement:

```text
encodeHeader()
decodeHeader()
validateHeader()
```

with strict bounds checking.

---

# 9. Fixed-Size Slots

Every slot must have exactly the same physical size.

For example:

```text
SLOT_SIZE = 1 MiB
```

Do not assume 1 MiB is optimal; make it configurable at container creation time.

Physical layout:

```text
Header
│
├── Slot 0
├── Slot 1
├── Slot 2
├── Slot 3
├── ...
└── Slot N
```

Every slot contains either:

```text
encrypted chunk
```

or:

```text
cryptographically random filler
```

The raw physical slot size must be identical in both cases.

---

# 10. Chunk Format

Each logical chunk should have a fixed maximum plaintext capacity.

For example:

```text
SLOT_SIZE = 1 MiB
```

Reserve space for:

```text
nonce
ciphertext
authentication tag
encrypted metadata
```

A chunk should conceptually contain:

```text
┌───────────────────────────────┐
│ nonce                         │
├───────────────────────────────┤
│ encrypted chunk metadata     │
├───────────────────────────────┤
│ encrypted payload             │
├───────────────────────────────┤
│ authentication tag            │
├───────────────────────────────┤
│ padding                       │
└───────────────────────────────┘
```

All unused bytes should be cryptographically random.

Do not put recognizable plaintext markers into chunks.

---

# 11. Chunk Metadata

Metadata necessary to reconstruct the original file should itself be encrypted.

For example:

```text
chunk_index
total_chunks
payload_id
plaintext_length
final_chunk
```

This metadata must NOT appear in plaintext.

Encrypt it along with the chunk.

Conceptually:

```text
plaintext:

{
    payloadId,
    chunkIndex,
    totalChunks,
    plaintextLength,
    data
}
```

then:

```text
AEAD_encrypt(...)
```

The exact serialization should be deterministic and versioned.

---

# 12. File Splitting

When importing a file:

```text
file
 ↓
read stream
 ↓
split into fixed-size chunks
 ↓
encrypt chunks
 ↓
assign slots
```

Do not load a multi-gigabyte file entirely into RAM.

Use Node.js streams.

Example:

```text
100 MB file
+
1 MB chunk size
=
100 chunks
```

For the final chunk, pad to the fixed chunk plaintext capacity.

The actual final plaintext length must be encrypted metadata.

---

# 13. Placement System

This is the most important non-cryptographic component.

For each password:

```text
password
    ↓
Argon2id
    ↓
master key
    ↓
placement key
    ↓
keyed permutation / PRF
    ↓
candidate slots
```

The goal is to make the slot locations pseudorandom without storing a plaintext manifest.

---

# 14. Recommended Placement Algorithm

Do NOT simply use:

```text
hash(key + chunkIndex) % slotCount
```

without collision handling.

That can produce collisions.

Instead implement a deterministic keyed permutation over the slot space.

Conceptually:

```text
permutation = PRP(K_place, slotCount)
```

Then:

```text
chunk 0 → permutation(0)
chunk 1 → permutation(1)
chunk 2 → permutation(2)
...
```

If implementing a general arbitrary-size permutation is inconvenient, implement a carefully tested deterministic keyed mapping with collision resolution.

Document the construction.

The important properties are:

1. deterministic given the password and container
2. pseudorandom-looking
3. no plaintext index
4. handles collisions
5. does not require a database

---

# 15. Collision Handling

The implementation must guarantee that two chunks belonging to the same payload never overwrite each other.

For different payloads, collisions must also be handled.

A useful strategy is:

```text
candidate = keyed_hash(key, chunk_index)

if slot occupied:
    derive next candidate
```

For example:

```text
slot_0 = HMAC(K_place, "chunk:0") % N

slot_1 = HMAC(K_place, "chunk:1") % N

...
```

If occupied:

```text
candidate_1 = HMAC(K_place, "chunk:0:probe:1") % N
candidate_2 = HMAC(K_place, "chunk:0:probe:2") % N
```

However, be aware that deterministic placement across multiple passwords requires careful design because a newly added payload does not know all previous secret passwords.

Do not silently solve this by writing a plaintext allocation table.

Instead, design the allocator so that all slot assignments can be determined from the secret and container state without revealing the secret set.

If this cannot be achieved cleanly, explicitly document the limitation rather than pretending it is solved.

---

# 16. Important Design Decision: Real vs Decoy Payloads

The software itself should not distinguish:

```text
real file
```

from:

```text
decoy file
```

All payloads should be structurally identical.

The application should simply support:

```text
addPayload(password, file)
```

The user decides which password/file is the "real" one.

This prevents the implementation from having a privileged "main secret."

---

# 17. Random Filler

Unused slots must be filled using:

```text
crypto.randomBytes(...)
```

Do not use:

```text
Math.random()
```

Do not use predictable filler.

Filler must occupy the entire physical slot.

Therefore:

```text
unused slot
=
random bytes
```

rather than:

```text
unused slot
=
zero bytes
```

because zero-filled regions are trivially distinguishable.

---

# 18. Decryption

User provides:

```text
container
password
```

Process:

```text
read public header
       ↓
derive master key
       ↓
derive placement key
       ↓
derive encryption key
       ↓
generate candidate slot locations
       ↓
read candidate slots
       ↓
attempt AEAD authentication
       ↓
collect valid chunks
       ↓
verify chunk metadata
       ↓
sort chunks by chunk index
       ↓
stream reconstructed plaintext to output
```

If authentication fails:

```text
treat as invalid candidate
```

Do not expose detailed errors.

---

# 19. Wrong Password Handling

The public API should not leak whether:

* the password was almost correct
* some chunks matched
* one chunk matched
* a payload exists
* authentication partially succeeded

Return a generic result such as:

```text
Unable to recover a valid payload.
```

Internally, tests can distinguish failure modes.

The UI should not say:

```text
Found 3 encrypted chunks but password was wrong.
```

because that leaks information.

---

# 20. Payload Reconstruction

After discovering valid chunks:

```text
chunkIndex
0
1
2
3
...
N
```

verify:

```text
all expected chunks exist
no duplicates
indices are valid
totalChunks agrees
payloadId agrees
final length is valid
```

Only then reconstruct the file.

If validation fails, treat the password/container combination as invalid.

Do not produce partially reconstructed files by default.

---

# 21. Password Processing

Passwords must never be stored.

Do not log them.

Do not include them in:

```text
error messages
React state longer than necessary
analytics
localStorage
sessionStorage
```

If possible, keep password handling within the shortest practical lifetime.

For the browser UI, prefer sending the password to a local Node process only when necessary.

---

# 22. CLI

Build a CLI:

```text
pd create vault.pd
pd add vault.pd --password-env PD_PASSWORD secret.pdf
pd open vault.pd --password-env PD_PASSWORD
pd inspect vault.pd
pd benchmark
```

Avoid accepting passwords directly as shell arguments because command-line arguments can leak through process listings and shell history.

Prefer:

```text
PD_PASSWORD=...
```

or interactive hidden password input.

---

# 23. CLI Commands

### Create

```text
pd create vault.pd \
  --size 512M \
  --slot-size 1M
```

Creates:

```text
vault.pd
```

filled with random slots.

---

### Add

```text
pd add vault.pd secret.pdf
```

Prompt:

```text
Password:
Confirm password:
```

Then:

```text
file
 ↓
chunks
 ↓
encrypt
 ↓
placement
 ↓
write slots
```

---

### Extract

```text
pd extract vault.pd
```

Prompt:

```text
Password:
Output:
```

Then recover whichever payload corresponds to that password.

---

### Inspect

This command must NOT expose hidden payload information.

It can display:

```text
Container version
Slot size
Container size
KDF parameters
Number of physical slots
```

It should explicitly avoid:

```text
payload count
filenames
payload types
occupied slot locations
```

---

# 24. React UI

Create a minimal monochrome interface.

Pages:

```text
Home
│
├── Create Container
├── Add Payload
├── Open Container
└── Security / About
```

### Create Container

Fields:

```text
Container size
Slot size
Output path
```

### Add Payload

Fields:

```text
Container
File
Password
Confirm password
```

### Open

Fields:

```text
Container
Password
Output directory
```

Display:

```text
Recovering...
```

If successful:

```text
Payload recovered.
```

Do not display:

```text
"This is payload #3."
```

or anything revealing hidden structure.

---

# 25. Backend API

Use a small local Node HTTP API.

Endpoints:

```text
POST /api/container/create
POST /api/container/add
POST /api/container/extract
GET  /api/container/info
```

Never expose cryptographic keys in API responses.

Never log request bodies containing passwords.

Prefer streaming file uploads.

---

# 26. Security Boundary

The React app is a UI.

The actual cryptographic logic belongs in:

```text
packages/crypto
packages/container
packages/placement
```

Never implement encryption independently in React.

There must be one canonical cryptographic implementation.

---

# 27. Threat Model

Document the attacker as:

```text
Attacker has:
- complete access to the .pd file
- ability to copy it
- ability to inspect its binary structure
- ability to modify copies
- ability to test arbitrary passwords offline
- ability to compare multiple versions of the container
```

Assume:

```text
Attacker does NOT have:
- user's password
- compromised machine
- keylogger
- memory dump while password is being used
```

Document that a compromised machine defeats the design.

---

# 28. Security Properties to Test

Test whether an attacker can infer:

### 1. Number of payloads

Compare containers containing:

```text
0 payloads
1 payload
2 payloads
5 payloads
```

Look for structural differences.

---

### 2. Payload size

Compare:

```text
small file
large file
```

and examine whether the physical representation leaks the difference.

---

### 3. File type

Test:

```text
PDF
JPEG
ZIP
TXT
MP4
```

The ciphertext should not expose obvious magic bytes or file signatures.

---

### 4. Slot occupancy

Statistically compare:

```text
empty slot
encrypted payload slot
```

The goal is for both to look pseudorandom.

---

### 5. Entropy

Measure entropy of:

```text
filler
encrypted slots
```

Look for obvious differences.

---

### 6. Avalanche behavior

Changing one password character should produce substantially different derived keys and placement.

---

### 7. Password guessing

Benchmark:

```text
Argon2id(password)
```

with your chosen parameters.

Document the cost.

Do not make the KDF artificially weak just to make the demo fast.

---

# 29. Container Mutation Tests

An attacker can modify:

```text
slot
header
ciphertext
```

Verify that tampering is detected.

Test:

```text
flip one bit
```

in:

* header
* ciphertext
* authentication tag
* chunk metadata

No modified payload should be accepted as valid.

---

# 30. Cross-Password Tests

Critical test:

```text
create A using password A
create B using password B
```

Then:

```text
decrypt(password A) → A
decrypt(password B) → B
decrypt(password C) → failure
```

Repeat this with:

```text
N = 2
N = 10
N = 100
```

where feasible.

---

# 31. Garbage-Decryption Test

Generate thousands of random passwords.

For each:

```text
attempt extraction
```

Verify:

```text
no false-positive payload
```

This is important because your system must not accidentally interpret random bytes as valid chunks.

AEAD authentication should make accidental acceptance computationally negligible.

---

# 32. Size Variation Test

Test:

```text
A = 1 KB
B = 1 MB
C = 100 MB
```

Then inspect:

```text
container size
slot distribution
slot contents
```

Document exactly what remains observable.

This is particularly important because **fixed-size slots do not automatically hide total payload size**.

If the container has a fixed capacity, unused capacity should remain filled with random bytes.

---

# 33. Important Limitation: Container Growth

Do not implement:

```text
container automatically grows whenever payload is added
```

without discussing leakage.

If adding a payload changes the container's total size, an observer who possesses multiple versions can potentially infer that something changed.

For v1, prefer:

```text
fixed-capacity container
```

created initially.

Example:

```text
vault.pd = 1 GB
```

The physical file remains 1 GB regardless of how many payloads are currently populated.

This greatly simplifies the leakage model.

---

# 34. Important Limitation: Mutable Containers

Appending new payloads later introduces a difficult problem.

If:

```text
version 1 = payload A
version 2 = payload A + payload B
```

an attacker who has both versions can compare them.

This can reveal changed slots.

Therefore, document that **multi-version deniability is not guaranteed**.

For the first version, consider treating the container as immutable after creation or explicitly warning that modifications can leak information.

---

# 35. Storage Capacity

Define:

```text
usable_capacity =
slot_count × payload_capacity_per_slot
```

The application must reject a payload if there aren't enough available slots.

Do not silently resize the container.

Do not overwrite existing slots.

---

# 36. Error Handling

Avoid overly specific cryptographic errors.

Externally:

```text
Unable to recover payload.
```

Internally:

```text
Invalid authentication tag
Invalid chunk metadata
Missing chunk
Duplicate chunk
Invalid header
Unsupported version
```

Detailed diagnostics should only appear in development/test environments.

---

# 37. Performance

Benchmark:

```text
1 MB
10 MB
100 MB
1 GB
```

Measure:

* container creation
* encryption
* decryption
* Argon2id derivation
* placement generation
* extraction
* memory consumption

Use streaming wherever possible.

The application should not require loading a 1 GB container into memory.

---

# 38. Tests

Target at least:

```text
Unit tests
Integration tests
Property tests
Security tests
Performance tests
```

### Unit

```text
KDF
HKDF
AEAD
chunk serialization
header serialization
placement
```

### Integration

```text
create → add → extract
```

### Property tests

For arbitrary binary data:

```text
decrypt(encrypt(data, password), password) == data
```

Test many random inputs.

### Security

```text
wrong password
tampered ciphertext
tampered header
random password
slot collision
duplicate chunk
missing chunk
```

---

# 39. Fuzzing

Add fuzz tests for:

```text
header parser
chunk parser
container parser
```

Feed malformed binary data.

The parser must never:

```text
crash Node
allocate absurd memory
hang indefinitely
accept malformed structures
```

---

# 40. Documentation

README should contain:

## What is this?

Short explanation.

## Example

```text
vault.pd

password-A → harmless.pdf
password-B → sensitive.pdf
```

## Architecture

Diagram.

## Cryptographic primitives

Explain:

```text
Argon2id
HKDF
ChaCha20-Poly1305/AES-GCM
CSPRNG
```

## Threat model

Explicitly explain what is and isn't protected.

## Container format

Document binary layout.

## Security limitations

This section is mandatory.

Do not oversell the project.

---

# 41. Attack Analysis Section

This should be a major part of the project.

Create:

```text
docs/security-analysis.md
```

Include experiments:

```text
Experiment 1:
Can we determine whether a slot is occupied?

Experiment 2:
Can we determine payload count?

Experiment 3:
Can we determine file type?

Experiment 4:
Can we determine payload size?

Experiment 5:
Can we detect changes between container versions?

Experiment 6:
Can random passwords produce false positives?
```

Include actual measurements and conclusions.

---

# 42. Suggested Development Order

Do NOT build the React frontend first.

Build in this order:

```text
1. Repository setup
2. Crypto primitives
3. Chunk format
4. Slot format
5. Container format
6. Placement engine
7. Create container
8. Add payload
9. Extract payload
10. Security tests
11. Attack analysis
12. CLI
13. Node API
14. React UI
15. Documentation
16. Benchmarks
```

The crypto/container implementation must work entirely from the CLI before building the frontend.

---

# 43. Milestone 1

Implement:

```text
encrypt(password, Buffer)
decrypt(password, Buffer)
```

Requirements:

```text
Argon2id
AEAD
random salt
random nonce
authentication
```

Tests:

```text
round trip
wrong password
tampering
empty file
large file
random binary data
```

---

# 44. Milestone 2

Implement:

```text
split(file)
reassemble(chunks)
```

Tests:

```text
0 bytes
1 byte
chunk_size - 1
chunk_size
chunk_size + 1
multiple chunks
```

---

# 45. Milestone 3

Implement:

```text
createContainer()
readContainer()
writeSlot()
readSlot()
```

Every slot must be fixed-size.

Verify physically:

```text
fileSize =
headerSize + slotCount × slotSize
```

---

# 46. Milestone 4

Implement placement.

Build a test visualizer that produces:

```text
password A:
[17, 93, 201, 4, ...]

password B:
[42, 11, 302, 91, ...]
```

This visualizer can exist only in development/testing.

Do not expose this through the production UI.

---

# 47. Milestone 5

Integrate:

```text
file
 ↓
chunks
 ↓
encrypted chunks
 ↓
placement
 ↓
container
```

Then:

```text
container
 ↓
password
 ↓
placement
 ↓
chunks
 ↓
decrypt
 ↓
file
```

---

# 48. Milestone 6

Implement multiple payloads.

Test:

```text
A → password-a
B → password-b
C → password-c
```

Then verify:

```text
password-a → A
password-b → B
password-c → C
```

and:

```text
password-x → failure
```

---

# 49. Milestone 7

Implement adversarial analysis.

Create scripts:

```text
analyze-slots.ts
analyze-entropy.ts
analyze-size.ts
compare-containers.ts
bruteforce-test.ts
```

Generate reports.

The point is not merely demonstrating that the system works.

The point is attempting to **break your own assumptions**.

---

# 50. Milestone 8

Build CLI.

Only after the core system is stable.

---

# 51. Milestone 9

Build React UI.

Keep it intentionally minimal.

The frontend is not the selling point.

The cryptographic/container architecture is.

---

# 52. Final Demo

The final demo should show:

```text
Create 500 MB container
        ↓
Add harmless.pdf with password A
        ↓
Add secret.zip with password B
        ↓
Add decoy.jpg with password C
        ↓
Close application
        ↓
Open container with password A
        ↓
harmless.pdf
        ↓
Open same container with password B
        ↓
secret.zip
```

Then show:

```text
Wrong password
        ↓
Unable to recover payload
```

Finally demonstrate the security-analysis tooling:

```text
Container inspection
        ↓
All slots appear random
        ↓
No plaintext filenames
        ↓
No plaintext manifest
        ↓
No obvious file signatures
```

Then explicitly discuss remaining leakage.

---

# 53. Resume Positioning

Do NOT write:

> Built an unbreakable encrypted file system.

Instead, use something like:

> **Plausible Deniability — Deniable Encrypted Container**
>
> Designed a fixed-capacity encrypted container that stores independently recoverable payloads behind distinct secrets, using Argon2id, HKDF-derived keys, authenticated encryption, fixed-size chunks, pseudorandom slot placement, and cryptographic filler; built adversarial tests to measure metadata, size, occupancy, and multi-version leakage.

That communicates considerably more technical depth than simply saying:

> "Built a file encryption tool using AES."

---

# 54. Engineering Rules for the Coding Agent

The agent must follow these rules:

1. TypeScript throughout.
2. No custom cryptographic algorithms.
3. No plaintext password storage.
4. No plaintext payload manifest.
5. No plaintext filenames inside the hidden payload structure.
6. No `Math.random()` for security-sensitive randomness.
7. Use Node's CSPRNG.
8. Use authenticated encryption.
9. Use Argon2id for password-based key derivation.
10. Use HKDF for key separation.
11. Use streaming I/O for large files.
12. Avoid loading entire containers into RAM.
13. Every physical slot has identical size.
14. Unused slots contain cryptographically random bytes.
15. No database.
16. CLI and React must share the same core libraries.
17. Add tests before optimizing.
18. Document every security assumption.
19. Never claim a property that hasn't been demonstrated.
20. Treat the attack-analysis suite as a first-class part of the project.

---

# 55. Critical Caveat

The biggest unresolved research/engineering issue is **multi-payload placement without a discoverable allocation structure**.

Do not paper over this.

If the implementation ends up requiring a public table such as:

```text
password hash → slot locations
```

then the project has failed its primary design objective.

Likewise, if the implementation makes it trivial to distinguish:

```text
random filler
```

from:

```text
valid encrypted chunk
```

then the deniability claim is weakened.

The coding agent should explicitly stop and document the issue rather than introducing an insecure shortcut.

The project should be considered successful only after the placement scheme, collision handling, chunk authentication, and information leakage have been analyzed.
