(() => {
  "use strict";

  const BOARD_W = 1600;
  const BOARD_H = 900;
  const MAX_TRUTH_INPUTS = 8;
  const MAX_SIMPLIFY_VARS = 6;
  const MIN_GATE_INPUTS = 2;
  const MAX_GATE_INPUTS = 8;

  const GATE_DEFS = {
    INPUT:  { label: "Entrada", inputs: 0 },
    OUTPUT: { label: "Salida", inputs: 1 },
    AND:    { label: "AND", inputs: 2, variableInputs: true },
    OR:     { label: "OR", inputs: 2, variableInputs: true },
    NOT:    { label: "NOT", inputs: 1 },
    NAND:   { label: "NAND", inputs: 2, variableInputs: true },
    NOR:    { label: "NOR", inputs: 2, variableInputs: true },
    XOR:    { label: "XOR", inputs: 2, variableInputs: true },
    XNOR:   { label: "XNOR", inputs: 2, variableInputs: true },
  };

  const RULES = [
    { name: "Identidad", formulas: ["A + 0 = A", "A·1 = A"], note: "Agregar cero con OR o uno con AND no cambia el valor." },
    { name: "Nulidad o dominación", formulas: ["A + 1 = 1", "A·0 = 0"], note: "Uno domina en OR y cero domina en AND." },
    { name: "Idempotencia", formulas: ["A + A = A", "A·A = A"], note: "Repetir la misma variable no agrega información." },
    { name: "Complemento", formulas: ["A + A' = 1", "A·A' = 0"], note: "Una variable y su complemento cubren todos los casos o ninguno." },
    { name: "Involución", formulas: ["(A')' = A"], note: "Negar dos veces devuelve la variable original." },
    { name: "Conmutativa", formulas: ["A + B = B + A", "A·B = B·A"], note: "El orden de las variables no altera el resultado." },
    { name: "Asociativa", formulas: ["A + (B + C) = (A + B) + C", "A·(B·C) = (A·B)·C"], note: "Se pueden reagrupar términos con el mismo operador." },
    { name: "Distributiva", formulas: ["A(B + C) = AB + AC", "A + BC = (A + B)(A + C)"], note: "Permite expandir o factorizar expresiones." },
    { name: "Absorción", formulas: ["A + AB = A", "A(A + B) = A"], note: "El término más general absorbe al término que ya lo contiene." },
    { name: "De Morgan", formulas: ["(A + B)' = A'B'", "(AB)' = A' + B'"], note: "Al negar un grupo, se niega cada término y se intercambia AND por OR." },
    { name: "Redundancia", formulas: ["A + A'B = A + B", "A(A' + B) = AB"], note: "Una forma útil para eliminar términos condicionados por el complemento." },
    { name: "Consenso", formulas: ["AB + A'C + BC = AB + A'C"], note: "El término BC es de consenso y puede eliminarse." },
  ];

  const state = {
    nodes: [],
    connections: [],
    selectedId: null,
    selectedConnection: null,
    pendingSource: null,
    zoom: 1,
    nextId: 1,
    truthRows: [],
    truthHeaders: [],
    truthCsv: "",
    equationSteps: [],
    simplificationProcedure: [],
    algebraProcedure: [],
    karnaughData: null,
    activeSimplificationMethod: "karnaugh",
    procedureCollapsed: false,
    truthMode: "circuit",
    undoStack: [],
    redoStack: [],
    suspendHistory: false,
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const els = {
    gatePalette: $("#gatePalette"),
    circuitBoard: $("#circuitBoard"),
    nodesLayer: $("#nodesLayer"),
    wiresLayer: $("#wiresLayer"),
    boardViewport: $("#boardViewport"),
    selectedName: $("#selectedName"),
    selectedInputCount: $("#selectedInputCount"),
    selectedInputsGroup: $("#selectedInputsGroup"),
    selectedInfo: $("#selectedInfo"),
    connectionHint: $("#connectionHint"),
    outputsPanel: $("#outputsPanel"),
    generatedEquation: $("#generatedEquation"),
    originalExpression: $("#originalExpression"),
    simplifiedResult: $("#simplifiedResult"),
    simplificationProcedure: $("#simplificationProcedure"),
    algebraProcedure: $("#algebraProcedure"),
    karnaughProcedure: $("#karnaughProcedure"),
    methodTabs: $$(".method-tab"),
    methodPanels: $$("[data-method-panel]"),
    deleteWireBtn: $("#deleteWireBtn"),
    undoBtn: $("#undoBtn"),
    redoBtn: $("#redoBtn"),
    stepExpression: $("#stepExpression"),
    stepRule: $("#stepRule"),
    stepsList: $("#stepsList"),
    compareA: $("#compareA"),
    compareB: $("#compareB"),
    compareResult: $("#compareResult"),
    truthTableContainer: $("#truthTableContainer"),
    truthSourceLabel: $("#truthSourceLabel"),
    zoomLabel: $("#zoomLabel"),
    ruleSearch: $("#ruleSearch"),
    rulesGrid: $("#rulesGrid"),
    toast: $("#toast"),
    fileInput: $("#fileInput"),
  };

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => els.toast.classList.remove("show"), 1800);
  }

  function captureSnapshot() {
    return JSON.stringify({
      nodes: state.nodes,
      connections: state.connections,
      nextId: state.nextId,
      originalExpression: els.originalExpression?.value || "",
      simplifiedResult: els.simplifiedResult?.textContent || "—",
      equationSteps: state.equationSteps,
      simplificationProcedure: state.simplificationProcedure,
      algebraProcedure: state.algebraProcedure,
      karnaughData: state.karnaughData,
      activeSimplificationMethod: state.activeSimplificationMethod,
      procedureCollapsed: state.procedureCollapsed,
    });
  }

  function updateHistoryButtons() {
    if (els.undoBtn) els.undoBtn.disabled = state.undoStack.length === 0;
    if (els.redoBtn) els.redoBtn.disabled = state.redoStack.length === 0;
  }

  function pushUndoSnapshot(snapshot = captureSnapshot()) {
    if (state.suspendHistory) return;
    if (state.undoStack[state.undoStack.length - 1] !== snapshot) {
      state.undoStack.push(snapshot);
      if (state.undoStack.length > 100) state.undoStack.shift();
    }
    state.redoStack = [];
    updateHistoryButtons();
  }

  function restoreSnapshot(snapshot) {
    const data = typeof snapshot === "string" ? JSON.parse(snapshot) : snapshot;
    state.suspendHistory = true;
    state.nodes = Array.isArray(data.nodes) ? JSON.parse(JSON.stringify(data.nodes)) : [];
    state.connections = Array.isArray(data.connections) ? JSON.parse(JSON.stringify(data.connections)) : [];
    state.nextId = Number(data.nextId) || 1;
    state.equationSteps = Array.isArray(data.equationSteps) ? JSON.parse(JSON.stringify(data.equationSteps)) : [];
    state.simplificationProcedure = Array.isArray(data.simplificationProcedure) ? JSON.parse(JSON.stringify(data.simplificationProcedure)) : [];
    state.algebraProcedure = Array.isArray(data.algebraProcedure) ? JSON.parse(JSON.stringify(data.algebraProcedure)) : [];
    state.karnaughData = data.karnaughData ? JSON.parse(JSON.stringify(data.karnaughData)) : null;
    state.activeSimplificationMethod = ["karnaugh", "algebra", "tabular"].includes(data.activeSimplificationMethod) ? data.activeSimplificationMethod : "karnaugh";
    state.procedureCollapsed = Boolean(data.procedureCollapsed);
    state.selectedId = null;
    state.selectedConnection = null;
    state.pendingSource = null;
    els.nodesLayer.innerHTML = "";
    state.nodes.forEach(renderNode);
    els.originalExpression.value = data.originalExpression || "";
    els.simplifiedResult.textContent = data.simplifiedResult || "—";
    renderSteps();
    renderAllSimplificationMethods();
    switchSimplificationMethod(state.activeSimplificationMethod);
    selectNode(null);
    evaluateCircuit();
    state.suspendHistory = false;
  }

  function undo() {
    if (!state.undoStack.length) { showToast("No hay cambios para deshacer"); return; }
    state.redoStack.push(captureSnapshot());
    const snapshot = state.undoStack.pop();
    restoreSnapshot(snapshot);
    updateHistoryButtons();
    showToast("Cambio deshecho");
  }

  function redo() {
    if (!state.redoStack.length) { showToast("No hay cambios para rehacer"); return; }
    state.undoStack.push(captureSnapshot());
    const snapshot = state.redoStack.pop();
    restoreSnapshot(snapshot);
    updateHistoryButtons();
    showToast("Cambio rehecho");
  }

  function gateSvg(type) {
    const common = 'viewBox="0 0 80 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"';
    if (type === "INPUT") return `<svg ${common}><circle cx="18" cy="24" r="9"/><line x1="27" y1="24" x2="66" y2="24"/></svg>`;
    if (type === "OUTPUT") return `<svg ${common}><line x1="12" y1="24" x2="52" y2="24"/><circle cx="62" cy="24" r="9"/></svg>`;
    if (type === "NOT") return `<svg ${common}><path d="M15 8 L58 24 L15 40 Z"/><circle cx="66" cy="24" r="5"/><line x1="4" y1="24" x2="15" y2="24"/></svg>`;
    if (type === "AND" || type === "NAND") {
      return `<svg ${common}><path d="M16 8 H39 C57 8 68 15 68 24 C68 33 57 40 39 40 H16 Z"/><line x1="4" y1="17" x2="16" y2="17"/><line x1="4" y1="31" x2="16" y2="31"/>${type === "NAND" ? '<circle cx="73" cy="24" r="5"/>' : ''}</svg>`;
    }
    if (type === "OR" || type === "NOR" || type === "XOR" || type === "XNOR") {
      const extra = (type === "XOR" || type === "XNOR") ? '<path d="M10 8 Q22 24 10 40"/>' : '';
      const bubble = (type === "NOR" || type === "XNOR") ? '<circle cx="73" cy="24" r="5"/>' : '';
      return `<svg ${common}>${extra}<path d="M16 8 Q44 8 68 24 Q44 40 16 40 Q27 24 16 8 Z"/><line x1="4" y1="17" x2="19" y2="17"/><line x1="4" y1="31" x2="19" y2="31"/>${bubble}</svg>`;
    }
    return "";
  }

  function renderPalette() {
    els.gatePalette.innerHTML = Object.keys(GATE_DEFS).map(type => `
      <button class="gate-tool" draggable="true" data-gate="${type}" title="Agregar ${GATE_DEFS[type].label}">
        ${gateSvg(type)}
        <span>${GATE_DEFS[type].label}</span>
      </button>
    `).join("");

    $$(".gate-tool").forEach(tool => {
      tool.addEventListener("click", () => addNode(tool.dataset.gate));
      tool.addEventListener("dragstart", (event) => {
        event.dataTransfer.setData("text/plain", tool.dataset.gate);
        event.dataTransfer.effectAllowed = "copy";
      });
    });
  }

  function defaultNodeName(type) {
    if (type === "INPUT") {
      const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const count = state.nodes.filter(n => n.type === "INPUT").length;
      return letters[count] || `I${count + 1}`;
    }
    if (type === "OUTPUT") {
      const count = state.nodes.filter(n => n.type === "OUTPUT").length;
      return count === 0 ? "S" : `S${count + 1}`;
    }
    return type;
  }

  function getInputCount(nodeOrId) {
    const node = typeof nodeOrId === "string" ? getNode(nodeOrId) : nodeOrId;
    if (!node) return 0;
    const def = GATE_DEFS[node.type];
    if (!def) return 0;
    if (!def.variableInputs) return def.inputs;
    return clamp(Number(node.inputCount) || def.inputs, MIN_GATE_INPUTS, MAX_GATE_INPUTS);
  }

  function getNodeBodyHeight(node) {
    const count = getInputCount(node);
    if (count <= 2) return 54;
    return Math.max(72, count * 20 + 12);
  }

  function getNodeHeight(node) {
    return 26 + getNodeBodyHeight(node);
  }

  function rerenderNode(node) {
    const old = document.querySelector(`.logic-node[data-id="${cssEscape(node.id)}"]`);
    old?.remove();
    renderNode(node);
    selectNode(node.id);
  }

  function addNode(type, x, y, options = {}) {
    const def = GATE_DEFS[type];
    if (!def) return;
    if (!options.skipHistory) pushUndoSnapshot();

    const offset = state.nodes.length * 18;
    const node = {
      id: options.id || `n${state.nextId++}`,
      type,
      name: options.name || defaultNodeName(type),
      x: Number.isFinite(x) ? x : 80 + (offset % 520),
      y: Number.isFinite(y) ? y : 80 + (offset % 420),
      value: type === "INPUT" ? (options.value ? 1 : 0) : null,
      inputCount: def.variableInputs
        ? clamp(Number(options.inputCount) || def.inputs, MIN_GATE_INPUTS, MAX_GATE_INPUTS)
        : def.inputs,
    };
    state.nodes.push(node);
    if (options.id) {
      const numeric = Number(String(options.id).replace(/\D/g, ""));
      if (Number.isFinite(numeric)) state.nextId = Math.max(state.nextId, numeric + 1);
    }
    renderNode(node);
    selectNode(node.id);
    evaluateCircuit();
    return node;
  }

  function renderNode(node) {
    const el = document.createElement("div");
    el.className = "logic-node";
    el.dataset.id = node.id;
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;

    const inputCount = getInputCount(node);
    const bodyHeight = getNodeBodyHeight(node);
    let body = "";
    if (node.type === "INPUT") {
      body = `<button class="input-toggle" title="Cambiar valor">${node.value}</button>`;
    } else if (node.type === "OUTPUT") {
      body = `<input class="node-name-input" value="${escapeHtml(node.name)}" maxlength="12" aria-label="Nombre de la salida" />`;
    } else {
      const inputBadge = GATE_DEFS[node.type].variableInputs
        ? `<span class="gate-input-badge">${inputCount} entradas</span>`
        : "";
      body = `<div class="node-icon">${gateSvg(node.type)}</div>${inputBadge}`;
    }

    const ports = Array.from({ length: inputCount }, (_, i) => {
      const top = ((i + 1) / (inputCount + 1)) * 100;
      return `<button class="port input-port" data-port="${i}" title="Entrada ${i + 1}" style="top:calc(${top}% - 7px)"></button>`;
    }).join("");

    el.innerHTML = `
      <div class="node-header">
        <span class="node-type">${GATE_DEFS[node.type].label}</span>
        <span class="node-value">${node.value ?? "?"}</span>
      </div>
      <div class="node-body" style="min-height:${bodyHeight}px">
        ${ports}
        ${body}
        ${node.type !== "OUTPUT" ? '<button class="port output-port" data-port="0" title="Salida"></button>' : ''}
      </div>
    `;

    els.nodesLayer.appendChild(el);
    bindNodeEvents(el, node);
    updateNodeVisual(node);
  }

  function bindNodeEvents(el, node) {
    el.addEventListener("pointerdown", (event) => {
      if (event.target.closest(".port, input, button") && !event.target.closest(".node-header")) return;
      selectNode(node.id);
    });

    const header = el.querySelector(".node-header");
    header.addEventListener("pointerdown", (event) => startDragNode(event, node, el));

    el.querySelectorAll(".port").forEach(port => {
      port.addEventListener("click", (event) => {
        event.stopPropagation();
        if (port.classList.contains("output-port")) {
          beginConnection(node.id);
          return;
        }
        const portIndex = Number(port.dataset.port);
        if (!state.pendingSource) {
          const wireIndex = state.connections.findIndex(connection => connection.to === node.id && connection.toPort === portIndex);
          if (wireIndex >= 0) { selectConnection(wireIndex); return; }
        }
        finishConnection(node.id, portIndex);
      });
    });

    const toggle = el.querySelector(".input-toggle");
    if (toggle) {
      toggle.addEventListener("click", (event) => {
        event.stopPropagation();
        pushUndoSnapshot();
        node.value = node.value ? 0 : 1;
        evaluateCircuit();
      });
    }

    const nameInput = el.querySelector(".node-name-input");
    if (nameInput) {
      let editSnapshot = null;
      nameInput.addEventListener("focus", () => { editSnapshot = captureSnapshot(); });
      nameInput.addEventListener("input", () => {
        node.name = sanitizeName(nameInput.value) || "S";
        nameInput.value = node.name;
        evaluateCircuit();
      });
      nameInput.addEventListener("change", () => {
        if (editSnapshot) pushUndoSnapshot(editSnapshot);
        editSnapshot = null;
      });
      nameInput.addEventListener("pointerdown", event => event.stopPropagation());
    }
  }

  function startDragNode(event, node, el) {
    event.preventDefault();
    selectNode(node.id);
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = node.x;
    const originY = node.y;
    const beforeMove = captureSnapshot();
    let moved = false;
    headerCapture(event.currentTarget, event.pointerId);

    const move = (e) => {
      moved = true;
      const dx = (e.clientX - startX) / state.zoom;
      const dy = (e.clientY - startY) / state.zoom;
      node.x = clamp(originX + dx, 0, BOARD_W - el.offsetWidth);
      node.y = clamp(originY + dy, 0, BOARD_H - el.offsetHeight);
      el.style.left = `${node.x}px`;
      el.style.top = `${node.y}px`;
      renderWires();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (moved && (Math.round(node.x) !== Math.round(originX) || Math.round(node.y) !== Math.round(originY))) pushUndoSnapshot(beforeMove);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  }

  function headerCapture(target, pointerId) {
    try { target.setPointerCapture(pointerId); } catch (_) { /* no-op */ }
  }

  function selectNode(id, preserveWireSelection = false) {
    const hadSelectedWire = state.selectedConnection !== null;
    state.selectedId = id;
    if (!preserveWireSelection) state.selectedConnection = null;
    if (els.deleteWireBtn) els.deleteWireBtn.disabled = state.selectedConnection === null;
    if (hadSelectedWire && !preserveWireSelection) renderWires();
    $$(".logic-node").forEach(el => el.classList.toggle("selected", el.dataset.id === id));
    const node = getNode(id);
    if (!node) {
      els.selectedName.disabled = true;
      els.selectedName.value = "";
      els.selectedInputsGroup.classList.add("hidden");
      els.selectedInputCount.disabled = true;
      els.selectedInfo.textContent = "Sin selección";
      return;
    }
    els.selectedName.disabled = false;
    els.selectedName.value = node.name;
    const variableInputs = Boolean(GATE_DEFS[node.type].variableInputs);
    els.selectedInputsGroup.classList.toggle("hidden", !variableInputs);
    els.selectedInputCount.disabled = !variableInputs;
    els.selectedInputCount.value = String(getInputCount(node));
    const inputInfo = variableInputs ? ` · ${getInputCount(node)} entradas` : "";
    els.selectedInfo.textContent = `${GATE_DEFS[node.type].label}${inputInfo} · X: ${Math.round(node.x)} · Y: ${Math.round(node.y)}`;
  }

  function sanitizeName(value) {
    return String(value || "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 12);
  }

  function getNode(id) { return state.nodes.find(n => n.id === id); }

  function deleteSelectedNode() {
    if (!state.selectedId) return;
    pushUndoSnapshot();
    const id = state.selectedId;
    state.nodes = state.nodes.filter(n => n.id !== id);
    state.connections = state.connections.filter(c => c.from !== id && c.to !== id);
    document.querySelector(`.logic-node[data-id="${cssEscape(id)}"]`)?.remove();
    state.selectedId = null;
    cancelConnection();
    selectNode(null);
    evaluateCircuit();
    showToast("Elemento eliminado");
  }

  function beginConnection(fromId) {
    state.selectedConnection = null;
    state.pendingSource = fromId;
    els.connectionHint.textContent = `Conectando desde ${getNode(fromId)?.name || "salida"}…`;
    els.connectionHint.classList.add("active");
    renderWires();
  }

  function finishConnection(toId, toPort) {
    if (!state.pendingSource) {
      showToast("Primero selecciona un puerto de salida");
      return;
    }
    if (state.pendingSource === toId) {
      showToast("No puedes conectar un elemento consigo mismo");
      return;
    }
    const existing = state.connections.find(c => c.to === toId && c.toPort === toPort);
    if (existing?.from === state.pendingSource) { cancelConnection(); return; }
    pushUndoSnapshot();
    state.connections = state.connections.filter(c => !(c.to === toId && c.toPort === toPort));
    state.connections.push({ from: state.pendingSource, to: toId, toPort });
    state.selectedConnection = null;
    cancelConnection();
    evaluateCircuit();
  }

  function cancelConnection() {
    state.pendingSource = null;
    els.connectionHint.textContent = "Listo para conectar";
    els.connectionHint.classList.remove("active");
    renderWires();
  }

  function getPortCenter(nodeId, kind, portIndex = 0) {
    const nodeEl = document.querySelector(`.logic-node[data-id="${cssEscape(nodeId)}"]`);
    if (!nodeEl) return { x: 0, y: 0 };
    const selector = kind === "out" ? ".output-port" : `.input-port[data-port="${portIndex}"]`;
    const port = nodeEl.querySelector(selector);
    if (!port) return { x: 0, y: 0 };
    const boardRect = els.circuitBoard.getBoundingClientRect();
    const rect = port.getBoundingClientRect();
    return {
      x: (rect.left + rect.width / 2 - boardRect.left) / state.zoom,
      y: (rect.top + rect.height / 2 - boardRect.top) / state.zoom,
    };
  }

  function wirePath(a, b) {
    const dx = Math.max(55, Math.abs(b.x - a.x) * 0.48);
    return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
  }

  function renderWires() {
    const fragments = [];
    state.connections.forEach((connection, index) => {
      const a = getPortCenter(connection.from, "out");
      const b = getPortCenter(connection.to, "in", connection.toPort);
      const source = getNode(connection.from);
      const path = wirePath(a, b);
      fragments.push(`<path class="wire-hit" data-index="${index}" d="${path}"/>`);
      fragments.push(`<path class="wire ${source?.value === 1 ? "on" : ""} ${state.selectedConnection === index ? "selected" : ""}" d="${path}"/>`);
    });
    els.wiresLayer.innerHTML = fragments.join("");
    els.wiresLayer.querySelectorAll(".wire-hit").forEach(path => {
      const index = Number(path.dataset.index);
      path.addEventListener("click", event => { event.stopPropagation(); selectConnection(index); });
      path.addEventListener("dblclick", event => { event.preventDefault(); event.stopPropagation(); deleteConnection(index); });
      path.addEventListener("contextmenu", event => { event.preventDefault(); event.stopPropagation(); deleteConnection(index); });
    });
    if (els.deleteWireBtn) els.deleteWireBtn.disabled = state.selectedConnection === null;
    updatePortClasses();
  }

  function selectConnection(index) {
    if (!Number.isInteger(index) || !state.connections[index]) return;
    state.selectedConnection = index;
    selectNode(null, true);
    const connection = state.connections[index];
    const from = getNode(connection.from)?.name || "salida";
    const to = getNode(connection.to)?.name || "entrada";
    els.connectionHint.textContent = `Cable seleccionado: ${from} → ${to}`;
    els.connectionHint.classList.add("active");
    renderWires();
  }

  function deleteConnection(index = state.selectedConnection) {
    if (!Number.isInteger(index) || !state.connections[index]) { showToast("Selecciona un cable primero"); return; }
    pushUndoSnapshot();
    state.connections.splice(index, 1);
    state.selectedConnection = null;
    cancelConnection();
    evaluateCircuit();
    showToast("Cable eliminado");
  }

  function updatePortClasses() {
    $$(".port").forEach(p => p.classList.remove("connected"));
    for (const connection of state.connections) {
      document.querySelector(`.logic-node[data-id="${cssEscape(connection.from)}"] .output-port`)?.classList.add("connected");
      document.querySelector(`.logic-node[data-id="${cssEscape(connection.to)}"] .input-port[data-port="${connection.toPort}"]`)?.classList.add("connected");
    }
  }

  function inputValuesForNode(nodeId, valuesMap) {
    const count = getInputCount(nodeId);
    return Array.from({ length: count }, (_, i) => {
      const connection = state.connections.find(c => c.to === nodeId && c.toPort === i);
      return connection ? valuesMap.get(connection.from) : null;
    });
  }

  function computeGate(type, inputs) {
    if (inputs.some(v => v === null || v === undefined)) return null;
    const first = inputs[0];
    const andValue = inputs.every(v => v === 1) ? 1 : 0;
    const orValue = inputs.some(v => v === 1) ? 1 : 0;
    const xorValue = inputs.reduce((parity, value) => parity ^ value, 0);
    switch (type) {
      case "OUTPUT": return first;
      case "NOT": return first ? 0 : 1;
      case "AND": return andValue;
      case "OR": return orValue;
      case "NAND": return andValue ? 0 : 1;
      case "NOR": return orValue ? 0 : 1;
      case "XOR": return xorValue;
      case "XNOR": return xorValue ? 0 : 1;
      default: return null;
    }
  }

  function evaluateNetwork(overrides = null) {
    const values = new Map();
    for (const node of state.nodes) {
      if (node.type === "INPUT") {
        values.set(node.id, overrides?.has(node.id) ? overrides.get(node.id) : node.value);
      } else values.set(node.id, null);
    }

    for (let pass = 0; pass < state.nodes.length + 2; pass++) {
      let changed = false;
      for (const node of state.nodes) {
        if (node.type === "INPUT") continue;
        const next = computeGate(node.type, inputValuesForNode(node.id, values));
        if (values.get(node.id) !== next) {
          values.set(node.id, next);
          changed = true;
        }
      }
      if (!changed) break;
    }
    return values;
  }

  function evaluateCircuit() {
    const values = evaluateNetwork();
    for (const node of state.nodes) {
      node.value = values.get(node.id);
      updateNodeVisual(node);
    }
    renderWires();
    renderOutputs();
    updateGeneratedEquation();
  }

  function updateNodeVisual(node) {
    const el = document.querySelector(`.logic-node[data-id="${cssEscape(node.id)}"]`);
    if (!el) return;
    el.classList.toggle("high", node.value === 1);
    const badge = el.querySelector(".node-value");
    if (badge) badge.textContent = node.value ?? "?";
    const toggle = el.querySelector(".input-toggle");
    if (toggle) toggle.textContent = node.value ?? 0;
  }

  function renderOutputs() {
    const outputs = state.nodes.filter(n => n.type === "OUTPUT");
    if (!outputs.length) {
      els.outputsPanel.className = "outputs-panel empty-state";
      els.outputsPanel.textContent = "Agrega una salida para ver el resultado.";
      return;
    }
    els.outputsPanel.className = "outputs-panel";
    els.outputsPanel.innerHTML = outputs.map(n => `
      <div class="output-row ${n.value === 1 ? "high" : ""}">
        <div><strong>${escapeHtml(n.name)}</strong><div class="muted">Salida lógica</div></div>
        <div class="big-value">${n.value ?? "?"}</div>
      </div>
    `).join("");
  }

  function expressionMap() {
    const map = new Map();
    for (const node of state.nodes) map.set(node.id, node.type === "INPUT" ? node.name : null);
    const precedence = { OR: 1, XOR: 2, AND: 3, NAND: 3, NOR: 1, XNOR: 2, NOT: 4, OUTPUT: 5 };

    const wrap = (expr, childType, parentType) => {
      if (!expr) return "?";
      const childP = precedence[childType] ?? 99;
      const parentP = precedence[parentType] ?? 99;
      return childP < parentP ? `(${expr})` : expr;
    };

    for (let pass = 0; pass < state.nodes.length + 2; pass++) {
      let changed = false;
      for (const node of state.nodes) {
        if (node.type === "INPUT") continue;
        const conns = Array.from({ length: getInputCount(node) }, (_, i) => state.connections.find(c => c.to === node.id && c.toPort === i));
        if (conns.some(c => !c)) continue;
        const sources = conns.map(c => getNode(c.from));
        const exprs = conns.map(c => map.get(c.from));
        if (exprs.some(e => !e)) continue;
        const joinWrapped = (operator, parentType) => exprs
          .map((item, index) => wrap(item, sources[index].type, parentType))
          .join(operator);
        let expr = null;
        if (node.type === "OUTPUT") expr = exprs[0];
        if (node.type === "NOT") expr = `${wrap(exprs[0], sources[0].type, "NOT")}'`;
        if (node.type === "AND") expr = joinWrapped("·", "AND");
        if (node.type === "OR") expr = joinWrapped(" + ", "OR");
        if (node.type === "XOR") expr = joinWrapped(" ⊕ ", "XOR");
        if (node.type === "NAND") expr = `(${joinWrapped("·", "AND")})'`;
        if (node.type === "NOR") expr = `(${joinWrapped(" + ", "OR")})'`;
        if (node.type === "XNOR") expr = `(${joinWrapped(" ⊕ ", "XOR")})'`;
        if (map.get(node.id) !== expr) { map.set(node.id, expr); changed = true; }
      }
      if (!changed) break;
    }
    return map;
  }

  function getGeneratedEquations() {
    const map = expressionMap();
    return state.nodes.filter(n => n.type === "OUTPUT").map(n => ({ name: n.name, expr: map.get(n.id) || "?" }));
  }

  function updateGeneratedEquation() {
    const equations = getGeneratedEquations();
    els.generatedEquation.textContent = equations.length ? equations.map(e => `${e.name} = ${e.expr}`).join("\n") : "—";
  }

  function switchTab(name) {
    $$(".tab").forEach(tab => tab.classList.toggle("active", tab.dataset.tab === name));
    $$(".tab-panel").forEach(panel => panel.classList.remove("active"));
    $(`#${name}Tab`)?.classList.add("active");
    if (name === "truth" && state.truthMode === "circuit") generateCircuitTruthTable();
    setTimeout(renderWires, 0);
  }

  function generateCircuitTruthTable() {
    const inputs = state.nodes.filter(n => n.type === "INPUT").sort((a, b) => a.name.localeCompare(b.name));
    const outputs = state.nodes.filter(n => n.type === "OUTPUT").sort((a, b) => a.name.localeCompare(b.name));
    state.truthMode = "circuit";
    els.truthSourceLabel.textContent = "Se genera desde el circuito actual.";

    if (!inputs.length || !outputs.length) {
      els.truthTableContainer.className = "truth-table-wrap empty-state";
      els.truthTableContainer.textContent = "Agrega al menos una entrada y una salida en el circuito.";
      return;
    }
    if (inputs.length > MAX_TRUTH_INPUTS) {
      els.truthTableContainer.className = "truth-table-wrap empty-state";
      els.truthTableContainer.textContent = `El límite es de ${MAX_TRUTH_INPUTS} entradas para evitar una tabla demasiado grande.`;
      return;
    }

    const headers = [...inputs.map(n => n.name), ...outputs.map(n => n.name)];
    const rows = [];
    const total = 2 ** inputs.length;
    for (let i = 0; i < total; i++) {
      const overrides = new Map();
      const inputBits = inputs.map((node, index) => {
        const bit = (i >> (inputs.length - index - 1)) & 1;
        overrides.set(node.id, bit);
        return bit;
      });
      const values = evaluateNetwork(overrides);
      rows.push([...inputBits, ...outputs.map(o => values.get(o.id) ?? "?")]);
    }
    renderTruthTable(headers, rows, inputs.length);
  }

  function generateExpressionTruthTable(expression) {
    let ast;
    try { ast = parseExpression(expression); }
    catch (error) { showToast(error.message); return; }
    const vars = [...collectVariables(ast)].sort();
    if (vars.length > MAX_TRUTH_INPUTS) {
      showToast(`Máximo ${MAX_TRUTH_INPUTS} variables en la tabla`);
      return;
    }
    const rows = [];
    for (let i = 0; i < 2 ** vars.length; i++) {
      const env = {};
      const bits = vars.map((name, index) => {
        const bit = (i >> (vars.length - index - 1)) & 1;
        env[name] = Boolean(bit);
        return bit;
      });
      rows.push([...bits, evaluateAst(ast, env) ? 1 : 0]);
    }
    state.truthMode = "expression";
    els.truthSourceLabel.textContent = `Se genera desde: ${expression}`;
    renderTruthTable([...vars, "S"], rows, vars.length);
    switchTab("truth");
  }

  function renderTruthTable(headers, rows, inputCount) {
    state.truthHeaders = headers;
    state.truthRows = rows;
    state.truthCsv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    els.truthTableContainer.className = "truth-table-wrap";
    els.truthTableContainer.innerHTML = `
      <table class="truth-table">
        <thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map(row => `<tr>${row.map((v, index) => `<td class="${index >= inputCount ? `output-cell ${v === 1 ? "high" : ""}` : ""}">${v}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    `;
  }

  function tokenize(expression) {
    const raw = String(expression || "").replace(/\s+/g, "");
    if (!raw) throw new Error("Escribe una ecuación primero");
    const tokens = [];
    let i = 0;
    while (i < raw.length) {
      const ch = raw[i];
      if (/[A-Za-z]/.test(ch)) {
        let name = ch;
        i++;
        while (i < raw.length && /[0-9_]/.test(raw[i])) name += raw[i++];
        tokens.push({ type: "VAR", value: name.toUpperCase() });
        continue;
      }
      if (ch === "0" || ch === "1") { tokens.push({ type: "CONST", value: ch }); i++; continue; }
      if (ch === "!" || ch === "¬" || ch === "~") { tokens.push({ type: "NOT", value: ch }); i++; continue; }
      if (ch === "'") { tokens.push({ type: "POST_NOT", value: ch }); i++; continue; }
      if (ch === "*" || ch === "·" || ch === "&") { tokens.push({ type: "AND", value: ch }); i++; continue; }
      if (ch === "+" || ch === "|") { tokens.push({ type: "OR", value: ch }); i++; continue; }
      if (ch === "^" || ch === "⊕") { tokens.push({ type: "XOR", value: ch }); i++; continue; }
      if (ch === "(") { tokens.push({ type: "LP", value: ch }); i++; continue; }
      if (ch === ")") { tokens.push({ type: "RP", value: ch }); i++; continue; }
      throw new Error(`Símbolo no reconocido: ${ch}`);
    }

    const withImplicit = [];
    const endsAtom = t => ["VAR", "CONST", "RP", "POST_NOT"].includes(t.type);
    const startsAtom = t => ["VAR", "CONST", "LP", "NOT"].includes(t.type);
    tokens.forEach((token, index) => {
      const prev = tokens[index - 1];
      if (prev && endsAtom(prev) && startsAtom(token)) withImplicit.push({ type: "AND", value: "·" });
      withImplicit.push(token);
    });
    return withImplicit;
  }

  function parseExpression(expression) {
    const tokens = tokenize(expression);
    let pos = 0;
    const peek = () => tokens[pos];
    const take = type => {
      if (peek()?.type === type) return tokens[pos++];
      return null;
    };

    function parseOr() {
      let node = parseXor();
      while (take("OR")) node = { type: "OR", left: node, right: parseXor() };
      return node;
    }
    function parseXor() {
      let node = parseAnd();
      while (take("XOR")) node = { type: "XOR", left: node, right: parseAnd() };
      return node;
    }
    function parseAnd() {
      let node = parseUnary();
      while (take("AND")) node = { type: "AND", left: node, right: parseUnary() };
      return node;
    }
    function parseUnary() {
      if (take("NOT")) return { type: "NOT", value: parseUnary() };
      let node = parsePrimary();
      while (take("POST_NOT")) node = { type: "NOT", value: node };
      return node;
    }
    function parsePrimary() {
      const variable = take("VAR");
      if (variable) return { type: "VAR", name: variable.value };
      const constant = take("CONST");
      if (constant) return { type: "CONST", value: constant.value === "1" };
      if (take("LP")) {
        const node = parseOr();
        if (!take("RP")) throw new Error("Falta cerrar un paréntesis")
        return node;
      }
      throw new Error("La ecuación está incompleta o tiene un operador fuera de lugar");
    }

    const ast = parseOr();
    if (pos !== tokens.length) throw new Error("No se pudo interpretar toda la ecuación");
    return ast;
  }

  function evaluateAst(ast, env) {
    switch (ast.type) {
      case "VAR": return Boolean(env[ast.name]);
      case "CONST": return ast.value;
      case "NOT": return !evaluateAst(ast.value, env);
      case "AND": return evaluateAst(ast.left, env) && evaluateAst(ast.right, env);
      case "OR": return evaluateAst(ast.left, env) || evaluateAst(ast.right, env);
      case "XOR": return evaluateAst(ast.left, env) !== evaluateAst(ast.right, env);
      default: return false;
    }
  }

  function collectVariables(ast, set = new Set()) {
    if (ast.type === "VAR") set.add(ast.name);
    if (ast.value && typeof ast.value === "object") collectVariables(ast.value, set);
    if (ast.left) collectVariables(ast.left, set);
    if (ast.right) collectVariables(ast.right, set);
    return set;
  }

  function expressionsEquivalent(a, b) {
    const astA = parseExpression(a);
    const astB = parseExpression(b);
    const vars = [...new Set([...collectVariables(astA), ...collectVariables(astB)])].sort();
    if (vars.length > MAX_TRUTH_INPUTS) throw new Error(`Máximo ${MAX_TRUTH_INPUTS} variables para comparar`);
    for (let i = 0; i < 2 ** vars.length; i++) {
      const env = {};
      vars.forEach((name, index) => { env[name] = Boolean((i >> (vars.length - index - 1)) & 1); });
      if (evaluateAst(astA, env) !== evaluateAst(astB, env)) {
        const caseText = vars.map(v => `${v}=${env[v] ? 1 : 0}`).join(", ");
        return { equivalent: false, counterexample: caseText };
      }
    }
    return { equivalent: true };
  }

  function simplifyExpression(expression) {
    return simplifyExpressionDetailed(expression).result;
  }

  function simplifyExpressionDetailed(expression) {
    const ast = parseExpression(expression);
    const vars = [...collectVariables(ast)].sort();
    if (vars.length > MAX_SIMPLIFY_VARS) throw new Error(`La simplificación automática admite hasta ${MAX_SIMPLIFY_VARS} variables`);

    const minterms = [];
    for (let i = 0; i < 2 ** vars.length; i++) {
      const env = {};
      vars.forEach((name, index) => { env[name] = Boolean((i >> (vars.length - index - 1)) & 1); });
      if (evaluateAst(ast, env)) minterms.push(i);
    }

    const steps = [{
      title: "Identificar variables",
      text: vars.length ? `Se ordenan las variables como ${vars.join(", ")}. Se evaluarán ${2 ** vars.length} combinaciones.` : "La expresión no contiene variables; es una constante.",
      expression: vars.length ? `F(${vars.join(", ")})` : "F",
      details: [],
    }];

    steps.push({
      title: "Encontrar las combinaciones donde la salida vale 1",
      text: minterms.length ? "Cada número de mintermino corresponde a una fila de la tabla de verdad con salida igual a 1." : "No existe ninguna combinación con salida igual a 1.",
      expression: minterms.length ? `F = Σm(${minterms.join(", ")})` : "F = 0",
      details: minterms.map(m => `${m}: ${m.toString(2).padStart(vars.length, "0") || "0"}`).slice(0, 32),
    });

    if (!minterms.length) {
      const result = "0";
      steps.push({ title: "Resultado", text: "Como la salida nunca vale 1, la función es siempre cero.", expression: "F = 0", details: [] });
      return {
        result, steps, vars, minterms, chosen: [],
        karnaugh: buildKarnaughData(vars, minterms, [], result),
        algebraSteps: buildAlgebraProcedure(expression, vars, minterms, [], result),
      };
    }

    if (minterms.length === 2 ** vars.length) {
      const result = "1";
      steps.push({ title: "Resultado", text: "Todas las combinaciones producen 1, por lo que la función es una tautología.", expression: "F = 1", details: [] });
      const chosen = vars.length ? [{ pattern: "-".repeat(vars.length), covers: new Set(minterms) }] : [];
      return {
        result, steps, vars, minterms, chosen,
        karnaugh: buildKarnaughData(vars, minterms, chosen, result),
        algebraSteps: buildAlgebraProcedure(expression, vars, minterms, chosen, result),
      };
    }

    const canonicalTerms = minterms.map(m => termToExpression(m.toString(2).padStart(vars.length, "0"), vars));
    steps.push({
      title: "Escribir la forma canónica SOP",
      text: "Cada mintermino se convierte en un producto. Un bit 0 niega la variable y un bit 1 la deja directa.",
      expression: canonicalTerms.join(" + "),
      details: [],
    });

    const qm = quineMcCluskeyDetailed(minterms, vars.length);
    qm.rounds.forEach((round, roundIndex) => {
      const details = round.combinations.slice(0, 24).map(item => {
        const left = termToExpression(item.left, vars);
        const right = termToExpression(item.right, vars);
        const result = termToExpression(item.result, vars);
        const removedIndex = [...item.left].findIndex((ch, i) => ch !== item.right[i]);
        const removedVar = removedIndex >= 0 ? vars[removedIndex] : "una variable";
        return `${left} + ${right} → ${result}  (se elimina ${removedVar} porque cambia de 0 a 1)`;
      });
      if (round.combinations.length > 24) details.push(`… y ${round.combinations.length - 24} agrupaciones más.`);
      steps.push({
        title: `Agrupación ${roundIndex + 1}`,
        text: round.combinations.length
          ? "Se combinan términos que difieren en una sola variable. Esto aplica la forma X'Y + XY = Y. El guion indica la variable eliminada."
          : "En esta ronda ya no hay términos que puedan combinarse.",
        expression: round.outputPatterns.length ? round.outputPatterns.join(" , ") : "Sin nuevas combinaciones",
        details,
      });
    });

    const primeDetails = qm.primes.map(prime => {
      const covered = minterms.filter(m => patternCovers(prime.pattern, m, vars.length));
      return `${prime.pattern} = ${termToExpression(prime.pattern, vars)} cubre m(${covered.join(", ")})`;
    });
    steps.push({
      title: "Obtener los implicantes primos",
      text: "Son los grupos máximos que ya no pueden seguir combinándose.",
      expression: qm.primes.map(prime => termToExpression(prime.pattern, vars)).join(" , "),
      details: primeDetails,
    });

    const chosen = choosePrimeCover(qm.primes, minterms);
    const result = chosen.map(term => termToExpression(term.pattern, vars)).join(" + ");
    steps.push({
      title: "Elegir la cobertura mínima",
      text: "Se conservan los implicantes esenciales y, si hace falta, la combinación con menor cantidad de términos y literales.",
      expression: chosen.map(term => termToExpression(term.pattern, vars)).join(" + "),
      details: chosen.map(term => {
        const covered = minterms.filter(m => patternCovers(term.pattern, m, vars.length));
        return `${termToExpression(term.pattern, vars)} cubre m(${covered.join(", ")})`;
      }),
    });
    steps.push({
      title: "Resultado simplificado",
      text: "Esta es la forma mínima SOP obtenida y es equivalente a la expresión original.",
      expression: `F = ${result}`,
      details: [],
    });

    return {
      result, steps, vars, minterms, chosen,
      karnaugh: buildKarnaughData(vars, minterms, chosen, result),
      algebraSteps: buildAlgebraProcedure(expression, vars, minterms, chosen, result),
    };
  }

  function grayCodes(bitCount) {
    if (bitCount <= 0) return [""];
    return Array.from({ length: 2 ** bitCount }, (_, value) => (value ^ (value >> 1)).toString(2).padStart(bitCount, "0"));
  }

  function assignmentText(names, bits) {
    if (!names.length) return "Mapa único";
    return names.map((name, index) => `${name}=${bits[index]}`).join(", ");
  }

  function buildKarnaughData(vars, minterms, chosen, result) {
    const bitCount = vars.length;
    if (!bitCount) {
      return {
        vars, minterms, groups: [], layers: [], result,
        steps: [
          { title: "Evaluar la constante", text: `La función no tiene variables y su valor es ${result}.` },
          { title: "Resultado", text: `No se necesita mapa: F = ${result}.` },
        ],
      };
    }

    const layerBits = Math.max(0, bitCount - 4);
    const mapBits = bitCount - layerBits;
    const rowBits = Math.floor(mapBits / 2);
    const colBits = mapBits - rowBits;
    const layerNames = vars.slice(0, layerBits);
    const rowNames = vars.slice(layerBits, layerBits + rowBits);
    const colNames = vars.slice(layerBits + rowBits);
    const layerCodes = grayCodes(layerBits);
    const rowCodes = grayCodes(rowBits);
    const colCodes = grayCodes(colBits);

    const groups = chosen.map((term, index) => {
      const covered = minterms.filter(m => patternCovers(term.pattern, m, bitCount));
      const fixed = [...term.pattern].map((bit, i) => bit === "-" ? null : `${vars[i]}=${bit}`).filter(Boolean);
      const eliminated = [...term.pattern].map((bit, i) => bit === "-" ? vars[i] : null).filter(Boolean);
      return {
        index,
        label: `G${index + 1}`,
        pattern: term.pattern,
        term: termToExpression(term.pattern, vars),
        minterms: covered,
        size: covered.length,
        fixed,
        eliminated,
      };
    });

    const layers = layerCodes.map(layerCode => ({
      code: layerCode,
      title: assignmentText(layerNames, layerCode),
      rowLabel: rowNames.length ? rowNames.join("") : "—",
      colLabel: colNames.length ? colNames.join("") : "—",
      rowCodes,
      colCodes,
      rows: rowCodes.map(rowCode => ({
        code: rowCode,
        cells: colCodes.map(colCode => {
          const bits = `${layerCode}${rowCode}${colCode}`;
          const minterm = parseInt(bits || "0", 2);
          return {
            bits,
            minterm,
            value: minterms.includes(minterm) ? 1 : 0,
            groups: groups.filter(group => group.minterms.includes(minterm)).map(group => group.index),
          };
        }),
      })),
    }));

    const mapDescription = layerBits
      ? `${2 ** layerBits} mapas de ${2 ** rowBits}×${2 ** colBits}; ${layerNames.join("")} selecciona la capa, ${rowNames.join("") || "—"} las filas y ${colNames.join("") || "—"} las columnas.`
      : `Mapa de ${2 ** rowBits}×${2 ** colBits}; ${rowNames.join("") || "—"} está en las filas y ${colNames.join("") || "—"} en las columnas.`;

    return {
      vars, minterms, groups, layers, result,
      axis: { layerNames, rowNames, colNames },
      steps: [
        {
          title: "Ordenar variables y ejes",
          text: `${mapDescription} Los encabezados usan código Gray para que dos celdas vecinas cambien solamente en una variable.`,
        },
        {
          title: "Llenar el mapa",
          text: minterms.length ? `Se coloca 1 en m(${minterms.join(", ")}) y 0 en las demás celdas.` : "Todas las celdas contienen 0.",
        },
        {
          title: "Formar grupos máximos",
          text: groups.length
            ? `Se eligieron ${groups.length} grupo${groups.length === 1 ? "" : "s"}. Cada grupo contiene 1, 2, 4, 8… celdas; los bordes opuestos también son adyacentes.`
            : "No existen unos que agrupar.",
        },
        {
          title: "Leer variables constantes",
          text: groups.length
            ? "En cada grupo se conservan las variables que no cambian. Las variables que alternan entre 0 y 1 se eliminan."
            : `La salida final es F = ${result}.`,
        },
      ],
    };
  }

  function allCombinationTerms(varNames, compact = false) {
    if (!varNames.length) return ["1"];
    const separator = compact ? "" : "·";
    return Array.from({ length: 2 ** varNames.length }, (_, value) => {
      const bits = value.toString(2).padStart(varNames.length, "0");
      return [...bits].map((bit, index) => bit === "1" ? varNames[index] : `${varNames[index]}'`).join(separator);
    });
  }

  function compactTermToExpression(pattern, vars) {
    return termToExpression(pattern, vars).replaceAll("·", "");
  }

  function compactMintermToExpression(minterm, vars) {
    return compactTermToExpression(minterm.toString(2).padStart(vars.length, "0"), vars);
  }

  function naturalList(items) {
    if (!items.length) return "";
    if (items.length === 1) return items[0];
    if (items.length === 2) return `${items[0]} y ${items[1]}`;
    return `${items.slice(0, -1).join(", ")} y ${items.at(-1)}`;
  }

  function quantityWord(value) {
    return ({ 1: "un", 2: "dos", 4: "cuatro", 8: "ocho", 16: "dieciséis", 32: "treinta y dos" })[value] || String(value);
  }

  function wrapCompactFactor(fixedFactor, inner) {
    if (!fixedFactor || fixedFactor === "1") return inner;
    if (!inner || inner === "1") return fixedFactor;
    const hasInnerParentheses = inner.includes("(");
    return `${fixedFactor}${hasInnerParentheses ? `[${inner}]` : `(${inner})`}`;
  }

  function buildNaturalAlgebraGroup(pattern, vars, minterms, index) {
    const covered = minterms.filter(m => patternCovers(pattern, m, vars.length));
    const canonicalTerms = covered.map(m => compactMintermToExpression(m, vars));
    const varyingVars = [...pattern].map((bit, i) => bit === "-" ? vars[i] : null).filter(Boolean);
    const fixedFactor = compactTermToExpression(pattern, vars);
    const blocks = [];

    if (!varyingVars.length) {
      blocks.push({
        type: "text",
        text: "Este término no tiene otro mintermino adyacente con el cual combinarse, por eso se conserva completo.",
      });
      blocks.push({ type: "caption", text: "El término queda igual:" });
      blocks.push({ type: "equation", expression: canonicalTerms[0] || fixedFactor });
      return { index, covered, pattern, term: fixedFactor, varyingVars, canonicalTerms, blocks };
    }

    const commonText = fixedFactor === "1"
      ? "En este grupo no queda una variable fija: todas cambian entre 0 y 1."
      : `Observa que todos los términos tienen ${fixedFactor} como factor común.`;
    blocks.push({ type: "text", text: commonText });
    blocks.push({
      type: "text",
      text: `${varyingVars.length === 1 ? "La variable" : "Las variables"} ${naturalList(varyingVars)} ${varyingVars.length === 1 ? "cambia" : "cambian"} de directa a negada dentro del grupo.`,
    });
    blocks.push({ type: "equation", expression: canonicalTerms.join(" + ") });

    const initialInner = allCombinationTerms(varyingVars, true).join(" + ");
    blocks.push({ type: "caption", text: fixedFactor === "1" ? "Reordenamos los términos:" : "Factorizamos el término común:" });
    blocks.push({ type: "equation", expression: wrapCompactFactor(fixedFactor, initialInner) });

    let remaining = [...varyingVars];
    while (remaining.length) {
      const variable = remaining.at(-1);
      const prefixVars = remaining.slice(0, -1);

      if (remaining.length > 1) {
        const prefixes = allCombinationTerms(prefixVars, true);
        const paired = prefixes.map(prefix => {
          const prefixText = prefix === "1" ? "" : prefix;
          return `${prefixText}(${variable}' + ${variable})`;
        }).join(" + ");
        blocks.push({ type: "caption", text: `Agrupamos respecto a ${variable}:` });
        blocks.push({ type: "equation", expression: wrapCompactFactor(fixedFactor, paired) });
      }

      blocks.push({ type: "caption", text: "Aplicamos complemento:" });
      blocks.push({ type: "equation rule-equation", expression: `${variable}' + ${variable} = 1` });

      remaining = prefixVars;
      const reducedInner = allCombinationTerms(remaining, true).join(" + ");
      blocks.push({ type: "caption", text: "Entonces:" });
      blocks.push({ type: "equation", expression: wrapCompactFactor(fixedFactor, reducedInner) });
    }

    blocks.push({
      type: "rule",
      text: `Reglas usadas: factorización, complemento (${varyingVars.map(variable => `${variable}' + ${variable} = 1`).join(", ")}) e identidad (X·1 = X).`,
    });

    return { index, covered, pattern, term: fixedFactor, varyingVars, canonicalTerms, blocks };
  }

  function buildAlgebraProcedure(originalExpression, vars, minterms, chosen, result) {
    const prettyOriginal = normalizeDisplayExpression(originalExpression).replaceAll("*", "").replaceAll("·", "");
    const steps = [{
      title: "Preparación. Partimos de la función original",
      text: "Primero escribimos la función de forma clara antes de comenzar a agrupar.",
      expression: `F = ${prettyOriginal}`,
      details: [],
      badge: "Inicio",
    }];

    if (!vars.length) {
      steps.push({
        title: "Resultado",
        text: "La expresión no contiene variables, por lo que no requiere simplificación algebraica.",
        expression: `F = ${result}`,
        details: [],
        badge: "Constante",
      });
      return steps;
    }

    if (!minterms.length) {
      steps.push({
        title: "Resultado",
        text: "No existe ninguna combinación de entradas que produzca 1.",
        expression: "F = 0",
        details: ["La función siempre vale cero."],
        badge: "Nulidad",
      });
      return steps;
    }

    const canonicalTerms = minterms.map(m => compactMintermToExpression(m, vars));
    steps.push({
      title: "Preparación. Escribimos la forma SOP",
      text: "Cada fila de la tabla de verdad con salida 1 se convierte en un producto. Así podemos observar qué términos sólo cambian en una variable.",
      expression: `F = ${canonicalTerms.join(" + ")}`,
      details: [`F = Σm(${minterms.join(", ")})`],
      badge: "Forma canónica",
    });

    if (minterms.length === 2 ** vars.length) {
      steps.push({
        title: "Paso 1. Agrupamos todas las combinaciones",
        text: "Como aparecen todos los minterminos posibles, cada variable se presenta directa y negada.",
        badge: "Complemento",
        algebra: buildNaturalAlgebraGroup("-".repeat(vars.length), vars, minterms, 0),
      });
      steps.push({
        title: "Resultado final",
        text: "La función vale 1 para cualquier combinación de entradas.",
        expression: "F = 1",
        details: [],
        badge: "Resultado",
      });
      return steps;
    }

    const derivations = chosen.map((term, index) => buildNaturalAlgebraGroup(term.pattern, vars, minterms, index));
    const coverageCount = new Map(minterms.map(m => [m, 0]));
    derivations.forEach(group => group.covered.forEach(m => coverageCount.set(m, (coverageCount.get(m) || 0) + 1)));
    const repeated = [...coverageCount.entries()].filter(([, count]) => count > 1);

    if (repeated.length) {
      const repeatedNames = repeated.map(([m]) => compactMintermToExpression(m, vars));
      const expandedCopies = derivations.flatMap(group => group.canonicalTerms);
      steps.push({
        title: "Preparación. Repetimos los términos compartidos",
        text: `Los términos ${naturalList(repeatedNames)} participan en más de un grupo. Podemos repetirlos porque la ley idempotente establece que X + X = X.`,
        expression: `F = ${expandedCopies.join(" + ")}`,
        details: repeated.map(([m, count]) => `${compactMintermToExpression(m, vars)} se usa ${count} veces.`),
        badge: "Idempotencia",
      });
    }

    const groupedExpression = derivations.map(group => `(${group.canonicalTerms.join(" + ")})`).join(" + ");
    steps.push({
      title: "Preparación. Reordenamos los términos",
      text: "Aplicamos las leyes conmutativa y asociativa para colocar juntos los minterminos que sólo difieren en las variables que serán eliminadas.",
      expression: `F = ${groupedExpression}`,
      details: derivations.map((group, index) => `Grupo ${index + 1}: m(${group.covered.join(", ")})`),
      badge: "Conmutativa y asociativa",
    });

    derivations.forEach((group, index) => {
      const amount = quantityWord(group.canonicalTerms.length);
      const title = group.canonicalTerms.length === 1
        ? `Paso ${index + 1}. Conserva el término sin pareja`
        : `Paso ${index + 1}. Agrupa los ${amount} términos`;

      const substitutedParts = [
        ...derivations.slice(0, index + 1).map(item => item.term),
        ...derivations.slice(index + 1).map(item => `(${item.canonicalTerms.join(" + ")})`),
      ];
      group.blocks.push({ type: "caption", text: "Sustituimos este resultado en la función:" });
      group.blocks.push({ type: "equation", expression: `F = ${substitutedParts.join(" + ")}` });

      steps.push({
        title,
        text: group.canonicalTerms.length === 1
          ? "Este mintermino es necesario para cubrir una combinación que ningún grupo mayor puede cubrir."
          : `Trabajamos únicamente con ${naturalList(group.canonicalTerms)} y dejamos los demás grupos sin modificar.`,
        details: [],
        badge: `Grupo ${index + 1}`,
        algebra: group,
      });
    });

    const combined = derivations.map(group => group.term).join(" + ") || result;
    steps.push({
      title: "Resultado final",
      text: "Sustituimos cada grupo por el término que obtuvimos y sumamos los resultados.",
      expression: `F = ${combined}`,
      details: combined === result ? ["La expresión ya no puede reducirse más con las reglas básicas."] : [`Forma mínima equivalente: F = ${result}`],
      badge: "Simplificación completa",
    });
    return steps;
  }

  function quineMcCluskey(minterms, bitCount) {
    return quineMcCluskeyDetailed(minterms, bitCount).primes;
  }

  function quineMcCluskeyDetailed(minterms, bitCount) {
    let current = minterms.map(m => ({ pattern: m.toString(2).padStart(bitCount, "0"), covers: new Set([m]), used: false }));
    const primes = [];
    const rounds = [];

    while (current.length) {
      const nextMap = new Map();
      const combinations = [];
      const seenCombinations = new Set();
      current.forEach(t => { t.used = false; });
      for (let i = 0; i < current.length; i++) {
        for (let j = i + 1; j < current.length; j++) {
          const combined = combinePatterns(current[i].pattern, current[j].pattern);
          if (combined) {
            current[i].used = true;
            current[j].used = true;
            const key = combined;
            if (!nextMap.has(key)) nextMap.set(key, { pattern: key, covers: new Set(), used: false });
            current[i].covers.forEach(v => nextMap.get(key).covers.add(v));
            current[j].covers.forEach(v => nextMap.get(key).covers.add(v));
            const comboKey = `${current[i].pattern}|${current[j].pattern}|${combined}`;
            if (!seenCombinations.has(comboKey)) {
              seenCombinations.add(comboKey);
              combinations.push({ left: current[i].pattern, right: current[j].pattern, result: combined });
            }
          }
        }
      }
      current.filter(t => !t.used).forEach(t => {
        if (!primes.some(p => p.pattern === t.pattern)) primes.push(t);
      });
      const next = [...nextMap.values()];
      rounds.push({
        inputPatterns: current.map(item => item.pattern),
        outputPatterns: next.map(item => item.pattern),
        combinations,
      });
      current = next;
    }
    return { primes, rounds };
  }

  function combinePatterns(a, b) {
    let differences = 0;
    let result = "";
    for (let i = 0; i < a.length; i++) {
      if (a[i] === b[i]) result += a[i];
      else {
        if (a[i] === "-" || b[i] === "-") return null;
        differences++;
        result += "-";
      }
      if (differences > 1) return null;
    }
    return differences === 1 ? result : null;
  }

  function patternCovers(pattern, minterm, bitCount) {
    const bits = minterm.toString(2).padStart(bitCount, "0");
    return [...pattern].every((ch, i) => ch === "-" || ch === bits[i]);
  }

  function choosePrimeCover(primes, minterms) {
    const bitCount = primes[0]?.pattern.length || 0;
    const coverMap = new Map(minterms.map(m => [m, primes.map((p, i) => patternCovers(p.pattern, m, bitCount) ? i : -1).filter(i => i >= 0)]));
    const selected = new Set();

    for (const indexes of coverMap.values()) if (indexes.length === 1) selected.add(indexes[0]);
    const covered = new Set();
    selected.forEach(i => minterms.forEach(m => { if (patternCovers(primes[i].pattern, m, bitCount)) covered.add(m); }));
    const remaining = minterms.filter(m => !covered.has(m));
    if (!remaining.length) return [...selected].map(i => primes[i]);

    const candidates = primes.map((_, i) => i).filter(i => !selected.has(i));
    let best = null;
    const totalCombos = 2 ** candidates.length;
    for (let mask = 1; mask < totalCombos; mask++) {
      const combo = candidates.filter((_, idx) => (mask >> idx) & 1);
      if (best && combo.length > best.length) continue;
      const ok = remaining.every(m => combo.some(i => patternCovers(primes[i].pattern, m, bitCount)));
      if (!ok) continue;
      const literals = combo.reduce((sum, i) => sum + [...primes[i].pattern].filter(ch => ch !== "-").length, 0);
      if (!best || combo.length < best.length || (combo.length === best.length && literals < best.literals)) {
        best = combo;
        best.literals = literals;
      }
    }
    const all = [...selected, ...(best || [])];
    return all.map(i => primes[i]);
  }

  function termToExpression(pattern, vars) {
    const parts = [...pattern].map((ch, i) => ch === "-" ? "" : ch === "1" ? vars[i] : `${vars[i]}'`).filter(Boolean);
    return parts.length ? parts.join("·") : "1";
  }

  function addEquationStep() {
    const original = els.originalExpression.value.trim();
    const expression = els.stepExpression.value.trim();
    if (!original || !expression) { showToast("Escribe la ecuación original y el nuevo paso"); return; }
    let status;
    try { status = expressionsEquivalent(original, expression); }
    catch (error) { showToast(error.message); return; }
    pushUndoSnapshot();
    state.equationSteps.push({ expression, rule: els.stepRule.value || "Sin especificar", equivalent: status.equivalent, counterexample: status.counterexample || "" });
    els.stepExpression.value = "";
    renderSteps();
  }

  function renderSteps() {
    if (!state.equationSteps.length) {
      els.stepsList.className = "steps-list empty-state";
      els.stepsList.textContent = "Todavía no hay pasos.";
      return;
    }
    els.stepsList.className = "steps-list";
    els.stepsList.innerHTML = state.equationSteps.map((step, index) => `
      <div class="step-item">
        <div class="step-number">${index + 1}</div>
        <div>
          <div class="step-expression">${escapeHtml(step.expression)}</div>
          <div class="step-rule">${escapeHtml(step.rule)}${step.counterexample ? ` · Falla en ${escapeHtml(step.counterexample)}` : ""}</div>
        </div>
        <span class="step-status ${step.equivalent ? "ok" : "bad"}">${step.equivalent ? "Equivalente" : "No equivalente"}</span>
        <button class="icon-btn danger remove-step" data-index="${index}" title="Eliminar paso">×</button>
      </div>
    `).join("");
    $$(".remove-step").forEach(button => button.addEventListener("click", () => {
      pushUndoSnapshot();
      state.equationSteps.splice(Number(button.dataset.index), 1);
      renderSteps();
    }));
  }

  function renderProcedureList(container, steps, emptyText, algebraMode = false) {
    if (!steps.length) {
      container.className = "procedure-list empty-state";
      container.textContent = emptyText;
      return;
    }
    container.className = "procedure-list";
    container.innerHTML = steps.map((step, index) => `
      <article class="procedure-step">
        <div class="procedure-number">${index + 1}</div>
        <div class="procedure-content">
          ${step.badge ? `<span class="procedure-badge">${escapeHtml(step.badge)}</span>` : ""}
          <strong>${escapeHtml(step.title || `Paso ${index + 1}`)}</strong>
          ${step.text ? `<p>${escapeHtml(step.text)}</p>` : ""}
          ${step.expression ? `<div class="procedure-expression">${escapeHtml(step.expression)}</div>` : ""}
          ${Array.isArray(step.details) && step.details.length ? `<div class="procedure-details">${step.details.map(detail => `<div class="procedure-detail">${escapeHtml(detail)}</div>`).join("")}</div>` : ""}
          ${algebraMode && step.algebra ? `
            <div class="algebra-group">
              <div class="algebra-group-title">
                <strong>${escapeHtml(step.algebra.label)}</strong>
                <span>m(${escapeHtml(step.algebra.covered.join(", "))}) · patrón ${escapeHtml(step.algebra.pattern)}</span>
              </div>
              ${step.algebra.lines.map(line => `
                <div class="algebra-line">
                  ${escapeHtml(line.expression)}
                  <div class="algebra-rule">${escapeHtml(line.rule)}</div>
                </div>
              `).join("")}
            </div>
          ` : ""}
        </div>
      </article>
    `).join("");
  }

  function renderSimplificationProcedure() {
    renderProcedureList(
      els.simplificationProcedure,
      state.simplificationProcedure,
      "Simplifica una ecuación para ver el procedimiento tabular.",
    );
  }

  function renderAlgebraProcedure() {
    const steps = state.algebraProcedure;
    if (!steps.length) {
      els.algebraProcedure.className = "procedure-list empty-state";
      els.algebraProcedure.textContent = "Simplifica una ecuación para ver el desarrollo algebraico.";
      return;
    }

    els.algebraProcedure.className = "procedure-list algebra-natural";
    els.algebraProcedure.innerHTML = steps.map((step, index) => {
      const blocks = step.algebra?.blocks || [];
      return `
        <article class="algebra-story-step ${step.badge === "Resultado" || step.badge === "Simplificación completa" ? "is-result" : ""}">
          <div class="algebra-story-head">
            <span class="algebra-story-index">${index + 1}</span>
            <div>
              ${step.badge ? `<span class="procedure-badge">${escapeHtml(step.badge)}</span>` : ""}
              <h3>${escapeHtml(step.title || `Paso ${index + 1}`)}</h3>
            </div>
          </div>
          ${step.text ? `<p class="algebra-story-intro">${escapeHtml(step.text)}</p>` : ""}
          ${step.expression ? `<div class="algebra-story-equation">${escapeHtml(step.expression)}</div>` : ""}
          ${Array.isArray(step.details) && step.details.length ? `
            <div class="algebra-story-details">
              ${step.details.map(detail => `<div>${escapeHtml(detail)}</div>`).join("")}
            </div>
          ` : ""}
          ${blocks.length ? `
            <div class="algebra-story-body">
              ${blocks.map(block => {
                if (block.type === "equation" || block.type === "equation rule-equation") {
                  return `<div class="algebra-story-equation ${block.type.includes("rule-equation") ? "rule-equation" : ""}">${escapeHtml(block.expression)}</div>`;
                }
                if (block.type === "caption") {
                  return `<p class="algebra-story-caption">${escapeHtml(block.text)}</p>`;
                }
                if (block.type === "rule") {
                  return `<div class="algebra-story-rule">${escapeHtml(block.text)}</div>`;
                }
                return `<p class="algebra-story-text">${escapeHtml(block.text || "")}</p>`;
              }).join("")}
            </div>
          ` : ""}
        </article>
      `;
    }).join("");
  }

  function renderKarnaughProcedure() {
    const data = state.karnaughData;
    if (!data) {
      els.karnaughProcedure.className = "method-content empty-state";
      els.karnaughProcedure.textContent = "Simplifica una ecuación para construir el mapa.";
      return;
    }

    els.karnaughProcedure.className = "method-content";
    const varsText = data.vars.length ? data.vars.join(", ") : "Sin variables";
    const mintermsText = data.minterms.length ? `Σm(${data.minterms.join(", ")})` : "Σm(∅)";
    const groupsHtml = data.groups.length ? data.groups.map((group, index) => `
      <article class="kmap-group-card g${index % 8}">
        <span class="kmap-group-dot"></span>
        <div>
          <strong>${escapeHtml(group.label)} · ${group.size} celda${group.size === 1 ? "" : "s"}</strong>
          <p>m(${escapeHtml(group.minterms.join(", "))}) · patrón ${escapeHtml(group.pattern)}</p>
          <p>${group.eliminated.length ? `Se elimina: ${escapeHtml(group.eliminated.join(", "))}` : "No se elimina ninguna variable"}</p>
          <div class="kmap-group-term">${escapeHtml(group.term)}</div>
        </div>
      </article>
    `).join("") : `<div class="empty-state">No hay grupos porque la función no contiene unos.</div>`;

    const layersHtml = data.layers.map(layer => `
      <article class="kmap-layer">
        <div class="kmap-layer-title">
          <strong>${escapeHtml(layer.title)}</strong>
          <span>Filas: ${escapeHtml(layer.rowLabel)} · Columnas: ${escapeHtml(layer.colLabel)}</span>
        </div>
        <div class="kmap-scroll">
          <table class="kmap-table" aria-label="Mapa de Karnaugh ${escapeHtml(layer.title)}">
            <thead>
              <tr>
                <th class="kmap-corner">${escapeHtml(layer.rowLabel)} \\ ${escapeHtml(layer.colLabel)}</th>
                ${layer.colCodes.map(code => `<th>${escapeHtml(code || "—")}</th>`).join("")}
              </tr>
            </thead>
            <tbody>
              ${layer.rows.map(row => `
                <tr>
                  <th>${escapeHtml(row.code || "—")}</th>
                  ${row.cells.map(cell => `
                    <td class="kmap-cell ${cell.value ? "high" : "low"}" title="${escapeHtml(cell.bits)} · m${cell.minterm}">
                      <span class="kmap-cell-value">${cell.value}</span>
                      <span class="kmap-cell-minterm">m${cell.minterm} · ${escapeHtml(cell.bits)}</span>
                      <span class="kmap-badges">
                        ${cell.groups.map(groupIndex => `<span class="kmap-group-badge g${groupIndex % 8}">G${groupIndex + 1}</span>`).join("")}
                      </span>
                    </td>
                  `).join("")}
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </article>
    `).join("");

    els.karnaughProcedure.innerHTML = `
      <div class="kmap-summary">
        <div class="kmap-stat"><span>Variables</span><strong>${escapeHtml(varsText)}</strong></div>
        <div class="kmap-stat"><span>Minterminos</span><strong>${escapeHtml(mintermsText)}</strong></div>
        <div class="kmap-stat"><span>Grupos mínimos</span><strong>${data.groups.length}</strong></div>
      </div>
      <div class="kmap-step-list">
        ${data.steps.map((step, index) => `
          <div class="kmap-step">
            <div class="kmap-step-number">${index + 1}</div>
            <div><strong>${escapeHtml(step.title)}</strong><p>${escapeHtml(step.text)}</p></div>
          </div>
        `).join("")}
      </div>
      ${layersHtml}
      <h3 class="kmap-groups-title">Lectura de los grupos</h3>
      <div class="kmap-groups">${groupsHtml}</div>
      <div class="kmap-result"><span>Resultado por Karnaugh</span><strong>F = ${escapeHtml(data.result)}</strong></div>
    `;
  }

  function renderAllSimplificationMethods() {
    renderKarnaughProcedure();
    renderAlgebraProcedure();
    renderSimplificationProcedure();
  }

  function switchSimplificationMethod(method) {
    const validMethod = ["karnaugh", "algebra", "tabular"].includes(method) ? method : "karnaugh";
    state.activeSimplificationMethod = validMethod;
    els.methodTabs.forEach(button => {
      const active = button.dataset.method === validMethod;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    els.methodPanels.forEach(panel => {
      const active = panel.dataset.methodPanel === validMethod;
      panel.hidden = !active;
      panel.classList.toggle("active", active);
    });
  }

  function renderRules(filter = "") {
    const query = filter.trim().toLowerCase();
    const filtered = RULES.filter(rule => `${rule.name} ${rule.formulas.join(" ")} ${rule.note}`.toLowerCase().includes(query));
    els.rulesGrid.innerHTML = filtered.map(rule => `
      <article class="rule-card">
        <h3>${escapeHtml(rule.name)}</h3>
        <div class="rule-formulas">${rule.formulas.map(formula => `<div class="rule-formula">${escapeHtml(formula)}</div>`).join("")}</div>
        <p>${escapeHtml(rule.note)}</p>
      </article>
    `).join("");
  }

  function clearProject(silent = false, recordHistory = true) {
    if (recordHistory) pushUndoSnapshot();
    state.suspendHistory = true;
    state.nodes = [];
    state.connections = [];
    state.selectedId = null;
    state.selectedConnection = null;
    state.pendingSource = null;
    state.nextId = 1;
    state.equationSteps = [];
    state.simplificationProcedure = [];
    state.algebraProcedure = [];
    state.karnaughData = null;
    state.activeSimplificationMethod = "karnaugh";
    state.procedureCollapsed = false;
    els.nodesLayer.innerHTML = "";
    els.wiresLayer.innerHTML = "";
    els.originalExpression.value = "";
    els.simplifiedResult.textContent = "—";
    renderSteps();
    renderAllSimplificationMethods();
    switchSimplificationMethod("karnaugh");
    selectNode(null);
    evaluateCircuit();
    state.suspendHistory = false;
    if (!silent) showToast("Proyecto nuevo");
  }

  function loadExample(recordHistory = true) {
    if (recordHistory) pushUndoSnapshot();
    state.suspendHistory = true;
    clearProject(true, false);
    const A = addNode("INPUT", 70, 120, { name: "A", value: 0, skipHistory: true });
    const B = addNode("INPUT", 70, 280, { name: "B", value: 0, skipHistory: true });
    const notA = addNode("NOT", 290, 100, { name: "NOT", skipHistory: true });
    const and1 = addNode("AND", 520, 120, { name: "AND", skipHistory: true });
    const and2 = addNode("AND", 520, 300, { name: "AND", skipHistory: true });
    const or1 = addNode("OR", 780, 210, { name: "OR", skipHistory: true });
    const S = addNode("OUTPUT", 1040, 220, { name: "S", skipHistory: true });
    state.connections.push(
      { from: A.id, to: notA.id, toPort: 0 },
      { from: notA.id, to: and1.id, toPort: 0 },
      { from: B.id, to: and1.id, toPort: 1 },
      { from: A.id, to: and2.id, toPort: 0 },
      { from: B.id, to: and2.id, toPort: 1 },
      { from: and1.id, to: or1.id, toPort: 0 },
      { from: and2.id, to: or1.id, toPort: 1 },
      { from: or1.id, to: S.id, toPort: 0 },
    );
    state.suspendHistory = false;
    evaluateCircuit();
    centerBoard();
    if (recordHistory) showToast("Ejemplo cargado: A'B + AB");
  }

  function saveProject() {
    const data = {
      version: 6,
      nodes: state.nodes.map(({ id, type, name, x, y, value, inputCount }) => ({
        id, type, name, x, y,
        value: type === "INPUT" ? value : null,
        inputCount: GATE_DEFS[type]?.variableInputs ? inputCount : undefined,
      })),
      connections: state.connections,
      originalExpression: els.originalExpression.value,
      simplifiedResult: els.simplifiedResult.textContent,
      equationSteps: state.equationSteps,
      simplificationProcedure: state.simplificationProcedure,
      algebraProcedure: state.algebraProcedure,
      karnaughData: state.karnaughData,
      activeSimplificationMethod: state.activeSimplificationMethod,
      procedureCollapsed: state.procedureCollapsed,
    };
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), "logiclab-proyecto.json");
  }

  function openProject(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        pushUndoSnapshot();
        state.suspendHistory = true;
        clearProject(true, false);
        (data.nodes || []).forEach(n => addNode(n.type, n.x, n.y, { ...n, skipHistory: true }));
        state.connections = Array.isArray(data.connections) ? data.connections.filter(c => getNode(c.from) && getNode(c.to)) : [];
        els.originalExpression.value = data.originalExpression || "";
        els.simplifiedResult.textContent = data.simplifiedResult || "—";
        state.equationSteps = Array.isArray(data.equationSteps) ? data.equationSteps : [];
        state.simplificationProcedure = Array.isArray(data.simplificationProcedure) ? data.simplificationProcedure : [];
        state.algebraProcedure = Array.isArray(data.algebraProcedure) ? data.algebraProcedure : [];
        state.karnaughData = data.karnaughData || null;
        state.activeSimplificationMethod = ["karnaugh", "algebra", "tabular"].includes(data.activeSimplificationMethod) ? data.activeSimplificationMethod : "karnaugh";
        state.procedureCollapsed = Boolean(data.procedureCollapsed);
        renderSteps();
        renderAllSimplificationMethods();
        switchSimplificationMethod(state.activeSimplificationMethod);
        state.suspendHistory = false;
        evaluateCircuit();
        showToast("Proyecto abierto");
      } catch (error) {
        state.suspendHistory = false;
        showToast("El archivo no es un proyecto válido");
      }
    };
    reader.readAsText(file);
  }

  function exportSvg() {
    const wireSvg = state.connections.map(connection => {
      const a = getPortCenter(connection.from, "out");
      const b = getPortCenter(connection.to, "in", connection.toPort);
      const source = getNode(connection.from);
      return `<path d="${wirePath(a, b)}" fill="none" stroke="${source?.value === 1 ? "#16a36a" : "#8f99a8"}" stroke-width="4" stroke-linecap="round"/>`;
    }).join("");

    const nodeSvg = state.nodes.map(node => {
      const value = node.value ?? "?";
      const high = node.value === 1;
      const width = 132;
      const height = getNodeHeight(node);
      const countLabel = GATE_DEFS[node.type].variableInputs ? ` · ${getInputCount(node)} entradas` : "";
      const label = node.type === "INPUT" || node.type === "OUTPUT" ? node.name : `${GATE_DEFS[node.type].label}${countLabel}`;
      return `
        <g transform="translate(${node.x} ${node.y})">
          <rect width="${width}" height="${height}" rx="14" fill="#fff" stroke="${high ? "#16a36a" : "#cfd5df"}" stroke-width="3"/>
          <rect width="${width}" height="26" rx="12" fill="#fafbfc"/>
          <line x1="0" y1="26" x2="${width}" y2="26" stroke="#dfe4ec"/>
          <text x="10" y="18" font-size="10" font-family="Arial" fill="#667085" font-weight="700">${escapeXml(GATE_DEFS[node.type].label)}</text>
          <rect x="98" y="4" width="25" height="18" rx="6" fill="${high ? "#e8f7ef" : "#edf0f5"}"/>
          <text x="110.5" y="17" text-anchor="middle" font-size="11" font-family="Arial" fill="${high ? "#137a43" : "#172033"}" font-weight="800">${value}</text>
          <text x="66" y="${26 + (height - 26) / 2 + 6}" text-anchor="middle" font-size="${GATE_DEFS[node.type].variableInputs ? 12 : 17}" font-family="Arial" fill="#172033" font-weight="800">${escapeXml(label)}</text>
        </g>`;
    }).join("");

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${BOARD_W}" height="${BOARD_H}" viewBox="0 0 ${BOARD_W} ${BOARD_H}">
      <rect width="100%" height="100%" fill="#f6f8fc"/>
      <defs><pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#cbd3df"/></pattern></defs>
      <rect width="100%" height="100%" fill="url(#dots)"/>
      ${wireSvg}${nodeSvg}
    </svg>`;
    downloadBlob(new Blob([svg], { type: "image/svg+xml" }), "logiclab-diagrama.svg");
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function centerBoard() {
    if (!state.nodes.length) {
      els.boardViewport.scrollTo({ left: 0, top: 0, behavior: "smooth" });
      return;
    }
    const minX = Math.min(...state.nodes.map(n => n.x));
    const maxX = Math.max(...state.nodes.map(n => n.x + 132));
    const minY = Math.min(...state.nodes.map(n => n.y));
    const maxY = Math.max(...state.nodes.map(n => n.y + getNodeHeight(n)));
    els.boardViewport.scrollTo({
      left: Math.max(0, ((minX + maxX) / 2) * state.zoom - els.boardViewport.clientWidth / 2),
      top: Math.max(0, ((minY + maxY) / 2) * state.zoom - els.boardViewport.clientHeight / 2),
      behavior: "smooth",
    });
  }

  function setZoom(value) {
    state.zoom = clamp(value, 0.55, 1.5);
    els.circuitBoard.style.transform = `scale(${state.zoom})`;
    els.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
    renderWires();
  }

  function insertSymbol(symbol) {
    const field = els.originalExpression;
    const start = field.selectionStart;
    const end = field.selectionEnd;
    field.value = field.value.slice(0, start) + symbol + field.value.slice(end);
    field.focus();
    field.setSelectionRange(start + symbol.length, start + symbol.length);
  }

  function copyText(text, successMessage) {
    if (!text) return;
    navigator.clipboard?.writeText(text).then(() => showToast(successMessage)).catch(() => {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
      showToast(successMessage);
    });
  }


function clearCircuitOnly(recordHistory = true) {
  if (recordHistory) pushUndoSnapshot();
  state.suspendHistory = true;
  state.nodes = [];
  state.connections = [];
  state.selectedId = null;
  state.selectedConnection = null;
  state.pendingSource = null;
  state.nextId = 1;
  els.nodesLayer.innerHTML = "";
  els.wiresLayer.innerHTML = "";
  selectNode(null);
  evaluateCircuit();
  state.suspendHistory = false;
}

function collectConstantValues(ast, set = new Set()) {
  if (!ast || typeof ast !== "object") return set;
  if (ast.type === "CONST") set.add(ast.value ? 1 : 0);
  if (ast.value && typeof ast.value === "object") collectConstantValues(ast.value, set);
  if (ast.left) collectConstantValues(ast.left, set);
  if (ast.right) collectConstantValues(ast.right, set);
  return set;
}

function flattenAssociativeAst(ast, type) {
  if (!ast) return [];
  if (ast.type === type && ast.left && ast.right) {
    return [...flattenAssociativeAst(ast.left, type), ...flattenAssociativeAst(ast.right, type)];
  }
  return [ast];
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function placeNodeAtCenter(node, x, centerY) {
  const height = getNodeHeight(node);
  node.x = clamp(Number(x) || 0, 0, BOARD_W - 140);
  node.y = clamp((Number(centerY) || 0) - height / 2, 0, BOARD_H - height);
  const el = document.querySelector(`.logic-node[data-id="${cssEscape(node.id)}"]`);
  if (el) {
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;
  }
  return { id: node.id, x: node.x, y: node.y + height / 2 };
}

function createPlacedNode(type, x, centerY, options = {}) {
  const node = addNode(type, x, 0, { ...options, skipHistory: true });
  return { node, ref: placeNodeAtCenter(node, x, centerY) };
}

function createGateCluster(type, childRefs) {
  if (!childRefs.length) return null;
  if (type !== "NOT" && childRefs.length === 1) return childRefs[0];
  if (childRefs.length > MAX_GATE_INPUTS) {
    const grouped = [];
    for (let i = 0; i < childRefs.length; i += MAX_GATE_INPUTS) {
      grouped.push(createGateCluster(type, childRefs.slice(i, i + MAX_GATE_INPUTS)));
    }
    return createGateCluster(type, grouped);
  }
  const x = clamp(Math.max(...childRefs.map(ref => ref.x)) + (type === "NOT" ? 130 : 220), 160, BOARD_W - 180);
  const centerY = average(childRefs.map(ref => ref.y));
  const options = GATE_DEFS[type]?.variableInputs ? { inputCount: childRefs.length } : {};
  const placement = createPlacedNode(type, x, centerY, options);
  childRefs.forEach((ref, index) => {
    state.connections.push({ from: ref.id, to: placement.node.id, toPort: index });
  });
  return placement.ref;
}

function buildCircuitFromAst(ast, sourceRefs) {
  if (!ast) return null;
  switch (ast.type) {
    case "VAR":
      return sourceRefs.get(`VAR:${ast.name}`) || null;
    case "CONST":
      return sourceRefs.get(`CONST:${ast.value ? 1 : 0}`) || null;
    case "NOT":
      return createGateCluster("NOT", [buildCircuitFromAst(ast.value, sourceRefs)].filter(Boolean));
    case "AND":
    case "OR":
    case "XOR": {
      const parts = flattenAssociativeAst(ast, ast.type).map(part => buildCircuitFromAst(part, sourceRefs)).filter(Boolean);
      return createGateCluster(ast.type, parts);
    }
    default:
      return null;
  }
}

function generateCircuitFromExpression(expression, options = {}) {
  const sourceLabel = options.sourceLabel || "la ecuación";
  const fallbackName = options.outputName || "S";
  let ast;
  try {
    ast = parseExpression(expression);
  } catch (error) {
    showToast(error.message);
    return;
  }

  if (state.nodes.length) {
    const ok = confirm("Esto reemplazará el circuito actual por uno generado desde la ecuación. ¿Deseas continuar?");
    if (!ok) return;
  }

  const vars = [...collectVariables(ast)].sort();
  const constants = [...collectConstantValues(ast)].sort((a, b) => a - b);
  const totalSources = Math.max(1, vars.length + constants.length);
  const spacing = totalSources > 1 ? clamp(Math.floor(620 / (totalSources - 1)), 82, 110) : 96;
  const startY = totalSources > 1 ? 120 : BOARD_H / 2;
  const leftX = 64;
  const sourceRefs = new Map();

  clearCircuitOnly(true);
  state.suspendHistory = true;

  let sourceIndex = 0;
  vars.forEach((name) => {
    const centerY = startY + sourceIndex * spacing;
    const placement = createPlacedNode("INPUT", leftX, centerY, { name, value: 0 });
    sourceRefs.set(`VAR:${name}`, placement.ref);
    sourceIndex += 1;
  });
  constants.forEach((value) => {
    const centerY = startY + sourceIndex * spacing;
    const placement = createPlacedNode("INPUT", leftX, centerY, { name: String(value), value });
    sourceRefs.set(`CONST:${value}`, placement.ref);
    sourceIndex += 1;
  });

  const resultRef = buildCircuitFromAst(ast, sourceRefs);
  if (!resultRef) {
    state.suspendHistory = false;
    evaluateCircuit();
    showToast("No se pudo generar el circuito desde la ecuación");
    return;
  }

  const outputX = clamp(resultRef.x + 250, 260, BOARD_W - 145);
  const outputPlacement = createPlacedNode("OUTPUT", outputX, resultRef.y, { name: fallbackName });
  state.connections.push({ from: resultRef.id, to: outputPlacement.node.id, toPort: 0 });

  state.suspendHistory = false;
  renderWires();
  evaluateCircuit();
  centerBoard();
  switchTab("circuit");
  showToast(`Circuito generado desde ${sourceLabel}`);
}

  function bindUi() {
    $$(".tab").forEach(tab => tab.addEventListener("click", () => switchTab(tab.dataset.tab)));
    els.undoBtn.addEventListener("click", undo);
    els.redoBtn.addEventListener("click", redo);
    $("#newBtn").addEventListener("click", () => { if (confirm("¿Crear un proyecto nuevo?")) clearProject(); });
    $("#saveBtn").addEventListener("click", saveProject);
    $("#openBtn").addEventListener("click", () => els.fileInput.click());
    $("#exportBtn").addEventListener("click", exportSvg);
    els.fileInput.addEventListener("change", () => { if (els.fileInput.files[0]) openProject(els.fileInput.files[0]); els.fileInput.value = ""; });

    $("#deleteNodeBtn").addEventListener("click", deleteSelectedNode);
    els.deleteWireBtn.addEventListener("click", () => deleteConnection());
    $("#clearWiresBtn").addEventListener("click", () => {
      if (!state.connections.length) { showToast("No hay cables para borrar"); return; }
      pushUndoSnapshot();
      state.connections = [];
      state.selectedConnection = null;
      cancelConnection();
      evaluateCircuit();
      showToast("Todos los cables fueron eliminados");
    });
    $("#evaluateBtn").addEventListener("click", evaluateCircuit);
    $("#copyEquationBtn").addEventListener("click", () => copyText(els.generatedEquation.textContent, "Ecuación copiada"));
    $("#openTruthBtn").addEventListener("click", () => { state.truthMode = "circuit"; switchTab("truth"); generateCircuitTruthTable(); });
    $("#sendEquationBtn").addEventListener("click", () => {
      const eq = getGeneratedEquations()[0];
      if (!eq || eq.expr === "?") { showToast("Completa el circuito hasta una salida"); return; }
      els.originalExpression.value = normalizeDisplayExpression(eq.expr);
      switchTab("equations");
    });
    $("#fromCircuitBtn").addEventListener("click", () => {
      const eq = getGeneratedEquations()[0];
      if (!eq || eq.expr === "?") { showToast("Completa el circuito hasta una salida"); return; }
      els.originalExpression.value = normalizeDisplayExpression(eq.expr);
      showToast("Ecuación tomada del circuito");
    });
    $("#simplifyBtn").addEventListener("click", () => {
      try {
        const details = simplifyExpressionDetailed(els.originalExpression.value);
        pushUndoSnapshot();
        els.simplifiedResult.textContent = details.result;
        state.simplificationProcedure = details.steps;
        state.algebraProcedure = details.algebraSteps;
        state.karnaughData = details.karnaugh;
        state.activeSimplificationMethod = "karnaugh";
        state.procedureCollapsed = false;
        renderAllSimplificationMethods();
        switchSimplificationMethod("karnaugh");
        els.compareA.value = els.originalExpression.value;
        els.compareB.value = details.result;
        showToast("Simplificación lista en 3 métodos");
      } catch (error) { showToast(error.message); }
    });
    els.methodTabs.forEach(button => button.addEventListener("click", () => switchSimplificationMethod(button.dataset.method)));
    $("#expressionTableBtn").addEventListener("click", () => generateExpressionTruthTable(els.originalExpression.value));
    $("#addStepBtn").addEventListener("click", addEquationStep);
    $("#compareBtn").addEventListener("click", () => {
      try {
        const result = expressionsEquivalent(els.compareA.value, els.compareB.value);
        els.compareResult.className = `compare-result ${result.equivalent ? "ok" : "bad"}`;
        els.compareResult.textContent = result.equivalent ? "Sí, las ecuaciones son equivalentes." : `No son equivalentes. Contraejemplo: ${result.counterexample}`;
      } catch (error) {
        els.compareResult.className = "compare-result bad";
        els.compareResult.textContent = error.message;
      }
    });

    $$(".symbol-grid button").forEach(button => button.addEventListener("click", () => insertSymbol(button.dataset.symbol)));
    $("#refreshTruthBtn").addEventListener("click", () => state.truthMode === "expression" ? generateExpressionTruthTable(els.originalExpression.value) : generateCircuitTruthTable());
    $("#copyTruthBtn").addEventListener("click", () => copyText(state.truthCsv, "Tabla copiada como CSV"));
    els.ruleSearch.addEventListener("input", () => renderRules(els.ruleSearch.value));

    let selectedNameSnapshot = null;
    els.selectedName.addEventListener("focus", () => { selectedNameSnapshot = captureSnapshot(); });
    els.selectedName.addEventListener("input", () => {
      const node = getNode(state.selectedId);
      if (!node) return;
      node.name = sanitizeName(els.selectedName.value) || defaultNodeName(node.type);
      els.selectedName.value = node.name;
      const nodeInput = document.querySelector(`.logic-node[data-id="${cssEscape(node.id)}"] .node-name-input`);
      if (nodeInput) nodeInput.value = node.name;
      evaluateCircuit();
    });
    els.selectedName.addEventListener("change", () => {
      if (selectedNameSnapshot) pushUndoSnapshot(selectedNameSnapshot);
      selectedNameSnapshot = null;
    });

    els.selectedInputCount.addEventListener("change", () => {
      const node = getNode(state.selectedId);
      if (!node || !GATE_DEFS[node.type].variableInputs) return;
      const nextCount = clamp(Number(els.selectedInputCount.value), MIN_GATE_INPUTS, MAX_GATE_INPUTS);
      if (nextCount === getInputCount(node)) return;
      pushUndoSnapshot();
      node.inputCount = nextCount;
      state.connections = state.connections.filter(connection => connection.to !== node.id || connection.toPort < nextCount);
      state.selectedConnection = null;
      cancelConnection();
      rerenderNode(node);
      evaluateCircuit();
      showToast(`Compuerta ajustada a ${nextCount} entradas`);
    });

    $("#zoomInBtn").addEventListener("click", () => setZoom(state.zoom + .1));
    $("#zoomOutBtn").addEventListener("click", () => setZoom(state.zoom - .1));
    $("#centerBtn").addEventListener("click", centerBoard);

    els.boardViewport.addEventListener("dragover", event => event.preventDefault());
    els.boardViewport.addEventListener("drop", event => {
      event.preventDefault();
      const type = event.dataTransfer.getData("text/plain");
      const rect = els.circuitBoard.getBoundingClientRect();
      const x = (event.clientX - rect.left) / state.zoom - 66;
      const y = (event.clientY - rect.top) / state.zoom - 41;
      addNode(type, clamp(x, 0, BOARD_W - 132), clamp(y, 0, BOARD_H - 82));
    });

    els.circuitBoard.addEventListener("pointerdown", event => {
      if (event.target === els.circuitBoard || event.target === els.nodesLayer || event.target === els.wiresLayer) selectNode(null);
    });

    window.addEventListener("keydown", event => {
      const isFormControl = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
      const commandKey = event.ctrlKey || event.metaKey;
      if (commandKey && !isFormControl && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
        return;
      }
      if (commandKey && !isFormControl && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (isFormControl) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        state.selectedConnection !== null ? deleteConnection() : deleteSelectedNode();
      }
      if (event.key === "Escape") {
        state.selectedConnection = null;
        cancelConnection();
        selectNode(null);
      }
    });

    window.addEventListener("resize", renderWires);
  }

  function normalizeDisplayExpression(expression) {
    return expression.replace(/·/g, "*").replace(/⊕/g, "^");
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));
  }
  function escapeXml(value) { return escapeHtml(value); }
  function cssEscape(value) { return window.CSS?.escape ? window.CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&"); }
  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

  function init() {
    renderPalette();
    renderRules();
    renderSteps();
    renderAllSimplificationMethods();
    switchSimplificationMethod(state.activeSimplificationMethod);
    bindUi();
    clearProject(true, false);
    state.undoStack = [];
    state.redoStack = [];
    updateHistoryButtons();
  }

  init();
})();
