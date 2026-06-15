#include "SensorInfrarrojo.h"

SensorInfrarrojo::SensorInfrarrojo(uint8_t pinSenal, bool activoEnBajo,
                                   uint8_t modoPin)
    : pinSenal_(pinSenal),
      activoEnBajo_(activoEnBajo),
      modoPin_(modoPin) {}

void SensorInfrarrojo::iniciarConfiguracion() {
  pinMode(pinSenal_, modoPin_);
}

bool SensorInfrarrojo::detectaAlgo() const {
  const int lectura = digitalRead(pinSenal_);
  return activoEnBajo_ ? lectura == LOW : lectura == HIGH;
}
