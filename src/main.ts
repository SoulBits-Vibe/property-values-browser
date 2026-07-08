import {
  App,
  ButtonComponent,
  ItemView,
  Menu,
  Modal,
  Notice,
  Plugin,
  TFile,
  WorkspaceLeaf,
  setIcon
} from "obsidian";

const VIEW_TYPE_PROPERTY_VALUES = "property-values-browser";
const EMPTY_VALUE = "__PROPERTY_VALUES_BROWSER_EMPTY__";

type ValueStats = Map<string, number>;

interface MetadataTypeWidget {
  icon?: string;
}

interface MetadataTypeManager {
  getAllProperties?: () => Record<string, { name: string; widget: string }>;
  getWidget?: (widget: string) => MetadataTypeWidget;
}

interface PropertyStats {
  name: string;
  count: number;
  values: ValueStats;
}

interface RenderedProperty {
  name: string;
  count: number;
  icon: string;
  values: Array<[string, number]>;
}

interface VisibleProperty extends RenderedProperty {
  matchedValues: Array<[string, number]>;
  forceExpanded: boolean;
}

export default class PropertyValuesBrowserPlugin extends Plugin {
  private refreshTimer: number | null = null;

  async onload() {
    this.registerView(
      VIEW_TYPE_PROPERTY_VALUES,
      (leaf) => new PropertyValuesBrowserView(leaf, this)
    );

    this.addRibbonIcon("list-tree", "Open Property Values Browser", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-property-values-browser",
      name: "Open Property Values Browser",
      callback: () => this.activateView()
    });

    this.registerEvent(
      this.app.metadataCache.on("changed", () => {
        this.scheduleRefresh();
      })
    );
  }

  onunload() {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_PROPERTY_VALUES);
  }

  async activateView() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_PROPERTY_VALUES);
    const leaf = leaves[0] ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) {
      new Notice("Could not open Property Values Browser.");
      return;
    }

    await leaf.setViewState({
      type: VIEW_TYPE_PROPERTY_VALUES,
      active: true
    });

    this.app.workspace.revealLeaf(leaf);
  }

  private scheduleRefresh() {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
    }

    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_PROPERTY_VALUES)) {
        const view = leaf.view;
        if (view instanceof PropertyValuesBrowserView) {
          view.rebuildAndRender();
        }
      }
    }, 500);
  }
}

class PropertyValuesBrowserView extends ItemView {
  private readonly plugin: PropertyValuesBrowserPlugin;
  private expanded = new Set<string>();
  private filterText = "";
  private stats: RenderedProperty[] = [];
  private listEl!: HTMLElement;
  private filterEl!: HTMLInputElement;

  constructor(leaf: WorkspaceLeaf, plugin: PropertyValuesBrowserPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_PROPERTY_VALUES;
  }

  getDisplayText() {
    return "Property Values";
  }

  getIcon() {
    return "list-tree";
  }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("property-values-browser");

    const headerEl = container.createDiv("property-values-browser__header");
    this.filterEl = headerEl.createEl("input", {
      cls: "property-values-browser__filter",
      attr: {
        type: "search",
        placeholder: "Filter properties and values"
      }
    });

    this.filterEl.addEventListener("input", () => {
      this.filterText = this.filterEl.value.trim().toLowerCase();
      this.render();
    });

    const refreshButton = headerEl.createEl("button", {
      cls: "clickable-icon property-values-browser__refresh",
      attr: {
        "aria-label": "Refresh property values"
      }
    });
    setIcon(refreshButton, "refresh-cw");
    refreshButton.addEventListener("click", () => this.rebuildAndRender(true));

