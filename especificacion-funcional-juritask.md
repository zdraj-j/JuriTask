# JuriTask: especificación funcional

Descripción completa de lo que hace la aplicación hoy: funciones, reglas de negocio, flujos, datos e integraciones. No incluye la apariencia ni cómo se reparten las secciones. Al final hay observaciones útiles para el remake: código muerto, fallos e incoherencias.

---

## 1. Qué es

Es una aplicación web instalable (PWA) para **gestionar trámites jurídicos**: vencimientos legales, etapas de gestión, tareas de seguimiento, notas, adjuntos, agenda diaria, reportes y exportación a Excel. Tiene además integración opcional con Gmail, Google Drive y Gemini (IA).

- **Es de un solo usuario.** No hay cuentas, equipos, roles ni permisos.
- Los **colaboradores** (otros abogados) son simples *etiquetas* con nombre y color, no usuarios.
- **No tiene servidor.** Todo corre en el navegador. Los datos viven en un archivo JSON del disco del usuario.
- Fue pensada para el área jurídica de Comfenalco Valle: hay reglas de negocio y textos propios de esa organización (sección 13).

---

## 2. Modelo de datos

### 2.1 Trámite

| Campo | Descripción |
|---|---|
| `id` | Identificador interno único, generado automáticamente |
| `numero` | Número del trámite (obligatorio). Es la "clave de negocio" |
| `descripcion` | Texto libre. Se guarda en formato "Primera letra en mayúscula" |
| `modulo` | Sigla del módulo (obligatorio), p. ej. CNT, COT, ROD |
| `tipo` | `propio` (lo llevo yo) o `abogado` (a cargo de un colaborador) |
| `abogado` | Clave del colaborador, si no es propio |
| `fechaVencimiento` | Fecha legal límite (AAAA-MM-DD), opcional |
| `gestion.analisis` | Indica si el análisis está hecho |
| `gestion.cumplimiento` | Indica si se cumplió el vencimiento |
| `terminado` / `terminadoEn` | Si está cerrado y cuándo se cerró |
| `creadoEn` | Fecha y hora de creación |
| `seguimiento[]` | Lista de tareas |
| `notas[]` | Lista de notas |
| `attachments[]` | Adjuntos a nivel de trámite |

### 2.2 Tarea (elemento de `seguimiento`)

- `descripcion`
- `fecha` (opcional)
- `responsable`: `'yo'` o la clave del colaborador del trámite
- `estado`: `pendiente` o `realizado`
- `urgente`: sí/no
- `attachments[]`: **máximo 5 por tarea**

### 2.3 Nota

- `texto`
- `fecha`: fecha y hora de creación, automática

### 2.4 Adjunto

- **Archivo de Drive:** `type: 'drive'`, `fileId`, `name`, `mimeType`, `iconUrl`, `webViewLink`.
- **Enlace:** `type: 'link'`, `url` (solo http/https), `name`.

### 2.5 Colaborador

- `key`, `nombre` (se guarda con Mayúsculas Iniciales) y `color`.

### 2.6 Módulo

- `sigla` (en mayúsculas, hasta 6 caracteres, única) y `nombre`.
- Vienen 17 por defecto:

| Sigla | Nombre |
|---|---|
| ACT | Actuaciones administrativas |
| CBPR | Cobro prejurídico |
| COT | Conceptos y otros trámites |
| CPJ | Conciliación prejudicial |
| CNT | Contratos |
| OTR | Otros documentos contractuales |
| ROD | Respuesta oficios y derechos de petición |
| PRE | Precontractual |
| PRJ | Procesos judiciales |
| TTL | Tutelas |
| PRR | Prórroga |
| OS | Orden de servicio |
| ET | Estudio de títulos |
| LIQ | Acta de liquidación |
| NA | No aplica |
| CNV | Convenio |
| MIN | Minuta |

### 2.7 Plantilla de trámite

- `nombre`, `modulo`, `descripcion` y `tareas[]`.
- Cada tarea guarda su `descripcion` y los `dias` de desplazamiento respecto a hoy.

### 2.8 Configuración

Todas las preferencias del usuario (colaboradores, módulos, plantillas, orden, columnas, modo de detalle, tema, tarea automática, filtro de la Agenda, clave de Gemini, ajustes de correo, descartados y bitácoras registradas). Ver sección 12.

