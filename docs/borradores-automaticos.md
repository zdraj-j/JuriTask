# Proceso: Borradores automáticos

Cada mañana, por cada tarea de requerimiento que vence, deja un **borrador de
respuesta** en el hilo del último correo que lleve el número del trámite en el
asunto. Corre **con la app cerrada**.

Es lo que no se podía hacer sin backend: `gmail-integracion.md` decía "sin
backend Gmail no puede avisar con la app cerrada".

**Nunca envía nada.** Deja el borrador para que lo revises.

## Archivos

- `server/Triggers.gs` → `generarBorradoresDelDia()` y la gestión del trigger
  (`estadoTrigger`, `instalarTrigger`, `quitarTrigger`).
- `server/Plantillas.gs` → **generado** por `tools/build.js` desde
  `js/plantillas-correo.js`.
- `js/backend.js` → `renderTriggerSection`, `aplicarTrigger`, `probarTriggerAhora`.
- `index.html` → sección "Borradores automáticos" en Ajustes.

## Las plantillas son un módulo compartido

`js/plantillas-correo.js` es JS puro: sin DOM, sin `STATE`, sin APIs de
navegador. En vez de duplicarlo en el servidor —que se desincronizaría a la
primera— `tools/build.js` lo copia a `build/Plantillas.gs`, y **verifica** que
siga sin dependencias del navegador; si alguien mete un `document.` o un
`STATE.`, el build falla con un mensaje explícito.

Así el conocimiento del dominio (`FAMILIA_MODULO`, `DOC_MODULO`,
`PLANTILLAS_CORREO`, `tipoGestionDesdeTarea`, `plantillaPara`) vive en un solo
sitio y lo usan cliente y servidor.

## Qué hace, paso a paso

1. Lee el estado de Drive (`getEstado`).
2. Recorre los trámites no terminados y sus tareas `pendiente` con
   `fecha <= hoy`.
3. `tipoGestionDesdeTarea(descripcion)` deduce la gestión. Si no reconoce
   ninguna, **salta la tarea**: no toda tarea es un requerimiento.
4. `plantillaPara(modulo, gestion)` da el texto institucional.
5. `ultimoMensajeConAsunto(numero)` busca el hilo; si no hay correo con ese
   número en el asunto, lo anota y sigue.
6. `crearBorradorRespuesta()` deja el borrador **en el hilo**, y
   `etiquetarHilo()` marca la conversación con `JuriTask/Borrador generado`
   para que los veas agrupados en Gmail.
7. Guarda el registro de lo generado y manda un **correo-resumen**.

## Idempotencia

Sin ella, cada corrida duplicaría borradores. El registro vive en
`config.borradoresGenerados`, con clave `tramiteId|indiceTarea|fecha`. Es el
mismo patrón de `config.bitacoraRegistrados`.

Un detalle deliberado: **solo se marca lo que se generó**. Si un trámite falla
—sin correo, error de Gmail— no se registra, así que mañana se reintenta.

## El lock

`generarBorradoresDelDia` toma `LockService`, y `guardarEstado` también. Sin
eso, una corrida a las 6:00 podría pisar lo que estuvieras editando en la app.

## La IA está apagada por defecto

`config.borradoresConIA` arranca en `false`: los borradores usan las plantillas
tal cual. Es determinista, instantáneo, gratis, y **no saca el contenido de los
correos fuera del dominio**.

Con el interruptor activo, Gemini adapta cada plantilla al último estado del
hilo (para no volver a pedir lo ya recibido) — y entonces el cuerpo del correo
sí viaja a la API de Google. Si la llamada falla, se usa la plantilla sin
adaptar en vez de abortar.

La decisión es de gobierno de datos, no técnica; por eso está a un clic y no
cableada.

## Cuotas

Apps Script corta a los **6 minutos por ejecución**. El generador hace una
búsqueda de Gmail por trámite vencido; con muchos, puede quedarse corto. Si
llega a pasar, el arreglo es trocear por lotes y encadenar con un trigger
puntual, no subir el timeout (no se puede).

El tiempo total de triggers también está limitado (~6 h/día en Workspace), pero
una corrida diaria no se acerca.

## Al modificar

- Si añades un tipo de gestión, va en `js/plantillas-correo.js` y el servidor
  lo hereda solo en el siguiente build.
- No hagas que el trigger **envíe**. El valor de esto es que revisas antes; un
  correo institucional mal mandado no se deshace.
- `Session.getActiveUser().getEmail()` puede venir vacío en algunas
  configuraciones; `_jtAvisar` lo comprueba antes de mandar el resumen.
