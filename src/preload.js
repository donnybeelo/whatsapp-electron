const { ipcRenderer } = require("electron");

ipcRenderer.on("poll-refresh", () => {
	window.dispatchEvent(new CustomEvent("poll-refresh"));
});

// Resolved by initializeUI(), i.e. the same sidebar-detected signal the window
// controls wait for. did-finish-load is several seconds too early for the SPA.
let whatsappLoaded;
const whatsappReady = new Promise((resolve) => {
	whatsappLoaded = resolve;
});

let constantsLoaded;
const constantsReady = new Promise((resolve) => {
	constantsLoaded = resolve;
});
const sendWhenReady = (event, ...args) =>
	constantsReady.then(() => ipcRenderer.send(Constants.event[event], ...args));

// Bridge events the page subscribed to, keyed "HostObject.event"; events with
// no listener yet are held until one subscribes
const bridgeListeners = new Map();
const pendingBridgeEvents = new Map();
const emitBridgeEvent = (object, event, payload) => {
	const key = `${object}.${event}`;
	const listeners = bridgeListeners.get(key);
	if (!listeners?.size) {
		pendingBridgeEvents.set(key, [...(pendingBridgeEvents.get(key) ?? []), payload]);
		return;
	}
	for (const listener of listeners) listener(payload);
};

// Stand-in for the Windows app's WebView2 host objects: every bridge call
// resolves with nothing, except the ones below.
if (!window.chrome?.webview) {
	const store = {};
	const special = {
		"ClientKeyBridge.setClientKey": (key) => {
			store.clientKey = key;
		},
		"ClientKeyBridge.getClientKey": () => store.clientKey ?? "",
		"ClientKeyBridge.clearClientKey": () => {
			delete store.clientKey;
		},
		"ServerEncKeySaltBridge.setServerEncKeySalt": (salt) => {
			store.salt = salt;
		},
		"ServerEncKeySaltBridge.getServerEncKeySalt": () => store.salt ?? null,
		"SystemIntegrationsBridge.showMessageNotification": (
			key,
			_tag,
			title,
			body,
			icon,
			...rest
		) => {
			const suppressBanner = rest[5];
			if (!suppressBanner)
				constantsReady.then(
					() =>
						new NotificationServer(title, {
							body,
							icon,
							tag: key,
							silent: false,
						}),
				);
		},
		"SystemIntegrationsBridge.closeMessageNotification": (key) =>
			sendWhenReady("closeRendererNotification", key),
		"SystemIntegrationsBridge.closeMessageNotifications": (keys) => {
			for (const key of keys) sendWhenReady("closeRendererNotification", key);
		},
		"SystemIntegrationsBridge.isNotificationEnabledInSystem": () => true,
		"SystemIntegrationsBridge.updateTaskbarBadge": (count) =>
			sendWhenReady("updateUnreadMessages", { unread: Number(count) || 0 }),
		"SystemIntegrationsBridge.getStartupTaskState": () =>
			constantsReady.then(() =>
				ipcRenderer.invoke(Constants.event.getStartAtLogin),
			),
		"SystemIntegrationsBridge.updateStartupTask": (enabled) =>
			sendWhenReady("setStartAtLogin", !!enabled),
		"NativeAppStateBridge.bringMainWindowToForeground": () =>
			sendWhenReady("showWindow"),
	};
	const hostObject = (path, sync) =>
		new Proxy(function () {}, {
			get(_target, prop) {
				if (prop === "then" || typeof prop === "symbol") return undefined;
				if (prop === "addEventListener" || prop === "removeEventListener") {
					const object = path.replace(/^sync\./, "").split(".")[0];
					return (event, listener) => {
						const key = `${object}.${event}`;
						if (!bridgeListeners.has(key)) bridgeListeners.set(key, new Set());
						if (prop === "removeEventListener") {
							bridgeListeners.get(key).delete(listener);
							return;
						}
						bridgeListeners.get(key).add(listener);
						const pending = pendingBridgeEvents.get(key) ?? [];
						pendingBridgeEvents.delete(key);
						for (const payload of pending) listener(payload);
					};
				}
				return hostObject(`${path}.${prop}`, sync);
			},
			apply(_target, _this, args) {
				const value = special[path.split(".").slice(-2).join(".")]?.(...args);
				return sync ? value : Promise.resolve(value);
			},
		});
	const hostObjects = new Proxy(
		{ options: {} },
		{
			get(target, prop) {
				if (prop === "options") return target.options;
				if (prop === "then" || typeof prop === "symbol") return undefined;
				if (prop === "sync") return hostObject("sync", true);
				return hostObject(prop, false);
			},
		},
	);
	window.chrome = window.chrome || {};
	window.chrome.webview = {
		hostObjects,
		postMessage() {},
		addEventListener() {},
		removeEventListener() {},
	};
}