---

## 3. Reglas de negocio centrales

1. **Etapas del trámite:** análisis, luego cumplimiento, luego terminado.
   - La "etapa" calculada es **Gestión** mientras no haya cumplimiento y **Seguimiento** después.
   - En los trámites **propios** no existen los pasos de análisis ni cumplimiento: solo se pueden terminar.
2. **El vencimiento deja de existir al marcar el cumplimiento.** A partir de ahí el trámite no muestra la fecha, no cuenta como vencido y en los reportes aparece "sin fecha". La regla se aplica igual en todas partes.
3. **Estado de una fecha:** vencida (antes de hoy), hoy, mañana o próxima.
   - Opcionalmente se muestran los días restantes: "3d", "Hoy", "Mañana" o "2d vencido".
4. **Falta análisis:** todo trámite de colaborador, no terminado y sin análisis, se señala como pendiente de análisis.
5. **"Mío":** una tarea es mía si su responsable es `'yo'` o está vacío.
   - El vencimiento de un trámite propio es mío; el de un trámite de colaborador es del colaborador.
   - El análisis pendiente siempre es del colaborador.
6. **Tarea automática al marcar cumplimiento** (configurable, activada por defecto). Al marcar cumplimiento:
   - Se crea una tarea con el texto configurado (por defecto "1er req") a N días (por defecto 7).
   - El responsable es "yo" o "según el tipo de trámite" (el colaborador).
   - No se duplica si ya existe una igual pendiente.
   - **Además**, en los módulos CNT, OS y CNV se crea "Solicitar fecha de inicio" a 2 días, asignada a "yo". No aplica a OTR.
7. **Purga automática:** al arrancar, se **eliminan definitivamente** los trámites terminados hace más de 30 días.
   - Si un trámite terminado no tiene fecha de cierre, se le pone la de hoy y se conserva.
8. **Normalización de textos:**
   - Las descripciones de trámites, tareas y notas se guardan con mayúscula inicial y el resto en minúscula.
   - Los nombres de colaboradores se guardan con Mayúsculas Iniciales.

---

## 4. Gestión de trámites (CRUD)

### 4.1 Crear o editar un trámite

- **Campos:** número\*, módulo\*, descripción, vencimiento y "Asignar a" ("Solo yo" o un colaborador; la elección es única). La asignación decide si el trámite es `propio` o `abogado`.
- **Tareas iniciales:** se pueden añadir varias en el mismo formulario. Cada una tiene:
  - descripción y fecha;
  - responsable (solo si hay colaborador: "Yo" o el colaborador);
  - marca de urgente;
  - adjuntos de Drive o enlaces (máx. 5);
  - botón para quitarla.
- **Nota inicial** opcional.
- **Adjuntos del trámite:** desde Drive o como enlace (URL más nombre opcional).
- **Plantillas** (solo al crear, no al editar):
  - Elegir una plantilla rellena el módulo, la descripción y las tareas. Las fechas se calculan como hoy más los días guardados.
  - El botón "guardar como plantilla" toma el formulario actual y pide un nombre. Las fechas de las tareas se convierten en "días desde hoy". Requiere al menos un módulo o una tarea.
- **Al editar,** las tareas, la nota y los adjuntos nuevos se **añaden** a los existentes; no los reemplazan.
- **Validaciones:** el número y el módulo son obligatorios. Las tareas sin descripción se descartan.
- El formulario no se cierra al hacer clic fuera, para no perder datos, y se puede arrastrar en escritorio.

### 4.2 Acciones sobre un trámite

- **Duplicar:** copia todo con el número "`<número>-copia`", reinicia el análisis y el cumplimiento, y lo deja activo.
- **Editar** y **eliminar** (con confirmación; se puede deshacer).
- **Marcar análisis / cumplimiento** con casillas directas, solo en trámites de colaborador. Marcar cumplimiento dispara la tarea automática.
- **Terminar** con confirmación; guarda la fecha de cierre.
- **Reactivar** un terminado (con confirmación): vuelve a ejecución.
- **Copiar el número** al portapapeles con un botón disponible en todas las vistas.
- **Buscar en Gmail** (solo desde el reporte del día):
  - Abre Gmail en una pestaña con nombre fijo, que se reutiliza en los siguientes clics.
  - Busca por el número del trámite o por su radicado (formato `XXX-AAAA-NNN`, extraído del número, de la descripción o de las notas).
  - Usa el índice de cuenta configurado (`/mail/u/N`).

