import {
  SMART_ICONS,
  STOP_WORDS,
  SCORING,
  COMPENDIUM_SCORING,
} from "./config.js";

// Directories to skip during icon scanning. Feel free to add more ignored directories here.
const IGNORED_DIRS = [
  /(modules|systems)\/.+\/node_modules/,
  /(modules|systems)\/.+\/lang/,
  /(modules|systems)\/.+\/packs/,
  /(modules|systems)\/.+\/src/,
  /(modules|systems)\/.+\/templates/,
];

/**
 * Extracts a readable display name from a file path.
 */
function readableName(path) {
  return path.split("/").pop().replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
}

/**
 * Attaches the Smart Icons button to the header of relevant application windows.
 */
function attachHeaderButton(app, buttons) {
  if (!game.user.isGM || !app.document) return;

  const docName = app.document.documentName;
  if (docName !== "Actor" && docName !== "Item") return;

  const activateSmartIcons = () => {
    if (!SMART_ICONS.ready) {
      ui.notifications.warn("Smart Icons are still initializing. Please try again.");
      return;
    }
    if (docName === "Item") openIconPicker(app.document);
    else if (docName === "Actor") batchSetIcons(app.document);
  };

  buttons.unshift({
    label: "Smart Icons",
    title: docName === "Item"
      ? "Assign a smart icon to this item"
      : "Batch assign smart icons to all items",
    class: "smart-icons-button",
    icon: "fas fa-images",
    onclick: activateSmartIcons,  // AppV1
    onClick: activateSmartIcons,  // AppV2
  });
}

Hooks.once("init", () => {
  console.log("Smart Icons | Initializing...");

  for (const sheetType of ["ActorSheet", "ItemSheet"]) {
    Hooks.on(`get${sheetType}HeaderButtons`, attachHeaderButton);
  }
  Hooks.on("getHeaderControlsApplicationV2", attachHeaderButton);
});

Hooks.once("ready", () => {
  if (!game.user.isGM) return;

  // Run the indexing in a non-blocking way to prevent UI freeze on world load.
  setTimeout(async () => {
    console.log("Smart Icons | Starting background indexing...");
    SMART_ICONS.ready = false;
    try {
      await indexFileIcons();
      await indexCompendiumItems();

      SMART_ICONS.ready = true;
      console.log("Smart Icons | Indexing complete.");
    } catch (err) {
      console.error("Smart Icons | Indexing failed:", err);
      ui.notifications.error("Smart Icons: Indexing failed. See console (F12) for details.");
      SMART_ICONS.ready = false;
    }
  }, 0);
});

/**
 * Creates a set of keywords from a file path or item name.
 * @param {string} name - File path or item name.
 * @param {boolean} isItem - Is this an item name instead of a file path?
 * @returns {Set<string>} A set of lowercase keywords
 */
function keywordsFromName(name, isItem = false) {
  let text = name;

  if (!isItem) {
    text = name.split("/").pop().replace(/\.[^.]+$/, "");
    try { text = decodeURIComponent(text); } catch { /* malformed sequence */ }
  }

  return new Set(
    text
      .split(/[\s\-_]+/)
      .map(word => word.toLowerCase().trim())
      .filter(word => word.length >= SCORING.KEYWORD_LENGTH && !STOP_WORDS.has(word))
  );
}

/**
 * Indexes all relevant image files from the core, system, and module directories.
 */
async function indexFileIcons() {
  console.log("Smart Icons | Indexing file icons...");
  const extensions = new Set(Object.keys(CONST.FILE_CATEGORIES.IMAGE));
  SMART_ICONS.iconKeywords = {};

  const FilePicker = foundry.applications.apps.FilePicker.implementation;

  async function indexDirectory(path, store = "public") {
    if (IGNORED_DIRS.some(rgx => rgx.test(path))) return;
    try {
      const content = await FilePicker.browse(store, path);
      for (const file of content.files) {
        const ext = file.split(".").pop();
        if (!extensions.has(ext)) continue;
        const keywords = keywordsFromName(file);
        if (keywords.size) SMART_ICONS.iconKeywords[file] = keywords;
      }
      for (const dir of content.dirs) {
        await indexDirectory(dir, store);
      }
    } catch { /* Silently ignore unbrowsable directories */ }
  }

  await indexDirectory("icons");
  await indexDirectory(`systems/${game.system.id}`, "data");
  await indexDirectory("modules", "data");

  const count = Object.keys(SMART_ICONS.iconKeywords).length;
  console.log(`Smart Icons | Indexed ${count} file icons.`);
}

/**
 * Indexes all items from compendium packs.
 */
