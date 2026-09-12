const TEXT_EXT =
  /\.(txt|text|log|md|markdown|json|csv|tsv|xml|html|htm|css|scss|less|js|mjs|cjs|ts|tsx|jsx|vue|yml|yaml|ini|conf|cfg|env|py|java|c|cc|cpp|h|hpp|cs|php|rb|go|rs|sql|bat|cmd|ps1|sh|bash|zsh|toml|svg|gitignore|dockerignore|editorconfig|map|properties|gradle|plist|lua|kt|swift|r|pl|dart|ex|exs|vbs|reg|inf|nfo|srt|vtt|asm|makefile)$/i;

const TEXT_NAMES = new Set([
  "env",
  "dockerfile",
  "makefile",
  "license",
  "readme",
  "procfile",
  "gemfile",
  "rakefile",
  "hosts",
]);

export function isTextFileName(name: string) {
  const base = String(name || "").trim();
  if (!base) return false;
  if (TEXT_EXT.test(base)) return true;
  if (base.startsWith(".") && !base.slice(1).includes(".")) return true;
  return TEXT_NAMES.has(base.toLowerCase());
}
