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
type Frontmatter = Record<string, unknown>;

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

    this.addRibbonIcon("list-tree", "Open browser", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open",
      name: "Open browser",
      callback: () => {
        void this.activateView();
      }
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

    await this.app.workspace.revealLeaf(leaf);
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
    countEl.addEventListener("click", (event) => {
      event.stopPropagation();
      void this.openSearch(property.name);
    });

    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
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
    menu.setUseNativeMenu(false);
    menu.addItem((item) => {
      item
        .setTitle("Rename property")
        .setIcon("pencil")
        .onClick(() => {
          new RenamePropertyModal(this.app, property.name, async (newName) => {
            await this.renameProperty(property.name, newName);
          }).open();
        });
    });
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
      await this.app.fileManager.processFrontMatter(file, (frontmatter: Frontmatter) => {
        if (hasProperty(frontmatter, propertyName)) {
          delete frontmatter[propertyName];
          deletedCount += 1;
        }
      });
    }

    this.expanded.delete(propertyName);
    this.rebuildAndRender();
    new Notice(`Deleted ${propertyName} from ${deletedCount} ${deletedCount === 1 ? "note" : "notes"}.`);
  }

  private async renameProperty(propertyName: string, newName: string) {
    const files = getFilesWithProperty(this.app, propertyName);
    if (files.length === 0) {
      new Notice(`No notes found with ${propertyName}.`);
      this.rebuildAndRender();
      return;
    }

    let renamedCount = 0;
    for (const file of files) {
      await this.app.fileManager.processFrontMatter(file, (frontmatter: Frontmatter) => {
        if (renamePropertyKey(frontmatter, propertyName, newName)) {
          renamedCount += 1;
        }
      });
    }

    if (this.expanded.has(propertyName)) {
      this.expanded.delete(propertyName);
      this.expanded.add(newName);
    }

    this.rebuildAndRender();
    new Notice(`Renamed ${propertyName} to ${newName} in ${renamedCount} ${renamedCount === 1 ? "note" : "notes"}.`);
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
      event.stopPropagation();
      this.showValueMenu(event, propertyName, value, label, count);
    });

    row.addEventListener("click", (event) => {
      event.stopPropagation();
      void this.openSearch(propertyName, value);
    });
  }

  private showValueMenu(event: MouseEvent, propertyName: string, value: string, label: string, count: number) {
    const menu = new Menu();
    menu.setUseNativeMenu(false);
    menu.addItem((item) => {
      item
        .setTitle("Rename value")
        .setIcon("pencil")
        .onClick(() => {
          new RenameValueModal(this.app, propertyName, value, label, async (newValue) => {
            await this.renameValue(propertyName, value, label, newValue);
          }).open();
        });
    });
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
      await this.app.fileManager.processFrontMatter(file, (frontmatter: Frontmatter) => {
        if (!hasProperty(frontmatter, propertyName)) return;

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

  private async renameValue(propertyName: string, value: string, label: string, newValue: string) {
    const files = getFilesWithPropertyValue(this.app, propertyName, value);
    if (files.length === 0) {
      new Notice(`No notes found with ${propertyName}: ${label}.`);
      this.rebuildAndRender();
      return;
    }

    let renamedCount = 0;
    for (const file of files) {
      await this.app.fileManager.processFrontMatter(file, (frontmatter: Frontmatter) => {
        if (!hasProperty(frontmatter, propertyName)) return;

        const result = renameValueInProperty(frontmatter[propertyName], value, newValue);
        if (!result.changed) return;

        frontmatter[propertyName] = result.value;
        renamedCount += 1;
      });
    }

    this.rebuildAndRender();
    new Notice(`Renamed ${label} to ${newValue} in ${renamedCount} ${renamedCount === 1 ? "note" : "notes"}.`);
  }

  private async openSearch(propertyName: string, value?: string) {
    const query = value === undefined
      ? buildPropertyExistsSearchQuery(propertyName)
      : buildPropertySearchQuery(propertyName, value);

    try {
      if (isGlobalSearchDisabled(this.app)) {
        new Notice("Core Search plugin is disabled");
        return;
      }

      const leaf = await this.revealSearchLeaf(query);
      applySearchQuery(leaf, query);
    } catch (error) {
      const reason = error instanceof Error && error.message
        ? error.message
        : String(error);
      new Notice(`Could not open Search: ${reason}`);
    }
  }

  private async revealSearchLeaf(query: string): Promise<WorkspaceLeaf> {
    const workspace = this.app.workspace;

    if (typeof workspace.ensureSideLeaf === "function") {
      const leaf = await workspace.ensureSideLeaf("search", "left", {
        active: true,
        reveal: true,
        state: { query }
      });
      await workspace.revealLeaf(leaf);
      if (typeof leaf.loadIfDeferred === "function") {
        await leaf.loadIfDeferred();
      }
      return leaf;
    }

    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType("search")[0] ?? null;
    if (!leaf) {
      leaf = workspace.getLeftLeaf(false);
      if (!leaf) {
        throw new Error("Could not open the Search sidebar");
      }
      await leaf.setViewState({ type: "search", active: true });
    }

    await workspace.revealLeaf(leaf);
    if (typeof leaf.loadIfDeferred === "function") {
      await leaf.loadIfDeferred();
    }
    return leaf;
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

class RenameValueModal extends Modal {
  private readonly propertyName: string;
  private readonly currentValue: string;
  private readonly currentLabel: string;
  private readonly onConfirm: (newValue: string) => Promise<void>;
  private inputEl!: HTMLInputElement;
  private statusEl!: HTMLParagraphElement;
  private renameButton!: ButtonComponent;

  constructor(
    app: App,
    propertyName: string,
    currentValue: string,
    currentLabel: string,
    onConfirm: (newValue: string) => Promise<void>
  ) {
    super(app);
    this.propertyName = propertyName;
    this.currentValue = currentValue;
    this.currentLabel = currentLabel;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    this.setTitle("Rename value");
    this.contentEl.empty();

    this.contentEl.createEl("p", {
      text: `Rename value "${this.currentLabel}" in "${this.propertyName}"?`
    });

    this.inputEl = this.contentEl.createEl("input", {
      cls: "property-values-browser__rename-input",
      attr: {
        type: "text",
        placeholder: "New value",
        "aria-label": "New value"
      }
    });
    this.inputEl.value = this.currentValue === EMPTY_VALUE ? "" : this.currentValue;

    this.statusEl = this.contentEl.createEl("p", {
      cls: "property-values-browser__modal-warning"
    });

    const buttonRow = this.contentEl.createDiv("property-values-browser__modal-buttons");
    new ButtonComponent(buttonRow)
      .setButtonText("Cancel")
      .onClick(() => this.close());

    this.renameButton = new ButtonComponent(buttonRow)
      .setButtonText("Rename")
      .setCta()
      .onClick(() => {
        void this.submit();
      });

    this.inputEl.addEventListener("input", () => this.updateStatus());
    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void this.submit();
      }
    });

    this.updateStatus();
    window.setTimeout(() => {
      this.inputEl.focus();
      this.inputEl.select();
    }, 0);
  }

  private getTrimmedValue() {
    return this.inputEl.value.trim();
  }

  private isUnchanged(newValue: string) {
    if (newValue === "") {
      return true;
    }

    return this.currentValue !== EMPTY_VALUE && newValue === this.currentValue;
  }

  private updateStatus() {
    const newValue = this.getTrimmedValue();
    if (newValue === "") {
      this.statusEl.setText("Enter a new value.");
      this.renameButton.setDisabled(true);
      return;
    }

    if (this.isUnchanged(newValue)) {
      this.statusEl.setText("Enter a different value.");
      this.renameButton.setDisabled(true);
      return;
    }

    const sourceCount = getFilesWithPropertyValue(this.app, this.propertyName, this.currentValue).length;
    const targetCount = getFilesWithPropertyValue(this.app, this.propertyName, newValue).length;
    const sourceLabel = sourceCount === 1 ? "note" : "notes";

    if (targetCount > 0) {
      const targetLabel = targetCount === 1 ? "note" : "notes";
      this.statusEl.setText(
        `"${newValue}" already exists in ${targetCount} ${targetLabel}. This will merge them and update ${sourceCount} ${sourceLabel}. Lists that already have both will keep a single "${newValue}".`
      );
    } else {
      this.statusEl.setText(`This changes the value in ${sourceCount} ${sourceLabel}.`);
    }

    this.renameButton.setDisabled(false);
  }

  private async submit() {
    const newValue = this.getTrimmedValue();
    if (this.isUnchanged(newValue)) {
      return;
    }

    this.close();
    await this.onConfirm(newValue);
  }
}

class RenamePropertyModal extends Modal {
  private readonly propertyName: string;
  private readonly onConfirm: (newName: string) => Promise<void>;
  private inputEl!: HTMLInputElement;
  private statusEl!: HTMLParagraphElement;
  private renameButton!: ButtonComponent;

  constructor(app: App, propertyName: string, onConfirm: (newName: string) => Promise<void>) {
    super(app);
    this.propertyName = propertyName;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    this.setTitle("Rename property");
    this.contentEl.empty();

    this.contentEl.createEl("p", {
      text: `Rename property "${this.propertyName}"?`
    });

    this.inputEl = this.contentEl.createEl("input", {
      cls: "property-values-browser__rename-input",
      attr: {
        type: "text",
        placeholder: "New property name",
        "aria-label": "New property name"
      }
    });
    this.inputEl.value = this.propertyName;

    this.statusEl = this.contentEl.createEl("p", {
      cls: "property-values-browser__modal-warning"
    });

    const buttonRow = this.contentEl.createDiv("property-values-browser__modal-buttons");
    new ButtonComponent(buttonRow)
      .setButtonText("Cancel")
      .onClick(() => this.close());

    this.renameButton = new ButtonComponent(buttonRow)
      .setButtonText("Rename")
      .setCta()
      .onClick(() => {
        void this.submit();
      });

    this.inputEl.addEventListener("input", () => this.updateStatus());
    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void this.submit();
      }
    });

    this.updateStatus();
    window.setTimeout(() => {
      this.inputEl.focus();
      this.inputEl.select();
    }, 0);
  }

  private getTrimmedName() {
    return this.inputEl.value.trim();
  }

  private isUnchanged(newName: string) {
    return newName === "" || newName === this.propertyName;
  }

  private updateStatus() {
    const newName = this.getTrimmedName();
    if (newName === "") {
      this.statusEl.setText("Enter a new property name.");
      this.renameButton.setDisabled(true);
      return;
    }

    if (this.isUnchanged(newName)) {
      this.statusEl.setText("Enter a different property name.");
      this.renameButton.setDisabled(true);
      return;
    }

    const sourceCount = getFilesWithProperty(this.app, this.propertyName).length;
    const targetCount = getFilesWithProperty(this.app, newName).length;
    const sourceLabel = sourceCount === 1 ? "note" : "notes";

    if (targetCount > 0) {
      const targetLabel = targetCount === 1 ? "note" : "notes";
      this.statusEl.setText(
        `"${newName}" already exists in ${targetCount} ${targetLabel}. This will merge them and update ${sourceCount} ${sourceLabel}. Notes that already have both keys will keep one combined, de-duplicated list.`
      );
    } else {
      this.statusEl.setText(`This changes the property name in ${sourceCount} ${sourceLabel}.`);
    }

    this.renameButton.setDisabled(false);
  }

  private async submit() {
    const newName = this.getTrimmedName();
    if (this.isUnchanged(newName)) {
      return;
    }

    this.close();
    await this.onConfirm(newName);
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
    return !!frontmatter && hasProperty(frontmatter, propertyName);
  });
}

