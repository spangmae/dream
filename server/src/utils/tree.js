function emptyNode(path, name) {
  return {
    path,
    name,
    fileCount: 0,
    contentCount: 0,
    children: new Map(),
  };
}

function addToTree(root, folderKey, kind) {
  const parts = String(folderKey || "")
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);

  if (kind === "file") root.fileCount += 1;
  else root.contentCount += 1;

  let node = root;
  let acc = "";
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    if (!node.children.has(part)) {
      node.children.set(part, emptyNode(acc, part));
    }
    node = node.children.get(part);
    if (kind === "file") node.fileCount += 1;
    else node.contentCount += 1;
  }
}

function serialize(node) {
  return {
    path: node.path,
    name: node.name,
    fileCount: node.fileCount,
    contentCount: node.contentCount,
    children: [...node.children.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(serialize),
  };
}

export function buildFolderTree(files = [], contents = []) {
  const root = emptyNode("", "");
  for (const file of files) addToTree(root, file.folder_key, "file");
  for (const content of contents) addToTree(root, content.folder_key, "content");
  return {
    fileCount: root.fileCount,
    contentCount: root.contentCount,
    children: serialize(root).children,
  };
}
