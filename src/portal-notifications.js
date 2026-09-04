// org.gtk.Notifications + org.freedesktop.Application, so a notification click
// can D-Bus-activate us when the process is gone. Flatpak only; every failure
// path returns false/no-ops so index.js falls back to Electron's Notification.
//
// Not the xdg Notification portal: GNOME's shell reports no "default" fdo
// capability, so a body click there never invokes an action and the tag is lost.
// The gtk interface is what GNotification apps use and the shell handles it
// natively -- but only for action names it can namespace, hence "app.open-chat".
import dbus from "dbus-next";

const { Variant } = dbus;
const { Interface } = dbus.interface;

const APP_ID = process.env.FLATPAK_ID;
let portal = null;

class AppInterface extends Interface {
	constructor(onActivate) {
		super("org.freedesktop.Application");
		this.onActivate = onActivate;
	}
	Activate() {
		this.onActivate(null);
	}
	Open() {
		this.onActivate(null);
	}
	ActivateAction(name, params) {
		this.onActivate(name === "open-chat" ? params[0]?.value : null);
	}
}
AppInterface.configureMembers({
	methods: {
		Activate: { inSignature: "a{sv}" },
		Open: { inSignature: "asa{sv}" },
		ActivateAction: { inSignature: "sava{sv}" },
	},
});

// Keep ids to [A-Za-z0-9_-]; a jid is "1234@c.us"
const portalId = (tag) => String(tag).replace(/[^A-Za-z0-9_-]/g, "_");

function pngBuffer(dataUrl) {
	const comma = typeof dataUrl === "string" ? dataUrl.indexOf(",") : -1;
	if (comma < 0) return null;
	return Buffer.from(dataUrl.slice(comma + 1), "base64");
}

export async function init(onActivate) {
	try {
		const bus = dbus.sessionBus();
		// Export before claiming the name: D-Bus delivers a pending activation call
		// the moment the name is acquired, and answers UnknownMethod if the
		// interface isn't up yet -- which is every cold notification click.
		bus.export(`/${APP_ID.replace(/\./g, "/")}`, new AppInterface(onActivate));
		await bus.requestName(APP_ID, 0);
		const obj = await bus.getProxyObject(
			"org.gtk.Notifications",
			"/org/gtk/Notifications",
		);
		portal = obj.getInterface("org.gtk.Notifications");
		return true;
	} catch (e) {
		console.error("Notification portal unavailable:", e);
		portal = null;
		return false;
	}
}

export async function show({ tag, title, body, icon, silent }) {
	if (!portal || !tag) return false;
	const vardict = {
		title: new Variant("s", title || ""),
		body: new Variant("s", body || ""),
		// ponytail: there is no silent flag; "low" is the closest thing and only
		// the initial unread summary sets silent anyway
		priority: new Variant("s", silent ? "low" : "normal"),
		// The "app." prefix is load-bearing: GNOME's shell only namespaces action
		// names it recognises and plain-activates the app for anything else.
		"default-action": new Variant("s", "app.open-chat"),
		"default-action-target": new Variant("s", String(tag)),
	};
	const png = pngBuffer(icon);
	if (png) vardict.icon = new Variant("(sv)", ["bytes", new Variant("ay", png)]);
	try {
		await portal.AddNotification(APP_ID, portalId(tag), vardict);
		return true;
	} catch (e) {
		console.error("AddNotification failed:", e);
		return false;
	}
}

export function close(tag) {
	if (!portal || !tag) return;
	portal.RemoveNotification(APP_ID, portalId(tag)).catch(() => {});
}
