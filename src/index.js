const {
	app,
	BrowserWindow,
	WebContentsView,
	ipcMain,
	Menu,
	Tray,
	nativeImage,
	Notification,
	MenuItem,
	session,
	screen,
} = require("electron");
const Store = require("electron-store");
const path = require("node:path");
const fs = require("node:fs");

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

		this.accounts = this.store.get("accounts");
		this.instances = {};
		if (this.accounts == undefined) {
			this.accounts = [{ id: "default", name: "Default Account" }];
			this.store.set("accounts", this.accounts);
		}

		this.menuTemplate = [
			{
				label: "WhatsApp",
				submenu: [
					{
						label: "Accounts",
						enabled: true,
						accelerator: "Alt+a",
						click: () => {
							this.removeViews();
							this.window.setTitle(Constants.appName);
						},
					},
				],
			},
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
							const views = this.window.contentView.children;
							if (views.length > 0)
								views[views.length - 1].webContents.openDevTools();
							else this.window.webContents.openDevTools();
						},
					},
					{
						label: "Force Reload (instance)",
						accelerator: "Ctrl+R",
						click: () => {
							const views = this.window.contentView.children;
							if (views.length > 0) {
								const view = views[views.length - 1];
								view.webContents.reload();
								setTimeout(() => {
									view.webContents.send(Constants.event.initWhatsAppInstance, {
										id: view._id,
										name: view._name,
										constants: Constants,
									});
								}, 1000);
							} else {
								this.window.webContents.reload();
								setTimeout(() => {
									this.window.webContents.send(Constants.event.initResources, {
										constants: Constants,
									});
								}, 1000);
							}
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
				],
			},
		];
	}

	_initElectronApp() {
		app.userAgentFallback = Constants.whatsapp.userAgent;

		if (process.platform == "win32") app.setAppUserModelId(Constants.appName);
	}

	init() {
		this._initElectronApp();

		this.createWindow();

		for (const item of this.accounts) this.createView(item.id, item.name);

		// set version on menu
		this.menuTemplate[1].submenu[0].label = `Version ${Constants.version}`;

		this.menu = Menu.buildFromTemplate(this.menuTemplate);
		Menu.setApplicationMenu(this.menu);

		if (this.accounts.length > 0) this.setCurrentViewByIdx(0);

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

		// Events
		ipcMain.on(Constants.event.newRendererNotification, (event, data) => {
			//console.log("New Renderer Notification...", data);
			const n = new Notification({
				title: data.title,
				body: data.options.body,
				icon: nativeImage.createFromDataURL(data.icon),
			});
			n.on("click", (event) => {
				//console.log("Notification Clicked...", data.id, data.options.tag);
				this.showHide(false);
				this.setCurrentView(data.id);
				this.instances[data.id].view.webContents.send(
					Constants.event.fireNotificationClick,
					data.options.tag,
				);
			});
			n.show();
		});

		ipcMain.on(Constants.event.updateUnreadMessages, (event, data) => {
			//console.log("Unread Messages: ", data);
			this.instances[data.id].unread = data.unread;
			this.updateTrayBadgeCounter();
		});

		ipcMain.on(Constants.event.updateBadgeIcon, (event, data) => {
			//console.log("Received updated badge icon...");
			this.tray.setImage(nativeImage.createFromDataURL(data));
		});

		ipcMain.on(Constants.event.reloadWhatsAppInstance, (envet, id) => {
			console.log("Received reloadWhatsAppInstance...", id);
			const bv = this.instances[id].view;
			bv.webContents.reload();
			setTimeout(() => {
				bv.webContents.send(Constants.event.initWhatsAppInstance, {
					id: bv._id,
					name: bv._name,
					constants: Constants,
				});
			}, 1000);
		});
		ipcMain.on(Constants.event.clearWorkersAndReload, (envet, id) => {
			console.log("Received clearWorkersAndReload...", id);
			const ses = session.fromPartition(`persist:${id}`);
			ses.flushStorageData();
			ses.clearStorageData({ storages: ["serviceworkers"] });

			const bv = this.instances[id].view;
			bv.webContents.reload();
			setTimeout(() => {
				bv.webContents.send(Constants.event.initWhatsAppInstance, {
					id: bv._id,
					name: bv._name,
					constants: Constants,
				});
			}, 1000);
		});

		ipcMain.handle(Constants.event.getAccountsList, () => {
			//console.log("From Renderer - getAccountsList", data);
			return this.accounts;
		});

		ipcMain.on(Constants.event.addAccount, (event, data) => {
			//console.log("From Renderer - addAccount", data);
			this.accounts.push(data);
			this.store.set("accounts", this.accounts);
			this.createView(data.id, data.name);

			this.menu = Menu.buildFromTemplate(this.menuTemplate);
			Menu.setApplicationMenu(this.menu);

			this.window.webContents.send(Constants.event.reloadAccounts);
		});

		ipcMain.on(Constants.event.updateAccount, (event, data) => {
			//console.log("From Renderer - updateAccount", data);
			for (const idx in this.accounts) {
				if (this.accounts[idx].id == data.id) {
					this.accounts[idx].name = data.name;
					this.store.set("accounts", this.accounts);
					break;
				}
			}

			this.instances[data.id].name = data.name;
			this.instances[data.id].view._name = data.name;

			for (const item of this.menuTemplate[0].submenu) {
				if (item.id == data.id) {
					item.label = data.name;
					break;
				}
			}

			this.menu = Menu.buildFromTemplate(this.menuTemplate);
			Menu.setApplicationMenu(this.menu);

			this.window.webContents.send(Constants.event.reloadAccounts);
		});

		ipcMain.on(Constants.event.deleteAccount, (event, id) => {
			//console.log("From Renderer - deleteAccount", id);
			let toDelete = null;
			for (let idx = 0; idx < this.accounts.length; idx++) {
				if (this.accounts[idx].id == id) {
					toDelete = idx;
					break;
				}
			}

			this.accounts.splice(toDelete, 1);
			this.store.set("accounts", this.accounts);

			delete this.instances[id];

			this.menuTemplate[0].submenu.splice(toDelete + 2, 1);
			for (let idx = 0; idx < this.menuTemplate[0].submenu.length; idx++) {
				if (this.menuTemplate[0].submenu[idx].type == "radio") {
					if (idx - 2 < 10)
						this.menuTemplate[0].submenu[idx].accelerator = `Alt+${idx - 1}`;

					if (idx - 2 == 10)
						this.menuTemplate[0].submenu[idx].accelerator = `Alt+0`;

					if (idx - 2 > 10)
						delete this.menuTemplate[0].submenu[idx].accelerator;
				}
			}
			this.menu = Menu.buildFromTemplate(this.menuTemplate);
			Menu.setApplicationMenu(this.menu);

			// remove storage path
			const ses = session.fromPartition(`persist:${id}`);
			ses.clearStorageData().then(() => {
				const dir = ses.getStoragePath();
				fs.rmSync(dir, { recursive: true, force: true });
			});

			this.window.webContents.send(Constants.event.reloadAccounts);
		});

		ipcMain.on(Constants.event.gotoAccount, (event, id) => {
			//console.log("From Renderer - gotoAccount", id);
			this.setCurrentView(id);
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
			ws.window.close();
		});
	}

	createWindow() {
		const isWindows = process.platform === "win32";
		const options = {
			width: this.bounds.width + Constants.offsets.window.width,
			height: this.bounds.height + Constants.offsets.window.height,
			minWidth: 750,
			minHeight: 550,
			icon: this.baseIcon,
			transparent: !isWindows,
			hasShadow: true,
			frame: false,
			thickFrame: isWindows, // Enables native resize borders on Windows without title bar
			webSecurity: false,
			show: !startInBackground,
		};

		if (this.bounds.x != null) {
			options.x = this.bounds.x + Constants.offsets.window.x;
			options.y = this.bounds.y + Constants.offsets.window.y;
		}

		this.window = new BrowserWindow(options);

		this.window.webContents.send(Constants.event.initResources, {
			constants: Constants,
		});

		this.window.on("move", () => {
			this.storeWindowBounds();
			this.checkSnappedState();
		});
		this.window.on("resize", () => {
			this.storeWindowBounds();
			this.checkSnappedState();
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

		this.window.on("focus", () => {
			const views = this.window.contentView.children;
			if (views.length > 0) views[views.length - 1].webContents.focus();
		});

		// Broadcast maximize state changes to all views
		this.window.on("maximize", () => {
			this._lastSnappedOrMaximized = true;
			this.broadcastMaximizeState(true);
		});

		this.window.on("unmaximize", () => {
			// Check if it's snapped after unmaximize
			setTimeout(() => this.checkSnappedState(), 50);
		});

		// Track last snapped state to avoid redundant broadcasts
		this._lastSnappedOrMaximized = false;
	}

	checkSnappedState() {
		if (this.window.isMaximized()) {
			// Already handled by maximize event
			return;
		}

		const isSnapped = this.isWindowSnapped();

		// Only broadcast if state changed
		if (isSnapped !== this._lastSnappedOrMaximized) {
			this._lastSnappedOrMaximized = isSnapped;
			this.broadcastMaximizeState(isSnapped);
		}
	}

	isWindowSnapped() {
		const bounds = this.window.getBounds();
		const display = screen.getDisplayMatching(bounds);
		const workArea = display.workArea;

		// Check if window fills most of the screen width OR height
		const widthPercent = bounds.width / workArea.width;
		const heightPercent = bounds.height / workArea.height;

		return widthPercent >= 0.98 || heightPercent >= 0.9;
	}

	broadcastMaximizeState(isMaximized) {
		// Send to all WhatsApp views
		for (const id in this.instances) {
			if (this.instances[id].view) {
				this.instances[id].view.webContents.send(
					Constants.event.windowMaximizeStateChanged,
					{ isMaximized },
				);
			}
		}
	}

	createView(id, name) {
		this.instances[id] = { id: id, name: name, unread: 0, view: null };

		// Determine preload path - handle both packaged and development modes
		const preloadPath = app.isPackaged
			? path.join(app.getAppPath(), "src", "preload-bv.js")
			: path.join(__dirname, "preload-bv.js");

		const view = new WebContentsView({
			webPreferences: {
				partition: `persist:${id}`,
				preload: preloadPath,
				spellcheck: true,
				contextIsolation: false,
			},
		});
		this.instances[id].view = view;

		view._id = id;
		view._name = name;

		view.setBackgroundColor("#0000");
		view.webContents.loadURL(Constants.whatsapp.url, {
			userAgent: Constants.whatsapp.userAgent,
		});
		view.webContents.setWindowOpenHandler((details) => {
			require("electron").shell.openExternal(details.url);
			return { action: "deny" };
		});

		// Wait for the page to finish loading before sending init event
		view.webContents.on("did-finish-load", () => {
			// Add a small delay to ensure preload script is ready
			setTimeout(() => {
				view.webContents.send(Constants.event.initWhatsAppInstance, {
					id: id,
					name: name,
					constants: Constants,
				});
				// Send initial maximize/snapped state
				const isMaximizedOrSnapped =
					this.window.isMaximized() || this.isWindowSnapped();
				view.webContents.send(Constants.event.windowMaximizeStateChanged, {
					isMaximized: isMaximizedOrSnapped,
				});
				this._lastSnappedOrMaximized = isMaximizedOrSnapped;
			}, 500);
		});
		//view.webContents.send(Constants.event.initWhatsAppInstance, {id: id, name: name, constants: Constants});

		let menuItem = {
			id: id,
			label: name,
			type: "radio",
			checked: false,
			click: () => {
				this.setCurrentView(id);
			},
		};

		if (this.menuTemplate[0].submenu.length == 1)
			this.menuTemplate[0].submenu.push({ type: "separator" });

		if (this.menuTemplate[0].submenu.length < 10 + 2) {
			const idx = this.menuTemplate[0].submenu.length - 1;
			if (idx < 10) menuItem.accelerator = `Alt+${idx}`;
			if (idx == 10) menuItem.accelerator = `Alt+0`;
		}
		this.menuTemplate[0].submenu.push(menuItem);
	}

	setCurrentViewByIdx(idx) {
		this.setCurrentView(this.accounts[idx].id);
	}

	setCurrentView(id) {
		//console.log("setCurrentView:", id);
		const instance = this.instances[id];

		this.window.setTitle(Constants.appName);
		this.replaceView(instance.view);

		if (this.menu != undefined) {
			for (const menu of this.menu.items[0].submenu.items) {
				if (menu.type == "radio" && menu.id == id) menu.checked = true;
			}
		}

		this.setViewBounds(id);
		instance.view.webContents.focus();
	}

	setViewBounds(id, bounds = null) {
		bounds = bounds == null ? this.bounds : bounds;
		this.instances[id].view.setBounds({
			x: 0 + Constants.offsets.view.x,
			y: 0 + Constants.offsets.view.y,
			width: bounds.width + Constants.offsets.view.width,
			height: bounds.height + Constants.offsets.view.height,
		});
	}

	removeViews() {
		const views = this.window.contentView.children;
		for (const view of views) this.window.contentView.removeChildView(view);
	}
	replaceView(view) {
		this.removeViews();
		this.window.contentView.addChildView(view);
	}

	storeWindowBounds() {
		this.bounds = this.window.getBounds();
		this.store.set("bounds", this.bounds);

		for (const id in this.instances) this.setViewBounds(id);
	}

	updateTrayBadgeCounter() {
		let counter = 0;
		for (const id in this.instances) counter += this.instances[id].unread;

		if (counter == 0) {
			this.tray.setImage(this.baseIcon);
			return;
		}

		// Use the first available view to build the badge icon
		const viewIds = Object.keys(this.instances);
		if (viewIds.length > 0 && this.instances[viewIds[0]].view) {
			// Convert icon to data URL so it can be loaded in the webview
			const iconDataUrl = nativeImage.createFromPath(this.baseIcon).toDataURL();
			this.instances[viewIds[0]].view.webContents.send(
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
