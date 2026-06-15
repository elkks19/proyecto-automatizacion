const video = document.querySelector("#video");
const cameraStage = document.querySelector(".camera-stage");
const liveOverlay = document.querySelector("#liveOverlay");
const outputPreview = document.querySelector("#outputPreview");
const outputEmpty = document.querySelector("#outputEmpty");
const detectLive = document.querySelector("#detectLive");
const stopLive = document.querySelector("#stopLive");
const testImage = document.querySelector("#testImage");
const testImageName = document.querySelector("#testImageName");
const detectImage = document.querySelector("#detectImage");
const confidence = document.querySelector("#confidence");
const confidenceValue = document.querySelector("#confidenceValue");
const detectionsBody = document.querySelector("#detectionsBody");
const summary = document.querySelector("#summary");
const statusBox = document.querySelector("#status");
const liveState = document.querySelector("#liveState");
const chartCanvas = document.querySelector("#detectionsChart");
const chartEmpty = document.querySelector("#chartEmpty");
const chartLegend = document.querySelector("#chartLegend");
const chartTotal = document.querySelector("#chartTotal");
const sealBadge = document.querySelector("#sealBadge");
const qrStatus = document.querySelector("#qrStatus");
const qrLink = document.querySelector("#qrLink");
const seriesValue = document.querySelector("#seriesValue");
const ocrStatus = document.querySelector("#ocrStatus");
const mqttStatusDot = document.querySelector("#mqttStatusDot");
const mqttBroker = document.querySelector("#mqttBroker");
const mqttState = document.querySelector("#mqttState");
const mqttEstado = document.querySelector("#mqttEstado");
const mqttEstadoDetalle = document.querySelector("#mqttEstadoDetalle");
const mqttMotorBanda = document.querySelector("#mqttMotorBanda");
const mqttMotorBandaDetalle = document.querySelector("#mqttMotorBandaDetalle");
const mqttMotorCarrusel = document.querySelector("#mqttMotorCarrusel");
const mqttMotorCarruselDetalle = document.querySelector("#mqttMotorCarruselDetalle");
const mqttSensores = document.querySelector("#mqttSensores");
const mqttSensoresDetalle = document.querySelector("#mqttSensoresDetalle");
const mqttAlcohol = document.querySelector("#mqttAlcohol");
const mqttAlcoholDetalle = document.querySelector("#mqttAlcoholDetalle");
const alcoholTrendValue = document.querySelector("#alcoholTrendValue");
const alcoholTrendRange = document.querySelector("#alcoholTrendRange");
const alcoholTrendChart = document.querySelector("#alcoholTrendChart");
const mqttIa = document.querySelector("#mqttIa");
const mqttIaDetalle = document.querySelector("#mqttIaDetalle");
const mqttEvento = document.querySelector("#mqttEvento");
const mqttEventoDetalle = document.querySelector("#mqttEventoDetalle");
const mqttCommandButtons = document.querySelectorAll("[data-command]");
const mqttEstadoCard = mqttEstado.closest(".mqtt-item");
const mqttMotorBandaCard = mqttMotorBanda.closest(".mqtt-item");
const mqttMotorCarruselCard = mqttMotorCarrusel.closest(".mqtt-item");
const mqttSensoresCard = mqttSensores.closest(".mqtt-item");
const mqttAlcoholCard = mqttAlcohol.closest(".mqtt-item");
const mqttIaCard = mqttIa.closest(".mqtt-item");
const mqttEventoCard = mqttEvento.closest(".mqtt-item");
const alcoholTrendCard = alcoholTrendChart.closest(".mqtt-trend-card");
const machineVisual = document.querySelector("#machineVisual");
const machineConveyor = document.querySelector("#machineConveyor");
const machineCarousel = document.querySelector("#machineCarousel");
const machineBandaState = document.querySelector("#machineBandaState");
const machineCarruselState = document.querySelector("#machineCarruselState");
const machineSensorState = document.querySelector("#machineSensorState");
const machineSensorBottle = document.querySelector("#machineSensorBottle");
const machineSensorBase = document.querySelector("#machineSensorBase");
const machineSensorProcess = document.querySelector("#machineSensorProcess");

let stream = null;
let liveMode = false;
let liveBusy = false;
let imageBusy = false;
let liveTimer = null;
let frameCount = 0;
let mqttWaitMode = false;
let mqttDetectionActive = false;
let mqttIaPublished = false;
let mqttDetectionStartedAt = 0;
let lastMqttWaitingSignalAt = 0;
let simulatedAlcohol = 3.0;
let simulatedAlcoholDirection = 1;
let lastAlcoholUpdateAt = 0;
const alcoholTrend = [];
let lastSeries = [];
let lastRawText = "";
const unmirrorCamera = false;
let qrDetector = null;
const liveCanvas = document.createElement("canvas");
const liveCtx = liveCanvas.getContext("2d");
const overlayCtx = liveOverlay.getContext("2d");
const chartCtx = chartCanvas.getContext("2d");
const alcoholTrendCtx = alcoholTrendChart.getContext("2d");
const chartColors = [
  "#0b2d5c",
  "#d9a441",
  "#5aa7d8",
  "#f2d17b",
  "#1e5f99",
  "#c77d2b",
  "#7cc6e8",
];
const LIVE_FRAME_WIDTH = 640;
const LIVE_JPEG_QUALITY = 0.82;
const LIVE_INTERVAL_MS = 120;
const MQTT_INTERVAL_MS = 1000;
const MQTT_IA_TIMEOUT_MS = 10000;
const ALCOHOL_TREND_LIMIT = 60;
const SEAL_ANALYSIS_EVERY = 8;
let lastDetections = [];
let lastFrameSize = { width: LIVE_FRAME_WIDTH, height: 312 };
const detectionColors = ["#00e5ff", "#ffd23f", "#35ff8d", "#ff4d6d", "#b47cff", "#ff8a3d", "#ffffff"];

