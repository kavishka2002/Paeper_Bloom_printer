# Desktop license integration

This directory contains the public ECDSA P-256 JWK from the owner vault used by the local BloomConnect generator. Its public fingerprint was checked against the generator vault, which matched the owner's existing encrypted backup. The desktop bundles the same key from packages/licensing/website-public-keys.json. The Ed25519 keys in packages/licensing/public-keys.json continue to validate older licenses.

Place the generator's license-format.md, license-example.txt, license-test-vectors.json and desktop-integration-guide.md here when supplied. Use a sample issued for a test Device ID. Compare the package's public key to public-key.json before using it. Store signing backups and passphrases outside this directory.

The inspected generator signs BC1 version 1 with ECDSA P-256 and SHA-256 over the exact ASCII prefix and base64url payload. Its signature is IEEE P1363. New BC1 licenses carry a signed kid which Desktop matches to a bundled website public key. Legacy BC1 licenses can still be verified against the bundled website public keys. The old Ed25519 format has a signed key ID, which must match a bundled Ed25519 key. Review new wire formats against their exported specifications and vectors before enabling them.

For a Windows integration test, run the following from BloomConnect, substituting the path to the generator checkout.

    node scripts/test-license-store.cjs "<generator checkout>/shared/license.ts"

This uses the real Web Crypto signing implementation, an ephemeral test key, and an isolated Windows license store. For a new owner signing key, append the public JWK from the integration ZIP to packages/licensing/website-public-keys.json and rebuild the installer. Test with a license issued for the Device ID shown by the rebuilt app.
