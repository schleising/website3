/**
 * Tree Viewer — static graph renderer.
 * Loads `graph.json` and draws an expandable left-to-right hierarchy.
 */

/**
 * @typedef {object} GraphStatus
 * @property {string} id
 * @property {string} label
 * @property {string} color
 * @property {number} severity
 */

/**
 * @typedef {object} GraphMeta
 * @property {string} title
 * @property {string} [description]
 * @property {"own" | "rollup"} [defaultColorMode]
 * @property {string[]} [displayFields]
 */

/**
 * @typedef {object} GraphNode
 * @property {string} id
 * @property {string} title
 * @property {string} [subtitle]
 * @property {string} status
 * @property {string} rollupStatus
 * @property {string} [sourceUrl]
 * @property {Object<string, string>} [data]
 * @property {string[]} [childIds]
 */

/**
 * @typedef {object} GraphLink
 * @property {string} from
 * @property {string} to
 * @property {string} [label]
 */

/**
 * @typedef {object} GraphDocument
 * @property {string} schemaVersion
 * @property {GraphMeta} meta
 * @property {GraphStatus[]} statuses
 * @property {GraphNode[]} nodes
 * @property {GraphLink[]} links
 */

/**
 * @typedef {object} ViewState
 * @property {"own" | "rollup"} colorMode
 * @property {Set<string>} expanded
 * @property {{x: number, y: number}} pan
 * @property {number} zoom
 */

/**
 * @typedef {object} LayoutNode
 * @property {string} id
 * @property {number} column
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 */

const ASSET_VERSION = "0.1.1";
const NODE_WIDTH = 240;
const COLUMN_GAP = 88;
const ROW_GAP = 20;
const PADDING = 48;
const VIEW_MARGIN = 24;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.4;

/** @type {GraphDocument | null} */
let graph = null;

/** @type {ViewState} */
const state = {
  colorMode: "own",
  expanded: new Set(),
  pan: { x: 40, y: 40 },
  zoom: 1,
};

/**
 * Boot the viewer.
 * @returns {Promise<void>}
 */
async function main() {
  bindToolbar();
  bindPanZoom();
  try {
    const loaded = await loadGraph(`./graph.json?v${ASSET_VERSION}`);
    graph = loaded;
    applyDocumentChrome(loaded);
    render();
    pinViewToLeft();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load graph.json";
    showBanner(message);
  }
}

/**
 * Fetch and validate the graph document.
 * @param {string} url
 * @returns {Promise<GraphDocument>}
 */
async function loadGraph(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("graph.json was not found. Run the converter, then serve the web folder.");
  }
  /** @type {GraphDocument} */
  const document = await response.json();
  if (!isSupportedVersion(document.schemaVersion)) {
    throw new Error("Incompatible graph.json schema version.");
  }
  if (!Array.isArray(document.nodes) || !Array.isArray(document.statuses)) {
    throw new Error("graph.json is missing nodes or statuses.");
  }
  return document;
}

/**
 * Accept `1.x` schema versions.
 * @param {string | undefined} version
 * @returns {boolean}
 */
function isSupportedVersion(version) {
  if (typeof version !== "string") {
    return false;
  }
  const match = /^(\d+)\.\d+$/.exec(version);
  return match !== null && match[1] === "1";
}

/**
 * Fill the header, legend, and colour-mode toggle from the document.
 * @param {GraphDocument} graphDoc
 * @returns {void}
 */