try {
  if ("BarcodeDetector" in window) {
    qrDetector = new BarcodeDetector({ formats: ["qr_code"] });
  }
} catch (error) {
  qrDetector = null;
}

function setStatus(text, isError = false) {
  statusBox.textContent = text;
  statusBox.classList.toggle("error", isError);
}

function setLiveState(text, detected) {
  liveState.textContent = text;
  liveState.classList.toggle("detected", detected);
}

function resetResults() {
  lastDetections = [];
  clearOverlay();
  outputPreview.classList.remove("active");
  outputEmpty.classList.remove("hidden");
  summary.textContent = "0 objetos";
  detectionsBody.innerHTML = '<tr><td colspan="3">Sin resultados todavia.</td></tr>';
  frameCount = 0;
  lastSeries = [];
  lastRawText = "";
  setLiveState("No detecta nada", false);
  renderSealInfo(null);
  renderChart([]);
}

function showOutput(src) {
  cameraStage.classList.remove("active");
  video.classList.remove("active");
  clearOverlay();
  outputPreview.src = src;
  outputPreview.classList.add("active");
  outputEmpty.classList.add("hidden");
}

function showLiveCamera() {
  cameraStage.classList.add("active");
  video.classList.add("active");
  outputPreview.classList.remove("active");
  outputEmpty.classList.add("hidden");
  drawOverlay();
}

function clearOverlay() {
  overlayCtx.clearRect(0, 0, liveOverlay.width || 0, liveOverlay.height || 0);
}

function drawOverlay() {
  const liveSource = video;
  const sourceReady = Boolean(video.videoWidth);

  if (!liveSource.classList.contains("active") || !sourceReady || !lastFrameSize.width) {
    clearOverlay();
    return;
  }

  const rect = liveSource.getBoundingClientRect();
  const displayWidth = Math.max(1, Math.round(rect.width));
  const displayHeight = Math.max(1, Math.round(rect.height));
  if (liveOverlay.width !== displayWidth || liveOverlay.height !== displayHeight) {
    liveOverlay.width = displayWidth;
    liveOverlay.height = displayHeight;
  }

  clearOverlay();

  const scale = Math.min(displayWidth / lastFrameSize.width, displayHeight / lastFrameSize.height);
  const renderedWidth = lastFrameSize.width * scale;
  const renderedHeight = lastFrameSize.height * scale;
  const offsetX = (displayWidth - renderedWidth) / 2;
  const offsetY = (displayHeight - renderedHeight) / 2;

  overlayCtx.lineWidth = 5;
  overlayCtx.font = "900 16px Segoe UI, Arial";
  overlayCtx.textBaseline = "top";

  lastDetections.forEach((item, index) => {
    const x = offsetX + item.x1 * scale;
    const y = offsetY + item.y1 * scale;
    const w = (item.x2 - item.x1) * scale;
    const h = (item.y2 - item.y1) * scale;
    const label = `${item.label} ${(item.confidence * 100).toFixed(0)}%`;
    const color = detectionColors[index % detectionColors.length];

    overlayCtx.strokeStyle = "rgba(0, 0, 0, 0.7)";
    overlayCtx.strokeRect(x + 2, y + 2, w, h);
    overlayCtx.strokeStyle = color;
    overlayCtx.strokeRect(x, y, w, h);

    const textWidth = overlayCtx.measureText(label).width + 18;
    const textHeight = 30;
    const labelY = Math.max(0, y - textHeight);
    overlayCtx.fillStyle = "rgba(0, 0, 0, 0.78)";
    overlayCtx.fillRect(x, labelY, textWidth, textHeight);
    overlayCtx.fillStyle = color;
    overlayCtx.fillRect(x, labelY, 6, textHeight);
    overlayCtx.fillStyle = "#ffffff";
    overlayCtx.fillText(label, x + 12, labelY + 5);
  });
}

function summarizeLabels(detections) {
  const counts = new Map();
  detections.forEach((item) => {
    counts.set(item.label, (counts.get(item.label) || 0) + 1);
  });

  return Array.from(counts.entries())
    .map(([label, count]) => count > 1 ? `${label} x${count}` : label)
    .join(", ");
}

