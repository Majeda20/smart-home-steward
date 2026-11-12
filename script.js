
var preferencesElement = document.getElementById("user-preferences");

if (preferencesElement) {
  document.documentElement.dataset.temperatureUnit = preferencesElement.dataset.temperatureUnit;
}

var sidebar = document.getElementById("sidebar");
var toggle = document.querySelector(".menu-toggle");

var narrowQuery = window.matchMedia("(max-width: 48em)");

var currentPage = window.location.pathname.split("/").pop() || "index.php";

var links = document.querySelectorAll(".nav a");

function isCompact() {
  return document.body.classList.contains("compact-nav");
}

function setSidebarOpen(isOpen) {
  sidebar.classList.toggle("open", isOpen);
  document.documentElement.classList.toggle("nav-open", isOpen);
}

links.forEach(function (link) {
  if (link.getAttribute("href") == currentPage) {
    link.classList.add("active");
  }

  link.addEventListener("click", function () {
    if (isCompact()) {
      setSidebarOpen(false);
    }
  });
});

toggle.addEventListener("click", function () {
  setSidebarOpen(!sidebar.classList.contains("open"));
});

var account = document.getElementById("account");
var accountToggle = document.querySelector(".account-toggle");

function setAccountOpen(isOpen) {
  account.classList.toggle("open", isOpen);
  accountToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
}

accountToggle.addEventListener("click", function () {
  setAccountOpen(!account.classList.contains("open"));
});

function updateNavMode(animate) {
  var compact = narrowQuery.matches;

  if (compact === isCompact()) {
    return;
  }

  if (!animate) {
    sidebar.style.transition = "none";
  }

  document.body.classList.toggle("compact-nav", compact);

  if (!animate) {
    void sidebar.offsetWidth;
    sidebar.style.transition = "";
  }

  setSidebarOpen(false);
  setAccountOpen(false);
}

updateNavMode(false);

narrowQuery.addEventListener("change", function () {
  updateNavMode(true);
});

document.addEventListener("click", function (event) {
  if (!account.contains(event.target)) {
    setAccountOpen(false);
  }

  if (!isCompact()) {
    return;
  }

  if (!sidebar.classList.contains("open")) {
    return;
  }

  if (sidebar.contains(event.target) || toggle.contains(event.target)) {
    return;
  }

  setSidebarOpen(false);
});

document.querySelectorAll(".search-clear").forEach(function (button) {
  var input = button.parentElement.querySelector('input[type="search"]');

  function updateClearButton() {
    button.hidden = input.value === "";
  }

  input.addEventListener("input", updateClearButton);

  button.addEventListener("click", function () {
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  });

  updateClearButton();
});

var situationsBadge = document.querySelector("[data-situations-badge]");
var SITUATIONS_BADGE_REFRESH_MS = 5000;

function showSituationsBadge(count) {
  situationsBadge.hidden = count === 0;
  situationsBadge.setAttribute("aria-label", "New situations");
}

function refreshSituationsBadge() {
  if (!situationsBadge || document.hidden) {
    return;
  }

  fetch("api/situations.php?count=1", { credentials: "same-origin" })
    .then(function (response) {
      return response.ok ? response.json() : null;
    })
    .then(function (data) {
      if (data) {
        showSituationsBadge(data.active);
      }
    })
    .catch(function () {});
}

if (situationsBadge) {
  refreshSituationsBadge();
  setInterval(refreshSituationsBadge, SITUATIONS_BADGE_REFRESH_MS);
  document.addEventListener("visibilitychange", refreshSituationsBadge);
}