const TOP_BAR =
	'[data-testid="wa-web-main-screen"] > div:has(> [data-testid="wa-logo"])';

const syncTitleBar = () => {
	if (!document.getElementById("whatsapp-title-bar-style")) {
		const style = document.createElement("style");
		style.id = "whatsapp-title-bar-style";
		style.textContent = `${TOP_BAR} { -webkit-app-region: drag; }`;
		document.documentElement.append(style);
	}
	let last;
	let lastTheme = "";
	let lastTray;
	setInterval(() => {
		try {
			const prefs = self.require("WAWebUserPrefsGeneral");
			const theme = prefs.getSystemThemeMode() ? "system" : prefs.getTheme();
			if (theme && theme !== lastTheme) {
				lastTheme = theme;
				ipcRenderer.send(Constants.event.themePreference, theme);
			}
			const tray = self
				.require("WAWebWindowsUserPrefsSystemTray")
				.IsSystemTrayEnabled();
			if (tray !== lastTray) {
				lastTray = tray;
				ipcRenderer.send(Constants.event.minimizeToTray, tray);
			}
		} catch (e) {}

		const bar = document.querySelector(TOP_BAR);
		if (!bar) return;
		const covered = !bar.contains(document.elementFromPoint(innerWidth - 1, 1));
		// Bar height over WhatsApp's bar, display-scale-corrected over anything covering it
		const height = Math.round(
			bar.getBoundingClientRect().height / (covered ? devicePixelRatio : 1),
		);
		if (height === last) return;
		last = height;
		ipcRenderer.send(Constants.event.titleBarOverlay, { height });
	}, 250);
};

// Replaces a web-mode service worker with a windows-mode one, once per session
const resetWebServiceWorker = async () => {
	if (location.hostname !== "web.whatsapp.com") return;
	const regs = (await navigator.serviceWorker?.getRegistrations()) ?? [];
	const webMode = regs.some(
		(r) => r.active && !r.active.scriptURL.includes("windows=1"),
	);
	if (!webMode || sessionStorage.getItem("whatsapp-sw-reset")) return;
	sessionStorage.setItem("whatsapp-sw-reset", "1");
	await Promise.all(regs.map((r) => r.unregister()));
	location.replace(Constants.whatsapp.appUrl);
};

// Paths lifted verbatim from WhatsApp Web's WAWebDefaultGroupIcon.react /
// WAWebDefaultUserIcon.react. In-page they render as components with the fill
// from CSS vars, so there's no URL to point at — inlined here with the colours
// resolved (#DFE5E7 disc, white figure).
const AVATAR_BG =
	"M105.95.25C164.32.25 211.64 47.6 211.64 106s-47.32 105.75-105.7 105.75C47.57 211.75.25 164.4.25 106S47.57.25 105.95.25Z";
const AVATAR_GROUP =
	"M102.28 77.29c0 10.67-8.42 19.28-18.94 19.28-10.51 0-19-8.61-19-19.28 0-10.68 8.49-19.29 19-19.29 10.52 0 18.94 8.61 18.94 19.29Zm48.07 2.85c0 9.8-7.74 17.72-17.4 17.72a17.56 17.56 0 0 1-17.45-17.72c0-9.8 7.8-17.71 17.45-17.71 9.66 0 17.4 7.91 17.4 17.71Zm-67.01 29.29c-14.76 0-44.34 7.52-44.34 22.5v11.78c0 3.54 2.85 4.29 6.33 4.29h76.02c3.48 0 6.33-.75 6.33-4.29v-11.78c0-14.98-29.58-22.5-44.34-22.5Zm43.46 1.42 2.2.04c14.76 0 45 6.06 45 21.04v9.64a6.4 6.4 0 0 1-6.33 6.43h-32.82c.7-2 1.15-4.18 1.15-6.43l-.25-10.5c0-9.56-5.61-13.21-11.59-17.1a84.1 84.1 0 0 1-4.22-2.9.6.6 0 0 0-.2-.18c1.6-.14 4.75-.08 7.06-.04Z";