function groupDetections(detections) {
  const counts = new Map();
  detections.forEach((item) => {
    counts.set(item.label, (counts.get(item.label) || 0) + 1);
  });

  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function renderChart(detections) {
  const grouped = groupDetections(detections);
  const total = detections.length;
  const width = chartCanvas.width;
  const height = chartCanvas.height;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) / 2 - 12;

  chartCtx.clearRect(0, 0, width, height);
  chartTotal.textContent = `${total} total`;

  if (!total) {
    chartEmpty.classList.remove("hidden");
    chartLegend.innerHTML = '<div class="legend-empty">No hay etiquetas detectadas.</div>';
    return;
  }

  chartEmpty.classList.add("hidden");
  let start = -Math.PI / 2;

  grouped.forEach((item, index) => {
    const slice = (item.count / total) * Math.PI * 2;
    chartCtx.beginPath();
    chartCtx.moveTo(centerX, centerY);
    chartCtx.arc(centerX, centerY, radius, start, start + slice);
    chartCtx.closePath();
    chartCtx.fillStyle = chartColors[index % chartColors.length];
    chartCtx.fill();
    start += slice;
  });

  chartCtx.beginPath();
  chartCtx.arc(centerX, centerY, radius * 0.52, 0, Math.PI * 2);
  chartCtx.fillStyle = "#ffffff";
  chartCtx.fill();
  chartCtx.fillStyle = "#0b2d5c";
  chartCtx.font = "800 24px Segoe UI, Arial";
  chartCtx.textAlign = "center";
  chartCtx.textBaseline = "middle";
  chartCtx.fillText(String(total), centerX, centerY - 7);
  chartCtx.fillStyle = "#667085";
  chartCtx.font = "700 12px Segoe UI, Arial";
  chartCtx.fillText("detecciones", centerX, centerY + 15);

  chartLegend.innerHTML = grouped.map((item, index) => {
    const pct = ((item.count / total) * 100).toFixed(1);
    const color = chartColors[index % chartColors.length];
    return `
      <div class="legend-item">
        <span class="legend-dot" style="background:${color}"></span>
        <span class="legend-name">${item.label}</span>
        <strong>${item.count}</strong>
        <em>${pct}%</em>
      </div>
    `;
  }).join("");
}

function renderDetections(detections) {
  summary.textContent = `${detections.length} objeto${detections.length === 1 ? "" : "s"}`;
  renderChart(detections);
  if (!detections.length) {
    detectionsBody.innerHTML = '<tr><td colspan="3">No detecta nada.</td></tr>';
    setLiveState("No detecta nada", false);
    return;
  }

  setLiveState(`Detecta: ${summarizeLabels(detections)}`, true);
  detectionsBody.innerHTML = detections.map((item) => {
    const pct = (item.confidence * 100).toFixed(1);
    const coords = `${item.x1}, ${item.y1}, ${item.x2}, ${item.y2}`;
    return `<tr><td>${item.label}</td><td>${pct}%</td><td>${coords}</td></tr>`;
  }).join("");
}

function renderSealInfo(seal) {
  sealBadge.classList.remove("ok", "warn");
  qrLink.removeAttribute("href");
  qrLink.textContent = "Sin enlace detectado";

  if (!seal) {
    sealBadge.textContent = "Pendiente";
    qrStatus.textContent = "Sin lectura";
    seriesValue.textContent = "Sin lectura";
    ocrStatus.textContent = "Esperando imagen.";
    return;
  }

  const qr = seal.qr_codes && seal.qr_codes.length ? seal.qr_codes[0] : null;
  sealBadge.textContent = seal.seal_status || "Sello por verificar";
  sealBadge.classList.add(seal.qr_ok ? "ok" : "warn");
  qrStatus.textContent = qr ? (seal.qr_ok ? "QR correcto" : "QR no coincide") : "QR no detectado";

  if (qr) {
    qrLink.href = qr.value;
    qrLink.textContent = qr.value;
  }

  if (seal.series && seal.series.length) {
    lastSeries = seal.series;
    lastRawText = seal.raw_text || "";
    seriesValue.textContent = seal.series.join(", ");
  } else if (!seal.text_checked && lastSeries.length) {
    seriesValue.textContent = lastSeries.join(", ");
  } else {
    seriesValue.textContent = "Sin lectura";
  }

  if (!seal.text_checked && lastSeries.length) {
    ocrStatus.textContent = lastRawText ? `Texto OCR: ${lastRawText}` : "Serie encontrada previamente.";
  } else if (!seal.text_checked) {
    ocrStatus.textContent = "OCR esperando siguiente lectura.";
  } else {
    ocrStatus.textContent = seal.ocr_error || (seal.raw_text ? `Texto OCR: ${seal.raw_text}` : "No se detecto serie numerica.");
  }
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function payloadOf(topics, topic) {
  return topics && topics[topic] ? topics[topic].payload : null;
}

function entryTimeOf(topics, topic) {
  return topics && topics[topic] ? Number(topics[topic].received_at || 0) : 0;
}

function boolText(value) {
  if (value === true) return "Si";
  if (value === false) return "No";
  return "Sin dato";
}

function stateText(value) {
  if (value === true) return "Encendido";
  if (value === false) return "Apagado";
  if (value === 1 || value === "1") return "Encendido";
  if (value === 0 || value === "0") return "Apagado";
  if (value === null || value === undefined || value === "") return "Sin datos";
  return String(value);
}

function setCardState(element, state) {
  if (!element) return;
  element.classList.remove("state-active", "state-idle", "state-warning", "state-danger", "state-info", "state-update");
  if (state) {
    element.classList.add(`state-${state}`);
    element.classList.add("state-update");
    window.setTimeout(() => element.classList.remove("state-update"), 650);
  }
}

function stateName(value) {
  const text = normalizeText(value);
  if (value === true || value === 1 || text === "1") return "active";
  if (value === false || value === 0 || text === "0") return "idle";
  if (["encendido", "activo", "activa", "on", "running", "marcha", "iniciar", "iniciado"].some((item) => text.includes(item))) {
    return "active";
  }
  if (["apagado", "detenido", "detenida", "off", "stop", "parado", "parada"].some((item) => text.includes(item))) {
    return "idle";
  }
  if (["error", "alarma", "fallo", "falla", "emergencia"].some((item) => text.includes(item))) {
    return "danger";
  }
  if (["esperando", "pausa", "pausado", "pausada"].some((item) => text.includes(item))) {
    return "warning";
  }
  return "";
}

function isActiveState(value) {
  return stateName(value) === "active";
}

function updateMachineAnimation({ bandaActive, carruselActive, sensorCount, botellaDetected, baseActive, processActive }) {
  machineVisual.classList.toggle("machine-running", Boolean(bandaActive || carruselActive || sensorCount));
  machineConveyor.classList.toggle("active", Boolean(bandaActive));
  machineCarousel.classList.toggle("active", Boolean(carruselActive));
  machineSensorBottle.classList.toggle("active", Boolean(botellaDetected));
  machineSensorBase.classList.toggle("active", Boolean(baseActive));
  machineSensorProcess.classList.toggle("active", Boolean(processActive || sensorCount));

  machineBandaState.textContent = bandaActive ? "Banda en marcha" : "Banda detenida";
  machineCarruselState.textContent = carruselActive ? "Carrusel girando" : "Carrusel detenido";
  machineSensorState.textContent = sensorCount
    ? `${sensorCount} sensor${sensorCount === 1 ? "" : "es"} trabajando`
    : "Sensores sin actividad";
}

function firstValue(source, keys) {
  if (!source || typeof source !== "object") return undefined;
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== "") {
      return source[key];
    }
  }
  return undefined;
}

