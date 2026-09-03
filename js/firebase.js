/**
 * JuriTask — firebase.js
 * Sesión de Google. **Nada más.**
 *
 * Firestore dejó de ser la base de datos: los trámites viven en un JSON del
 * disco del usuario (`js/archivo.js`, [archivo-datos.md](../docs/archivo-datos.md)).
 * De este módulo se fue con ello todo el motor de sincronización —
 * `cargarDeFirestore`, `sincronizarConFirestore`, `subirTodoAFirestore`,
 * `_reconciliarTramites`, `_sello` y el resto—, unas 250 líneas.
 *
 * Lo que queda, y por qué queda:
 *
 *   **De aquí sale el token de Google.** `signInWithPopup` con el proveedor de
 *   Google devuelve, junto a las credenciales de Firebase, un `accessToken` con
 *   los scopes de Gmail y Drive. Es el que aceptan `gmail.googleapis.com` y el
 *   selector de Drive, y no hay otra forma de obtenerlo en esta app.
 *   Ver [google-auth.md](../docs/google-auth.md).
 *
 * Firestore **ya no se inicializa**: no hay `firebase.firestore()`, ni
 * persistencia offline, ni un solo documento que leer o escribir. `firebase.rules`
 * lo deja cerrado a cal y canto.
 *
 * Consecuencia buscada: se puede usar la app sin iniciar sesión. El login solo
 * hace falta para el correo y los adjuntos, así que ya no bloquea la entrada
 * (ver `js/auth.js`).
 */

const firebaseConfig = {
  apiKey:            "AIzaSyCTcuxDMUd1K9LSfdy0hjnBwsOaDM5A2S4",
  authDomain:        "juritask-5df51.firebaseapp.com",
  projectId:         "juritask-5df51",
  storageBucket:     "juritask-5df51.firebasestorage.app",
  messagingSenderId: "373351064304",
  appId:             "1:373351064304:web:2b99fc567606ee33089835"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();

// ============================================================
// SESIÓN
// ============================================================

const AUTH = {
  uid:   null,
  email: '',
  nombre: '',
  foto:  '',

  /**
   * Token de acceso de Google, para Gmail y el selector de Drive.
   * Solo llega en el momento del login: Firebase no lo guarda ni lo renueva,
   * así que `ensureGoogleToken()` vuelve a pedirlo cuando caduca.
   */
  googleAccessToken: null,

  get activa() { return !!AUTH.uid; },

  loginGoogle() {
    return auth.signInWithPopup(_proveedorGoogle()).then(_guardarToken);
  },

  /**
   * Reautentica solo para refrescar el token de Google. Se usa cuando Gmail
   * responde 401: la sesión de Firebase sigue viva, lo que caducó es el token.
   */
  refrescarTokenGoogle() {
    const u = auth.currentUser;
    if (!u) return AUTH.loginGoogle();
    return u.reauthenticateWithPopup(_proveedorGoogle()).then(_guardarToken);
  },

  logout() { return auth.signOut(); },
};

function _proveedorGoogle() {
  const p = new firebase.auth.GoogleAuthProvider();
  // Los scopes que necesitan los módulos de correo y adjuntos.
  p.addScope('https://www.googleapis.com/auth/drive.file');
  p.addScope('https://www.googleapis.com/auth/gmail.modify');
  p.setCustomParameters({ prompt: 'select_account' });
  return p;
}

function _guardarToken(result) {
  const token = result?.credential?.accessToken || null;
  if (token) AUTH.googleAccessToken = token;
  return token;
}

// ============================================================
// ARRANQUE
// ============================================================
// La sesión ya **no** decide si la app arranca: de eso se encarga `js/config.js`
// sobre el archivo de datos. Aquí solo se refleja quién está dentro, para que
// el pie de la barra lateral y los módulos de correo sepan a qué atenerse.

auth.onAuthStateChanged(user => {
  if (!user) {
    AUTH.uid    = null;
    AUTH.email  = '';
    AUTH.nombre = '';
    AUTH.foto   = '';
    AUTH.googleAccessToken = null;
  } else {
    AUTH.uid    = user.uid;
    AUTH.email  = user.email || '';
    AUTH.nombre = user.displayName || user.email || '';
    AUTH.foto   = user.photoURL || '';
  }
  if (typeof renderSesion === 'function') renderSesion();
});
