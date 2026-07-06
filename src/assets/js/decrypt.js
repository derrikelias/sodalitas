(function () {
  const unlock = document.getElementById("unlock");
  if (!unlock) return;

  const form = document.getElementById("unlock-form");
  const input = document.getElementById("unlock-code");
  const errorMessage = document.getElementById("unlock-error");

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

  // Placeholder content is replaced in place — the page never goes
  // empty, it just swaps from generic placeholder to the real thing.
  // If a member genuinely has nothing for a given section (e.g. no
  // gallery yet), that section is hidden once we actually know that,
  // rather than left showing placeholder boxes forever.
  function renderContent(data) {
    // Reveal the real name and meta now that the correct key's been
    // entered — these were withheld behind a generic placeholder
    // until this point, even though the encrypted content below is
    // the actual sensitive part.
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

    const timelineList = document.getElementById("timeline-list");
    if (data.timeline && data.timeline.length) {
      timelineList.innerHTML = "";
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
    } else {
      document.getElementById("timeline-section").hidden = true;
    }

    if (data.memoriesTitle || data.sharedMemories) {
      document.getElementById("memories-title").textContent = data.memoriesTitle || "";
      document.getElementById("memories-body").textContent = data.sharedMemories || "";
    } else {
      document.getElementById("memories-section").hidden = true;
    }

    const countriesList = document.getElementById("countries-list");
    if (data.countries && data.countries.length) {
      document.getElementById("countries-count").textContent = `${data.countries.length}, so far`;
      countriesList.innerHTML = "";
      data.countries.forEach((country) => {
        const li = document.createElement("li");
        li.textContent = country;
        countriesList.appendChild(li);
      });
    } else {
      document.getElementById("countries-section").hidden = true;
    }

    const galleryGrid = document.getElementById("gallery-grid");
    if (data.gallery && data.gallery.length) {
      galleryGrid.innerHTML = "";
      data.gallery.forEach((image) => {
        const img = document.createElement("img");
        img.src = image.src;
        img.alt = image.alt || "";
        img.loading = "lazy";
        galleryGrid.appendChild(img);
      });
    } else {
      document.getElementById("gallery-section").hidden = true;
    }

    if (data.personalMessage) {
      const messageEl = document.getElementById("message-text");
      const attributionEl = document.getElementById("message-attribution");
      messageEl.childNodes[0].textContent = data.personalMessage;
      if (data.personalMessageAttribution) {
        attributionEl.textContent = data.personalMessageAttribution;
      } else {
        attributionEl.remove();
      }
    } else {
      document.getElementById("message-section").hidden = true;
    }

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
