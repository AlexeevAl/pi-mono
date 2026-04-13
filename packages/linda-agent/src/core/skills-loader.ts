import fs from "node:fs";
import path from "node:path";

export interface Skill {
	id: string;
	name: string;
	content: string;
}

/**
 * Loads SKILL.md files from a directory.
 * Each subdirectory with a SKILL.md becomes a named skill.
 * Shared by both LindaClientAgent and LindaAdminAgent.
 */
export class SkillsLoader {
	private skills: Map<string, Skill> = new Map();

	constructor(private readonly dir: string) {
		this.reload();
	}

	public reload(): void {
		if (!fs.existsSync(this.dir)) return;

		const entries = fs.readdirSync(this.dir, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.isDirectory()) {
				const skillFile = path.join(this.dir, entry.name, "SKILL.md");
				if (fs.existsSync(skillFile)) {
					const content = fs.readFileSync(skillFile, "utf-8");
					this.skills.set(entry.name, {
						id: entry.name,
						name: this.extractTitle(content) ?? entry.name,
						content,
					});
				}
			}
		}
	}

	public getSkill(id: string): Skill | undefined {
		return this.skills.get(id);
	}

	public listSkills(): Skill[] {
		return [...this.skills.values()];
	}

	private extractTitle(content: string): string | undefined {
		const match = content.match(/^#\s+(.+)$/m) ?? content.match(/^Title:\s+(.+)$/m);
		return match ? match[1].trim() : undefined;
	}
}
