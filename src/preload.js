const { ipcRenderer } = require("electron");

ipcRenderer.on("poll-refresh", () => {
	window.dispatchEvent(new CustomEvent("poll-refresh"));
});

let windowIsFocused = true;

const applyWindowControlsFocusFilter = () => {
	const controls = document.getElementById("electron-window-controls");
	if (!controls) return;

	const filter = windowIsFocused ? "" : "opacity(0.5)";
	controls.querySelectorAll(":scope svg").forEach((button) => {
		button.style.filter = filter;
	});
	const closeButton = controls.firstElementChild;
	if (closeButton) {
		closeButton.style.backdropFilter = windowIsFocused
			? "brightness(0) saturate(100%) invert(10%) sepia(100%) saturate(7476%) hue-rotate(3deg) brightness(101%) contrast(109%) opacity(0.4)"
			: "";
	}
};

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
const maximizeButtonSVG =
	'<path fill="currentColor" d="M19 5v14H5V5h14m0-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z"></path>';
const restoreButtonSVG =
	'<path fill="currentColor" d="M16.608 7.392v12.215H4.392V7.392h12.215m0-1.745H4.392c-.964 0-1.745.781-1.745 1.745v12.215c0 .463.184.907.511 1.234s.771.511 1.234.511h12.215c.463 0 .907-.184 1.234-.511s.511-.771.511-1.234V7.392c0-.463-.184-.907-.511-1.234s-.771-.511-1.234-.511zM5.647 4.392h13.961v13.961h.091c.913 0 1.654-.741 1.654-1.654V4.392c0-.964-.781-1.745-1.745-1.745h0H7.155a1.51 1.51 0 0 0-1.508 1.508z"/>';
