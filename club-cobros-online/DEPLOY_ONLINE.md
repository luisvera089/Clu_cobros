# Despliegue online

Esta version puede publicarse en Render con un disco persistente. Asi la app queda en una URL publica y no depende de que el PC este encendido.

## Antes de subir

1. Cambia el codigo administrador. No uses `club2026` en internet.
2. Guarda una copia del archivo `data/access-codes.json` y del Excel de codigos.
3. Ten claro que los pagos los sube la familia/deportista con soporte; el administrador crea deportistas e items de cobro.

## Render

1. Crea una cuenta en Render.
2. Sube esta carpeta a un repositorio de GitHub.
3. En Render crea un nuevo `Blueprint` usando el archivo `render.yaml`.
4. Define la variable `ADMIN_CODE` con una clave fuerte.
5. Render creara un disco persistente en `/var/data`.

El archivo `render.yaml` ya configura:

- `DATA_DIR=/var/data`
- `UPLOAD_DIR=/var/data/uploads`
- disco persistente de 1 GB
- arranque con `node server.js`

## Primer arranque

Cuando el disco persistente esta vacio, la app copia la base inicial incluida en el paquete:

- `data/store.json`
- `data/access-codes.json`

Despues de eso, los cambios nuevos quedan en el disco persistente del servidor.

## Operacion diaria

- Administrador: entra con `ADMIN_CODE`, agrega deportistas, crea items de cobro, carga deportistas o items masivamente, revisa/aprueba/rechaza pagos y elimina registros errados.
- Familias/deportistas: buscan el nombre, ingresan codigo o contrasena, seleccionan item de cobro, ponen total o abono, adjuntan soporte y envian.

## Copias de seguridad

Descarga periodicamente:

- `data/store.json`
- `data/access-codes.json`
- carpeta de soportes `uploads`

En Render se puede hacer desde el shell o descargando backups del disco si tu plan lo permite.
