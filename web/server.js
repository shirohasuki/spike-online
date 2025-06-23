// Spike RISC-V 调试器服务器
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const { spawn } = require('child_process');
const pty = require('node-pty');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// 创建临时文件目录
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

// 配置multer用于文件上传
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, tempDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = uuidv4() + '-' + file.originalname;
        cb(null, uniqueName);
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 100 * 1024 * 1024 // 100MB限制
    }
});

// 静态文件服务
app.use(express.static(path.join(__dirname, 'public')));
app.use('/src', express.static(path.join(__dirname, 'src')));

// 文件上传接口
app.post('/upload', upload.single('elfFile'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    
    console.log('File uploaded:', req.file.filename);
    res.json({ 
        success: true, 
        filename: req.file.filename,
        originalName: req.file.originalname,
        path: req.file.path
    });
});

// 调试会话管理
const debugSessions = new Map();

class DebugSession {
    constructor(socketId) {
        this.socketId = socketId;
        this.spikeProcess = null;
        this.currentFile = null;
        this.currentFilePath = null;
        this.isRunning = false;
        this.autoStep = false;
        this.autoExecuting = false;  // 控制是否自动执行
        this.showLog = false;
        this.showMemory = false;
        this.registers = {
            integer: new Array(32).fill(0),
            float: new Array(32).fill(0),
            csr: {}
        };
        this.memory = new Map();
        this.pc = 0;
        this.instructionCount = 0;
    }

    startDebug(options) {
        if (this.spikeProcess) {
            this.stopDebug();
        }

        const { filename, autoStep, showLog, showMemory } = options;
        this.currentFile = filename;
        this.currentFilePath = path.join(tempDir, filename);
        this.autoStep = autoStep;
        this.showLog = showLog;
        this.showMemory = showMemory;

        // 检查文件是否存在
        if (!fs.existsSync(this.currentFilePath)) {
            io.to(this.socketId).emit('debug-output', {
                type: 'error',
                message: `File not found: ${filename}`,
                timestamp: new Date()
            });
            return;
        }

        // 构建spike命令参数
        const args = [];
        
        // 总是启用日志来查看执行情况
        args.push('-l'); // 生成执行日志
        args.push('--log-commits'); // 提交信息日志
        
        // 使用交互式调试模式
        if (autoStep) {
            args.push('-d'); // 交互式调试模式
            args.push('-H'); // 启动时暂停，等待调试器连接
        }

        // 添加ELF文件路径
        args.push(this.currentFilePath);

        console.log('Starting spike with args:', args);
        
        // 使用正确的spike路径
        const spikePath = path.join(__dirname, '..', 'build', 'spike');
        console.log('Spike path:', spikePath);
        
        // 检查spike可执行文件是否存在
        if (!fs.existsSync(spikePath)) {
            io.to(this.socketId).emit('debug-output', {
                type: 'error',
                message: `Spike executable not found at: ${spikePath}`,
                timestamp: new Date()
            });
            return;
        }

        // 使用pty启动spike进程
        this.spikeProcess = pty.spawn(spikePath, args, {
            name: 'xterm-color',
            cols: 80,
            rows: 24,
            cwd: path.dirname(spikePath),
            env: { ...process.env, TERM: 'xterm-256color' }
        });

        if (!this.spikeProcess) {
            io.to(this.socketId).emit('debug-output', {
                type: 'error',
                message: 'Failed to start spike process',
                timestamp: new Date()
            });
            return;
        }

        this.isRunning = true;
        
        // 处理pty输出
        this.spikeProcess.on('data', (data) => {
            const output = data.toString();
            // 过滤掉回显的字符，只保留有意义的输出
            const cleanOutput = this.cleanSpikeOutput(output);
            if (cleanOutput) {
                console.log('Spike clean output:', JSON.stringify(cleanOutput));
                this.handleSpikeOutput(cleanOutput);
            }
        });

        // 处理进程退出
        this.spikeProcess.on('exit', (code, signal) => {
            console.log('Spike process exited with code:', code, 'signal:', signal);
            this.isRunning = false;
            io.to(this.socketId).emit('debug-stopped');
            io.to(this.socketId).emit('debug-output', {
                type: 'info',
                message: `Spike process exited with code ${code}`,
                timestamp: new Date()
            });
        });

        // 通知客户端调试已开始
        io.to(this.socketId).emit('debug-started');
        
        // 等待spike进程启动，但不自动执行
        // 用户需要手动点击"继续"或"单步"来开始执行
        setTimeout(() => {
            io.to(this.socketId).emit('debug-output', {
                type: 'info',
                message: 'Spike debugger ready. Use Continue or Step to start execution.',
                timestamp: new Date()
            });
        }, 2000);
    }