const AVATAR_USER =
	"M173.56 171.62a62.77 62.77 0 0 0-4.67-6.26 70.11 70.11 0 0 0-9.11-9 72.46 72.46 0 0 0-16.18-10.08l-.18-.08c-9.8-4.44-22.11-7.53-37.42-7.53s-27.62 3.09-37.42 7.53l-.98.47a75.37 75.37 0 0 0-6.23 3.3 72.59 72.59 0 0 0-15.07 11.86 70.06 70.06 0 0 0-7.86 9.78 63.2 63.2 0 0 0-1.45 2.33l-.1.17c-.44.75-.8 1.4-1.07 1.93-.56 1.07-.82 1.68-.82 1.68v.4a101.01 101.01 0 0 0 70.94 28.98c27.68 0 52.77-11.1 71.06-29.1v-.29s-.62-1.45-2-3.77c-.4-.7-.88-1.48-1.44-2.32zM106 125.5a39.87 39.87 0 0 0 11.3-1.63 37.12 37.12 0 0 0 11.28-5.63 35.92 35.92 0 0 0 11.9-15.32 37.05 37.05 0 0 0 2.45-8.95 40.28 40.28 0 0 0-1.22-17.12 37.05 37.05 0 0 0-5.63-11.27 35.92 35.92 0 0 0-13.65-11.18 37.12 37.12 0 0 0-8.75-2.85 39.87 39.87 0 0 0-7.68-.74c-21.16 0-37.34 16.19-37.34 37.35S84.84 125.5 106 125.5z";

const defaultAvatar = (isGroup) =>
	"data:image/svg+xml;charset=utf-8," +
	encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" width="212" height="212" viewBox="0 0 212 212">` +
			`<path fill="#DFE5E7" d="${AVATAR_BG}"/>` +
			`<path fill="#FFFFFF" fill-rule="evenodd" clip-rule="evenodd" d="${isGroup ? AVATAR_GROUP : AVATAR_USER}"/>` +
			`</svg>`,
	);

