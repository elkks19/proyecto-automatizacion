#include <Arduino.h>
#include "Motor.h"
#include "PublicadorEventosMqtt.h"
#include "SensorInfrarrojo.h"

const uint8_t PIN_PASO_BANDA = D5;
const uint8_t PIN_DIRECCION_BANDA = D6;
const uint8_t PIN_PASO_GIRO = D7;
const uint8_t PIN_DIRECCION_GIRO = D0;

const uint8_t PIN_SENSOR_INICIO = D1;
const uint8_t PIN_SENSOR_FIN = D2;
const unsigned long TIEMPO_ESPERA_GIRO_MS = 3000;

const char *WIFI_SSID = "FABIANI";
const char *WIFI_CONTRASENA = "BRANDY26";
const char *MQTT_SERVIDOR = "192.168.0.99";
const uint16_t MQTT_PUERTO = 1883;
const char *MQTT_CLIENTE_ID = "esp";
const char *MQTT_TOPICO_EVENTOS = "cheve";

Motor motorBanda(PIN_PASO_BANDA, PIN_DIRECCION_BANDA);
Motor motorGiroBotella(PIN_PASO_GIRO, PIN_DIRECCION_GIRO);
SensorInfrarrojo sensorInicio(PIN_SENSOR_INICIO);
SensorInfrarrojo sensorFin(PIN_SENSOR_FIN);
PublicadorEventosMqtt publicadorEventos(WIFI_SSID, WIFI_CONTRASENA,
                                        MQTT_SERVIDOR, MQTT_PUERTO,
                                        MQTT_CLIENTE_ID, MQTT_TOPICO_EVENTOS);

enum class EtapaProceso {
  parada,
  moviendoBanda,
  esperandoGiro,
  girandoBotella,
  inspeccionTerminada
};

EtapaProceso etapaProceso = EtapaProceso::parada;
bool sensorInicioDetectaba = false;
bool sensorFinDetectaba = false;
unsigned long inicioEsperaGiroMs = 0;

void cambiarEtapaProceso(EtapaProceso nuevaEtapa) {
  if (etapaProceso == nuevaEtapa) {
    return;
  }

  etapaProceso = nuevaEtapa;

  switch (etapaProceso) {
    case EtapaProceso::parada:
      motorBanda.detener();
      motorGiroBotella.detener();
      publicadorEventos.publicarEventoBanda(false);
      publicadorEventos.publicarEvento("proceso_parado");
      break;

    case EtapaProceso::moviendoBanda:
      motorBanda.iniciar();
      motorGiroBotella.detener();
      publicadorEventos.publicarEventoBanda(true);
      break;

    case EtapaProceso::esperandoGiro:
      motorBanda.detener();
      motorGiroBotella.detener();
      inicioEsperaGiroMs = millis();
      publicadorEventos.publicarEventoBanda(false);
      publicadorEventos.publicarEvento("espera_giro_botella");
      break;

    case EtapaProceso::girandoBotella:
      motorBanda.detener();
      motorGiroBotella.iniciar();
      publicadorEventos.publicarEvento("giro_botella_inicia");
      break;

    case EtapaProceso::inspeccionTerminada:
      motorBanda.detener();
      motorGiroBotella.detener();
      publicadorEventos.publicarEvento("giro_botella_detiene", "qr_detectado");
      break;
  }
}

void setup() {
  motorBanda.iniciarConfiguracion(true);
  motorGiroBotella.iniciarConfiguracion(true);
  sensorInicio.iniciarConfiguracion();
  sensorFin.iniciarConfiguracion();
  publicadorEventos.iniciarConfiguracion();

  motorBanda.detener();
  motorGiroBotella.detener();
  sensorInicioDetectaba = sensorInicio.detectaAlgo();
  sensorFinDetectaba = sensorFin.detectaAlgo();
}

void loop() {
  publicadorEventos.mantenerConexion();

  // Entradas
  const bool sensorInicioDetecta = sensorInicio.detectaAlgo();
  const bool sensorFinDetecta = sensorFin.detectaAlgo();

  // Eventos de entrada por flanco
  if (sensorInicioDetecta != sensorInicioDetectaba) {
    publicadorEventos.publicarEventoSensorInfrarrojo("inicio",
                                                     sensorInicioDetecta);
  }

  if (sensorFinDetecta != sensorFinDetectaba) {
    publicadorEventos.publicarEventoSensorInfrarrojo("fin", sensorFinDetecta);
  }

  const bool qrDetectadoPorModelo = publicadorEventos.consumirQrDetectado();

  // Transiciones GRAFCET
  switch (etapaProceso) {
    case EtapaProceso::parada:
      if (sensorInicioDetecta && !sensorFinDetecta) {
        cambiarEtapaProceso(EtapaProceso::moviendoBanda);
      }
      break;

    case EtapaProceso::moviendoBanda:
      if (sensorFinDetecta) {
        cambiarEtapaProceso(EtapaProceso::esperandoGiro);
      }
      break;

    case EtapaProceso::esperandoGiro:
      if (millis() - inicioEsperaGiroMs >= TIEMPO_ESPERA_GIRO_MS) {
        cambiarEtapaProceso(EtapaProceso::girandoBotella);
      }
      break;

    case EtapaProceso::girandoBotella:
      if (qrDetectadoPorModelo) {
        cambiarEtapaProceso(EtapaProceso::inspeccionTerminada);
      }
      break;

    case EtapaProceso::inspeccionTerminada:
      break;
  }

  // Acciones de etapa
  if (etapaProceso == EtapaProceso::moviendoBanda) {
    motorBanda.ejecutarPulsos();
  } else if (etapaProceso == EtapaProceso::girandoBotella) {
    motorGiroBotella.ejecutarPulsos();
  }

  sensorInicioDetectaba = sensorInicioDetecta;
  sensorFinDetectaba = sensorFinDetecta;
}
