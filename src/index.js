import {
	app,
	BrowserWindow,
	desktopCapturer,
	ipcMain,
	Menu,
	Tray,
	nativeImage,
	Notification,
	shell,
	screen,
	clipboard,
} from "electron";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "url";
import windowStateKeeper from "electron-window-state";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.setAppUserModelId("whatsapp");

// Set desktop name for Linux notifications (AppImage)
if (process.platform === "linux") {
	app.setDesktopName("whatsapp.desktop");
}

if (process.defaultApp) {
	if (process.argv.length >= 2) {
		app.setAsDefaultProtocolClient("whatsapp", process.execPath, [
			path.resolve(process.argv[1]),
		]);
	}
} else {
	app.setAsDefaultProtocolClient("whatsapp");
}

// Single Electron Instance
if (!app.requestSingleInstanceLock()) {
	app.quit();
	process.exit(0);
}

// Parse command line arguments
const startInBackground =
	process.argv.includes("--background") || process.argv.includes("-b");

if (startInBackground) {
	// Tell the preloader it's being loaded in the background
	process.env.WHATSAPP_BACKGROUND = "1";
}
class WhatsAppElectron {
	constructor() {
		this.baseIcon = !app.isPackaged
			? path.join(__dirname, "../assets/whatsapp-icon-outline.png")
			: path.join(
					process.resourcesPath,
					"app.asar.unpacked/assets/whatsapp-icon-outline.png",
				);
		this.isQuit = false;
		this.isHyprland =
			process.env.XDG_CURRENT_DESKTOP === "Hyprland" ||
			!!process.env.HYPRLAND_INSTANCE_SIGNATURE;

		this.notifications = new Map();
		this.startUrl = null;

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
						accelerator: "CmdOrCtrl+Q",
						click: () => {
							this.isQuit = true;
							app.quit();
						},
					},
				],
			},
		];
	}

	handleProtocolUrl(argv) {
		const urlArg = argv.find((arg) => arg.startsWith("whatsapp://"));
		if (urlArg) {
			const newUrl = urlArg.replace("whatsapp://", Constants.whatsapp.url);
			if (this.window && this.window.webContents) {
				this.window.loadURL(newUrl);
				if (this.window.isMinimized()) this.window.restore();
				this.window.focus();
			} else {
				this.startUrl = newUrl;
			}
		}
	}

	_initElectronApp() {
		app.userAgentFallback = Constants.whatsapp.userAgent;

		if (process.platform == "win32") app.setAppUserModelId(Constants.appName);
	}

	_forceReload() {
		// Check for internet and reload the correct page
		this.checkInternet().then((isOnline) => {
			if (isOnline) {
				if (this._pollInterval) {
					clearInterval(this._pollInterval);
					this._pollInterval = null;
				}
				this.window.loadURL(Constants.whatsapp.url);
			} else {
				this.window.loadFile(path.join(__dirname, "offline.html"));
				this.establishRefreshInterval();
			}
		});
	}

	establishRefreshInterval() {
		this._pollInterval = setInterval(() => {
			if (!this.window) return;
			this.checkInternet().then((isOnline) => {
				const currentURL = this.window.webContents.getURL();
				const isOffline = currentURL.endsWith("offline.html");
				if (isOnline && isOffline) {
					// If online and currently showing offline.html, restore WhatsApp
					this.window.loadURL(Constants.whatsapp.url);
					clearInterval(this._pollInterval);
					return;
				} else if (!isOnline && !isOffline) {
					// If offline and currently showing WhatsApp, show offline.html
					this.window.loadFile(path.join(__dirname, "offline.html"));
				} else if (!isOnline && isOffline) {
					this.window.webContents.send(Constants.event.pollRefresh);
				}
			});
		}, 10000);
	}

	init() {
		this._initElectronApp();
		this.handleProtocolUrl(process.argv);
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

			if (data.unreadTags) {
				// Close notifications for tags that are no longer unread
				for (const [tag, notification] of this.notifications.entries()) {
					if (!data.unreadTags.includes(tag)) {
						notification.close();
						this.notifications.delete(tag);
					}
				}
			}
		});

		// Relay badge icon update from renderer
		ipcMain.on(Constants.event.updateBadgeIcon, (event, dataUrl) => {
			this.tray.setImage(nativeImage.createFromDataURL(dataUrl));
		});

		// Relay notifications from renderer
		ipcMain.on(Constants.event.newRendererNotification, (event, data) => {
			//console.log("New Renderer Notification...", data);

			// Close existing notification with the same tag
			if (data.options.tag && this.notifications.has(data.options.tag)) {
				this.notifications.get(data.options.tag).close();
			}

			const n = new Notification({
				title: data.title,
				body: data.options.body,
				icon: data.icon ? nativeImage.createFromDataURL(data.icon) : undefined,
				silent: data.options.silent,
			});

			if (data.options.tag) {
				this.notifications.set(data.options.tag, n);
				n.on("close", () => {
					this.notifications.delete(data.options.tag);
				});
			}

			n.on("click", (event) => {
				// console.log("Notification Clicked...", data.id, data.options.tag);
				this.showHide(false);
				this.window.webContents.send(
					Constants.event.fireNotificationClick,
					data.options.tag,
				);
			});
			n.show();
		});

		// Relay notification close from renderer
		ipcMain.on(Constants.event.closeRendererNotification, (event, tag) => {
			if (this.notifications.has(tag)) {
				this.notifications.get(tag).close();
				this.notifications.delete(tag);
			}
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
	}

	createWindow() {
		const primaryDisplay = screen.getPrimaryDisplay();
		const { width: screenWidth, height: screenHeight } =
			primaryDisplay.workArea;
		const windowState = windowStateKeeper({
			defaultWidth: Math.max(1200, Math.floor(screenWidth * 0.8)),
			defaultHeight: Math.max(800, Math.floor(screenHeight * 0.8)),
		});
		this.windowState = windowState;
		const preloadPath = app.isPackaged
			? path.join(app.getAppPath(), "src", "preload.js")
			: path.join(__dirname, "preload.js");
		const options = {
			width: windowState.width,
			height: windowState.height,
			x: windowState.x,
			y: windowState.y,
			minWidth: 750,
			minHeight: 550,
			icon: this.baseIcon,
			frame: false,
			thickFrame: true,
			autoHideMenuBar: true,
			show: !startInBackground,
			webPreferences: {
				partition: "persist:default",
				preload: preloadPath,
				spellcheck: true,
				contextIsolation: false,
				webSecurity: false,
			},
		};

		this.window = new BrowserWindow(options);

		windowState.manage(this.window);

		this.window.webContents.on("context-menu", (_event, params) => {
			const menu = Menu.buildFromTemplate([]);
			const editFlags = params.editFlags || {};

			if (params.misspelledWord) {
				for (const suggestion of params.dictionarySuggestions) {
					menu.append(
						new MenuItem({
							label: suggestion,
							click: () => {
								this.window.webContents.replaceMisspelling(suggestion);
							},
						}),
					);
				}
				menu.append(
					new MenuItem({
						label: "Add to Dictionary",
						click: () => {
							this.window.webContents.session.addWordToSpellCheckerDictionary(
								params.selectionText,
							);
						},
					}),
				);
				menu.append(new MenuItem({ type: "separator" }));
			}
			if (params.mediaType === "image" || params.mediaType === "video") {
				menu.append(
					new MenuItem({
						label: "Copy " + params.mediaType,
						click: () => {
							this.window.webContents.copyImageAt(params.x, params.y);
						},
					}),
				);
			}
			if (editFlags.canUndo) {
				menu.append(new MenuItem({ role: "undo" }));
			}
			if (editFlags.canRedo) {
				menu.append(new MenuItem({ role: "redo" }));
			}
			if (editFlags.canCut) {
				menu.append(new MenuItem({ role: "cut" }));
			}
			if (editFlags.canCopy) {
				menu.append(new MenuItem({ role: "copy" }));
			}
			if (editFlags.canPaste) {
				menu.append(new MenuItem({ role: "paste" }));
			}
			if (editFlags.canDelete) {
				menu.append(new MenuItem({ role: "delete" }));
			}
			if (editFlags.canEditRichly) {
				menu.append(new MenuItem({ role: "pasteAndMatchStyle" }));
			}

			if (menu.items.length > 0) {
				menu.popup({ window: this.window });
			}
		});

		// Set up permission handler for camera and microphone
		this.window.webContents.session.setPermissionRequestHandler(
			(webContents, permission, callback) => {
				const allowedPermissions = [
					"media",
					"mediaKeySystem",
					"notifications",
					"microphone",
					"camera",
					"fullscreen",
					"display-capture",
				];

				if (allowedPermissions.includes(permission)) {
					callback(true); // Automatically grant permission
				} else {
					callback(false);
				}
			},
		);

		// Set up permission check handler for ongoing permission checks
		this.window.webContents.session.setPermissionCheckHandler(
			(webContents, permission, requestingOrigin, details) => {
				const allowedPermissions = [
					"media",
					"mediaKeySystem",
					"notifications",
					"microphone",
					"camera",
					"fullscreen",
					"display-capture",
				];

				return allowedPermissions.includes(permission);
			},
		);

		// Allow screen sharing via getDisplayMedia
		this.window.webContents.session.setDisplayMediaRequestHandler(
			async (request, callback) => {
				try {
					const sources = await desktopCapturer.getSources({
						types: ["screen", "window"],
					});
					const source = sources[0];
					if (source) {
						callback({ video: source });
					} else {
						callback({});
					}
				} catch (error) {
					console.error("Display media request error:", error);
					callback({});
				}
			},
		);

		this.window.webContents.setWindowOpenHandler(({ url }) => {
			const isWhatsAppDomain = (() => {
				try {
					const parsed = new URL(url);
					return (
						parsed.hostname === "web.whatsapp.com" ||
						parsed.hostname.endsWith(".whatsapp.com")
					);
				} catch {
					return false;
				}
			})();
			if (isWhatsAppDomain) {
				return {
					action: "allow",
					overrideBrowserWindowOptions: {
						...options,
						// no parent: a call window has to outlive the main window being
						// hidden, and a transient child can't be maximised on Wayland
						show: true,
						frame: true,
						maximizable: true,
						fullscreenable: true,
						width: 400,
						height: 300,
						minWidth: 300,
						minHeight: 200,
					},
				};
			}
			shell.openExternal(url);
			return { action: "deny" };
		});

		// F11 / double-click titlebar to fullscreen a call window, Escape to leave
		this.window.webContents.on("did-create-window", (child) => {
			child.webContents.on("before-input-event", (event, input) => {
				if (input.type !== "keyDown") return;
				if (input.key === "F11") {
					child.setFullScreen(!child.isFullScreen());
					event.preventDefault();
				} else if (input.key === "Escape" && child.isFullScreen()) {
					child.setFullScreen(false);
					event.preventDefault();
				}
			});
		});
		this.window.webContents.send(Constants.event.initResources, {
			constants: Constants,
		});

		// Relay maximize/minimize/close events to renderer for CSS
		this.window.on("maximize", () => {
			this.window.webContents.send(Constants.event.windowMaximizeStateChanged, {
				isMaximized: true,
			});
		});
		this.window.on("unmaximize", () => {
			this.window.webContents.send(Constants.event.windowMaximizeStateChanged, {
				isMaximized: false,
			});
			if (process.platform === "linux" && !this.isHyprland) {
				// Fallback to window state dimensions if unmaximize fails to restore size
				// Wrapped in setTimeout to prevent infinite recursion (RangeError)
				setTimeout(() => {
					if (this.windowState) {
						this.window.setSize(
							this.windowState.width,
							this.windowState.height,
						);
						this.window.setPosition(this.windowState.x, this.windowState.y);
					}
				}, 100);
			}
		});

		// Relay focus state to renderer for window controls styling
		this.window.on("focus", () => {
			this.window.webContents.send(Constants.event.windowFocusStateChanged, {
				isFocused: true,
			});
		});
		this.window.on("blur", () => {
			this.window.webContents.send(Constants.event.windowFocusStateChanged, {
				isFocused: false,
			});
		});

		// Send constants/init to renderer after load
		this.window.webContents.on("did-finish-load", () => {
			this.window.webContents.send(Constants.event.initWhatsAppInstance, {
				id: "main",
				name: "WhatsApp",
				constants: Constants,
				isHyprland: this.isHyprland,
			});
			this.window.webContents.send(Constants.event.windowMaximizeStateChanged, {
				isMaximized: this.window.isMaximized(),
			});
			this.window.webContents.send(Constants.event.windowFocusStateChanged, {
				isFocused: this.window.isFocused(),
			});
		});

		// Connectivity check
		this.checkInternet().then((isOnline) => {
			if (!isOnline) {
				this.window.loadFile(path.join(__dirname, "offline.html"));
				this.establishRefreshInterval();
			} else {
				if (this._pollInterval) {
					clearInterval(this._pollInterval);
					this._pollInterval = null;
				}
				const urlToLoad = this.startUrl || Constants.whatsapp.url;
				this.window.loadURL(urlToLoad);
				this.startUrl = null;
			}
		});

		if (!startInBackground) this.window.show();

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
		return new Promise((resolve) => {
			const testUrl = "https://connectivitycheck.gstatic.com/generate_204";
			const timeout = 5000;

			const request = https.get(testUrl, { timeout }, (res) => {
				if (res.statusCode === 204) {
					resolve(true);
				} else {
					resolve(false);
				}
				request.destroy();
			});

			request.on("timeout", () => {
				console.error("Internet check timed out.");
				request.destroy();
				resolve(false);
			});

			request.on("error", (err) => {
				console.error("Internet check error:", err.message);
				request.destroy();
				resolve(false);
			});
		});
	}

	updateTrayBadgeCounter(counter = 0) {
		if (counter === 0) {
			this.tray.setImage(this.baseIcon);
			return;
		} else {
			// Convert icon to data URL so it can be loaded in the webview
			const iconDataUrl = nativeImage.createFromPath(this.baseIcon).toDataURL();
			this.window.webContents.send(Constants.event.buildBadgeIcon, {
				counter,
				iconDataUrl,
			});
		}
	}

	showHide(hide = true) {
		if (!this.window.isFocused()) {
			if (this.window.isMinimized()) {
				this.window.restore();
				this.window.focus();
			} else if (this.window.isVisible()) {
				this.window.focus();
			} else {
				this.window.show();
				this.window.focus();
			}

			// Close initial unread summary notification when window is shown
			if (this.notifications.has("initial-unread")) {
				this.notifications.get("initial-unread").close();
				this.notifications.delete("initial-unread");
			}
		} else {
			if (hide) {
				this.window.hide();
			}
		}
	}
}

import { init as initConstants } from "./constants.js";
import { MenuItem } from "electron/main";
let Constants = {};
// webSecurity:false stops Chromium honouring COOP/COEP (Electron 41+), which drops
// SharedArrayBuffer; WhatsApp gates calling on it. Re-enable SAB without isolation.
// Must run before app is ready, or the renderer never sees the feature.
app.commandLine.appendSwitch(
	"enable-features",
	"SharedArrayBuffer,SharedArrayBufferOnDesktop",
);

const ws = new WhatsAppElectron();

app.whenReady().then(() => {
	Constants = initConstants(app.getSystemLocale());
	// ponytail: on GNOME the StatusNotifierWatcher can still be registering at
	// login/autostart; creating the Tray before it's up renders a broken icon
	// with a dead menu. Delay init() slightly, bump if it still happens.
	if (process.platform === "linux") {
		setTimeout(() => ws.init(), 1500);
	} else {
		ws.init();
	}
});

app.on("second-instance", (event, argv) => {
	ws.showHide(false);
	ws.handleProtocolUrl(argv);
});

app.on("window-all-closed", () => {
	app.quit();
});
