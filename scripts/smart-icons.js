import { SMART_ICONS, STOP_WORDS, SCORING, COMPENDIUM_SCORING } from "./config.js";

Hooks.once("init", async function () {
    console.log("Initializing Smart Icons...");
    try {
        await preloadIcons();
        SMART_ICONS.ready = true;
        console.log("Smart Icons initialized");
    } catch (error) {
        console.error("Initialization failed:", error);
        SMART_ICONS.ready = false;
    }
});
// Button for individual item sheets (For individual icon assignment).
Hooks.on("getItemSheetHeaderButtons", (app, buttons) => {
    if (!game.user.isGM) return; // Restrict to GMs only

    buttons.unshift({
        label: "Smart Icons",
        class: "custom-header-button",
        icon: "fas fa-images",
        onclick: () => {
            if (!SMART_ICONS.ready) {
                ui.notifications.error("Smart Icons are still initializing. Please try again.");
                return;
            }
            openIconPicker(app.document);
        }
    });
});

// Button for Acto sheets (For batch icon assignment).
Hooks.on("getActorSheetHeaderButtons", (app, buttons) => {
    if (!game.user.isGM) return; // Restrict to GMs only

    buttons.unshift({
        label: "Smart Icons",
        class: "custom-header-button",
        icon: "fas fa-images",
        onclick: () => {
            if (!SMART_ICONS.ready) {
                ui.notifications.error("Smart Icons are still initializing. Please try again.");
                return;
            }
            batchSetIcons(app.document);
        }
    });
});

//Scan content of the icons directory and populate SMART_ICONS with keywords for each file name..
async function preloadIcons() {
    const basePath = "icons";
    const ignoredPaths = new Set(["icons/svg", "icons/dice", "icons/pings"]);

    async function scanDirectory(path, isBaseLevel = false) {
        const files = await FilePicker.browse("public", path);
        if (ignoredPaths.has(path)) return; 

        if (!isBaseLevel) {
            files.files.forEach(file => {
                const filename = file.split("/").pop().toLowerCase();
                const cleanName = filename.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ").trim();
                const keywords = cleanName.split(/\s+/).filter(word => !STOP_WORDS.has(word));
                SMART_ICONS.iconKeywords[file] = keywords;
            });
        }

        await Promise.all(files.dirs.map(dir => scanDirectory(dir)));
    }

    try {
        await scanDirectory(basePath, true);
    } catch (error) {
        console.error("Icon preloading failed:", error);
    }
}

//Open a dialog allowing the user to select an icon for a given item.
async function openIconPicker(item, onConfirm, isBatch = false) {
    const matchedIcons = await findBestMatchingIcons(item.name);
    let selectedIcon = item.img;

    const iconHTML = matchedIcons
        .map(icon => `
            <img src="${icon}" class="icon-option ${icon === selectedIcon ? "icon-selected" : ""}" 
                 data-src="${icon}" style="width: 50px; height: 50px; cursor: pointer;">
        `)
        .join("");

    const buttons = {
        select: {
            label: "Confirm",
            callback: () => {
                item.update({ img: selectedIcon });
                if (onConfirm) onConfirm();
            }
        },
        cancel: {
            label: "Cancel"
        }
    };

    // Add skip button only if in batch mode
    if (isBatch) {
        buttons.skip = {
            label: "Skip",
            callback: () => {
                if (onConfirm) onConfirm();
            }
        };
    }

    new Dialog({
        title: `Select Icon for ${item.name}`,
        content: `
            <style>
                .icon-grid { display: flex; flex-wrap: wrap; gap: 5px; max-height: 300px; overflow-y: auto; padding: 5px; }
                .icon-option { border: 2px solid transparent; transition: border 0.2s ease-in-out; }
                .icon-option:hover { border: 2px solid #ff0000; }
                .icon-selected { border: 3px solid #00ff00; box-shadow: 0 0 5px #00ff00; }
            </style>
            <div class="icon-grid">${iconHTML}</div>
        `,
        buttons,
        default: "select",
        render: (html) => {
            html.find(".icon-option").click(function () {
                html.find(".icon-option").removeClass("icon-selected");
                $(this).addClass("icon-selected");
                selectedIcon = $(this).data("src");
            });
        }
    }).render(true);
}


