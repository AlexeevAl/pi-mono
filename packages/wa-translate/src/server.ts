import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import open from "open";
import { Server } from "socket.io";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface WebTranslation {
	id: string;
	chatId: string;
	chatName: string;
	text: string;
	translatedText: string;
	targetLang: string;
	timestamp: number;
	fromMe: boolean;
}

export class TranslationServer {
	private app = express();
	private server = createServer(this.app);
	private io = new Server(this.server);
	private port = 3000;
	private history: WebTranslation[] = [];
	private chats: Array<{ id: string; name?: string }> = [];

	private onMessageSendCallback?: (chatId: string, text: string) => void;

	constructor(port?: number) {
		if (port) this.port = port;

		// Serve static files from the 'ui' directory in the project root
		// When running from dist/server.js, project root is ../..
		this.app.use(express.static(path.join(__dirname, "..", "ui")));

		this.io.on("connection", (socket) => {
			console.log("[WebUI] Client connected");
			socket.emit("history", this.history);
			socket.emit("chats", this.chats);

			socket.on("message:send", (data) => {
				if (this.onMessageSendCallback) {
					this.onMessageSendCallback(data.chatId, data.text);
				}
			});
		});
	}

	public start() {
		this.server.listen(this.port, () => {
			const url = `http://localhost:${this.port}`;
			console.log(`[WebUI] Dashboard available at: ${url}`);
			open(url).catch((err) => console.error("[WebUI] Failed to auto-open browser:", err));
		});
	}

	public onMessageSend(callback: (chatId: string, text: string) => void) {
		this.onMessageSendCallback = callback;
	}

	public setChatList(chatList: Array<{ id: string; name?: string }>) {
		this.chats = chatList;
		this.io.emit("chats", this.chats);
	}

	public broadcastTranslation(translation: WebTranslation) {
		this.history.push(translation);
		if (this.history.length > 100) this.history.shift();
		this.io.emit("translation", translation);

		const existingChat = this.chats.find((c) => c.id === translation.chatId);
		if (!existingChat) {
			this.chats.push({ id: translation.chatId, name: translation.chatName });
			this.io.emit("chats", this.chats);
		} else if (
			translation.chatName &&
			translation.chatName !== translation.chatId &&
			existingChat.name !== translation.chatName
		) {
			existingChat.name = translation.chatName;
			this.io.emit("chats", this.chats);
		}
	}

	public onCommand(callback: (cmd: string, args: any) => void) {
		this.io.on("connection", (socket) => {
			socket.on("command", (data) => {
				callback(data.command, data.args);
			});
		});
	}
}
