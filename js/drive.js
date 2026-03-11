/**
 * JuriTask — drive.js
 * Google Drive Picker + per-task attachments (Drive files & URLs).
 */

let _pickerApiLoaded = false;
let _pickerInited    = false;

function initDrivePicker() {
  if (_pickerInited) return;
  _pickerInited = true;
  if (typeof gapi !== 'undefined') {
    gapi.load('picker', () => { _pickerApiLoaded = true; });
  }
}

async function _ensureDriveToken() {
  if (AUTH._googleAccessToken) return AUTH._googleAccessToken;
  const user = auth.currentUser;
  if (!user) return null;
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
    if (e.code !== 'auth/popup-closed-by-user') console.warn('Drive re-auth:', e.code);
  }
  return null;
}

async function openDrivePicker() {
  const token = await _ensureDriveToken();
  if (!token) {
    showToast('Inicia sesión con Google para vincular archivos de Drive.');
    throw new Error('No Google token');
  }
  return new Promise((resolve, reject) => {
    if (!_pickerApiLoaded) {
      showToast('Cargando Google Drive… intenta de nuevo.');
      if (typeof gapi !== 'undefined') gapi.load('picker', () => { _pickerApiLoaded = true; });
      reject(new Error('Picker not loaded'));
      return;
    }
    const docsView = new google.picker.DocsView()
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false);

    const builder = new google.picker.PickerBuilder()
      .setOAuthToken(token)
      .addView(docsView)
      .addView(new google.picker.DocsUploadView())
      .setTitle('Seleccionar archivos de Google Drive')
      .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
      .setCallback(data => {
        if (data.action === google.picker.Action.PICKED) {
          resolve(data.docs.map(doc => ({
            type:        'drive',
            fileId:      doc.id,
            name:        doc.name,
            mimeType:    doc.mimeType,
            iconUrl:     doc.iconUrl,
            webViewLink: doc.url,
          })));
        } else if (data.action === google.picker.Action.CANCEL) {
          resolve([]);
        }
      })
      .setLocale('es')
      .setSize(900, 550);

    builder.build().setVisible(true);
  });
}

/**
 * Renderiza adjuntos compactos (solo íconos) debajo de una tarea.
 */
function renderTaskAttachments(attachments, container, editable, onRemove) {
  if (!container) return;
  container.innerHTML = '';
  if (!attachments || !attachments.length) return;

  attachments.forEach((att, idx) => {
    const btn = document.createElement('a');
    btn.className = 'task-att-btn';
    btn.href = att.webViewLink || att.url || '#';
    btn.target = '_blank';
    btn.rel = 'noopener noreferrer';
    btn.title = att.name || att.url || 'Adjunto';

    if (att.type === 'link') {
      btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3d5af1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
    } else {
      btn.innerHTML = _driveFileIconSvg(att.mimeType);
    }

    if (editable && onRemove) {
      btn.addEventListener('contextmenu', e => {
        e.preventDefault();
        if (confirm(`¿Quitar "${att.name || att.url}"?`)) onRemove(idx);
      });
      // Long press for mobile
      let pressTimer;
      btn.addEventListener('touchstart', () => { pressTimer = setTimeout(() => {
        if (confirm(`¿Quitar "${att.name || att.url}"?`)) onRemove(idx);
      }, 600); }, { passive: true });
      btn.addEventListener('touchend', () => clearTimeout(pressTimer));
    }

    container.appendChild(btn);
  });
}

function _driveFileIconSvg(mimeType) {
  const mime = (mimeType || '').toLowerCase();
  if (mime.includes('spreadsheet') || mime.includes('excel'))
    return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0f9d58" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M8 13h2"/><path d="M14 13h2"/><path d="M8 17h2"/><path d="M14 17h2"/></svg>';
  if (mime.includes('document') || mime.includes('word'))
    return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4285f4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>';
  if (mime.includes('presentation') || mime.includes('powerpoint'))
    return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f4b400" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><circle cx="12" cy="14" r="3"/></svg>';
  if (mime.includes('pdf'))
    return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ea4335" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 12h1c1 0 2 .5 2 1.5s-1 1.5-2 1.5h-1v3"/></svg>';
  if (mime.includes('image'))
    return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8e44ad" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>';
  return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>';
}

// Legacy compat
function renderDriveAttachments(attachments, container, editable, onRemove) {
  renderTaskAttachments(attachments, container, editable, onRemove);
}

if (typeof window !== 'undefined') {
  window.addEventListener('load', () => setTimeout(initDrivePicker, 1000));
}
