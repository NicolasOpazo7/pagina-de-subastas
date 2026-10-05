const AUCTION_CATEGORIES = [
  { value: "tecnologia", label: "Tecnologia" },
  { value: "joyeria", label: "Joyeria" },
  { value: "hogar", label: "Hogar" },
  { value: "relojeria", label: "Relojeria" },
  { value: "musica", label: "Musica" },
  { value: "fotografia", label: "Fotografia" }
];

function getIndexPath() {
  return window.location.pathname.includes("/pages/") ? "../index.html" : "index.html";
}

function renderCategoryMenus() {
  document.querySelectorAll("[data-category-menu]").forEach((menu) => {
    menu.innerHTML = AUCTION_CATEGORIES
      .map((category) => (
        `<a href="${getIndexPath()}?category=${category.value}#productos">${category.label}</a>`
      ))
      .join("");
  });
}

function renderCategorySelect(select, options = {}) {
  if (!select) {
    return;
  }

  const currentValue = select.value;
  const includeAll = options.includeAll ?? false;
  select.innerHTML = includeAll ? `<option value="all">Todas</option>` : "";

  AUCTION_CATEGORIES.forEach((category) => {
    const option = document.createElement("option");
    option.value = category.value;
    option.textContent = category.label;
    select.appendChild(option);
  });

  if (currentValue && Array.from(select.options).some((option) => option.value === currentValue)) {
    select.value = currentValue;
  }
}

function renderAllCategoryControls() {
  renderCategoryMenus();
  renderCategorySelect(document.querySelector("#category-filter"), { includeAll: true });
  renderCategorySelect(document.querySelector("#product-category"));
  renderCategorySelect(document.querySelector("#edit-category"));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", renderAllCategoryControls);
} else {
  renderAllCategoryControls();
}
