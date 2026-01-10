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
	}

	getId() {
		return this.id;
	}

	loadModuleRaid() {
		console.log("Loading Module Raid...");
		this.mrid = Math.random().toString(36).substring(7);

		if (parseFloat(window.Debug.VERSION) < 2.3) {
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
					reader.onload = (event) => resolve(event.target.result);
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

		setTimeout(() => {
			const style = document.createElement("style");
			style.textContent = `
				/* Make all headers draggable */
				header {
					-webkit-app-region: drag !important;
				}

				header button, [role="button"] {
					-webkit-app-region: no-drag !important;
				}

				#app {
					border-radius: 16px !important;
					overflow: hidden !important;
					background: black !important;
				}

				body {
					background-color: transparent !important;
				}
			`;
			document.head.appendChild(style);

			window.ipcRenderer = require("electron").ipcRenderer;

			console.log("Constants in setTimeout:", Constants);
			console.log("Constants.event:", Constants.event);
			console.log(
				"Constants.event.closeWindow:",
				Constants.event ? Constants.event.closeWindow : "event undefined",
			);

			const sidebarHeader = document.querySelector(
				'[class="x1c4vz4f xs83m0k xdl72j9 x1g77sc7 x78zum5 xozqiw3 x1oa3qoh x12fk4p8 xeuugli x2lwn1j x1nhvcw1 xdt5ytf x1cy8zhl x1277o0a"]',
			);

			if (sidebarHeader) {
				const buttonClasses =
					"x1c4vz4f xs83m0k xdl72j9 x1g77sc7 x78zum5 xozqiw3 x1oa3qoh x12fk4p8 xeuugli x2lwn1j x1nhvcw1 x1q0g3np x1cy8zhl x100vrsf x1vqgdyp xhslqc4 x1ekkm8c x1143rjc xum4auv xj21bgg x1277o0a x13i9f1t xr9ek0c xjpr12u";
				const buttonContainer = document.createElement("div");

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
			}
		}, 3000);
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
