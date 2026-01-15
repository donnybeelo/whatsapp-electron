const { ipcRenderer } = require("electron");

class WhatsAppInstance {
	constructor(id, name) {
		// self
		this.id = id;
		this.name = name;
		this.lastUnread = 0;

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
		console.log("Loading Module Raid...");
		this.mrid = Math.random().toString(36).substring(7);

		if (
			window.Debug &&
			window.Debug.VERSION &&
			parseFloat(window.Debug.VERSION) < 2.3
		) {
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
			var _wai = this;
			let modules = self.require("__debug").modulesMap;
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
						if (Object.keys(_wai.mrobj[mod].default).length == 0) {
							try {
								self.ErrorGuard.skipGuardGlobal(true);
								Object.assign(_wai.mrobj[mod], self.importNamespace(mod));
							} catch (e) {}
						}
					}
				});
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

	countUnread() {
		let unread = 0;
		let chats = 0;
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
						}
					}
				}
			}
		}

		if (this.lastUnread != unread) {
			this.lastUnread = unread;
			chats = chats > 0 ? chats - 1 : chats;

			ipcRenderer.send(Constants.event.updateUnreadMessages, {
				id: this.id,
				unread: unread - chats,
			});
		}
	}
}

class NotificationServer {
	constructor(title, options) {
		//console.log("New NotificationServer...", title, options);
		this._processOptions(title, options);
	}

