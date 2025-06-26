// Spike RISC-V 可视化调试器 Web 界面

// 调试器状态管理
class DebuggerState {
    constructor() {
        this.connected = false;
        this.debugging = false;
        this.currentFile = null;
        this.originalFileName = null;
        this.pc = 0;
        this.registers = {
            integer: new Array(32).fill(0),
            float: new Array(32).fill(0),
            csr: {}
        };
        this.memory = new Map();
        this.code = [];
        this.executionLog = [];
        this.instructionCount = 0;
        this.privilegeLevel = 'Machine';
        this.currentInstruction = '-';
    }

    updateStatus() {
        const connectionStatus = document.getElementById('connection-status');
        const debugStatus = document.getElementById('debug-status');
        
        connectionStatus.className = `status ${this.connected ? 'connected' : 'disconnected'}`;
        connectionStatus.textContent = t(this.connected ? 'connected' : 'disconnected');
        
        debugStatus.className = `status ${this.debugging ? 'debugging' : 'not-debugging'}`;
        debugStatus.textContent = t(this.debugging ? 'debugging' : 'not-debugging');
    }
}

// 全局变量
let socket = null;
let debugState = new DebuggerState();
let elfAnalyzerUI = null;

// Socket.IO 连接
function initializeSocket() {
    socket = io();
    
    socket.on('connect', () => {
        console.log('Connected to server');
        debugState.connected = true;
        debugState.updateStatus();
        enableControls();
    });
    
    socket.on('connection-confirmed', (data) => {
        console.log('Connection confirmed:', data);
        addLogEntry('info', `🔗 已连接到服务器 (${data.socketId.substring(0, 8)}...)`);
    });
    
    socket.on('disconnect', () => {
        console.log('Disconnected from server');
        debugState.connected = false;
        debugState.debugging = false;
        debugState.updateStatus();
        disableControls();
    });
    
    socket.on('debug-output', (data) => {
        handleDebugOutput(data);
    });
    
    socket.on('debug-started', () => {
        debugState.debugging = true;
        debugState.updateStatus();
        updateControlButtons();
        addLogEntry('info', t('debug.started'));
    });
    
    socket.on('debug-stopped', () => {
        debugState.debugging = false;
        debugState.updateStatus();
        updateControlButtons();
        addLogEntry('info', t('debug.stopped'));
    });
    
    socket.on('debug-reset', () => {
        debugState.debugging = false;
        debugState.updateStatus();
        updateControlButtons();
        resetDebuggerState();
        addLogEntry('info', t('debug.reset'));
    });
    
    socket.on('register-update', (data) => {
        updateRegisters(data);
    });
    
    socket.on('memory-update', (data) => {
        updateMemory(data);
    });
    
    socket.on('execution-update', (data) => {
        debugState.pc = data.pc;
        debugState.instructionCount = data.count;
        debugState.currentInstruction = data.current;
        updateExecutionStatus();
        highlightCurrentCode();
        
        // 通知后端前端已处理完成，可以继续下一条指令
        socket.emit('frontend-ready');
    });
    
    socket.on('code-update', (data) => {
        updateCodeView(data);
    });
}

// 处理调试输出
function handleDebugOutput(data) {
    const { type, message, timestamp } = data;
    
    // 解析spike的输出来更新可视化组件
    if (message.includes('core') && message.includes(':')) {
        parseExecutionLog(message);
    }
    
    addLogEntry(type, message, timestamp);
}