class WhatsAppInstance {
	constructor(id, name) {
		// self
		this.id = id;
		this.name = name;
		this.lastUnread = 0;
		this.initialNotificationsFired = false;

		// Module Raid
		this.mrid = null;
		this.mrobj = {};
		this.chatModule = null;

		// Mutation Oberver
		// ponytail: countUnread() scans every <span> in the document, so running it
		// per mutation record made scrolling crawl. Coalesce to one idle run per batch.
		let unreadScheduled = false;
		this.observer = new MutationObserver((mutations) => {
			if (!unreadScheduled) {
				unreadScheduled = true;
				requestIdleCallback(
					() => {
						unreadScheduled = false;
						this.countUnread();
					},
					{ timeout: 1000 },
				);
			}

			if (this.mrid != null) return;
			for (const mutation of mutations) {
				if (
					typeof mutation.target.ariaLabel === "string" &&
					mutation.target.ariaLabel.search(Constants.whatsapp.profilePicture) !=
						-1
				) {
					this.loadModuleRaid();
					break;
				}
			}
		});

		// ponytail: unread badges only live in the chat list, so watch that instead of
		// document.body -- otherwise every node the virtualised message list churns
		// while scrolling allocates a MutationRecord. Retarget once the pane mounts;
		// loadModuleRaid() has its own 3s poll, so nothing is lost in the meantime.
		const observeUnread = () => {
			const paneSide = document.getElementById("pane-side");
			this.observer.disconnect();
			this.observer.observe(paneSide || document.body, {
				characterData: true,
				childList: true,
				subtree: true,
			});
			return !!paneSide;
		};

		setTimeout(() => {
			console.log("Starting Mutation Observer...");
			if (observeUnread()) return;
			console.log("No #pane-side yet, watching document.body for now...");
			const retarget = setInterval(() => {
				if (observeUnread()) {
					clearInterval(retarget);
					console.log("Unread observer scoped to #pane-side.");
				}
			}, 2000);
		}, 1000);

		// Periodic check for moduleRaid
		const moduleCheckInterval = setInterval(() => {
			if (this.mrid != null && Object.keys(this.mrobj).length > 0) {
				clearInterval(moduleCheckInterval);
				return;
			}
			this.loadModuleRaid();
		}, 3000);

		// Events
		ipcRenderer.on(Constants.event.fireNotificationClick, (event, tag) => {
			//console.log("Received Notification Click from Main...", tag);
			// On a cold D-Bus activation the click lands long before the SPA is up
			whatsappReady.then(() =>
				new RegExp(Constants.whatsapp.messageKeyPattern).test(String(tag))
					? emitBridgeEvent(
							"SystemIntegrationsBridge",
							"MessageNotificationActionEvent",
							{ action: "Click", tag, additionalData: "" },
						)
					: this.openChat(tag),
			);
		});

		ipcRenderer.on(Constants.event.buildBadgeIcon, (event, data) => {
			console.log("Building badge icon...", data);
			const img = new Image();
			img.onload = () => {
				const canvas = document.createElement("canvas");
				const ctx = canvas.getContext("2d");
				canvas.width = img.width;
				canvas.height = img.height;

				ctx.drawImage(img, 0, 0, img.width, img.height);

				const centerX = canvas.width * 0.75 - 2;
				const centerY = canvas.height * 0.25 + 2;
				const radius = 128;

				ctx.beginPath();
				ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI, false);
				ctx.fillStyle = "#ff3333";
				ctx.fill();
				ctx.lineWidth = 2;
				ctx.strokeStyle = "#003300";
				ctx.stroke();

				const dataUrl = canvas.toDataURL("image/png");
				ipcRenderer.send(Constants.event.updateBadgeIcon, dataUrl);
			};
			img.onerror = (err) => {
				console.error("Failed to load badge icon:", err);
			};
			img.src = data.iconDataUrl;
		});
	}

	getId() {
		return this.id;
	}

	loadModuleRaid() {
		if (this.mrid != null && Object.keys(this.mrobj).length > 0) return;

		console.log("Loading Module Raid...");
		this.chatModule = null;

		if (
			window.Debug &&
			window.Debug.VERSION &&
			parseFloat(window.Debug.VERSION) < 2.3
		) {
			this.mrid = Math.random().toString(36).substring(7);
			window.webpackChunkwhatsapp_web_client.push([
				[this.mrid],
				{},
				(e) => {
					Object.keys(e.m).forEach((mod) => {
						this.mrobj[mod] = e(mod);
					});
				},
			]);
		} else {
			try {
				const debugModule = self.require("__debug");
				if (!debugModule || !debugModule.modulesMap) return;

				this.mrid = Math.random().toString(36).substring(7);
				var _wai = this;
				let modules = debugModule.modulesMap;
				Object.keys(modules)
					.filter((e) => e.includes("WA"))
					.forEach(function (mod) {
						let modulos = modules[mod];
						if (modulos) {
							_wai.mrobj[mod] = {
								default: modulos.defaultExport,
								factory: modulos.factory,
								...modulos,
							};
							if (
								_wai.mrobj[mod].default &&
								Object.keys(_wai.mrobj[mod].default).length == 0
							) {
								try {
									self.ErrorGuard.skipGuardGlobal(true);
									Object.assign(_wai.mrobj[mod], self.importNamespace(mod));
								} catch (e) {}
							}
						}
					});
			} catch (e) {
				// Module not ready yet
			}
		}
	}

	findModule(query) {
		let results = [];
		let modules = Object.keys(this.mrobj);
		modules.forEach((mKey) => {
			let mod = this.mrobj[mKey];
			if (typeof mod !== "undefined") {
				if (typeof query === "string") {
					if (typeof mod.default === "object") {
						for (const key in mod.default) {
							if (key == query) results.push(mod);
						}
					}
					for (const key in mod) {
						if (key == query) results.push(mod);
					}
				} else if (typeof query === "function") {
					if (query(mod)) {
						results.push(mod);
					}
				} else {
					throw new TypeError(
						"findModule can only find via string and function, " +
							typeof query +
							" was passed",
					);
				}
			}
		});
		return results;
	}

	async openChat(tag) {
		//console.log("openChat tag", tag);

		// ponytail: named requires instead of scanning 12k modules for a "Cmd" key --
		// the scan can land on a stale duplicate that swallows the trigger silently
		let chat;
		try {
			const { createWid } = self.require("WAWebWidFactory");
			const { ChatCollection } = self.require("WAWebChatCollection");
			const { Cmd } = self.require("WAWebCmd");

			chat = await ChatCollection.find(createWid(tag));
			if (!chat) throw new Error(`no chat for tag ${tag}`);

			// ponytail: NOT awaited -- openChatFromUnread never resolves in current
			// WhatsApp builds, which used to stall the DOM click below forever
			const open =
				chat.unreadCount > 0
					? Cmd.openChatFromUnread({ chat })
					: Cmd.openChatBottom({ chat });
			Promise.resolve(open).catch((e) => console.error("openChat: Cmd", e));
		} catch (e) {
			// ponytail: WhatsApp renames/removes these modules regularly; log loudly and
			// fall through to the DOM click, which is what actually opens the chat anyway.
			console.error("openChat: Cmd path failed", e);
		}

		// ponytail: the Cmd only focuses the row in current WhatsApp builds, so click it.
		// Matches on the visible title; the chat list is virtualised, so this only works
		// for rows currently rendered -- fine for notifications, which are recent chats.
		setTimeout(() => this.clickChatRow(chat?.formattedTitle), 100);
	}

	clickChatRow(title) {
		if (!title) return;
		const rows = document.querySelectorAll(
			'#pane-side [role="row"], #pane-side [role="listitem"]',
		);
		const row = [...rows].find(
			(r) => r.querySelector("span[title]")?.title === title,
		);
		if (!row) console.warn("clickChatRow: no visible row for", title);
		const target =
			row?.querySelector('[data-testid="cell-frame-container"]') || row;
		if (!target) return;

		for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) {
			target.dispatchEvent(
				new MouseEvent(type, { bubbles: true, cancelable: true, view: window }),
			);
		}
	}

	async fireInitialUnreadNotifications(unreadChats) {
		const { ProfilePicThumbCollection } = self.require(
			"WAWebProfilePicThumbCollection",
		);

		for (const chat of unreadChats) {
			const n = chat.unreadCount;
			const lastBody = n === 1 ? chat.msgs?.last?.()?.body : null;

			let icon;
			try {
				const pic = await ProfilePicThumbCollection.find(chat.id);
				// NotificationServer circles the icon and draws the border
				icon = pic?.eurl || pic?.imgFull || pic?.img;
			} catch (e) {
				// no picture set, or not synced yet
			}

			new NotificationServer(chat.formattedTitle || "WhatsApp", {
				body: lastBody || `${n} unread message${n > 1 ? "s" : ""}`,
				// chat.isGroup isn't on the internal model; the jid suffix always is
				icon:
					icon ||
					defaultAvatar(
						String(chat.id?._serialized || chat.id).endsWith("@g.us"),
					),
				tag: chat.id._serialized || chat.id,
				silent: true,
				lowPriority: true,
			});
		}
	}

	countUnread() {
		if (!this.mrobj || Object.keys(this.mrobj).length === 0) return;
		let unreadTags;
		try {
			// ponytail: findModule() is a linear scan over every webpack module in
			// WhatsApp Web, so cache the hit instead of redoing it on every count.
			if (!this.chatModule)
				this.chatModule = this.findModule((m) => m.default && m.default.Chat)[0];
			if (!this.chatModule) return;
			const unreadChats = this.chatModule.default.Chat.getModelsArray().filter(
				(c) => c.unreadCount > 0,
			);
			unreadTags = unreadChats.map((c) => c.id._serialized || c.id);

			if (!this.initialNotificationsFired && unreadTags.length > 0) {
				this.fireInitialUnreadNotifications(unreadChats);
				this.initialNotificationsFired = true;
			}
		} catch (e) {
			return;
		}

		const key = unreadTags.join(",");
		if (this.lastUnread === key) return;
		this.lastUnread = key;
		ipcRenderer.send(Constants.event.updateUnreadMessages, {
			id: this.id,
			unreadTags,
		});
	}
}