function activeSensorNames(sensores) {
  if (!sensores || typeof sensores !== "object") return [];

  const explicitList = firstValue(sensores, ["activos", "sensores_activos", "trabajando", "sensores_trabajando"]);
  if (Array.isArray(explicitList)) {
    return explicitList.map((item) => String(item)).filter(Boolean);
  }

  const source = sensores.sensores && typeof sensores.sensores === "object" ? sensores.sensores : sensores;
  const ignored = new Set([
    "proceso_actual",
    "cantidad",
    "cantidad_activos",
    "sensores_activos",
    "activos",
    "trabajando",
    "sensores_trabajando",
    "banda_activa",
    "motor_banda",
    "motor_banda_estado",
    "estado_motor_banda",
    "carrusel_activo",
    "motor_carrusel",
    "motor_carrusel_estado",
    "estado_motor_carrusel",
    "carrusel_posicion",
    "base_girando",
  ]);

  return Object.entries(source)
    .filter(([key, value]) => !ignored.has(key) && value === true)
    .map(([key]) => key);
}

function renderMotorState(titleElement, detailElement, value, detail) {
  titleElement.textContent = stateText(value);
  detailElement.textContent = detail || "Estado recibido por MQTT.";
}

function fixedNumber(value, digits = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : "Sin dato";
}

function alcoholValueFromPayload(payload) {
  if (typeof payload === "number") return payload;
  if (typeof payload === "string") {
    const match = payload.replace(",", ".").match(/-?\d+(\.\d+)?/);
    return match ? Number(match[0]) : NaN;
  }
  if (payload && typeof payload === "object") {
    const value = firstValue(payload, ["alcohol", "grado", "grados", "valor", "lectura", "nivel"]);
    return alcoholValueFromPayload(value);
  }
  return NaN;
}

function addAlcoholTrendPoint(value, source = "simulado") {
  const number = Number(value);
  if (!Number.isFinite(number)) return;

  alcoholTrend.push({
    value: number,
    source,
    time: new Date(),
  });
  if (alcoholTrend.length > ALCOHOL_TREND_LIMIT) {
    alcoholTrend.shift();
  }

  alcoholTrendValue.textContent = `${number.toFixed(1)} grados`;
  alcoholTrendRange.textContent = source === "mqtt" ? "Lectura MQTT" : "Lectura simulada";
  drawAlcoholTrend();
}