// 解析执行日志（仅用于ELF分析器）
function parseExecutionLog(logLine) {
    // 匹配core执行行
    let match = logLine.match(/^core\s+(\d+):\s+(?:(\d+)\s+)?(0x[0-9a-fA-F]+)\s+\((0x[0-9a-fA-F]+)\)\s*(.*)$/);
    if (match) {
        const [, core, priv, pc, instruction, disasm] = match;
        
        if (disasm && disasm.trim()) {
            const pcAddr = parseInt(pc, 16);
            
            // 只记录指令执行到ELF分析器，不更新调试状态（避免重复）
            if (typeof elfAnalyzerUI !== 'undefined' && elfAnalyzerUI && elfAnalyzerUI.analyzer) {
                elfAnalyzerUI.analyzer.recordInstructionExecution(pcAddr);
                
                // 如果热点分析面板是活跃的，实时刷新显示
                const elfPanel = document.getElementById('elf-analyzer-panel');
                if (elfPanel && elfPanel.style.display !== 'none') {
                    elfAnalyzerUI.refreshAllTabs();
                }
            }
        }
    }
}

// 更新执行状态显示
function updateExecutionStatus() {
    document.getElementById('pc-value').textContent = `0x${debugState.pc.toString(16).padStart(8, '0').toUpperCase()}`;
    document.getElementById('inst-count').textContent = debugState.instructionCount;
    document.getElementById('current-inst').textContent = debugState.currentInstruction;
    document.getElementById('priv-level').textContent = debugState.privilegeLevel;
}

// 更新寄存器显示
function updateRegisters(data) {
    if (data.type === 'integer') {
        debugState.registers.integer = data.values;
        renderIntegerRegisters();
    } else if (data.type === 'float') {
        debugState.registers.float = data.values;
        renderFloatRegisters();
    } else if (data.type === 'csr') {
        debugState.registers.csr = data.values;
        renderCSRRegisters();
    }
}

// 渲染整数寄存器
function renderIntegerRegisters() {
    const container = document.getElementById('integer-regs');
    container.innerHTML = '';
    
    const regNames = [
        'zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2',
        's0', 's1', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5',
        'a6', 'a7', 's2', 's3', 's4', 's5', 's6', 's7',
        's8', 's9', 's10', 's11', 't3', 't4', 't5', 't6'
    ];
    
    for (let i = 0; i < 32; i++) {
        const regItem = document.createElement('div');
        regItem.className = 'register-item';
        regItem.innerHTML = `
            <span class="register-name">x${i} (${regNames[i]})</span>
            <span class="register-value">0x${debugState.registers.integer[i].toString(16).padStart(16, '0').toUpperCase()}</span>
        `;
        container.appendChild(regItem);
    }
}

// 渲染浮点寄存器
function renderFloatRegisters() {
    const container = document.getElementById('float-regs');
    container.innerHTML = '';
    
    for (let i = 0; i < 32; i++) {
        const regItem = document.createElement('div');
        regItem.className = 'register-item';
        regItem.innerHTML = `
            <span class="register-name">f${i}</span>
            <span class="register-value">0x${debugState.registers.float[i].toString(16).padStart(16, '0').toUpperCase()}</span>
        `;
        container.appendChild(regItem);
    }
}

// 渲染控制寄存器
function renderCSRRegisters() {
    const container = document.getElementById('csr-regs');
    container.innerHTML = '';
    
    for (const [name, value] of Object.entries(debugState.registers.csr)) {
        const regItem = document.createElement('div');
        regItem.className = 'register-item';
        regItem.innerHTML = `
            <span class="register-name">${name}</span>
            <span class="register-value">0x${value.toString(16).padStart(16, '0').toUpperCase()}</span>
        `;
        container.appendChild(regItem);
    }
}

// 更新内存显示
function updateMemory(data) {
    const { address, size, values } = data;
    
    for (let i = 0; i < values.length; i++) {
        debugState.memory.set(address + i, values[i]);
    }
    
    renderMemoryView();
}

