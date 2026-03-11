/**
 * JuriTask — drive.js
 * Integración con Google Drive: Picker para adjuntar documentos a trámites.
 */

let _pickerApiLoaded = false;
let _pickerInited    = false;

// Cargar la API del Picker al inicio
function initDrivePicker() {
  if (_pickerInited) return;
  _pickerInited = true;
  if (typeof gapi !== 'undefined') {
    gapi.load('picker', () => { _pickerApiLoaded = true; });
  }
}

// Obtener token de acceso de Google (almacenado en AUTH al hacer login con Google)
function _getDriveToken() {
  return AUTH._googleAccessToken || null;
}

/**
 * Obtener un token de acceso de Google, re-autenticando si es necesario.
 * Retorna el token o null si el usuario no puede autenticarse.
 */
async function _ensureDriveToken() {
  if (AUTH._googleAccessToken) return AUTH._googleAccessToken;
  // El token no está disponible (sesión restaurada sin popup).
  // Re-autenticar silenciosamente con Google para obtener un nuevo token.
  const user = auth.currentUser;
  if (!user) return null;
  // Verificar que el usuario tiene un proveedor de Google
  const hasGoogle = user.providerData.some(p => p.providerId === 'google.com');
  if (!hasGoogle) return null;
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.addScope('https://www.googleapis.com/auth/drive.file');
    const result = await user.reauthenticateWithPopup(provider);
    if (result.credential) {
      AUTH._googleAccessToken = result.credential.accessToken;
      return AUTH._googleAccessToken;
    }
  } catch(e) {
    if (e.code !== 'auth/popup-closed-by-user') {
      console.warn('Drive re-auth failed:', e.code);
    }
  }
  return null;
}

/**
 * Abre el Google Picker para seleccionar archivos de Drive.
 * Devuelve una Promise que resuelve con un array de archivos seleccionados,
 * cada uno con: { fileId, name, mimeType, iconUrl, webViewLink, thumbnailUrl }
 */
async function openDrivePicker() {
  const token = await _ensureDriveToken();
  if (!token) {
    showToast('Inicia sesión con Google para vincular archivos de Drive.');
    throw new Error('No Google token');
  }
  return new Promise((resolve, reject) => {
    if (!_pickerApiLoaded) {
      showToast('Cargando Google Drive… intenta de nuevo en un momento.');
      // Intentar cargar de nuevo
      if (typeof gapi !== 'undefined') {
        gapi.load('picker', () => {
          _pickerApiLoaded = true;
          showToast('Google Drive listo. Intenta de nuevo.');
        });
      }
      reject(new Error('Picker not loaded'));
      return;
    }

    const docsView = new google.picker.DocsView()
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false);

    const picker = new google.picker.PickerBuilder()
      .setOAuthToken(token)
      .setDeveloperKey(firebaseConfig.apiKey)
      .addView(docsView)
      .addView(new google.picker.DocsUploadView())
      .setTitle('Seleccionar archivos de Google Drive')
      .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
      .setCallback(data => {
        if (data.action === google.picker.Action.PICKED) {
          const files = data.docs.map(doc => ({
            fileId:       doc.id,
            name:         doc.name,
            mimeType:     doc.mimeType,
            iconUrl:      doc.iconUrl,
            webViewLink:  doc.url,
            thumbnailUrl: doc.thumbnails && doc.thumbnails.length
                          ? doc.thumbnails[doc.thumbnails.length - 1].url
                          : null,
          }));
          resolve(files);
        } else if (data.action === google.picker.Action.CANCEL) {
          resolve([]);
        }
      })
      .setLocale('es')
      .setSize(900, 550)
      .build();

    picker.setVisible(true);
  });
}

/**
 * Renderiza la lista de adjuntos de Drive en un contenedor.
 * @param {Array} attachments - Array de objetos { fileId, name, mimeType, iconUrl, webViewLink }
 * @param {HTMLElement} container - Contenedor donde renderizar
 * @param {boolean} editable - Si true, muestra botón para eliminar adjunto
 * @param {Function} onRemove - Callback(index) cuando se elimina un adjunto
 */
function renderDriveAttachments(attachments, container, editable, onRemove) {
  if (!container) return;
  container.innerHTML = '';

  if (!attachments || !attachments.length) {
    container.innerHTML = '<p class="drive-empty">Sin archivos adjuntos.</p>';
    return;
  }

  attachments.forEach((att, idx) => {
    const chip = document.createElement('a');
    chip.className = 'drive-chip';
    chip.href = att.webViewLink || '#';
    chip.target = '_blank';
    chip.rel = 'noopener noreferrer';
    chip.title = att.name;

    const icon = _driveFileIcon(att.mimeType, att.iconUrl);
    const nameSpan = document.createElement('span');
    nameSpan.className = 'drive-chip-name';
    nameSpan.textContent = att.name.length > 35 ? att.name.slice(0, 34) + '…' : att.name;

    chip.appendChild(icon);
    chip.appendChild(nameSpan);

    if (editable && onRemove) {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'drive-chip-remove';
      removeBtn.innerHTML = '&times;';
      removeBtn.title = 'Quitar adjunto';
      removeBtn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        onRemove(idx);
      });
      chip.appendChild(removeBtn);
    }

    container.appendChild(chip);
  });
}

/**
 * Devuelve un elemento con el ícono apropiado según el tipo MIME.
 */
function _driveFileIcon(mimeType, iconUrl) {
  const el = document.createElement('span');
  el.className = 'drive-chip-icon';

  // Usar SVG propios para tipos comunes
  const mime = (mimeType || '').toLowerCase();
  let svg = '';

  if (mime.includes('spreadsheet') || mime.includes('excel') || mime.includes('csv')) {
    svg = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0f9d58" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M8 13h2"/><path d="M14 13h2"/><path d="M8 17h2"/><path d="M14 17h2"/></svg>';
  } else if (mime.includes('document') || mime.includes('word') || mime.includes('msword')) {
    svg = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4285f4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>';
  } else if (mime.includes('presentation') || mime.includes('powerpoint')) {
    svg = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f4b400" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><circle cx="12" cy="14" r="3"/></svg>';
  } else if (mime.includes('pdf')) {
    svg = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ea4335" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 12h1c1 0 2 .5 2 1.5s-1 1.5-2 1.5h-1v3"/></svg>';
  } else if (mime.includes('image')) {
    svg = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8e44ad" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>';
  } else if (mime.includes('folder')) {
    svg = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f4b400" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>';
  } else {
    // Genérico
    svg = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>';
  }

  el.innerHTML = svg;
  return el;
}

// Inicializar cuando la página carga
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    setTimeout(initDrivePicker, 1000);
  });
}
