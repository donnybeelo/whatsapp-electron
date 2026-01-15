const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Tray,
  nativeImage,
  Notification,
} = require("electron");
const Store = require("electron-store");
const path = require("node:path");

app.setAppUserModelId("whatsapp");

// Set desktop name for Linux notifications (AppImage)
if (process.platform === "linux") {
	app.setDesktopName("whatsapp.desktop");
}

// Single Electron Instance
if (!app.requestSingleInstanceLock()) {
	app.quit();
	return;
}

// Parse command line arguments
const startInBackground =
	process.argv.includes("--background") || process.argv.includes("-b");

class WhatsAppElectron {
	constructor() {
		this.store = new Store();
		this.baseIcon = !app.isPackaged
			? path.join(__dirname, "../assets/whatsapp-icon-outline.png")
			: path.join(
				process.resourcesPath,
				"app.asar.unpacked/assets/whatsapp-icon-outline.png",
			);
		this.isQuit = false;

		this.bounds = this.store.get("bounds");
		if (this.bounds == undefined) {
			this.bounds = { width: 1024, height: 768, x: null, y: null };
			this.store.set("bounds", this.bounds);
		}

		this.menuTemplate = [
			{
				label: "Help",
				submenu: [
					{
						label: `Version ${Constants.version} by Daniel Elia`,
						enabled: false,
					},
					{ type: "separator" },
					{
						label: "Open Development Tool",
						accelerator: "Ctrl+Shift+I",
						click: () => {
							this.window.webContents.openDevTools();
						},
					},
					{
						label: "Force Reload",
						accelerator: "Ctrl+R",
						click: () => this._forceReload(),
					},
					{ type: "separator" },
					{
						label: "Quit",
						click: () => {
							this.isQuit = true;
							app.quit();
						},
					},
				],
			},
		];
	}

	_initElectronApp() {
		app.userAgentFallback = Constants.whatsapp.userAgent;

		if (process.platform == "win32") app.setAppUserModelId(Constants.appName);
	}

	_forceReload() {
		// Check for internet and reload the correct page
		const isOnline = this.checkInternet();
		if (isOnline) {
			this.window.loadURL(Constants.whatsapp.url);
		} else {
			this.window.loadFile(path.join(__dirname, 'offline.html'));
			this.establishRefreshInterval();
		}
	}

	establishRefreshInterval() {
		this._pollInterval = setInterval(() => {
			if (!this.window) return;
			this.checkInternet().then(isOnline => {
				const currentURL = this.window.webContents.getURL();
				const isOffline = currentURL.endsWith('offline.html');
				if (isOnline && isOffline) {
					// If online and currently showing offline.html, restore WhatsApp
					this.window.loadURL(Constants.whatsapp.url);
					clearInterval(this._pollInterval);
				} else if (!isOnline && !isOffline) {
					// If offline and currently showing WhatsApp, show offline.html
					this.window.loadFile(path.join(__dirname, 'offline.html'));
				}
			});
		}, 10000);
	}

	init() {
		this._initElectronApp();

		this.createWindow();

		// set version on menu
		this.menuTemplate[0].submenu[0].label = `Version ${Constants.version}`;

		this.menu = Menu.buildFromTemplate(this.menuTemplate);
		Menu.setApplicationMenu(this.menu);

		const menu = Menu.buildFromTemplate([
			{
				label: "Show WhatsApp",
				click: () => {
					this.showHide();
				},
			},
			{ type: "separator" },
			{
				label: "Quit",
				click: () => {
					this.isQuit = true;
					app.quit();
				},
			},
		]);

		this.tray = new Tray(this.baseIcon);
		this.tray.setContextMenu(menu);
		this.tray.setToolTip(Constants.appName);
		this.tray.on("click", () => {
			this.showHide();
		});
		
		//Events
		// Relay unread badge updates from renderer
		ipcMain.on(Constants.event.updateUnreadMessages, (event, data) => {
			this.updateTrayBadgeCounter(data.unread);
		});

		// Relay badge icon update from renderer
		ipcMain.on(Constants.event.updateBadgeIcon, (event, dataUrl) => {
			this.tray.setImage(nativeImage.createFromDataURL(dataUrl));
		});

		// Relay notifications from renderer
		ipcMain.on(Constants.event.newRendererNotification, (event, data) => {
			//console.log("New Renderer Notification...", data);
			const n = new Notification({
				title: data.title,
				body: data.options.body,
				icon: nativeImage.createFromDataURL(data.icon),
			});
			n.on("click", (event) => {
				console.log("Notification Clicked...", data.id, data.options.tag);
				this.showHide(false);
				this.window.webContents.send(
					Constants.event.fireNotificationClick,
					data.options.tag,
				);
			});
			n.show();
		});

		// Relay clear workers and reload from renderer
		ipcMain.on(Constants.event.clearWorkersAndReload, () => {
			this.window.webContents.session.clearCache().then(() => {
				this._forceReload();
			});
		});
		
		ipcMain.on(Constants.event.minimizeWindow, () => {
			this.window.minimize();
		});

		ipcMain.on(Constants.event.maximizeWindow, () => {
			if (this.window.isMaximized()) {
				this.window.unmaximize();
			} else {
				this.window.maximize();
			}
		});

		ipcMain.on(Constants.event.closeWindow, () => {
			this.window.close();
		});

		this.establishRefreshInterval();
	}

