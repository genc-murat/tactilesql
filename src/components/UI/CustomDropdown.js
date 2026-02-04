import { ThemeManager } from '../../utils/ThemeManager.js';

/**
 * CustomDropdown
 * A premium, searchable, theme-aware dropdown component to replace native <select> elements.
 */
export class CustomDropdown {
    constructor(options = {}) {
        this.id = options.id || `custom-dropdown-${Math.random().toString(36).substr(2, 9)}`;
        this.placeholder = options.placeholder || 'Select option...';
        this.items = options.items || []; // Array of { value, label, group, icon }
        this.value = options.value || '';
        this.onSelect = options.onSelect || (() => { });
        this.searchable = options.searchable !== undefined ? options.searchable : true;
        this.className = options.className || '';

        this.isOpen = false;
        this.container = null;
        this.trigger = null;
        this.panel = null;
        this.searchInput = null;
        this.optionsList = null;

        this.init();
    }

    init() {
        this.container = document.createElement('div');
        this.container.id = this.id;
        this.container.className = `relative inline-block w-full ${this.className}`;

        this.render();
        this.attachEvents();
    }

    render() {
        const theme = ThemeManager.getCurrentTheme();
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';
        const isOceanic = theme === 'oceanic' || theme === 'ember' || theme === 'aurora';

        const selectedItem = this.items.find(item => String(item.value) === String(this.value));
        const displayLabel = selectedItem ? selectedItem.label : this.placeholder;

        this.container.innerHTML = `
            <button class="custom-dropdown-trigger w-full flex items-center justify-between px-3 py-1.5 text-xs ${isLight ? 'bg-white border-gray-200 text-gray-800' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : 'bg-black/20 border-white/10 text-gray-300')} rounded-lg border transition-all outline-none focus:border-mysql-teal shadow-sm group">
                <div class="flex items-center gap-2 truncate">
                    ${selectedItem?.icon ? `<span class="material-symbols-outlined text-sm ${isDawn ? 'text-[#ea9d34]' : 'text-mysql-teal'}">${selectedItem.icon}</span>` : ''}
                    <span class="truncate">${displayLabel}</span>
                </div>
                <span class="material-symbols-outlined text-gray-500 group-hover:text-mysql-teal transition-transform duration-200 dropdown-arrow">expand_more</span>
            </button>
            <div class="custom-dropdown-panel hidden absolute top-full left-0 right-0 mt-2 ${isLight ? 'bg-white border-gray-100 shadow-2xl' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] shadow-2xl' : 'bg-[#1a1d23] border-white/10 shadow-2xl')} rounded-xl overflow-hidden z-[100] backdrop-blur-xl transition-all duration-200 transform origin-top scale-95 opacity-0">
                ${this.searchable ? `
                    <div class="p-2 border-b ${isLight ? 'border-gray-50' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">
                        <div class="relative">
                            <span class="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-[14px] text-gray-500">search</span>
                            <input type="text" class="custom-dropdown-search w-full bg-black/5 ${isLight ? 'text-gray-800' : 'text-white'} border-none rounded-md pl-7 pr-2 py-1 text-[11px] outline-none focus:ring-1 focus:ring-mysql-teal/50" placeholder="Search...">
                        </div>
                    </div>
                ` : ''}
                <div class="custom-dropdown-options max-h-60 overflow-y-auto custom-scrollbar p-1">
                    <!-- Options injected here -->
                </div>
            </div>
        `;

        this.trigger = this.container.querySelector('.custom-dropdown-trigger');
        this.panel = this.container.querySelector('.custom-dropdown-panel');
        this.searchInput = this.container.querySelector('.custom-dropdown-search');
        this.optionsList = this.container.querySelector('.custom-dropdown-options');

        this.renderOptions();
    }

