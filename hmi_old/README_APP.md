# App detector YOLO

Esta app usa el modelo local `models/080062026.pt` para detectar las clases entrenadas:

- `contenido_correcto`
- `contenido_incorrecto`
- `correcto`
- `sello_correcto`
- `sello_incorrecto`
- `tapa_correcta`
- `tapa_incorrecta`

## Ejecutar

Desde esta carpeta:

```powershell
python app.py
```

Luego abre:

```text
http://127.0.0.1:5000
```

## Uso

Pulsa `Detectar`. La app toma frames desde DroidCam en Android usando:

```text
http://192.168.26.2:4747/video
```

Los frames se mandan al modelo y la interfaz se actualiza con:

- Imagen anotada con cajas.
- Todas las etiquetas detectadas en el frame actual.
- Confianza y coordenadas.
- Mensaje `No detecta nada` cuando no hay detecciones con la confianza seleccionada.

Si detecta varias etiquetas al mismo tiempo, las muestra juntas en el estado principal y detalladas en la tabla.

Si DroidCam cambia de IP o puerto, inicia la app asi:

```powershell
$env:DROIDCAM_URL="http://TU_IP:4747/video"
python app.py --serve
```

## Cambiar modelo o confianza

Por defecto usa `models/080062026.pt`. Para usar otro archivo:

```powershell
$env:YOLO_MODEL_PATH="models/best.pt"
python app.py
```

Para cambiar la confianza inicial:

```powershell
$env:YOLO_CONFIDENCE="0.45"
python app.py
```
