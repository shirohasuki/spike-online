// Spike RISC-V 调试器服务器
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const pty = require('node-pty');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// 静态文件服务
app.use(express.static(path.join(__dirname, 'public')));
app.use('/src', express.static(path.join(__dirname, 'src')));

// 确保temp目录存在
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

// 文件上传配置 - 保留原始文件名
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, tempDir);
    },
    filename: function (req, file, cb) {
        // 保留原始文件名，如果重复则添加时间戳
        const ext = path.extname(file.originalname);
        const name = path.basename(file.originalname, ext);
        const timestamp = Date.now();
        const finalName = `${name}_${timestamp}${ext}`;
        cb(null, finalName);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB限制
    fileFilter: (req, file, cb) => {
        // 允许ELF文件和常见的可执行文件
        const allowedTypes = ['.elf', '.out', '.bin', ''];
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, allowedTypes.includes(ext) || !ext);
    }
});

// 文件上传路由
app.post('/upload', upload.single('elfFile'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No file uploaded' });
        }

        // 检查文件是否为有效的ELF文件
        const filePath = req.file.path;
        const fileBuffer = fs.readFileSync(filePath);
        
        // 基本的ELF魔数检查
        if (fileBuffer.length < 4 || fileBuffer.toString('hex', 0, 4) !== '7f454c46') {
            fs.unlinkSync(filePath); // 删除无效文件
            return res.status(400).json({ success: false, error: 'Invalid ELF file' });
        }

        res.json({
            success: true,
            filename: req.file.filename,
            originalName: req.file.originalname,
            path: filePath
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ success: false, error: 'Upload failed' });
    }
});

// 调试会话管理
const debugSessions = new Map();

class DebugSession {
    constructor(socketId) {
        this.socketId = socketId;
        this.spikeProcess = null;
        this.isRunning = false;
        this.isInitialized = false;  // 添加初始化完成标志
        this.isContinuousMode = false;  // 新增：跟踪是否在连续执行模式
        this.waitingForOutput = false;  // 新增：等待指令输出完成
        this.waitingForFrontend = false;  // 新增：等待前端处理完成
        this.pc = 0;
        this.instructionCount = 0;
    }

    startDebug(options) {
        if (this.spikeProcess) {
            this.stopDebug();
        }

        const { filename } = options;
        const projectRoot = path.join(__dirname, '..');
        const elfFilePath = path.join(projectRoot, 'web', 'temp', filename);  // 用于文件存在性检查
        
        // 检查ELF文件是否存在
        if (!fs.existsSync(elfFilePath)) {
            io.to(this.socketId).emit('debug-output', {
                type: 'error',
                message: `❌ ELF文件未找到: ${filename}`,
                timestamp: new Date()
            });
            return;
        }

        console.log('Starting Spike with interactive debugging...');
        
        // 发送启动消息到前端日志区
        io.to(this.socketId).emit('debug-output', {
            type: 'info',
            message: '🚀 正在启动 Spike 调试器...',
            timestamp: new Date()
        });
        
        // Spike调试器参数：使用交互式调试模式
        const args = [
            '-d',                     // 启用交互式调试模式
            elfFilePath           // 使用相对于项目根目录的路径
        ];

        // 启动Spike进程 - 使用绝对路径确保找到正确的spike可执行文件
        const spikePath = path.join(projectRoot, 'build', 'spike');
        console.log(`Spawning Spike process: ${spikePath}`);
        console.log(`Arguments: ${args.join(' ')}`);
        console.log(`Working directory: ${projectRoot}`);
        
        this.spikeProcess = pty.spawn(spikePath, args, {
            name: 'xterm-color',
            cols: 80,
            rows: 24,
            cwd: projectRoot,  // 确保工作目录是项目根目录
            env: process.env
        });

        this.isRunning = true;

        this.spikeProcess.on('data', (data) => {
            this.handleSpikeOutput(data);
        });

        this.spikeProcess.on('exit', (code, signal) => {
            console.log(`Spike process exited with code ${code}, signal: ${signal}`);
            
            // 发送退出消息到前端日志区
            let messageType, message;
            
            if (code === 0) {
                messageType = 'info';
                message = `🏁 仿真正常结束 (退出码: ${code})`;
            } else if (code === 1) {
                messageType = 'error';
                message = `❌ 仿真异常结束 - 程序失败 (退出码: ${code})`;
            } else if (code === null || code === 130) {
                messageType = 'warning';
                message = `⏸️ 仿真被用户中断 (SIGINT)`;
            } else {
                messageType = 'warning';
                message = `⚠️ 仿真异常结束 (退出码: ${code})`;
            }
                
            io.to(this.socketId).emit('debug-output', {
                type: messageType,
                message: message,
                timestamp: new Date()
            });
            
            // 停止连续执行
            this.isContinuousMode = false;
            this.waitingForOutput = false;
            this.waitingForFrontend = false;
            
            this.isRunning = false;
            this.spikeProcess = null;  // 清理进程引用
            io.to(this.socketId).emit('debug-stopped');
        });

        // 添加错误处理
        this.spikeProcess.on('error', (error) => {
            console.error(`Spike process error:`, error);
            
            io.to(this.socketId).emit('debug-output', {
                type: 'error',
                message: `❌ Spike进程错误: ${error.message}`,
                timestamp: new Date()
            });
            
            // 停止连续执行
            this.isContinuousMode = false;
            this.waitingForOutput = false;
            this.waitingForFrontend = false;
            
            this.isRunning = false;
            this.spikeProcess = null;
            io.to(this.socketId).emit('debug-stopped');
        });

        // 等待Spike启动后发送初始化命令
        setTimeout(() => {
            if (this.isRunning) {
                console.log('Spike started, checking interactive mode...');
                
                // 发送启动成功消息到前端日志区
                io.to(this.socketId).emit('debug-output', {
                    type: 'info',
                    message: '✅ Spike 调试器启动成功，进入交互模式',
                    timestamp: new Date()
                });
                
                // 首先发送help命令测试交互模式
                // this.spikeProcess.write('help\n');
                // 不发送空行，直接通知前端调试已启动
                setTimeout(() => {
                    // 移除自动发送空行，避免自动执行第一条指令
                    // this.spikeProcess.write('\n');
                    
                    // 设置初始化完成标志
                    this.isInitialized = true;
                    io.to(this.socketId).emit('debug-started');
                }, 500);
            }
        }, 1500);
    }

