// Run locally only: `npm run encrypt`
//
// Reads real member content from private/members-plaintext/<number>/ —
// content.json for text, gallery/*.jpg for photos — and access codes
// from private/codes.json. Neither of those are ever committed (see
// .gitignore).
//
// Text content is encrypted as one payload and written into that
// member's src/members/*.md front matter. Photos are encrypted
// SEPARATELY, one file each, and written to
// src/assets/gallery-encrypted/<number>/ — genuine committed files in
// the repo, visible in its history, just unreadable without the key.
// Both use the same derived key (from the member's code), but every
// encryption — the text payload, and each individual photo — gets its
// own fresh initialisation vector, which is essential: reusing an IV
// with the same key breaks AES-GCM's security guarantees.
//
// Photos are resized and compressed automatically so full-resolution
// source photos don't balloon the repo size — see MAX_IMAGE_DIMENSION
// below.
//
// Uses PBKDF2 (SHA-256, 250,000 iterations) to derive the key, then
// AES-256-GCM to encrypt. Both are standard Web Crypto operations, so
// the browser can reverse this exactly with no external libraries —
// see src/assets/js/decrypt.js.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const matter = require("gray-matter");
const Jimp = require("jimp");

const PRIVATE_DIR = path.join(__dirname, "..", "private");
const PLAINTEXT_DIR = path.join(PRIVATE_DIR, "members-plaintext");
const CODES_FILE = path.join(PRIVATE_DIR, "codes.json");
const MEMBERS_DIR = path.join(__dirname, "..", "src", "members");
const GALLERY_ENCRYPTED_DIR = path.join(__dirname, "..", "src", "assets", "gallery-encrypted");

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

function deriveKey(code, salt) {
  return crypto.pbkdf2Sync(code, salt, PBKDF2_ITERATIONS, KEY_LENGTH, "sha256");
}

// One encryption operation: fresh IV every time, same key reused
// safely across many calls as long as the IV never repeats.
function encryptBuffer(buffer, key) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Web Crypto's SubtleCrypto expects the auth tag appended to the
  // ciphertext, not separate — matching that here so the browser can
  // decrypt this with no adjustment.
  return { iv: iv.toString("base64"), ciphertext: Buffer.concat([encrypted, authTag]) };
}

async function processImage(filePath) {
  const image = await Jimp.read(filePath);
  const { width, height } = image.bitmap;
  const longestEdge = Math.max(width, height);

  if (longestEdge > MAX_IMAGE_DIMENSION) {
    const scale = MAX_IMAGE_DIMENSION / longestEdge;
    image.resize(Math.round(width * scale), Math.round(height * scale));
  }

  image.quality(JPEG_QUALITY);
  return image.getBufferAsync(Jimp.MIME_JPEG);
}

// Encrypts each photo individually and writes it as its own committed
// file. Clears out the member's existing encrypted-gallery folder
// first, so removing a source photo actually removes its encrypted
// counterpart too, rather than leaving an orphaned file behind.
async function buildGallery(memberDir, number, key) {
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

  const outputDir = path.join(GALLERY_ENCRYPTED_DIR, number);
  fs.rmSync(outputDir, { recursive: true, force: true });
  if (imageFiles.length > 0) fs.mkdirSync(outputDir, { recursive: true });

  const gallery = [];

  for (let i = 0; i < imageFiles.length; i++) {
    const filename = imageFiles[i];
    console.log(`  Processing photo: ${filename}`);
    const jpegBuffer = await processImage(path.join(galleryDir, filename));
    const { iv, ciphertext } = encryptBuffer(jpegBuffer, key);

    const outputFilename = `${String(i + 1).padStart(2, "0")}.enc`;
    fs.writeFileSync(path.join(outputDir, outputFilename), ciphertext);

    gallery.push({
      file: outputFilename,
      iv,
      mime: "image/jpeg",
      alt: captions[filename] || "",
    });
  }
  return gallery;
}

function run_check_setup() {
  if (!fs.existsSync(PLAINTEXT_DIR)) {
    console.error("No private/members-plaintext/ folder found. Nothing to encrypt.");
    process.exit(1);
  }
}

async function run() {
  const codes = loadCodes();
  run_check_setup();

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

    // One salt, one derived key, reused for the text payload and every
    // photo — safe because each individual encryption gets its own
    // fresh IV (see encryptBuffer above).
    const salt = crypto.randomBytes(SALT_LENGTH);
    const key = deriveKey(code, salt);

    const galleryMeta = await buildGallery(memberDir, number, key);

    const plaintextObject = JSON.parse(fs.readFileSync(contentPath, "utf8"));
    plaintextObject.gallery = galleryMeta;

    const contentBuffer = Buffer.from(JSON.stringify(plaintextObject), "utf8");
    const { iv, ciphertext } = encryptBuffer(contentBuffer, key);

    const existing = matter.read(memberFilePath);
    const updatedData = {
      ...existing.data,
      encrypted: true,
      salt: salt.toString("base64"),
      iv,
      ciphertext: ciphertext.toString("base64"),
      pbkdf2Iterations: PBKDF2_ITERATIONS,
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

    const output = matter.stringify("", updatedData);
    fs.writeFileSync(memberFilePath, output);

    console.log(`  → ${path.relative(process.cwd(), memberFilePath)}`);
    console.log(`  → ${galleryMeta.length} photo(s) encrypted to src/assets/gallery-encrypted/${number}/`);
  }

  console.log("\nDone. Commit the .md files under src/members/ AND the folders under");
  console.log("src/assets/gallery-encrypted/ — both are safe to commit, since both");
  console.log("contain only ciphertext. Everything in private/ stays off GitHub.");
}

run();
