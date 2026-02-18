import { invoke } from '@tauri-apps/api/core';
import { Dialog } from './Dialog.js';
import { ThemeManager } from '../../utils/ThemeManager.js';

export function showCreateTableModal(database, dbType) {
    const existing = document.getElementById('create-table-modal');
    if (existing) existing.remove();

    const theme = ThemeManager.getCurrentTheme();
    const isLight = theme === 'light';
    const isDawn = theme === 'dawn';
    const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';
    const isNeon = theme === 'neon';

    const overlay = document.createElement('div');
    overlay.id = 'create-table-modal';
    overlay.className = 'fixed inset-0 bg-black/70 backdrop-blur-sm z-[9999] flex items-center justify-center p-4';

    const bgClass = isLight ? 'bg-white border-gray-200' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border-ocean-border' : (isNeon ? 'bg-neon-panel border-neon-border/50' : 'bg-[#0f1115] border border-white/10')));
    const headerBg = isLight ? 'bg-gray-50 border-gray-100' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border-ocean-border/30' : 'bg-[#16191e] border-white/10'));
    const textClass = isLight ? 'text-gray-800' : (isDawn ? 'text-[#575279]' : (isOceanic ? 'text-ocean-text' : (isNeon ? 'text-neon-text' : 'text-white')));
    const mutedText = isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : (isOceanic ? 'text-ocean-text/60' : (isNeon ? 'text-neon-text/60' : 'text-gray-400')));
    const inputClass = isLight ? 'bg-white border-gray-200 text-gray-800 focus:border-mysql-teal' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] text-[#575279] focus:border-[#ea9d34]' : (isOceanic ? 'bg-ocean-bg border-ocean-border text-ocean-text focus:border-ocean-frost' : (isNeon ? 'bg-neon-bg border-neon-border/30 text-neon-text focus:border-neon-accent' : 'bg-[#0b0d11] border border-white/10 text-gray-300 focus:border-mysql-teal/50')));
    const cardBg = isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#faf4ed]' : (isOceanic ? 'bg-ocean-bg' : (isNeon ? 'bg-neon-bg' : 'bg-white/5')));

    overlay.innerHTML = `
        <div class="${bgClass} rounded-xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden">
            <div class="flex items-center justify-between px-6 py-4 border-b ${headerBg}">
                <div class="flex items-center gap-3">
                    <span class="material-symbols-outlined text-green-400">add_box</span>
                    <h2 class="text-sm font-bold ${textClass} uppercase tracking-wider">Create New Table</h2>
                    <span class="text-[10px] font-mono ${mutedText} px-2 py-1 rounded">${database}</span>
                </div>
                <button id="close-modal" class="${mutedText} hover:text-white transition-colors">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>
            <div class="flex-1 overflow-auto custom-scrollbar p-6 space-y-4">
                <div class="grid grid-cols-2 gap-4">
                    <div class="space-y-2">
                        <label class="text-[10px] font-bold uppercase tracking-wider ${mutedText}">Table Name *</label>
                        <input type="text" id="table-name" class="w-full ${inputClass} rounded p-2.5 text-xs outline-none transition-colors font-mono" placeholder="new_table" />
                    </div>
                    <div class="space-y-2">
                        <label class="text-[10px] font-bold uppercase tracking-wider ${mutedText}">Engine</label>
                        <select id="table-engine" class="w-full ${inputClass} rounded p-2.5 text-xs outline-none transition-colors">
                            ${dbType === 'mysql' ? '<option value="InnoDB">InnoDB</option><option value="MyISAM">MyISAM</option><option value="Memory">Memory</option>' : ''}
                            ${dbType === 'postgresql' ? '<option value="">Default</option>' : ''}
                            ${dbType === 'clickhouse' ? '<option value="MergeTree">MergeTree</option><option value="ReplicatedMergeTree">ReplicatedMergeTree</option>' : ''}
                            ${dbType === 'mssql' ? '<option value="">Default</option>' : ''}
                        </select>
                    </div>
                </div>
                
                <div class="space-y-2">
                    <div class="flex items-center justify-between">
                        <label class="text-[10px] font-bold uppercase tracking-wider ${mutedText}">Columns</label>
                        <button id="add-column-btn" class="text-[10px] font-bold text-mysql-teal hover:text-mysql-teal/80 transition-colors flex items-center gap-1">
                            <span class="material-symbols-outlined text-sm">add</span> Add Column
                        </button>
                    </div>
                    <div class="${cardBg} rounded-lg border ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')} overflow-hidden">
                        <table class="w-full text-xs">
                            <thead class="${isLight ? 'bg-gray-100' : (isDawn ? 'bg-[#f2e9e1]' : 'bg-white/5')}">
                                <tr class="${mutedText} text-left uppercase">
                                    <th class="px-3 py-2 font-bold w-1/4">Name</th>
                                    <th class="px-3 py-2 font-bold w-1/4">Type</th>
                                    <th class="px-3 py-2 font-bold w-1/6">Nullable</th>
                                    <th class="px-3 py-2 font-bold w-1/6">Primary</th>
                                    <th class="px-3 py-2 font-bold">Default</th>
                                    <th class="px-3 py-2 w-10"></th>
                                </tr>
                            </thead>
                            <tbody id="columns-body">
                                <tr class="column-row border-t ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">
                                    <td class="px-3 py-2"><input type="text" class="col-name w-full ${inputClass} rounded px-2 py-1 outline-none font-mono" placeholder="id" /></td>
                                    <td class="px-3 py-2">
                                        <select class="col-type w-full ${inputClass} rounded px-2 py-1 outline-none">
                                            <option value="INT">INT</option>
                                            <option value="BIGINT">BIGINT</option>
                                            <option value="VARCHAR(255)">VARCHAR(255)</option>
                                            <option value="TEXT">TEXT</option>
                                            <option value="BOOLEAN">BOOLEAN</option>
                                            <option value="DATE">DATE</option>
                                            <option value="DATETIME">DATETIME</option>
                                            <option value="TIMESTAMP">TIMESTAMP</option>
                                            <option value="DECIMAL(10,2)">DECIMAL(10,2)</option>
                                            <option value="JSON">JSON</option>
                                        </select>
                                    </td>
                                    <td class="px-3 py-2"><input type="checkbox" class="col-nullable" /></td>
                                    <td class="px-3 py-2"><input type="checkbox" class="col-primary" checked /></td>
                                    <td class="px-3 py-2"><input type="text" class="col-default w-full ${inputClass} rounded px-2 py-1 outline-none" placeholder="NULL" /></td>
                                    <td class="px-3 py-2"><button class="remove-col-btn text-red-400 hover:text-red-300 transition-colors"><span class="material-symbols-outlined text-sm">delete</span></button></td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
                
                <div class="space-y-2">
                    <label class="text-[10px] font-bold uppercase tracking-wider ${mutedText}">Table Comment (Optional)</label>
                    <input type="text" id="table-comment" class="w-full ${inputClass} rounded p-2.5 text-xs outline-none transition-colors" placeholder="Description of this table..." />
                </div>
            </div>
            <div class="flex items-center justify-between px-6 py-4 border-t ${headerBg}">
                <div class="text-[10px] ${mutedText}">
                    <span class="text-green-500">✓</span> A primary key column will be auto-incremented by default.
                </div>
                <div class="flex gap-3">
                    <button id="cancel-btn" class="px-4 py-2 text-[10px] font-bold uppercase tracking-wider ${mutedText} hover:text-white transition-colors">
                        Cancel
                    </button>
                    <button id="preview-btn" class="px-4 py-2 bg-white/5 text-white text-[10px] font-bold uppercase tracking-wider rounded-md hover:bg-white/10 transition-colors flex items-center gap-2">
                        <span class="material-symbols-outlined text-sm">visibility</span> Preview SQL
                    </button>
                    <button id="create-btn" class="px-4 py-2 bg-green-500 text-white text-[10px] font-bold uppercase tracking-wider rounded-md hover:brightness-110 transition-colors flex items-center gap-2">
                        <span class="material-symbols-outlined text-sm">add</span> Create Table
                    </button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const closeModal = () => overlay.remove();
    const closeBtn = overlay.querySelector('#close-modal');
    const cancelBtn = overlay.querySelector('#cancel-btn');
    const createBtn = overlay.querySelector('#create-btn');
    const previewBtn = overlay.querySelector('#preview-btn');
    const addColBtn = overlay.querySelector('#add-column-btn');
    const columnsBody = overlay.querySelector('#columns-body');
    const tableNameInput = overlay.querySelector('#table-name');

    closeBtn.onclick = closeModal;
    cancelBtn.onclick = closeModal;
    overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };

    const addColumn = () => {
        const row = document.createElement('tr');
        row.className = `column-row border-t ${isLight ? 'border-gray-200' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}`;
        row.innerHTML = `
            <td class="px-3 py-2"><input type="text" class="col-name w-full ${inputClass} rounded px-2 py-1 outline-none font-mono" placeholder="column_name" /></td>
            <td class="px-3 py-2">
                <select class="col-type w-full ${inputClass} rounded px-2 py-1 outline-none">
                    <option value="INT">INT</option>
                    <option value="BIGINT">BIGINT</option>
                    <option value="VARCHAR(255)">VARCHAR(255)</option>
                    <option value="TEXT">TEXT</option>
                    <option value="BOOLEAN">BOOLEAN</option>
                    <option value="DATE">DATE</option>
                    <option value="DATETIME">DATETIME</option>
                    <option value="TIMESTAMP">TIMESTAMP</option>
                    <option value="DECIMAL(10,2)">DECIMAL(10,2)</option>
                    <option value="JSON">JSON</option>
                </select>
            </td>
            <td class="px-3 py-2"><input type="checkbox" class="col-nullable" checked /></td>
            <td class="px-3 py-2"><input type="checkbox" class="col-primary" /></td>
            <td class="px-3 py-2"><input type="text" class="col-default w-full ${inputClass} rounded px-2 py-1 outline-none" placeholder="NULL" /></td>
            <td class="px-3 py-2"><button class="remove-col-btn text-red-400 hover:text-red-300 transition-colors"><span class="material-symbols-outlined text-sm">delete</span></button></td>
        `;
        columnsBody.appendChild(row);
    };

    const generateSQL = () => {
        const tableName = tableNameInput.value.trim();
        if (!tableName) return null;

        const columns = [];
        const primaryKeys = [];
        
        columnsBody.querySelectorAll('.column-row').forEach(row => {
            const name = row.querySelector('.col-name').value.trim();
            const type = row.querySelector('.col-type').value;
            const nullable = row.querySelector('.col-nullable').checked;
            const primary = row.querySelector('.col-primary').checked;
            const defaultVal = row.querySelector('.col-default').value.trim();

            if (!name) return;

            let colDef = `\`${name}\` ${type}`;
            if (primary && dbType === 'mysql') colDef += ' AUTO_INCREMENT';
            if (!nullable) colDef += ' NOT NULL';
            if (defaultVal && defaultVal.toUpperCase() !== 'NULL') colDef += ` DEFAULT ${defaultVal}`;
            
            columns.push(colDef);
            if (primary) primaryKeys.push(name);
        });

        if (columns.length === 0) return null;

        let sql = `CREATE TABLE \`${tableName}\` (\n`;
        sql += columns.map(c => '  ' + c).join(',\n');
        if (primaryKeys.length > 0) {
            sql += `,\n  PRIMARY KEY (\`${primaryKeys.join('`, `')}\`)`;
        }
        sql += '\n)';
        
        if (dbType === 'mysql') {
            const engine = overlay.querySelector('#table-engine').value;
            if (engine) sql += ` ENGINE=${engine}`;
            sql += ' DEFAULT CHARSET=utf8mb4';
        }

        return sql;
    };

    addColBtn.onclick = addColumn;

    columnsBody.addEventListener('click', (e) => {
        if (e.target.closest('.remove-col-btn')) {
            const row = e.target.closest('.column-row');
            if (columnsBody.querySelectorAll('.column-row').length > 1) {
                row.remove();
            }
        }
    });

    previewBtn.onclick = () => {
        const sql = generateSQL();
        if (!sql) {
            Dialog.alert('Please enter table name and at least one column', 'Input Required');
            return;
        }
        Dialog.showSQL(sql, 'Generated CREATE TABLE');
    };

    createBtn.onclick = async () => {
        const tableName = tableNameInput.value.trim();
        if (!tableName) {
            Dialog.alert('Please enter a table name', 'Input Required');
            return;
        }

        const sql = generateSQL();
        if (!sql) {
            Dialog.alert('Please add at least one column', 'Input Required');
            return;
        }

        try {
            createBtn.innerHTML = '<span class="material-symbols-outlined animate-spin text-sm">sync</span> Creating...';
            createBtn.disabled = true;

            await invoke('execute_query', { query: sql });

            Dialog.alert(`Table "${tableName}" created successfully`, 'Success');
            
            window.dispatchEvent(new CustomEvent('schema:changed', { detail: { database } }));
            
            closeModal();
        } catch (error) {
            Dialog.alert(`Failed to create table: ${error}`, 'Error');
            createBtn.innerHTML = '<span class="material-symbols-outlined text-sm">add</span> Create Table';
            createBtn.disabled = false;
        }
    };

    document.addEventListener('keydown', function escHandler(e) {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', escHandler);
        }
    });

    setTimeout(() => tableNameInput.focus(), 50);
}
