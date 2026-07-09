(function () {
  const root = document.documentElement;
  const toggle = document.getElementById("theme-toggle");
  const STORAGE_KEY = "sodalitas-theme";

  // Precedence: explicit saved choice, then system preference,
  // then dark as the considered default for this archive.
  const saved = localStorage.getItem(STORAGE_KEY);
  const systemPrefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
  const initial = saved || (systemPrefersLight ? "light" : "dark");
  root.setAttribute("data-theme", initial);

  if (toggle) {
    toggle.addEventListener("click", function () {
      const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      localStorage.setItem(STORAGE_KEY, next);
    });
  }
})();
