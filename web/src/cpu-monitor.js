/**
 * CPU性能监控器 - 专注于性能指标
 */
class CPUMonitor {
    constructor() {
        this.isRunning = false;
        this.updateCounter = 0;
        
        // 性能相关统计
        this.performanceStats = {
            // 基础性能指标
            totalInstructions: 0,
            totalCycles: 0,
            cpi: 0,
            ipc: 0,
            
            // 缓存性能
            icacheHits: 0,
            icacheMisses: 0,
            dcacheHits: 0,
            dcacheMisses: 0,
            icacheHitRate: 0,
            dcacheHitRate: 0,
            
            // 分支预测性能
            branchCount: 0,
            branchMispredictions: 0,
            branchPredictionRate: 0,
            
            // 流水线性能
            stallCycles: 0,
            executionEfficiency: 0,
            
            // 内存访问性能
            memoryAccessCount: 0,
            memoryAccessCycles: 0,
            avgMemoryLatency: 0
        };
        
        // 指令区间分析
        this.instructionRegions = new Map(); // PC范围 -> 性能统计
        this.currentRegion = null;
        this.regionStartPC = 0;
        this.regionStartCycles = 0;
        
        // 热点分析
        this.pcHotspots = new Map();
        this.performanceHotspots = new Map(); // PC -> CPI
        
        // 历史数据
        this.performanceHistory = [];
        this.maxHistorySize = 100;
    }

    /**
     * 从处理器状态更新监控数据
     */
    updateFromState(state) {
        if (!state || !this.isRunning) return;
        
        this.updateCounter++;
        
        // 更新基础性能指标
        this.updateBasicPerformance(state);
        
        // 更新缓存性能
        this.updateCachePerformance(state);
        
        // 更新指令区间分析
        this.updateInstructionRegions(state);
        
        // 更新热点分析
        this.updateHotspots(state);
        
        // 记录历史数据
        this.recordHistory();
    }

    updateBasicPerformance(state) {
        const prevInstructions = this.performanceStats.totalInstructions;
        const prevCycles = this.performanceStats.totalCycles;
        
        this.performanceStats.totalInstructions = state.minstret || 0;
        this.performanceStats.totalCycles = state.mcycle || 0;
        
        if (this.performanceStats.totalInstructions > 0) {
            this.performanceStats.cpi = this.performanceStats.totalCycles / this.performanceStats.totalInstructions;
            this.performanceStats.ipc = this.performanceStats.totalInstructions / this.performanceStats.totalCycles;
        }
        
        // 计算执行效率（基于指令与周期的增长比例）
        const instDelta = this.performanceStats.totalInstructions - prevInstructions;
        const cycleDelta = this.performanceStats.totalCycles - prevCycles;
        
        if (cycleDelta > 0) {
            this.performanceStats.executionEfficiency = (instDelta / cycleDelta) * 100;
        }
    }

    updateCachePerformance(state) {
        // 使用服务器提供的真实缓存数据
        if (state.icacheAccess !== undefined && state.icacheMiss !== undefined) {
            this.performanceStats.icacheHits = state.icacheAccess - state.icacheMiss;
            this.performanceStats.icacheMisses = state.icacheMiss;
            
            if (state.icacheAccess > 0) {
                this.performanceStats.icacheHitRate = (this.performanceStats.icacheHits / state.icacheAccess) * 100;
            }
        }
        
        if (state.dcacheAccess !== undefined && state.dcacheMiss !== undefined) {
            this.performanceStats.dcacheHits = state.dcacheAccess - state.dcacheMiss;
            this.performanceStats.dcacheMisses = state.dcacheMiss;
            
            if (state.dcacheAccess > 0) {
                this.performanceStats.dcacheHitRate = (this.performanceStats.dcacheHits / state.dcacheAccess) * 100;
            }
        }
        
        // 更新内存访问统计
        if (state.memoryAccess !== undefined) {
            this.performanceStats.memoryAccessCount = state.dcacheAccess || 0;
        }
    }

