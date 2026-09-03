# Proceso: Conectar con Google

Un botón en el pie de la barra lateral. **Opcional.**

## Archivos

- `js/firebase.js` → `AUTH`, `auth.onAuthStateChanged`. Solo Auth: Firestore ya
  no se inicializa.
- `js/auth.js` → `mostrarPuerta()`, `mostrarApp()`, `renderSesion()`,
  `conectarGoogle()`.
- `index.html` → `#splashScreen`, `#gateScreen`, el pie `.sidebar-footer`.
- `firebase.rules` → todo cerrado; la app no lee ni escribe en Firestore.

## Qué cambió, y por qué importa

Antes la sesión **era la puerta**: sin login no había datos, porque los datos
estaban en Firestore y Firestore necesita un `uid` para saber de quién son.

Los datos se movieron a un JSON del disco
([archivo-datos.md](archivo-datos.md)), así que esa razón desapareció. Queda una
sola:

> **De aquí sale el token de Google** que usan Gmail, el selector de Drive y la
> lectura de correos para Gemini ([google-auth.md](google-auth.md)). Sin sesión
> no hay token, y sin token no hay correo ni adjuntos.

Consecuencia práctica: **se puede abrir JuriTask y trabajar sin cuenta y sin
conexión.** El correo simplemente no está disponible hasta conectarse. Lo que
gatea la app ahora es la carpeta de datos, no la identidad.

Lo que **no** hay, y no ha vuelto: registro por correo, verificación,
recuperación de contraseña, aprobación de administrador, invitaciones ni
perfiles ajenos. Los colaboradores son **etiquetas** de `config.abogados`, no
cuentas.

## El arranque

`init()` ya no cuelga de la sesión, sino del archivo:

```
DOMContentLoaded → arrancarApp()          (js/config.js)
  ├─ loadAll()                            caché local, por si el disco falla
  ├─ reconectarCarpeta()
  │    ├─ 'listo'    → cargarDeArchivo() → mostrarApp() → init()
  │    ├─ 'permiso'  → mostrarPuerta('permiso')   "Abrir mi carpeta"
  │    └─ 'ninguna'  → mostrarPuerta('ninguna')   "Elegir carpeta de datos"
  └─ (en paralelo) onAuthStateChanged → renderSesion()
```

`onAuthStateChanged` ya **no arranca nada**. Solo refleja quién está dentro para
que el pie de la barra lateral y los módulos de correo sepan a qué atenerse. Si
la sesión tarda o no hay, la app funciona igual.

## Solo Google, y por qué eso ya no puede perder datos

La versión anterior admitía correo y contraseña. Ahora solo Google, y Firebase
corta con `auth/account-exists-with-different-credential` cuando el correo ya
tiene una cuenta creada con contraseña.

Antes eso era grave: **UID distinto ⇒ árbol de Firestore distinto**, la app
arrancaba vacía y parecía que se había perdido todo. Ahora el UID no toca los
datos —están en el archivo del disco—, así que en el peor caso te quedas sin
correo hasta resolverlo en la consola de Firebase.

## Desconectar Google

Ya **no** vacía `localStorage`. Antes tenía que hacerlo porque la caché era el
espejo de una base de datos en la nube, y en un equipo compartido no debía
quedarse esperando al siguiente. Hoy la caché es el espejo de un archivo que el
usuario controla, y borrarla por una acción que no tiene nada que ver sería
tirar trabajo.

Con eso se fue también `pausarGuardadoLocal()`, que existía solo para que el
`beforeunload` no volviera a llenar el `localStorage` recién vaciado.

## Al modificar

- Si añades un scope de Google, va en `_proveedorGoogle()` (firebase.js). Quien
  ya inició sesión **no** lo tendrá hasta volver a autorizar: el token viejo se
  emitió con los scopes viejos.
- No metas lógica de la app en `auth.js`. Su trabajo es enseñar u ocultar dos
  pantallas y pintar el pie.
- **No devuelvas Firestore por la puerta de atrás.** Si algún día hace falta
  sincronizar entre equipos, el sitio es una capa nueva sobre `js/archivo.js`,
  no `firebase.js`.