function applyDocumentChrome(graphDoc) {
  const title = graphDoc.meta && graphDoc.meta.title ? graphDoc.meta.title : "Tree Viewer";
  const heading = window.document.getElementById("doc-title");
  if (heading) {
    heading.textContent = title;
  }
  window.document.title = title;

  const description = graphDoc.meta && graphDoc.meta.description;
  const descriptionEl = window.document.getElementById("doc-description");
  if (descriptionEl) {
    if (description) {
      descriptionEl.textContent = description;
      descriptionEl.hidden = false;
    } else {
      descriptionEl.hidden = true;
    }
  }

  state.colorMode = graphDoc.meta && graphDoc.meta.defaultColorMode === "rollup" ? "rollup" : "own";
  const selected = window.document.querySelector(
    `input[name="color-mode"][value="${state.colorMode}"]`,
  );
  if (selected instanceof HTMLInputElement) {
    selected.checked = true;
  }
  renderLegend(graphDoc.statuses);
}

/**
 * Build the status legend in catalogue order.
 * @param {GraphStatus[]} statuses
 * @returns {void}
 */
function renderLegend(statuses) {
  const list = documentElement("legend");
  if (!(list instanceof HTMLElement)) {
    return;
  }
  list.replaceChildren();
  for (const status of statuses) {
    const item = window.document.createElement("li");
    const swatch = window.document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.background = status.color;
    item.append(swatch, window.document.createTextNode(status.label));
    list.append(item);
  }
}

/**
 * Show a blocking error banner.
 * @param {string} message
 * @returns {void}
 */
function showBanner(message) {
  const banner = documentElement("banner");
  if (!(banner instanceof HTMLElement)) {
    return;
  }
  banner.hidden = false;
  banner.textContent = message;
}

/**
 * Bind colour mode and zoom toolbar controls.
 * @returns {void}
 */
function bindToolbar() {
  for (const input of window.document.querySelectorAll('input[name="color-mode"]')) {
    input.addEventListener("change", () => {
      if (!(input instanceof HTMLInputElement) || !input.checked) {
        return;
      }
      state.colorMode = input.value === "rollup" ? "rollup" : "own";
      render();
    });
  }
  const zoomIn = documentElement("zoom-in");
  const zoomOut = documentElement("zoom-out");
  const zoomReset = documentElement("zoom-reset");
  if (zoomIn) {
    zoomIn.addEventListener("click", () => adjustZoom(1.15));
  }
  if (zoomOut) {
    zoomOut.addEventListener("click", () => adjustZoom(1 / 1.15));
  }
  if (zoomReset) {
    zoomReset.addEventListener("click", () => pinViewToLeft());
  }
}

/**
 * True when the target should keep its own gesture (tap, follow link).
 * @param {Element} target
 * @returns {boolean}
 */
function isBrowserGestureTarget(target) {
  return Boolean(target.closest(".node-chevron, .node-source, button, a, input, label"));
}

/**
 * Bind pan and wheel-zoom on the stage background.
 * @returns {void}
 */
function bindPanZoom() {
  const stage = documentElement("stage");
  if (!(stage instanceof HTMLElement)) {
    return;
  }
  /** @type {{x: number, y: number} | null} */
  let drag = null;

  stage.addEventListener(
    "pointerdown",
    (event) => {
      if (!(event.target instanceof Element)) {
        return;
      }
      if (isBrowserGestureTarget(event.target)) {
        return;
      }
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
      drag = { x: event.clientX, y: event.clientY };
      stage.classList.add("is-panning");
      stage.setPointerCapture(event.pointerId);
    },
    { passive: false },
  );

  stage.addEventListener(
    "pointermove",
    (event) => {
      if (!drag) {
        return;
      }
      event.preventDefault();
      state.pan.x += event.clientX - drag.x;
      state.pan.y += event.clientY - drag.y;
      drag = { x: event.clientX, y: event.clientY };
      applyWorldTransform();
    },
    { passive: false },
  );

  const endDrag = () => {
    drag = null;
    stage.classList.remove("is-panning");
  };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);

  stage.addEventListener(
    "touchmove",
    (event) => {
      event.preventDefault();
    },
    { passive: false },
  );

  stage.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
      const rect = stage.getBoundingClientRect();
      zoomAt(event.clientX - rect.left, event.clientY - rect.top, factor);
    },
    { passive: false },
  );
}

