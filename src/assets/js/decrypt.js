(function () {
  const unlock = document.getElementById("unlock");
  if (!unlock) return;

  const form = document.getElementById("unlock-form");
  const input = document.getElementById("unlock-code");
  const errorMessage = document.getElementById("unlock-error");
  const content = document.getElementById("member-content");

  // The wordmark normally links home, but while this page is still
  // locked, clicking it should just leave the visitor here rather
  // than let them wander off before proving they hold the key.
  const brandLink = document.getElementById("site-brand-link");
  function blockBrandLink(event) {
    event.preventDefault();
  }
  if (brandLink) brandLink.addEventListener("click", blockBrandLink);

  const salt = base64ToBytes(unlock.dataset.salt);
  const iv = base64ToBytes(unlock.dataset.iv);
  const ciphertext = base64ToBytes(unlock.dataset.ciphertext);
  const iterations = parseInt(unlock.dataset.iterations, 10);
  const galleryBase = unlock.dataset.galleryBase;

  function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function deriveKey(passphrase) {
    const encoder = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
      "raw",
      encoder.encode(passphrase),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
  }

  async function attemptUnlock(passphrase) {
    const key = await deriveKey(passphrase);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    const text = new TextDecoder().decode(decrypted);
    return { data: JSON.parse(text), key };
  }

  // Each photo is its own committed, encrypted file — fetched here and
  // decrypted with the SAME key already derived from the member's code,
  // but each photo has its own unique IV (stored alongside it in the
  // decrypted text payload), matching how they were encrypted.
  async function fetchAndDecryptPhoto(entry, key) {
    const response = await fetch(galleryBase + entry.file);
    const encryptedBuffer = await response.arrayBuffer();
    const photoIv = base64ToBytes(entry.iv);
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: photoIv },
      key,
      encryptedBuffer
    );
    const blob = new Blob([decryptedBuffer], { type: entry.mime });
    return URL.createObjectURL(blob);
  }

  // Built once, reused for every photo — a plain overlay with the
  // image shown larger, and a direct download link to the same
  // already-decrypted file, so no second fetch or re-decrypt is
  // needed just to save it.
  let lightboxParts;
  function buildLightbox() {
    const lightbox = document.createElement("div");
    lightbox.className = "lightbox";
    lightbox.hidden = true;

    const img = document.createElement("img");
    lightbox.appendChild(img);

    const closeBtn = document.createElement("button");
    closeBtn.className = "lightbox-close";
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "×";
    lightbox.appendChild(closeBtn);

    const downloadLink = document.createElement("a");
    downloadLink.className = "lightbox-download";
    downloadLink.textContent = "Download";
    lightbox.appendChild(downloadLink);

    closeBtn.addEventListener("click", closeLightbox);
    lightbox.addEventListener("click", (e) => {
      if (e.target === lightbox) closeLightbox();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !lightbox.hidden) closeLightbox();
    });

    document.body.appendChild(lightbox);
    return { lightbox, img, downloadLink };
  }

  function openLightbox(objectUrl, alt, index) {
    if (!lightboxParts) lightboxParts = buildLightbox();
    const { lightbox, img, downloadLink } = lightboxParts;
    img.src = objectUrl;
    img.alt = alt || "";
    downloadLink.href = objectUrl;
    downloadLink.download = `sodalitas-photo-${String(index + 1).padStart(2, "0")}.jpg`;
    lightbox.hidden = false;
  }

  function closeLightbox() {
    if (lightboxParts) lightboxParts.lightbox.hidden = true;
  }

  // Every section starts hidden and empty in the actual page markup.
  // Nothing here is revealed or populated until this function runs,
  // which only happens after a correct key has genuinely decrypted
  // the real content — there is no placeholder standing in for it.
  async function renderContent(data, key) {
    // Restore the ordinary header now that the page is genuinely
    // unlocked — nav links reappear, the brand mark returns to its
    // normal left-aligned position, and the toggle regains its
    // divider now that it once again sits beside the nav.
    const nav = document.getElementById("site-nav");
    if (nav) nav.hidden = false;
    const header = document.getElementById("site-header");
    if (header) header.classList.remove("site-minimal");
    const brand = document.getElementById("site-brand");
    if (brand) brand.classList.remove("brand-center");
    const toggle = document.getElementById("theme-toggle");
    if (toggle) toggle.classList.remove("theme-toggle-standalone");
    if (brandLink) brandLink.removeEventListener("click", blockBrandLink);

    const nameEl = document.getElementById("member-name");
    nameEl.textContent = nameEl.dataset.realName;

    const metaEl = document.getElementById("member-meta");
    const since = metaEl.dataset.since;
    const role = metaEl.dataset.role;
    metaEl.innerHTML = "";
    const sinceSpan = document.createElement("span");
    sinceSpan.textContent = `Member since ${since}`;
    metaEl.appendChild(sinceSpan);
    if (role) {
      const roleSpan = document.createElement("span");
      roleSpan.textContent = role;
      metaEl.appendChild(roleSpan);
    }

    if (data.timeline && data.timeline.length) {
      const timelineList = document.getElementById("timeline-list");
      data.timeline.forEach((entry) => {
        const li = document.createElement("li");

        const date = document.createElement("span");
        date.className = "date";
        date.textContent = entry.date;

        const title = document.createElement("h3");
        title.className = "entry-title";
        title.textContent = entry.title;

        const body = document.createElement("p");
        body.textContent = entry.body;

        li.append(date, title, body);
        timelineList.appendChild(li);
      });
      document.getElementById("timeline-section").hidden = false;
    }

    if (data.memoriesTitle || data.sharedMemories) {
      document.getElementById("memories-title").textContent = data.memoriesTitle || "";
      document.getElementById("memories-body").textContent = data.sharedMemories || "";
      document.getElementById("memories-section").hidden = false;
    }

    if (data.countries && data.countries.length) {
      document.getElementById("countries-count").textContent = `${data.countries.length}, so far`;
      const countriesList = document.getElementById("countries-list");
      data.countries.forEach((country) => {
        const li = document.createElement("li");
        li.textContent = country;
        countriesList.appendChild(li);
      });
      document.getElementById("countries-section").hidden = false;
    }

    if (data.gallery && data.gallery.length) {
      const galleryGrid = document.getElementById("gallery-grid");
      const photoUrls = await Promise.all(
        data.gallery.map((entry) => fetchAndDecryptPhoto(entry, key))
      );
      photoUrls.forEach((objectUrl, i) => {
        const img = document.createElement("img");
        img.src = objectUrl;
        img.alt = data.gallery[i].alt || "";
        img.loading = "lazy";
        img.tabIndex = 0;
        img.setAttribute("role", "button");
        img.addEventListener("click", () => openLightbox(objectUrl, img.alt, i));
        img.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openLightbox(objectUrl, img.alt, i);
          }
        });
        galleryGrid.appendChild(img);
      });
      document.getElementById("gallery-section").hidden = false;
    }

    if (data.personalMessage) {
      const messageEl = document.getElementById("message-text");
      messageEl.textContent = data.personalMessage;
      if (data.personalMessageAttribution) {
        const attribution = document.createElement("span");
        attribution.className = "message-attribution";
        attribution.textContent = data.personalMessageAttribution;
        messageEl.appendChild(attribution);
      }
      document.getElementById("message-section").hidden = false;
    }

    content.hidden = false;
    unlock.hidden = true;
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    errorMessage.hidden = true;

    try {
      const { data, key } = await attemptUnlock(input.value);
      await renderContent(data, key);
    } catch (err) {
      // Wrong code or corrupted data both fail decryption the same way —
      // deliberately no distinction shown, so nothing is leaked either way.
      errorMessage.hidden = false;
      input.value = "";
      input.focus();
    }
  });
})();