// 渲染内存视图
function renderMemoryView() {
    const container = document.getElementById('memory-content');
    container.innerHTML = '';
    
    // 获取内存地址范围
    const addresses = Array.from(debugState.memory.keys()).sort((a, b) => a - b);
    if (addresses.length === 0) return;
    
    const startAddr = Math.floor(addresses[0] / 16) * 16;
    const endAddr = Math.ceil(addresses[addresses.length - 1] / 16) * 16 + 15;
    
    for (let addr = startAddr; addr <= endAddr; addr += 16) {
        const row = document.createElement('div');
        row.className = 'memory-row';
        
        // 地址
        const addrSpan = document.createElement('span');
        addrSpan.className = 'memory-address';
        addrSpan.textContent = `0x${addr.toString(16).padStart(8, '0').toUpperCase()}`;
        
        // 十六进制数据
        const hexSpan = document.createElement('span');
        hexSpan.className = 'memory-hex';
        let hexData = '';
        let asciiData = '';
        
        for (let i = 0; i < 16; i++) {
            const byte = debugState.memory.get(addr + i) || 0;
            hexData += byte.toString(16).padStart(2, '0').toUpperCase() + ' ';
            asciiData += (byte >= 32 && byte <= 126) ? String.fromCharCode(byte) : '.';
        }
        
        hexSpan.textContent = hexData.trim();
        
        // ASCII数据
        const asciiSpan = document.createElement('span');
        asciiSpan.className = 'memory-ascii';
        asciiSpan.textContent = asciiData;
        
        row.appendChild(addrSpan);
        row.appendChild(hexSpan);
        row.appendChild(asciiSpan);
        container.appendChild(row);
    }
}

// 更新程序计数器
function updatePC(pc) {
    debugState.pc = pc;
    updateExecutionStatus();
    highlightCurrentCode();
}