//Sequentially process all items in an actor, opening the icon picker for each.
async function batchSetIcons(actor) {
    const items = actor.items.contents;
    let index = 0;

    async function processNext() {
        if (index >= items.length) {
            ui.notifications.info("Finished setting icons.");
            return;
        }
        const item = items[index++];
        openIconPicker(item, processNext, processNext);
    }

    if (items.length > 0) {
        processNext();
    } else {
        ui.notifications.warn("No items found for this actor.");
    }
}


/**
 * Finds the best matching icons based on the item's name.
 * It first checks compendium entries, then scans the preloaded icon names.
 */
async function findBestMatchingIcons(itemName) {
    const searchTerms = itemName.toLowerCase()
        .replace(/[-_\.]/g, " ")
        .split(/\s+/)
        .filter(word => word && !STOP_WORDS.has(word));

    const scores = [];
   
    // Include compendium matches
    const compendiumIcons = await findCompendiumIcon(itemName);
    if (compendiumIcons) {
        compendiumIcons.forEach(icon => {
            if (typeof icon.path === "string") {
                scores.push({ path: icon.path, score: icon.score });
            } else {
                console.error("Invalid compendium entry format:", icon);
            }
        });
    }

    // Score each icon
    for (const [path, keywords] of Object.entries(SMART_ICONS.iconKeywords)) {
        let score = 0;

        for (const term of searchTerms) {
            for (const keyword of keywords) {
                if (term === keyword) {
                    score += SCORING.DIRECT;
                } else if (keyword.includes(term) || term.includes(keyword)) {
                    score += SCORING.PARTIAL;
                } else {
                    const distance = levenshtein(term, keyword);
                    const dynamicThreshold = Math.max(SCORING.FUZZY_THRESHOLD, Math.ceil(term.length * SCORING.FUZZY_RATIO));

                    if (distance <= dynamicThreshold) {
                        score += SCORING.FUZZY;
                    }
                }
            }
        }

        scores.push({ path, score });
    }

    const sortedResults = scores
        .filter(entry => entry.score >= SMART_ICONS.minScoreThreshold)
        .sort((a, b) => b.score - a.score);

    return sortedResults.slice(0, 30).map(entry => entry.path);
}


//Searches compendium packs for items that closely match the given name.
async function findCompendiumIcon(itemName) {
    const matchedIcons = [];
    const itemNameLower = itemName.toLowerCase();

    for (const pack of game.packs) {
        if (pack.documentName !== "Item") continue;

        const index = await pack.getIndex();
        const scoredEntries = [];

        for (const entry of index) {
            const entryName = entry.name.toLowerCase();

            const exactMatch = entryName === itemNameLower;
            const partialMatch = entryName.includes(itemNameLower) || itemNameLower.includes(entryName);
            const fuzzyScore = Math.max(0, COMPENDIUM_SCORING.BASE - levenshtein(entryName, itemNameLower));

            const score = exactMatch
                ? COMPENDIUM_SCORING.EXACT
                : partialMatch
                    ? COMPENDIUM_SCORING.PARTIAL
                    : fuzzyScore;

            if (score >= COMPENDIUM_SCORING.MIN) {
                scoredEntries.push({ entry, score });
            }
        }

        // Sort and select top matches from this pack.
        scoredEntries.sort((a, b) => b.score - a.score);
        const bestMatches = scoredEntries.slice(0, 3);

        for (const match of bestMatches) {
            const item = await pack.getDocument(match.entry._id);
            if (item.img) {
                matchedIcons.push({ path: item.img, score: match.score });
            }
        }
    }

    return matchedIcons.length > 0 ? matchedIcons : null;
}

/**
 * Computes the Levenshtein distance between two strings.
 * Based on this code excerpt by AmitDiwan: https://www.tutorialspoint.com/levenshtein-distance-in-javascript
 */
function levenshtein(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix = [];

    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
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