/**
 * 简化的ELF分析器 - 专注于运行时热点分析
 */
class ELFAnalyzer {
    constructor() {
        this.instructionExecution = new Map(); // PC -> { count, instruction, mnemonic }
        this.instructionHotspots = [];
        this.totalExecutedInstructions = 0;
    }

    /**
     * 记录指令执行
     */
    recordInstructionExecution(pc) {
        if (!pc) return;
        
        const key = pc.toString(16);
        
        if (this.instructionExecution.has(key)) {
            const existing = this.instructionExecution.get(key);
            existing.count++;
        } else {
            this.instructionExecution.set(key, {
                pc: pc,
                address: `0x${key.padStart(8, '0').toUpperCase()}`,
                count: 1,
                instruction: '', // 将在实际执行时填充
                mnemonic: ''
            });
        }
        
        this.totalExecutedInstructions++;
        this.updateHotspots();
    }

    /**
     * 更新热点排序
     */
    updateHotspots() {
        this.instructionHotspots = Array.from(this.instructionExecution.values())
            .sort((a, b) => b.count - a.count)
            .slice(0, 100); // 只保留前100个热点
    }

    /**
     * 获取所有指令数据
     */
    getAllInstructions() {
        return Array.from(this.instructionExecution.values()).map(inst => ({
            address: inst.address,
            instruction: inst.instruction || 'unknown',
            mnemonic: inst.mnemonic || 'unknown',
            executions: inst.count,
            totalCycles: inst.count * 2, // 简单估算
            avgCycles: 2.0
        }));
    }

    /**
     * 获取指令热点
     */
    getInstructionHotspots() {
        return this.instructionHotspots.map(inst => ({
            address: inst.address,
            instruction: inst.instruction || 'unknown',
            mnemonic: inst.mnemonic || 'unknown',
            executions: inst.count,
            totalCycles: inst.count * 2,
            avgCycles: 2.0
        }));
    }

    /**
     * 获取总执行指令数
     */
    getTotalExecutedInstructions() {
        return this.totalExecutedInstructions;
    }

    /**
     * 获取总执行周期数（估算）
     */
    getTotalExecutionCycles() {
        return this.totalExecutedInstructions * 2;
    }

    /**
     * 获取平均CPI（估算）
     */
    getAverageCPI() {
        return 2.0;
    }

    /**
     * 重置执行统计
     */
    resetExecutionStats() {
        this.instructionExecution.clear();
        this.instructionHotspots = [];
        this.totalExecutedInstructions = 0;
    }

    /**
     * 更新性能数据（兼容接口）
     */
    updatePerformanceData(pc, perfData) {
        // 简化版本，仅记录执行
        this.recordInstructionExecution(pc);
    }

    /**
     * 更新所有性能数据（兼容接口）
     */
    updateAllPerformanceData(performanceStats) {
        // 简化版本，暂不处理
    }
}

// 导出类
if (typeof window !== 'undefined') {
    window.ELFAnalyzer = ELFAnalyzer;
}