export const SMART_ICONS = {
    iconKeywords: {},
    ready: false,
    minScoreThreshold: 15,
};

//Dev Note: Feel free to add more stop words or modify the scoring values. 
export const STOP_WORDS = new Set(["of", "the", "and", "a", "to", "in"]);

// Scoring values for icon paths matches.
export const SCORING = {
    DIRECT: 25,           // Exact word match
    PARTIAL: 15,           // Substring match
    FUZZY: 5,             // Fuzzy match via Levenshtein distance
    FUZZY_THRESHOLD: 2,   // Maximum Levenshtein distance for fuzzy matching
    FUZZY_RATIO: 0.3      // Maximum allowed ratio (distance/word length)
};

// Scoring values for compendium icon matches.
export const COMPENDIUM_SCORING = {
    EXACT: 30,     // Exact name match
    PARTIAL: 20,   // Partial name match
    BASE: 20,      // Base fuzzy score before adjustment
    MIN: 15       // Minimum score for an entry to be considered
};

