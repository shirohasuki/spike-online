/**
 * ELF分析器UI组件 - 简化版
 */
class ELFAnalyzerUI {
    constructor() {
        this.analyzer = new ELFAnalyzer();
        this.initializeUI();
    }
    
    isVisible() {
        const panel = document.getElementById('elf-analyzer-panel');
        return panel && panel.style.display !== 'none';
    }

    initializeUI() {
        this.createAnalyzerPanel();
        this.bindEvents();
    }

    createAnalyzerPanel() {
        const panel = document.getElementById('elf-analyzer-panel');
        if (!panel) return;
        
        const panelContent = panel.querySelector('.panel-content');
        if (!panelContent) return;
        
        panelContent.innerHTML = `
            <div class="elf-analyzer-container">
                ${this.renderAnalysisResults()}
            </div>
        `;
    }

    renderAnalysisResults() {
        return `
            <div class="analysis-results" id="analysis-results">
                <h4>🔥 热点分析结果</h4>
                
                <div class="analysis-tabs">
                    <button class="tab-btn" data-tab="disassembly">反汇编代码</button>
                    <button class="tab-btn" data-tab="hotspots">执行热点</button>
                </div>
                
                <div class="tab-content">
                    <div id="disassembly-tab" class="tab-pane">
                        <div class="disassembly-controls">
                            <div class="control-group">
                                <label>显示模式:</label>
                                <select id="disassembly-mode">
                                    <option value="executed">已执行指令</option>
                                    <option value="hottest">热点指令 (Top 50)</option>
                                </select>
                            </div>
                            <button id="refresh-disassembly" class="btn btn-small">🔄 刷新</button>
                        </div>
                        <div id="disassembly-content" class="disassembly-view"></div>
                    </div>
                    
                    <div id="hotspots-tab" class="tab-pane">
                        <div class="hotspots-controls">
                            <div class="control-group">
                                <label>显示数量:</label>
                                <select id="hotspots-count">
                                    <option value="20">前20条</option>
                                    <option value="50">前50条</option>
                                </select>
                            </div>
                            <button id="refresh-hotspots" class="btn btn-small">🔄 刷新</button>
                            <button id="export-hotspots" class="btn btn-small">📊 导出</button>
                        </div>
                        <div id="hotspots-content"></div>
                    </div>
                </div>
            </div>
        `;
    }

    bindEvents() {
        setTimeout(() => {
            // 标签页切换
            document.querySelectorAll('.tab-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    this.switchTab(e.target.dataset.tab);
                });
            });

            // 反汇编控件
            const refreshDisBtn = document.getElementById('refresh-disassembly');
            const modeSelect = document.getElementById('disassembly-mode');
            if (refreshDisBtn) refreshDisBtn.addEventListener('click', () => this.refreshDisassembly());
            if (modeSelect) modeSelect.addEventListener('change', () => this.refreshDisassembly());
            
