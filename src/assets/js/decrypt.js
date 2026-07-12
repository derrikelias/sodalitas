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
  // needed just to save it. Built once, reused for every photo — and
  // aware of the whole gallery, not just one image, so arrows can
  // step forward and backward without closing and reopening.
  let lightboxParts;
  let galleryPhotos = [];
  let currentIndex = 0;

  function buildLightbox() {
    const lightbox = document.createElement("div");
    lightbox.className = "lightbox";
    lightbox.hidden = true;

    const content = document.createElement("div");
    content.className = "lightbox-content";
    lightbox.appendChild(content);

    const img = document.createElement("img");
    content.appendChild(img);

    const downloadLink = document.createElement("a");
    downloadLink.className = "lightbox-download";
    downloadLink.textContent = "Download";
    content.appendChild(downloadLink);

    const closeBtn = document.createElement("button");
    closeBtn.className = "lightbox-close";
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "×";
    lightbox.appendChild(closeBtn);

    const prevBtn = document.createElement("button");
    prevBtn.className = "lightbox-nav lightbox-prev";
    prevBtn.type = "button";
    prevBtn.setAttribute("aria-label", "Previous photo");
    prevBtn.textContent = "‹";
    lightbox.appendChild(prevBtn);

    const nextBtn = document.createElement("button");
    nextBtn.className = "lightbox-nav lightbox-next";
    nextBtn.type = "button";
    nextBtn.setAttribute("aria-label", "Next photo");
    nextBtn.textContent = "›";
    lightbox.appendChild(nextBtn);

    closeBtn.addEventListener("click", closeLightbox);
    prevBtn.addEventListener("click", () => showPhoto(currentIndex - 1));
    nextBtn.addEventListener("click", () => showPhoto(currentIndex + 1));
    lightbox.addEventListener("click", (e) => {
      if (!content.contains(e.target) && e.target !== closeBtn && e.target !== prevBtn && e.target !== nextBtn) {
        closeLightbox();
      }
    });
    document.addEventListener("keydown", (e) => {
      if (lightbox.hidden) return;
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") showPhoto(currentIndex - 1);
      if (e.key === "ArrowRight") showPhoto(currentIndex + 1);
    });

    document.body.appendChild(lightbox);
    return { lightbox, img, downloadLink, prevBtn, nextBtn };
  }

  // Wraps around at either end — cyclical, so the arrows always do
  // something rather than dead-ending on the first or last photo.
  function showPhoto(index) {
    const total = galleryPhotos.length;
    currentIndex = (index + total) % total;
    const { img, downloadLink, prevBtn, nextBtn } = lightboxParts;
    const photo = galleryPhotos[currentIndex];
    img.src = photo.url;
    img.alt = photo.alt || "";
    downloadLink.href = photo.url;
    downloadLink.download = `sodalitas-photo-${String(currentIndex + 1).padStart(2, "0")}.jpg`;
    const multiple = total > 1;
    prevBtn.hidden = !multiple;
    nextBtn.hidden = !multiple;
  }

  function openLightbox(photos, startIndex) {
    if (!lightboxParts) lightboxParts = buildLightbox();
    galleryPhotos = photos;
    showPhoto(startIndex);
    lightboxParts.lightbox.hidden = false;
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
      const totalCities = data.countries.reduce(
        (sum, c) => sum + (c.visits ? c.visits.length : 0),
        0
      );
      document.getElementById("countries-count").textContent =
        totalCities > 0
          ? `${totalCities} ${totalCities === 1 ? "city" : "cities"} across ${data.countries.length}, so far`
          : `${data.countries.length}, so far`;

      const countriesList = document.getElementById("countries-list");
      const itinerary = document.getElementById("travel-itinerary");
      const mapContainer = document.getElementById("travel-map");
      let selectedCode = null;

      function renderItinerary(country) {
        if (!country) {
          itinerary.innerHTML = '<p class="travel-itinerary-empty">Select a country to see where, and when.</p>';
          return;
        }
        itinerary.innerHTML = "";

        const heading = document.createElement("h3");
        heading.className = "travel-itinerary-country";
        heading.textContent = country.name;
        itinerary.appendChild(heading);

        const visits = country.visits || [];
        if (visits.length) {
          const stat = document.createElement("p");
          stat.className = "travel-itinerary-stat";
          stat.textContent = `${visits.length} ${visits.length === 1 ? "place" : "places"} visited together`;
          itinerary.appendChild(stat);

          const list = document.createElement("ul");
          list.className = "travel-visit-list";
          visits.forEach((visit) => {
            const li = document.createElement("li");
            const place = document.createElement("span");
            place.className = "travel-visit-place";
            place.textContent = visit.place || "";
            const date = document.createElement("span");
            date.className = "travel-visit-date";
            date.textContent = visit.date || "";
            li.append(place, date);
            list.appendChild(li);
          });
          itinerary.appendChild(list);
        }
      }

      // Some countries (island nations, or mainlands with outlying
      // territories like Portugal's Azores) are grouped under a <g>
      // with the country code, containing several <path> fragments,
      // rather than the code sitting on one single <path>. This finds
      // every fragment either way, so the whole country highlights
      // together rather than just whichever piece happened to carry
      // the id directly.
      function getCountryPaths(code) {
        const directPath = mapContainer.querySelector(`path[id="${code}"]`);
        if (directPath) return [directPath];
        const group = mapContainer.querySelector(`g[id="${code}"]`);
        return group ? Array.from(group.querySelectorAll("path")) : [];
      }

      function selectCountry(code) {
        selectedCode = selectedCode === code ? null : code;

        document.querySelectorAll(".countries button").forEach((btn) => {
          btn.setAttribute("aria-pressed", String(btn.dataset.code === selectedCode));
        });
        mapContainer.querySelectorAll("path.selected").forEach((p) => p.classList.remove("selected"));
        if (selectedCode) {
          getCountryPaths(selectedCode).forEach((p) => p.classList.add("selected"));
        }

        const country = data.countries.find((c) => c.code === selectedCode);
        renderItinerary(country);
      }

      data.countries.forEach((country) => {
        const li = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = country.name;
        button.dataset.code = country.code || "";
        button.setAttribute("aria-pressed", "false");
        button.addEventListener("click", () => selectCountry(country.code));
        li.appendChild(button);
        countriesList.appendChild(li);
      });

      // The map itself carries no personal information — just country
      // borders — but it's still only fetched once a member is actually
      // unlocked, in keeping with not loading anything until it's needed.
      try {
        const mapResponse = await fetch(unlock.dataset.mapUrl);
        const mapSvgText = await mapResponse.text();
        mapContainer.innerHTML = mapSvgText;

        data.countries.forEach((country) => {
          if (!country.code) return;
          getCountryPaths(country.code).forEach((path) => {
            path.classList.add("visited");
            path.addEventListener("click", () => selectCountry(country.code));
          });
        });
      } catch (err) {
        mapContainer.hidden = true;
      }

      document.getElementById("countries-section").hidden = false;
    }

    if (data.gallery && data.gallery.length) {
      const galleryGrid = document.getElementById("gallery-grid");
      const photoUrls = await Promise.all(
        data.gallery.map((entry) => fetchAndDecryptPhoto(entry, key))
      );
      const photos = photoUrls.map((url, i) => ({ url, alt: data.gallery[i].alt || "" }));
      photos.forEach((photo, i) => {
        const img = document.createElement("img");
        img.src = photo.url;
        img.alt = photo.alt;
        img.loading = "lazy";
        img.tabIndex = 0;
        img.setAttribute("role", "button");
        img.addEventListener("click", () => openLightbox(photos, i));
        img.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openLightbox(photos, i);
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