    renderOptions(filter = '') {
        const theme = ThemeManager.getCurrentTheme();
        const isLight = theme === 'light';
        const isDawn = theme === 'dawn';

        this.optionsList.innerHTML = '';

        const filteredItems = filter
            ? this.items.filter(item => item.label.toLowerCase().includes(filter.toLowerCase()))
            : this.items;

        if (filteredItems.length === 0) {
            this.optionsList.innerHTML = `<div class="px-3 py-4 text-center text-[10px] text-gray-500">No results found</div>`;
            return;
        }

        // Grouping logic
        const groups = {};
        filteredItems.forEach(item => {
            const groupName = item.group || 'default';
            if (!groups[groupName]) groups[groupName] = [];
            groups[groupName].push(item);
        });

        Object.keys(groups).forEach(groupName => {
            if (groupName !== 'default') {
                const groupHeader = document.createElement('div');
                groupHeader.className = `px-3 py-1.5 text-[9px] font-black uppercase tracking-widest ${isLight ? 'text-gray-400' : 'text-gray-600'} mt-1 first:mt-0`;
                groupHeader.textContent = groupName;
                this.optionsList.appendChild(groupHeader);
            }

            groups[groupName].forEach(item => {
                const isSelected = String(item.value) === String(this.value);
                const option = document.createElement('div');
                option.className = `custom-dropdown-option px-3 py-2 flex items-center justify-between cursor-pointer rounded-lg transition-colors ${isSelected ? (isLight ? 'bg-mysql-teal/10 text-mysql-teal font-bold' : 'bg-mysql-teal/20 text-mysql-teal font-bold') : (isLight ? 'text-gray-700 hover:bg-gray-50' : 'text-gray-300 hover:bg-white/5')}`;
                option.dataset.value = item.value;

                option.innerHTML = `
                    <div class="flex items-center gap-2 truncate">
                        ${item.icon ? `<span class="material-symbols-outlined text-sm">${item.icon}</span>` : ''}
                        <span class="text-xs truncate">${item.label}</span>
                    </div>
                    ${isSelected ? '<span class="material-symbols-outlined text-mysql-teal text-base">check_circle</span>' : ''}
                `;

                option.addEventListener('click', () => {
                    this.value = item.value;
                    this.onSelect(item.value, item);
                    this.close();
                    this.render(); // Update label
                });

                this.optionsList.appendChild(option);
            });
        });
    }

    attachEvents() {
        this.trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            this.isOpen ? this.close() : this.open();
        });

        if (this.searchInput) {
            this.searchInput.addEventListener('input', (e) => {
                this.renderOptions(e.target.value);
            });
            this.searchInput.addEventListener('click', (e) => e.stopPropagation());
        }

        // Close on click outside
        const handleOutsideClick = (e) => {
            if (this.isOpen && !this.container.contains(e.target)) {
                this.close();
            }
        };

        document.addEventListener('mousedown', handleOutsideClick);
        this.container.onUnmount = () => {
            document.removeEventListener('mousedown', handleOutsideClick);
        };
    }

    open() {
        this.isOpen = true;
        this.panel.classList.remove('hidden');
        // Force reflow for animation
        void this.panel.offsetWidth;
        this.panel.classList.remove('opacity-0', 'scale-95');
        this.panel.classList.add('opacity-100', 'scale-100');

        const arrow = this.container.querySelector('.dropdown-arrow');
        if (arrow) arrow.style.transform = 'rotate(180deg)';

        if (this.searchInput) {
            setTimeout(() => this.searchInput.focus(), 50);
        }

        // Close other dropdowns if any (using a pattern)
        document.querySelectorAll('.custom-dropdown-panel').forEach(p => {
            if (p !== this.panel) {
                p.classList.add('hidden', 'opacity-0', 'scale-95');
                p.classList.remove('opacity-100', 'scale-100');
            }
        });
    }

    close() {
        this.isOpen = false;
        this.panel.classList.add('opacity-0', 'scale-95');
        this.panel.classList.remove('opacity-100', 'scale-100');

        const arrow = this.container.querySelector('.dropdown-arrow');
        if (arrow) arrow.style.transform = '';

        setTimeout(() => {
            if (!this.isOpen) this.panel.classList.add('hidden');
        }, 200);
    }

    setValue(val) {
        this.value = val;
        this.render();
    }

    setItems(items) {
        this.items = items;
        this.render();
    }

    getElement() {
        return this.container;
    }
}
