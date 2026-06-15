# Proyecto de automatizacion - Detector YOLO

Aplicacion web local para detectar en tiempo real el estado de una botella usando un modelo YOLO entrenado con datos de Roboflow. La deteccion se realiza directamente con la camara del navegador.

## Que detecta

El modelo incluido por defecto es `models/080062026.pt` y reconoce estas clases:

- `contenido_correcto`
- `contenido_incorrecto`
- `correcto`
- `sello_correcto`
- `sello_incorrecto`
- `tapa_correcta`
- `tapa_incorrecta`

Cuando no encuentra ningun objeto con la confianza seleccionada, la interfaz muestra `No detecta nada`.

## Requisitos

- Python 3.11 recomendado.
- Conda o Miniconda recomendado.
- Camara web o camara del telefono expuesta al navegador, si se quiere usar deteccion en vivo.

## Instalacion

Clona el repositorio:

```powershell
git clone https://github.com/soniaadrianaramirezescobar-afk/proyetco-automatizacion.git
cd proyetco-automatizacion
```

Crea el entorno con Conda:

```powershell
conda env create -f environment.yml
conda activate captura-imagenes
```

Si Flask no quedara instalado en tu entorno, instalalo con:

```powershell
pip install flask
```

## Ejecutar la app

Desde la carpeta del proyecto:

```powershell
python app.py
```

Luego abre en el navegador:

```text
http://127.0.0.1:5000
```

## Como usar

1. Abre la app en `http://127.0.0.1:5000`.
2. Ajusta la confianza minima si quieres detecciones mas estrictas o mas permisivas.
3. Pulsa `Detectar` y acepta el permiso de camara del navegador.
4. La app analiza frames continuamente en tiempo real.
5. Revisa la imagen anotada, todas las etiquetas detectadas, la confianza y las coordenadas.
6. Si detecta varias etiquetas en el mismo frame, las muestra juntas en el estado y detalladas en la tabla.
7. Pulsa `Detener` para parar la camara.

## Cambiar modelo o confianza

Por defecto la app usa:

```text
models/080062026.pt
```

Para usar otro modelo en PowerShell:

```powershell
$env:YOLO_MODEL_PATH="models/best.pt"
python app.py
```

Para cambiar la confianza inicial:

```powershell
$env:YOLO_CONFIDENCE="0.45"
python app.py
```

Tambien puedes cambiar la confianza desde el control deslizante de la interfaz.

## MQTT

La app lee estos topics y los muestra en el panel `Proceso MQTT`:

```text
corona/estado
corona/sensores
corona/peso
corona/alcohol
corona/ia
corona/comandos
corona/eventos
```

Por defecto se conecta a `192.168.1.10:1883`. Para cambiar el broker:

```powershell
$env:MQTT_BROKER_HOST="192.168.1.10"
$env:MQTT_BROKER_PORT="1883"
python app.py --serve
```

Los botones de MQTT publican comandos en `corona/comandos`, por ejemplo `{"comando":"iniciar"}`.

## Estructura principal

```text
app.py                  Backend Flask y carga del modelo YOLO
static/app.js           Logica de la interfaz y deteccion en vivo
static/styles.css       Estilos de la interfaz
templates/index.html    Pantalla principal
models/                 Modelos YOLO locales
testeo/                 Archivos de prueba; sus carpetas internas estan ignoradas por Git
```

## Notas

- La app corre localmente con el servidor de desarrollo de Flask.
- Para produccion se recomienda usar un servidor WSGI.
- Los archivos generados por Python, caches y carpetas de pruebas estan controlados desde `.gitignore`.