	async _processOptions(title, options) {
		options.icon = options.icon
			.replace(Constants.whatsapp.url, "")
			.replace("%3F", "?");
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
							const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
							ctx.strokeStyle = isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
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
							outputCtx.drawImage(canvas, 0, 0, outputCanvas.width, outputCanvas.height);
							
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

	close() {}
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
		let isMaximized = false;

		// Generate CSS based on maximize state
		const generateStyles = (maximized) => {
			const borderRadius = !isWindows && !maximized ? "16px" : "0";
			const boxShadow =
				!isWindows && !maximized ? "0 0 5px rgba(0, 0, 0, 0.5)" : "none";
			const size = !isWindows && !maximized ? "calc(100% - 10px)" : "100%";
			const margin = !isWindows && !maximized ? "5px" : "0";
			const border = !isWindows && !maximized ? "1px" : "0";

			return `
				/* Make all headers draggable */
				header[tabindex="0"] {
					-webkit-app-region: drag !important;
					z-index: 600 !important;
				}

				.overlay,
				[data-animate-modal-backdrop="true"] {
					width: calc(100% - 75px) !important;
					left: 70px !important;
					height: calc(100% - 10px) !important;
					top: 5px !important;
					border-radius: 0 ${borderRadius} ${borderRadius} 0 !important;
				}

				[class="xsm26vf x10l6tqk x1ey2m1c xoxg7ud x9f619 x78zum5 xdt5ytf x6s0dn4 x1nhvcw1 xh8yej3 xpyat2d x6ikm8r x10wlt62 x13fuv20 x178xt8z xx42vgk xg01cxk xqu7myx"] {
					width: calc(100% - 65px) !important;
					margin-left: 65px;
				}

				header button, [role="button"] {
					-webkit-app-region: no-drag !important;
				}

				html, body {
					overflow: hidden !important;
					background: ${isWindows ? "#111b21" : "transparent"} !important;
				}

				#app {
					border-radius: ${borderRadius} !important;
					overflow: hidden !important;
					box-shadow: ${boxShadow} !important;
					width: ${size} !important;
					height: ${size} !important;
					margin: ${margin} !important;
					box-sizing: border-box !important;
					border: ${border} solid #aaaa;
					@media (prefers-color-scheme: dark) {
						border: ${border}	 solid #333a;
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
			if (!isWindows) {
				document.querySelectorAll("body > *").forEach((node) => {
					if (node.nodeType === 1 && node.id !== "whatsapp-electron-style") {
						node.style.borderRadius = maximized ? "0" : "16px";
					}
				});
			}
		};

		// Listen for maximize state changes
		ipcRenderer.on(
			Constants.event.windowMaximizeStateChanged,
			(event, data) => {
				console.log("Maximize state changed:", data.isMaximized);
				updateMaximizeStyles(data.isMaximized);
			},
		);

		// Function to add window control buttons (can be called multiple times)
		const addWindowControls = () => {
			const sidebarHeader = document.querySelector(
				'[class="x1c4vz4f xs83m0k xdl72j9 x1g77sc7 x78zum5 xozqiw3 x1oa3qoh x12fk4p8 xeuugli x2lwn1j x1nhvcw1 xdt5ytf x1cy8zhl x1277o0a"]',
			);

			// Check if buttons already exist
			if (
				sidebarHeader &&
				!document.getElementById("electron-window-controls")
			) {
				const buttonClasses =
					"x1c4vz4f xs83m0k xdl72j9 x1g77sc7 x78zum5 xozqiw3 x1oa3qoh x12fk4p8 xeuugli x2lwn1j x1nhvcw1 x1q0g3np x1cy8zhl x100vrsf x1vqgdyp xhslqc4 x1ekkm8c x1143rjc xum4auv xj21bgg x1277o0a x13i9f1t xr9ek0c xjpr12u";
				const buttonContainer = document.createElement("div");
				buttonContainer.id = "electron-window-controls";

				buttonContainer.style.cssText =
					"margin-bottom: 5px; gap: 2px; display:flex; flex-direction:column; -webkit-app-region: no-drag; align-items: center; justify-content: center; width: 40px";

				const closeButton = document.createElement("div");
				closeButton.className = buttonClasses;
				closeButton.style.cssText =
					"background-color: #f006; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;";
				const closeButtonSVG =
					'<path fill="currentColor" d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12l-4.89 4.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z"></path>';
				closeButton.innerHTML = generateButtonHTML("Close", closeButtonSVG);
				const actualButton = closeButton.querySelector("button");
				actualButton.addEventListener("click", () => {
					window.ipcRenderer.send(Constants.event.closeWindow);
				});
				buttonContainer.appendChild(closeButton);

				const maximizeButton = document.createElement("div");
				maximizeButton.className = buttonClasses;
				maximizeButton.style.cssText =
					"width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;";
				const maximizeButtonSVG =
					'<path fill="currentColor" d="M19 5v14H5V5h14m0-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z"></path>';
				maximizeButton.innerHTML = generateButtonHTML(
					"Maximize",
					maximizeButtonSVG,
				);
				const actualMaximizeButton = maximizeButton.querySelector("button");
				actualMaximizeButton.addEventListener("click", () => {
					window.ipcRenderer.send(Constants.event.maximizeWindow);
				});
				buttonContainer.appendChild(maximizeButton);

				const minimizeButton = document.createElement("div");
				minimizeButton.className = buttonClasses;
				minimizeButton.style.cssText =
					"width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;";
				const minimizeButtonSVG =
					'<path fill="currentColor" d="M19 13H5v-2h14v2z"></path>';
				minimizeButton.innerHTML = generateButtonHTML(
					"Minimize",
					minimizeButtonSVG,
				);
				const actualMinimizeButton = minimizeButton.querySelector("button");
				actualMinimizeButton.addEventListener("click", () => {
					window.ipcRenderer.send(Constants.event.minimizeWindow);
				});
				buttonContainer.appendChild(minimizeButton);

				sidebarHeader.insertBefore(buttonContainer, sidebarHeader.firstChild);
				console.log("Window control buttons added");
			}
		};

		// Periodically check if window controls need to be added
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
							if (!isWindows && !isMaximized) {
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

function generateButtonHTML(name, svg) {
	return `<span class="html-span xdj266r x14z9mp xat24cr x1lziwak xexx8yu xyri2b x18d9i69 x1c1uobl x1hl2dhg x16tdsg8 x1vvkbs x4k7w5x x1h91t0o x1h9r5lt x1jfb8zj xv2umb2 x1beo9mf xaigb6o x12ejxvf x3igimt xarpa2k xedcshv x1lytzrv x1t2pt76 x7ja8zs x1qrby5j">
<button aria-label="${name}" tabindex="-1" data-navbar-item="true" class="xjb2p0i xk390pu x1heor9g x1ypdohk xjbqb8w x972fbf x10w94by x1qhh985 x14e42zd xtnn1bt x9v5kkp xmw7ebm xrdum7p xt8t1vi x1xc408v x129tdwq x15urzxu xh8yej3 x1y1aw1k xf159sx xwib8y2 xmzvs34" style="display: flex; align-items: center; justify-content: center;">
<svg viewBox="0 0 24 24" height="24" width="24" preserveAspectRatio="xMidYMid meet" style="display: block;" fill="none">
<title>${name}</title>
${svg}
</svg>
</button>
</span>`;
}