### 4.3 Detalle del trámite

Se abre al hacer clic en el trámite. Hay dos modos configurables: expandido en línea o ventana. En el Panel siempre se abre como ventana.

- **Tareas:**
  - Se listan con las urgentes primero y después por fecha.
  - Se puede marcar o desmarcar la tarea como realizada.
  - Doble clic sobre la descripción la edita (Enter guarda, Esc cancela).
  - La fecha se cambia en línea.
  - Doble clic sobre el responsable lo cambia (solo se muestra si no soy yo).
  - Hay botones para alternar urgente, adjuntar de Drive, adjuntar enlace y eliminar (con confirmación).
  - Los adjuntos se abren en una pestaña nueva y se quitan con clic derecho o pulsación larga.
  - "Nueva tarea" pide descripción, fecha y responsable.
- **Fecha de vencimiento:** editable en línea. Se guarda automáticamente al escribir o con un botón. Se oculta si el trámite ya está cumplido.
- **Notas:** van en orden cronológico. Se pueden añadir, editar con doble clic (Ctrl+Enter guarda, Esc cancela) y eliminar.
- Muestra la etapa actual (Gestión o Seguimiento).
- ⚠️ Los adjuntos **a nivel de trámite** no se muestran en el detalle: solo se pueden añadir desde editar y solo aparecen contados en el Excel.

### 4.4 Lista de trámites

- **Vista "Todos":** trámites activos. **Vista "Terminados":** cerrados (se pueden reactivar).
- **Resumen de cada trámite:**
  - Número, módulo, colaborador o "Propio", "Terminado", "Urgente" (si tiene alguna tarea urgente pendiente) y "Falta análisis".
  - Estado del vencimiento.
  - Hasta 2 tareas pendientes, más un contador "+N más".
  - Progreso en 3 pasos.
- **Orden:** por vencimiento, próxima acción (la fecha más cercana entre el vencimiento y las tareas), fecha de creación, colaborador o número. Cuando hay empate, decide el **orden manual**.
- **Orden manual** con arrastrar y soltar. Soltar en un espacio vacío envía el trámite al final.
- **Columnas:** el número de columnas de la lista es configurable.
- **Selección múltiple:**
  - Se activa con una pulsación larga (500 ms) o con Ctrl/Cmd+clic.
  - Acciones: seleccionar todo lo visible, terminar en lote (solo los activos), eliminar en lote y cancelar (también con Esc).
  - Cada lote se puede deshacer en un solo paso.

---

## 5. Filtros y búsqueda

- **Filtros** (se combinan con Y):
  - Tipo: compartidos o solo yo.
  - Colaborador.
  - Módulo.
  - Responsable: que **alguna** tarea tenga ese responsable.
  - Etapa: gestión o seguimiento.
  - Botón para limpiar todos los filtros.
- **Búsqueda de texto** en número, descripción, tareas y notas, con un retardo de 200 ms.
  - Si se busca desde Agenda, Panel o Ajustes, salta automáticamente a "Todos".
  - Esc o la ✕ limpian la búsqueda.
- Los filtros aplican a las vistas Todos y Terminados.

---

## 6. Agenda accionable (lo de hoy y lo atrasado)

Reúne de todos los trámites no terminados tres tipos de elementos:

| Tipo | Cuándo aparece | Acción de "hecho" |
|---|---|---|
| Vencimiento | vence hoy o antes y no está cumplido | botón **Cumplido**: marca el cumplimiento y crea la tarea automática |
| Análisis | trámite de colaborador sin análisis | casilla: marca el análisis |
| Tarea | tarea pendiente con fecha de hoy o anterior | casilla: la marca como realizada |

- **Orden:** urgentes, luego vencidos, luego los de hoy; dentro de cada grupo, por fecha. Se agrupan en "Urgentes", "Vencidos / Atrasados" y "Para hoy".
- **Filtro por responsabilidad:** Mías, De otros o Todas.
  - Cada opción muestra su contador.
  - Se recuerda; por defecto "Mías".
  - Si un elemento no es mío, se muestra su responsable.