function renamePropertyKey(frontmatter: Frontmatter, oldName: string, newName: string) {
  if (!hasProperty(frontmatter, oldName) || oldName === newName) {
    return false;
  }

  const sourceValue = frontmatter[oldName];
  const mergedValue = hasProperty(frontmatter, newName)
    ? mergePropertyValues(frontmatter[newName], sourceValue)
    : sourceValue;

  const next: Frontmatter = {};
  let wroteNew = false;
  for (const key of Object.keys(frontmatter)) {
    if (key === oldName || key === newName) {
      if (!wroteNew) {
        next[newName] = mergedValue;
        wroteNew = true;
      }
      continue;
    }

    next[key] = frontmatter[key];
  }

  if (!wroteNew) {
    next[newName] = mergedValue;
  }

  for (const key of Object.keys(frontmatter)) {
    delete frontmatter[key];
  }
  for (const [key, value] of Object.entries(next)) {
    frontmatter[key] = value;
  }

  return true;
}

function mergePropertyValues(targetValue: unknown, sourceValue: unknown) {
  const targetItems = propertyValueItems(targetValue);
  const sourceItems = propertyValueItems(sourceValue);
  const targetWasList = Array.isArray(targetValue) && targetValue.length > 0;
  const sourceWasList = Array.isArray(sourceValue) && sourceValue.length > 0;

  const merged: unknown[] = [];
  const seen = new Set<string>();
  for (const item of [...targetItems, ...sourceItems]) {
    const key = propertyValueItemKey(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(item);
  }

  if (merged.length === 0) {
    return "";
  }

  if (merged.length === 1 && !targetWasList && !sourceWasList) {
    return merged[0];
  }

  return merged;
}

function propertyValueItems(value: unknown): unknown[] {
  if (isEmptyPropertyValue(value)) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.filter((item) => !isEmptyPropertyValue(item));
  }

  return [value];
}