function drawAlcoholTrend() {
  const width = alcoholTrendChart.width;
  const height = alcoholTrendChart.height;
  const padLeft = 46;
  const padRight = 18;
  const padTop = 18;
  const padBottom = 34;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  alcoholTrendCtx.clearRect(0, 0, width, height);
  alcoholTrendCtx.fillStyle = "#ffffff";
  alcoholTrendCtx.fillRect(0, 0, width, height);

  const values = alcoholTrend.map((point) => point.value);
  const minValue = values.length ? Math.min(2.5, Math.floor(Math.min(...values) * 10) / 10) : 2.5;
  const maxValue = values.length ? Math.max(5, Math.ceil(Math.max(...values) * 10) / 10) : 5;
  const range = Math.max(0.1, maxValue - minValue);

  alcoholTrendCtx.strokeStyle = "#d9e5ef";
  alcoholTrendCtx.lineWidth = 1;
  alcoholTrendCtx.fillStyle = "#667085";
  alcoholTrendCtx.font = "700 12px Segoe UI, Arial";
  alcoholTrendCtx.textAlign = "right";
  alcoholTrendCtx.textBaseline = "middle";

  for (let i = 0; i <= 4; i += 1) {
    const y = padTop + (plotHeight / 4) * i;
    const value = maxValue - (range / 4) * i;
    alcoholTrendCtx.beginPath();
    alcoholTrendCtx.moveTo(padLeft, y);
    alcoholTrendCtx.lineTo(width - padRight, y);
    alcoholTrendCtx.stroke();
    alcoholTrendCtx.fillText(value.toFixed(1), padLeft - 10, y);
  }

  if (alcoholTrend.length < 2) {
    alcoholTrendCtx.fillStyle = "#667085";
    alcoholTrendCtx.textAlign = "center";
    alcoholTrendCtx.fillText("Esperando lecturas", padLeft + plotWidth / 2, padTop + plotHeight / 2);
    return;
  }

  const step = plotWidth / Math.max(1, ALCOHOL_TREND_LIMIT - 1);
  const startX = padLeft + Math.max(0, ALCOHOL_TREND_LIMIT - alcoholTrend.length) * step;

  alcoholTrendCtx.beginPath();
  alcoholTrend.forEach((point, index) => {
    const x = startX + index * step;
    const y = padTop + ((maxValue - point.value) / range) * plotHeight;
    if (index === 0) alcoholTrendCtx.moveTo(x, y);
    else alcoholTrendCtx.lineTo(x, y);
  });
  alcoholTrendCtx.strokeStyle = "#0b7a53";
  alcoholTrendCtx.lineWidth = 4;
  alcoholTrendCtx.lineJoin = "round";
  alcoholTrendCtx.lineCap = "round";
  alcoholTrendCtx.stroke();

  const last = alcoholTrend[alcoholTrend.length - 1];
  const lastX = startX + (alcoholTrend.length - 1) * step;
  const lastY = padTop + ((maxValue - last.value) / range) * plotHeight;
  alcoholTrendCtx.fillStyle = "#0b7a53";
  alcoholTrendCtx.beginPath();
  alcoholTrendCtx.arc(lastX, lastY, 6, 0, Math.PI * 2);
  alcoholTrendCtx.fill();
}

function updateSimulatedAlcohol() {
  if (lastAlcoholUpdateAt && Date.now() - lastAlcoholUpdateAt < 5000) {
    return;
  }

  simulatedAlcohol += simulatedAlcoholDirection * (0.08 + Math.random() * 0.08);
  if (simulatedAlcohol >= 4.6) {
    simulatedAlcohol = 4.6;
    simulatedAlcoholDirection = -1;
  } else if (simulatedAlcohol <= 3.0) {
    simulatedAlcohol = 3.0;
    simulatedAlcoholDirection = 1;
  }

  mqttAlcohol.textContent = `${simulatedAlcohol.toFixed(1)} grados`;
  mqttAlcoholDetalle.textContent = "Rango simulado 3.0 a 4.6 grados.";
  setCardState(mqttAlcoholCard, simulatedAlcohol >= 4.2 ? "danger" : simulatedAlcohol >= 3.8 ? "warning" : "active");
  setCardState(alcoholTrendCard, simulatedAlcohol >= 4.2 ? "danger" : simulatedAlcohol >= 3.8 ? "warning" : "active");
  addAlcoholTrendPoint(simulatedAlcohol, "simulado");
}

function renderJsonDetail(element, value) {
  if (!value || typeof value !== "object") {
    element.textContent = value ? String(value) : "Esperando mensaje.";
    return;
  }

  element.textContent = Object.entries(value)
    .map(([key, item]) => `${key}: ${item}`)
    .join(" | ");
}