// 高亮当前代码行
function highlightCurrentCode() {
    // 移除之前的高亮
    document.querySelectorAll('.code-line.current').forEach(line => {
        line.classList.remove('current');
    });
    
    // 查找并高亮当前PC对应的代码行
    const codeLines = document.querySelectorAll('.code-line');
    codeLines.forEach(line => {
        const addr = line.dataset.address;
        if (addr && parseInt(addr, 16) === debugState.pc) {
            line.classList.add('current');
            line.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });
}

// 添加日志条目
function addLogEntry(type, message, timestamp = new Date()) {
    const logView = document.getElementById('log-view');
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    
    const timeStr = timestamp instanceof Date ? 
        timestamp.toLocaleTimeString() : 
        new Date(timestamp).toLocaleTimeString();
        
    entry.innerHTML = `<span class="timestamp">[${timeStr}]</span> ${message}`;
    
    // 检查是否需要删除旧条目（增加限制到5000条以提高性能）
    if (logView.children.length >= 5000) {
        // 批量删除前1000条以提高性能
        for (let i = 0; i < 1000; i++) {
            if (logView.firstChild) {
                logView.removeChild(logView.firstChild);
            }
        }
    }
    
    logView.appendChild(entry);
    
    // 强制滚动到底部，使用 requestAnimationFrame 确保DOM更新后执行
    requestAnimationFrame(() => {
        logView.scrollTop = logView.scrollHeight;
        // 二次确保滚动到底部
        setTimeout(() => {
            if (logView.scrollTop < logView.scrollHeight - logView.clientHeight - 10) {
                logView.scrollTop = logView.scrollHeight;
            }
        }, 10);
    });
}

// 控制按钮管理
function enableControls() {
    const startBtn = document.getElementById('start-btn');
            const loadBtn = document.getElementById('load-btn');
    
    if (debugState.currentFile) {
        startBtn.disabled = false;
    }
    loadBtn.disabled = false;
}

function disableControls() {
    document.getElementById('start-btn').disabled = true;
    document.getElementById('pause-btn').disabled = true;
    document.getElementById('step-btn').disabled = true;
    document.getElementById('reset-btn').disabled = true;
    document.getElementById('load-file-btn').disabled = true;
}

function updateControlButtons() {
    const startBtn = document.getElementById('start-btn');
    const pauseBtn = document.getElementById('pause-btn');
    const stepBtn = document.getElementById('step-btn');
    const resetBtn = document.getElementById('reset-btn');
    
    if (debugState.debugging) {
        startBtn.disabled = false;
        startBtn.innerHTML = '<i class="fas fa-play"></i> <span data-i18n="continue">继续</span>';
        pauseBtn.disabled = false;
        stepBtn.disabled = false;
        resetBtn.disabled = false;
    } else {
        startBtn.disabled = !debugState.currentFile;
        startBtn.innerHTML = '<i class="fas fa-play"></i> <span data-i18n="start">开始</span>';
        pauseBtn.disabled = true;
        stepBtn.disabled = true;
        resetBtn.disabled = true;
    }
    
    // 重新应用语言翻译
    if (window.updateLanguage) {
        window.updateLanguage();
    }
}

// 事件监听器
document.addEventListener('DOMContentLoaded', () => {
    initializeSocket();
    
    // 文件加载和上传
    const fileInput = document.getElementById('file-input');
    const loadBtn = document.getElementById('load-btn');
    const fileInfo = document.getElementById('file-info');
    const fileName = document.getElementById('file-name');
    const clearBtn = document.getElementById('clear-btn');
    
    loadBtn.addEventListener('click', () => {
        fileInput.click();
    });
    
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            // 显示上传状态
            fileName.textContent = `${t('file.uploading')}: ${file.name}`;
            fileInfo.style.display = 'flex';
            loadBtn.disabled = true;
            
            // 上传文件到服务器
            const formData = new FormData();
            formData.append('elfFile', file);
            
            try {
                const response = await fetch('/upload', {
                    method: 'POST',
                    body: formData
                });
                
                const result = await response.json();
                
                if (result.success) {
                    debugState.currentFile = result.filename;
                    debugState.originalFileName = result.originalName;
                    fileName.textContent = result.originalName;
                    updateControlButtons();
                    clearBtn.disabled = false;
                    addLogEntry('info', `${t('file.uploaded')}: ${result.originalName}`);
                } else {
                    throw new Error(result.error || 'Upload failed');
                }
            } catch (error) {
                addLogEntry('error', `${t('file.upload.failed')}: ${error.message}`);
                fileInfo.style.display = 'none';
                debugState.currentFile = null;
            } finally {
                loadBtn.disabled = false;
            }
        }
    });
    
    clearBtn.addEventListener('click', () => {
        debugState.currentFile = null;
        debugState.originalFileName = null;
        fileInput.value = '';
        fileInfo.style.display = 'none';
        clearBtn.disabled = true;
        updateControlButtons();
    });
    
    // 调试控制按钮
    document.getElementById('start-btn').addEventListener('click', () => {
        if (debugState.debugging && socket) {
            // 如果正在调试，则继续执行
            socket.emit('continue-debug');
        } else if (debugState.currentFile && socket) {
            // 如果未开始调试，则启动调试
            const options = {
                filename: debugState.currentFile,
                autoStep: document.getElementById('auto-step').checked,
                showLog: document.getElementById('show-log').checked,
                showMemory: document.getElementById('show-memory').checked
            };
            socket.emit('start-debug', options);
        }
    });
    
    document.getElementById('pause-btn').addEventListener('click', () => {
        if (socket) {
            socket.emit('pause-debug');
        }
    });
    
    document.getElementById('step-btn').addEventListener('click', () => {
        if (socket) {
            socket.emit('step-debug');
        }
    });
    
    document.getElementById('reset-btn').addEventListener('click', () => {
        if (socket) {
            socket.emit('reset-debug');
            resetDebuggerState();
        }
    });
    
    // 寄存器标签切换
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            
            // 更新标签状态
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // 更新内容显示
            document.querySelectorAll('.register-grid').forEach(g => g.classList.remove('active'));
            document.getElementById(`${tab}-regs`).classList.add('active');
        });
    });
    
    // 内存跳转
    document.getElementById('goto-memory').addEventListener('click', () => {
        const address = document.getElementById('memory-address').value;
        if (address && socket) {
            socket.emit('read-memory', { address: parseInt(address, 16), size: 256 });
        }
    });
    
    // 清空日志
    document.getElementById('clear-log').addEventListener('click', () => {
        document.getElementById('log-view').innerHTML = '';
        debugState.executionLog = [];
    });
    
    // 跟随PC按钮
    document.getElementById('auto-follow').addEventListener('click', (e) => {
        e.target.classList.toggle('active');
    });
    
    // 初始化寄存器显示
    renderIntegerRegisters();
    renderFloatRegisters();
    renderCSRRegisters();
    
    // 初始化ELF分析器UI
    if (typeof ELFAnalyzerUI !== 'undefined') {
        window.elfAnalyzerUI = new ELFAnalyzerUI();
        console.log('ELF分析器UI已初始化');
    } else {
        console.warn('ELFAnalyzerUI类未找到，请检查脚本加载');
    }
    
    // 初始状态
    debugState.updateStatus();
    disableControls();
    
    // 工具面板切换功能
    initializeToolPanels();
    
    // 拖拽调整大小功能
    initializeResizeHandle();
    
    // 左侧拖拽调整大小功能
    initializeLeftResizeHandle();
});

