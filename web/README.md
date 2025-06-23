# Spike RISC-V CPU Monitor

一个基于Web的实时CPU监视器和可视化工具，用于监控Spike RISC-V模拟器的执行过程。

## 功能特性

- 🖥️ **实时CPU状态监控** - 显示程序计数器、当前指令、特权级别等
- 📊 **寄存器可视化** - 实时显示整数、浮点和CSR寄存器的变化
- 💾 **内存访问追踪** - 记录和显示内存读写操作
- 📈 **执行统计** - 显示指令数量、执行时间、IPC等统计信息
- 🎮 **交互式控制** - 支持启动、停止、单步执行和重置
- 🌐 **现代化Web界面** - 响应式设计，支持移动设备

## 系统要求

- Node.js (版本 14 或更高)
- npm (Node包管理器)
- 已编译的Spike RISC-V模拟器

## 快速开始

### 1. 构建Spike模拟器

首先确保Spike已经正确编译：

```bash
# 在项目根目录
cd ..
./configure
make
```

### 2. 安装和启动CPU监视器

```bash
# 进入web目录
cd web

# 使用启动脚本（推荐）
./start.sh

# 或者手动安装和启动
npm install
npm start
```

```
npm install multer uuid
npm install node-pty
```

### 3. 访问Web界面

打开浏览器访问：http://localhost:3000

## 使用说明

### 基本操作

1. **启动仿真** - 点击"Start Simulation"按钮开始执行
2. **停止仿真** - 点击"Stop"按钮停止执行
3. **单步执行** - 点击"Step"按钮逐条执行指令
4. **重置** - 点击"Reset"按钮清空所有执行数据

### 界面说明

#### CPU状态面板
- **程序计数器(PC)** - 当前指令地址
- **当前指令** - 正在执行的指令编码
- **特权级别** - 当前CPU特权模式
- **核心ID** - CPU核心标识

#### 寄存器面板
- **整数寄存器(x0-x31)** - RISC-V通用寄存器
- **浮点寄存器(f0-f31)** - 浮点运算寄存器
- **CSR寄存器** - 控制和状态寄存器

#### 内存访问面板
- 显示内存读写操作的地址和数据
- 区分加载(load)和存储(store)操作

#### 执行日志面板
- 显示原始的Spike执行输出
- 包含详细的指令执行信息

#### 统计面板
- **总指令数** - 已执行的指令总数
- **执行时间** - 仿真运行时间
- **平均IPC** - 每秒指令数
- **内存访问次数** - 内存操作总数

## 配置选项

### Workload路径
默认使用以下测试程序：
```
/home/mio/Code/Voyager/voyager-test/output/workloads/cpu/hash-baremetal
```

您可以在界面中修改此路径来运行其他RISC-V程序。

### 服务器端口
默认端口为3000，可以通过环境变量修改：
```bash
PORT=8080 npm start
```

## 技术架构

### 后端 (Node.js)
- **Express.js** - Web服务器框架
- **Socket.IO** - 实时WebSocket通信
- **Child Process** - 管理Spike进程

### 前端 (Vanilla JavaScript)
- **现代ES6+语法** - 类和模块化代码
- **WebSocket客户端** - 实时数据接收
- **响应式CSS** - 现代化界面设计

### 数据流
1. Node.js服务器启动Spike进程
2. 解析Spike的commit log输出
3. 通过WebSocket发送结构化数据到前端
4. 前端实时更新CPU状态和寄存器显示

## 故障排除

### 常见问题

**Q: 无法启动Spike进程**
A: 确保Spike已正确编译，executable文件位于`../build/spike`

**Q: 页面显示"Disconnected"**
A: 检查Node.js服务器是否正在运行，确认端口3000未被占用

**Q: 没有执行数据显示**
A: 确认workload路径正确，文件存在且可执行

**Q: 寄存器显示不更新**
A: 检查Spike是否启用了commit logging (`--log-commits`参数)

### 调试模式

启用详细日志：
```bash
DEBUG=* npm start
```

查看浏览器控制台获取前端错误信息。

## 开发说明

### 项目结构
```
web/
├── public/           # 静态文件
│   ├── index.html   # 主页面
│   ├── style.css    # 样式文件
│   └── app.js       # 前端JavaScript
├── server.js        # Node.js服务器
├── package.json     # 项目配置
├── start.sh         # 启动脚本
└── README.md        # 说明文档
```

### 扩展功能

要添加新功能，可以：
1. 修改`server.js`中的Spike输出解析逻辑
2. 在`app.js`中添加新的UI组件
3. 更新`style.css`添加样式

## 许可证

本项目基于MIT许可证开源。 