function renderMqttState(data) {
  const mqtt = data && data.mqtt ? data.mqtt : {};
  const topics = mqtt.topics || {};
  const connected = Boolean(mqtt.connected);

  mqttStatusDot.classList.toggle("connected", connected);
  mqttState.classList.toggle("connected", connected);
  mqttState.textContent = connected ? "Conectado" : (mqtt.error || "Desconectado");
  mqttBroker.textContent = `Broker ${mqtt.broker || "-"}:${mqtt.port || "-"}`;

  const estado = payloadOf(topics, "corona/estado");
  const estadoTime = entryTimeOf(topics, "corona/estado");
  mqttEstado.textContent = estado && typeof estado === "object" ? (estado.estado || "Sin estado") : (estado || "Sin datos");
  mqttEstadoDetalle.textContent = estado && estado.detalle ? estado.detalle : "Estado general de la maquina.";
  setCardState(mqttEstadoCard, stateName(mqttEstado.textContent) || (estado ? "info" : ""));

  const sensores = payloadOf(topics, "corona/sensores");
  const sensoresTime = entryTimeOf(topics, "corona/sensores");
  if (sensores && typeof sensores === "object") {
    const motorBanda = firstValue(sensores, ["motor_banda", "motor_banda_estado", "estado_motor_banda", "banda_activa"]);
    const motorCarrusel = firstValue(sensores, ["motor_carrusel", "motor_carrusel_estado", "estado_motor_carrusel", "carrusel_activo"]);
    const sensorNames = activeSensorNames(sensores);
    const activeCount = firstValue(sensores, ["cantidad_activos", "cantidad", "numero_activos"]) ?? sensorNames.length;
    const sensorCount = Number(activeCount) || 0;

    renderMotorState(
      mqttMotorBanda,
      mqttMotorBandaDetalle,
      motorBanda,
      `banda_activa: ${boolText(sensores.banda_activa)}`
    );
    setCardState(mqttMotorBandaCard, stateName(motorBanda));
    renderMotorState(
      mqttMotorCarrusel,
      mqttMotorCarruselDetalle,
      motorCarrusel,
      `posicion: ${sensores.carrusel_posicion ?? "Sin dato"}`
    );
    setCardState(mqttMotorCarruselCard, stateName(motorCarrusel));

    mqttSensores.textContent = `${activeCount} sensor${Number(activeCount) === 1 ? "" : "es"} activo${Number(activeCount) === 1 ? "" : "s"}`;
    mqttSensoresDetalle.textContent = sensorNames.length
      ? sensorNames.join(" | ")
      : [
          `botella: ${boolText(sensores.botella_detectada)}`,
          `base: ${boolText(sensores.base_girando)}`,
          `proceso: ${sensores.proceso_actual || "Sin dato"}`,
        ].join(" | ");
    setCardState(mqttSensoresCard, Number(activeCount) > 0 ? "active" : "idle");
    updateMachineAnimation({
      bandaActive: isActiveState(motorBanda),
      carruselActive: isActiveState(motorCarrusel),
      sensorCount,
      botellaDetected: sensores.botella_detectada === true || sensorNames.includes("botella_detectada"),
      baseActive: sensores.base_girando === true || sensorNames.includes("base_girando"),
      processActive: Boolean(sensores.proceso_actual),
    });
  } else {
    mqttMotorBanda.textContent = "Sin datos";
    mqttMotorBandaDetalle.textContent = "Esperando mensaje.";
    mqttMotorCarrusel.textContent = "Sin datos";
    mqttMotorCarruselDetalle.textContent = "Esperando mensaje.";
    mqttSensores.textContent = "Sin datos";
    renderJsonDetail(mqttSensoresDetalle, sensores);
    setCardState(mqttMotorBandaCard, "");
    setCardState(mqttMotorCarruselCard, "");
    setCardState(mqttSensoresCard, "");
    updateMachineAnimation({
      bandaActive: false,
      carruselActive: false,
      sensorCount: 0,
      botellaDetected: false,
      baseActive: false,
      processActive: false,
    });
  }

  const alcohol = payloadOf(topics, "corona/alcohol");
  const alcoholTime = entryTimeOf(topics, "corona/alcohol");
  const alcoholValue = alcoholValueFromPayload(alcohol);
  if (Number.isFinite(alcoholValue)) {
    mqttAlcohol.textContent = `${alcoholValue.toFixed(1)} grados`;
    renderJsonDetail(mqttAlcoholDetalle, alcohol);
    setCardState(mqttAlcoholCard, alcoholValue >= 4.2 ? "danger" : alcoholValue >= 3.8 ? "warning" : "active");
    setCardState(alcoholTrendCard, alcoholValue >= 4.2 ? "danger" : alcoholValue >= 3.8 ? "warning" : "active");
    if (alcoholTime > lastAlcoholUpdateAt) {
      lastAlcoholUpdateAt = alcoholTime;
      addAlcoholTrendPoint(alcoholValue, "mqtt");
    }
  } else if (alcohol) {
    mqttAlcohol.textContent = "Sin lectura numerica";
    renderJsonDetail(mqttAlcoholDetalle, alcohol);
    setCardState(mqttAlcoholCard, "warning");
    setCardState(alcoholTrendCard, "warning");
  }

  const ia = payloadOf(topics, "corona/ia");
  if (ia && typeof ia === "object") {
    mqttIa.textContent = ia.resultado || (ia.correcto === true || ia.accepted === true ? "normal" : ia.correcto === false || ia.accepted === false ? "adulterada" : "Sin resultado");
    mqttIaDetalle.textContent = `confianza: ${fixedNumber(ia.confianza, 2)}${ia.detalle ? ` | ${ia.detalle}` : ""}`;
    setCardState(mqttIaCard, normalizeText(mqttIa.textContent).includes("adulter") ? "danger" : "active");
  } else {
    mqttIa.textContent = "Sin datos";
    renderJsonDetail(mqttIaDetalle, ia);
    setCardState(mqttIaCard, "");
  }

  const eventEntry = mqtt.events && mqtt.events.length ? mqtt.events[0].payload : payloadOf(topics, "corona/eventos");
  if (eventEntry && typeof eventEntry === "object") {
    mqttEvento.textContent = eventEntry.evento || "Evento recibido";
    renderJsonDetail(mqttEventoDetalle, eventEntry);
    setCardState(mqttEventoCard, stateName(mqttEvento.textContent) || "info");
  } else {
    mqttEvento.textContent = eventEntry || "Sin datos";
    renderJsonDetail(mqttEventoDetalle, eventEntry);
    setCardState(mqttEventoCard, eventEntry ? "info" : "");
  }

  const estadoValue = estado && typeof estado === "object" ? estado.estado : estado;
  const procesoValue = sensores && typeof sensores === "object" ? sensores.proceso_actual : "";
  const waitingIa = normalizeText(estadoValue) === "esperando_ia" || normalizeText(procesoValue) === "esperando_ia";
  const waitingSignalAt = Math.max(estadoTime, sensoresTime);

  if (waitingIa && waitingSignalAt > lastMqttWaitingSignalAt) {
    lastMqttWaitingSignalAt = waitingSignalAt;
    startMqttTriggeredDetection();
  }

  if (!waitingIa && mqttWaitMode && !mqttDetectionActive && !liveMode) {
    setStatus("Esperando senal MQTT: esperando_ia");
  }
}