    handleSpikeOutput(output) {
        const outputStr = output.toString();
        
        // 清理ANSI转义序列
        const cleanOutput = outputStr.replace(/\x1b\[[0-9;]*[mGKHf]/g, '').replace(/\r/g, '');
        
        // 分割输出行并处理每一行
        const lines = cleanOutput.split('\n');
        
        for (let line of lines) {
            line = line.trim();
            if (!line) continue;
            
            // 检查是否是Spike提示符（表示命令执行完成）
            if (this.containsSpikePrompt(line)) {
                // 如果在连续执行模式且正在等待输出，标记后端处理完成，但等待前端确认
                if (this.isContinuousMode && this.waitingForOutput && this.isRunning) {
                    this.waitingForOutput = false;
                    this.waitingForFrontend = true; // 新增：等待前端处理完成的标志
                }
                
                // 但是如果包含重要信息，则不过滤
                if (this.isImportantMessage(line)) {
                    console.log(`Important message in spike prompt: ${line}`);
                } else {
                    continue;
                }
            }
            
            // 跳过纯命令回显（只包含 run、r、run 1 等命令的行）
            if (this.isCommandEcho(line)) {
                continue;
            }
            
            // 检查是否是仿真结束信号并设置合适的消息类型
            const messageType = this.getMessageType(line);
            
            // 发送有意义的输出到前端
            io.to(this.socketId).emit('debug-output', {
                type: messageType,
                message: line,
                timestamp: new Date()
            });
            
            // 解析执行日志更新状态
            this.parseExecutionLog(line);
        }
    }
    
    isCommandEcho(line) {
        // 检查是否是命令回显
        const commandPatterns = [
            /^r+$/,                       // 只包含 r 字符
            /^ru+$/,                      // r和u的组合
            /^run+$/,                     // run的部分或完整输入
            /^run 1$/,                    // 完整的 run 1 命令
            /^run$/,                      // 完整的 run 命令
            /^help$/,                     // help 命令
            /^[rnu ]+$/,                  // 只包含 r, u, n, 空格的组合
            /^\(spike\)\s*[run1 ]*$/,     // spike提示符后跟命令片段
            /^\(spike\)\s*r$/,            // spike提示符后跟单个r
            /^\(spike\)\s*ru$/,           // spike提示符后跟ru
            /^\(spike\)\s*run$/,          // spike提示符后跟run
            /^\(spike\)\s*run 1$/,        // spike提示符后跟run 1
            /^[r ]+$/,                    // 只包含r和空格
            /^[ru ]+$/,                   // 只包含r、u和空格
        ];
        
        return commandPatterns.some(pattern => pattern.test(line));
    }
    
    containsSpikePrompt(line) {
        // 检查是否是纯Spike提示符行（需要过滤）
        // 但不过滤包含指令执行信息的行
        
        // 如果行只包含(spike)提示符（可能还有空格），则过滤
        if (/^\s*\(spike\)\s*$/.test(line)) {
            return true;
        }
        
        // 如果行包含core执行信息，则不过滤（即使包含spike提示符）
        if (line.includes('core') && line.includes('0x')) {
            return false;
        }
        
        // 其他包含(spike)的行可能是命令回显，需要过滤
        return line.includes('(spike)');
    }
    
    getMessageType(line) {
        // 识别不同类型的消息并返回合适的类型
        
        // 仿真结束信号
        if (line.includes('*** FAILED ***')) {
            return 'error';
        }
        
        // 成功退出信号
        if (line.includes('*** PASSED ***') || line.match(/tohost\s*=\s*1/)) {
            return 'info';
        }
        
        // 错误和异常信息
        if (line.includes('ERROR') || line.includes('EXCEPTION') || 
            line.includes('ABORT') || line.includes('FAULT')) {
            return 'error';
        }
        
        // 警告信息
        if (line.includes('WARNING') || line.includes('WARN')) {
            return 'warning';
        }
        
        // 系统调用退出相关
        if (line.includes('exit') || line.includes('Exit') || 
            line.includes('tohost') || line.includes('sys_exit')) {
            return 'warning';
        }
        
        // 默认为信息类型
        return 'info';
    }
    
    isImportantMessage(line) {
        // 检查是否是重要信息，即使包含(spike)也不应该被过滤
        const importantPatterns = [
            /\*\*\* FAILED \*\*\*/,
            /\*\*\* PASSED \*\*\*/,
            /tohost\s*=/,
            /ERROR/i,
            /EXCEPTION/i,
            /ABORT/i,
            /FAULT/i,
            /exit/i,
            /halt/i,
            /terminate/i,
            /finish/i,
            /end/i
        ];
        
        return importantPatterns.some(pattern => pattern.test(line));
    }
    
    checkForExitPatterns(instruction, pc) {
        // 检查是否是程序退出相关的指令模式
        
        // ECALL指令 - 通常用于系统调用
        if (instruction.includes('ecall')) {
            console.log(`Detected ECALL at PC: ${pc}`);
            // 停止连续执行模式
            this.isContinuousMode = false;
            this.waitingForOutput = false;
            this.waitingForFrontend = false;
            
            io.to(this.socketId).emit('debug-output', {
                type: 'warning',
                message: `🚪 检测到系统调用 (ecall) at PC: ${pc}，自动停止连续执行`,
                timestamp: new Date()
            });
        }
        
        // EBREAK指令 - 通常用于调试断点或程序结束
        if (instruction.includes('ebreak')) {
            // 停止连续执行模式
            this.isContinuousMode = false;
            this.waitingForOutput = false;
            this.waitingForFrontend = false;
            
            io.to(this.socketId).emit('debug-output', {
                type: 'warning',
                message: `💡 检测到断点指令 (ebreak) at PC: ${pc}，自动停止连续执行`,
                timestamp: new Date()
            });
        }
        
        // WFI指令 - 等待中断，可能表示程序进入等待状态
        if (instruction.includes('wfi')) {
            // 停止连续执行模式
            this.isContinuousMode = false;
            this.waitingForOutput = false;
            this.waitingForFrontend = false;
            
            io.to(this.socketId).emit('debug-output', {
                type: 'info',
                message: `⏸️ 程序进入等待状态 (wfi) at PC: ${pc}，自动停止连续执行`,
                timestamp: new Date()
            });
        }
    }
    
    isSpikePromptLine(line) {
        // 检查是否是Spike提示符行（包含命令回显的提示符行）
        const promptPatterns = [
            /^\(spike\)\s*$/,                    // 纯提示符
            /^\(spike\)\s+[rnu ]+$/,            // 提示符后跟部分命令
            /^\(spike\)\s+r\s*$/,               // 提示符后跟单个r
            /^\(spike\)\s+ru\s*$/,              // 提示符后跟ru
            /^\(spike\)\s+run\s*$/,             // 提示符后跟run
            /^\(spike\)\s+run\s+1\s*$/,         // 提示符后跟run 1
            /^\(spike\)\s*[rnu ]*\(spike\)/,    // 包含多个提示符的行
            /^.*\(spike\)\s*[rnu ]*$/,          // 以命令回显+提示符结尾
        ];
        
        return promptPatterns.some(pattern => pattern.test(line));
    }

    parseExecutionLog(logLine) {
        // 只有在初始化完成后才处理指令执行，避免自动执行第一条指令
        if (!this.isInitialized) {
            return;
        }
        
        // 解析core执行行
        const match = logLine.match(/^core\s+(\d+):\s+(?:(\d+)\s+)?(0x[0-9a-fA-F]+)\s+\((0x[0-9a-fA-F]+)\)\s*(.*)$/);
        if (match) {
            const [, core, priv, pc, instruction, disasm] = match;
            
            if (disasm && disasm.trim()) {
                // 移除特权级检查，只要有反汇编信息就认为是有效指令
                this.pc = parseInt(pc, 16);
                this.instructionCount++;
                
                // 只在非连续模式或每100条指令时输出调试信息
                if (!this.isContinuousMode || this.instructionCount % 100 === 0) {
                    console.log(`Processing instruction ${this.instructionCount}: ${disasm.trim()} at PC ${pc}`);
                }
                
                // 合并PC和指令更新为一个消息，减少消息数量
                io.to(this.socketId).emit('execution-update', {
                    pc: this.pc,
                    count: this.instructionCount,
                    current: disasm.trim()
                });
                
                // 检查是否是程序退出相关的指令
                this.checkForExitPatterns(disasm.trim(), pc);
                
                // 注意：不在这里触发下一条指令，而是等待 Spike 提示符出现
            }
        }
    }

    sendCommand(command) {
        if (this.spikeProcess && this.isRunning) {
            console.log(`Sending command to Spike: "${command}"`);
            this.spikeProcess.write(command + '\n');
        } else {
            console.log('Spike process not running, cannot send command');
        }
    }

    pauseDebug() {
        // 停止连续执行模式
        this.isContinuousMode = false;
        this.waitingForOutput = false;
        this.waitingForFrontend = false;
        
        io.to(this.socketId).emit('debug-output', {
            type: 'warning',
            message: '⏸️ 连续执行已暂停',
            timestamp: new Date()
        });
    }

    stepDebug() {
        this.sendCommand('run 1');  // 单步执行一条指令
    }
    


    continueDebug() {
        // 启动连续执行模式 - 基于输出反馈执行
        this.isContinuousMode = true;
        this.executeNextInstruction();
        
        io.to(this.socketId).emit('debug-output', {
            type: 'info',
            message: '▶️ 开始连续执行模式 (基于指令完成反馈)',
            timestamp: new Date()
        });
    }
    
    executeNextInstruction() {
        if (!this.isContinuousMode || !this.isRunning || this.waitingForOutput || this.waitingForFrontend || !this.spikeProcess) {
            return;
        }
        
        // 标记正在等待输出
        this.waitingForOutput = true;
        
        // 发送 run 1 命令
        this.sendCommand('run 1');
    }
    
    onFrontendReady() {
        if (this.waitingForFrontend && this.isContinuousMode && this.isRunning) {
            this.waitingForFrontend = false;
            this.executeNextInstruction();
        }
    }

    resetDebug() {
        // 停止连续执行
        this.isContinuousMode = false;
        this.waitingForOutput = false;
        this.waitingForFrontend = false;
        
        // 发送重置消息到前端日志区
        io.to(this.socketId).emit('debug-output', {
            type: 'warning',
            message: '🔄 调试会话已重置',
            timestamp: new Date()
        });
        
        this.isInitialized = false;  // 重置初始化标志
        this.stopDebug();
        io.to(this.socketId).emit('debug-reset');
    }

    stopDebug() {
        // 停止连续执行
        this.isContinuousMode = false;
        this.waitingForOutput = false;
        this.waitingForFrontend = false;
        
        if (this.spikeProcess) {
            this.spikeProcess.kill();
            this.spikeProcess = null;
        }
        
        this.isRunning = false;
        this.isInitialized = false;  // 重置初始化标志
        io.to(this.socketId).emit('debug-stopped');
    }

    async getPerformanceStats() {
        // 简化的性能统计 - 返回基本数据
        return {
            icacheAccesses: 0,
            icacheMisses: 0,
            dcacheAccesses: 0,
            dcacheMisses: 0,
            stallCycles: 0,
            memoryAccessCycles: 0,
            totalMemoryAccesses: 0,
            totalCycles: this.instructionCount * 2, // 简单估算
            totalInstructions: this.instructionCount
        };
    }

    cleanup() {
        this.stopDebug();
    }

    cleanSpikeOutput(output) {
        // 基本清理 - 移除ANSI转义序列
        let cleaned = output.replace(/\x1b\[[0-9;]*[mGKHf]/g, '');
        cleaned = cleaned.replace(/\x00/g, '');
        return cleaned.trim();
    }
}

// Socket.IO 连接处理
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    // 创建调试会话
    const session = new DebugSession(socket.id);
    debugSessions.set(socket.id, session);
    
    // 发送连接确认
    socket.emit('connection-confirmed', { 
        socketId: socket.id,
        timestamp: new Date()
    });
    
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
    
    socket.on('get-performance-stats', async () => {
        const stats = await session.getPerformanceStats();
        socket.emit('performance-stats', stats);
    });
    
    socket.on('frontend-ready', () => {
        console.log('Frontend ready for next instruction');
        session.onFrontendReady();
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