// 重置调试器状态
function resetDebuggerState() {
    debugState.pc = 0;
    debugState.instructionCount = 0;
    debugState.currentInstruction = '-';
    debugState.privilegeLevel = 'Machine';
    debugState.registers.integer.fill(0);
    debugState.registers.float.fill(0);
    debugState.registers.csr = {};
    debugState.memory.clear();
    debugState.executionLog = [];
    
    updateExecutionStatus();
    renderIntegerRegisters();
    renderFloatRegisters();
    renderCSRRegisters();
    renderMemoryView();
    
    document.querySelectorAll('.code-line.current').forEach(line => {
        line.classList.remove('current');
    });
}

// 语言切换事件监听
document.addEventListener('languageChanged', () => {
    debugState.updateStatus();
});

// 快捷键支持
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey) {
        switch (e.key) {
            case 'F5':
                e.preventDefault();
                document.getElementById('start-btn').click();
                break;
            case 'F10':
                e.preventDefault();
                document.getElementById('step-btn').click();
                break;
            case 'F6':
                e.preventDefault();
                document.getElementById('pause-btn').click();
                break;
        }
    }
});

// 工具面板切换功能
function initializeToolPanels() {
    // 工具按钮事件监听
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const tool = btn.dataset.tool;
            toggleToolPanel(tool);
        });
    });
    
    // 关闭面板按钮事件监听
    document.querySelectorAll('.close-panel-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const panel = btn.dataset.panel;
            closeToolPanel(panel);
        });
    });
}

// 防抖变量
let toggleInProgress = false;

// 切换工具面板
function toggleToolPanel(toolName) {
    if (toggleInProgress) {
        return;
    }
    
    toggleInProgress = true;
    
    const panel = document.getElementById(`${toolName}-panel`);
    const defaultView = document.getElementById('default-view');
    const toolBtn = document.querySelector(`[data-tool="${toolName}"]`);
    
    // 检查面板是否真正可见
    const isVisible = panel && window.getComputedStyle(panel).display !== 'none';
    
    if (panel && !isVisible) {
        // 显示面板
        // 先隐藏所有其他面板（但不包括当前要显示的面板）
        document.querySelectorAll('.tool-panel').forEach(p => {
            if (p !== panel) {
                p.style.display = 'none';
            }
        });
        document.querySelectorAll('.tool-btn').forEach(b => {
            b.classList.remove('active');
        });
        
        // 显示选中的面板
        panel.style.display = 'block';
        defaultView.style.display = 'none';
        toolBtn.classList.add('active');
        
        // 根据面板类型执行特定操作
        if (toolName === 'memory') {
            renderMemoryView();
        } else if (toolName === 'registers') {
            renderIntegerRegisters();
            renderFloatRegisters();
            renderCSRRegisters();
        } else if (toolName === 'cpu-monitor') {
            if (typeof cpuMonitor !== 'undefined' && cpuMonitor !== null) {
                cpuMonitor.start();
                cpuMonitor.render();
            } else {
                // 尝试创建新实例
                if (typeof CPUMonitor !== 'undefined') {
                    cpuMonitor = new CPUMonitor();
                    cpuMonitor.start();
                    cpuMonitor.render();
                } else {
                    // 在面板中显示错误信息
                    const panelContent = panel.querySelector('.panel-content');
                    if (panelContent) {
                        panelContent.innerHTML = `
                            <div style="padding: 20px; text-align: center; color: #dc3545;">
                                <h3>❌ CPU监控器加载失败</h3>
                                <p>CPUMonitor类未定义，请检查脚本文件是否正确加载。</p>
                                <p>请尝试刷新页面或检查控制台错误信息。</p>
                            </div>
                        `;
                    }
                }
            }
        } else if (toolName === 'elf-analyzer') {
            // ELF分析器已经通过其构造函数自动创建面板
            console.log('ELF分析器面板已显示');
        }
    } else if (panel) {
        // 隐藏面板
        closeToolPanel(toolName);
    }
    
    // 重置防抖标志
    setTimeout(() => {
        toggleInProgress = false;
    }, 100);
}

