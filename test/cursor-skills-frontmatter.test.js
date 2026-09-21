const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SKILLS_ROOT = path.join(__dirname, '..', '.cursor', 'skills');
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function parseFrontmatter(text) {
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
    assert.ok(match, 'SKILL.md must start with YAML frontmatter');
    const data = {};
    for (const line of match[1].split(/\r?\n/)) {
        const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (!kv) continue;
        let value = kv[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        data[kv[1]] = value;
    }
    return data;
}

function skillDirs() {
    return fs.readdirSync(SKILLS_ROOT, { withFileTypes: true })
        .filter((ent) => ent.isDirectory() && !ent.name.startsWith('_'))
        .map((ent) => ent.name)
        .sort();
}

test('every skill folder has SKILL.md with name + description frontmatter', () => {
    const names = skillDirs();
    assert.ok(names.length > 0, 'expected at least one skill folder');
    for (const name of names) {
        const file = path.join(SKILLS_ROOT, name, 'SKILL.md');
        assert.ok(fs.existsSync(file), name + ' is missing SKILL.md');
        const fm = parseFrontmatter(fs.readFileSync(file, 'utf8'));
        assert.equal(fm.name, name, name + ' frontmatter name must match folder');
        assert.match(fm.name, NAME_RE, name + ' name must be lowercase hyphenated');
        assert.ok(
            fm.description && fm.description.length >= 20,
            name + ' needs a description the agent can use for discovery'
        );
    }
});

test('Jira skills do not send agents to ToolSearch or ~/.claude', () => {
    const jiraSkills = [
        'plan-ticket',
        'create-epic',
        'implement',
        'to-prd',
        'to-issues',
    ];
    for (const name of jiraSkills) {
        const text = fs.readFileSync(
            path.join(SKILLS_ROOT, name, 'SKILL.md'),
            'utf8'
        );
        assert.doesNotMatch(
            text,
            /ToolSearch\s*→/,
            name + ' must not seed Claude ToolSearch'
        );
        assert.doesNotMatch(
            text,
            /(?:call|via|from)\s+ToolSearch/i,
            name + ' must not send the agent to Claude ToolSearch'
        );
        assert.match(
            text,
            /Atlassian/i,
            name + ' should point at Atlassian MCP'
        );
    }
    const jiraMd = fs.readFileSync(
        path.join(SKILLS_ROOT, 'plan-ticket', 'JIRA.md'),
        'utf8'
    );
    assert.doesNotMatch(
        jiraMd,
        /ToolSearch\s*→/,
        'JIRA.md must not seed Claude ToolSearch'
    );
    assert.match(jiraMd, /Atlassian MCP/, 'JIRA.md should name Atlassian MCP');
});

test('plan-ticket and create-epic carry the Grok Bot operator note', () => {
    for (const name of ['plan-ticket', 'create-epic']) {
        const text = fs.readFileSync(
            path.join(SKILLS_ROOT, name, 'SKILL.md'),
            'utf8'
        );
        assert.match(text, /Operator/, name);
        assert.match(text, /Grok Bot/, name);
        assert.match(text, /Cursor Cloud Agents/, name);
    }
});
