# Proceso: Acceso con Google

Una pantalla, un botón. La app es de **un solo usuario**.

## Archivos

- `js/firebase.js` → `AUTH`, `auth.onAuthStateChanged`, el arranque.
- `js/auth.js` → `mostrarPantallaAcceso()`, `mostrarApp()`, `renderSesion()`.
- `index.html` → `#splashScreen`, `#authScreen`, el pie `.sidebar-footer`.
- `firebase.rules` → cada cuenta solo alcanza lo suyo.

## Por qué hay login si solo hay un usuario

Es la pregunta obvia, y tiene dos respuestas concretas:

1. **Firestore necesita saber de quién son los datos.** Sin un `uid` no hay
   forma de escribir una regla que impida que un tercero lea la base. Los datos
   viven en `users/{uid}/…` justamente para eso.
2. **De ahí sale el token de Google** que usan Gmail, el selector de Drive y la
   lectura de correos para Gemini ([google-auth.md](google-auth.md)). Sin
   sesión no hay token, y sin token la mitad de la app queda inerte.

Lo que **no** hay es gestión de usuarios: ni registro por correo, ni
verificación, ni recuperación de contraseña, ni aprobación de un
administrador, ni invitaciones, ni perfiles ajenos. Todo eso existió y se
retiró; los colaboradores son **etiquetas** de `config.abogados`, no cuentas.

## El arranque

`init()` **no** cuelga de `DOMContentLoaded`. Cuelga de la sesión:

```
onAuthStateChanged
  ├─ sin usuario → mostrarPantallaAcceso()
  └─ con usuario → loadAll()            (caché local, por si la red falla)
                   cargarDeFirestore()  (la nube manda)
                   mostrarApp() → renderSesion() + init()
```

El orden importa: `loadAll()` va **antes** que `cargarDeFirestore()`, porque
esta última mira si había algo en local para decidir si baja o si sube (primer
arranque en una cuenta nueva).

`onAuthStateChanged` es **asíncrono**, así que puede llamar a `init()` aunque
`config.js` se cargue después que `firebase.js`. Un doble de pruebas que lo
llame de forma síncrona rompe ese orden y falla donde la app real no falla; hay
un comentario al respecto en `test/firestore.js`.

## Solo Google, y por qué eso puede cambiarte el UID

La versión anterior admitía **correo y contraseña** además de Google. Ahora solo
Google, y eso tiene una consecuencia que no se ve venir.

Firebase, por omisión, no deja dos cuentas con el mismo correo. Si la cuenta
original se creó con contraseña, entrar con Google **sería otra cuenta**, así
que Firebase corta con `auth/account-exists-with-different-credential`.
`auth.js` lo traduce a un mensaje concreto, porque el error genérico es
indistinguible de un fallo de red.

Y si en vez de cortar hubiera dejado entrar, el problema sería peor: **UID
distinto ⇒ árbol de datos distinto**. La app arrancaría vacía y parecería que
se perdió todo, cuando en realidad los trámites siguen en
`users/{uidViejo}/tramites`.

Salidas, por orden de preferencia:

1. Consola de Firebase → Authentication → la cuenta → vincular el proveedor
   Google. Conserva el UID y los datos.
2. Exportar el JSON desde la app vieja e importarlo en la nueva.

Si siempre entraste con Google, nada de esto aplica: mismo UID de siempre.

## Cerrar sesión

Vacía `localStorage` antes de recargar, porque en un equipo compartido los
datos no deben quedarse esperando al siguiente.

Y hay una trampa: `storage.js` escribe en `beforeunload`, así que la recarga
volvía a volcar `STATE` sobre el almacenamiento recién vaciado —incluida
`config.geminiApiKey`—. Por eso se llama antes a `pausarGuardadoLocal()`, que
corta la escritura de forma definitiva. Lo pilló `test/firestore.js`.

## Al modificar

- Si añades un scope de Google, va en `_proveedorGoogle()` (firebase.js). Los
  usuarios que ya iniciaron sesión **no** lo tendrán hasta que vuelvan a
  autorizar: el token viejo se emitió con los scopes viejos.
- No metas lógica de la app en `auth.js`. Su trabajo es enseñar u ocultar dos
  pantallas.
