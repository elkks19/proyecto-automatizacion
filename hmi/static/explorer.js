const mqttConnection = document.querySelector("#mqttConnection");
const brokerLabel = document.querySelector("#brokerLabel");
const explorerMqtt = document.querySelector("#explorerMqtt");
const explorerBanda = document.querySelector("#explorerBanda");
const explorerGiro = document.querySelector("#explorerGiro");
const explorerInicio = document.querySelector("#explorerInicio");
const explorerFin = document.querySelector("#explorerFin");
const explorerMq4One = document.querySelector("#explorerMq4One");
const explorerMq4Two = document.querySelector("#explorerMq4Two");
const explorerModelo = document.querySelector("#explorerModelo");
const explorerQr = document.querySelector("#explorerQr");
const eventCount = document.querySelector("#eventCount");
const timelineTrack = document.querySelector("#timelineTrack");

let timelineEvents = [];
let timelineIds = new Set();
let loadingOlderEvents = false;
let hasMoreEvents = true;

function formatTime(ms) {
  if (!ms) return "sin hora";
  return new Date(ms).toLocaleTimeString("es-BO", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatAlcohol(sensor) {
  if (sensor.valor === null || sensor.valor === undefined) return `-- ${sensor.unidad || "ppm"}`;
  return `${Number(sensor.valor).toFixed(1)} ${sensor.unidad || "ppm"}`;
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
  if (mqtt.error) brokerLabel.textContent = mqtt.error;
}

function renderExplorador(state) {
  explorerMqtt.textContent = state.mqtt.connected ? "conectado" : "desconectado";
  explorerBanda.textContent = state.banda.activa ? "moviendo" : "detenida";
  explorerGiro.textContent = state.giro.activo ? "girando" : "detenido";
  explorerInicio.textContent = state.sensores.inicio.detecta ? "detecta" : "libre";
  explorerFin.textContent = state.sensores.fin.detecta ? "detecta" : "libre";
  explorerMq4One.textContent = formatAlcohol(state.alcohol.mq4_1);
  explorerMq4Two.textContent = formatAlcohol(state.alcohol.mq4_2);
  explorerModelo.textContent = state.modelo?.error || (state.modelo?.activo ? "inferiendo" : "detenido");
  explorerQr.textContent = state.modelo?.qrDetectado ? "detectado" : "no detectado";
}

function eventKey(evento) {
  return evento.id || `${evento.recibidoMs}-${JSON.stringify(evento.payload)}`;
}

function mergeTimeline(eventos, prepend = false) {
  const nuevos = eventos.filter((evento) => {
    const key = eventKey(evento);
    if (timelineIds.has(key)) return false;
    timelineIds.add(key);
    return true;
  });

  if (!nuevos.length) return;

  timelineEvents = prepend ? [...nuevos, ...timelineEvents] : [...timelineEvents, ...nuevos];
  renderTimeline();
}

function renderTimeline() {
  eventCount.textContent = String(timelineEvents.length);

  if (!timelineEvents.length) {
    timelineTrack.innerHTML = '<article class="timeline-card empty"><span>Sin eventos</span><strong>Esperando</strong><p>Publica en el topico cheve.</p></article>';
    return;
  }

  timelineTrack.innerHTML = timelineEvents
    .map((evento) => {
      const payload = evento.payload;
      return `
        <article class="timeline-card ${eventClass(payload)}">
          <span class="timeline-dot"></span>
          <span>${formatTime(evento.recibidoMs)}</span>
          <strong>${eventTitle(payload)}</strong>
          <p>${eventDetail(payload)}</p>
        </article>
      `;
    })
    .join("");
}

async function cargarEventosAnteriores() {
  if (loadingOlderEvents || !hasMoreEvents || !timelineEvents.length) return;

  loadingOlderEvents = true;
  const oldest = timelineEvents[timelineEvents.length - 1];
  const response = await fetch(`/api/events?before_id=${oldest.id || 0}&limit=30`, {
    cache: "no-store",
  });
  const data = await response.json();
  hasMoreEvents = Boolean(data.hasMore);
  mergeTimeline(data.eventos || []);
  loadingOlderEvents = false;
}

function render(state) {
  renderMqtt(state.mqtt);
  renderExplorador(state);
  mergeTimeline(state.eventos || [], true);
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

timelineTrack.addEventListener("scroll", () => {
  const remaining =
    timelineTrack.scrollWidth - timelineTrack.scrollLeft - timelineTrack.clientWidth;

  if (remaining < 180) cargarEventosAnteriores();
});
