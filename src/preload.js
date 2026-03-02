const { ipcRenderer } = require("electron");

ipcRenderer.on("poll-refresh", () => {
	window.dispatchEvent(new CustomEvent("poll-refresh"));
});

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

		// Notification Wrapper
		window.oldNotification = Notification;
		window.Notification = NotificationServer;
		console.log(
			"Window Notifications Object Replaced by NotificationServer...",
		);

		// Mutation Oberver
		this.observer = new MutationObserver((mutations) => {
			mutations.forEach((mutation) => {
				this.countUnread();

				if (this.mrid == null) {
					if (typeof mutation.target.ariaLabel === "string") {
						if (
							mutation.target.ariaLabel.search(
								Constants.whatsapp.profilePicture,
							) != -1
						)
							this.loadModuleRaid();
					}
				}
			});
		});

		setTimeout(() => {
			console.log("Starting Mutation Observer...");
			this.observer.observe(document.body, {
				characterData: true,
				childList: true,
				subtree: true,
			});
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
			this.openChat(tag);
		});

		ipcRenderer.on(Constants.event.contextMenuInvoked, (_event, params) => {
			const el = document.elementFromPoint(params.x, params.y);
			let node = el;
			const isMessage = (() => {
				while (node) {
					if (
						node.classList &&
						(node.classList.contains("message-out") ||
							node.classList.contains("message-in"))
					) {
						return true;
					}
					node = node.parentElement;
				}
				return false;
			})();
			if (isMessage) {
				const chevronIcon = node.querySelector(
					'span[data-icon="ic-chevron-down-menu"]',
				);
				const button = chevronIcon.parentElement;
				button.click();
			} else {
				ipcRenderer.send(Constants.event.openContextMenu, params);
			}
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

		let chatWid = this.findModule("createWid")[0].createWid(tag);
		//console.log("openChat chatWid", chatWid);

		let chat = await this.findModule(
			(m) => m.default && m.default.Chat,
		)[0].default.Chat.find(chatWid);
		//console.log("openChat chat", chat);

		/* To Debug on Browser
		let chatWid = wa.findModule('createWid')[0].createWid(tag);
		let chat    = await wa.findModule(m => m.default && m.default.Chat)[0].default.Chat.find(chatWid);
		await wa.findModule("Cmd")[0].Cmd.openChatBottom(chat);
		*/

		//await this.findModule("Cmd")[0].Cmd.openChatBottom(chat);
		await this.findModule("Cmd")[0].Cmd.openChatBottom({ chat: chat });
	}

	fireInitialUnreadNotifications(unreadChats) {
		const totalUnread = unreadChats.reduce((acc, c) => acc + c.unreadCount, 0);
		if (totalUnread === 0) return;

		const title = "WhatsApp";
		const body = `You have ${totalUnread} unread message${totalUnread > 1 ? "s" : ""} in ${unreadChats.length} chat${unreadChats.length > 1 ? "s" : ""}.`;

		new NotificationServer(title, {
			body: body,
			tag: "initial-unread",
			silent: true,
		});
	}

	countUnread() {
		let unread = 0;
		let chats = 0;
		let unreadTags = [];
		const itens = document.getElementsByTagName("span");
		for (const item of itens) {
			if (item.hasAttributes()) {
				for (const attr of item.attributes) {
					if (
						attr.name == "aria-label" &&
						(attr.value == Constants.whatsapp.unreadText ||
							attr.value.search(Constants.whatsapp.unreadTextSearch) != -1)
					) {
						const count = parseInt(item.innerText);
						if (!isNaN(count)) {
							unread += count;
							chats += 1;

							// Try to find the tag (chat ID) from the parent elements
							let parent = item.parentElement;
							while (parent && parent !== document.body) {
								if (
									parent.dataset &&
									parent.dataset.testid === "cell-frame-container"
								) {
									// This is likely the chat item. We can't easily get the ID from here without moduleRaid
									// But wait, if we have moduleRaid, we can use it.
									break;
								}
								parent = parent.parentElement;
							}
						}
					}
				}
			}
		}

		if (this.mrobj && Object.keys(this.mrobj).length > 0) {
			try {
				const ChatModule = this.findModule(
					(m) => m.default && m.default.Chat,
				)[0];
				if (ChatModule) {
					const chats = ChatModule.default.Chat.getModelsArray();
					unreadTags = chats
						.filter((c) => c.unreadCount > 0)
						.map((c) => c.id._serialized || c.id);

					if (
						!this.initialNotificationsFired &&
						unreadTags.length > 0 &&
						process.env.WHATSAPP_BACKGROUND === "1"
					) {
						this.fireInitialUnreadNotifications(
							chats.filter((c) => c.unreadCount > 0),
						);
						this.initialNotificationsFired = true;
					}
				}
			} catch (e) {
				// console.error("Error getting unread tags:", e);
			}
		}

		if (this.lastUnread != unread) {
			this.lastUnread = unread;
			chats = chats > 0 ? chats - 1 : chats;

			ipcRenderer.send(Constants.event.updateUnreadMessages, {
				id: this.id,
				unread: unread - chats,
				unreadTags: unreadTags,
			});
		}
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
		const serverNotification = JSON.parse(
			JSON.stringify({
				id: wa.getId(),
				title: title,
				options: options,
				icon: await this._getIcon(options.icon),
			}),
		);
		ipcRenderer.send(
			Constants.event.newRendererNotification,
			serverNotification,
		);
	}

	_getIcon(icon) {
		if (!icon) return;

		return new Promise((resolve, reject) => {
			fetch(icon)
				.then((r) => r.blob())
				.catch(reject)
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

							// Downscale for output
							const outputCanvas = document.createElement("canvas");
							outputCanvas.width = size / scale;
							outputCanvas.height = size / scale;
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
				});
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

ipcRenderer.on("init-whatsapp-instance", (event, data) => {
	console.log(`BrowserView ID: ${data.id} / Name: ${data.name}`);
	console.log("Received constants:", data.constants);
	Constants = data.constants;
	console.log("Constants set:", Constants);

	// Check if whatsapp is calling google update
	const titleEl = document.querySelector(".landing-title");
	const isUpdate = titleEl && titleEl.innerHTML.includes("Google Chrome");

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

		const isWindows = process.platform === "win32";
		const isHyprland = data.isHyprland;
		// Generate CSS styles
		const generateStyles = () => {
			const border = !isWindows && !isHyprland ? 1 : 0;

			return `
				body {
					-webkit-app-region: drag;
					background-color: var(--WDS-surface-emphasized) !important;
				}
				
				body * {
					-webkit-app-region: no-drag !important;
				}
			
				#app,
				.overlay,
				[data-animate-modal-backdrop="true"] {
					height: calc(100% - 30px);
					margin-top: 30px;
				}
			`;
		};

		const style = document.createElement("style");
		style.id = "whatsapp-electron-style";
		style.textContent = generateStyles();
		document.head.appendChild(style);

		window.ipcRenderer = require("electron").ipcRenderer;

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

			// Add mutation observer to ensure dynamically added elements get border-radius
			const borderObserver = new MutationObserver((mutations) => {
				mutations.forEach((mutation) => {
					mutation.addedNodes.forEach((node) => {
						if (node.nodeType === 1 && node.parentElement === document.body) {
							// Apply border-radius to top-level elements added to body
							if (!isWindows && !isHyprland) {
								node.style.borderRadius = "16px";
								node.style.overflow = "hidden";
							}
						}
					});
				});
			});

			borderObserver.observe(document.body, {
				childList: true,
				subtree: false,
			});
		};

		// Wait for WhatsApp to load by detecting when the sidebar header appears
		const waitForWhatsApp = () => {
			const sidebarHeader = document.querySelector(
				'[class="x1c4vz4f xs83m0k xdl72j9 x1g77sc7 x78zum5 xozqiw3 x1oa3qoh x12fk4p8 xeuugli x2lwn1j x1nhvcw1 xdt5ytf x1cy8zhl x1277o0a"]',
			);

			if (sidebarHeader) {
				console.log("WhatsApp sidebar detected!");
				initializeUI();
			} else {
				// WhatsApp not loaded yet, use MutationObserver
				console.log("Waiting for WhatsApp to load...");
				const observer = new MutationObserver((mutations, obs) => {
					const sidebar = document.querySelector(
						'[class="x1c4vz4f xs83m0k xdl72j9 x1g77sc7 x78zum5 xozqiw3 x1oa3qoh x12fk4p8 xeuugli x2lwn1j x1nhvcw1 xdt5ytf x1cy8zhl x1277o0a"]',
					);

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