- **Encadenar la siguiente tarea:** al completar una tarea, aparece en su lugar un mini formulario "Siguiente tarea para #N".
  - La fecha viene precargada a hoy + 7 días.
  - La nueva tarea hereda el responsable de la anterior.
  - Enter guarda; "Listo, sin tarea" (o guardar vacío) simplemente cierra.
- **Aplazar una tarea** (no los vencimientos): mañana, en 3 días, próxima semana u otra fecha. La tarea sale de la agenda de hoy y reaparece en la nueva fecha.
- Hacer clic en un elemento abre el detalle del trámite.
- **Contador de la agenda:** muestra el total de pendientes de **todas** las responsabilidades.
- El estado vacío muestra un mensaje distinto según haya o no elementos en los otros filtros.
- Todas las acciones se pueden deshacer desde el aviso.

---

## 7. Reporte del día (solo lectura)

- Usa la misma lógica que la Agenda: vencimientos, análisis y tareas de hoy o atrasadas, agrupados en Urgentes, Vencidos y Para hoy.
- **Filtro por colaborador:** Todos, cada colaborador o "Yo mismo".
- **Salidas:**
  1. **Captura como imagen PNG** al portapapeles. Si el portapapeles no está disponible, se descarga como `reporte-AAAA-MM-DD.png`. La imagen siempre tiene el mismo ancho, se lance desde donde se lance.
  2. **Panel fijo lateral:**
     - Se queda abierto mientras se navega y tiene su propio filtro de colaborador.
     - Conserva la posición de desplazamiento y se actualiza solo cuando cambian los datos.
     - Se recuerda entre sesiones en ese equipo (solo en pantallas anchas).
     - Se puede volver a abrir como ventana conservando el filtro.
- No se imprime ni se copia como texto.

---

## 8. Reporte de trámites y exportación (el reporte "grande")

Consulta **todo el histórico** con filtros combinables. Los filtros se recuerdan en ese equipo. Al abrirlo desde la barra hereda los filtros y la búsqueda activos en la lista.

### 8.1 Filtros

- Estado: activos, terminados o ambos.
- Tipo, colaborador (o "Yo mismo"), módulo y etapa.
- Responsable de alguna tarea **pendiente**.
- Vencimiento con atajos: todos, vencidos, hoy, próximos 7 días, próximos 30 días, este mes o sin fecha. Con "todos" se puede indicar un rango manual desde/hasta.
- Texto libre en número, descripción, tareas y notas.
- Casillas: solo con tareas pendientes, solo con tareas vencidas, solo con tareas urgentes, solo sin tareas pendientes.
- Orden: vencimiento, próxima acción, número (orden natural), módulo, colaborador, más tareas pendientes o más recientes.
- Botón para restablecer los filtros.

### 8.2 Vista previa

- Indicadores: trámites, vencidos, vencen hoy, tareas pendientes, tareas vencidas y urgentes.
- Tabla con N.º, módulo, descripción, colaborador, vencimiento, número de pendientes (con las vencidas destacadas) y detalle de las tareas pendientes.
- Muestra como máximo 100 filas; la exportación siempre incluye todas.

### 8.3 Exportar a Excel (.xlsx)

Se genera dentro de la propia app, sin librerías externas. Las fechas son fechas reales de Excel, la cabecera queda fija y cada hoja tiene autofiltro. Se pueden elegir las hojas:

- **Resumen:** fecha, descripción de los filtros aplicados, totales generales, tareas, etapas, conteo por módulo y por colaborador.
- **Trámites:** 23 columnas:
  1. N.º
  2. Módulo
  3. Nombre del módulo
  4. Descripción
  5. Tipo
  6. Colaborador
  7. Etapa
  8. Estado
  9. Vencimiento
  10. Días restantes
  11. Análisis
  12. Cumplimiento
  13. Tareas pendientes
  14. Tareas vencidas
  15. Tareas urgentes
  16. Fecha de la próxima acción
  17. Próxima tarea
  18. Responsables
  19. Número de notas
  20. Número de adjuntos
  21. Creado
  22. Terminado el
  23. Detalle de pendientes
- **Tareas:** una fila por tarea, con N.º y módulo del trámite, descripción del trámite, tarea, fecha, estado, si está vencida, días de atraso, urgente, responsable y vencimiento del trámite. Opción para incluir las ya realizadas.
- **Notas:** una fila por nota (N.º, módulo, fecha, texto).

