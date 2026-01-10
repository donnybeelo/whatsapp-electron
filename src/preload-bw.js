const { contextBridge, ipcRenderer } = require("electron");

ipcRenderer.on("init-resources", (event, data) => {
	console.log("Received Constants:", data.constants);
	const Constants = data.constants;

	ipcRenderer.on(Constants.event.buildBadgeIcon, (event, counter) => {
		console.log("Received:", Constants.event.buildBadgeIcon);
		var image = new Image();
		image.setAttribute("crossorigin", "anonymous");

		image.onload = () => {
			var canvas = window.document.createElement("canvas");
			var ctx = canvas.getContext("2d");

			canvas.width = image.width;
			canvas.height = image.height;

			ctx.drawImage(image, 0, 0, image.width, image.height);

			var centerX = canvas.width * 0.75 - 2;
			var centerY = canvas.height * 0.25 + 2;
			var radius = 128;

			ctx.beginPath();
			ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI, false);
			ctx.fillStyle = "#ff3333";
			ctx.fill();
			ctx.lineWidth = 2;
			ctx.strokeStyle = "#003300";
			ctx.stroke();

			var data = canvas.toDataURL("image/png");

			console.log("Send:", Constants.event.updateBadgeIcon);
			ipcRenderer.send(Constants.event.updateBadgeIcon, data);
		};

		image.src = "../assets/whatsapp-icon-outline.png";
	});

	contextBridge.exposeInMainWorld("electron", {
		getAccounts: () =>
			ipcRenderer.invoke(Constants.event.getAccountsList).then((accounts) => {
				return accounts;
			}),
		addAccount: (id, name) =>
			ipcRenderer.send(Constants.event.addAccount, { id, name }),
		updateAccount: (id, name) =>
			ipcRenderer.send(Constants.event.updateAccount, { id, name }),
		deleteAccount: (id) => ipcRenderer.send(Constants.event.deleteAccount, id),
		gotoAccount: (id) => ipcRenderer.send(Constants.event.gotoAccount, id),
		reloadAccounts: (callback) =>
			ipcRenderer.on(Constants.event.reloadAccounts, callback),
	});
});
