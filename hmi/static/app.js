const mqttConnection = document.querySelector("#mqttConnection");
const brokerLabel = document.querySelector("#brokerLabel");
const inicioStation = document.querySelector("#inicioStation");
const finStation = document.querySelector("#finStation");
const inicioState = document.querySelector("#inicioState");
const finState = document.querySelector("#finState");
const belt = document.querySelector("#belt");
const bottle = document.querySelector("#bottle");
const turntableStation = document.querySelector("#turntableStation");
const motorBlock = document.querySelector("#motorBlock");
const mq4OneHead = document.querySelector("#mq4OneHead");
const mq4TwoHead = document.querySelector("#mq4TwoHead");
const mq4OneValue = document.querySelector("#mq4OneValue");
const mq4TwoValue = document.querySelector("#mq4TwoValue");
const eventCount = document.querySelector("#eventCount");
const eventsList = document.querySelector("#eventsList");
const modelWindow = document.querySelector("#modelWindow");
const modelStatus = document.querySelector("#modelStatus");
const modelFrame = document.querySelector("#modelFrame");
const modelPlaceholder = document.querySelector("#modelPlaceholder");
const modelDetections = document.querySelector("#modelDetections");
const startModelButton = document.querySelector("#startModelButton");
const stopModelButton = document.querySelector("#stopModelButton");
let bottleMode = "";
let lastModelFrameUpdate = 0;
let modelFrameEnabled = false;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