    this.listEl = container.createDiv("property-values-browser__list");
    this.rebuildAndRender();
  }

  async onClose() {
    this.containerEl.children[1].empty();
  }

  rebuildAndRender(showNotice = false) {
    this.stats = collectPropertyStats(this.app);
    this.render();

    if (showNotice) {
      new Notice("Property values refreshed");
    }
  }

  private render() {
    this.listEl.empty();

    const visibleStats = this.getVisibleStats();

    if (visibleStats.length === 0) {
      this.listEl.createDiv({
        cls: "property-values-browser__empty",
        text: this.filterText ? "No matching properties." : "No frontmatter properties found."
      });
      return;
    }

    for (const property of visibleStats) {
      this.renderProperty(property);
    }
  }

  private getVisibleStats(): VisibleProperty[] {
    if (!this.filterText) {
      return this.stats.map((property) => ({
        ...property,
        matchedValues: property.values,
        forceExpanded: false
      }));
    }

    return this.stats
      .map((property) => {
        const propertyMatches = property.name.toLowerCase().includes(this.filterText);
        const matchedValues = property.values.filter(([value]) =>
          getValueLabel(value).toLowerCase().includes(this.filterText)
        );

        if (!propertyMatches && matchedValues.length === 0) {
          return null;
        }

        return {
          ...property,
          matchedValues: propertyMatches ? property.values : matchedValues,
          forceExpanded: matchedValues.length > 0
        };
      })
      .filter((property): property is VisibleProperty => property !== null);
  }

  private renderProperty(property: VisibleProperty) {
    const isExpanded = property.forceExpanded || this.expanded.has(property.name);
    const row = this.listEl.createDiv("property-values-browser__property-row");
    row.setAttr("title", property.name);

    const chevron = row.createDiv("property-values-browser__chevron");
    setIcon(chevron, isExpanded ? "chevron-down" : "chevron-right");

    const iconEl = row.createDiv("property-values-browser__type-icon");
    setIcon(iconEl, property.icon);

    row.createDiv({
      cls: "property-values-browser__property-name",
      text: property.name
    });

    const countEl = row.createDiv({
      cls: "property-values-browser__count",
      text: String(property.count)
    });
    countEl.setAttr("title", `Search notes with ${property.name}`);
    countEl.addEventListener("click", async (event) => {
      event.stopPropagation();
      await this.openSearch(property.name);
    });

    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.showPropertyMenu(event, property);
    });

    row.addEventListener("click", () => {
      if (property.forceExpanded) return;

      if (isExpanded) {
        this.expanded.delete(property.name);
      } else {
        this.expanded.add(property.name);
      }
      this.render();
    });

    if (!isExpanded) return;

    for (const [value, count] of property.matchedValues) {
      this.renderValue(property.name, value, count);
    }
  }

  private showPropertyMenu(event: MouseEvent, property: VisibleProperty) {
    const menu = new Menu();
    menu.addItem((item) => {
      item
        .setTitle("Delete property")
        .setIcon("trash")
        .setWarning(true)
        .onClick(() => {
          new DeletePropertyModal(this.app, property.name, property.count, async () => {
            await this.deleteProperty(property.name);
          }).open();
        });
    });
    menu.showAtMouseEvent(event);
  }

  private async deleteProperty(propertyName: string) {
    const files = getFilesWithProperty(this.app, propertyName);
    if (files.length === 0) {
      new Notice(`No notes found with ${propertyName}.`);
      this.rebuildAndRender();
      return;
    }

    let deletedCount = 0;
    for (const file of files) {
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        if (Object.prototype.hasOwnProperty.call(frontmatter, propertyName)) {
          delete frontmatter[propertyName];
          deletedCount += 1;
        }
      });
    }

    this.expanded.delete(propertyName);
    this.rebuildAndRender();
    new Notice(`Deleted ${propertyName} from ${deletedCount} ${deletedCount === 1 ? "note" : "notes"}.`);
  }

  private renderValue(propertyName: string, value: string, count: number) {
    const isEmpty = value === EMPTY_VALUE;
    const label = getValueLabel(value);
    const row = this.listEl.createDiv("property-values-browser__value-row");
    row.setAttr("title", `${propertyName}: ${label}`);

    row.createDiv("property-values-browser__value-spacer");

    row.createDiv({
      cls: `property-values-browser__value-name${isEmpty ? " is-empty" : ""}`,
      text: label
    });

    row.createDiv({
      cls: "property-values-browser__count",
      text: String(count)
    });

    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.showValueMenu(event, propertyName, value, label, count);
    });

    row.addEventListener("click", async (event) => {
      event.stopPropagation();
      await this.openSearch(propertyName, value);
    });
  }

  private showValueMenu(event: MouseEvent, propertyName: string, value: string, label: string, count: number) {
    const menu = new Menu();
    menu.addItem((item) => {
      item
        .setTitle("Delete value")
        .setIcon("trash")
        .setWarning(true)
        .onClick(() => {
          new DeleteValueModal(this.app, propertyName, label, count, async () => {
            await this.deleteValue(propertyName, value, label);
          }).open();
        });
    });
    menu.showAtMouseEvent(event);
  }

  private async deleteValue(propertyName: string, value: string, label: string) {
    const files = getFilesWithPropertyValue(this.app, propertyName, value);
    if (files.length === 0) {
      new Notice(`No notes found with ${propertyName}: ${label}.`);
      this.rebuildAndRender();
      return;
    }

    let deletedCount = 0;
    for (const file of files) {
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        if (!Object.prototype.hasOwnProperty.call(frontmatter, propertyName)) return;

        const result = removeValueFromProperty(frontmatter[propertyName], value);
        if (!result.changed) return;

        if (result.shouldDeleteProperty) {
          delete frontmatter[propertyName];
        } else {
          frontmatter[propertyName] = result.value;
        }
        deletedCount += 1;
      });
    }

    this.rebuildAndRender();
    new Notice(`Deleted ${label} from ${deletedCount} ${deletedCount === 1 ? "note" : "notes"}.`);
  }

  private async openSearch(propertyName: string, value?: string) {
    const query = value === undefined
      ? buildPropertyExistsSearchQuery(propertyName)
      : buildPropertySearchQuery(propertyName, value);
    let searchLeaf: WorkspaceLeaf | null = this.app.workspace.getLeavesOfType("search")[0] ?? null;

    if (!searchLeaf) {
      searchLeaf = this.app.workspace.getRightLeaf(false);
      if (!searchLeaf) {
        await navigator.clipboard.writeText(query);
        new Notice(`Search query copied: ${query}`);
        return;
      }
      await searchLeaf.setViewState({ type: "search", active: true });
    }

    const searchView = searchLeaf.view as { setQuery?: (query: string) => void };
    if (typeof searchView.setQuery === "function") {
      searchView.setQuery(query);
      this.app.workspace.revealLeaf(searchLeaf);
    } else {
      await navigator.clipboard.writeText(query);
      new Notice(`Search query copied: ${query}`);
    }
  }
}