/**
 * Lay out and draw the visible graph.
 * @returns {void}
 */
function render() {
  if (!graph) {
    return;
  }
  const nodesLayer = documentElement("nodes");
  const edgesLayer = documentElement("edges");
  if (!(nodesLayer instanceof HTMLElement) || !(edgesLayer instanceof SVGElement)) {
    return;
  }

  const visible = visibleNodeIds(graph, state.expanded);
  const columns = assignColumns(graph, visible);
  const byId = nodeLookup(graph);

  nodesLayer.replaceChildren();
  /** @type {Map<string, HTMLElement>} */
  const elements = new Map();
  for (const node of graph.nodes) {
    if (!visible.has(node.id)) {
      continue;
    }
    const element = renderNode(node, graph);
    nodesLayer.append(element);
    elements.set(node.id, element);
  }

  /** @type {Map<string, LayoutNode>} */
  const layout = new Map();
  const maxColumn = Math.max(0, ...columns.values());
  for (let column = 0; column <= maxColumn; column += 1) {
    const ids = graph.nodes
      .filter((node) => visible.has(node.id) && columns.get(node.id) === column)
      .map((node) => node.id)
      .sort((left, right) => compareInColumn(left, right, graph, layout, byId));
    packColumn(column, ids, elements, layout, graph);
  }

  let contentWidth = PADDING;
  let contentHeight = PADDING;
  for (const placed of layout.values()) {
    const element = elements.get(placed.id);
    if (element) {
      element.style.left = `${placed.x}px`;
      element.style.top = `${placed.y}px`;
    }
    contentWidth = Math.max(contentWidth, placed.x + placed.width + PADDING);
    contentHeight = Math.max(contentHeight, placed.y + placed.height + PADDING);
  }

  nodesLayer.style.width = `${contentWidth}px`;
  nodesLayer.style.height = `${contentHeight}px`;
  edgesLayer.setAttribute("width", String(contentWidth));
  edgesLayer.setAttribute("height", String(contentHeight));
  drawEdges(edgesLayer, graph, layout);
  applyWorldTransform();
}

/**
 * Create a node element. Text is assigned with `textContent`.
 * @param {GraphNode} node
 * @param {GraphDocument} document
 * @returns {HTMLElement}
 */