// 关闭工具面板
function closeToolPanel(toolName) {
    const panel = document.getElementById(`${toolName}-panel`);
    const defaultView = document.getElementById('default-view');
    const toolBtn = document.querySelector(`[data-tool="${toolName}"]`);
    
    panel.style.display = 'none';
    toolBtn.classList.remove('active');
    
    // 如果是CPU监控器，停止它
    if (toolName === 'cpu-monitor' && typeof cpuMonitor !== 'undefined' && cpuMonitor !== null) {
        cpuMonitor.stop();
    }
    
    // 如果没有其他面板显示，则显示默认视图
    const hasVisiblePanel = Array.from(document.querySelectorAll('.tool-panel')).some(p => 
        p.style.display === 'block'
    );
    
    if (!hasVisiblePanel) {
        defaultView.style.display = 'flex';
    }
}

// 拖拽调整大小功能
function initializeResizeHandle() {
    const resizeHandle = document.getElementById('resize-handle');
    const mainContainer = document.querySelector('.main-container');
    const mainView = document.querySelector('.main-view');
    const rightPanel = document.querySelector('.right-panel');
    let isResizing = false;

    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
        
        const startX = e.clientX;
        
        // 获取当前实际宽度
        const containerRect = mainContainer.getBoundingClientRect();
        const mainViewRect = mainView.getBoundingClientRect();
        const rightPanelRect = rightPanel.getBoundingClientRect();
        
        const startMainWidth = mainViewRect.width;
        const startLogWidth = rightPanelRect.width;
        
        function handleMouseMove(e) {
            if (!isResizing) return;
            
            const deltaX = e.clientX - startX;
            const containerWidth = containerRect.width;
            const sidebarWidth = 300;
            const leftHandleWidth = 5;
            const rightHandleWidth = 5;
            const minMainWidth = 300;
            const minLogWidth = 200;
            
            let newMainWidth = startMainWidth + deltaX;
            let newLogWidth = startLogWidth - deltaX;
            
            // 限制最小宽度
            if (newMainWidth < minMainWidth) {
                newMainWidth = minMainWidth;
                newLogWidth = containerWidth - sidebarWidth - leftHandleWidth - rightHandleWidth - newMainWidth;
            }
            
            if (newLogWidth < minLogWidth) {
                newLogWidth = minLogWidth;
                newMainWidth = containerWidth - sidebarWidth - leftHandleWidth - rightHandleWidth - newLogWidth;
            }
            
            // 更新grid布局 - 5列布局：sidebar leftHandle main rightHandle log
            mainContainer.style.gridTemplateColumns = `${sidebarWidth}px ${leftHandleWidth}px ${newMainWidth}px ${rightHandleWidth}px ${newLogWidth}px`;
        }
        
        function handleMouseUp() {
            isResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        }
        
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    });
}