class DeletePropertyModal extends Modal {
  private readonly propertyName: string;
  private readonly noteCount: number;
  private readonly onConfirm: () => Promise<void>;

  constructor(app: App, propertyName: string, noteCount: number, onConfirm: () => Promise<void>) {
    super(app);
    this.propertyName = propertyName;
    this.noteCount = noteCount;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    this.setTitle("Delete property");
    this.contentEl.empty();

    this.contentEl.createEl("p", {
      text: `Delete property "${this.propertyName}"?`
    });
    this.contentEl.createEl("p", {
      cls: "property-values-browser__modal-warning",
      text: `This removes the property from ${this.noteCount} ${this.noteCount === 1 ? "note" : "notes"}. Note contents are not deleted.`
    });

    const buttonRow = this.contentEl.createDiv("property-values-browser__modal-buttons");
    new ButtonComponent(buttonRow)
      .setButtonText("Cancel")
      .onClick(() => this.close());

    new ButtonComponent(buttonRow)
      .setButtonText("Delete property")
      .setWarning()
      .onClick(async () => {
        this.close();
        await this.onConfirm();
      });
  }
}

class DeleteValueModal extends Modal {
  private readonly propertyName: string;
  private readonly valueLabel: string;
  private readonly noteCount: number;
  private readonly onConfirm: () => Promise<void>;

  constructor(app: App, propertyName: string, valueLabel: string, noteCount: number, onConfirm: () => Promise<void>) {
    super(app);
    this.propertyName = propertyName;
    this.valueLabel = valueLabel;
    this.noteCount = noteCount;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    this.setTitle("Delete value");
    this.contentEl.empty();

    this.contentEl.createEl("p", {
      text: `Delete value "${this.valueLabel}" from "${this.propertyName}"?`
    });
    this.contentEl.createEl("p", {
      cls: "property-values-browser__modal-warning",
      text: `This removes the value from ${this.noteCount} ${this.noteCount === 1 ? "note" : "notes"}. If it is the only value, the property is removed from that note.`
    });

    const buttonRow = this.contentEl.createDiv("property-values-browser__modal-buttons");
    new ButtonComponent(buttonRow)
      .setButtonText("Cancel")
      .onClick(() => this.close());

    new ButtonComponent(buttonRow)
      .setButtonText("Delete value")
      .setWarning()
      .onClick(async () => {
        this.close();
        await this.onConfirm();
      });
  }
}