function renderNode(node, document) {
  const status = statusForColor(node, document, state.colorMode);
  const article = window.document.createElement("article");
  article.className = "node";
  article.dataset.id = node.id;
  article.style.setProperty("--status", status.color);

  const childCount = (node.childIds || []).length;
  if (childCount > 0) {
    const expanded = state.expanded.has(node.id);
    const button = window.document.createElement("button");
    button.type = "button";
    button.className = "node-chevron";
    button.setAttribute("aria-expanded", expanded ? "true" : "false");
    button.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${node.title}`);
    button.textContent = expanded ? "▾" : "▸";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleExpanded(node.id);
    });
    article.append(button);
  } else {
    const spacer = window.document.createElement("span");
    spacer.className = "node-chevron-spacer";
    article.append(spacer);
  }

  const body = window.document.createElement("div");
  body.className = "node-body";

  const title = window.document.createElement("h2");
  title.className = "node-title";
  title.textContent = node.title;
  body.append(title);

  if (node.subtitle) {
    const subtitle = window.document.createElement("p");
    subtitle.className = "node-subtitle";
    subtitle.textContent = node.subtitle;
    body.append(subtitle);
  }

  const fields = displayFields(node, document);
  if (fields.length > 0) {
    const list = window.document.createElement("dl");
    list.className = "node-fields";
    for (const field of fields) {
      const row = window.document.createElement("div");
      const term = window.document.createElement("dt");
      term.textContent = `${field.name}:`;
      const detail = window.document.createElement("dd");
      detail.textContent = field.value;
      row.append(term, detail);
      list.append(row);
    }
    body.append(list);
  }

  const meta = window.document.createElement("div");
  meta.className = "node-meta";
  const chip = window.document.createElement("span");
  chip.className = "node-chip";
  chip.textContent = status.label;
  meta.append(chip);

  if (isHttpUrl(node.sourceUrl)) {
    const link = window.document.createElement("a");
    link.className = "node-source";
    link.href = node.sourceUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Open source";
    meta.append(link);
  }

  body.append(meta);
  article.append(body);
  return article;
}

/**
 * Extra fields chosen at import, in `displayFields` order.
 * @param {GraphNode} node
 * @param {GraphDocument} document
 * @returns {{name: string, value: string}[]}
 */
function displayFields(node, document) {
  const names = document.meta && document.meta.displayFields ? document.meta.displayFields : [];
  const data = node.data || {};
  /** @type {{name: string, value: string}[]} */
  const fields = [];
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(data, name) && data[name] !== "") {
      fields.push({ name, value: data[name] });
    }
  }
  return fields;
}

/**
 * Status used to colour a node in the current mode.
 * @param {GraphNode} node
 * @param {GraphDocument} document
 * @param {"own" | "rollup"} colorMode
 * @returns {GraphStatus}
 */
function statusForColor(node, document, colorMode) {
  const statusId = colorMode === "own" ? node.status : node.rollupStatus;
  const found = document.statuses.find((item) => item.id === statusId);
  if (found) {
    return found;
  }
  return {
    id: statusId,
    label: statusId,
    color: "#757575",
    severity: 0,
  };
}

/**
 * Expand or collapse a node. Collapse forgets descendant expand state.
 * Expanding also collapses every other open node in the same column.
 * @param {string} nodeId
 * @returns {void}
 */
function toggleExpanded(nodeId) {
  if (!graph) {
    return;
  }
  if (state.expanded.has(nodeId)) {
    collapseNode(nodeId);
  } else {
    collapseOthersInColumn(nodeId);
    state.expanded.add(nodeId);
  }
  render();
}

/**
 * Remove `nodeId` and all of its descendants from the expanded set.
 * @param {string} nodeId
 * @returns {void}
 */
function collapseNode(nodeId) {
  if (!graph) {
    return;
  }
  state.expanded.delete(nodeId);
  for (const descendant of descendantIds(graph, nodeId)) {
    state.expanded.delete(descendant);
  }
}

/**
 * Close other expanded nodes that sit in the same layout column as `nodeId`.
 * @param {string} nodeId
 * @returns {void}
 */
function collapseOthersInColumn(nodeId) {
  if (!graph) {
    return;
  }
  const visible = visibleNodeIds(graph, state.expanded);
  const columns = assignColumns(graph, visible);
  const column = columns.get(nodeId);
  if (column === undefined) {
    return;
  }
  for (const otherId of [...state.expanded]) {
    if (otherId === nodeId || columns.get(otherId) !== column) {
      continue;
    }
    collapseNode(otherId);
  }
}

/**
 * Visible nodes: roots plus children of expanded visible parents.
 * @param {GraphDocument} document
 * @param {Set<string>} expanded
 * @returns {Set<string>}
 */
function visibleNodeIds(document, expanded) {
  const incoming = new Set(document.links.map((link) => link.to));
  const visible = new Set(
    document.nodes.filter((node) => !incoming.has(node.id)).map((node) => node.id),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const link of document.links) {
      if (visible.has(link.from) && expanded.has(link.from) && !visible.has(link.to)) {
        visible.add(link.to);
        changed = true;
      }
    }
  }
  return visible;
}

/**
 * Column index for each visible node. Roots are column 0.
 * @param {GraphDocument} document
 * @param {Set<string>} visible
 * @returns {Map<string, number>}
 */
function assignColumns(document, visible) {
  /** @type {Map<string, string[]>} */
  const parents = new Map();
  for (const link of document.links) {
    if (!visible.has(link.from) || !visible.has(link.to)) {
      continue;
    }
    const list = parents.get(link.to) || [];
    list.push(link.from);
    parents.set(link.to, list);
  }

  /** @type {Map<string, number>} */
  const columns = new Map();

  /**
   * @param {string} nodeId
   * @returns {number}
   */
  const columnOf = (nodeId) => {
    const cached = columns.get(nodeId);
    if (cached !== undefined) {
      return cached;
    }
    const visibleParents = parents.get(nodeId) || [];
    if (visibleParents.length === 0) {
      columns.set(nodeId, 0);
      return 0;
    }
    const column = 1 + Math.max(...visibleParents.map((parentId) => columnOf(parentId)));
    columns.set(nodeId, column);
    return column;
  };

  for (const node of document.nodes) {
    if (visible.has(node.id)) {
      columnOf(node.id);
    }
  }
  return columns;
}

/**
 * Stack nodes in one column. Roots start at the top. Later columns start
 * at the parent node's Y so the first child lines up with the opened node.
 * @param {number} column
 * @param {string[]} ids
 * @param {Map<string, HTMLElement>} elements
 * @param {Map<string, LayoutNode>} layout
 * @param {GraphDocument} document
 * @returns {void}
 */
function packColumn(column, ids, elements, layout, document) {
  let y = PADDING;
  /** @type {string | null} */
  let activeParent = null;
  for (const id of ids) {
    const element = elements.get(id);
    if (!element) {
      continue;
    }
    const parentId = primaryLayoutParent(id, document, layout);
    if (column > 0 && parentId !== null && parentId !== activeParent) {
      const parent = layout.get(parentId);
      if (parent) {
        y = Math.max(y, parent.y);
      }
      activeParent = parentId;
    }
    const height = element.offsetHeight;
    const x = PADDING + column * (NODE_WIDTH + COLUMN_GAP);
    layout.set(id, { id, column, x, y, width: NODE_WIDTH, height });
    y += height + ROW_GAP;
  }
}

/**
 * Visible parent already placed, preferring the rightmost (nearest) column.
 * @param {string} nodeId
 * @param {GraphDocument} document
 * @param {Map<string, LayoutNode>} layout
 * @returns {string | null}
 */
function primaryLayoutParent(nodeId, document, layout) {
  /** @type {string | null} */
  let bestId = null;
  let bestColumn = -1;
  for (const link of document.links) {
    if (link.to !== nodeId) {
      continue;
    }
    const parent = layout.get(link.from);
    if (!parent) {
      continue;
    }
    if (parent.column > bestColumn) {
      bestColumn = parent.column;
      bestId = link.from;
    }
  }
  return bestId;
}

/**
 * Stable order inside a column: follow parent barycentre, then document order.
 * @param {string} left
 * @param {string} right
 * @param {GraphDocument} document
 * @param {Map<string, LayoutNode>} layout
 * @param {Map<string, GraphNode>} byId
 * @returns {number}
 */
function compareInColumn(left, right, document, layout, byId) {
  const leftScore = parentBarycentre(left, document, layout);
  const rightScore = parentBarycentre(right, document, layout);
  if (leftScore !== rightScore) {
    return leftScore - rightScore;
  }
  return document.nodes.indexOf(byId.get(left)) - document.nodes.indexOf(byId.get(right));
}

/**
 * Average parent Y, or 0 when the node is a root.
 * @param {string} nodeId
 * @param {GraphDocument} document
 * @param {Map<string, LayoutNode>} layout
 * @returns {number}
 */
function parentBarycentre(nodeId, document, layout) {
  const ys = [];
  for (const link of document.links) {
    if (link.to !== nodeId) {
      continue;
    }
    const parent = layout.get(link.from);
    if (parent) {
      ys.push(parent.y);
    }
  }
  if (ys.length === 0) {
    return 0;
  }
  return ys.reduce((sum, value) => sum + value, 0) / ys.length;
}

/**
 * Draw orthogonal edges between visible parents and children.
 * @param {SVGElement} svg
 * @param {GraphDocument} document
 * @param {Map<string, LayoutNode>} layout
 * @returns {void}
 */
function drawEdges(svg, document, layout) {
  svg.replaceChildren();
  const ns = "http://www.w3.org/2000/svg";
  for (const link of document.links) {
    const from = layout.get(link.from);
    const to = layout.get(link.to);
    if (!from || !to) {
      continue;
    }
    const startX = from.x + from.width;
    const startY = from.y + from.height / 2;
    const endX = to.x;
    const endY = to.y + to.height / 2;
    const midX = (startX + endX) / 2;
    const path = window.document.createElementNS(ns, "path");
    path.setAttribute("class", "edge");
    path.setAttribute(
      "d",
      `M ${startX} ${startY} H ${midX} V ${endY} H ${endX}`,
    );
    svg.append(path);
  }
}

/**
 * All descendants of `nodeId` following outgoing links.
 * @param {GraphDocument} document
 * @param {string} nodeId
 * @returns {string[]}
 */
function descendantIds(document, nodeId) {
  /** @type {Map<string, string[]>} */
  const children = new Map();
  for (const link of document.links) {
    const list = children.get(link.from) || [];
    list.push(link.to);
    children.set(link.from, list);
  }
  /** @type {string[]} */
  const found = [];
  const seen = new Set();
  /** @type {string[]} */
  const stack = [...(children.get(nodeId) || [])];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || seen.has(current)) {
      continue;
    }
    seen.add(current);
    found.push(current);
    for (const child of children.get(current) || []) {
      stack.push(child);
    }
  }
  return found;
}

/**
 * @param {GraphDocument} document
 * @returns {Map<string, GraphNode>}
 */
function nodeLookup(document) {
  /** @type {Map<string, GraphNode>} */
  const lookup = new Map();
  for (const node of document.nodes) {
    lookup.set(node.id, node);
  }
  return lookup;
}

/**
 * True for absolute http(s) URLs only.
 * @param {string | undefined} value
 * @returns {value is string}
 */
function isHttpUrl(value) {
  if (!value) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Apply pan/zoom to the world layer.
 * @returns {void}
 */
function applyWorldTransform() {
  const world = documentElement("world");
  if (!(world instanceof HTMLElement)) {
    return;
  }
  world.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;
}

/**
 * Zoom about a point in stage coordinates.
 * @param {number} originX
 * @param {number} originY
 * @param {number} factor
 * @returns {void}
 */
function zoomAt(originX, originY, factor) {
  const next = clamp(state.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  const ratio = next / state.zoom;
  state.pan.x = originX - (originX - state.pan.x) * ratio;
  state.pan.y = originY - (originY - state.pan.y) * ratio;
  state.zoom = next;
  applyWorldTransform();
}

/**
 * Zoom about the stage centre.
 * @param {number} factor
 * @returns {void}
 */
function adjustZoom(factor) {
  const stage = documentElement("stage");
  if (!(stage instanceof HTMLElement)) {
    return;
  }
  const rect = stage.getBoundingClientRect();
  zoomAt(rect.width / 2, rect.height / 2, factor);
}

/**
 * Place the first column at the left of the stage with a small margin.
 * @returns {void}
 */
function pinViewToLeft() {
  state.zoom = 1;
  state.pan.x = VIEW_MARGIN - PADDING;
  state.pan.y = VIEW_MARGIN - PADDING;
  applyWorldTransform();
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * @param {string} id
 * @returns {HTMLElement | SVGElement | null}
 */
function documentElement(id) {
  const element = window.document.getElementById(id);
  if (element instanceof HTMLElement || element instanceof SVGElement) {
    return element;
  }
  return null;
}

void main();
