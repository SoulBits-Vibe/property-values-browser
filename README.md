# Property Values Browser

![Obsidian plugin](https://img.shields.io/badge/Obsidian-plugin-7c3aed)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)

Property Values Browser is a small Obsidian plugin that adds a right-sidebar view for browsing frontmatter properties by value.

It is meant to feel like Obsidian's built-in All Properties panel, with one extra action: expand a property to see the distinct values used across the vault. Clicking a value opens Obsidian Search for that exact property/value pair, and right-click menus can delete properties or values from notes.

![Property Values Browser in Obsidian](docs/property-values-browser-screenshot.jpg)

## Features

- Shows frontmatter property names with total counts.
- Expands each property to show distinct values with counts.
- Counts list values separately, whether YAML is inline or multiline.
- Shows blank/null values as `(empty)`.
- Filters property names and values from the top input.
- Clicks property counts to search for every note with that property.
- Clicks value rows to search for notes with that exact property/value pair.
- Right-clicks property rows to delete that property from matching notes.
- Right-clicks value rows to delete that value from matching notes.
- Adds a ribbon icon and command palette command.
- Includes a manual refresh button.

## Manual install

Download `property-values-browser-0.2.0.zip` from a release and extract it into:

```text
<your vault>/.obsidian/plugins/property-values-browser/
```

The folder should contain:

```text
main.js
manifest.json
styles.css
```

Then reload Obsidian and enable **Property Values Browser** in Community plugins.

## Limitations

- Delete actions update frontmatter in matching notes after confirmation, but the plugin does not provide its own undo history.
- The list is based on Obsidian's metadata cache, so very recent file changes may need a refresh.

## Install from source

From this folder:

```powershell
npm install
npm run build
$env:OBSIDIAN_PLUGIN_DIR = "<your vault>/.obsidian/plugins/property-values-browser"
npm run install-plugin
```

Then reload Obsidian and enable **Property Values Browser** in Community plugins.