	createWindow() {
		const isWindows = process.platform === "win32";
		const preloadPath = app.isPackaged
			? path.join(app.getAppPath(), "src", "preload.js")
			: path.join(__dirname, "preload.js");
		const options = {
			width: this.bounds.width + Constants.offsets.window.width,
			height: this.bounds.height + Constants.offsets.window.height,
			minWidth: 750,
			minHeight: 550,
			icon: this.baseIcon,
			transparent: !isWindows,
			hasShadow: true,
			frame: false,
			thickFrame: isWindows,
			webSecurity: false,
			spellcheck: true,
			contextIsolation: false,
			show: !startInBackground,
			webPreferences: {
				partition: 'persist:default',
				preload: preloadPath,
			},
		};

		if (this.bounds.x != null) {
			options.x = this.bounds.x + Constants.offsets.window.x;
			options.y = this.bounds.y + Constants.offsets.window.y;
		}

		this.window = new BrowserWindow(options);
		
		this.window.webContents.setWindowOpenHandler(({ url }) => {
			require('electron').shell.openExternal(url);
			return { action: 'deny' };
		});
		this.window.webContents.send(Constants.event.initResources, {
			constants: Constants,
		});

		// Relay maximize/minimize/close events to renderer for CSS
		this.window.on("maximize", () => {
			this.window.webContents.send(Constants.event.windowMaximizeStateChanged, { isMaximized: true });
		});
		this.window.on("unmaximize", () => {
			this.window.webContents.send(Constants.event.windowMaximizeStateChanged, { isMaximized: false });
		});

		// Send constants/init to renderer after load
		this.window.webContents.on('did-finish-load', () => {
			this.window.webContents.send(Constants.event.initWhatsAppInstance, {
				id: 'main',
				name: 'WhatsApp',
				constants: Constants,
			});
		});

		// Connectivity check
		const isOnline = this.checkInternet();
		if (!isOnline) {
			this.window.loadFile(path.join(__dirname, 'offline.html'));
		} else {
			this.window.loadURL(Constants.whatsapp.url);
		}
		if (!startInBackground)
			this.window.show();

		this.window.on("move", () => {
			this.storeWindowBounds();
		});
		this.window.on("resize", () => {
			this.storeWindowBounds();
		});

		this.window.on("close", (e) => {
			if (this.isQuit) {
				app.quit();
				return;
			}
			e.preventDefault();
			this.window.hide();
		});

		this.window.setTitle(Constants.appName);
	}

	async checkInternet() {
		// Try to resolve a DNS or fetch a known URL
		return new Promise((resolve) => {
			require('dns').resolve('whatsapp.com', (err) => {
				if (err) resolve(false);
				else resolve(true);
			});
		});
	}


	storeWindowBounds() {
		this.bounds = this.window.getBounds();
		this.store.set("bounds", this.bounds);
	}

	updateTrayBadgeCounter(counter = 0) {
		if (counter === 0) {
			this.tray.setImage(this.baseIcon);
			return;
		} else {
			// Convert icon to data URL so it can be loaded in the webview
			const iconDataUrl = nativeImage.createFromPath(this.baseIcon).toDataURL();
			this.window.webContents.send(
				Constants.event.buildBadgeIcon,
				{ counter, iconDataUrl },
			);
		}
	}

	showHide(hide = true) {
		if (!this.window.isFocused()) {
			if (this.window.isVisible()) {
				this.window.focus();
			} else if (this.window.isMinimized()) {
				this.window.restore();
				this.window.focus();
			} else {
				this.window.show();
				this.window.restore();
				this.window.focus();
			}
		} else {
			if (hide) {
				this.window.hide();
			}
		}
	}
}

let Constants = {};
const ws = new WhatsAppElectron();

app.whenReady().then(() => {
	Constants = require("./constants").init(app.getSystemLocale());
	ws.init();
});

app.on("second-instance", () => {
	ws.showHide(false);
});

app.on("window-all-closed", () => {
	app.quit();
});