// 左侧拖拽调整大小功能
function initializeLeftResizeHandle() {
    const leftResizeHandle = document.getElementById('left-resize-handle');
    const mainContainer = document.querySelector('.main-container');
    const controlPanel = document.querySelector('.control-panel');
    const mainView = document.querySelector('.main-view');
    const rightPanel = document.querySelector('.right-panel');
    let isResizing = false;

    leftResizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
        
        const startX = e.clientX;
        
        // 获取当前实际宽度
        const containerRect = mainContainer.getBoundingClientRect();
        const controlPanelRect = controlPanel.getBoundingClientRect();
        const mainViewRect = mainView.getBoundingClientRect();
        const rightPanelRect = rightPanel.getBoundingClientRect();
        
        const startSidebarWidth = controlPanelRect.width;
        const startMainWidth = mainViewRect.width;
        const startLogWidth = rightPanelRect.width;
        
        function handleMouseMove(e) {
            if (!isResizing) return;
            
            const deltaX = e.clientX - startX;
            const containerWidth = containerRect.width;
            const leftHandleWidth = 5;
            const rightHandleWidth = 5;
            const minSidebarWidth = 200;
            const minMainWidth = 300;
            
            let newSidebarWidth = startSidebarWidth + deltaX;
            let newMainWidth = startMainWidth - deltaX;
            
            // 限制最小宽度
            if (newSidebarWidth < minSidebarWidth) {
                newSidebarWidth = minSidebarWidth;
                newMainWidth = containerWidth - newSidebarWidth - leftHandleWidth - rightHandleWidth - startLogWidth;
            }
            
            if (newMainWidth < minMainWidth) {
                newMainWidth = minMainWidth;
                newSidebarWidth = containerWidth - newMainWidth - leftHandleWidth - rightHandleWidth - startLogWidth;
            }
            
            // 更新grid布局
            mainContainer.style.gridTemplateColumns = `${newSidebarWidth}px ${leftHandleWidth}px ${newMainWidth}px ${rightHandleWidth}px ${startLogWidth}px`;
        }
        
        function handleMouseUp() {
            isResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        }
        
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    });
}

// 创建CPU监控器实例（在DOMContentLoaded后创建）
let cpuMonitor = null;

// 更新调试器状态，包含CPU监控器
function updateDebuggerState() {
    if (!socket) return;
    
    socket.emit('getDebuggerState', (response) => {
        if (response.success) {
            const data = response.data;
            
            // 更新基本状态
            document.getElementById('current-pc').textContent = `0x${data.pc.toString(16)}`;
            document.getElementById('instruction-count').textContent = data.instructionCount;
            
            // 更新CPU监控器
            if (cpuMonitor && cpuMonitor.isRunning && data.performanceStats) {
                cpuMonitor.updatePerformanceData(data.performanceStats);
            }
            
            // 更新ELF分析器的性能数据（无论程序是否在运行）
            if (elfAnalyzerUI && data.performanceStats) {
                elfAnalyzerUI.updateAllPerformanceData(data.performanceStats);
                
                // 如果Instructions面板是活动的，刷新热点显示
                const instructionsTab = document.querySelector('.tab-btn[data-tab="instructions"]');
                if (instructionsTab && instructionsTab.classList.contains('active') && elfAnalyzerUI.analyzer) {
                    elfAnalyzerUI.refreshHotspots();
                }
            }
        }
    });
}

// 处理服务器返回的性能数据
function initializeSocketHandlers() {
    if (typeof socket !== 'undefined') {
        socket.on('performance-stats', (stats) => {
            if (cpuMonitor && cpuMonitor.isRunning) {
                cpuMonitor.updateFromState(stats);
                cpuMonitor.refreshUI();
            }
        });
    }
}