function formatTime(ms) {
  if (!ms) return "sin hora";
  return new Date(ms).toLocaleTimeString("es-BO", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function eventTitle(payload) {
  if (!payload) return "Sin datos";
  if (payload.tipo === "banda") return `Banda ${payload.evento}`;
  if (payload.tipo === "sensor_infrarrojo") return `Sensor ${payload.sensor} ${payload.evento}`;
  if (payload.tipo === "mq4") return `${payload.sensor} ${payload.valor} ${payload.unidad || "ppm"}`;
  if (payload.evento === "qr_detectado") return "QR detectado";
  if (payload.tipo === "modelo") return "Modelo actualizado";
  return payload.evento || payload.tipo || "Evento";
}

function eventDetail(payload) {
  if (!payload) return "Esperando mensajes en MQTT.";
  if (payload.tipo === "banda") return payload.activa ? "La banda esta en movimiento." : "La banda esta detenida.";
  if (payload.tipo === "sensor_infrarrojo") return payload.detecta ? "Objeto detectado por el infrarrojo." : "El infrarrojo quedo libre.";
  if (payload.tipo === "mq4") return "Lectura de alcohol recibida.";
  if (payload.evento === "qr_detectado") return "El modelo envio la senal para detener el giro.";
  if (payload.evento === "giro_botella_inicia") return "La botella esta girando para buscar el QR.";
  if (payload.evento === "giro_botella_detiene") return "El giro se detuvo.";
  if (payload.tipo === "modelo") return payload.qrDetectado ? "QR visible en camara." : "Inferencia recibida.";
  return JSON.stringify(payload);
}

function eventClass(payload) {
  if (!payload) return "event-generic";
  if (payload.tipo === "banda") return payload.activa ? "event-run" : "event-stop";
  if (payload.tipo === "sensor_infrarrojo") return payload.detecta ? "event-sensor" : "event-free";
  if (payload.tipo === "mq4") return "event-alcohol";
  if (payload.evento === "qr_detectado") return "event-qr";
  if (payload.evento === "giro_botella_inicia") return "event-spin";
  if (payload.evento === "giro_botella_detiene") return "event-stop";
  return "event-generic";
}

function renderMqtt(mqtt) {
  mqttConnection.classList.toggle("connected", Boolean(mqtt.connected));
  mqttConnection.querySelector("strong").textContent = mqtt.connected ? "MQTT conectado" : "MQTT desconectado";
  brokerLabel.textContent = `${mqtt.topic} @ ${mqtt.broker}:${mqtt.port}`;
  if (mqtt.error) {
    brokerLabel.textContent = mqtt.error;
  }
}

function renderSensor(station, label, data) {
  station.classList.toggle("detecting", Boolean(data.detecta));
  label.textContent = data.detecta ? "Detecta" : "Libre";
}

function posicionarBotella(state) {
  const bandaActiva = Boolean(state.banda.activa);
  const giroActivo = Boolean(state.giro.activo);
  const inicioDetecta = Boolean(state.sensores.inicio.detecta);
  const finDetecta = Boolean(state.sensores.fin.detecta);
  let nextMode = "";

  if (finDetecta) {
    nextMode = "at-end";
  } else if (bandaActiva) {
    nextMode = "in-transit";
  } else if (inicioDetecta) {
    nextMode = "at-start";
  }

  if (nextMode !== bottleMode) {
    bottleMode = nextMode;
    bottle.classList.remove("at-start", "in-transit", "at-end");

    if (nextMode) {
      bottle.classList.add(nextMode);
    }
  }

  bottle.classList.toggle("spinning", giroActivo && nextMode === "at-end");
  turntableStation.classList.toggle("active", giroActivo);
}

function renderBanda(banda) {
  const activa = Boolean(banda.activa);
  belt.classList.toggle("running", activa);
  motorBlock.classList.toggle("running", activa);
}

function formatAlcohol(sensor) {
  if (sensor.valor === null || sensor.valor === undefined) return `-- ${sensor.unidad || "ppm"}`;
  return `${Number(sensor.valor).toFixed(1)} ${sensor.unidad || "ppm"}`;
}

function renderAlcohol(alcohol) {
  const mq4One = formatAlcohol(alcohol.mq4_1);
  const mq4Two = formatAlcohol(alcohol.mq4_2);
  mq4OneValue.textContent = mq4One;
  mq4TwoValue.textContent = mq4Two;
  mq4OneHead.classList.toggle("detecting", Number(alcohol.mq4_1.valor || 0) > 0);
  mq4TwoHead.classList.toggle("detecting", Number(alcohol.mq4_2.valor || 0) > 0);
}

function renderModelo(modelo, giroActivo) {
  const activo = Boolean(modelo.activo);
  const qrDetectado = Boolean(modelo.qrDetectado);
  const detecciones = modelo.detecciones || [];
  const visible = Boolean(giroActivo);
  modelFrameEnabled = visible && (activo || detecciones.length > 0);
  modelWindow.classList.toggle("visible", visible);
  modelWindow.classList.toggle("active", activo);
  modelWindow.classList.toggle("qr-found", qrDetectado);
  modelStatus.textContent = modelo.error || (qrDetectado ? "QR detectado" : activo ? "Inferiendo" : "Detenido");
  startModelButton.disabled = activo;
  stopModelButton.disabled = !activo;

  if (!detecciones.length) {
    modelDetections.textContent = modelo.error || "Sin detecciones";
  } else {
    modelDetections.innerHTML = detecciones
      .slice(0, 4)
      .map((item) => `${escapeHtml(item.etiqueta)} ${(Number(item.confianza || 0) * 100).toFixed(0)}%`)
      .join("<br>");
  }

  if (!modelFrameEnabled || !visible) {
    modelFrame.removeAttribute("src");
    modelPlaceholder.style.display = "grid";
  }
}

function renderEventos(eventos) {
  eventCount.textContent = String(eventos.length);
  if (!eventos.length) {
    eventsList.innerHTML = '<div class="event-row event-generic"><span class="event-time">Sin eventos</span><span class="event-marker"></span><strong>Esperando</strong><span class="event-copy">Publica en el topico cheve.</span></div>';
    return;
  }

  eventsList.innerHTML = eventos
    .map((evento) => {
      const payload = evento.payload;
      return `
        <div class="event-row ${eventClass(payload)}">
          <span class="event-time">${formatTime(evento.recibidoMs)}</span>
          <span class="event-marker"></span>
          <strong>${eventTitle(payload)}</strong>
          <span class="event-copy">${eventDetail(payload)}</span>
        </div>
      `;
    })
    .join("");
}

function render(state) {
  renderMqtt(state.mqtt);
  renderSensor(inicioStation, inicioState, state.sensores.inicio);
  renderSensor(finStation, finState, state.sensores.fin);
  renderBanda(state.banda);
  posicionarBotella(state);
  renderAlcohol(state.alcohol);
  renderModelo(state.modelo || {}, Boolean(state.giro.activo));
  renderEventos(state.eventos || []);
}

async function controlarModelo(ruta) {
  const response = await fetch(ruta, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ camara: 0, confianza: 0.35 }),
  });
  const result = await response.json();
  if (!result.ok) {
    modelStatus.textContent = result.mensaje || "No se pudo iniciar";
  }
}

function refrescarFrameModelo() {
  if (!modelFrameEnabled) return;

  const now = Date.now();
  if (now - lastModelFrameUpdate < 350) return;
  lastModelFrameUpdate = now;
  modelFrame.src = `/api/modelo/frame?t=${now}`;
  modelPlaceholder.style.display = "none";
}

async function cargarEstadoInicial() {
  const response = await fetch("/api/state", { cache: "no-store" });
  render(await response.json());
}

function conectarEventos() {
  const source = new EventSource("/events");
  source.onmessage = (event) => render(JSON.parse(event.data));
  source.onerror = () => {
    mqttConnection.classList.remove("connected");
    mqttConnection.querySelector("strong").textContent = "HMI reconectando";
  };
}

cargarEstadoInicial();
conectarEventos();

startModelButton.addEventListener("click", () => controlarModelo("/api/modelo/iniciar"));
stopModelButton.addEventListener("click", () => controlarModelo("/api/modelo/detener"));
modelFrame.addEventListener("error", () => {
  modelPlaceholder.style.display = "grid";
});
setInterval(refrescarFrameModelo, 500);