### 8.4 Otras salidas

- **CSV:** una sola tabla, la primera hoja de datos seleccionada.
- **Copiar como texto plano** al portapapeles.
- **Imprimir:** tabla completa paginada, con cabecera repetida en cada página e indicadores.
- **Nombre del archivo:** `juritask_reporte[_modulo][_estado]_AAAA-MM-DD`.

---

## 9. Panel de indicadores (solo lectura)

- **Indicadores:** trámites activos, vencidos, vencen hoy, terminados y trámites con tareas urgentes pendientes.
- **Métricas:**
  - Los 5 módulos con más trámites activos.
  - Trámites activos por abogado.
  - Tareas pendientes frente a completadas (con % completado).
  - Tasa de vencimiento (% de activos vencidos), con umbrales de 5 % y 20 %.
- **Tabla de vencidos** ordenada por fecha (número, descripción, abogado, fecha, módulo).
- Botón para refrescar.

---

## 10. Persistencia, archivo de datos y seguridad de los datos

### 10.1 Arquitectura

- **Fuente de verdad:** `juritask.json`, dentro de una **carpeta del disco** que elige el usuario (File System Access API). Se usa una carpeta y no un archivo suelto para poder escribir las copias al lado.
- **Caché:** `localStorage`. Sirve para arrancar rápido y como red de seguridad.
- La carpeta elegida se recuerda en IndexedDB.
- **Solo funciona en Chrome, Edge u Opera de escritorio.** En Firefox, Safari o el móvil, la app abre sobre la caché y avisa "Solo lectura en este navegador".

Estructura de la carpeta:

```
<carpeta elegida>/
  juritask.json                     ← la base de datos
  copias/juritask-AAAA-MM-DD.json   ← una copia por día, 7 en retención
  copias/conflicto-<hora>.json      ← lo que había cuando algo cambió por fuera
```

### 10.2 Arranque

1. Carga la caché local.
2. Intenta reconectar la carpeta sin intervención del usuario. Hay tres resultados:
   - **Listo:** entra a la app.
   - **Falta permiso:** pantalla de entrada con "Abrir mi carpeta" (el navegador exige un clic). Si la carpeta ya no sirve, la olvida y pide otra.
   - **Ninguna:** pantalla de entrada con "Elegir carpeta de datos".
   - Siempre existe la opción **"Continuar sin archivo"** (solo ese navegador).
3. Lee el archivo y crea la copia diaria.

- Si la carpeta elegida está vacía, vuelca lo que haya en memoria. Si tiene datos, manda el archivo.
- Si el archivo no se puede leer, sigue con la caché local y avisa.

### 10.3 Guardado

- Cada cambio pasa por un único punto de guardado: primero `localStorage` (con un retardo de 400 ms) y después el archivo (600 ms). Hay guardado inmediato en acciones críticas y al cerrar la pestaña.
- **Reglas anti pérdida de datos:**
  1. **Escrituras en cola, una a la vez:** nunca queda un JSON a medio escribir.
  2. **Nunca se escribe un estado vacío sobre un archivo con trámites.** Si ocurre, cancela y avisa. La única excepción es "Borrar todos los datos", que se autoriza para una sola escritura.
  3. **Detección de cambios externos:** si el archivo cambió desde la última lectura (otro equipo vía Drive o Dropbox, o una edición manual), guarda `copias/conflicto-<hora>.json` con lo anterior antes de sobrescribir.
- **Marca de "cambios sin guardar":**
  - Se pone con cada cambio y solo se quita cuando una escritura del archivo termina bien.
  - Si al arrancar la marca sigue puesta, **fusiona** la caché local con el archivo en lugar de reemplazar: conserva lo local y añade del archivo lo desconocido.
  - Luego avisa de la recuperación y reescribe el archivo.
  - Contrapartida aceptada: un trámite borrado con la caché desincronizada puede reaparecer.