class NotificationServer {
	constructor(title, options) {
		//console.log("New NotificationServer...", title, options);
		this.options = options;
		this._processOptions(title, options);
	}

	async _processOptions(title, options) {
		if (options.icon) {
			options.icon = options.icon
				.replace(Constants.whatsapp.url, "")
				.replace("%3F", "?");
		}
		// WhatsApp's cached thumb URLs carry an oe= expiry and are routinely
		// dead on a cold start, which is when the unread-summary notifications
		// fire. Refetch from the server before settling for a grey default.
		let icon = await this._getIcon(options.icon);
		if (options.icon && !icon && options.tag) {
			icon = await this._refreshedIcon(options.tag);
		}
		if (options.icon && !icon) {
			icon = await this._getIcon(
				defaultAvatar(String(options.tag || "").endsWith("@g.us")),
			);
		}
		const serverNotification = JSON.parse(
			JSON.stringify({
				id: wa?.getId(),
				title: title,
				options: options,
				icon: icon,
			}),
		);
		ipcRenderer.send(
			Constants.event.newRendererNotification,
			serverNotification,
		);
	}

	// find() re-requests a model that has been marked stale, which is the only
	// way back to a working URL once the cached one has expired.
	async _refreshedIcon(tag) {
		try {
			const { ProfilePicThumbCollection } = self.require(
				"WAWebProfilePicThumbCollection",
			);
			const { createWid } = self.require("WAWebWidFactory");
			const id = createWid(tag);
			(await ProfilePicThumbCollection.find(id))?.markStale?.();
			const pic = await ProfilePicThumbCollection.find(id);
			return await this._getIcon(pic?.eurl || pic?.imgFull || pic?.img);
		} catch (e) {
			return undefined;
		}
	}

