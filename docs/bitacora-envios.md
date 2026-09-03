# Proceso: Bitácora de envíos

A partir de los correos **enviados**, redacta la anotación de actividad en
lenguaje neutro, lista para copiar al aplicativo de la empresa.

## Archivos

- `js/bitacora.js` → `scanSentForBitacora()`, `runBitacoraScan()`,
  `generarBitacoraEnvio()`, `startBitacoraWatcher()`,
  `checkBitacoraPendientes()`, `initBitacoraScan()`.
- `js/gmail.js` → `_withGmailToken`, la búsqueda y el parseo de los correos.
- `js/plantillas-correo.js` → `tipoGestionDesdeTarea()` y el vocabulario del
  dominio.
- `index.html` → botón 📄 `#bitacoraScanBtn`, y los ajustes `#bitacoraAutoToggle`,
  `#bitacoraIntervalo`, `#bitacoraDias`.

## Por qué este archivo se llama así

Se llamaba `borradores.js` y traía dos cosas distintas:

1. **Borradores del día**: recorría las tareas de requerimiento vencidas y
   dejaba un borrador puesto en cada hilo de Gmail.
2. **Bitácora de envíos**: lo que documenta este archivo.

Los borradores se retiraron al pasar la base de datos de Firestore a un JSON del
disco ([archivo-datos.md](archivo-datos.md)). La bitácora se quedó porque es una
función aparte, con su propio botón y su propia configuración, y se usa por su
cuenta. El módulo se renombró para que el nombre diga lo que hace.

Con los borradores se fueron `generarBorradorTarea()`, `generarBorradoresDelDia()`,
el icono ✉️ de cada tarea, la sección **Ajustes › Borradores del día** y las
claves `config.borradoresConIA` y `config.borradoresGenerados`. Las plantillas de
`plantillas-correo.js` **no** se fueron: `tipoGestionDesdeTarea()` sigue en uso.

## Cómo funciona

1. Botón 📄 → `runBitacoraScan`.
2. Busca `in:sent` de los últimos N días (`config.bitacoraDias`).
3. `_numerosEnAsunto()` saca los números de trámite del asunto y los empareja
   con trámites **activos**.
4. Por cada coincidencia, Gemini redacta la anotación. Si el correo responde a
   un tercero, resume ambos lados («El contratista solicita X, por tanto se le
   remite Y»).
5. Lo copiado u omitido se recuerda en `config.bitacoraRegistrados`, para no
   volver a ofrecerlo.

**Nada se envía ni se registra automáticamente**: siempre se muestra para
revisar y copiar.

## Vigilancia automática

Con JuriTask abierto, `startBitacoraWatcher()` revisa los enviados cada N
minutos (`config.bitacoraIntervalo`, 10 por defecto) y al volver a la pestaña, y
marca el botón con un badge.

Dos límites que conviene tener presentes:

- Solo usa la Gmail API, que es gratis. **Gemini se llama al pulsar "Generar"**,
  no en la vigilancia.
- Necesita que el permiso de Gmail ya esté concedido en la sesión: el popup
  requiere un gesto del usuario, así que la primera revisión ocurre después de
  usar el correo una vez.
- **No hay push real.** Sin backend, Gmail no puede avisar con la app cerrada.

## Al modificar

- La bitácora depende de la sesión de Google, que hoy es opcional. Cualquier
  entrada nueva debe tolerar `AUTH.activa === false` sin romper: la app arranca
  y funciona sin cuenta ([autenticacion.md](autenticacion.md)).
- `_copiar()` vive en este archivo porque lo usan sus modales. Si hace falta en
  más sitios, súbelo a `ui.js` en vez de duplicarlo.
- `test/smoke.js` comprueba que los borradores **no** han vuelto y que la
  bitácora sigue declarada. Si algún día se rehacen los borradores, esa
  comprobación hay que actualizarla a propósito, no borrarla.