- **Aviso de estado de guardado:** "Sin carpeta de datos", "Solo lectura en este navegador" o "Sin guardar en el archivo (N días)".
- **Integridad:**
  - Se eliminan trámites duplicados (por `id`, o por `numero` si no tienen id, conservando el más completo) y ids repetidos en el orden manual.
  - Toda carga pasa por las migraciones de datos antiguos: asignar id si falta, completar campos, convertir responsables antiguos (`auxiliar`/`propio` → `yo`), convertir la antigua "próxima acción" en tarea y leer las claves antiguas `lexgestion_*`.
- **Formato del archivo:** `{ version: 3, guardadoEn, tramites, order, config }`. Es el mismo formato que la exportación, así que un archivo exportado puede usarse directamente como base de datos y se puede editar a mano.

### 10.4 Copias de seguridad

- **Una copia automática al día:** `copias/juritask-AAAA-MM-DD.json`, que se repite como mucho una vez por día.
  - Se conservan **7**; las más antiguas se borran.
  - No se copia un estado vacío.
  - Incluye `version`, `creadoEn`, `total`, `tramites`, `order` y `config`.
- **Lista de copias** con fecha y tamaño, y acciones **Restaurar** y **Eliminar**.
- **Restaurar:** confirma cuántos trámites entran y cuántos se reemplazan, y **antes** guarda una copia del estado actual.
- Botón **"Copia ahora"**.
- Las copias de conflicto no cuentan en la lista ni en la retención.

### 10.5 Otras operaciones de datos

- **Exportar JSON** (`juritask_AAAA-MM-DD.json`) con los trámites, el orden y toda la configuración.
- **Importar JSON:** reemplaza todo, aplicando la limpieza de duplicados, las migraciones y la configuración.
- **Guardar ahora** (fuerza la escritura) y **cambiar de carpeta**.
- **Borrar todos los datos:** doble confirmación. Vacía la caché, el archivo y la configuración.

### 10.6 Deshacer

- Historial de **30 acciones**, cada una con una instantánea de los trámites y del orden.
- Se deshace con Ctrl/Cmd+Z (fuera de los campos de texto) o con el botón "Deshacer" de los avisos.
- Deshacer reabre el detalle si estaba abierto.
- ⚠️ La configuración no entra en el historial.

---

## 11. Integración con Google (opcional)

### 11.1 Conexión

- Botón "Conectar Google" (inicio de sesión de Firebase en una ventana emergente). Solo sirve para el correo y Drive; **sin esa conexión la app funciona completa**.
- **Permisos pedidos:** `drive.file` y `gmail.modify` (la app solo lee).
- **Token:**
  - Dura alrededor de una hora y Firebase no lo renueva.
  - Ante un error 401 se descarta y se pide uno nuevo en una ventana emergente, sin cerrar la sesión.
  - Si dos módulos lo piden a la vez, comparten la misma petición, para no abrir dos ventanas.
- Muestra el nombre y la foto de la cuenta. "Desconectar" no toca los datos.
- Solo inicio de sesión con Google: no hay registro con correo y contraseña, ni recuperación de contraseña, ni invitaciones.

### 11.2 Detección de trámites nuevos desde el correo (sin IA)

- **Búsqueda:** correos de `comjuridico@comfenalcovalle.com.co` con asunto "Notificación de trámite" de los últimos 120 días (máximo 25).
- **Datos extraídos** de etiquetas fijas del correo:
  - **Número:** campo "Trámite:" (4 a 8 dígitos); si falta, el radicado.
  - **Radicado** (`XXX-AAAA-N`), también desde el asunto.
  - **Módulo:** prefijo del radicado, con alias (OTRD → OTR); solo si el módulo existe en la configuración.
  - **Vencimiento:** DD/MM/AAAA convertido al formato interno.
  - **Tipo de solicitud, solicitante, área, resumen y responsable.**
  - **Descripción corta:** el resumen recortado en la primera coma o en frases como "tiene como objeto", "con el fin", "por el inmueble", "para dar" o "quien tiene", con un máximo de unos 90 caracteres.
  - **Colaborador:** se empareja por nombre normalizado (sin tildes; coincidencia exacta o por inclusión).
  - **Nota inicial** con todo el detalle (radicado, tipo, solicitante, área, responsable y resumen).