async function indexCompendiumItems() {
  console.log("Smart Icons | Indexing compendium items...");
  SMART_ICONS.compendiumKeywords = {};
  for (const pack of game.packs) {
    if (pack.documentName !== "Item") continue;
    const index = await pack.getIndex({ fields: ["img"] });
    for (const entry of index) {
      if (!entry.img || entry.img.includes("mystery-man") || /\/default-icons\//.test(entry.img)) continue;
      const keywords = keywordsFromName(entry.name, true);
      if (keywords.size) {
        SMART_ICONS.compendiumKeywords[entry.name] = { keywords, img: entry.img };
      }
    }
  }
  const count = Object.keys(SMART_ICONS.compendiumKeywords).length;
  console.log(`Smart Icons | Indexed ${count} compendium items.`);
}

/**
 * Opens the icon picker dialog for a given item.
 */
async function openIconPicker(item, onConfirm, isBatch = false) {
  let selectedIcon = item.img;
  const activeTerms = new Set(keywordsFromName(item.name, true));

  function buildGrid() {
    const icons = findBestMatchingIcons(activeTerms, item.img);
    if (!icons.length) return `<p class="smart-icons-empty">No matches found.</p>`;
    return icons.map(icon => {
      const cls = icon === selectedIcon ? "selectedIcon" : "";
      const tip = readableName(icon);
      return `<img src="${icon}" class="${cls}" data-src="${icon}" title="${tip}">`;
    }).join("");
  }

  function buildTags() {
    const pills = [...activeTerms].map(tag =>
      `<span class="smart-icons-tag">${tag}<button data-tag="${tag}">&times;</button></span>`
    ).join("");
    return `${pills}<input class="smart-icons-tag-input" placeholder="Add keyword..." size="10">`;
  }

  function refresh(dialog) {
    dialog.element.querySelector(".smart-icons-tags").innerHTML = buildTags();
    dialog.element.querySelector(".smart-icons-iconHTML").innerHTML = buildGrid();
    wireEvents(dialog);
  }

  function wireEvents(dialog) {
    dialog.element.querySelectorAll(".smart-icons-iconHTML img").forEach(img => {
      img.addEventListener("click", () => {
        dialog.element.querySelectorAll(".smart-icons-iconHTML img")
          .forEach(el => el.classList.remove("selectedIcon"));
        img.classList.add("selectedIcon");
        selectedIcon = img.dataset.src;
      });
    });

    dialog.element.querySelectorAll(".smart-icons-tag button").forEach(btn => {
      btn.addEventListener("click", () => {
        activeTerms.delete(btn.dataset.tag);
        refresh(dialog);
      });
    });

    const input = dialog.element.querySelector(".smart-icons-tag-input");
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const word = input.value.trim().toLowerCase();
      if (word.length >= 2 && !activeTerms.has(word)) {
        activeTerms.add(word);
        refresh(dialog);
      }
    });
    input.focus();
  }

  const content = `
    <div class="smart-icons-tags">${buildTags()}</div>
    <div class="smart-icons-iconHTML">${buildGrid()}</div>`;

  const buttons = [
    { action: "select", label: "Confirm", default: true },
    { action: "cancel", label: "Cancel" },
  ];
  if (isBatch) buttons.push({ action: "skip", label: "Skip" });

  const action = await foundry.applications.api.DialogV2.wait({
    window: { title: `Select Icon for ${item.name}` },
    content,
    buttons,
    rejectClose: false,
    render: (_event, dialog) => wireEvents(dialog),
  });

  if (action === "select") {
    await item.update({ img: selectedIcon });
    onConfirm?.();
  } else if (action === "skip") {
    onConfirm?.();
  }
}

/**
 * Sequentially opens the icon picker for all items on an actor.
 */
function batchSetIcons(actor) {
  const items = actor.items.contents;
  if (!items.length) {
    ui.notifications.warn("No items found on this actor.");
    return;
  }

  let index = 0;
  function processNext() {
    if (index >= items.length) {
      ui.notifications.info("Smart Icons | Finished setting icons.");
      return;
    }
    openIconPicker(items[index++], processNext, true);
  }
  if (items.length > 0) processNext();
  else ui.notifications.warn("No items found for this actor.");
}

/**
 * Calculates a relevance score between a set of search terms and a set of keywords.
 */
function calculateScore(searchTerms, keywords) {
  let score = 0;
  for (const term of searchTerms) {
    for (const keyword of keywords) {
      if (term === keyword) {
        score += SCORING.DIRECT;
      } else if (keyword.includes(term) || term.includes(keyword)) {
        score += SCORING.PARTIAL;
      } else {
        const maxDist = Math.max(
          SCORING.FUZZY_THRESHOLD,
          Math.ceil(term.length * SCORING.FUZZY_RATIO)
        );
        if (levenshtein(term, keyword) <= maxDist) score += SCORING.FUZZY;
      }
    }
  }
  return score;
}

/**
 * Searches the pre-computed index to find the best matching icons for an item.
 */
function findBestMatchingIcons(searchTerms, currentImg) {
  const scores = new Map();

  // Score file icons from the index.
  for (const [path, keywords] of Object.entries(SMART_ICONS.iconKeywords)) {
    const score = calculateScore(searchTerms, keywords);
    if (score > 0) scores.set(path, score);
  }

  // Score compendium items from the index
  for (const { keywords, img } of Object.values(SMART_ICONS.compendiumKeywords)) {
    const baseScore = calculateScore(searchTerms, keywords);
    if (baseScore > 0) {
      let directHits = 0;
      for (const term of searchTerms) {
        for (const kw of keywords) {
          if (term === kw) { directHits++; break; }
        }
      }
      const bonus = COMPENDIUM_SCORING.BONUS * (directHits / searchTerms.size);
      const finalScore = baseScore + bonus;
      scores.set(img, (scores.get(img) || 0) + finalScore);
    }
  }

  const sorted = [...scores.entries()]
    .filter(([, score]) => score >= SMART_ICONS.minScoreThreshold)
    .sort((a, b) => b[1] - a[1])
    .map(([path]) => path);
  const unique = [...new Set(sorted)];

  // Logic to ensure the item's current image is always the first result for usability
  if (currentImg) {
    const idx = unique.indexOf(currentImg);
    if (idx > 0) unique.splice(idx, 1);
    if (idx !== 0) unique.unshift(currentImg);
  }

  return unique.slice(0, 30);
}

/**
 * Computes the Levenshtein distance between two strings.
 */
function levenshtein(a, b) {
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const rows = b.length + 1;
  const cols = a.length + 1;
  const matrix = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[b.length][a.length];
}