function collectPropertyStats(app: App): RenderedProperty[] {
  const properties = new Map<string, PropertyStats>();

  for (const file of app.vault.getMarkdownFiles()) {
    addFileFrontmatter(properties, file, app);
  }

  return Array.from(properties.values())
    .map((property) => ({
      name: property.name,
      count: property.count,
      icon: getPropertyIcon(app, property.name),
      values: Array.from(property.values.entries()).sort(sortValueEntries)
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function getFilesWithProperty(app: App, propertyName: string): TFile[] {
  return app.vault.getMarkdownFiles().filter((file) => {
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
    return !!frontmatter && Object.prototype.hasOwnProperty.call(frontmatter, propertyName);
  });
}

function getFilesWithPropertyValue(app: App, propertyName: string, value: string): TFile[] {
  return app.vault.getMarkdownFiles().filter((file) => {
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
    if (!frontmatter || !Object.prototype.hasOwnProperty.call(frontmatter, propertyName)) {
      return false;
    }

    return normalizeValues(frontmatter[propertyName]).includes(value);
  });
}

function removeValueFromProperty(rawValue: unknown, valueToDelete: string): {
  changed: boolean;
  shouldDeleteProperty: boolean;
  value?: unknown;
} {
  if (rawValue === null || rawValue === undefined || rawValue === "") {
    return {
      changed: valueToDelete === EMPTY_VALUE,
      shouldDeleteProperty: valueToDelete === EMPTY_VALUE
    };
  }

  if (!Array.isArray(rawValue)) {
    return {
      changed: String(rawValue) === valueToDelete,
      shouldDeleteProperty: String(rawValue) === valueToDelete
    };
  }

  if (rawValue.length === 0) {
    return {
      changed: valueToDelete === EMPTY_VALUE,
      shouldDeleteProperty: valueToDelete === EMPTY_VALUE
    };
  }

  let changed = false;
  const nextValue: unknown[] = [];
  for (const item of rawValue) {
    if (Array.isArray(item)) {
      const result = removeValueFromProperty(item, valueToDelete);
      if (result.changed) {
        changed = true;
      }
      if (!result.shouldDeleteProperty) {
        nextValue.push(result.value);
      }
    } else if (normalizeValues(item).includes(valueToDelete)) {
      changed = true;
    } else {
      nextValue.push(item);
    }
  }

  return {
    changed,
    shouldDeleteProperty: changed && nextValue.length === 0,
    value: nextValue
  };
}

function addFileFrontmatter(properties: Map<string, PropertyStats>, file: TFile, app: App) {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!frontmatter) return;

  for (const [name, rawValue] of Object.entries(frontmatter)) {
    if (name === "position") continue;

    const property = getOrCreateProperty(properties, name);
    property.count += 1;

    for (const value of normalizeValues(rawValue)) {
      property.values.set(value, (property.values.get(value) ?? 0) + 1);
    }
  }
}

function getOrCreateProperty(properties: Map<string, PropertyStats>, name: string) {
  let property = properties.get(name);
  if (!property) {
    property = {
      name,
      count: 0,
      values: new Map()
    };
    properties.set(name, property);
  }
  return property;
}

function normalizeValues(value: unknown): string[] {
  if (value === null || value === undefined || value === "") {
    return [EMPTY_VALUE];
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [EMPTY_VALUE];
    }

    return value.flatMap((item) => normalizeValues(item));
  }

  return [String(value)];
}

function sortValueEntries(a: [string, number], b: [string, number]) {
  if (a[0] === EMPTY_VALUE && b[0] !== EMPTY_VALUE) return -1;
  if (b[0] === EMPTY_VALUE && a[0] !== EMPTY_VALUE) return 1;
  return b[1] - a[1] || a[0].localeCompare(b[0]);
}

function getValueLabel(value: string) {
  return value === EMPTY_VALUE ? "(empty)" : value;
}

function getPropertyIcon(app: App, propertyName: string) {
  const typeManager = (app as App & { metadataTypeManager?: MetadataTypeManager }).metadataTypeManager;
  const properties = typeManager?.getAllProperties?.();
  const propertyInfo = properties?.[propertyName.toLowerCase()];
  const icon = propertyInfo?.widget
    ? typeManager?.getWidget?.(propertyInfo.widget)?.icon
    : null;

  return icon ?? "lucide-text";
}

function buildPropertyExistsSearchQuery(propertyName: string) {
  return `[${quoteSearchPart(propertyName)}]`;
}

function buildPropertySearchQuery(propertyName: string, value: string) {
  if (value === EMPTY_VALUE) {
    return `[${quoteSearchPart(propertyName)}:null]`;
  }

  return `[${quoteSearchPart(propertyName)}:${quoteSearchPart(value)}]`;
}

function quoteSearchPart(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