	_getIcon(icon) {
		if (!icon) return;

		return new Promise((resolve) => {
			fetch(icon)
				.then((r) => (r.ok ? r.blob() : Promise.reject(new Error(r.status))))
				.then((blob) => {
					const reader = new FileReader();
					reader.onload = (event) => {
						const img = new Image();
						img.onload = () => {
							const scale = 2;
							const size = scale * Math.max(img.width, img.height);
							const canvas = document.createElement("canvas");
							canvas.width = size;
							canvas.height = size;
							const ctx = canvas.getContext("2d");

							// Enable high quality image smoothing
							ctx.imageSmoothingEnabled = true;
							ctx.imageSmoothingQuality = "high";

							// Draw 1px circular border, no background
							const borderWidth = scale * 2; // scale border width
							ctx.beginPath();
							ctx.arc(
								size / 2,
								size / 2,
								size / 2 - borderWidth / 2,
								0,
								2 * Math.PI,
							);
							ctx.lineWidth = borderWidth;
							const isDarkMode = window.matchMedia(
								"(prefers-color-scheme: dark)",
							).matches;
							ctx.strokeStyle = isDarkMode
								? "rgba(255, 255, 255, 0.1)"
								: "rgba(0, 0, 0, 0.1)";
							ctx.stroke();

							// Draw circular mask for icon
							ctx.save();
							ctx.beginPath();
							ctx.arc(
								size / 2,
								size / 2,
								size / 2 - borderWidth,
								0,
								2 * Math.PI,
							);
							ctx.closePath();
							ctx.clip();

							// Draw the image centered and scaled
							const x = (size - scale * img.width) / 2;
							const y = (size - scale * img.height) / 2;
							ctx.drawImage(img, x, y, scale * img.width, scale * img.height);

							ctx.restore();

							// Downscale for output. The cap matters: inside flatpak
							// libnotify goes through the XDG notification portal, which
							// silently drops icons the size a full-res avatar produces
							// (~600KB PNG). Unsandboxed builds talk to
							// org.freedesktop.Notifications directly and never hit it.
							// No shell renders a notification icon above 128px anyway.
							const outputSize = Math.min(size / scale, 128);
							const outputCanvas = document.createElement("canvas");
							outputCanvas.width = outputSize;
							outputCanvas.height = outputSize;
							const outputCtx = outputCanvas.getContext("2d");
							outputCtx.drawImage(
								canvas,
								0,
								0,
								outputCanvas.width,
								outputCanvas.height,
							);

							resolve(outputCanvas.toDataURL("image/png"));
						};
						img.onerror = () => {
							// fallback to original data URL if image fails to load
							resolve(event.target.result);
						};
						img.src = event.target.result;
					};
					reader.readAsDataURL(blob);
				})
				// A broken icon must not take the notification down with it:
				// _processOptions awaits this before handing off to the main
				// process, so resolve undefined and fire without an avatar.
				.catch(() => resolve(undefined));
		});
	}

