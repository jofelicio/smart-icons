import {
  SMART_ICONS,
  STOP_WORDS,
  SCORING,
  COMPENDIUM_SCORING,
} from "./config.js";

const FilePickerV1 = foundry.applications.apps.FilePicker.implementation;

/**
 * A set of regular expressions to ignore common directories that do not contain icons.
 * This prevents the scanner from wasting time in node_modules, language files, packs, etc.
 */
const IGNORED_DIRS = new Set([
  /(modules|systems)\/.+\/node_modules/,
  /(modules|systems)\/.+\/lang/,
  /(modules|systems)\/.+\/packs/,
  /(modules|systems)\/.+\/src/,
  /(modules|systems)\/.+\/templates/,
]);
const KEYWORD_MIN_LENGTH = 3;

/**
 * Attaches the Smart Icons button to the header of relevant application windows.
 */
function attachHeaderButton(app, buttons) {
  if (!game.user.isGM || !app.document) return;

  const docName = app.document.documentName;
  if (docName !== "Actor" && docName !== "Item") return;

  const activateSmartIcons = (ev) => {
    try {
      if (!SMART_ICONS.ready) {
        ui.notifications.warn(
          "Smart Icons are still initializing. Please try again."
        );
        return;
      }

      if (app.document.documentName === "Item") {
        openIconPicker(app.document);
      } else if (app.document.documentName === "Actor") {
        batchSetIcons(app.document);
      }
    } catch (err) {
      console.error("Smart Icons | Error during button click activation:", err);
      ui.notifications.error(
        "An error occurred. See the console (F12) for details."
      );
    }
  };

  const buttonConfig = {
    label: "Smart Icons",
    title:
      docName === "Item"
        ? "Assign a smart icon to this item"
        : "Batch assign smart icons to all items",
    class: "smart-icons-button",
    icon: "fas fa-images",
    onclick: activateSmartIcons,
    onClick: activateSmartIcons,
  };

  buttons.unshift(buttonConfig);
}

Hooks.once("init", async function () {
  console.log("Initializing Smart Icons...");

  const watchedHooks = ["ActorSheet", "ItemSheet"];
  watchedHooks.forEach((hook) => {
    Hooks.on(`get${hook}HeaderButtons`, attachHeaderButton);
  });
  Hooks.on("getHeaderControlsApplicationV2", attachHeaderButton);
});

Hooks.once("ready", () => {
  if (!game.user.isGM) return;

  // Run the expensive indexing in a non-blocking way to prevent UI freeze on world load.
  setTimeout(async () => {
    console.log("Smart Icons | Starting background indexing...");
    SMART_ICONS.ready = false;
    try {
      await indexFileIcons();
      await indexCompendiumItems();

      SMART_ICONS.ready = true;
      console.log("Smart Icons | Indexing complete. Module is ready.");
    } catch (error) {
      console.error("Smart Icons | Indexing failed:", error);
      ui.notifications.error(
        "Smart Icons: Indexing failed. See console (F12) for details."
      );
      SMART_ICONS.ready = false;
    }
  }, 0); // setTimeout with 0ms delay yields the main thread, keeping the UI responsive.
});

/**
 * Creates a set of keywords from a file path or item name.
 * @param {string} name - File path or item name.
 * @param {object} [options={}] - Options object.
 * @param {boolean} [options.isItem=false] - Is this an item name instead of a file path?
 * @returns {Set<string>} A set of lowercase keywords.
 */
function keywordsFromName(name, { isItem = false } = {}) {
  let path = name;
  // If it's an item name, add a fake extension to trick the helper into working correctly.
  if (isItem) path = path + ".webp";

  const cleaned = foundry.audio.AudioHelper.getDefaultSoundName(
    path.split("/").pop()
  );
  return new Set(
    cleaned
      .split(" ")
      .map((word) => word.toLowerCase().trim())
      .filter(
        (word) => word.length >= KEYWORD_MIN_LENGTH && !STOP_WORDS.has(word)
      )
  );
}

/**
 * Indexes all relevant image files from the core, system, and module directories.
 */
async function indexFileIcons() {
  console.log("Smart Icons | Indexing file-based icons...");
  const extensions = new Set(Object.keys(CONST.FILE_CATEGORIES.IMAGE));
  SMART_ICONS.iconKeywords = {};

  const _indexDirectory = async (path, store = "public") => {
    if (IGNORED_DIRS.some((rgx) => rgx.test(path))) return;
    try {
      const content = await FilePickerV1.browse(store, path);
      for (const file of content.files) {
        if (extensions.has(file.split(".").pop())) {
          const keywords = keywordsFromName(file, { isItem: false });
          if (keywords.size > 0) SMART_ICONS.iconKeywords[file] = keywords;
        }
      }
      for (const dir of content.dirs) {
        await _indexDirectory(dir, store);
      }
    } catch (error) {
      /* Silently ignore unbrowsable directories */
    }
  };

  await _indexDirectory("icons");
  await _indexDirectory(`systems/${game.system.id}`, "data");
  await _indexDirectory("modules", "data");
  console.log(
    `Smart Icons | Indexed ${
      Object.keys(SMART_ICONS.iconKeywords).length
    } file icons.`
  );
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
      if (!entry.img || entry.img.includes("mystery-man")) continue;
      const keywords = keywordsFromName(entry.name, { isItem: true });
      if (keywords.size > 0) {
        SMART_ICONS.compendiumKeywords[entry.name] = {
          keywords,
          img: entry.img,
        };
      }
    }
  }
  console.log(
    `Smart Icons | Indexed ${
      Object.keys(SMART_ICONS.compendiumKeywords).length
    } compendium items.`
  );
}

