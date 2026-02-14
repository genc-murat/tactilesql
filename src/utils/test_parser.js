const text = `SelectWithUnionQuery (children 1)
 ExpressionList (children 1)
  SelectQuery (children 3)
   ExpressionList (children 1)
    Asterisk
   TablesInSelectQuery (children 1)
    TablesInSelectQueryElement (children 1)
     TableExpression (children 1)
      TableIdentifier library.authors
   Literal UInt64_200`;

function parse(text) {
    const lines = text.split('\n').filter(l => l.trim());
    const root = { id: 'root', label: 'Query', children: [], level: -1 };

    // Track parents for each level
    // level: node
    const parents = { '-1': root };
    let currentLevel = -1;

    lines.forEach((originalLine, idx) => {
        // Calculate indentation (assuming space based)
        // ClickHouse usually uses 1 space per level
        const line = originalLine.trimEnd(); // Remove trailing
        const indent = line.search(/\S/);
        const label = line.trim();
        const node = { id: `node-${idx}`, label, children: [], level: indent };

        // Find parent: parent must have level < indent
        // We look for the last added node with level < indent
        // A stack or simply searching downwards from indent-1 works if we store by level

        let parentLevel = indent - 1;
        while (parentLevel >= -1 && !parents[parentLevel]) {
            parentLevel--;
        }

        const parent = parents[parentLevel];
        if (parent) {
            parent.children.push(node);
        } else {
            // Fallback to root (shouldn't happen with correct logic starting at -1)
            root.children.push(node);
        }

        // Setup this node as potential parent for next levels
        parents[indent] = node;

        // Clear deeper levels from parents map as we've moved "up" or "sibling"
        // Actually, just overwriting works because we process sequentially
    });

    return root;
}

console.log(JSON.stringify(parse(text), null, 2));