	// wrapper compatibility
	static permission = "granted";
	static maxActions = 3;
	static requestPermission(callback) {
		return new Promise((resolve, reject) => {
			if (typeof callback === "function") {
				callback("granted");
			}
			resolve("granted");
		});
	}

	close() {
		if (this.options && this.options.tag) {
			ipcRenderer.send(
				Constants.event.closeRendererNotification,
				this.options.tag,
			);
		}
	}
}

// Events
let Constants = {};
let wa = null;

// Swap in the notification wrapper at preload time, not when the main process
// finishes the init-whatsapp-instance round-trip: WhatsApp Web can fire its
// first notifications before that IPC lands, and those arrive with no avatar
// and no tag. Slow cold starts (flatpak sandbox, cold cache) hit this every
// launch; a warm AppImage start almost never does.
window.oldNotification = Notification;
window.Notification = NotificationServer;
console.log("Window Notifications Object Replaced by NotificationServer...");
ipcRenderer.on("init-whatsapp-instance", (event, data) => {
	console.log(`BrowserView ID: ${data.id} / Name: ${data.name}`);
	console.log("Received constants:", data.constants);
	Constants = data.constants;
	console.log("Constants set:", Constants);
	constantsLoaded();

	syncTitleBar();
	resetWebServiceWorker();
	ipcRenderer.on(Constants.event.bridgeEvent, (_event, object, name, payload) =>
		emitBridgeEvent(object, name, payload),
	);

	// Check if WhatsApp is showing the browser-outdated screen.
	// The exact DOM varies between builds, so inspect the visible page text
	// instead of relying on a single class name.
	const pageText = [
		document.title,
		document.body?.innerText || "",
		document.querySelector(".landing-title")?.textContent || "",
	]
		.filter(Boolean)
		.join(" ");
	const isUpdate = /Google Chrome/i.test(pageText);

	if (isUpdate) {
		console.warn("Page requested chrome update...");

		navigator.serviceWorker.getRegistrations().then((regs) => {
			console.log("Unregistering ServiceWorkers...");

			for (const reg of regs) reg.unregister();

			if ("serviceWorker" in navigator) {
				caches.keys().then(function (cacheNames) {
					cacheNames.forEach(function (cacheName) {
						console.log("Clearing Cache Key: ", cacheName);
						caches.delete(cacheName);
					});
				});
			}

			console.log("Requesting reload to main process...");
			setTimeout(() => {
				ipcRenderer.send(Constants.event.clearWorkersAndReload, data.id);
			}, 1000);
		});
	} else {
		console.log(`Starting new WhatsAppInstance...`);
		wa = new WhatsAppInstance(data.id, data.name);
		window.wa = wa;

		// Flag to prevent double initialization
		let uiInitialized = false;

		// Function to initialize UI when WhatsApp is fully loaded
		const initializeUI = () => {
			if (uiInitialized) {
				console.log("UI already initialized, skipping...");
				return;
			}
			uiInitialized = true;
			console.log("WhatsApp loaded, initializing UI...");
			whatsappLoaded();
		};

		// Wait for WhatsApp to load by detecting when the sidebar header appears
		const waitForWhatsApp = () => {
			const chatElement = document.querySelector('[aria-label="Chats"]');
			const sidebarHeader =
				chatElement?.parentElement?.parentElement?.parentElement?.parentElement;

			if (sidebarHeader) {
				console.log("WhatsApp sidebar detected!");
				initializeUI();
			} else {
				// WhatsApp not loaded yet, use MutationObserver
				console.log("Waiting for WhatsApp to load...");
				const observer = new MutationObserver((mutations, obs) => {
					const chatElement = document.querySelector('[aria-label="Chats"]');
					const sidebar =
						chatElement?.parentElement?.parentElement?.parentElement
							?.parentElement;

					if (sidebar) {
						console.log("WhatsApp loaded via MutationObserver!");
						obs.disconnect();
						initializeUI();
					}
				});

				observer.observe(document.body, {
					childList: true,
					subtree: true,
				});

				// Fallback timeout in case the observer doesn't catch it
				setTimeout(() => {
					console.log("Fallback timeout reached, initializing anyway...");
					observer.disconnect();
					initializeUI();
				}, 5000);
			}
		};

		// Start waiting for WhatsApp after a short delay to let the page start loading
		setTimeout(waitForWhatsApp, 500);
	}
});
