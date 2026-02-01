import { invoke } from '@tauri-apps/api/core';
import { Dialog } from '../components/UI/Dialog.js';
import { ThemeManager } from '../utils/ThemeManager.js';

export function DataTools() {
    let theme = ThemeManager.getCurrentTheme();
    const container = document.createElement('div');
    const getContainerClass = (t) => {
        const isLight = t === 'light';
        const isDawn = t === 'dawn';
        const isOceanic = t === 'oceanic';
        return `flex-1 flex flex-col h-full overflow-auto custom-scrollbar ${isLight ? 'bg-gray-50' : (isDawn ? 'bg-[#fffaf3]' : (isOceanic ? 'bg-ocean-bg' : 'bg-[#0a0c10]'))} p-6 transition-all duration-300`;
    };
    container.className = getContainerClass(theme);

    // State
    let databases = [];
    let tables = [];
    let selectedDb = '';
    let selectedTable = '';
    let activeTab = 'export'; // 'export' | 'import' | 'backup'
    let isProcessing = false;

    // Load databases
    const loadDatabases = async () => {
        try {
            databases = await invoke('get_databases');
            render();
        } catch (error) {
            console.error('Failed to load databases:', error);
        }
    };

    const loadTables = async (db) => {
        if (!db) {
            tables = [];
            render();
            return;
        }
        try {
            tables = await invoke('get_tables', { database: db });
            render();
        } catch (error) {
            console.error('Failed to load tables:', error);
            tables = [];
            render();
        }
    };

    // Export handlers
    const handleExportCSV = async () => {
        if (!selectedDb || !selectedTable) {
            Dialog.alert('Please select a database and table first.', 'Selection Required');
            return;
        }

        const fileName = `${selectedTable}_${new Date().toISOString().slice(0, 10)}.csv`;
        const filePath = await Dialog.prompt('Enter file path to save:', 'Export CSV', `/home/${fileName}`);
        if (!filePath) return;

        isProcessing = true;
        render();

        try {
            const result = await invoke('export_table_csv', {
                database: selectedDb,
                table: selectedTable,
                filePath: filePath,
                includeHeaders: true
            });
            Dialog.alert(result, 'Export Complete');
        } catch (error) {
            Dialog.alert(`Export failed: ${error}`, 'Error');
        } finally {
            isProcessing = false;
            render();
        }
    };

    const handleExportJSON = async () => {
        if (!selectedDb || !selectedTable) {
            Dialog.alert('Please select a database and table first.', 'Selection Required');
            return;
        }

        const fileName = `${selectedTable}_${new Date().toISOString().slice(0, 10)}.json`;
        const filePath = await Dialog.prompt('Enter file path to save:', 'Export JSON', `/home/${fileName}`);
        if (!filePath) return;

        isProcessing = true;
        render();

        try {
            const result = await invoke('export_table_json', {
                database: selectedDb,
                table: selectedTable,
                filePath: filePath
            });
            Dialog.alert(result, 'Export Complete');
        } catch (error) {
            Dialog.alert(`Export failed: ${error}`, 'Error');
        } finally {
            isProcessing = false;
            render();
        }
    };

    const handleExportSQL = async () => {
        if (!selectedDb || !selectedTable) {
            Dialog.alert('Please select a database and table first.', 'Selection Required');
            return;
        }

        const fileName = `${selectedTable}_${new Date().toISOString().slice(0, 10)}.sql`;
        const filePath = await Dialog.prompt('Enter file path to save:', 'Export SQL', `/home/${fileName}`);
        if (!filePath) return;

        isProcessing = true;
        render();

        try {
            const result = await invoke('export_table_sql', {
                database: selectedDb,
                table: selectedTable,
                filePath: filePath,
                includeCreate: true
            });
            Dialog.alert(result, 'Export Complete');
        } catch (error) {
            Dialog.alert(`Export failed: ${error}`, 'Error');
        } finally {
            isProcessing = false;
            render();
        }
    };

    const handleImportCSV = async () => {
        if (!selectedDb || !selectedTable) {
            Dialog.alert('Please select a database and table first.', 'Selection Required');
            return;
        }

        const filePath = await Dialog.prompt('Enter CSV file path to import:', 'Import CSV');
        if (!filePath) return;

        const hasHeaders = await Dialog.confirm('Does the CSV file have headers?', 'CSV Headers');

        isProcessing = true;
        render();

        try {
            const result = await invoke('import_csv', {
                database: selectedDb,
                table: selectedTable,
                filePath: filePath,
                hasHeaders: hasHeaders
            });

            let message = `Imported ${result.rows_imported} rows.`;
            if (result.errors.length > 0) {
                message += `\n\nErrors (${result.errors.length}):\n${result.errors.slice(0, 5).join('\n')}`;
                if (result.errors.length > 5) {
                    message += `\n... and ${result.errors.length - 5} more`;
                }
            }
            Dialog.alert(message, result.success ? 'Import Complete' : 'Import Completed with Errors');
        } catch (error) {
            Dialog.alert(`Import failed: ${error}`, 'Error');
        } finally {
            isProcessing = false;
            render();
        }
    };

    // Backup handlers
    const handleBackup = async () => {
        if (!selectedDb) {
            Dialog.alert('Please select a database first.', 'Selection Required');
            return;
        }

        const fileName = `${selectedDb}_backup_${new Date().toISOString().slice(0, 10)}.sql`;
        const filePath = await Dialog.prompt('Enter file path to save backup:', 'Backup Database', `/home/${fileName}`);
        if (!filePath) return;

        const includeData = await Dialog.confirm('Include table data in backup?', 'Backup Options');

        isProcessing = true;
        render();

        try {
            const result = await invoke('backup_database', {
                database: selectedDb,
                filePath: filePath,
                includeData: includeData
            });
            Dialog.alert(result, 'Backup Complete');
        } catch (error) {
            Dialog.alert(`Backup failed: ${error}`, 'Error');
        } finally {
            isProcessing = false;
            render();
        }
    };

    const handleRestore = async () => {
        const filePath = await Dialog.prompt('Enter SQL file path to restore:', 'Restore Database');
        if (!filePath) return;

        const confirmed = await Dialog.confirm(
            'This will execute all SQL statements in the file. Continue?',
            'Confirm Restore'
        );
        if (!confirmed) return;

        isProcessing = true;
        render();

        try {
            const result = await invoke('restore_database', {
                filePath: filePath
            });
            Dialog.alert(result, 'Restore Complete');
            await loadDatabases();
        } catch (error) {
            Dialog.alert(`Restore failed: ${error}`, 'Error');
        } finally {
            isProcessing = false;
            render();
        }
    };

    const render = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic';

        container.innerHTML = `
            <div class="w-full h-full">
                <!-- Header -->
                <div class="flex items-center justify-between mb-6">
                    <div class="flex items-center gap-4">
                        <div class="w-12 h-12 rounded-xl bg-gradient-to-br ${isDawn ? 'from-[#ea9d34] to-[#eb6f92]' : 'from-mysql-teal to-mysql-cyan'} flex items-center justify-center shadow-lg">
                            <span class="material-symbols-outlined text-white text-2xl">swap_horiz</span>
                        </div>
                        <div>
                            <h1 class="text-xl font-bold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')}">Data Tools</h1>
                            <p class="text-sm ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">Import, Export & Backup</p>
                        </div>
                    </div>
                </div>

                <!-- Tabs -->
                <div class="flex items-center gap-2 mb-6 p-1 rounded-lg ${isLight ? 'bg-gray-100' : (isDawn ? 'bg-[#faf4ed]' : (isOceanic ? 'bg-ocean-panel' : 'bg-white/5'))} w-fit">
                    <button id="tab-export" class="px-6 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'export' ? (isDawn ? 'bg-[#ea9d34] text-[#fffaf3] shadow-lg' : 'bg-mysql-teal text-white shadow-lg') : (isLight ? 'text-gray-600 hover:text-gray-900' : (isDawn ? 'text-[#575279] hover:text-[#286983]' : 'text-gray-400 hover:text-white'))}">
                        <span class="material-symbols-outlined text-base mr-1 align-middle">upload</span>
                        Export
                    </button>
                    <button id="tab-import" class="px-6 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'import' ? (isDawn ? 'bg-[#ea9d34] text-[#fffaf3] shadow-lg' : 'bg-mysql-teal text-white shadow-lg') : (isLight ? 'text-gray-600 hover:text-gray-900' : (isDawn ? 'text-[#575279] hover:text-[#286983]' : 'text-gray-400 hover:text-white'))}">
                        <span class="material-symbols-outlined text-base mr-1 align-middle">download</span>
                        Import
                    </button>
                    <button id="tab-backup" class="px-6 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'backup' ? (isDawn ? 'bg-[#ea9d34] text-[#fffaf3] shadow-lg' : 'bg-mysql-teal text-white shadow-lg') : (isLight ? 'text-gray-600 hover:text-gray-900' : (isDawn ? 'text-[#575279] hover:text-[#286983]' : 'text-gray-400 hover:text-white'))}">
                        <span class="material-symbols-outlined text-base mr-1 align-middle">backup</span>
                        Backup & Restore
                    </button>
                </div>

                <!-- Selection Panel -->
                <div class="grid grid-cols-2 gap-4 mb-6">
                    <div class="space-y-2">
                        <label class="text-[10px] font-black uppercase tracking-[0.2em] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">Database</label>
                        <select id="db-select" class="tactile-select w-full">
                            <option value="">Select database...</option>
                            ${databases.map(db => `<option value="${db}" ${db === selectedDb ? 'selected' : ''}>${db}</option>`).join('')}
                        </select>
                    </div>
                    ${activeTab !== 'backup' ? `
                    <div class="space-y-2">
                        <label class="text-[10px] font-black uppercase tracking-[0.2em] ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">Table</label>
                        <select id="table-select" class="tactile-select w-full" ${!selectedDb ? 'disabled' : ''}>
                            <option value="">Select table...</option>
                            ${tables.map(t => `<option value="${t}" ${t === selectedTable ? 'selected' : ''}>${t}</option>`).join('')}
                        </select>
                    </div>
                    ` : '<div></div>'}
                </div>

                <!-- Content Panel -->
                <div class="rounded-xl ${isLight ? 'bg-white border border-gray-200 shadow-sm' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1]' : (isOceanic ? 'bg-ocean-panel border border-ocean-border/50' : 'bg-[#13161b] border border-white/10'))} p-6">
                    ${isProcessing ? renderProcessing() : renderTabContent()}
                </div>
            </div>
        `;

        attachEvents();
    };

    const renderProcessing = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        return `
            <div class="flex flex-col items-center justify-center py-12">
                <div class="w-16 h-16 rounded-full ${isLight ? 'bg-mysql-teal/10' : (isDawn ? 'bg-[#ea9d34]/20' : 'bg-mysql-teal/20')} flex items-center justify-center mb-4">
                    <span class="material-symbols-outlined text-3xl ${isDawn ? 'text-[#ea9d34]' : 'text-mysql-teal'} animate-spin">progress_activity</span>
                </div>
                <p class="text-lg font-semibold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')}">Processing...</p>
                <p class="text-sm ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">Please wait while the operation completes</p>
            </div>
        `;
    };

    const renderTabContent = () => {
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic';

        if (activeTab === 'export') {
            return `
                <div class="space-y-4">
                    <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')} mb-4">Export Data</h3>
                    <p class="text-sm ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-400')} mb-6">
                        Export table data to various formats. Select a database and table above.
                    </p>
                    
                    <div class="grid grid-cols-3 gap-4">
                        <!-- CSV Export -->
                        <div class="p-4 rounded-lg ${isLight ? 'bg-gray-50 border border-gray-200 hover:border-mysql-teal' : (isDawn ? 'bg-[#faf4ed] border border-[#f2e9e1] hover:border-[#ea9d34]' : (isOceanic ? 'bg-ocean-bg border border-ocean-border hover:border-ocean-frost' : 'bg-white/5 border border-white/10 hover:border-mysql-teal'))} transition-all cursor-pointer group" id="export-csv">
                            <div class="flex items-center gap-3 mb-3">
                                <div class="w-10 h-10 rounded-lg ${isDawn ? 'bg-[#9ccfd8]/20' : 'bg-green-500/20'} flex items-center justify-center">
                                    <span class="material-symbols-outlined ${isDawn ? 'text-[#9ccfd8]' : 'text-green-500'}">csv</span>
                                </div>
                                <div>
                                    <h4 class="font-semibold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')}">CSV</h4>
                                    <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">Comma-separated</p>
                                </div>
                            </div>
                            <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">Export data to CSV format for spreadsheets</p>
                        </div>
                        
                        <!-- JSON Export -->
                        <div class="p-4 rounded-lg ${isLight ? 'bg-gray-50 border border-gray-200 hover:border-mysql-teal' : (isDawn ? 'bg-[#faf4ed] border border-[#f2e9e1] hover:border-[#ea9d34]' : (isOceanic ? 'bg-ocean-bg border border-ocean-border hover:border-ocean-frost' : 'bg-white/5 border border-white/10 hover:border-mysql-teal'))} transition-all cursor-pointer group" id="export-json">
                            <div class="flex items-center gap-3 mb-3">
                                <div class="w-10 h-10 rounded-lg ${isDawn ? 'bg-[#f6c177]/20' : 'bg-yellow-500/20'} flex items-center justify-center">
                                    <span class="material-symbols-outlined ${isDawn ? 'text-[#f6c177]' : 'text-yellow-500'}">data_object</span>
                                </div>
                                <div>
                                    <h4 class="font-semibold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')}">JSON</h4>
                                    <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">JavaScript Object</p>
                                </div>
                            </div>
                            <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">Export data to JSON for APIs and apps</p>
                        </div>
                        
                        <!-- SQL Export -->
                        <div class="p-4 rounded-lg ${isLight ? 'bg-gray-50 border border-gray-200 hover:border-mysql-teal' : (isDawn ? 'bg-[#faf4ed] border border-[#f2e9e1] hover:border-[#ea9d34]' : (isOceanic ? 'bg-ocean-bg border border-ocean-border hover:border-ocean-frost' : 'bg-white/5 border border-white/10 hover:border-mysql-teal'))} transition-all cursor-pointer group" id="export-sql">
                            <div class="flex items-center gap-3 mb-3">
                                <div class="w-10 h-10 rounded-lg ${isDawn ? 'bg-[#c4a7e7]/20' : 'bg-blue-500/20'} flex items-center justify-center">
                                    <span class="material-symbols-outlined ${isDawn ? 'text-[#c4a7e7]' : 'text-blue-500'}">code</span>
                                </div>
                                <div>
                                    <h4 class="font-semibold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')}">SQL</h4>
                                    <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">INSERT Statements</p>
                                </div>
                            </div>
                            <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">Export with CREATE TABLE and INSERT</p>
                        </div>
                    </div>
                </div>
            `;
        }

        if (activeTab === 'import') {
            return `
                <div class="space-y-4">
                    <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')} mb-4">Import Data</h3>
                    <p class="text-sm ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-400')} mb-6">
                        Import data from external files into existing tables.
                    </p>
                    
                    <div class="grid grid-cols-2 gap-4">
                        <!-- CSV Import -->
                        <div class="p-6 rounded-lg ${isLight ? 'bg-gray-50 border border-gray-200 hover:border-mysql-teal' : (isDawn ? 'bg-[#faf4ed] border border-[#f2e9e1] hover:border-[#ea9d34]' : (isOceanic ? 'bg-ocean-bg border border-ocean-border hover:border-ocean-frost' : 'bg-white/5 border border-white/10 hover:border-mysql-teal'))} transition-all cursor-pointer" id="import-csv">
                            <div class="flex items-center gap-4 mb-4">
                                <div class="w-14 h-14 rounded-xl ${isDawn ? 'bg-[#9ccfd8]/20' : 'bg-green-500/20'} flex items-center justify-center">
                                    <span class="material-symbols-outlined text-3xl ${isDawn ? 'text-[#9ccfd8]' : 'text-green-500'}">upload_file</span>
                                </div>
                                <div>
                                    <h4 class="text-lg font-semibold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')}">Import CSV</h4>
                                    <p class="text-sm ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">Import from comma-separated file</p>
                                </div>
                            </div>
                            <ul class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400')} space-y-1">
                                <li>• Supports files with or without headers</li>
                                <li>• Auto-maps columns by order</li>
                                <li>• Reports import errors</li>
                            </ul>
                        </div>
                        
                        <!-- Placeholder for future formats -->
                        <div class="p-6 rounded-lg ${isLight ? 'bg-gray-50 border border-gray-200' : (isDawn ? 'bg-[#faf4ed]/50 border border-[#f2e9e1]/50' : (isOceanic ? 'bg-ocean-bg/50 border border-ocean-border/50' : 'bg-white/5 border border-white/10'))} opacity-50">
                            <div class="flex items-center gap-4 mb-4">
                                <div class="w-14 h-14 rounded-xl ${isDawn ? 'bg-[#c4a7e7]/20' : 'bg-purple-500/20'} flex items-center justify-center">
                                    <span class="material-symbols-outlined text-3xl ${isDawn ? 'text-[#c4a7e7]' : 'text-purple-500'}">table_view</span>
                                </div>
                                <div>
                                    <h4 class="text-lg font-semibold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')}">Import Excel</h4>
                                    <p class="text-sm ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#9893a5]' : 'text-gray-400')}">Coming soon</p>
                                </div>
                            </div>
                            <p class="text-xs ${isLight ? 'text-gray-500' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">Support for .xlsx files will be added in a future update.</p>
                        </div>
                    </div>
                </div>
            `;
        }

        if (activeTab === 'backup') {
            return `
                <div class="space-y-4">
                    <h3 class="text-lg font-semibold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')} mb-4">Backup & Restore</h3>
                    <p class="text-sm ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-400')} mb-6">
                        Create full database backups or restore from existing backup files.
                    </p>
                    
                    <div class="grid grid-cols-2 gap-6">
                        <!-- Backup -->
                        <div class="p-6 rounded-xl ${isLight ? 'bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1]' : (isOceanic ? 'bg-gradient-to-br from-ocean-accent/10 to-ocean-frost/10 border border-ocean-frost/30' : 'bg-gradient-to-br from-mysql-teal/10 to-mysql-cyan/10 border border-mysql-teal/30'))} cursor-pointer transition-all hover:scale-[1.02]" id="btn-backup">
                            <div class="flex items-center gap-4 mb-4">
                                <div class="w-16 h-16 rounded-2xl ${isDawn ? 'bg-[#31748f] text-[#fffaf3]' : 'bg-gradient-to-br from-blue-500 to-blue-600'} flex items-center justify-center shadow-lg">
                                    <span class="material-symbols-outlined text-4xl ${isDawn ? 'text-[#fffaf3]' : 'text-white'}">backup</span>
                                </div>
                                <div>
                                    <h4 class="text-xl font-bold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')}">Create Backup</h4>
                                    <p class="text-sm ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">Full database export</p>
                                </div>
                            </div>
                            <ul class="text-sm ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-400')} space-y-2">
                                <li class="flex items-center gap-2">
                                    <span class="material-symbols-outlined text-sm ${isDawn ? 'text-[#31748f]' : 'text-green-500'}">check_circle</span>
                                    Tables, Views, Triggers
                                </li>
                                <li class="flex items-center gap-2">
                                    <span class="material-symbols-outlined text-sm ${isDawn ? 'text-[#31748f]' : 'text-green-500'}">check_circle</span>
                                    Stored Procedures & Functions
                                </li>
                                <li class="flex items-center gap-2">
                                    <span class="material-symbols-outlined text-sm ${isDawn ? 'text-[#31748f]' : 'text-green-500'}">check_circle</span>
                                    Optional: Include data
                                </li>
                            </ul>
                        </div>
                        
                        <!-- Restore -->
                        <div class="p-6 rounded-xl ${isLight ? 'bg-gradient-to-br from-orange-50 to-orange-100 border border-orange-200' : (isDawn ? 'bg-[#fffaf3] border border-[#f2e9e1]' : (isOceanic ? 'bg-gradient-to-br from-orange-500/10 to-yellow-500/10 border border-orange-500/30' : 'bg-gradient-to-br from-orange-500/10 to-yellow-500/10 border border-orange-500/30'))} cursor-pointer transition-all hover:scale-[1.02]" id="btn-restore">
                            <div class="flex items-center gap-4 mb-4">
                                <div class="w-16 h-16 rounded-2xl ${isDawn ? 'bg-[#ea9d34] text-[#fffaf3]' : 'bg-gradient-to-br from-orange-500 to-yellow-500'} flex items-center justify-center shadow-lg">
                                    <span class="material-symbols-outlined text-4xl text-white">restore</span>
                                </div>
                                <div>
                                    <h4 class="text-xl font-bold ${isLight ? 'text-gray-900' : (isDawn ? 'text-[#575279]' : 'text-white')}">Restore Backup</h4>
                                    <p class="text-sm ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-400')}">Import from SQL file</p>
                                </div>
                            </div>
                            <ul class="text-sm ${isLight ? 'text-gray-600' : (isDawn ? 'text-[#797593]' : 'text-gray-400')} space-y-2">
                                <li class="flex items-center gap-2">
                                    <span class="material-symbols-outlined text-sm ${isDawn ? 'text-[#ea9d34]' : 'text-yellow-500'}">warning</span>
                                    Execute all SQL statements
                                </li>
                                <li class="flex items-center gap-2">
                                    <span class="material-symbols-outlined text-sm ${isDawn ? 'text-[#31748f]' : 'text-green-500'}">check_circle</span>
                                    Supports TactileSQL backups
                                </li>
                                <li class="flex items-center gap-2">
                                    <span class="material-symbols-outlined text-sm ${isDawn ? 'text-[#31748f]' : 'text-green-500'}">check_circle</span>
                                    mysqldump compatible
                                </li>
                            </ul>
                        </div>
                    </div>
                </div>
            `;
        }
    };

    const attachEvents = () => {
        // Tab switching
        container.querySelector('#tab-export')?.addEventListener('click', () => {
            activeTab = 'export';
            render();
        });
        container.querySelector('#tab-import')?.addEventListener('click', () => {
            activeTab = 'import';
            render();
        });
        container.querySelector('#tab-backup')?.addEventListener('click', () => {
            activeTab = 'backup';
            render();
        });

        // Database selection
        container.querySelector('#db-select')?.addEventListener('change', (e) => {
            selectedDb = e.target.value;
            selectedTable = '';
            loadTables(selectedDb);
        });

        // Table selection
        container.querySelector('#table-select')?.addEventListener('change', (e) => {
            selectedTable = e.target.value;
            render();
        });

        // Export buttons
        container.querySelector('#export-csv')?.addEventListener('click', handleExportCSV);
        container.querySelector('#export-json')?.addEventListener('click', handleExportJSON);
        container.querySelector('#export-sql')?.addEventListener('click', handleExportSQL);

        // Import button
        container.querySelector('#import-csv')?.addEventListener('click', handleImportCSV);

        // Backup/Restore buttons
        container.querySelector('#btn-backup')?.addEventListener('click', handleBackup);
        container.querySelector('#btn-restore')?.addEventListener('click', handleRestore);
    };

    // Theme handling
    const onThemeChange = (e) => {
        theme = e.detail.theme;
        container.className = getContainerClass(theme);
        render();
    };
    window.addEventListener('themechange', onThemeChange);

    container.onUnmount = () => {
        window.removeEventListener('themechange', onThemeChange);
    };

    // Initialize - render first, then load data
    render();
    loadDatabases();

    return container;
}
