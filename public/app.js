function getCookie(name) {
  const cookieString = document.cookie || "";
  const cookies = cookieString.split(";").map((part) => part.trim()).filter(Boolean);

  for (const cookie of cookies) {
    const separatorIndex = cookie.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = cookie.slice(0, separatorIndex).trim();
    if (key !== name) {
      continue;
    }

    return decodeURIComponent(cookie.slice(separatorIndex + 1));
  }

  return "";
}

function syncMobileMenuState(isOpen) {
  const toggleButton = document.querySelector(".nav-toggle-button");
  const menu = document.querySelector(".nav-menu");
  if (!toggleButton || !menu) {
    return;
  }

  toggleButton.setAttribute("aria-expanded", String(isOpen));
  menu.classList.toggle("is-open", isOpen);
}

document.body.addEventListener("htmx:configRequest", (event) => {
  if (!["post", "put", "patch", "delete"].includes(event.detail.verb)) {
    return;
  }

  const csrfToken = getCookie("csrfToken");
  if (csrfToken) {
    event.detail.headers["X-CSRF-Token"] = csrfToken;
  }
});

document.body.addEventListener("click", (event) => {
  const toggleButton = event.target.closest(".nav-toggle-button");
  if (toggleButton) {
    const nextState = toggleButton.getAttribute("aria-expanded") !== "true";
    syncMobileMenuState(nextState);
    return;
  }

  const navAction = event.target.closest(".nav-links button, .auth-actions button");
  if (navAction && window.innerWidth <= 832) {
    syncMobileMenuState(false);
  }
});

document.body.addEventListener("htmx:afterSwap", (event) => {
  if (event.target.id === "site-nav") {
    syncMobileMenuState(false);
  }
});
