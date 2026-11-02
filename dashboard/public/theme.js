// Darstellung: system (Standard), hell oder dunkel. Läuft vor dem Rendern, damit nichts aufblitzt.
(function () {
  var KEY = "mailform-theme";
  var ORDER = ["system", "light", "dark"];
  var LABEL = { system: "System", light: "Hell", dark: "Dunkel" };
  var ICONS = {
    system: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8 20h8M12 16.5V20"/>',
    light: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
    dark: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  };

  function read() {
    try {
      var v = localStorage.getItem(KEY);
      return ORDER.indexOf(v) >= 0 ? v : "system";
    } catch (e) { return "system"; }
  }

  function apply(mode) {
    if (mode === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", mode);
  }

  apply(read());

  function paint(button, mode) {
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[mode] + "</svg>";
    button.setAttribute("aria-label", "Darstellung: " + LABEL[mode] + ". Zum Wechseln klicken");
    button.title = "Darstellung: " + LABEL[mode];
  }

  document.addEventListener("DOMContentLoaded", function () {
    var buttons = document.querySelectorAll("[data-theme-toggle]");
    buttons.forEach(function (b) { paint(b, read()); });
    buttons.forEach(function (button) {
      button.addEventListener("click", function () {
        var next = ORDER[(ORDER.indexOf(read()) + 1) % ORDER.length];
        try { localStorage.setItem(KEY, next); } catch (e) { /* Auswahl gilt nur für diese Sitzung */ }
        apply(next);
        buttons.forEach(function (b) { paint(b, next); });
      });
    });
  });
})();
