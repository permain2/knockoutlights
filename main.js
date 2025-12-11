const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeTheme } = require('electron')
const path = require('path')

let mainWindow = null
let tray = null
let overlayWindows = []
let isFilterActive = false
let settings = {
  temperature: 3400,
  brightness: 80,
  mode: 'night'
}

// Mode presets
const modes = {
  day: { temperature: 6500, brightness: 100 },
  sunset: { temperature: 4500, brightness: 90 },
  night: { temperature: 3400, brightness: 80 },
  sleep: { temperature: 1900, brightness: 60 }
}

function kelvinToRGB(kelvin) {
  const temp = kelvin / 100
  let red, green, blue

  // Red
  if (temp <= 66) {
    red = 255
  } else {
    red = 329.698727446 * Math.pow(temp - 60, -0.1332047592)
    red = Math.max(0, Math.min(255, red))
  }

  // Green
  if (temp <= 66) {
    green = 99.4708025861 * Math.log(temp) - 161.1195681661
    green = Math.max(0, Math.min(255, green))
  } else {
    green = 288.1221695283 * Math.pow(temp - 60, -0.0755148492)
    green = Math.max(0, Math.min(255, green))
  }

  // Blue
  if (temp >= 66) {
    blue = 255
  } else if (temp <= 19) {
    blue = 0
  } else {
    blue = 138.5177312231 * Math.log(temp - 10) - 305.0447927307
    blue = Math.max(0, Math.min(255, blue))
  }

  return { r: Math.round(red), g: Math.round(green), b: Math.round(blue) }
}

function createOverlayWindows() {
  // Remove existing overlays
  overlayWindows.forEach(win => {
    if (!win.isDestroyed()) win.close()
  })
  overlayWindows = []

  // Create overlay for each display
  const displays = screen.getAllDisplays()
  
  displays.forEach((display, index) => {
    const overlayWindow = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      transparent: true,
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      type: 'desktop', // Mac: allows click-through
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    })

    overlayWindow.setIgnoreMouseEvents(true)
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    
    // Load overlay HTML
    overlayWindow.loadURL(`data:text/html,
      <html>
        <head>
          <style>
            body {
              margin: 0;
              padding: 0;
              width: 100vw;
              height: 100vh;
              pointer-events: none;
              background: transparent;
            }
            #overlay {
              width: 100%;
              height: 100%;
              mix-blend-mode: multiply;
              transition: background-color 0.3s ease;
            }
          </style>
        </head>
        <body>
          <div id="overlay"></div>
          <script>
            const { ipcRenderer } = require('electron')
            ipcRenderer.on('update-filter', (event, { r, g, b, opacity }) => {
              document.getElementById('overlay').style.backgroundColor = 
                'rgba(' + r + ',' + g + ',' + b + ',' + opacity + ')'
            })
          </script>
        </body>
      </html>
    `)

    overlayWindows.push(overlayWindow)
  })
}

function updateFilter() {
  if (!isFilterActive) {
    overlayWindows.forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send('update-filter', { r: 255, g: 255, b: 255, opacity: 0 })
      }
    })
    return
  }

  const rgb = kelvinToRGB(settings.temperature)
  const opacity = (100 - settings.brightness) / 100 * 0.5 + 
                  (1 - settings.temperature / 6500) * 0.3

  overlayWindows.forEach(win => {
    if (!win.isDestroyed()) {
      win.webContents.send('update-filter', { 
        r: rgb.r, 
        g: rgb.g, 
        b: rgb.b, 
        opacity: Math.min(0.6, opacity) 
      })
    }
  })
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 380,
    height: 520,
    resizable: false,
    frame: false,
    transparent: true,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })

  mainWindow.loadFile('app.html')

  mainWindow.on('blur', () => {
    if (process.platform === 'darwin') {
      mainWindow.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function createTray() {
  const iconPath = process.platform === 'darwin' 
    ? path.join(__dirname, 'assets', 'tray-icon.png')
    : path.join(__dirname, 'assets', 'tray-icon.ico')
  
  // Use template for macOS
  tray = new Tray(iconPath)
  tray.setToolTip('Knockout Light')

  const contextMenu = Menu.buildFromTemplate([
    { 
      label: isFilterActive ? '✓ Filter Active' : 'Filter Off',
      click: () => {
        isFilterActive = !isFilterActive
        updateFilter()
        createTray() // Rebuild menu
      }
    },
    { type: 'separator' },
    { 
      label: '☀️ Day', 
      click: () => applyMode('day') 
    },
    { 
      label: '🌅 Sunset', 
      click: () => applyMode('sunset') 
    },
    { 
      label: '🌙 Night', 
      click: () => applyMode('night') 
    },
    { 
      label: '😴 Sleep', 
      click: () => applyMode('sleep') 
    },
    { type: 'separator' },
    { 
      label: 'Settings...', 
      click: () => showMainWindow() 
    },
    { type: 'separator' },
    { 
      label: 'Quit', 
      click: () => app.quit() 
    }
  ])

  tray.setContextMenu(contextMenu)
  
  tray.on('click', () => {
    showMainWindow()
  })
}

function showMainWindow() {
  if (!mainWindow) {
    createMainWindow()
  }

  // Position near tray
  const trayBounds = tray.getBounds()
  const windowBounds = mainWindow.getBounds()
  
  let x, y
  if (process.platform === 'darwin') {
    x = Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2)
    y = Math.round(trayBounds.y + trayBounds.height)
  } else {
    x = Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2)
    y = Math.round(trayBounds.y - windowBounds.height)
  }

  mainWindow.setPosition(x, y)
  mainWindow.show()
  mainWindow.focus()
}

function applyMode(mode) {
  settings.mode = mode
  settings.temperature = modes[mode].temperature
  settings.brightness = modes[mode].brightness
  isFilterActive = true
  updateFilter()
  
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('settings-updated', { ...settings, isActive: isFilterActive })
  }
}

// IPC handlers
ipcMain.on('toggle-filter', () => {
  isFilterActive = !isFilterActive
  updateFilter()
  createTray()
})

ipcMain.on('set-temperature', (event, value) => {
  settings.temperature = value
  updateFilter()
})

ipcMain.on('set-brightness', (event, value) => {
  settings.brightness = value
  updateFilter()
})

ipcMain.on('set-mode', (event, mode) => {
  applyMode(mode)
})

ipcMain.on('get-settings', (event) => {
  event.reply('settings-updated', { ...settings, isActive: isFilterActive })
})

// App lifecycle
app.whenReady().then(() => {
  // Hide dock icon on macOS
  if (process.platform === 'darwin') {
    app.dock.hide()
  }

  createOverlayWindows()
  createMainWindow()
  createTray()
  
  // Apply initial filter
  isFilterActive = true
  updateFilter()

  // Handle display changes
  screen.on('display-added', createOverlayWindows)
  screen.on('display-removed', createOverlayWindows)
})

app.on('window-all-closed', () => {
  // Don't quit on macOS when all windows closed
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  showMainWindow()
})

app.on('before-quit', () => {
  overlayWindows.forEach(win => {
    if (!win.isDestroyed()) win.close()
  })
})