            // 热点控件
            const refreshHotBtn = document.getElementById('refresh-hotspots');
            const countSelect = document.getElementById('hotspots-count');
            const exportBtn = document.getElementById('export-hotspots');
            if (refreshHotBtn) refreshHotBtn.addEventListener('click', () => this.refreshHotspots());
            if (countSelect) countSelect.addEventListener('change', () => this.refreshHotspots());
            if (exportBtn) exportBtn.addEventListener('click', () => this.exportHotspots());
        }, 100);
    }

    switchTab(tabName) {
        // 更新标签按钮状态
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        const activeBtn = document.querySelector(`[data-tab="${tabName}"]`);
        if (activeBtn) activeBtn.classList.add('active');
        
        // 显示对应内容
        document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
        const activePane = document.getElementById(`${tabName}-tab`);
        if (activePane) activePane.classList.add('active');
        
        // 刷新内容
        if (tabName === 'disassembly') {
            this.refreshDisassembly();
        } else if (tabName === 'hotspots') {
            this.refreshHotspots();
        }
    }

    refreshDisassembly() {
        const content = document.getElementById('disassembly-content');
        if (!content || !this.isVisible()) return;
        
        const mode = document.getElementById('disassembly-mode')?.value || 'executed';
        const instructions = this.getInstructionsForDisplay(mode);
        
        content.innerHTML = `
            <div class="disassembly-table">
                <div class="disassembly-header">
                    <div class="col-addr">地址</div>
                    <div class="col-instruction">指令</div>
                    <div class="col-executions">执行次数</div>
                    <div class="col-hotness">热度</div>
                </div>
                <div class="disassembly-body">
                    ${instructions.map(inst => this.renderInstructionRow(inst)).join('')}
                </div>
            </div>
        `;
    }

    refreshHotspots() {
        const content = document.getElementById('hotspots-content');
        if (!content || !this.isVisible()) return;
        
        const count = parseInt(document.getElementById('hotspots-count')?.value || '20');
        const hotspots = this.getHotspotsData(count);
        
        content.innerHTML = `
            <div class="hotspots-table">
                <div class="hotspots-header">
                    <div class="col-rank">#</div>
                    <div class="col-addr">地址</div>
                    <div class="col-instruction">指令</div>
                    <div class="col-executions">执行次数</div>
                    <div class="col-hotness">热度条</div>
                </div>
                <div class="hotspots-body">
                    ${hotspots.length > 0 ? hotspots.map((hotspot, index) => this.renderHotspotRow(hotspot, index + 1)).join('') : '<div class="no-data">暂无执行数据</div>'}
                </div>
            </div>
        `;
    }

    exportHotspots() {
        const count = parseInt(document.getElementById('hotspots-count')?.value || '20');
        const hotspots = this.getHotspotsData(count);
        
        const csvContent = 'data:text/csv;charset=utf-8,' + 
            'Rank,Address,Instruction,Executions\n' +
            hotspots.map((h, i) => 
                `${i+1},${h.address},${h.instruction},${h.executions}`
            ).join('\n');
        
        const link = document.createElement('a');
        link.setAttribute('href', encodeURI(csvContent));
        link.setAttribute('download', 'hotspots_analysis.csv');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    getInstructionsForDisplay(mode) {
        if (!this.analyzer?.getAllInstructions) return [];
        
        const allInstructions = this.analyzer.getAllInstructions();
        
        switch(mode) {
            case 'hottest':
                const hotspots = this.analyzer.getInstructionHotspots?.() || [];
                return Array.isArray(hotspots) ? hotspots.slice(0, 50) : [];
            default:
                return allInstructions.filter(inst => inst.executions > 0).slice(0, 200);
        }
    }

    getHotspotsData(count) {
        if (!this.analyzer?.getInstructionHotspots) return [];
        
        const hotspots = this.analyzer.getInstructionHotspots();
        return Array.isArray(hotspots) ? hotspots.slice(0, count) : [];
    }

    renderInstructionRow(inst) {
        const hotnessPercent = Math.min(100, (inst.executions || 0) / 10);
        
        return `
            <div class="instruction-row executed">
                <div class="col-addr">${inst.address}</div>
                <div class="col-instruction">${inst.mnemonic || inst.instruction}</div>
                <div class="col-executions">${inst.executions || 0}</div>
                <div class="col-hotness">
                    <div class="hotness-bar">
                        <div class="hotness-fill" style="width: ${hotnessPercent}%"></div>
                    </div>
                </div>
            </div>
        `;
    }

    renderHotspotRow(hotspot, rank) {
        const maxExecution = this.getHotspotsData(1)[0]?.executions || 1;
        const percentage = ((hotspot.executions || 0) / maxExecution * 100).toFixed(1);
        
        return `
            <div class="hotspot-row">
                <div class="col-rank">${rank}</div>
                <div class="col-addr">${hotspot.address}</div>
                <div class="col-instruction">${hotspot.mnemonic || hotspot.instruction}</div>
                <div class="col-executions">${hotspot.executions || 0}</div>
                <div class="col-hotness">
                    <div class="hotness-bar">
                        <div class="hotness-fill" style="width: ${percentage}%"></div>
                    </div>
                </div>
            </div>
        `;
    }

    // 外部接口方法
    refreshAllTabs() {
        this.refreshDisassembly();
        this.refreshHotspots();
    }

    updatePerformanceData(pc, perfData) {
        if (this.analyzer) {
            this.analyzer.updatePerformanceData(pc, perfData);
        }
    }

    updateAllPerformanceData(performanceStats) {
        if (this.analyzer) {
            this.analyzer.updateAllPerformanceData?.(performanceStats);
        }
    }
}

// 导出类
if (typeof window !== 'undefined') {
    window.ELFAnalyzerUI = ELFAnalyzerUI;
}