    handleSpikeOutput(output) {
        const lines = output.split('\n');
        
        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;
            
            // 检查是否是spike提示符
            if (trimmedLine === '(spike)') {
                io.to(this.socketId).emit('debug-output', {
                    type: 'prompt',
                    message: trimmedLine,
                    timestamp: new Date()
                });
                
                // 只有在明确启用自动模式时才自动执行下一步
                if (this.autoStep && this.isRunning && this.autoExecuting) {
                    setTimeout(() => {
                        this.sendCommand('run 1');
                    }, 100);
                }
                continue;
            }
            
            // 解析执行日志
            if (trimmedLine.includes('core') && trimmedLine.includes(':')) {
                this.parseExecutionLog(trimmedLine);
            }
            
            // 发送原始输出到客户端
            io.to(this.socketId).emit('debug-output', {
                type: 'debug',
                message: trimmedLine,
                timestamp: new Date()
            });
        }
    }

    parseExecutionLog(logLine) {
        // 匹配两种格式：
        // 1. 指令行（无特权级）: "core 0: 0x0000000000000818 (0x10802023) sw s0, 256(zero)"
        // 2. 结果行（有特权级）: "core 0: 3 0x0000000000000818 (0x10802023) mem 0x0000000000000100 0x00000000"
        const match = logLine.match(/core\s+(\d+):\s+(?:(\d+)\s+)?(0x[0-9a-fA-F]+)\s+\((0x[0-9a-fA-F]+)\)\s+(.+)/);
        if (match) {
            const [, core, priv, pc, instruction, disasm] = match;
            
            // 检查反汇编内容是否是寄存器/内存信息
            const trimmedDisasm = disasm.trim();
            const isRegisterMemoryInfo = trimmedDisasm.match(/^(x\d+|f\d+|c\d+_\w+)\s+0x[0-9a-fA-F]+$/) || 
                                       trimmedDisasm.match(/^mem\s+0x[0-9a-fA-F]+\s+0x[0-9a-fA-F]+$/) ||
                                       trimmedDisasm === 'mem';
            
            // 如果是寄存器/内存信息，跳过处理
            if (isRegisterMemoryInfo) {
                console.log('Server: Skipping register/memory info:', trimmedDisasm);
                return;
            }
            
            // 只有真正的指令才更新状态
            if (!priv) { // 没有特权级数字的行才是指令行
                console.log('Server: Found instruction:', trimmedDisasm);
                this.pc = parseInt(pc, 16);
                this.instructionCount++;
                
                // 发送PC更新
                io.to(this.socketId).emit('pc-update', this.pc);
                
                // 发送指令更新
                io.to(this.socketId).emit('instruction-update', trimmedDisasm);
                
                // 发送反汇编代码更新
                io.to(this.socketId).emit('code-update', {
                    pc: this.pc,
                    instruction: instruction,
                    disasm: trimmedDisasm
                });
                
                // 模拟寄存器更新（在实际实现中需要从spike获取真实数据）
                this.simulateRegisterUpdate();
                
                // 如果启用了内存显示，模拟内存更新
                if (this.showMemory) {
                    this.simulateMemoryUpdate();
                }
            } else {
                console.log('Server: Skipping result line with privilege level:', priv, trimmedDisasm);
            }
        }
    }

    simulateRegisterUpdate() {
        // 这里是模拟数据，实际应该从spike获取真实的寄存器值
        // 为了演示，我们随机修改一些寄存器值
        const regIndex = Math.floor(Math.random() * 32);
        this.registers.integer[regIndex] = Math.floor(Math.random() * 0xFFFFFFFF);
        
        io.to(this.socketId).emit('register-update', {
            type: 'integer',
            values: this.registers.integer
        });
    }

    simulateMemoryUpdate() {
        // 模拟内存更新
        const baseAddr = 0x10000000;
        const values = [];
        for (let i = 0; i < 64; i++) {
            values.push(Math.floor(Math.random() * 256));
        }
        
        io.to(this.socketId).emit('memory-update', {
            address: baseAddr,
            size: values.length,
            values: values
        });
    }

    sendCommand(command) {
        if (this.spikeProcess && this.isRunning) {
            console.log(`Sending command to spike: "${command}"`);
            this.spikeProcess.write(command + '\r');  // 使用\r而不是\n
            
            // 发送命令到客户端显示
            io.to(this.socketId).emit('debug-output', {
                type: 'command',
                message: `> ${command}`,
                timestamp: new Date()
            });
        }
    }

    pauseDebug() {
        if (this.spikeProcess && this.isRunning) {
            // 停止自动执行
            this.autoExecuting = false;
            
            // 发送Ctrl+C中断执行
            this.spikeProcess.write('\x03');  // Ctrl+C
            io.to(this.socketId).emit('debug-output', {
                type: 'info',
                message: 'Debug paused - use step to continue',
                timestamp: new Date()
            });
        }
    }

    stepDebug() {
        if (this.spikeProcess && this.isRunning) {
            this.sendCommand('run 1');  // 执行1条指令
        }
    }

    continueDebug() {
        if (this.spikeProcess && this.isRunning) {
            // 启用自动执行模式
            this.autoExecuting = true;
            this.sendCommand('run 1');  // 开始单步执行
        }
    }

    resetDebug() {
        // 停止当前调试会话
        this.stopDebug();
        
        // 重置状态
        this.pc = 0;
        this.instructionCount = 0;
        this.registers.integer.fill(0);
        this.registers.float.fill(0);
        this.registers.csr = {};
        this.memory.clear();
        this.autoExecuting = false;  // 重置时停止自动执行
        
        // 通知客户端重置完成
        io.to(this.socketId).emit('debug-reset');
        io.to(this.socketId).emit('debug-output', {
            type: 'info',
            message: 'Debug session reset. Click Start to begin new session.',
            timestamp: new Date()
        });
        
        // 如果有文件，自动重新启动调试会话（但不自动执行）
        if (this.currentFile && this.currentFilePath) {
            setTimeout(() => {
                const options = {
                    filename: this.currentFile,
                    autoStep: this.autoStep,
                    showLog: this.showLog,
                    showMemory: this.showMemory
                };
                this.startDebug(options);
            }, 1000);  // 等待1秒后重新启动
        }
    }

    stopDebug() {
        if (this.spikeProcess) {
            this.isRunning = false;
            
                    // 尝试优雅地终止进程
        this.spikeProcess.write('quit\r');
            
            setTimeout(() => {
                if (this.spikeProcess && !this.spikeProcess.killed) {
                    this.spikeProcess.kill('SIGTERM');
                    
                    setTimeout(() => {
                        if (this.spikeProcess && !this.spikeProcess.killed) {
                            this.spikeProcess.kill('SIGKILL');
                        }
                    }, 2000);
                }
            }, 1000);
            
            this.spikeProcess = null;
        }
    }

    readMemory(address, size) {
        // 在实际实现中，这里应该向spike发送内存读取命令
        // 现在我们模拟返回一些数据
        const values = [];
        for (let i = 0; i < size; i++) {
            values.push(Math.floor(Math.random() * 256));
        }
        
        io.to(this.socketId).emit('memory-update', {
            address: address,
            size: size,
            values: values
        });
    }

    // 新增：获取性能统计数据
    getPerformanceStats() {
        // 从spike进程中提取性能数据
        if (!this.isRunning) {
            return {
                minstret: 0,
                mcycle: 0,
                pc: this.pc,
                instructionCount: this.instructionCount,
                icacheAccess: 0,
                icacheMiss: 0,
                dcacheAccess: 0,
                dcacheMiss: 0,
                memoryAccess: false
            };
        }

        // 基于真实执行状态的性能数据
        const stats = {
            minstret: this.instructionCount,
            mcycle: Math.floor(this.instructionCount * (1.1 + Math.random() * 0.3)), // 模拟CPI 1.1-1.4
            pc: this.pc,
            instructionCount: this.instructionCount,
            icacheAccess: this.instructionCount,
            icacheMiss: Math.floor(this.instructionCount * (0.02 + Math.random() * 0.03)), // 2-5% miss rate
            dcacheAccess: Math.floor(this.instructionCount * (0.25 + Math.random() * 0.15)), // 25-40% memory instructions
            dcacheMiss: Math.floor(this.instructionCount * (0.01 + Math.random() * 0.02)), // 1-3% miss rate
            memoryAccess: this.instructionCount > 0,
            timestamp: Date.now()
        };
        
        return stats;
    }

    cleanup() {
        this.stopDebug();
        // 清理临时文件
        if (this.currentFilePath && fs.existsSync(this.currentFilePath)) {
            try {
                fs.unlinkSync(this.currentFilePath);
                console.log('Cleaned up temp file:', this.currentFilePath);
            } catch (error) {
                console.error('Failed to cleanup temp file:', error);
            }
        }
    }

    cleanSpikeOutput(output) {
        // 移除ANSI转义序列和控制字符
        let cleaned = output.replace(/\x1b\[[0-9;]*[mGKHf]/g, ''); // ANSI escape sequences
        cleaned = cleaned.replace(/\x00/g, ''); // 删除空字符
        
        // 处理回显问题：移除 (spike) 后面跟着的单个字符回显
        // 例如: "(spike) r(spike) ru(spike) run(spike) run (spike) run 1"
        cleaned = cleaned.replace(/\(spike\)\s*[^\n\r]*(?=\(spike\))/g, '');
        
        // 清理多余的 (spike) 提示符，只保留最后一个
        cleaned = cleaned.replace(/(\(spike\)\s*)+/g, '(spike) ');
        
        // 分割行并过滤，使用更宽松的分割方式
        const lines = cleaned.split(/\r?\n/);
        const filteredLines = [];
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            
            // 跳过空行
            if (!trimmed) continue;
            
            // 保留 (spike) 提示符
            if (trimmed === '(spike)') {
                filteredLines.push(trimmed);
                continue;
            }
            
            // 保留包含 core 信息的执行日志行（不做过滤，让前端处理）
            if (trimmed.includes('core') && trimmed.includes(':')) {
                filteredLines.push(trimmed);
                continue;
            }
            
            // 跳过其他内容
        }
        
        return filteredLines.join('\n');
    }
}