// 面板拖拽功能
function makePanelDraggable(panel) {
    const panelHeader = panel.querySelector('.panel-header');
    if (!panelHeader) return;
    
    let isDragging = false;
    let startX, startY, offsetX, offsetY;
    
    // 保存原始样式
    const originalStyle = {
        position: panel.style.position,
        left: panel.style.left,
        top: panel.style.top,
        width: panel.style.width,
        height: panel.style.height,
        zIndex: panel.style.zIndex
    };
    
    // 添加拖拽指示器
    panelHeader.style.cursor = 'move';
    panelHeader.style.userSelect = 'none';
    
    // 双击恢复原始位置
    panelHeader.addEventListener('dblclick', (e) => {
        if (e.target.closest('.panel-controls')) return;
        
        // 恢复原始样式
        Object.keys(originalStyle).forEach(key => {
            if (originalStyle[key]) {
                panel.style[key] = originalStyle[key];
            } else {
                panel.style[key] = '';
            }
        });
        panel.classList.remove('dragging');
    });
    
    panelHeader.addEventListener('mousedown', (e) => {
        // 忽略控件按钮点击
        if (e.target.closest('.panel-controls') || e.target.closest('button') || e.target.closest('select') || e.target.closest('input')) {
            return;
        }
        
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        
        const rect = panel.getBoundingClientRect();
        offsetX = startX - rect.left;
        offsetY = startY - rect.top;
        
        // 将面板设置为绝对定位
        panel.style.position = 'absolute';
        panel.style.zIndex = '9999';
        panel.style.left = rect.left + 'px';
        panel.style.top = rect.top + 'px';
        panel.style.width = rect.width + 'px';
        panel.style.height = rect.height + 'px';
        
        document.body.style.userSelect = 'none';
        
        // 添加拖拽样式
        panel.classList.add('dragging');
        
        function handleMouseMove(e) {
            if (!isDragging) return;
            
            const newX = e.clientX - offsetX;
            const newY = e.clientY - offsetY;
            
            // 限制在视窗内
            const maxX = window.innerWidth - panel.offsetWidth;
            const maxY = window.innerHeight - panel.offsetHeight;
            
            panel.style.left = Math.max(0, Math.min(newX, maxX)) + 'px';
            panel.style.top = Math.max(0, Math.min(newY, maxY)) + 'px';
        }
        
        function handleMouseUp() {
            isDragging = false;
            document.body.style.userSelect = '';
            panel.classList.remove('dragging');
            
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        }
        
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    });
}

// 初始化所有面板的拖拽功能
function initializePanelDragging() {
    const draggablePanels = [
        'code-panel',
        'elf-analyzer-panel',
        'registers-panel', 
        'memory-panel',
        'cpu-monitor-panel'
    ];
    
    draggablePanels.forEach(panelId => {
        const panel = document.getElementById(panelId);
        if (panel) {
            makePanelDraggable(panel);
        }
    });
}

// 更新初始化函数
document.addEventListener('DOMContentLoaded', function() {
    // 初始化所有面板
    initializeToolPanels();
    initializeResizeHandle();
    initializeLeftResizeHandle();
    initializePanelDragging(); // 添加面板拖拽初始化
    
    // 创建CPU监控器实例
    if (typeof CPUMonitor !== 'undefined') {
        cpuMonitor = new CPUMonitor();
        console.log('CPU监控器已创建');
    } else {
        console.error('CPUMonitor类未找到');
    }
    
    // 创建ELF分析器实例
    if (typeof ELFAnalyzerUI !== 'undefined') {
        elfAnalyzerUI = new ELFAnalyzerUI();
        console.log('ELF分析器已创建');
    } else {
        console.error('ELFAnalyzerUI类未找到');
    }
    
    // 初始化Socket连接
    initializeSocket();
    
    // 初始化Socket处理器
    initializeSocketHandlers();
    
    // 设置定期更新，只在程序运行时更新
    setInterval(() => {
        if (cpuMonitor && cpuMonitor.isRunning && debugState && debugState.debugging) {
            updateDebuggerState();
        }
    }, 1000); // 每秒更新一次
    
    console.log('Spike调试器应用已初始化');
}); 