    updateInstructionRegions(state) {
        if (!state.pc) return;
        
        const pc = state.pc;
        const cycles = state.mcycle || 0;
        
        // 检测是否进入新的指令区间（基于PC跳跃）
        if (this.currentRegion && Math.abs(pc - this.currentRegion.lastPC) > 0x100) {
            // 结束当前区间
            this.finishCurrentRegion(cycles);
            this.startNewRegion(pc, cycles);
        } else if (!this.currentRegion) {
            // 开始第一个区间
            this.startNewRegion(pc, cycles);
        } else {
            // 更新当前区间
            this.currentRegion.lastPC = pc;
            this.currentRegion.instructionCount++;
            this.currentRegion.endCycles = cycles;
        }
    }

    startNewRegion(pc, cycles) {
        this.currentRegion = {
            startPC: pc,
            lastPC: pc,
            startCycles: cycles,
            endCycles: cycles,
            instructionCount: 1,
            regionId: `region_${pc.toString(16)}_${Date.now()}`
        };
    }

    finishCurrentRegion(cycles) {
        if (!this.currentRegion) return;
        
        const region = this.currentRegion;
        const cyclesSpent = cycles - region.startCycles;
        const regionKey = `${region.startPC.toString(16)}-${region.lastPC.toString(16)}`;
        
        const regionStats = {
            startPC: region.startPC,
            endPC: region.lastPC,
            instructionCount: region.instructionCount,
            cyclesSpent: cyclesSpent,
            cpi: region.instructionCount > 0 ? cyclesSpent / region.instructionCount : 0,
            timestamp: Date.now()
        };
        
        this.instructionRegions.set(regionKey, regionStats);
        
        // 限制区间数量
        if (this.instructionRegions.size > 50) {
            const oldestKey = this.instructionRegions.keys().next().value;
            this.instructionRegions.delete(oldestKey);
        }
    }

    updateHotspots(state) {
        if (state.pc) {
            const pcStr = state.pc.toString(16);
            this.pcHotspots.set(pcStr, (this.pcHotspots.get(pcStr) || 0) + 1);
            
            // 计算该PC的性能指标
            const cycles = state.mcycle || 0;
            const instructions = state.minstret || 0;
            
            if (instructions > 0) {
                const cpi = cycles / instructions;
                this.performanceHotspots.set(pcStr, cpi);
            }
        }
    }

    recordHistory() {
        if (this.updateCounter % 10 === 0) { // 每10次更新记录一次历史
            this.performanceHistory.push({
                timestamp: Date.now(),
                cpi: this.performanceStats.cpi,
                icacheHitRate: this.performanceStats.icacheHitRate,
                dcacheHitRate: this.performanceStats.dcacheHitRate,
                executionEfficiency: this.performanceStats.executionEfficiency
            });
            
            if (this.performanceHistory.length > this.maxHistorySize) {
                this.performanceHistory.shift();
            }
        }
    }

    /**
     * 渲染CPU监控器UI
     */
    render() {
        const container = document.getElementById('cpu-monitor-panel');
        if (!container) {
            console.error('找不到CPU监控器面板容器');
            return;
        }
        
        const panelContent = container.querySelector('.panel-content');
        if (!panelContent) {
            console.error('找不到CPU监控器面板内容区域');
            return;
        }
        
        panelContent.innerHTML = `
            <div class="cpu-monitor-content">
                ${this.renderPerformanceMetrics()}
                ${this.renderCachePerformance()}
                ${this.renderInstructionRegions()}
                ${this.renderHotspots()}
                ${this.renderStatus()}
            </div>
        `;
        
        // 初始化事件监听器和更新按钮状态
        this.initializeEventListeners();
        this.updateControlButtons();
    }

    renderPerformanceMetrics() {
        return `
            <div class="metrics-section">
                <h5>📊 核心性能指标</h5>
                <div class="metrics-grid">
                    <div class="metric-card">
                        <div class="metric-label">CPI (每指令周期)</div>
                        <div class="metric-value">${this.performanceStats.cpi.toFixed(3)}</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-label">IPC (每周期指令)</div>
                        <div class="metric-value">${this.performanceStats.ipc.toFixed(3)}</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-label">执行效率</div>
                        <div class="metric-value">${this.performanceStats.executionEfficiency.toFixed(1)}%</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-label">总指令数</div>
                        <div class="metric-value">${this.performanceStats.totalInstructions.toLocaleString()}</div>
                    </div>
                </div>
            </div>
        `;
    }