ipcRenderer.on("init-whatsapp-instance", (event, data) => {
	console.log(`BrowserView ID: ${data.id} / Name: ${data.name}`);
	console.log("Received constants:", data.constants);
	Constants = data.constants;
	console.log("Constants set:", Constants);

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

		const isWindows = process.platform === "win32";
		const isHyprland = data.isHyprland;
		let isMaximized = false;

		// Generate CSS based on maximize state
		const generateStyles = (maximized) => {
			const border = !isWindows && !maximized && !isHyprland ? 1 : 0;

			return `
				/* Make all headers draggable */
				header[tabindex="0"] {
					-webkit-app-region: drag !important;
					z-index: 600 !important;
				}

				.overlay,
				[data-animate-modal-backdrop="true"] {
					width: calc(100% - ${65 + 2 * border}px) !important;
					left: ${65 + border}px !important;
					height: calc(100% - ${2 * border}px) !important;
					top: ${border}px !important;
				}

				header button, [role="button"] {
					-webkit-app-region: no-drag !important;
				}

				.electron-window-controls-button::before {
					content: "";
					transform: scale(0.8);
					border-radius: 50%;
					background: transparent;
					position: absolute;
					width: 32px;
					height: 32px;
					z-index: -1;
					transition: transform 50ms ease-in-out;
				}

				.electron-window-controls-button:hover::before {
					background: var(--WDS-components-active-list-row);
					transform: scale(1);
				}


				#electron-window-controls {
					cursor: default;
					margin-bottom: 8px;
					margin-top: 4px;
					gap: 6px;
					display:flex;
					flex-direction:column;
					-webkit-app-region: no-drag;
					align-items: center;
					justify-content: center;
					width: 40px;
				}

				#app {
					box-sizing: border-box !important;
					border: ${border}px solid #0005;
					@media (prefers-color-scheme: dark) {
						border: ${border}px solid #fff2;
					}
				}
			`;
		};

		const style = document.createElement("style");
		style.id = "whatsapp-electron-style";
		style.textContent = generateStyles(false);
		document.head.appendChild(style);

		window.ipcRenderer = require("electron").ipcRenderer;

		// Function to update styles based on maximize state
		const updateMaximizeStyles = (maximized) => {
			isMaximized = maximized;
			const styleEl = document.getElementById("whatsapp-electron-style");
			if (styleEl) {
				styleEl.textContent = generateStyles(maximized);
			}

			// Also update any dynamically added elements
			if (!isWindows && !isHyprland) {
				const maximizeButton = document.querySelector(".maximize-button");
				if (maximizeButton) {
					const svg = maximizeButton.querySelector("svg");
					if (svg) {
						svg.innerHTML = maximized ? restoreButtonSVG : maximizeButtonSVG;
					}
				}
			}
		};

		// Listen for maximize state changes
		ipcRenderer.on(
			Constants.event.windowMaximizeStateChanged,
			(_event, data) => {
				isMaximized = data.isMaximized;
				updateMaximizeStyles(data.isMaximized);
			},
		);

		// Listen for focus state changes from main process
		ipcRenderer.on(Constants.event.windowFocusStateChanged, (_event, data) => {
			windowIsFocused = !!data?.isFocused;
			applyWindowControlsFocusFilter();
		});

		// Function to add window control buttons (can be called multiple times)
		const addWindowControls = () => {
			if (isHyprland) return;

			const chatElement = document.querySelector('[aria-label="Chats"]');
			const sidebarHeader =
				chatElement?.parentElement?.parentElement?.parentElement?.parentElement;

			// Check if buttons already exist
			if (
				sidebarHeader &&
				!document.getElementById("electron-window-controls")
			) {
				const buttonClass = "electron-window-controls-button";
				const buttonStyle =
					"width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 50%;";
				const buttonContainer = document.createElement("div");
				buttonContainer.id = "electron-window-controls";

				let lastClicked = "";
				const closeButton = document.createElement("div");
				closeButton.className = buttonClass;
				closeButton.style.cssText = buttonStyle;
				const closeButtonSVG =
					'<path fill="currentColor" d="M19.7 4.3a1 1 0 0 0-1.4 0L12 10.6 5.7 4.3a1 1 0 1 0-1.4 1.4l6.3 6.3-6.3 6.3a1 1 0 1 0 1.4 1.4l6.3-6.3 6.3 6.3a1 1 0 0 0 1.4-1.4l-6.3-6.3 6.3-6.3a1 1 0 0 0 0-1.4z"></path>';
				closeButton.innerHTML = generateButtonHTML("Close", closeButtonSVG);
				const actualCloseButton = closeButton.querySelector("button");
				actualCloseButton.addEventListener("mousedown", () => {
					closeButton.style.background = "#7777";
					lastClicked = "close";
				});
				actualCloseButton.addEventListener("mouseup", () => {
					closeButton.style.background = "";
				});
				actualCloseButton.addEventListener("mouseleave", () => {
					closeButton.style.background = "";
				});
				actualCloseButton.addEventListener("mouseenter", (evnt) => {
					if (evnt.buttons === 1 && lastClicked === "close") {
						closeButton.style.background = "#7777";
					}
				});
				actualCloseButton.addEventListener("click", () => {
					window.ipcRenderer.send(Constants.event.closeWindow);
				});
				buttonContainer.appendChild(closeButton);

				const maximizeButton = document.createElement("div");
				maximizeButton.className = buttonClass + " maximize-button";
				maximizeButton.style.cssText = buttonStyle;
				maximizeButton.innerHTML = generateButtonHTML(
					"Maximize",
					isMaximized ? restoreButtonSVG : maximizeButtonSVG,
				);
				const actualMaximizeButton = maximizeButton.querySelector("button");
				actualMaximizeButton.addEventListener("mousedown", () => {
					maximizeButton.style.background = "#7777";
					lastClicked = "maximize";
				});
				actualMaximizeButton.addEventListener("mouseup", () => {
					maximizeButton.style.background = "";
				});
				actualMaximizeButton.addEventListener("mouseleave", () => {
					maximizeButton.style.background = "";
				});
				actualMaximizeButton.addEventListener("mouseenter", (evnt) => {
					if (evnt.buttons === 1 && lastClicked === "maximize") {
						maximizeButton.style.background = "#7777";
					}
				});
				actualMaximizeButton.addEventListener("click", () => {
					window.ipcRenderer.send(Constants.event.maximizeWindow);
				});
				buttonContainer.appendChild(maximizeButton);

				const minimizeButton = document.createElement("div");
				minimizeButton.className = buttonClass;
				minimizeButton.style.cssText = buttonStyle;
				const minimizeButtonSVG =
					'<path fill="currentColor" d="M19 13H5v-2h14v2z"></path>';
				minimizeButton.innerHTML = generateButtonHTML(
					"Minimize",
					minimizeButtonSVG,
				);
				const actualMinimizeButton = minimizeButton.querySelector("button");
				actualMinimizeButton.addEventListener("mousedown", () => {
					minimizeButton.style.background = "#7777";
					lastClicked = "minimize";
				});
				actualMinimizeButton.addEventListener("mouseup", () => {
					minimizeButton.style.background = "";
				});
				actualMinimizeButton.addEventListener("mouseleave", () => {
					minimizeButton.style.background = "";
				});
				actualMinimizeButton.addEventListener("mouseenter", (evnt) => {
					if (evnt.buttons === 1 && lastClicked === "minimize") {
						minimizeButton.style.background = "#7777";
					}
				});
				actualMinimizeButton.addEventListener("click", () => {
					window.ipcRenderer.send(Constants.event.minimizeWindow);
				});
				buttonContainer.appendChild(minimizeButton);

				sidebarHeader.insertBefore(buttonContainer, sidebarHeader.firstChild);
				console.log("Window control buttons added");
			}

			applyWindowControlsFocusFilter();
		};

		// Periodically check if window controls need to be added
		if (!isHyprland)
			setInterval(() => {
				addWindowControls();
			}, 2000);

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
							if (!isWindows && !isMaximized && !isHyprland) {
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

			// Add window control buttons initially
			addWindowControls();
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

function generateButtonHTML(name, svg) {
	return `<span class="html-span" style="width: 100%; height: 100%">
<button aria-label="${name}" tabindex="-1" data-navbar-item="true" style="display: flex; align-items: center; justify-content: center; color: var(--WDS-content-deemphasized); width: 100%; height: 100%;">
<svg viewBox="0 0 24 24" height="16" width="16" preserveAspectRatio="xMidYMid meet" style="display: block;" fill="none">
<title>${name}</title>
${svg}
</svg>
</button>
</span>`;
}