- Se excluyen los números que ya existen o que fueron descartados.
- **Panel de revisión:** cada detección muestra el número, el módulo (o "elige módulo"), la descripción, el vencimiento y el responsable (o "no está en tu lista").
  - **Revisar y crear:** abre el formulario de nuevo trámite **prellenado**. Al cerrarlo (guardando o cancelando), el panel vuelve con las detecciones restantes. Si el responsable no está en la lista, avisa.
  - **Descartar:** permanente. Se puede restablecer la lista de descartados desde Ajustes.
  - **Buscar de nuevo** fuerza otra lectura del correo.
- Los resultados se conservan en memoria durante la sesión: volver a abrir el panel no relee el correo. Muestra hace cuánto fue la última revisión. Un contador indica cuántos quedan por revisar.

### 11.3 Bitácora de envíos (con Gemini)

- Busca los correos **enviados** de los últimos N días (por defecto 7, máximo 25). Del asunto extrae números de 5 o 6 dígitos o radicados y los empareja con trámites **activos**.
- Por cada correo encontrado:
  - **Generar anotación:** Gemini redacta 1 o 2 frases en lenguaje neutro e impersonal ("Se realiza primer requerimiento al contratista solicitando…"), sin fechas, saludos, firmas ni primera persona.
  - Si el correo responde a un tercero, se trae el mensaje anterior del hilo y el resumen cubre ambos ("El contratista solicita X, por tanto se le remite Y").
  - El texto se puede editar y regenerar.
  - **Copiar y marcar registrada** u **Omitir.** Se recuerdan los últimos 300 correos ya procesados para no volver a proponerlos.
- Nada se envía ni se registra automáticamente: siempre se muestra para revisar y copiar.
- **Vigilancia automática:**
  - Revisa los enviados cada N minutos (3 a 120, por defecto 10) y al volver a la pestaña, y muestra un contador y un aviso (una sola vez por lote nuevo).
  - Es silenciosa: si no hay un token vigente, no hace nada. No llama a Gemini; solo consulta Gmail.
  - No hay avisos con la app cerrada (no hay servidor).
- Requiere una **clave de API de Gemini**, que el usuario pega en Ajustes y se guarda en la configuración (modelo `gemini-2.0-flash`, respuesta en JSON). Los errores 400 (clave inválida), 403 (restricciones) y 429 (límite de uso) tienen mensajes específicos.

### 11.4 Google Drive

- Selector de Drive (con selección múltiple, carpetas visibles y subida de archivos) para adjuntar archivos a las tareas o al trámite.
- Los adjuntos se identifican por tipo: hoja de cálculo, documento, presentación, PDF, imagen u otro.

---

## 12. Configuración (Ajustes)

| Ajuste | Detalle |
|---|---|
| Colaboradores | Añadir (con color automático de una paleta de 7), renombrar, cambiar color, eliminar. Los nombres no pueden quedar vacíos |
| Módulos | Añadir (sigla única en mayúsculas más nombre) y eliminar |
| Plantillas de trámite | Listar (nombre, módulo, número de tareas) y eliminar. Se crean desde el formulario de nuevo trámite |
| Modo de detalle | Expandido en línea o ventana |
| Días restantes | Mostrar u ocultar el contador en los trámites |
| Tarea automática | Activar o desactivar, texto, días (1 a 365) y responsable ("yo" o según el tipo) |
| Correo e IA | Clave de Gemini, vigilancia sí/no, intervalo (3–120 min), días a revisar (1–30), índice de cuenta de Gmail (0–9), restablecer descartados |
| Archivo de datos | Carpeta actual, elegir o cambiar, guardar ahora |
| Exportar / Importar JSON | Ver 10.5 |
| Copias de seguridad | Ver 10.4 |
| Zona de peligro | Borrar todo |
| Preferencias visuales | Tema (8 opciones) y colores de las 3 etapas, con restablecer |

Además se recuerdan entre sesiones:

- En la configuración (viajan con el archivo): orden de la lista, número de columnas y filtro de la Agenda.
- Solo en ese equipo: panel lateral del reporte del día (abierto/cerrado y filtro) y filtros del reporte grande.

---

## 13. Conocimiento del dominio incorporado

- **Familias de módulo:**
  - Contractual: CNT, OTR, OS, CNV.
  - Concepto: COT, ET, MIN.
  - Petición: ROD.
  - Audiencia: CPJ.
- **Cómo se nombra el documento en cada módulo** (se usa en la instrucción que se le da a Gemini):

