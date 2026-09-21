"use strict";

// The public half of the OUTARCH release-signing key. An update is installed
// only if its manifest was signed by the matching private key, which lives
// outside this repository (scripts/release/generate-signing-key.cjs made it).
// Replacing this key means every copy already installed stops trusting new
// releases until it is updated by hand, so rotate it only if the private key
// is lost or exposed.
const UPDATE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAmvc2lHol3IP1/ZJcQDaKHJQSprFvS7zSoic3yEGQmSo=
-----END PUBLIC KEY-----`;

// How often a running app looks for a release, after the first check shortly
// after launch.
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const UPDATE_FIRST_CHECK_DELAY_MS = 20 * 1000;

module.exports = { UPDATE_CHECK_INTERVAL_MS, UPDATE_FIRST_CHECK_DELAY_MS, UPDATE_PUBLIC_KEY };
