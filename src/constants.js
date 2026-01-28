import pkg from "../package.json" with { type: "json" };

const Constants = {
	appName: "WhatsApp",
	event: {},
	whatsapp: {},
};

Constants.version = pkg.version;

Constants.whatsapp.url = "https://web.whatsapp.com/";
Constants.whatsapp.userAgent =
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

Constants.event.initResources = "init-resources";
Constants.event.initWhatsAppInstance = "init-whatsapp-instance";
Constants.event.clearWorkersAndReload = "clear-workers-and-reload";
Constants.event.reloadWhatsAppInstance = "reload-whatsapp-instance";
Constants.event.updateUnreadMessages = "update-unread-messages";
Constants.event.newRendererNotification = "new-renderer-notification";
Constants.event.closeRendererNotification = "close-renderer-notification";
Constants.event.fireNotificationClick = "fire-notification-click";
Constants.event.buildBadgeIcon = "build-badge-icon";
Constants.event.updateBadgeIcon = "set-updated-badge-icon";
Constants.event.pollRefresh = "poll-refresh";

Constants.event.getAccountsList = "get-accounts-list";
Constants.event.addAccount = "add-account";
Constants.event.updateAccount = "update-account";
Constants.event.deleteAccount = "delete-account";
Constants.event.gotoAccount = "goto-account";
Constants.event.reloadAccounts = "reload-accounts";

Constants.event.minimizeWindow = "minimize-window";
Constants.event.maximizeWindow = "maximize-window";
Constants.event.closeWindow = "close-window";
Constants.event.windowMaximizeStateChanged = "window-maximize-state-changed";

const init = (lang) => {
	// Default English
	Constants.whatsapp.profilePicture = /profile picture|chats/i;
	Constants.whatsapp.unreadText = "Unread";
	Constants.whatsapp.unreadTextSearch = /[0-9]+ unread message(s)?/;

	switch (lang) {
		case "pt-BR":
			Constants.whatsapp.profilePicture = /foto do perfil|conversas/i;
			Constants.whatsapp.unreadText = "Não lidas";
			Constants.whatsapp.unreadTextSearch =
				/[0-9]+ mensage(m|ns)? não lida(s)?/;
			break;
	}

	return Constants;
};

export { init };
