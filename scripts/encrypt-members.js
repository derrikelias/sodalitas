// Run locally only: `npm run encrypt`
//
// Reads real member content from private/members-plaintext/<number>/ —
// content.json for text, gallery/*.jpg for photos — and access codes
// from private/codes.json. Neither of those are ever committed (see
// .gitignore). Everything gets bundled into ONE encrypted payload per
// member and written into that member's src/members/*.md front matter.
// That .md file is what gets committed; by the time it's saved, it
// contains only ciphertext, a salt, and an initialisation vector —
// nothing readable, and no separate image files sitting in the repo
// either. Photos are resized and compressed automatically so a handful
// of full-resolution source photos don't balloon the repo size once
// base64-encoded and encrypted — see MAX_IMAGE_DIMENSION below.
//
// Uses PBKDF2 (SHA-256, 250,000 iterations) to derive a key from the
// member's access code, then AES-256-GCM to encrypt. Both are standard
// Web Crypto operations, so the browser can reverse this exactly with
// no external libraries — see src/assets/js/decrypt.js.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const matter = require("gray-matter");
const Jimp = require("jimp");

const PRIVATE_DIR = path.join(__dirname, "..", "private");
const PLAINTEXT_DIR = path.join(PRIVATE_DIR, "members-plaintext");
const CODES_FILE = path.join(PRIVATE_DIR, "codes.json");
const MEMBERS_DIR = path.join(__dirname, "..", "src", "members");

const PBKDF2_ITERATIONS = 250000;
const KEY_LENGTH = 32; // 256-bit
const SALT_LENGTH = 16;
const IV_LENGTH = 12; // standard for AES-GCM

const MAX_IMAGE_DIMENSION = 1600; // longest edge, in pixels
const JPEG_QUALITY = 82;
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

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

// Resizes to a sane maximum, re-compresses, and returns base64 — kept
// as a data URI-ready pair (mime + data) so decrypt.js can build an
// <img src="data:..."> directly with no separate file to fetch.
async function processImage(filePath) {
  const image = await Jimp.read(filePath);
  const { width, height } = image.bitmap;
  const longestEdge = Math.max(width, height);

  if (longestEdge > MAX_IMAGE_DIMENSION) {
    const scale = MAX_IMAGE_DIMENSION / longestEdge;
    image.resize(Math.round(width * scale), Math.round(height * scale));
  }

  image.quality(JPEG_QUALITY);
  const buffer = await image.getBufferAsync(Jimp.MIME_JPEG);

  return { mime: "image/jpeg", data: buffer.toString("base64") };
}

async function buildGallery(memberDir) {
  const galleryDir = path.join(memberDir, "gallery");
  if (!fs.existsSync(galleryDir)) return [];

  const captionsPath = path.join(galleryDir, "captions.json");
  const captions = fs.existsSync(captionsPath)
    ? JSON.parse(fs.readFileSync(captionsPath, "utf8"))
    : {};

  const imageFiles = fs
    .readdirSync(galleryDir)
    .filter((f) => IMAGE_EXTENSIONS.includes(path.extname(f).toLowerCase()))
    .sort();

  const gallery = [];
  for (const filename of imageFiles) {
    console.log(`  Processing photo: ${filename}`);
    const { mime, data } = await processImage(path.join(galleryDir, filename));
    gallery.push({ mime, data, alt: captions[filename] || "" });
  }
  return gallery;
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

async function run() {
  const codes = loadCodes();

  if (!fs.existsSync(PLAINTEXT_DIR)) {
    console.error("No private/members-plaintext/ folder found. Nothing to encrypt.");
    process.exit(1);
  }

  const memberFolders = fs
    .readdirSync(PLAINTEXT_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  if (memberFolders.length === 0) {
    console.log("No plaintext member folders found to encrypt.");
    return;
  }

  for (const number of memberFolders) {
    const memberDir = path.join(PLAINTEXT_DIR, number);
    const contentPath = path.join(memberDir, "content.json");

    if (!fs.existsSync(contentPath)) {
      console.warn(`Skipping ${number}/ — no content.json found inside it`);
      continue;
    }

    const code = codes[number];
    if (!code) {
      console.warn(`Skipping ${number}/ — no matching code for member ${number} in codes.json`);
      continue;
    }

    const memberFilePath = findMemberFile(number);
    if (!memberFilePath) {
      console.warn(`Skipping ${number}/ — no src/members/*.md file found with number: "${number}"`);
      continue;
    }

    console.log(`Encrypting member ${number}...`);
    const plaintextObject = JSON.parse(fs.readFileSync(contentPath, "utf8"));
    plaintextObject.gallery = await buildGallery(memberDir);

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

    console.log(`  → ${path.relative(process.cwd(), memberFilePath)} (${plaintextObject.gallery.length} photo(s) embedded)`);
  }

  console.log("\nDone. Only the .md files under src/members/ need to be committed —");
  console.log("everything in private/ should stay right where it is, off GitHub.");
}

run();