async function refreshMqttState() {
  try {
    const response = await fetch("/api/mqtt");
    const data = await response.json();
    if (response.ok && data.ok) {
      renderMqttState(data);
    }
  } catch (error) {
    mqttState.textContent = "Sin respuesta";
    mqttState.classList.remove("connected");
    mqttStatusDot.classList.remove("connected");
  }
}

async function sendMqttCommand(command) {
  try {
    const response = await fetch("/api/mqtt/comando", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comando: command }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "No se pudo enviar comando MQTT.");
    }
    setStatus(`Comando MQTT: ${command}`);
    refreshMqttState();
  } catch (error) {
    setStatus(error.message || "No se pudo enviar comando MQTT", true);
  }
}

function aiResultFromDetections(detections) {
  if (!detections.length) {
    return {
      resultado: "adulterada",
      confianza: 0,
      detalle: "nada_detectado",
    };
  }

  const incorrect = detections.find((item) => {
    const label = normalizeText(item.label);
    return label.includes("incorrect") || label.includes("adulter");
  });

  if (incorrect) {
    return {
      resultado: "adulterada",
      confianza: incorrect.confidence,
      detalle: incorrect.label,
    };
  }

  const best = detections.reduce((current, item) => (
    item.confidence > current.confidence ? item : current
  ), detections[0]);
  return {
    resultado: "normal",
    confianza: best.confidence,
    detalle: best.label,
  };
}

async function publishIaResult(result) {
  const response = await fetch("/api/mqtt/ia", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(result),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || "No se pudo publicar resultado IA.");
  }
}

async function readQrCodesFromCanvas() {
  if (!qrDetector) return [];

  try {
    const codes = await qrDetector.detect(liveCanvas);
    return codes
      .map((code) => code.rawValue)
      .filter(Boolean);
  } catch (error) {
    return [];
  }
}

async function framePayload() {
  const sourceWidth = video.videoWidth || 640;
  const sourceHeight = video.videoHeight || 480;
  const targetWidth = Math.min(LIVE_FRAME_WIDTH, sourceWidth || LIVE_FRAME_WIDTH);
  const targetHeight = Math.round((sourceHeight / sourceWidth) * targetWidth);

  liveCanvas.width = targetWidth;
  liveCanvas.height = targetHeight;
  liveCtx.setTransform(1, 0, 0, 1, 0, 0);
  liveCtx.clearRect(0, 0, targetWidth, targetHeight);

  if (unmirrorCamera) {
    liveCtx.translate(targetWidth, 0);
    liveCtx.scale(-1, 1);
  }

  liveCtx.drawImage(video, 0, 0, targetWidth, targetHeight);
  liveCtx.setTransform(1, 0, 0, 1, 0, 0);
  const qrCodes = await readQrCodesFromCanvas();
  return {
    image: liveCanvas.toDataURL("image/jpeg", LIVE_JPEG_QUALITY),
    qrCodes,
    width: targetWidth,
    height: targetHeight,
  };
}

async function sendLiveFrame() {
  frameCount += 1;
  const analyzeSeal = frameCount % SEAL_ANALYSIS_EVERY === 0;
  const readText = frameCount % (SEAL_ANALYSIS_EVERY * 3) === 0;
  showLiveCamera();
  const payload = await framePayload();

  const response = await fetch("/api/detect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image: payload.image,
      confidence: confidence.value,
      qr_codes: payload.qrCodes,
      analyze_seal: analyzeSeal,
      read_text: readText,
      return_annotated: false,
    }),
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || "Error en la deteccion.");
  }

  lastFrameSize = { width: payload.width || LIVE_FRAME_WIDTH, height: payload.height || 480 };
  lastDetections = data.detections;
  drawOverlay();
  renderDetections(data.detections);
  if (data.seal) {
    renderSealInfo(data.seal);
  }

  if (mqttDetectionActive && !mqttIaPublished) {
    const elapsed = Date.now() - mqttDetectionStartedAt;
    if (data.detections.length || elapsed >= MQTT_IA_TIMEOUT_MS) {
      const result = aiResultFromDetections(data.detections);
      await publishIaResult(result);
      mqttIaPublished = true;
      setStatus(`IA enviada: ${result.resultado}`);
      stopLiveDetection("Resultado IA enviado");
    }
  }
}

