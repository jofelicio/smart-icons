# Smart Icons
### Description
This module allows GMs to intelligently assign icons to items and actors based on their names. By scanning the icons directory and compendium entries, it intelligently matches assets using a weighted scoring system, considering direct, partial, and fuzzy matches. The module adds a button to the item sheet for manual selection of the matched icons, and a button to the actor sheet that does batch processing for all the items of that actor.

### 📜Features
- Automatic Icon Matching: Finds the most relevant icons based on item and actor names.
- Compendium Integration: Searches compendiums for matching icons when available.
- Configurable Scoring System: Customize scoring weights in the config file to fine-tune matching accuracy. 
- Manual Selection: Easily choose icons through a visually interactive picker.
- Batch Processing: Option to quickly assign icons to all items in an actor’s inventory.

### 🛠️ Installation
1. Open FoundryVTT, go to **Add-on Modules**.
2. Click `Install Module`.
3. Paste the manifest URL:
   https://github.com/jofelicio/smart-icons/releases/latest/download/module.json
5. Click Install & Enable the module in **Game Settings**.

### 📝To Do
- Add in-game settings for adjusting scoring weights.
- Find a way to compare semantic similarity of words when scoring (This is possible, but made the module consume too many resources. Will try to find an efficient way to implement this).
