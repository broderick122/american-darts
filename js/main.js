/* Mobile menu, current section, and the sample join form.
   The form does not send a message. Replace this file if you add a real contact method. */
(function () {
  var header = document.querySelector(".site-header");
  var toggle = document.querySelector(".nav-toggle");
  var toggleLabel = document.querySelector(".nav-toggle-label");
  var nav = document.querySelector("#site-nav");
  var form = document.querySelector("#join-form");
  var status = document.querySelector("#form-status");

  function setOpen(open) {
    header.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggleLabel.textContent = open ? "Close" : "Menu";
  }

  toggle.addEventListener("click", function () {
    setOpen(toggle.getAttribute("aria-expanded") !== "true");
  });

  nav.addEventListener("click", function (event) {
    if (event.target.closest("a")) setOpen(false);
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") setOpen(false);
  });

  var desktopNav = window.matchMedia("(min-width: 980px)");
  function closeIfDesktop() {
    if (desktopNav.matches) setOpen(false);
  }
  if (desktopNav.addEventListener) {
    desktopNav.addEventListener("change", closeIfDesktop);
  } else if (desktopNav.addListener) {
    desktopNav.addListener(closeIfDesktop);
  }

  var links = Array.prototype.slice.call(nav.querySelectorAll('a[href^="#"]'));
  var sections = links
    .map(function (link) {
      return document.querySelector(link.getAttribute("href"));
    })
    .filter(Boolean);

  if ("IntersectionObserver" in window) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          links.forEach(function (link) {
            if (link.getAttribute("href") === "#" + entry.target.id) {
              link.setAttribute("aria-current", "true");
            } else {
              link.removeAttribute("aria-current");
            }
          });
        });
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 }
    );
    sections.forEach(function (section) {
      observer.observe(section);
    });
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    status.textContent =
      "This is a sample form. Nothing was sent. Add a real contact method when the league is ready.";
  });
})();
