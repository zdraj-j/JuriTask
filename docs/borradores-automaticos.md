# Proceso: Borradores del día

Por cada tarea de requerimiento que vence, deja un **borrador de respuesta** en
el hilo del último correo que lleve el número del trámite en el asunto.

**Nunca envía nada.** Deja el borrador para que lo revises.

## Archivos

- `js/borradores.js` → `generarBorradoresDelDia()`, `_tareasParaBorrador()`,
  la idempotencia.
- `js/gmail.js` → `ultimoMensajeConAsunto()`, `crearBorradorRespuesta()`,
  `etiquetarHilo()`.
- `js/plantillas-correo.js` → `tipoGestionDesdeTarea`, `plantillaPara`.
- `index.html` → sección "Borradores del día" en Ajustes.

## Por qué es un botón y no un automatismo

Porque un navegador no puede hacer nada con la pestaña cerrada.

Esto llegó a existir como **trigger diario de Apps Script**, que corría a las
6:00 con la app cerrada. Duró lo que tardó el administrador de Workspace en
bloquear Apps Script. Sin servidor no hay forma de que Gmail avise a la app
apagada, así que la ejecución la dispara el usuario.

La lógica se conservó entera: mismas plantillas, misma selección de tareas,
misma idempotencia, mismo etiquetado. Lo único que cambia es quién aprieta el
gatillo.

## Qué hace, paso a paso

1. Recorre los trámites no terminados y sus tareas `pendiente` con
   `fecha <= hoy`.
2. `tipoGestionDesdeTarea(descripcion)` deduce la gestión. Si no reconoce
   ninguna, **salta la tarea**: no toda tarea pendiente es un requerimiento.
3. `plantillaPara(modulo, gestion)` da el texto institucional.
4. `ultimoMensajeConAsunto(numero)` busca el hilo; si no hay correo con ese
   número en el asunto, lo cuenta y sigue.
5. `crearBorradorRespuesta()` deja el borrador **en el hilo**, y
   `etiquetarHilo()` marca la conversación con `JuriTask/Borrador generado`
   para verlos agrupados en Gmail.
6. Resume al final: cuántos borradores, cuántos sin correo, cuántos con error.

## Enganchar la respuesta a la conversación

El `threadId` por sí solo **no basta**: Gmail deja el borrador suelto. Lo que
lo engancha son las cabeceras `In-Reply-To` y `References`, copiadas del último
mensaje del hilo.

Y el asunto y el cuerpo van en **base64**, porque `btoa` solo admite latin-1 y
cualquier acento —"Notificación"— saldría roto. El asunto usa la forma
`=?UTF-8?B?…?=` de RFC 2047; el cuerpo, `Content-Transfer-Encoding: base64`.

## Idempotencia

Sin ella, dos pulsaciones seguidas duplicarían los borradores. El registro vive
en `config.borradoresGenerados`, con clave `tramiteId|indiceTarea|fecha`. Es el
mismo patrón de `config.bitacoraRegistrados`.

Dos detalles deliberados:

- **Solo se marca lo que se generó.** Si un trámite falla —sin correo, error de
  Gmail— no se registra, así que el siguiente intento lo reintenta.
- La lista se poda a las claves de hoy en cada pasada. Si no, crecería sin
  límite dentro de `config`, que se sube entero en cada cambio.

## La IA está apagada por defecto

`config.borradoresConIA` arranca en `false`: los borradores usan las plantillas
tal cual. Es determinista, instantáneo, gratis y **no saca el contenido de los
correos fuera del dominio**.

Con el interruptor activo, Gemini adapta cada plantilla al último estado del
hilo, y entonces el cuerpo del correo sí viaja a la API de Google. Si la
llamada falla se usa la plantilla sin adaptar en vez de abortar.

La decisión es de gobierno de datos, no técnica; por eso está a un clic y no
cableada.

## Al modificar

- Si añades un tipo de gestión, va en `js/plantillas-correo.js`.
- No hagas que esto **envíe**. El valor está en que revisas antes; un correo
  institucional mal mandado no se deshace.
- Cada trámite vencido son varias llamadas a Gmail (buscar, leer el hilo, crear
  el borrador, etiquetar). Con muchos, la pasada tarda. Si llega a molestar, el
  arreglo es paralelizar por lotes pequeños, no quitar el etiquetado.