async function detectLiveFrame() {
  if (!liveMode || liveBusy) return;

  liveBusy = true;
  try {
    await sendLiveFrame();
    setStatus("En vivo");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    liveBusy = false;
  }

  if (liveMode) {
    liveTimer = window.setTimeout(detectLiveFrame, LIVE_INTERVAL_MS);
  }
}

async function openCameraStream() {
  const preferred = {
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 8, max: 10 },
      facingMode: { ideal: "environment" },
    },
    audio: false,
  };

  try {
    return await navigator.mediaDevices.getUserMedia(preferred);
  } catch (error) {
    return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }
}

function waitForVideoReady() {
  if (video.videoWidth && video.videoHeight) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("La camara no entrego imagen."));
    }, 5000);

    function cleanup() {
      window.clearTimeout(timeout);
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("canplay", onReady);
    }

    function onReady() {
      cleanup();
      resolve();
    }

    video.addEventListener("loadedmetadata", onReady, { once: true });
    video.addEventListener("canplay", onReady, { once: true });
  });
}

async function startLiveDetection(options = {}) {
  if (liveMode) return;

  try {
    resetResults();
    liveMode = true;
    detectLive.disabled = true;
    mqttDetectionActive = Boolean(options.fromMqtt);
    mqttIaPublished = false;
    mqttDetectionStartedAt = Date.now();
    setStatus(options.fromMqtt ? "Senal MQTT recibida: detectando" : "Conectando camara");
    stream = await openCameraStream();
    video.srcObject = stream;
    showLiveCamera();
    await video.play();
    await waitForVideoReady();
    detectLiveFrame();
  } catch (error) {
    liveMode = false;
    mqttDetectionActive = false;
    detectLive.disabled = false;
    setStatus(error.message || "No se pudo abrir la camara", true);
  }
}

function startMqttTriggeredDetection() {
  mqttWaitMode = true;
  if (liveMode || mqttDetectionActive) return;
  startLiveDetection({ fromMqtt: true });
}

function stopLiveDetection(statusText = "Camara detenida") {
  mqttWaitMode = false;
  liveMode = false;
  liveBusy = false;
  mqttDetectionActive = false;
  window.clearTimeout(liveTimer);
  detectLive.disabled = mqttWaitMode;
  setStatus(statusText);

  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
    video.srcObject = null;
  }

  video.classList.remove("active");
  cameraStage.classList.remove("active");
  clearOverlay();
  outputPreview.classList.remove("active");
  outputEmpty.classList.remove("hidden");
}

async function detectSelectedImage() {
  if (imageBusy) return;

  const file = testImage.files && testImage.files[0];
  if (!file) {
    setStatus("Elige una foto primero", true);
    return;
  }

  liveMode = false;
  mqttDetectionActive = false;
  liveBusy = false;
  window.clearTimeout(liveTimer);
  detectLive.disabled = mqttWaitMode;

  const formData = new FormData();
  formData.append("image", file);
  formData.append("confidence", confidence.value);
  formData.append("analyze_seal", "true");
  formData.append("read_text", "true");
  formData.append("return_annotated", "true");

  try {
    imageBusy = true;
    detectImage.disabled = true;
    setStatus("Analizando foto");
    const response = await fetch("/api/detect", {
      method: "POST",
      body: formData,
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Error en la deteccion.");
    }

    if (data.annotated_image) {
      showOutput(data.annotated_image);
    }
    renderDetections(data.detections);
    renderSealInfo(data.seal || null);
    setStatus(data.detections.length ? "Foto detectada" : "Foto sin detecciones", !data.detections.length);
  } catch (error) {
    setStatus(error.message || "No se pudo analizar la foto", true);
  } finally {
    imageBusy = false;
    detectImage.disabled = false;
  }
}

confidence.addEventListener("input", () => {
  confidenceValue.textContent = Number(confidence.value).toFixed(2);
});

testImage.addEventListener("change", () => {
  const file = testImage.files && testImage.files[0];
  testImageName.textContent = file ? file.name : "Elegir imagen";
});

detectLive.addEventListener("click", () => {
  mqttWaitMode = false;
  startLiveDetection();
});
stopLive.addEventListener("click", () => stopLiveDetection());
detectImage.addEventListener("click", detectSelectedImage);
video.addEventListener("loadedmetadata", drawOverlay);
window.addEventListener("resize", drawOverlay);
mqttCommandButtons.forEach((button) => {
  button.addEventListener("click", () => sendMqttCommand(button.dataset.command));
});
refreshMqttState();
window.setInterval(refreshMqttState, MQTT_INTERVAL_MS);
updateSimulatedAlcohol();
window.setInterval(updateSimulatedAlcohol, MQTT_INTERVAL_MS);
