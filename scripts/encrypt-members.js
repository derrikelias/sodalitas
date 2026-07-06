// Run locally only: `npm run encrypt`
//
// Reads real member content from private/members-plaintext/*.json and
// access codes from private/codes.json — neither of which are ever
// committed (see .gitignore) — and writes the encrypted result directly
// into the matching src/members/*.md file's front matter. That .md file
// is what gets committed; by the time it's saved, it contains only
// ciphertext, a salt, and an initialisation vector — nothing readable.
//
// Uses PBKDF2 (SHA-256, 250,000 iterations) to derive a key from the
// member's access code, then AES-256-GCM to encrypt. Both are standard
// Web Crypto operations, so the browser can reverse this exactly with
// no external libraries — see src/assets/js/decrypt.js.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const matter = require("gray-matter");

const PRIVATE_DIR = path.join(__dirname, "..", "private");
const PLAINTEXT_DIR = path.join(PRIVATE_DIR, "members-plaintext");
const CODES_FILE = path.join(PRIVATE_DIR, "codes.json");
const MEMBERS_DIR = path.join(__dirname, "..", "src", "members");

const PBKDF2_ITERATIONS = 250000;
const KEY_LENGTH = 32; // 256-bit
const SALT_LENGTH = 16;
const IV_LENGTH = 12; // standard for AES-GCM

function loadCodes() {
  if (!fs.existsSync(CODES_FILE)) {
    console.error(
      "No private/codes.json found. Copy private/codes.example.json to " +
        "private/codes.json and fill in real codes before running this."
    );
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CODES_FILE, "utf8"));
}

function findMemberFile(number) {
  const files = fs.readdirSync(MEMBERS_DIR).filter((f) => f.endsWith(".md"));
  for (const file of files) {
    const fullPath = path.join(MEMBERS_DIR, file);
    const parsed = matter.read(fullPath);
    if (String(parsed.data.number) === String(number)) {
      return fullPath;
    }
  }
  return null;
}

function encryptPayload(plaintextObject, code) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = crypto.pbkdf2Sync(code, salt, PBKDF2_ITERATIONS, KEY_LENGTH, "sha256");

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintextBuffer = Buffer.from(JSON.stringify(plaintextObject), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Web Crypto's SubtleCrypto expects the auth tag appended to the
  // ciphertext, not separate — matching that here so the browser can
  // decrypt this with no adjustment.
  const combined = Buffer.concat([encrypted, authTag]);

  return {
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    ciphertext: combined.toString("base64"),
    pbkdf2Iterations: PBKDF2_ITERATIONS,
  };
}

function run() {
  const codes = loadCodes();

  if (!fs.existsSync(PLAINTEXT_DIR)) {
    console.error("No private/members-plaintext/ folder found. Nothing to encrypt.");
    process.exit(1);
  }

  const plaintextFiles = fs
    .readdirSync(PLAINTEXT_DIR)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".example.json"));

  if (plaintextFiles.length === 0) {
    console.log("No plaintext member files found to encrypt.");
    return;
  }

  for (const file of plaintextFiles) {
    const number = path.basename(file, ".json");
    const code = codes[number];

    if (!code) {
      console.warn(`Skipping ${file} — no matching code for member ${number} in codes.json`);
      continue;
    }

    const plaintextPath = path.join(PLAINTEXT_DIR, file);
    const plaintextObject = JSON.parse(fs.readFileSync(plaintextPath, "utf8"));

    const memberFilePath = findMemberFile(number);
    if (!memberFilePath) {
      console.warn(`Skipping ${file} — no src/members/*.md file found with number: "${number}"`);
      continue;
    }

    const { salt, iv, ciphertext, pbkdf2Iterations } = encryptPayload(plaintextObject, code);

    const existing = matter.read(memberFilePath);
    const updatedData = {
      ...existing.data,
      encrypted: true,
      salt,
      iv,
      ciphertext,
      pbkdf2Iterations,
    };

    // Remove any leftover plaintext fields from earlier drafts — they've
    // moved inside the encrypted payload now and shouldn't sit
    // alongside it in the open.
    delete updatedData.memoriesTitle;
    delete updatedData.sharedMemories;
    delete updatedData.timeline;
    delete updatedData.countries;
    delete updatedData.gallery;
    delete updatedData.personalMessage;
    delete updatedData.personalMessageAttribution;

    // The Markdown body itself also becomes redundant once encrypted —
    // the real prose now lives inside the ciphertext.
    const output = matter.stringify("", updatedData);
    fs.writeFileSync(memberFilePath, output);

    console.log(`Encrypted member ${number} → ${path.relative(process.cwd(), memberFilePath)}`);
  }

  console.log("\nDone. Only the .md files under src/members/ need to be committed —");
  console.log("everything in private/ should stay right where it is, off GitHub.");
}

run();
