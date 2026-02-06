const xmlEscape = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const toNumeric = (value, fallback = 0) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
};

const normalizePositions = (positions) => {
    if (!positions || typeof positions !== 'object') return {};
    return positions;
};

export const exportGraphToGraphML = (graphData, options = {}) => {
    const nodes = Array.isArray(graphData?.nodes) ? graphData.nodes : [];
    const edges = Array.isArray(graphData?.edges) ? graphData.edges : [];
    const positions = normalizePositions(options.positions);

    const lines = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('<graphml xmlns="http://graphml.graphdrawing.org/xmlns" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://graphml.graphdrawing.org/xmlns http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd">');
    lines.push('  <key id="d0" for="node" attr.name="label" attr.type="string"/>');
    lines.push('  <key id="d1" for="node" attr.name="schema" attr.type="string"/>');
    lines.push('  <key id="d2" for="node" attr.name="table" attr.type="string"/>');
    lines.push('  <key id="d3" for="node" attr.name="node_type" attr.type="string"/>');
    lines.push('  <key id="d4" for="node" attr.name="x" attr.type="double"/>');
    lines.push('  <key id="d5" for="node" attr.name="y" attr.type="double"/>');
    lines.push('  <key id="d6" for="node" attr.name="width" attr.type="double"/>');
    lines.push('  <key id="d7" for="node" attr.name="height" attr.type="double"/>');
    lines.push('  <key id="d8" for="edge" attr.name="edge_type" attr.type="string"/>');
    lines.push('  <key id="d9" for="edge" attr.name="source_column" attr.type="string"/>');
    lines.push('  <key id="d10" for="edge" attr.name="target_column" attr.type="string"/>');
    lines.push('  <key id="d11" for="edge" attr.name="cardinality" attr.type="string"/>');
    lines.push('  <key id="d12" for="edge" attr.name="label" attr.type="string"/>');
    lines.push('  <graph id="G" edgedefault="directed">');

    nodes.forEach((node, index) => {
        const nodeId = String(node?.id || `node_${index + 1}`);
        const pos = positions[nodeId] || {};
        const x = toNumeric(pos.x, 0);
        const y = toNumeric(pos.y, 0);
        const width = toNumeric(pos.width, 40);
        const height = toNumeric(pos.height, 40);

        lines.push(`    <node id="${xmlEscape(nodeId)}">`);
        lines.push(`      <data key="d0">${xmlEscape(node?.name || nodeId)}</data>`);
        lines.push(`      <data key="d1">${xmlEscape(node?.schema || '')}</data>`);
        lines.push(`      <data key="d2">${xmlEscape(node?.table || node?.name || '')}</data>`);
        lines.push(`      <data key="d3">${xmlEscape(node?.node_type || 'Table')}</data>`);
        lines.push(`      <data key="d4">${x}</data>`);
        lines.push(`      <data key="d5">${y}</data>`);
        lines.push(`      <data key="d6">${width}</data>`);
        lines.push(`      <data key="d7">${height}</data>`);
        lines.push('    </node>');
    });

    edges.forEach((edge, index) => {
        const edgeId = String(edge?.id || `edge_${index + 1}`);
        const source = String(edge?.source || '');
        const target = String(edge?.target || '');

        lines.push(`    <edge id="${xmlEscape(edgeId)}" source="${xmlEscape(source)}" target="${xmlEscape(target)}">`);
        lines.push(`      <data key="d8">${xmlEscape(edge?.edge_type || 'ForeignKey')}</data>`);
        lines.push(`      <data key="d9">${xmlEscape(edge?.source_column || '')}</data>`);
        lines.push(`      <data key="d10">${xmlEscape(edge?.target_column || '')}</data>`);
        lines.push(`      <data key="d11">${xmlEscape(edge?.cardinality || '')}</data>`);
        lines.push(`      <data key="d12">${xmlEscape(edge?.label || '')}</data>`);
        lines.push('    </edge>');
    });

    lines.push('  </graph>');
    lines.push('</graphml>');

    return lines.join('\n');
};