/**
 * Opens the icon picker dialog for a given item.
 */
async function openIconPicker(item, onConfirm, isBatch = false) {
  const matchedIcons = await findBestMatchingIcons(item);
  console.log(
    `Smart Icons | Found ${matchedIcons.length} matches for item "${item.name}".`
  );
  let selectedIcon = item.img;
  const iconHTML = matchedIcons
    .map(
      (icon) =>
        `<img src="${icon}" class="icon-option ${
          icon === selectedIcon ? "icon-selected" : ""
        }" data-src="${icon}" style="width: 50px; height: 50px; cursor: pointer;">`
    )
    .join("");
  const buttons = {
    select: {
      label: "Confirm",
      callback: () => {
        item.update({ img: selectedIcon });
        if (onConfirm) onConfirm();
      },
    },
    cancel: { label: "Cancel" },
    ...(isBatch && {
      skip: {
        label: "Skip",
        callback: () => {
          if (onConfirm) onConfirm();
        },
      },
    }),
  };
  new Dialog({
    title: `Select Icon for ${item.name}`,
    content: `<style>.icon-grid { display: flex; flex-wrap: wrap; gap: 5px; max-height: 300px; overflow-y: auto; padding: 5px; }.icon-option { border: 2px solid transparent; }.icon-option:hover { border-color: #ff0000; }.icon-selected { border-color: #00ff00; box-shadow: 0 0 5px #00ff00; }</style><div class="icon-grid">${iconHTML}</div>`,
    buttons,
    default: "select",
    render: (html) => {
      html.find(".icon-option").click(function () {
        html.find(".icon-option").removeClass("icon-selected");
        $(this).addClass("icon-selected");
        selectedIcon = $(this).data("src");
      });
    },
  }).render(true);
}

/**
 * Sequentially opens the icon picker for all items on an actor.
 */
async function batchSetIcons(actor) {
  const items = actor.items.contents;
  let index = 0;
  async function processNext() {
    if (index >= items.length) {
      ui.notifications.info("Finished setting icons.");
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
      if (term === keyword) score += SCORING.DIRECT;
      else if (keyword.includes(term) || term.includes(keyword))
        score += SCORING.PARTIAL;
      else {
        const dist = levenshtein(term, keyword);
        if (
          dist <=
          Math.max(
            SCORING.FUZZY_THRESHOLD,
            Math.ceil(term.length * SCORING.FUZZY_RATIO)
          )
        ) {
          score += SCORING.FUZZY;
        }
      }
    }
  }
  return score;
}

/**
 * Searches the pre-computed index to find the best matching icons for an item.
 */
async function findBestMatchingIcons(item) {
  const itemName = item.name;
  const currentItemImg = item.img;
  const searchTerms = keywordsFromName(itemName, { isItem: true });
  const scores = new Map();

  // Score file icons from the index.
  for (const [path, keywords] of Object.entries(SMART_ICONS.iconKeywords)) {
    const score = calculateScore(searchTerms, keywords);
    if (score > 0) {
      scores.set(path, score);
    }
  }

  // Score compendium items from the index, boosting their relevance.
  for (const { keywords, img } of Object.values(
    SMART_ICONS.compendiumKeywords
  )) {
    const baseScore = calculateScore(searchTerms, keywords);
    if (baseScore > 0) {
      const finalScore = baseScore + COMPENDIUM_SCORING.EXACT; // Prioritize compendium matches.
      const existingScore = scores.get(img) || 0;
      scores.set(img, existingScore + finalScore);
    }
  }

  const sorted = [...scores.entries()]
    .filter(([path, score]) => score >= SMART_ICONS.minScoreThreshold)
    .sort((a, b) => b[1] - a[1]);

  let uniquePaths = [...new Set(sorted.map((entry) => entry[0]))];

  // Logic to ensure the item's current image is always the first result for usability.
  if (currentItemImg) {
    uniquePaths = uniquePaths.filter((p) => p !== currentItemImg);
    uniquePaths.unshift(currentItemImg);
  }

  return uniquePaths.slice(0, 30);
}

/**
 * Computes the Levenshtein distance between two strings.
 */
function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = Array(b.length + 1)
    .fill(null)
    .map(() => Array(a.length + 1).fill(null));
  for (let i = 0; i <= a.length; i += 1) matrix[0][i] = i;
  for (let i = 0; i <= b.length; i += 1) matrix[i][0] = i;
  for (let i = 1; i <= b.length; i += 1) {
    for (let j = 1; j <= a.length; j += 1) {
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
