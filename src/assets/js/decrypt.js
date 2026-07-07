(function () {
  const unlock = document.getElementById("unlock");
  if (!unlock) return;

  const form = document.getElementById("unlock-form");
  const input = document.getElementById("unlock-code");
  const errorMessage = document.getElementById("unlock-error");
  const content = document.getElementById("member-content");

  const salt = base64ToBytes(unlock.dataset.salt);
  const iv = base64ToBytes(unlock.dataset.iv);
  const ciphertext = base64ToBytes(unlock.dataset.ciphertext);
  const iterations = parseInt(unlock.dataset.iterations, 10);

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
    return JSON.parse(text);
  }

  // Every section starts hidden and empty in the actual page markup.
  // Nothing here is revealed or populated until this function runs,
  // which only happens after a correct key has genuinely decrypted
  // the real content — there is no placeholder standing in for it.
  function renderContent(data) {
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
      data.gallery.forEach((image) => {
        const img = document.createElement("img");
        img.src = image.src;
        img.alt = image.alt || "";
        img.loading = "lazy";
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
      const data = await attemptUnlock(input.value);
      renderContent(data);
    } catch (err) {
      // Wrong code or corrupted data both fail decryption the same way —
      // deliberately no distinction shown, so nothing is leaked either way.
      errorMessage.hidden = false;
      input.value = "";
      input.focus();
    }
  });
})();