| Módulo | Documento |
|---|---|
| CNT | el contrato |
| OTR | el documento contractual |
| OS | la orden de servicio |
| CNV | el convenio |
| ET | el estudio de títulos |
| MIN | la minuta de constitución/levantamiento de hipoteca |
| COT | el concepto |
| ROD | la respuesta al derecho de petición |
| CPJ | la audiencia de conciliación |

- **Módulos sin pólizas:** CNV, ET, MIN. **Módulos con fecha de inicio:** CNT, OS, CNV.
- **Plantillas de correo institucionales:** 1er, 2do y 3er requerimiento, requerimiento final de inactivación, fecha de inicio, conformidad, cierre por falta de respuesta, petición (radicado y constancia), acta de audiencia, reiterar solicitud y genérico.
  - Existe la lógica para elegir la plantilla según el módulo y el texto de la tarea ("1er req", "reiterar sol", "acta", "conformidad", "cierre", etc.):
    - En ROD, cualquier requerimiento usa la plantilla de petición.
    - En CPJ, los requerimientos piden el acta.
    - En conceptos, el 1er requerimiento pide conformidad y los siguientes informan el cierre.
  - Al sustituir el documento se corrigen "a el" → "al" y "de el" → "del".
  - ⚠️ **Hoy no se usa en ninguna parte**: es restante de unos "borradores del día" que se retiraron. Si quieres conservarla en el remake, tendría que volver a conectarse.

---

## 14. Productividad y uso general

- **Paleta de comandos:** Ctrl/Cmd+K o `?`. Busca entre: nuevo trámite, buscar, ir a cada vista, reporte del día, reporte de Excel, exportar a Excel, modo selección, deshacer y 3 temas. Se navega con flechas y Enter.
- **Atajos:**

| Tecla | Acción |
|---|---|
| Ctrl/Cmd + K | Abrir/cerrar la paleta de comandos |
| `?` | Abrir la paleta |
| `n` | Nuevo trámite |
| `/` | Buscar |
| Ctrl/Cmd + Z | Deshacer |
| Esc | Cierra la ventana o diálogo abierto, el panel expandido o el modo selección |

- **Avisos** con botón "Deshacer" en las acciones destructivas o importantes.
- **Confirmaciones** en todo borrado.
- **Accesibilidad:** los botones de solo icono tienen etiqueta para lectores de pantalla, y el foco queda atrapado dentro de las ventanas abiertas y se restaura al cerrarlas.
- **PWA:** instalable y con funcionamiento sin conexión de la propia aplicación. Las llamadas a Google nunca se guardan en caché. Los datos no dependen de la red.
- **Seguridad:** los enlaces de adjuntos solo admiten http, https o mailto, y todo el texto se muestra escapado.

---

## 15. Observaciones para el remake (fallos, código muerto e incoherencias)

1. **La vigilancia de correos enviados nunca se inicia al arrancar.** Está "activada" por defecto, pero el proceso solo arranca si se toca el ajuste en Ajustes.
2. **Los adjuntos del trámite** se pueden añadir, pero no se ven ni se pueden quitar en el detalle.
3. **Las plantillas de correo** (sección 13) son código muerto.
4. La purga a los 30 días **borra** los trámites terminados sin aviso; podría ser mejor archivarlos o hacerlo configurable.
5. El **orden manual** solo actúa como desempate, salvo en las posiciones iguales.
6. El filtro "Responsable" de la lista mira cualquier tarea (incluidas las realizadas), mientras que el del reporte solo mira las pendientes. Son criterios distintos.
7. Al marcar una tarea como urgente desde el detalle no se guarda en el historial de deshacer.
8. Se pide el permiso `gmail.modify` pero la app solo lee; bastaría con `gmail.readonly`.
9. **Limitación de diseño:** al depender de la API de acceso a archivos, la app no guarda en el móvil, Firefox ni Safari, y las copias están en el mismo disco que el original. Es la decisión más importante a replantear en el remake (por ejemplo, sincronización real entre dispositivos).
10. La clave de Gemini viaja al navegador: sin un servidor no hay forma de protegerla.
11. La carpeta `build/` contiene una versión antigua para Apps Script, abandonada.
12. La búsqueda de correos de notificación y los dominios internos están fijados en el código (`comjuridico@comfenalcovalle.com.co`); en el remake convendría hacerlos configurables.