    renderCachePerformance() {
        return `
            <div class="cache-section">
                <h5>🗄️ 缓存性能</h5>
                <div class="cache-grid">
                    <div class="cache-card">
                        <div class="cache-title">指令缓存 (I-Cache)</div>
                        <div class="cache-stats">
                            <div class="cache-stat">
                                <span>命中率:</span>
                                <span class="cache-value">${this.performanceStats.icacheHitRate.toFixed(1)}%</span>
                            </div>
                            <div class="cache-stat">
                                <span>命中:</span>
                                <span class="cache-value">${this.performanceStats.icacheHits.toLocaleString()}</span>
                            </div>
                            <div class="cache-stat">
                                <span>缺失:</span>
                                <span class="cache-value miss">${this.performanceStats.icacheMisses.toLocaleString()}</span>
                            </div>
                        </div>
                        <div class="cache-bar">
                            <div class="cache-bar-fill" style="width: ${this.performanceStats.icacheHitRate}%"></div>
                        </div>
                    </div>
                    
                    <div class="cache-card">
                        <div class="cache-title">数据缓存 (D-Cache)</div>
                        <div class="cache-stats">
                            <div class="cache-stat">
                                <span>命中率:</span>
                                <span class="cache-value">${this.performanceStats.dcacheHitRate.toFixed(1)}%</span>
                            </div>
                            <div class="cache-stat">
                                <span>命中:</span>
                                <span class="cache-value">${this.performanceStats.dcacheHits.toLocaleString()}</span>
                            </div>
                            <div class="cache-stat">
                                <span>缺失:</span>
                                <span class="cache-value miss">${this.performanceStats.dcacheMisses.toLocaleString()}</span>
                            </div>
                        </div>
                        <div class="cache-bar">
                            <div class="cache-bar-fill" style="width: ${this.performanceStats.dcacheHitRate}%"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    renderInstructionRegions() {
        const regions = Array.from(this.instructionRegions.entries())
            .sort((a, b) => b[1].cyclesSpent - a[1].cyclesSpent)
            .slice(0, 10);

        return `
            <div class="regions-section">
                <h5>📍 指令区间性能分析</h5>
                <div class="regions-list">
                    ${regions.length === 0 ? '<div class="no-data">暂无区间数据</div>' : 
                        regions.map(([key, region]) => `
                            <div class="region-item">
                                <div class="region-header">
                                    <span class="region-range">0x${region.startPC.toString(16)} - 0x${region.endPC.toString(16)}</span>
                                    <span class="region-cpi">CPI: ${region.cpi.toFixed(2)}</span>
                                </div>
                                <div class="region-stats">
                                    <span class="region-stat">指令: ${region.instructionCount}</span>
                                    <span class="region-stat">周期: ${region.cyclesSpent}</span>
                                </div>
                                <div class="region-bar">
                                    <div class="region-bar-fill" style="width: ${Math.min(region.cpi * 20, 100)}%"></div>
                                </div>
                            </div>
                        `).join('')
                    }
                </div>
            </div>
        `;
    }

    renderHotspots() {
        const hotspots = Array.from(this.pcHotspots.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8);

        return `
            <div class="hotspots-section">
                <h5>🔥 性能热点</h5>
                <div class="hotspots-list">
                    ${hotspots.length === 0 ? '<div class="no-data">暂无热点数据</div>' : 
                        hotspots.map(([pc, count]) => {
                            const cpi = this.performanceHotspots.get(pc) || 0;
                            return `
                                <div class="hotspot-item">
                                    <div class="hotspot-pc">0x${pc}</div>
                                    <div class="hotspot-stats">
                                        <span class="hotspot-count">访问: ${count}</span>
                                        <span class="hotspot-cpi">CPI: ${cpi.toFixed(2)}</span>
                                    </div>
                                    <div class="hotspot-bar">
                                        <div class="hotspot-bar-fill" style="width: ${Math.min(count / hotspots[0][1] * 100, 100)}%"></div>
                                    </div>
                                </div>
                            `;
                        }).join('')
                    }
                </div>
            </div>
        `;
    }

    renderStatus() {
        return `
            <div class="status-section">
                <h5>📊 监控状态</h5>
                <div class="monitor-status">
                    <div class="status-item">
                        <span class="status-indicator ${this.isRunning ? 'recording' : 'stopped'}"></span>
                        <span class="status-text">状态: ${this.isRunning ? '监控中' : '已停止'}</span>
                    </div>
                    <div class="status-item">
                        <span class="status-label">更新次数:</span>
                        <span class="status-value">${this.updateCounter}</span>
                    </div>
                    <div class="status-item">
                        <span class="status-label">区间数:</span>
                        <span class="status-value">${this.instructionRegions.size}</span>
                    </div>
                    <div class="status-item">
                        <span class="status-label">总指令:</span>
                        <span class="status-value">${this.performanceStats.totalInstructions}</span>
                    </div>
                </div>
            </div>
        `;
    }

    start() {
        this.isRunning = true;
        console.log('CPU监控器已启动');
        this.updateControlButtons();
        this.render();
    }

    stop() {
        this.isRunning = false;
        console.log('CPU监控器已停止');
        this.updateControlButtons();
        this.refreshUI();
    }

    toggleRecording() {
        this.isRunning = !this.isRunning;
        this.updateControlButtons();
        this.refreshUI();
    }

    reset() {
        this.performanceStats = {
            totalInstructions: 0,
            totalCycles: 0,
            cpi: 0,
            ipc: 0,
            icacheHits: 0,
            icacheMisses: 0,
            dcacheHits: 0,
            dcacheMisses: 0,
            icacheHitRate: 0,
            dcacheHitRate: 0,
            branchCount: 0,
            branchMispredictions: 0,
            branchPredictionRate: 0,
            stallCycles: 0,
            executionEfficiency: 0,
            memoryAccessCount: 0,
            memoryAccessCycles: 0,
            avgMemoryLatency: 0
        };
        
        this.instructionRegions.clear();
        this.pcHotspots.clear();
        this.performanceHotspots.clear();
        this.performanceHistory = [];
        this.updateCounter = 0;
        this.currentRegion = null;
        
        this.refreshUI();
    }

    exportData() {
        const data = {
            timestamp: new Date().toISOString(),
            performanceStats: this.performanceStats,
            instructionRegions: Object.fromEntries(this.instructionRegions),
            pcHotspots: Object.fromEntries(this.pcHotspots),
            performanceHotspots: Object.fromEntries(this.performanceHotspots),
            performanceHistory: this.performanceHistory,
            updateCounter: this.updateCounter
        };
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cpu_performance_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    updateControlButtons() {
        const toggleBtn = document.getElementById('cpu-monitor-toggle');
        const resetBtn = document.getElementById('cpu-monitor-reset');
        const exportBtn = document.getElementById('cpu-monitor-export');
        
        if (toggleBtn) {
            const icon = toggleBtn.querySelector('i');
            const text = toggleBtn.querySelector('span');
            
            if (this.isRunning) {
                toggleBtn.className = 'btn btn-danger btn-small';
                icon.className = 'fas fa-pause';
                text.textContent = '停止监控';
            } else {
                toggleBtn.className = 'btn btn-primary btn-small';
                icon.className = 'fas fa-play';
                text.textContent = '开始监控';
            }
        }
    }

    initializeEventListeners() {
        const toggleBtn = document.getElementById('cpu-monitor-toggle');
        const resetBtn = document.getElementById('cpu-monitor-reset');
        const exportBtn = document.getElementById('cpu-monitor-export');
        
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => this.toggleRecording());
        }
        
        if (resetBtn) {
            resetBtn.addEventListener('click', () => this.reset());
        }
        
        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.exportData());
        }
    }

    refreshUI() {
        // 如果CPU监控器面板是可见的，重新渲染
        const panel = document.getElementById('cpu-monitor-panel');
        if (panel && panel.style.display === 'block') {
            this.render();
        }
    }
}

// 导出CPU监控器类
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CPUMonitor;
}

console.log('CPU监控器类已定义'); 