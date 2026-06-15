#pragma once

#include <Arduino.h>

class Motor {
public:
  Motor(uint8_t pinPaso, uint8_t pinDireccion, unsigned long tiempoAltoMs = 1,
        unsigned long periodoPasoMs = 5);

  void iniciarConfiguracion(bool sentidoHorario = true);
  void iniciar();
  void detener();
  bool estaActivo() const;
  void cambiarSentido(bool sentidoHorario);
  void ejecutarPulsos();
  void darPaso();
  void moverPasos(unsigned long pasos);

private:
  bool puedeIniciarPaso(unsigned long tiempoActualMs) const;
  bool debeFinalizarPulso(unsigned long tiempoActualMs) const;
  void iniciarPulso(unsigned long tiempoActualMs);
  void finalizarPulso();

  uint8_t pinPaso_;
  uint8_t pinDireccion_;
  unsigned long tiempoAltoMs_;
  unsigned long periodoPasoMs_;
  unsigned long ultimoPasoMs_ = 0;
  unsigned long pasosRestantes_ = 0;
  bool estaActivo_ = false;
  bool pulsoAlto_ = false;
  bool movimientoLimitado_ = false;
};
