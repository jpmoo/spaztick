const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Reserved for future: config path, native dialogs, etc.
});
