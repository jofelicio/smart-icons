export const SMART_ICONS = {
    iconKeywords: {},
    compendiumKeywords: {},
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
    FUZZY_RATIO: 0.3,     // Maximum allowed ratio (distance/word length)
    KEYWORD_LENGTH: 3     // Minimum length of keywords to consider
};

// Scoring values for compendium icon matches.
export const COMPENDIUM_SCORING = {
    BONUS: 30,
};