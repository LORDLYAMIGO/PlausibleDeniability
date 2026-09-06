# Security analysis

## Occupancy

Unused slots and encrypted slots are both random-looking. A slot is accepted only after ChaCha20-Poly1305 authentication and encrypted metadata validation. This does not prove indistinguishability; it is an implementation experiment.

## Payload count and size

The fixed container size hides capacity changes, but not the fact that a later version has changed. Payload size also affects how many slots are written and may be inferred by comparing versions or observing the writer.

## File type

File bytes are inside authenticated ciphertext. No filenames or file signatures are stored in the public header.

## Placement limitation

A password can deterministically calculate its candidate slots, but a writer cannot test whether an unknown password already owns a random-looking slot. Adding multiple secrets therefore has a non-zero collision risk. A public allocation table would solve allocation but violate the design goal, so v1 exposes the limitation and does not claim perfect multi-payload deniability.

## Mutation

Header and ciphertext changes cause validation failure. Version comparison remains outside the cryptographic guarantee.