function propertyValueItemKey(item: unknown) {
  if (Array.isArray(item)) {
    return JSON.stringify(item);
  }

  if (item === null || item === undefined || item === "") {
    return EMPTY_VALUE;
  }

  return String(item);
}

function isEmptyPropertyValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return true;
  }

  return Array.isArray(value) && value.length === 0;
}

function getFilesWithPropertyValue(app: App, propertyName: string, value: string): TFile[] {
  return app.vault.getMarkdownFiles().filter((file) => {
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
    if (!frontmatter || !hasProperty(frontmatter, propertyName)) {
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

function renameValueInProperty(rawValue: unknown, valueToRename: string, newValue: string): {
  changed: boolean;
  value: unknown;
} {
  if (rawValue === null || rawValue === undefined || rawValue === "") {
    if (valueToRename !== EMPTY_VALUE) {
      return { changed: false, value: rawValue };
    }

    return { changed: true, value: newValue };
  }

  if (!Array.isArray(rawValue)) {
    if (String(rawValue) !== valueToRename) {
      return { changed: false, value: rawValue };
    }

    return { changed: true, value: newValue };
  }

  if (rawValue.length === 0) {
    if (valueToRename !== EMPTY_VALUE) {
      return { changed: false, value: rawValue };
    }

    return { changed: true, value: [newValue] };
  }

  let changed = false;
  let alreadyHasNewValue = false;
  let insertIndex: number | null = null;
  const nextValue: unknown[] = [];

  for (const item of rawValue) {
    if (Array.isArray(item)) {
      const result = renameValueInProperty(item, valueToRename, newValue);
      if (result.changed) {
        changed = true;
      }
      nextValue.push(result.value);
    } else if (normalizeValues(item).includes(valueToRename)) {
      changed = true;
      if (insertIndex === null) {
        insertIndex = nextValue.length;
      }
    } else {
      if (normalizeValues(item).includes(newValue)) {
        alreadyHasNewValue = true;
      }
      nextValue.push(item);
    }
  }

  if (!changed) {
    return { changed: false, value: rawValue };
  }

  if (!alreadyHasNewValue && insertIndex !== null) {
    nextValue.splice(insertIndex, 0, newValue);
  }

  return {
    changed: true,
    value: nextValue
  };
}

function addFileFrontmatter(properties: Map<string, PropertyStats>, file: TFile, app: App) {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;

  for (const [name, rawValue] of getFrontmatterEntries(frontmatter)) {
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

    return value.reduce<string[]>((values, item: unknown) => {
      values.push(...normalizeValues(item));
      return values;
    }, []);
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

function hasProperty(frontmatter: object, propertyName: string): frontmatter is Frontmatter {
  return Object.prototype.hasOwnProperty.call(frontmatter, propertyName);
}

function getFrontmatterEntries(frontmatter: unknown): Array<[string, unknown]> {
  if (!isRecord(frontmatter)) {
    return [];
  }

  return Object.keys(frontmatter).map((key) => [key, frontmatter[key]]);
}

function isRecord(value: unknown): value is Frontmatter {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

interface InternalPluginRef {
  enabled?: boolean;
  instance?: unknown;
}

interface InternalPluginsRef {
  getPluginById?: (id: string) => InternalPluginRef | null;
  getEnabledPluginById?: (id: string) => unknown;
}

function getInternalPlugins(app: App): InternalPluginsRef | undefined {
  return (app as App & { internalPlugins?: InternalPluginsRef }).internalPlugins;
}

function isGlobalSearchDisabled(app: App) {
  const plugins = getInternalPlugins(app);
  if (!plugins) {
    return false;
  }

  if (typeof plugins.getEnabledPluginById === "function") {
    return !plugins.getEnabledPluginById("global-search");
  }

  const wrapper = plugins.getPluginById?.("global-search");
  return !!wrapper && wrapper.enabled === false;
}

function applySearchQuery(leaf: WorkspaceLeaf, query: string) {
  const view = leaf.view as {
    setQuery?: (query: string) => void;
    startSearch?: () => void;
    searchComponent?: { setValue?: (query: string) => void };
  };

  if (typeof view.setQuery === "function") {
    view.setQuery(query);
    return;
  }

  if (typeof view.searchComponent?.setValue === "function") {
    view.searchComponent.setValue(query);
    if (typeof view.startSearch === "function") {
      view.startSearch();
    }
    return;
  }

  throw new Error("Could not set the Search query");
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
