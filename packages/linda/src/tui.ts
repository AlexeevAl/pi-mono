// ============================================================================
// Linda — Terminal UI (TUI) Mode
// Implements a beautiful terminal interface similar to pi-coding-agent.
// ============================================================================

import type { Agent } from "@mariozechner/pi-agent-core";
import {
	type Component,
	Editor,
	type EditorOptions,
	type EditorTheme,
	ProcessTerminal,
	TUI,
	visibleWidth,
} from "@mariozechner/pi-tui";
import chalk from "chalk";

// ============================================================================
// Message Component (Static or Streaming)
// ============================================================================

class MessageComponent implements Component {
	constructor(
		public role: string,
		public text: string,
	) {}

	invalidate(): void {}

	render(width: number): string[] {
		const prefix = this.role === "user" ? chalk.blue("You: ") : chalk.green("Linda: ");
		const lines: string[] = [];

		const availableWidth = Math.max(10, width - 10);
		const remaining = this.text;
		if (!remaining) return [];

		// Split by newlines first to honor formatting
		const blocks = remaining.split("\n");
		for (const block of blocks) {
			let subRemaining = block;
			while (subRemaining.length > 0) {
				const chunk = subRemaining.slice(0, availableWidth);
				lines.push((lines.length === 0 && block === blocks[0] ? prefix : "       ") + chunk);
				subRemaining = subRemaining.slice(availableWidth);
			}
			if (block === "") lines.push("       ");
		}

		return lines;
	}
}

// ============================================================================
// History Container
// ============================================================================

class ChatHistory implements Component {
	private children: Component[] = [];

	constructor(private maxHeight: number = 20) {}

	addChild(c: Component) {
		this.children.push(c);
	}

	replaceLast(c: Component) {
		if (this.children.length > 0) {
			this.children[this.children.length - 1] = c;
		} else {
			this.children.push(c);
		}
	}

	invalidate() {
		for (const c of this.children) {
			c.invalidate?.();
		}
	}

	render(width: number): string[] {
		const allLines = this.children.flatMap((c) => {
			const res = c.render(width);
			return res.length > 0 ? [...res, ""] : [];
		});

		if (allLines.length > this.maxHeight) {
			return allLines.slice(allLines.length - this.maxHeight);
		}

		// Pad with empty lines if too short to maintain footer position stability?
		// No, TUI renders children in sequence.
		return allLines;
	}

	setHeight(h: number) {
		this.maxHeight = h;
	}
}

// ============================================================================
// Simple Footer
// ============================================================================

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 1000000) return `${(count / 1000).toFixed(1)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

class LindaFooter implements Component {
	constructor(private agent: Agent) {}

	invalidate(): void {}

	render(width: number): string[] {
		const history = this.agent.state.messages || [];
		let totalInput = 0;
		let totalOutput = 0;

		for (const msg of history) {
			if (msg.role === "assistant" && "usage" in msg && msg.usage) {
				totalInput += msg.usage.input || 0;
				totalOutput += msg.usage.output || 0;
			}
		}

		const model = this.agent.state.model?.id || "gpt-5.4-nano";
		const tokens = totalInput > 0 ? ` ↑${formatTokens(totalInput)} ↓${formatTokens(totalOutput)} ` : "";
		const leftSide = chalk.dim(` Linda v0.1.1 • ${model}${tokens}`);

		const thinking = this.agent.state.thinkingLevel || "off";
		const rightSide = chalk.dim(`thinking: ${thinking} `);

		const leftWidth = visibleWidth(leftSide);
		const rightWidth = visibleWidth(rightSide);
		const padding = " ".repeat(Math.max(0, width - leftWidth - rightWidth));

		return [chalk.dim("─".repeat(width)), leftSide + padding + rightSide, chalk.dim("─".repeat(width))];
	}
}

// ============================================================================
// TUI Runner
// ============================================================================

export class LindaTui {
	private readonly tui: TUI;
	private readonly agent: Agent;
	private readonly history: ChatHistory;
	private readonly editor: Editor;

	constructor(agent: Agent) {
		this.agent = agent;
		const terminal = new ProcessTerminal();
		this.tui = new TUI(terminal, true);

		// 1. History area
		// Reserve 9 lines for Footer (3) + Editor (4-5) + safety
		const histHeight = Math.max(5, terminal.rows - 9);
		this.history = new ChatHistory(histHeight);
		this.tui.addChild(this.history);

		// 2. Footer
		this.tui.addChild(new LindaFooter(agent));

		// 3. Editor
		const editorTheme: EditorTheme = {
			borderColor: (s: string) => chalk.dim(s),
			selectList: {
				selectedPrefix: (_s: string) => chalk.blue("→ "),
				selectedText: (s: string) => chalk.blue(s),
				description: (s: string) => chalk.dim(s),
				scrollInfo: (s: string) => chalk.dim(s),
				noMatch: (s: string) => chalk.red(s),
			},
		};

		const editorOptions: EditorOptions = {
			paddingX: 1,
		};

		this.editor = new Editor(this.tui, editorTheme, editorOptions);
		this.editor.onSubmit = (text: string) => this.handleUserSubmit(text);

		this.tui.addChild(this.editor);
		this.tui.setFocus(this.editor);

		// Global input
		this.tui.addInputListener((data: string) => {
			if (data === "\x03") {
				// Ctrl+C
				this.stop();
				process.exit(0);
				return { consume: true };
			}
			return undefined;
		});

		// Tool logs
		this.agent.subscribe(async (event) => {
			if (event.type === "tool_execution_start") {
				this.addLog(chalk.yellow(`🛠️ Calling ${event.toolName}...`));
			} else if (event.type === "tool_execution_end") {
				this.addLog(chalk.dim(`✅ ${event.toolName} ok.`));
			}
		});

		// Handle terminal resize if supported
		process.stdout.on("resize", () => {
			const h = Math.max(5, process.stdout.rows - 9);
			this.history.setHeight(h);
			this.tui.requestRender();
		});
	}

	async run(): Promise<void> {
		this.tui.start();
		this.addLog(chalk.cyan("Welcome to Linda TUI! Type your message to begin."));
		this.tui.requestRender();
	}

	stop(): void {
		this.tui.stop();
	}

	private addLog(text: string): void {
		this.history.addChild(new LogComponent(text));
		this.tui.requestRender();
	}

	private async handleUserSubmit(text: string): Promise<void> {
		if (!text.trim()) return;

		this.history.addChild(new MessageComponent("user", text));
		this.editor.setText("");
		this.editor.addToHistory(text);

		// Add placeholder for Linda's reply
		const streamingReply = new MessageComponent("assistant", "...");
		this.history.addChild(streamingReply);
		this.tui.requestRender();

		let fullReply = "";
		const unsub = this.agent.subscribe(async (event) => {
			if (event.type === "message_start" && event.message.role === "assistant") {
				streamingReply.text = "";
				this.tui.requestRender();
			} else if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
				fullReply += event.assistantMessageEvent.delta;
				streamingReply.text = fullReply;
				this.tui.requestRender();
			}
		});

		try {
			await this.agent.prompt(text);
			streamingReply.text = fullReply;
		} catch (err) {
			this.addLog(chalk.red(`Error: ${err}`));
		} finally {
			unsub();
			this.tui.requestRender();
		}
	}
}

// ============================================================================
// Simple Helper Components
// ============================================================================

class LogComponent implements Component {
	constructor(private text: string) {}
	invalidate() {}
	render(_width: number) {
		return [chalk.dim(`  ${this.text}`)];
	}
}