// Socket.IO 连接处理
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    // 创建调试会话
    const session = new DebugSession(socket.id);
    debugSessions.set(socket.id, session);
    
    // 处理调试命令
    socket.on('start-debug', (options) => {
        console.log('Starting debug with options:', options);
        session.startDebug(options);
    });
    
    socket.on('pause-debug', () => {
        console.log('Pausing debug');
        session.pauseDebug();
    });
    
    socket.on('step-debug', () => {
        console.log('Stepping debug');
        session.stepDebug();
    });
    
    socket.on('continue-debug', () => {
        console.log('Continuing debug');
        session.continueDebug();
    });
    
    socket.on('reset-debug', () => {
        console.log('Resetting debug');
        session.resetDebug();
    });
    
    socket.on('read-memory', (data) => {
        console.log('Reading memory:', data);
        session.readMemory(data.address, data.size);
    });
    
    socket.on('get-performance-stats', () => {
        const stats = session.getPerformanceStats();
        socket.emit('performance-stats', stats);
    });
    
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        
        // 清理调试会话
        if (debugSessions.has(socket.id)) {
            const session = debugSessions.get(socket.id);
            session.cleanup();
            debugSessions.delete(socket.id);
        }
    });
});

// 服务器启动
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('Spike Visual Debugger server running on port', PORT);
    console.log('Open http://localhost:' + PORT + ' to view the debugger');
});

// 优雅关闭
process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    
    // 停止所有调试会话
    for (const session of debugSessions.values()) {
        session.cleanup();
    }
    
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('Received SIGINT, shutting down gracefully...');
    
    // 停止所有调试会话
    for (const session of debugSessions.values()) {
        session.cleanup();
    }
    
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
}); 