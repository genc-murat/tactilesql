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
        const { isLight, isDawn, isNordVariant: isNord, isNeon, theme } = ThemeManager.getThemeFlags();
        const isEmber = theme === 'ember';
        const isAurora = theme === 'aurora';

        const selectedItem = this.items.find(item => String(item.value) === String(this.value));
        const displayLabel = selectedItem ? selectedItem.label : this.placeholder;

        // Theme-specific colors
        const accentColor = isDawn ? 'text-[#ea9d34]' : (isNord ? 'text-ocean-frost' : (isEmber ? 'text-ember-accent' : (isAurora ? 'text-aurora-accent' : (isNeon ? 'text-cyan-400' : 'text-mysql-teal'))));
        const triggerBg = isLight ? 'bg-white border-gray-200 text-gray-800' : (isDawn ? 'bg-[#faf4ed] border-[#f2e9e1] text-[#575279]' : (isNeon ? 'bg-neon-panel/20 border-neon-border/40 text-neon-text' : (isNord ? 'bg-ocean-panel border-ocean-border/50 text-ocean-text' : 'bg-black/20 border-white/10 text-gray-300')));

        this.container.innerHTML = `
            <button class="custom-dropdown-trigger w-full flex items-center justify-between px-3 py-1.5 text-xs ${triggerBg} rounded-lg border transition-all outline-none focus:border-mysql-teal shadow-sm group">
                <div class="flex items-center gap-2 truncate">
                    ${selectedItem?.icon ? `<span class="material-symbols-outlined text-sm ${accentColor}">${selectedItem.icon}</span>` : ''}
                    <span class="truncate">${displayLabel}</span>
                </div>
                <span class="material-symbols-outlined ${isNeon ? 'text-neon-text/40 group-hover:text-cyan-400' : 'text-gray-500 group-hover:text-mysql-teal'} transition-transform duration-200 dropdown-arrow">expand_more</span>
            </button>
            <div class="custom-dropdown-panel hidden absolute top-full left-0 right-0 mt-2 ${isLight ? 'bg-white border-gray-100 shadow-2xl' : (isDawn ? 'bg-[#fffaf3] border-[#f2e9e1] shadow-2xl' : (isNeon ? 'bg-neon-bg/95 border-neon-border/40 shadow-[0_0_30px_rgba(0,0,0,0.5)]' : 'bg-[#1a1d23] border-white/10 shadow-2xl'))} rounded-xl overflow-hidden z-[100] backdrop-blur-xl transition-all duration-200 transform origin-top scale-95 opacity-0">
                ${this.searchable ? `
                    <div class="p-2 border-b ${isLight ? 'border-gray-50' : (isDawn ? 'border-[#f2e9e1]' : 'border-white/5')}">
                        <div class="relative">
                            <span class="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-[14px] ${isNeon ? 'text-cyan-400/60' : 'text-gray-500'}">search</span>
                            <input type="text" class="custom-dropdown-search w-full ${isNeon ? 'bg-neon-panel/20 text-neon-text placeholder:text-neon-text/30' : 'bg-black/5 ' + (isLight ? 'text-gray-800' : 'text-white')} border-none rounded-md pl-7 pr-2 py-1 text-[11px] outline-none focus:ring-1 ${isNeon ? 'focus:ring-cyan-400/50' : 'focus:ring-mysql-teal/50'}" placeholder="Search...">
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
        const { isLight, isDawn, isNordVariant: isNord, isNeon, theme } = ThemeManager.getThemeFlags();
        const isEmber = theme === 'ember';
        const isAurora = theme === 'aurora';

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
                const groupHeaderColor = isLight ? 'text-gray-400' : (isNeon ? 'text-neon-pink/60' : (isEmber ? 'text-ember-accent/40' : (isAurora ? 'text-aurora-accent/40' : (isNord ? 'text-ocean-text/40' : 'text-gray-600'))));
                groupHeader.className = `px-3 py-1.5 text-[9px] font-black uppercase tracking-widest ${groupHeaderColor} mt-1 first:mt-0`;
                groupHeader.textContent = groupName;
                this.optionsList.appendChild(groupHeader);
            }

            groups[groupName].forEach(item => {
                const isSelected = String(item.value) === String(this.value);
                const option = document.createElement('div');

                // Active/Hover colors
                const activeBg = isLight ? 'bg-mysql-teal/10 text-mysql-teal' : (isNeon ? 'bg-cyan-400/20 text-cyan-400' : (isEmber ? 'bg-ember-accent/20 text-ember-accent' : (isAurora ? 'bg-aurora-accent/20 text-aurora-accent' : (isNord ? 'bg-ocean-frost/20 text-ocean-frost' : 'bg-mysql-teal/20 text-mysql-teal'))));
                const hoverBg = isLight ? 'hover:bg-gray-50' : (isNeon ? 'hover:bg-neon-panel/20 hover:text-neon-text' : (isNord || isEmber || isAurora ? 'hover:bg-white/5' : 'hover:bg-white/5'));
                const textColor = isLight ? 'text-gray-700' : (isNeon ? 'text-neon-text/70' : (isNord || isEmber || isAurora ? 'text-ocean-text' : 'text-gray-300'));

                option.className = `custom-dropdown-option px-3 py-2 flex items-center justify-between cursor-pointer rounded-lg transition-colors ${isSelected ? activeBg + ' font-bold' : textColor + ' ' + hoverBg}`;
                option.dataset.value = item.value;

                const checkColor = isNeon ? 'text-cyan-400' : (isNord ? 'text-ocean-frost' : (isEmber ? 'text-ember-accent' : (isAurora ? 'text-aurora-accent' : 'text-mysql-teal')));
                const iconColor = isNeon ? 'text-neon-pink' : (isNord ? 'text-ocean-frost/80' : (isEmber ? 'text-ember-accent/80' : (isAurora ? 'text-aurora-accent/80' : '')));

                option.innerHTML = `
                    <div class="flex items-center gap-2 truncate">
                        ${item.icon ? `<span class="material-symbols-outlined text-sm ${iconColor}">${item.icon}</span>` : ''}
                        <span class="text-xs truncate">${item.label}</span>
                    </div>
                    ${isSelected ? `<span class="material-symbols-outlined ${checkColor} text-base">check_circle</span>` : ''}
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
