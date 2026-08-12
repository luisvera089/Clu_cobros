# Club Cobros

Aplicacion web local para registrar pagos de deportistas, adjuntar soportes y revisar reportes administrativos por persona, equipo e item.

## Ejecutar

```powershell
cd "C:\Users\Luis Vera\Documents\Codex\2026-07-15\ne\work\club-cobros"
.\start.ps1
```

Por defecto abre en `http://localhost:4317`. Si el puerto esta ocupado, el servidor intenta el siguiente.

Para entrar desde un celular, ambos equipos deben estar en la misma red Wi-Fi. Usa la URL de red local que aparece al iniciar, por ejemplo:

```text
http://192.168.20.26:4317
```

Si Windows pregunta por permisos de red para Node.js, permite acceso en red privada. Si el celular sigue sin abrir, revisa que no este usando datos moviles o una red Wi-Fi distinta.

El codigo administrador inicial es `club2026`. Para cambiarlo:

```powershell
$env:ADMIN_CODE="otro-codigo"; .\start.ps1
```

## Seguridad de ingreso

Cada deportista tiene un codigo inicial privado en `codigos-acceso-deportistas.csv`. En el primer ingreso la app obliga a cambiar ese codigo por una contrasena nueva antes de mostrar pagos o permitir subir soportes.

Desde el panel administrador puedes cambiar o reiniciar el codigo/contrasena de cualquier deportista. Si marcas que debe cambiarla, el deportista tendra que crear una nueva contrasena en el siguiente ingreso.

El codigo administrador no queda guardado en el navegador. Si cierras o recargas la pagina, debes volver a entrar al panel administrador.

## Administracion

Despues de entrar al panel administrador veras dos botones directos:

- `Agregar cobro`: crea un item de cobro para todo un equipo o para un deportista especifico.
- `Agregar deportista`: agrega una persona a un equipo y genera su codigo inicial privado.
- `Cargar masivo`: pega datos desde Excel/CSV para crear muchos deportistas o muchos items de cobro.

Los pagos no se registran desde administrador. La familia/deportista debe ingresar con su clave, seleccionar el item de cobro, escribir si paga total o abona, adjuntar soporte y enviar.

El administrador si puede aprobar, rechazar o eliminar pagos recibidos cuando necesite corregir un error.

## Valores y saldos

Los valores que vienen en el Excel se importan como pagos ya realizados o abonos. La app cruza esos abonos contra el valor total esperado de cada item y muestra total, abonado y saldo pendiente.

- Mensualidad: 80.000 antes o el dia 10; 90.000 despues del dia 10 para el mes en curso si no esta pagada.
- Mono: 30.000.
- Pista: 50.000 para BLUE, 4EVER y MA5; 35.000 para los demas equipos, excepto KIDS y FORMATIVO.
- Uniforme competencia: 400.000 para BLUE, 4EVER y MA5; 350.000 para CLAWS, CRUSH, MAGIC, PIXIES, MYSTIC y WINGS.
- Uniforme entrenamiento: 130.000; prenda suelta: 65.000.
- Continental: 190.000; Medcheer, Bigshow y Liga: 100.000 cada uno.
- Bucaramanga deportista: 720.000; acompanante: 600.000 por acompanante.
- Capital: 420.000, excepto Yeison Betancur con 220.000.
- Capital Barranquilla: 230.000; Highland Bello: 150.000.
- Finca: 100.000 solo para MA5 y 4EVER.

## Datos

- `src/data/initial-data.json`: deportistas, equipos, items y pagos historicos importados desde el Excel.
- `data/store.json`: pagos nuevos e items creados desde el panel administrador.
- `data/access-codes.json`: codigos privados por deportista. No publicar este archivo.
- `uploads/`: soportes adjuntos.

Para regenerar la base inicial desde el Excel:

```powershell
python scripts/import_excel.py
```

Para regenerar el archivo de codigos que se entrega a las familias:

```powershell
python scripts/generate_access_codes.py
```

Ese comando genera CSV y Excel en la carpeta `outputs`.

## Version online

Lee `DEPLOY_ONLINE.md` para publicar la app en Render con disco persistente. En internet cambia siempre `ADMIN_CODE` por una clave fuerte.
